"""
Django management command to import leads from CSV files.

Usage:
    python manage.py import_csv path/to/file.csv
    python manage.py import_csv path/to/file.csv --dry-run
"""

import csv
import uuid
import re
from datetime import datetime
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from clients.models import Permit, Property, Lead


def normalize_address(address):
    """Normalize address for consistency."""
    if not address:
        return None
    addr = address.upper().strip()
    # Remove extra whitespace
    addr = re.sub(r'\s+', ' ', addr)
    return addr


def categorize_permit(permit_type, description):
    """
    Categorize permit into lead_type based on permit type and description.
    Returns (lead_type, lead_subtypes, tier)
    """
    desc_lower = (description or '').lower()
    ptype = (permit_type or '').upper()

    # Pool-related
    if any(x in desc_lower for x in ['pool', 'spa', 'swimming']):
        return 'pool', ['swimming pool'], 'A'

    # Outdoor structures (high value for contractors)
    if any(x in desc_lower for x in ['patio', 'deck', 'pergola', 'gazebo', 'outdoor kitchen', 'cabana']):
        return 'outdoor structure', [desc_lower.split()[0]], 'A'

    # Fence
    if 'fence' in desc_lower:
        return 'fence', ['fence'], 'B'

    # Roofing
    if any(x in desc_lower for x in ['roof', 'roofing', 'shingle']):
        return 'roofing', ['roof repair' if 'repair' in desc_lower else 'roof replacement'], 'B'

    # Foundation
    if 'foundation' in desc_lower:
        return 'foundation', ['foundation repair'], 'B'

    # HVAC
    if any(x in desc_lower for x in ['hvac', 'air condition', 'heating', 'furnace', 'a/c']):
        return 'hvac', ['hvac'], 'B'

    # Electrical
    if any(x in desc_lower for x in ['electric', 'electrical', 'wiring', 'panel']):
        return 'electrical', ['electrical'], 'C'

    # Plumbing
    if any(x in desc_lower for x in ['plumb', 'pipe', 'water heater', 'sewer']):
        return 'plumbing', ['plumbing'], 'C'

    # Remodel/addition
    if any(x in desc_lower for x in ['remodel', 'addition', 'renovation', 'alteration']):
        return 'remodel', ['remodel'], 'B'

    # New construction
    if any(x in desc_lower for x in ['new construction', 'new home', 'new build']):
        return 'new construction', ['new build'], 'A'

    # Commercial - lower priority
    if ptype in ['CO', 'SI'] or any(x in desc_lower for x in ['commercial', 'business', 'office', 'retail']):
        return 'commercial', ['commercial'], 'D'

    # Default
    return 'residential', ['general permit'], 'C'


