"""
Lead Statistics Management Command

View stats about scored leads in the database.

Usage:
    python manage.py lead_stats
    python manage.py lead_stats --detailed
"""

from collections import Counter
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Count, Avg, Min, Max
from django.utils import timezone

from clients.models import Permit, Property, ScoredLead


class Command(BaseCommand):
    help = 'Display statistics about scored leads'

    def add_arguments(self, parser):
        parser.add_argument(
            '--detailed',
            action='store_true',
            help='Show detailed breakdown by category'
        )
        parser.add_argument(
            '--days',
            type=int,
            default=7,
            help='Look back N days for recent activity (default: 7)'
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING('\n=== Lead Scoring Statistics ===\n'))

        # Overall counts
        total_permits = Permit.objects.count()
        total_scored = ScoredLead.objects.count()
        total_properties = Property.objects.count()

        self.stdout.write(f'Total Permits:     {total_permits:,}')
        self.stdout.write(f'Total Scored:      {total_scored:,}')
        self.stdout.write(f'Properties (CAD):  {total_properties:,}')

        if total_permits > 0:
            pct = (total_scored / total_permits) * 100
            self.stdout.write(f'Scoring Coverage:  {pct:.1f}%')

        # Tier breakdown
        self.stdout.write(self.style.MIGRATE_HEADING('\n--- Tier Breakdown ---'))
        tier_counts = ScoredLead.objects.values('tier').annotate(count=Count('id')).order_by('-count')
        for t in tier_counts:
            tier = t['tier']
            count = t['count']
            style = {
                'A': self.style.SUCCESS,
                'B': self.style.WARNING,
                'C': self.style.NOTICE,
                'RETRY': self.style.ERROR,
            }.get(tier, self.style.NOTICE)
            self.stdout.write(style(f"  Tier {tier}: {count:,}"))

        # Trade group breakdown
        self.stdout.write(self.style.MIGRATE_HEADING('\n--- Trade Groups ---'))
        group_counts = ScoredLead.objects.values('trade_group').annotate(count=Count('id')).order_by('-count')
        for g in group_counts:
            self.stdout.write(f"  {g['trade_group']}: {g['count']:,}")

        # Status breakdown
        self.stdout.write(self.style.MIGRATE_HEADING('\n--- Sales Status ---'))
        status_counts = ScoredLead.objects.values('status').annotate(count=Count('id')).order_by('-count')
        for s in status_counts:
            self.stdout.write(f"  {s['status']}: {s['count']:,}")

        # Recent activity
        days = options['days']
        cutoff = timezone.now() - timedelta(days=days)
        recent = ScoredLead.objects.filter(scored_at__gte=cutoff).count()
        self.stdout.write(self.style.MIGRATE_HEADING(f'\n--- Recent Activity (last {days} days) ---'))
        self.stdout.write(f'  Leads scored: {recent:,}')

        # Pending retries
        retry_count = ScoredLead.objects.filter(tier='RETRY').count()
        if retry_count > 0:
            self.stdout.write(self.style.ERROR(f'\n  Pending Retries: {retry_count}'))

        # Score statistics
        self.stdout.write(self.style.MIGRATE_HEADING('\n--- Score Statistics ---'))
        stats = ScoredLead.objects.exclude(score=-1).aggregate(
            avg_score=Avg('score'),
            min_score=Min('score'),
            max_score=Max('score')
        )
        if stats['avg_score']:
            self.stdout.write(f"  Average: {stats['avg_score']:.1f}")
            self.stdout.write(f"  Range:   {stats['min_score']} - {stats['max_score']}")

        # Detailed breakdown
        if options['detailed']:
            self.stdout.write(self.style.MIGRATE_HEADING('\n--- Detailed Category Breakdown ---'))
            category_counts = (
                ScoredLead.objects
                .values('trade_group', 'category', 'tier')
                .annotate(count=Count('id'))
                .order_by('trade_group', 'category', 'tier')
            )

            current_group = None
            current_cat = None
            for row in category_counts:
                if row['trade_group'] != current_group:
                    current_group = row['trade_group']
                    self.stdout.write(self.style.SUCCESS(f"\n  {current_group}"))
                if row['category'] != current_cat:
                    current_cat = row['category']
                    self.stdout.write(f"    {current_cat}:")
                self.stdout.write(f"      Tier {row['tier']}: {row['count']}")

        self.stdout.write('')
