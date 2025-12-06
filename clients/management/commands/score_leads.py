"""
Django management command to score permits and create leads.

Usage:
    python manage.py score_leads
    python manage.py score_leads --limit 100
"""

import logging
from django.core.management.base import BaseCommand

from clients.services.scoring import score_all_permits


class Command(BaseCommand):
    help = 'Score all permits and create/update leads'

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit',
            type=int,
            default=None,
            help='Limit number of permits to score'
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Enable verbose logging'
        )

    def handle(self, *args, **options):
        limit = options['limit']
        verbose = options['verbose']

        # Configure logging
        log_level = logging.DEBUG if verbose else logging.INFO
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )

        self.stdout.write(self.style.HTTP_INFO('Scoring permits...'))

        count = score_all_permits(limit=limit)

        self.stdout.write(
            self.style.SUCCESS(f'✓ Scored {count} permits into leads')
        )
