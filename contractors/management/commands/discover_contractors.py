"""
Django management command to discover contractors from Google Maps.

Runs the full search matrix (7 categories x 8 cities) and saves
discovered contractors to the database.

Usage:
  python manage.py discover_contractors
  python manage.py discover_contractors --city "Fort Worth" --category "plumber"
  python manage.py discover_contractors --dry-run
  python manage.py discover_contractors --limit 20
"""

import asyncio
import sys
import os

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.text import slugify

# Add scrapers to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))

from scrapers.contractor_discovery import (
    scrape_contractors_in_area,
    run_full_matrix,
    CATEGORIES,
    CITIES,
    DiscoveredContractor,
)
from contractors.models import Contractor, Vertical


# Map search categories to Vertical slugs
# Note: Verticals are created on-demand if they don't exist
CATEGORY_TO_VERTICAL = {
    "plumber": "plumbing",
    "electrician": "electrical",
    "HVAC contractor": "hvac",
    "roofing contractor": "roofing",
    "foundation repair": "foundation",
    "pool contractor": "pool",  # Match existing 'pool' slug
    "outdoor living contractor": "outdoor-living",
    "window contractor": "windows",
}


class Command(BaseCommand):
    help = 'Discover contractors from Google Maps and save to database'

    def add_arguments(self, parser):
        parser.add_argument(
            '--city',
            type=str,
            help='Single city to search (e.g., "Fort Worth")'
        )
        parser.add_argument(
            '--category',
            type=str,
            help='Single category to search (e.g., "plumber")'
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=60,
            help='Max results per search (default: 60)'
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be saved without writing to DB'
        )
        parser.add_argument(
            '--no-cache',
            action='store_true',
            help='Skip cache and fetch fresh data'
        )
        parser.add_argument(
            '--visible',
            action='store_true',
            help='Show browser window (not headless)'
        )

    def handle(self, *args, **options):
        self.stdout.write('=== CONTRACTOR DISCOVERY ===\n')

        dry_run = options['dry_run']
        use_cache = not options['no_cache']
        headless = not options['visible']
        limit = options['limit']

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN - no database writes\n'))

        # Determine search scope
        if options['city'] and options['category']:
            # Single search
            categories = [options['category']]
            cities = [options['city']]
        elif options['city']:
            # All categories in one city
            categories = CATEGORIES
            cities = [options['city']]
        elif options['category']:
            # One category in all cities
            categories = [options['category']]
            cities = CITIES
        else:
            # Full matrix
            categories = CATEGORIES
            cities = CITIES

        total_searches = len(categories) * len(cities)
        self.stdout.write(f"Running {total_searches} searches ({len(categories)} categories x {len(cities)} cities)\n")
        self.stdout.write(f"Max {limit} results per search\n\n")

        # Run the discovery
        results = asyncio.run(run_full_matrix(
            categories=categories,
            cities=cities,
            max_results_per_search=limit,
            use_cache=use_cache,
            headless=headless
        ))

        # Process results
        total_discovered = 0
        total_created = 0
        total_updated = 0
        total_errors = 0

        for result in results:
            status_parts = []

            if result.error:
                self.stdout.write(self.style.ERROR(
                    f"  {result.category} in {result.city}: ERROR - {result.error}"
                ))
                total_errors += 1
                continue

            if result.cached:
                status_parts.append("cached")

            self.stdout.write(
                f"\n{result.category} in {result.city}: {result.total_found} found"
                + (f" [{', '.join(status_parts)}]" if status_parts else "")
            )

            total_discovered += result.total_found

            if not dry_run:
                created, updated = self._save_contractors(result.contractors, result.category)
                total_created += created
                total_updated += updated
                self.stdout.write(f"  -> {created} created, {updated} updated")
            else:
                # Show what would be created
                for c in result.contractors[:5]:
                    self.stdout.write(f"  - {c.business_name}")
                if result.total_found > 5:
                    self.stdout.write(f"  ... and {result.total_found - 5} more")

        # Summary
        self.stdout.write(f"\n{'='*50}")
        self.stdout.write(self.style.SUCCESS(f"DISCOVERY COMPLETE"))
        self.stdout.write(f"  Total discovered: {total_discovered}")
        if not dry_run:
            self.stdout.write(f"  Created: {total_created}")
            self.stdout.write(f"  Updated: {total_updated}")
        if total_errors:
            self.stdout.write(self.style.WARNING(f"  Errors: {total_errors}"))
        self.stdout.write(f"{'='*50}\n")

    def _save_contractors(self, contractors: list, source_category: str) -> tuple[int, int]:
        """
        Save discovered contractors to database.
        Returns (created_count, updated_count).
        """
        created = 0
        updated = 0

        # Get or create the vertical for this category
        vertical = None
        vertical_slug = CATEGORY_TO_VERTICAL.get(source_category)
        if vertical_slug:
            try:
                # Try to get existing vertical first
                vertical = Vertical.objects.filter(slug=vertical_slug).first()
                if not vertical:
                    # Create new vertical - let Django handle ID
                    vertical = Vertical.objects.create(
                        slug=vertical_slug,
                        name=source_category.title(),
                        description=f'Contractors specializing in {source_category}',
                    )
            except Exception as e:
                self.stdout.write(self.style.WARNING(
                    f"  ! Could not get/create vertical '{vertical_slug}': {e}"
                ))
                vertical = None

        for c in contractors:
            try:
                with transaction.atomic():
                    contractor, was_created = Contractor.objects.update_or_create(
                        business_name=c.business_name,
                        city=c.city,
                        defaults={
                            'state': c.state,
                            'address': c.address or '',
                            'phone': c.phone or '',
                            'website': c.website,
                            'google_place_id': c.google_place_id,
                            'google_rating': c.google_rating,
                            'google_review_count': c.google_review_count or 0,
                        }
                    )

                    # Add vertical if we have one and it's not already assigned
                    if vertical and not contractor.verticals.filter(pk=vertical.pk).exists():
                        contractor.verticals.add(vertical)

                    if was_created:
                        created += 1
                    else:
                        updated += 1

            except Exception as e:
                self.stdout.write(self.style.WARNING(
                    f"  ! Failed to save {c.business_name}: {e}"
                ))

        return created, updated
