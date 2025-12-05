from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Avg

from .models import Vertical, Contractor, PASS_THRESHOLD
from .serializers import VerticalSerializer, ContractorListSerializer, ContractorDetailSerializer


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

        # Default: only passing
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

        return Response({
            'total': total,
            'passing': passing,
            'pass_threshold': PASS_THRESHOLD,
            'avg_score': all_qs.aggregate(avg=Avg('trust_score'))['avg'],
        })

    @action(detail=False)
    def top(self, request):
        qs = Contractor.objects.filter(is_active=True, passes_threshold=True)
        qs = qs.order_by('-trust_score')[:10]
        return Response(ContractorListSerializer(qs, many=True).data)
