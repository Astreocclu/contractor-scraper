"""
Lead Scoring V2 Management Command

AI-powered lead scoring with pre-filtering and export buckets.

Usage:
    # Score all permits and export
    python manage.py score_leads_v2

    # Score with limit and dry-run
    python manage.py score_leads_v2 --limit 100 --dry-run

    # Score specific city
    python manage.py score_leads_v2 --city Dallas

    # Export only (no scoring)
    python manage.py score_leads_v2 --export-only --input exports/scored.json

    # Show stats only
    python manage.py score_leads_v2 --stats
"""

import json
import logging
from datetime import date
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Q

from clients.models import Permit, Property
from clients.services.scoring_v2 import (
    PermitData,
    ScoredLead,
    ScoringStats,
    score_leads_sync,
    export_leads,
    should_discard,
    categorize_permit,
    save_scored_leads_to_db,
)

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Score leads using AI-powered Sales Director v2 scoring'

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit',
            type=int,
            default=None,
            help='Maximum number of permits to process'
        )
        parser.add_argument(
            '--city',
            type=str,
            help='Filter to specific city'
        )
        parser.add_argument(
            '--max-days',
            type=int,
            default=90,
            help='Maximum age of permits in days (default: 90)'
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be processed without scoring'
        )
        parser.add_argument(
            '--no-export',
            action='store_true',
            help='Score but do not export to CSV files'
        )
        parser.add_argument(
            '--export-dir',
            type=str,
            default='exports',
            help='Directory for exported CSV files (default: exports)'
        )
        parser.add_argument(
            '--json-output',
            type=str,
            help='Save scored results as JSON to this file'
        )
        parser.add_argument(
            '--concurrent',
            type=int,
            default=10,
            help='Max concurrent API calls (default: 10)'
        )
        parser.add_argument(
            '--stats',
            action='store_true',
            help='Show database statistics only'
        )
        parser.add_argument(
            '--category',
            type=str,
            choices=['pool', 'outdoor_living', 'roof', 'fence', 'other'],
            help='Filter to specific category'
        )
        parser.add_argument(
            '--reasoner',
            action='store_true',
            help='Use DeepSeek reasoner model with chain-of-thought (slower, captures reasoning)'
        )
        parser.add_argument(
            '--retry-only',
            type=str,
            help='Path to retry_queue.csv - only re-score these leads'
        )
        parser.add_argument(
            '--save-to-db',
            action='store_true',
            help='Save scored leads to the database (ScoredLead model)'
        )
        parser.add_argument(
            '--rescore',
            action='store_true',
            help='Re-score already scored permits (by default, only unscored permits are processed)'
        )

    def handle(self, *args, **options):
        if options['stats']:
            self._show_stats()
            return

        # Handle retry-only mode
        if options.get('retry_only'):
            permits = self._load_retry_queue(options['retry_only'])
            if not permits:
                self.stdout.write(self.style.WARNING('No permits found in retry queue'))
                return
            self.stdout.write(f'\nLoaded {len(permits)} permits from retry queue')
        else:
            # Gather permits
            permits = self._gather_permits(options)

        if not permits:
            self.stdout.write(self.style.WARNING('No permits found matching criteria'))
            return

        self.stdout.write(f'\nFound {len(permits)} permits to process')

        if options['dry_run']:
            self._show_dry_run(permits, options)
            return

        # Score
        use_reasoner = options.get('reasoner', False)
        if use_reasoner:
            self.stdout.write(self.style.NOTICE('\nScoring leads with DeepSeek REASONER (chain-of-thought enabled)...'))
        else:
            self.stdout.write(self.style.NOTICE('\nScoring leads...'))

        scored_leads, stats = score_leads_sync(
            permits,
            max_concurrent=options['concurrent'],
            use_reasoner=use_reasoner
        )

        # Show results
        self._show_results(scored_leads, stats)

        # Export
        if not options['no_export'] and scored_leads:
            self.stdout.write(self.style.NOTICE('\nExporting to CSV...'))
            counts = export_leads(scored_leads, output_dir=options['export_dir'])

            self.stdout.write(self.style.SUCCESS('\nExported files:'))
            for filepath, count in sorted(counts.items()):
                self.stdout.write(f'  {filepath}: {count} leads')

        # JSON output
        if options['json_output'] and scored_leads:
            output_path = Path(options['json_output'])
            output_path.parent.mkdir(parents=True, exist_ok=True)

            with open(output_path, 'w') as f:
                json.dump([l.to_dict() for l in scored_leads], f, indent=2, default=str)

            self.stdout.write(self.style.SUCCESS(f'\nJSON saved to: {output_path}'))

        # Save to database
        if options['save_to_db'] and scored_leads:
            self.stdout.write(self.style.NOTICE('\nSaving to database...'))
            db_counts = save_scored_leads_to_db(scored_leads)

            self.stdout.write(self.style.SUCCESS('\nDatabase results:'))
            self.stdout.write(f"  Created: {db_counts['created']}")
            self.stdout.write(f"  Updated: {db_counts['updated']}")
            self.stdout.write(f"  Skipped: {db_counts['skipped']}")
            if db_counts.get('errors'):
                self.stdout.write(self.style.ERROR(f"  Errors:  {db_counts['errors']}"))

    def _gather_permits(self, options) -> list:
        """Gather permits from database and convert to PermitData."""
        permits_qs = Permit.objects.all()

        # Exclude already-scored permits unless --rescore is specified
        if not options.get('rescore'):
            permits_qs = permits_qs.exclude(scored_lead__isnull=False)

        # Exclude permits that would fail "no CAD data" filter
        # (no owner AND no market value = auto-discard)
        # Keep permits that have: applicant_name OR property with owner/value
        permits_qs = permits_qs.filter(
            Q(applicant_name__isnull=False) & ~Q(applicant_name='') |  # Has applicant
            Q(property_address__in=Property.objects.filter(
                Q(owner_name__isnull=False) & ~Q(owner_name='') |  # Has owner
                Q(market_value__gt=0)  # Has value
            ).values('property_address'))
        )

        # Filter by city
        if options.get('city'):
            permits_qs = permits_qs.filter(city__iexact=options['city'])

        # Filter by age
        max_days = options.get('max_days', 90)
        if max_days:
            from datetime import timedelta
            cutoff = date.today() - timedelta(days=max_days)
            permits_qs = permits_qs.filter(
                Q(issued_date__gte=cutoff) | Q(issued_date__isnull=True)
            )

        # Order by date (newest first)
        permits_qs = permits_qs.order_by('-issued_date')

        # Apply limit
        if options.get('limit'):
            permits_qs = permits_qs[:options['limit']]

        # Convert to PermitData
        permits = []
        for permit in permits_qs:
            # Try to find enriched property data
            property_obj = None
            try:
                property_obj = Property.objects.get(
                    property_address__iexact=permit.property_address
                )
            except Property.DoesNotExist:
                pass

            permit_data = PermitData.from_permit_model(permit, property_obj)

            # Filter by category if specified
            if options.get('category'):
                if categorize_permit(permit_data) != options['category']:
                    continue

            permits.append(permit_data)

        return permits

    def _show_dry_run(self, permits: list, options):
        """Show what would be processed in dry-run mode."""
        self.stdout.write(self.style.NOTICE('\n=== DRY RUN MODE ===\n'))

        # Run through filter
        keep = []
        discard_reasons = {}

        for permit in permits:
            discard, reason = should_discard(permit)
            if discard:
                reason_key = reason.split(":")[0] if ":" in reason else reason
                discard_reasons[reason_key] = discard_reasons.get(reason_key, 0) + 1
            else:
                keep.append(permit)

        # Show discard summary
        if discard_reasons:
            self.stdout.write(self.style.WARNING('Would discard:'))
            for reason, count in sorted(discard_reasons.items(), key=lambda x: -x[1]):
                self.stdout.write(f'  {reason}: {count}')
            self.stdout.write('')

        # Show category breakdown
        categories = {}
        for permit in keep:
            cat = categorize_permit(permit)
            categories[cat] = categories.get(cat, 0) + 1

        self.stdout.write(self.style.SUCCESS('Would score:'))
        for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
            self.stdout.write(f'  {cat}: {count}')

        # Show sample
        self.stdout.write(self.style.NOTICE('\nSample of leads to score:'))
        for permit in keep[:10]:
            value_str = f'${permit.market_value:,.0f}' if permit.market_value else 'N/A'
            self.stdout.write(
                f'  [{permit.city}] {permit.project_description[:40]}... '
                f'| {value_str} | {permit.days_old}d old'
            )

        self.stdout.write(
            self.style.SUCCESS(f'\nTotal: {len(permits)} input -> {len(keep)} to score')
        )

    def _show_results(self, leads: list, stats: ScoringStats):
        """Show scoring results summary."""
        self.stdout.write('\n' + '=' * 60)
        self.stdout.write(self.style.SUCCESS('SCORING RESULTS'))
        self.stdout.write('=' * 60 + '\n')

        self.stdout.write(f'Input:     {stats.total_input}')
        self.stdout.write(f'Discarded: {stats.discarded}')
        self.stdout.write(f'Scored:    {stats.scored}\n')

        # Tier breakdown
        self.stdout.write(self.style.SUCCESS(f'Tier A (80+):  {stats.tier_a}'))
        self.stdout.write(self.style.WARNING(f'Tier B (50-79): {stats.tier_b}'))
        self.stdout.write(self.style.ERROR(f'Tier C (<50):   {stats.tier_c}'))

        if stats.pending_retry:
            self.stdout.write(
                self.style.NOTICE(f'\nPending retry (API failed): {stats.pending_retry}')
            )

        if stats.flagged_for_review:
            self.stdout.write(
                self.style.NOTICE(f'\nFlagged for review: {stats.flagged_for_review}')
            )

        # Discard reasons
        if stats.discard_reasons:
            self.stdout.write(self.style.WARNING('\nDiscard reasons:'))
            for reason, count in sorted(stats.discard_reasons.items(), key=lambda x: -x[1]):
                self.stdout.write(f'  {reason}: {count}')

        # Top leads
        tier_a_leads = [l for l in leads if l.tier == 'A']
        if tier_a_leads:
            self.stdout.write(self.style.SUCCESS('\nTop Tier A Leads:'))
            for lead in sorted(tier_a_leads, key=lambda x: -x.score)[:5]:
                self.stdout.write(
                    f'  [{lead.score}] {lead.permit.project_description[:35]}... '
                    f'-> {lead.ideal_contractor}'
                )

        # Category breakdown
        categories = {}
        for lead in leads:
            categories[lead.category] = categories.get(lead.category, 0) + 1

        self.stdout.write(self.style.NOTICE('\nBy category:'))
        for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
            self.stdout.write(f'  {cat}: {count}')

    def _load_retry_queue(self, csv_path: str) -> list:
        """Load permits from retry queue CSV and look up from database."""
        import csv

        permits = []
        permit_ids = []

        with open(csv_path, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                permit_ids.append(row['permit_id'])

        self.stdout.write(f'Found {len(permit_ids)} permit IDs in retry queue')

        # Look up permits from database
        for permit_id in permit_ids:
            try:
                permit = Permit.objects.get(permit_id=permit_id)
                property_obj = None
                try:
                    property_obj = Property.objects.get(
                        property_address__iexact=permit.property_address
                    )
                except Property.DoesNotExist:
                    pass

                permit_data = PermitData.from_permit_model(permit, property_obj)
                permits.append(permit_data)
            except Permit.DoesNotExist:
                self.stdout.write(self.style.WARNING(f'Permit {permit_id} not found in database'))

        return permits

    def _show_stats(self):
        """Show database statistics."""
        self.stdout.write(self.style.NOTICE('\n=== DATABASE STATISTICS ===\n'))

        total = Permit.objects.count()
        self.stdout.write(f'Total permits: {total}')

        # By city
        from django.db.models import Count
        cities = Permit.objects.values('city').annotate(count=Count('id')).order_by('-count')[:10]
        self.stdout.write('\nBy city (top 10):')
        for city in cities:
            self.stdout.write(f'  {city["city"]}: {city["count"]}')

        # By permit type
        types = Permit.objects.values('permit_type').annotate(count=Count('id')).order_by('-count')[:10]
        self.stdout.write('\nBy permit type (top 10):')
        for t in types:
            self.stdout.write(f'  {t["permit_type"] or "Unknown"}: {t["count"]}')

        # Age distribution
        from datetime import timedelta
        today = date.today()

        age_buckets = {
            '0-14 days': Permit.objects.filter(issued_date__gte=today - timedelta(days=14)).count(),
            '15-30 days': Permit.objects.filter(
                issued_date__lt=today - timedelta(days=14),
                issued_date__gte=today - timedelta(days=30)
            ).count(),
            '31-60 days': Permit.objects.filter(
                issued_date__lt=today - timedelta(days=30),
                issued_date__gte=today - timedelta(days=60)
            ).count(),
            '61-90 days': Permit.objects.filter(
                issued_date__lt=today - timedelta(days=60),
                issued_date__gte=today - timedelta(days=90)
            ).count(),
            '90+ days': Permit.objects.filter(issued_date__lt=today - timedelta(days=90)).count(),
            'No date': Permit.objects.filter(issued_date__isnull=True).count(),
        }

        self.stdout.write('\nBy age:')
        for bucket, count in age_buckets.items():
            self.stdout.write(f'  {bucket}: {count}')

        # Enriched count
        enriched = Property.objects.filter(enrichment_status='success').count()
        self.stdout.write(f'\nEnriched properties: {enriched}')