class Command(BaseCommand):
    help = 'Import leads from CSV file'

    def add_arguments(self, parser):
        parser.add_argument('csv_file', type=str, help='Path to CSV file')
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be imported without making changes'
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=None,
            help='Limit number of rows to import'
        )

    def handle(self, *args, **options):
        csv_file = options['csv_file']
        dry_run = options['dry_run']
        limit = options['limit']

        self.stdout.write(f"Importing from: {csv_file}")
        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN - no changes will be made'))

        # Track stats
        stats = {
            'permits_created': 0,
            'permits_updated': 0,
            'properties_created': 0,
            'leads_created': 0,
            'skipped': 0,
            'errors': 0,
            'by_tier': {'A': 0, 'B': 0, 'C': 0, 'D': 0},
            'by_city': {},
        }

        try:
            with open(csv_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                rows = list(reader)

                if limit:
                    rows = rows[:limit]

                total = len(rows)
                self.stdout.write(f"Found {total} rows to process...")

                for i, row in enumerate(rows, 1):
                    if i % 1000 == 0:
                        self.stdout.write(f"  Processing {i}/{total}...")

                    try:
                        self.process_row(row, dry_run, stats)
                    except Exception as e:
                        stats['errors'] += 1
                        if stats['errors'] <= 10:
                            self.stderr.write(f"  Error row {i}: {e}")

            # Summary
            self.stdout.write('\n' + '=' * 50)
            self.stdout.write(self.style.SUCCESS(f"Permits created: {stats['permits_created']}"))
            self.stdout.write(f"Permits updated: {stats['permits_updated']}")
            self.stdout.write(f"Properties created: {stats['properties_created']}")
            self.stdout.write(self.style.SUCCESS(f"Leads created: {stats['leads_created']}"))
            self.stdout.write(f"Skipped: {stats['skipped']}")
            self.stdout.write(self.style.WARNING(f"Errors: {stats['errors']}"))

            self.stdout.write('\nBy Tier:')
            for tier, count in sorted(stats['by_tier'].items()):
                self.stdout.write(f"  {tier}: {count}")

            self.stdout.write('\nBy City (top 10):')
            sorted_cities = sorted(stats['by_city'].items(), key=lambda x: -x[1])[:10]
            for city, count in sorted_cities:
                self.stdout.write(f"  {city}: {count}")

            if not dry_run and stats['leads_created'] > 0:
                self.stdout.write(self.style.SUCCESS(
                    f'\nRun "python manage.py enrich_cad" to enrich new leads'
                ))

        except Exception as e:
            import traceback
            self.stderr.write(self.style.ERROR(f'Import failed: {e}'))
            traceback.print_exc()

    def process_row(self, row, dry_run, stats):
        """Process a single CSV row."""
        # Extract fields - handle various column name formats
        city = row.get('City', row.get('city', '')).strip().lower()
        permit_id = row.get('Permit_ID', row.get('permit_id', row.get('PermitID', ''))).strip()
        permit_type = row.get('Permit_Type', row.get('permit_type', row.get('PermitType', ''))).strip()
        date_str = row.get('Date', row.get('date', row.get('IssueDate', ''))).strip()
        address = row.get('Address', row.get('address', row.get('PropertyAddress', ''))).strip()
        contractor = row.get('Contractor_Name', row.get('contractor_name', '')).strip()
        business = row.get('Business_Name', row.get('business_name', '')).strip()
        description = row.get('Description', row.get('description', '')).strip()
        value_str = row.get('Value', row.get('value', row.get('EstimatedValue', '0'))).strip()

        # Skip if no address
        if not address:
            stats['skipped'] += 1
            return

        # Parse date
        issued_date = None
        if date_str:
            try:
                # Try various formats
                for fmt in ['%Y-%m-%d %H:%M:%S%z', '%Y-%m-%d %H:%M:%S+00:00', '%Y-%m-%d', '%m/%d/%Y']:
                    try:
                        issued_date = datetime.strptime(date_str.split('+')[0].strip(), fmt.split('+')[0])
                        break
                    except:
                        continue
            except:
                pass

        # Parse value
        try:
            value = Decimal(str(value_str).replace(',', '').replace('$', ''))
        except:
            value = None

        # Normalize address - add city/state if not present
        full_address = normalize_address(address)
        if full_address and ',' not in full_address:
            city_name = city.replace('_', ' ').title()
            full_address = f"{full_address}, {city_name} TX"

        # Categorize the permit
        lead_type, lead_subtypes, tier = categorize_permit(permit_type, description)

        # Track stats
        stats['by_tier'][tier] = stats['by_tier'].get(tier, 0) + 1
        stats['by_city'][city] = stats['by_city'].get(city, 0) + 1

        if dry_run:
            return

        # Create/update permit
        permit, created = Permit.objects.update_or_create(
            city=city,
            permit_id=permit_id,
            defaults={
                'property_address': full_address,
                'permit_type': permit_type,
                'description': description,
                'contractor_name': contractor or business or None,
                'issued_date': issued_date,
                'estimated_value': value,
                'lead_type': lead_type,
                'lead_subtypes': lead_subtypes,
                'scraped_at': timezone.now(),
            }
        )

        if created:
            stats['permits_created'] += 1
        else:
            stats['permits_updated'] += 1

        # Create property if not exists
        prop, prop_created = Property.objects.get_or_create(
            property_address=full_address,
            defaults={
                'enrichment_status': 'pending',
            }
        )

        if prop_created:
            stats['properties_created'] += 1

        # Create lead
        lead_id = str(uuid.uuid4())[:8]
        lead, lead_created = Lead.objects.get_or_create(
            property=prop,
            lead_type=lead_type,
            defaults={
                'lead_id': lead_id,
                'lead_subtypes': lead_subtypes,
                'tier': tier,
                'permit_date': issued_date,
                'status': 'new',
            }
        )

        if lead_created:
            stats['leads_created'] += 1
