"""
Deduplicate contractors across verticals.

Finds contractors with same business_name + city and merges them,
combining their vertical memberships into a single record.
"""

from django.core.management.base import BaseCommand
from django.db.models import Count
from contractors.models import Contractor


class Command(BaseCommand):
    help = 'Deduplicate contractors - merge duplicates and combine verticals'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Show what would be merged without making changes')

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        self.stdout.write('=== DEDUPLICATING CONTRACTORS ===\n')

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN - No changes will be made\n'))

        # Find duplicates: same business_name (case-insensitive) + city
        duplicates = (
            Contractor.objects
            .values('business_name', 'city')
            .annotate(count=Count('id'))
            .filter(count__gt=1)
            .order_by('-count')
        )

        total_dupes = duplicates.count()
        self.stdout.write(f'Found {total_dupes} duplicate groups\n')

        if total_dupes == 0:
            self.stdout.write(self.style.SUCCESS('No duplicates found!'))
            return

        merged_count = 0
        deleted_count = 0

        for dupe in duplicates:
            name = dupe['business_name']
            city = dupe['city']
            count = dupe['count']

            # Get all contractors with this name/city
            contractors = list(
                Contractor.objects
                .filter(business_name__iexact=name, city__iexact=city)
                .order_by('id')
            )

            if len(contractors) < 2:
                continue

            # Keep the first one (oldest), merge others into it
            keeper = contractors[0]
            to_delete = contractors[1:]

            self.stdout.write(f'\n"{name}" ({city}) - {count} duplicates')

            # Collect all verticals from duplicates
            all_verticals = set(keeper.verticals.all())
            for c in to_delete:
                all_verticals.update(c.verticals.all())
                self.stdout.write(f'  - Merging ID {c.id} into ID {keeper.id}')

            # Show verticals being combined
            vertical_names = [v.name for v in all_verticals]
            self.stdout.write(f'  Verticals: {", ".join(vertical_names)}')

            if not dry_run:
                # Add all verticals to keeper
                for v in all_verticals:
                    keeper.verticals.add(v)

                # Merge data - keep best data from all records
                for c in to_delete:
                    if not keeper.phone and c.phone:
                        keeper.phone = c.phone
                    if not keeper.website and c.website:
                        keeper.website = c.website
                    if not keeper.google_rating and c.google_rating:
                        keeper.google_rating = c.google_rating
                    if (c.google_review_count or 0) > (keeper.google_review_count or 0):
                        keeper.google_review_count = c.google_review_count
                    if not keeper.yelp_rating and c.yelp_rating:
                        keeper.yelp_rating = c.yelp_rating
                    if not keeper.bbb_rating and c.bbb_rating:
                        keeper.bbb_rating = c.bbb_rating

                keeper.save()

                # Delete duplicates
                for c in to_delete:
                    c.delete()
                    deleted_count += 1

            merged_count += 1

        self.stdout.write(f'\n=== SUMMARY ===')
        self.stdout.write(f'Duplicate groups processed: {merged_count}')
        self.stdout.write(f'Records deleted: {deleted_count}')
        self.stdout.write(f'Remaining contractors: {Contractor.objects.count()}')

        if dry_run:
            self.stdout.write(self.style.WARNING('\nRun without --dry-run to apply changes'))
        else:
            self.stdout.write(self.style.SUCCESS('\nDeduplication complete!'))
