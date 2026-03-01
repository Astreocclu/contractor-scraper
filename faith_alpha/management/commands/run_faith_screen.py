from django.core.management.base import BaseCommand

from faith_alpha.models import Company
from faith_alpha.services.pipeline import score_companies
from faith_alpha.services.policy_signals import ExternalSignalSyncService
from faith_alpha.services.sec_ingest import DEFAULT_FORMS, run_ingestion, SecClientError


class Command(BaseCommand):
    help = 'Ingest SEC data for a stock universe and compute Faith Alignment Scores.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=25)
        parser.add_argument('--tickers', type=str, default='')
        parser.add_argument('--universe', type=str, default='top100', help='top100 | sp500')
        parser.add_argument('--forms', type=str, default=','.join(DEFAULT_FORMS))
        parser.add_argument('--fetch-text', action='store_true', help='Fetch filing text from EDGAR archives.')
        parser.add_argument('--use-llm', action='store_true', help='Use DeepSeek for classification when available.')
        parser.add_argument('--profile', type=str, default='consensus', help='consensus | protestant_strict | catholic_permissive')
        parser.add_argument('--sync-signals', action='store_true', help='Ingest FEC/LDA policy signals before scoring.')
        parser.add_argument('--signal-limit', type=int, default=5, help='Max signals per source/company.')
        parser.add_argument('--fec-cycle', type=int, default=2024)
        parser.add_argument('--lda-year', type=int, default=2024)
        parser.add_argument('--skip-ingest', action='store_true', help='Skip SEC ingestion and only rescore existing records.')

    def handle(self, *args, **options):
        limit = max(1, int(options['limit']))
        tickers = [t.strip().upper() for t in options['tickers'].split(',') if t.strip()]
        forms = [f.strip().upper() for f in options['forms'].split(',') if f.strip()]

        self.stdout.write(self.style.NOTICE('Starting Christian Alpha MVP pipeline...'))
        self.stdout.write(f"Universe size target: {limit}")
        self.stdout.write(f"Forms: {forms}")

        ingestion_summary = None
        if not options['skip_ingest']:
            try:
                ingestion_summary = run_ingestion(
                    limit=limit,
                    tickers=tickers or None,
                    forms=forms,
                    fetch_text=bool(options['fetch_text']),
                    universe=options['universe'],
                )
                self.stdout.write(self.style.SUCCESS(f"Ingestion complete: {ingestion_summary}"))
            except (SecClientError, Exception) as exc:
                self.stdout.write(self.style.WARNING(f"Ingestion issue: {exc}"))
                self.stdout.write(self.style.WARNING('Falling back to already-ingested companies in database.'))

        queryset = Company.objects.filter(is_active=True)
        if tickers:
            queryset = queryset.filter(ticker__in=tickers)
        queryset = queryset.order_by('market_cap_rank', 'ticker')[:limit]

        companies = list(queryset)
        if not companies:
            self.stdout.write(self.style.ERROR('No companies available to score.'))
            return

        if options['sync_signals']:
            signal_sync = ExternalSignalSyncService()
            fec_total = 0
            lda_total = 0
            for company in companies:
                counts = signal_sync.sync_company(
                    company=company,
                    cycle=int(options['fec_cycle']),
                    filing_year=int(options['lda_year']),
                    limit=max(1, int(options['signal_limit'])),
                )
                fec_total += counts.get('fec', 0)
                lda_total += counts.get('lda', 0)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Signal ingestion complete: fec_signals={fec_total}, lda_signals={lda_total}"
                )
            )

        screens = score_companies(
            companies=companies,
            use_llm=bool(options['use_llm']),
            profile_name=options['profile'],
        )

        self.stdout.write(self.style.SUCCESS(f"Scored {len(screens)} companies."))
        self.stdout.write('Top 10 by Faith Alignment Score:')
        for idx, screen in enumerate(sorted(screens, key=lambda s: s.alignment_score, reverse=True)[:10], start=1):
            self.stdout.write(
                f"{idx:02d}. {screen.company.ticker:<6} score={screen.alignment_score:<3} "
                f"base={screen.base_score:<3} confidence={screen.confidence_score}"
            )
