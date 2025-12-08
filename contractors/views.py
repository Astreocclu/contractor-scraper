from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Avg, Count, Q
from django.core.management import call_command
from io import StringIO
import threading
import uuid
import ctypes

from .models import Vertical, Contractor, PASS_THRESHOLD
from .serializers import VerticalSerializer, ContractorListSerializer, ContractorDetailSerializer

# Track running tasks and their threads
_running_tasks = {}
_task_threads = {}


class VerticalViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Vertical.objects.filter(is_active=True)
    serializer_class = VerticalSerializer
    lookup_field = 'slug'


class ContractorViewSet(viewsets.ReadOnlyModelViewSet):
    lookup_field = 'slug'

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ContractorDetailSerializer
        return ContractorListSerializer

    def get_queryset(self):
        qs = Contractor.objects.filter(is_active=True)

        # For detail view (retrieve), return all active contractors
        # For list view, filter to passing only (unless ?all=true)
        if self.action == 'list':
            if self.request.query_params.get('all', '').lower() != 'true':
                qs = qs.filter(passes_threshold=True)

            vertical = self.request.query_params.get('vertical')
            if vertical:
                qs = qs.filter(verticals__slug=vertical)

            city = self.request.query_params.get('city')
            if city:
                qs = qs.filter(city__iexact=city)

        return qs.order_by('-trust_score')

    @action(detail=False)
    def stats(self, request):
        all_qs = Contractor.objects.filter(is_active=True)
        passing = all_qs.filter(passes_threshold=True).count()
        total = all_qs.count()

        # Score distribution by ranges
        score_distribution = {
            'gold': all_qs.filter(trust_score__gte=80).count(),
            'silver': all_qs.filter(trust_score__gte=65, trust_score__lt=80).count(),
            'bronze': all_qs.filter(trust_score__gte=50, trust_score__lt=65).count(),
            'unranked': all_qs.filter(trust_score__lt=50).count(),
        }

        # Get unique cities count
        cities = all_qs.values('city').distinct().count()

        return Response({
            'total': total,
            'passing': passing,
            'pass_threshold': PASS_THRESHOLD,
            'avg_score': all_qs.aggregate(avg=Avg('trust_score'))['avg'],
            'score_distribution': score_distribution,
            'cities': cities,
        })

    @action(detail=False)
    def top(self, request):
        qs = Contractor.objects.filter(is_active=True, passes_threshold=True)
        qs = qs.order_by('-trust_score')[:10]
        return Response(ContractorListSerializer(qs, many=True).data)


def run_command_in_thread(task_id, command, **kwargs):
    """Run a management command in a background thread."""
    try:
        _running_tasks[task_id]['status'] = 'running'
        out = StringIO()
        call_command(command, stdout=out, **kwargs)
        _running_tasks[task_id].update({
            'status': 'completed',
            'output': out.getvalue(),
        })
    except Exception as e:
        _running_tasks[task_id].update({
            'status': 'failed',
            'output': str(e),
        })
    finally:
        # Clean up thread reference
        if task_id in _task_threads:
            del _task_threads[task_id]


def terminate_thread(thread):
    """Forcefully terminate a thread (use with caution)."""
    if not thread.is_alive():
        return False
    thread_id = thread.ident
    res = ctypes.pythonapi.PyThreadState_SetAsyncExc(
        ctypes.c_long(thread_id),
        ctypes.py_object(SystemExit)
    )
    return res == 1


class CommandRunnerView(APIView):
    """API to trigger management commands from the frontend."""

    def get(self, request):
        """Get status of all tasks or a specific task."""
        task_id = request.query_params.get('task_id')
        if task_id:
            task = _running_tasks.get(task_id)
            if not task:
                return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
            return Response({'task_id': task_id, **task})
        return Response({'tasks': _running_tasks})

    def post(self, request):
        """Run a management command."""
        command = request.data.get('command')

        valid_commands = ['scrape_contractors', 'enrich_contractors', 'audit_contractors']
        if command not in valid_commands:
            return Response(
                {'error': f'Invalid command. Valid: {valid_commands}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if this command is already running
        for tid, task in _running_tasks.items():
            if task.get('command') == command and task.get('status') == 'running':
                return Response({
                    'error': f'{command} is already running',
                    'task_id': tid
                }, status=status.HTTP_409_CONFLICT)

        # Generate task ID
        task_id = str(uuid.uuid4())[:8]

        # Build kwargs based on command type
        kwargs = {}
        options = request.data.get('options', {})

        # Common option
        if 'limit' in options:
            kwargs['limit'] = int(options['limit'])

        # Scraper-specific options
        if command == 'scrape_contractors':
            if options.get('vertical'):
                kwargs['vertical'] = options['vertical']
            if options.get('city'):
                kwargs['city'] = options['city']
            if options.get('with_reviews'):
                kwargs['with_reviews'] = True
            if options.get('dry_run'):
                kwargs['dry_run'] = True

        # Enrich-specific options
        elif command == 'enrich_contractors':
            if options.get('yelp_only'):
                kwargs['yelp_only'] = True
            if options.get('bbb_only'):
                kwargs['bbb_only'] = True
            if options.get('force'):
                kwargs['force'] = True

        # Audit-specific options
        elif command == 'audit_contractors':
            if options.get('skip_ai'):
                kwargs['skip_ai'] = True

        # Initialize task status
        _running_tasks[task_id] = {
            'status': 'starting',
            'output': '',
            'command': command,
            'options': options
        }

        # Start command in background thread
        thread = threading.Thread(
            target=run_command_in_thread,
            args=(task_id, command),
            kwargs=kwargs
        )
        thread.daemon = True
        _task_threads[task_id] = thread
        thread.start()

        return Response({
            'task_id': task_id,
            'command': command,
            'status': 'started',
            'options': options
        }, status=status.HTTP_202_ACCEPTED)

    def delete(self, request):
        """Stop a running task."""
        task_id = request.query_params.get('task_id')
        if not task_id:
            return Response({'error': 'task_id required'}, status=status.HTTP_400_BAD_REQUEST)

        task = _running_tasks.get(task_id)
        if not task:
            return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)

        if task.get('status') != 'running':
            return Response({'error': 'Task is not running'}, status=status.HTTP_400_BAD_REQUEST)

        # Try to terminate the thread
        thread = _task_threads.get(task_id)
        if thread and thread.is_alive():
            if terminate_thread(thread):
                _running_tasks[task_id].update({
                    'status': 'stopped',
                    'output': 'Task was stopped by user'
                })
                return Response({'task_id': task_id, 'status': 'stopped'})
            else:
                return Response(
                    {'error': 'Failed to stop task'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

        # Thread already finished
        return Response({'task_id': task_id, 'status': task.get('status')})
