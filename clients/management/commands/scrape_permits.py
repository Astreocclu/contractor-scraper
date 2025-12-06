"""
Django management command to scrape permits from city portals.

Usage:
    python manage.py scrape_permits --city fort_worth
    python manage.py scrape_permits --city all
    python manage.py scrape_permits --city fort_worth --days 30
"""

import logging
from django.core.management.base import BaseCommand

# Import all scrapers
from clients.services.scrapers.fort_worth import FortWorthScraper

# Registry of available scrapers
SCRAPERS = {
    'fort_worth': FortWorthScraper,
    # Add more as they're migrated:
    # 'colleyville': ColleyvilleScraper,
    # 'keller': KellerScraper,
    # 'southlake': SouthlakeScraper,
    # 'north_richland_hills': NorthRichlandHillsScraper,
}


class Command(BaseCommand):
    help = 'Scrape building permits from city portals'

    def add_arguments(self, parser):
        parser.add_argument(
            '--city',
            type=str,
            required=True,
            help='City to scrape (or "all" for all cities)'
        )
        parser.add_argument(
            '--days',
            type=int,
            default=90,
            help='Number of days to look back (default: 90)'
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Enable verbose logging'
        )

    def handle(self, *args, **options):
        city = options['city'].lower()
        days = options['days']
        verbose = options['verbose']

        # Configure logging
        log_level = logging.DEBUG if verbose else logging.INFO
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )

        if city == 'all':
            cities = list(SCRAPERS.keys())
        else:
            if city not in SCRAPERS:
                self.stderr.write(
                    self.style.ERROR(f'Unknown city: {city}. Available: {", ".join(SCRAPERS.keys())}')
                )
                return

            cities = [city]

        total_saved = 0

        for city_name in cities:
            self.stdout.write(f"\n{'='*60}")
            self.stdout.write(self.style.HTTP_INFO(f'Scraping {city_name}...'))
            self.stdout.write(f"{'='*60}\n")

            try:
                scraper_class = SCRAPERS[city_name]
                scraper = scraper_class(lookback_days=days)
                saved = scraper.run()
                total_saved += saved

                self.stdout.write(
                    self.style.SUCCESS(f'✓ {city_name}: {saved} permits saved')
                )

            except Exception as e:
                self.stderr.write(
                    self.style.ERROR(f'✗ {city_name}: {str(e)}')
                )

        self.stdout.write(f"\n{'='*60}")
        self.stdout.write(
            self.style.SUCCESS(f'Total: {total_saved} permits saved from {len(cities)} cities')
        )
