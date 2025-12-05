from django.core.management.base import BaseCommand
from django.utils import timezone
from contractors.models import Contractor
from contractors.services.enrichment import EnrichmentService
from contractors.services.yelp_service import YelpService
import os


class Command(BaseCommand):
    help = 'Enrich contractors with BBB/Yelp data'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, help='Limit number of contractors to enrich')
        parser.add_argument('--yelp-only', action='store_true', help='Only fetch Yelp data')
        parser.add_argument('--bbb-only', action='store_true', help='Only fetch BBB data')
        parser.add_argument('--force', action='store_true', help='Re-enrich even if already enriched')

    def handle(self, *args, **options):
        self.stdout.write('=== ENRICHING CONTRACTORS ===\n')

        # Check API keys
        yelp_key = os.environ.get('YELP_API_KEY')
        if not yelp_key and not options['bbb_only']:
            self.stdout.write(self.style.WARNING(
                'YELP_API_KEY not set - Yelp enrichment will be skipped\n'
                'Get a key at: https://www.yelp.com/developers/v3/manage_app\n'
            ))

        # Build queryset
        contractors = Contractor.objects.filter(is_active=True)

        if not options['force']:
            # Only get contractors that haven't been enriched recently
            contractors = contractors.filter(last_enriched_at__isnull=True)

        if options['limit']:
            contractors = contractors[:options['limit']]

        count = contractors.count()
        self.stdout.write(f"Found {count} contractors to enrich\n")

        if count == 0:
            self.stdout.write('No contractors need enrichment. Use --force to re-enrich.\n')
            return

        # Initialize services
        enrichment = EnrichmentService()
        yelp_service = None
        if yelp_key and not options['bbb_only']:
            try:
                yelp_service = YelpService()
                self.stdout.write(self.style.SUCCESS('Yelp API connected\n'))
            except ValueError as e:
                self.stdout.write(self.style.WARNING(f'Yelp service unavailable: {e}\n'))

        enriched = 0
        for i, c in enumerate(contractors, 1):
            self.stdout.write(f"\n[{i}/{count}] {c.business_name} ({c.city})")

            # BBB enrichment
            if not options['yelp_only']:
                bbb, _ = enrichment.get_bbb(c.business_name, c.city), None
                if bbb.rating:
                    c.bbb_rating = bbb.rating
                    c.bbb_accredited = bbb.accredited
                    c.bbb_complaint_count = bbb.complaint_count
                    c.bbb_years_in_business = bbb.years_in_business
                    self.stdout.write(self.style.SUCCESS(
                        f"  BBB: {bbb.rating} | Accredited: {bbb.accredited} | "
                        f"Years: {bbb.years_in_business or '?'}"
                    ))
                else:
                    self.stdout.write(self.style.WARNING("  BBB: Not found"))

            # Yelp enrichment (use new service if available, fall back to old)
            if not options['bbb_only']:
                if yelp_service:
                    yelp_data = yelp_service.search_business(c.business_name, c.city)
                    if yelp_data:
                        c.yelp_id = yelp_data["yelp_id"]
                        c.yelp_url = yelp_data["yelp_url"]
                        c.yelp_rating = yelp_data["yelp_rating"]
                        c.yelp_review_count = yelp_data["yelp_review_count"]
                        self.stdout.write(self.style.SUCCESS(
                            f"  Yelp: {yelp_data['yelp_rating']} stars | "
                            f"{yelp_data['yelp_review_count']} reviews | "
                            f"Match: {yelp_data['match_confidence']:.0%}"
                        ))
                    else:
                        self.stdout.write(self.style.WARNING("  Yelp: Not found"))
                else:
                    # Fallback to old enrichment service
                    yelp = enrichment.get_yelp(c.business_name, c.city)
                    if yelp.yelp_id:
                        c.yelp_id = yelp.yelp_id
                        c.yelp_rating = yelp.rating
                        c.yelp_review_count = yelp.review_count
                        self.stdout.write(self.style.SUCCESS(
                            f"  Yelp: {yelp.rating} stars | {yelp.review_count} reviews"
                        ))
                    else:
                        self.stdout.write(self.style.WARNING("  Yelp: Not found"))

            c.last_enriched_at = timezone.now()
            c.save()
            enriched += 1

        self.stdout.write(self.style.SUCCESS(f'\n=== ENRICHED {enriched} CONTRACTORS ==='))
