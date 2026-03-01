from django.db.models import Avg
from rest_framework import status
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from faith_alpha.models import Company, FaithScreen
from faith_alpha.services.optimizer import PortfolioOptimizer
from faith_alpha.services.pipeline import score_company
from faith_alpha.services.policy_signals import ExternalSignalSyncService
from faith_alpha.services.scoring import parse_profile_overrides_from_query
from faith_alpha.serializers import CompanyListSerializer, CompanyDetailSerializer


class CompanyFaithViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Company.objects.filter(is_active=True).select_related('faith_screen').prefetch_related('filings', 'signals')
    lookup_field = 'ticker'

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return CompanyDetailSerializer
        return CompanyListSerializer

    def get_queryset(self):
        qs = self.queryset.filter(faith_screen__isnull=False)

        ticker = self.request.query_params.get('ticker')
        if ticker:
            qs = qs.filter(ticker__iexact=ticker)

        min_score = self.request.query_params.get('min_score')
        if min_score:
            try:
                score = int(min_score)
                qs = qs.filter(faith_screen__alignment_score__gte=score)
            except ValueError:
                pass

        source = self.request.query_params.get('source')
        if source:
            qs = qs.filter(signals__source=source).distinct()

        return qs.order_by('-faith_screen__alignment_score', 'ticker')

    @action(detail=False)
    def stats(self, request):
        screens = FaithScreen.objects.select_related('company')
        total = screens.count()
        avg_score = screens.aggregate(avg=Avg('alignment_score'))['avg']
        source_counts = {
            'fec_companies': Company.objects.filter(signals__source='fec').distinct().count(),
            'lda_companies': Company.objects.filter(signals__source='lda').distinct().count(),
        }

        distribution = {
            'aligned_80_plus': screens.filter(alignment_score__gte=80).count(),
            'watch_60_79': screens.filter(alignment_score__gte=60, alignment_score__lt=80).count(),
            'restricted_below_60': screens.filter(alignment_score__lt=60).count(),
        }

        return Response({
            'total_scored_companies': total,
            'avg_alignment_score': avg_score,
            'distribution': distribution,
            'signal_coverage': source_counts,
        })

    @action(detail=True, methods=['post'])
    def rescore(self, request, ticker=None):
        company = self.get_object()
        profile = request.data.get('profile', 'consensus')
        use_llm = str(request.data.get('use_llm', 'false')).strip().lower() in {'1', 'true', 'yes'}
        sync_signals = str(request.data.get('sync_signals', 'false')).strip().lower() in {'1', 'true', 'yes'}

        if sync_signals:
            signal_sync = ExternalSignalSyncService()
            signal_sync.sync_company(
                company=company,
                cycle=int(request.data.get('fec_cycle', 2024)),
                filing_year=int(request.data.get('lda_year', 2024)),
                limit=int(request.data.get('signal_limit', 5)),
            )

        screen = score_company(
            company=company,
            use_llm=use_llm,
            profile_name=profile,
        )
        serializer = CompanyDetailSerializer(company, context={'request': request})
        return Response(
            {
                'message': 'Company rescored',
                'alignment_score': screen.alignment_score,
                'company': serializer.data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=['post'])
    def portfolio(self, request):
        def _safe_int(raw, default):
            try:
                return int(raw)
            except (TypeError, ValueError):
                return default

        profile = request.data.get('profile', 'consensus')
        risk_tolerance = request.data.get('risk_tolerance', 'moderate')
        min_alignment_score = _safe_int(request.data.get('min_alignment_score', 70), 70)
        max_holdings = _safe_int(request.data.get('max_holdings', 25), 25)

        raw_overrides = request.data.get('overrides')
        if isinstance(raw_overrides, dict):
            overrides = {k: bool(v) for k, v in raw_overrides.items()}
        else:
            # Supports query-string style booleans if payload uses flat keys.
            overrides = parse_profile_overrides_from_query(request.data)

        queryset = Company.objects.filter(
            is_active=True,
            faith_screen__isnull=False,
        ).select_related('faith_screen').prefetch_related('filings', 'signals')

        tickers = request.data.get('tickers')
        if isinstance(tickers, list) and tickers:
            normalized = [str(t).upper().strip() for t in tickers if str(t).strip()]
            queryset = queryset.filter(ticker__in=normalized)

        companies = list(queryset)
        optimizer = PortfolioOptimizer()
        result = optimizer.build_portfolio(
            companies=companies,
            min_alignment_score=min_alignment_score,
            profile_name=profile,
            profile_overrides=overrides,
            risk_tolerance=risk_tolerance,
            max_holdings=max_holdings,
        )
        return Response(result, status=status.HTTP_200_OK)
