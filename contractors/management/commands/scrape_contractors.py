import logging
from django.core.management.base import BaseCommand
from django.db import IntegrityError
from contractors.models import Vertical, Contractor
from contractors.services.google_scraper import GoogleScraper

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Scrape contractors from Google'

    def add_arguments(self, parser):
        parser.add_argument('--vertical', type=str)
        parser.add_argument('--city', type=str)
        parser.add_argument('--limit', type=int)
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--with-reviews', action='store_true')

    def handle(self, *args, **options):
        self.stdout.write('=== SCRAPING CONTRACTORS ===')

        verticals = Vertical.objects.filter(is_active=True)
        if options['vertical']:
            verticals = verticals.filter(slug=options['vertical'])

        try:
            scraper = GoogleScraper()
        except ValueError as e:
            self.stdout.write(self.style.ERROR(str(e)))
            return

        cities = [options['city']] if options['city'] else None
        created, updated = 0, 0

        for vertical in verticals:
            self.stdout.write(f"\n--- {vertical.name} ---")

            contractors = scraper.scrape_all(
                search_terms=vertical.search_terms,
                cities=cities,
            )

            if options['limit']:
                contractors = contractors[:options['limit']]

            if options['dry_run']:
                for c in contractors[:5]:
                    self.stdout.write(f"  {c.business_name} ({c.city})")
                continue

            for sc in contractors:
                try:
                    existing = Contractor.objects.filter(
                        business_name__iexact=sc.business_name,
                        city__iexact=sc.city
                    ).first()

                    if existing:
                        if sc.google_rating:
                            existing.google_rating = sc.google_rating
                        if sc.google_review_count:
                            existing.google_review_count = sc.google_review_count
                        if sc.phone:
                            existing.phone = sc.phone
                        if sc.website:
                            existing.website = sc.website
                        existing.save()
                        existing.verticals.add(vertical)

                        if options['with_reviews'] and sc.google_place_id:
                            reviews = scraper.fetch_reviews(sc.google_place_id)
                            if reviews:
                                existing.google_reviews_json = reviews
                                existing.save()
                        updated += 1
                    else:
                        c = Contractor.objects.create(
                            business_name=sc.business_name,
                            address=sc.address,
                            city=sc.city,
                            state=sc.state,
                            phone=sc.phone,
                            website=sc.website,
                            google_place_id=sc.google_place_id,
                            google_rating=sc.google_rating,
                            google_review_count=sc.google_review_count,
                        )
                        c.verticals.add(vertical)

                        if options['with_reviews'] and sc.google_place_id:
                            reviews = scraper.fetch_reviews(sc.google_place_id)
                            if reviews:
                                c.google_reviews_json = reviews
                                c.save()
                        created += 1
                        self.stdout.write(f"  + {c.business_name}")
                except IntegrityError:
                    pass

        self.stdout.write(f"\nCreated: {created}, Updated: {updated}")
        self.stdout.write(f"Total: {Contractor.objects.count()}")
