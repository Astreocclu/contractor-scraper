"""
Django management command to import data from the Scraper project's SQLite database.

Usage:
    python manage.py import_scraper_data --db /home/reid/Scraper/data/leads.db
    python manage.py import_scraper_data --db /home/reid/Scraper/data/leads.db --dry-run
"""

import sqlite3
import logging
from datetime import datetime
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from clients.models import Permit, Property, Lead, ScraperRun, NeighborhoodMedian


class Command(BaseCommand):
    help = 'Import data from Scraper project SQLite database'

    def add_arguments(self, parser):
        parser.add_argument(
            '--db',
            type=str,
            default='/home/reid/Scraper/data/leads.db',
            help='Path to Scraper SQLite database'
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be imported without making changes'
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Enable verbose logging'
        )

    def handle(self, *args, **options):
        db_path = options['db']
        dry_run = options['dry_run']
        verbose = options['verbose']

        log_level = logging.DEBUG if verbose else logging.INFO
        logging.basicConfig(level=log_level)

        self.stdout.write(f"Importing from: {db_path}")

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN - no changes will be made'))

        try:
            conn = sqlite3.connect(db_path)
            # Use dict factory instead of Row for easier access
            conn.row_factory = lambda c, r: dict(zip([col[0] for col in c.description], r))

            # Import in order: permits, properties, leads, scraper_runs
            self.import_permits(conn, dry_run)
            self.import_properties(conn, dry_run)
            self.import_leads(conn, dry_run)
            self.import_scraper_runs(conn, dry_run)
            self.import_neighborhood_medians(conn, dry_run)

            conn.close()

            self.stdout.write(self.style.SUCCESS('✓ Import complete!'))

        except Exception as e:
            import traceback
            self.stderr.write(self.style.ERROR(f'Import failed: {e}'))
            traceback.print_exc()

    def import_permits(self, conn, dry_run):
        """Import permits from the Scraper database."""
        cursor = conn.execute("SELECT * FROM permits")
        rows = cursor.fetchall()

        self.stdout.write(f"Found {len(rows)} permits to import...")

        imported = 0
        for row in rows:
            try:
                if not dry_run:
                    Permit.objects.update_or_create(
                        city=row['city'],
                        permit_id=row['permit_id'],
                        defaults={
                            'property_address': row['property_address'] or '',
                            'property_address_normalized': row['property_address_normalized'],
                            'city_name': row['city_name'],
                            'zip_code': row['zip_code'],
                            'permit_type': row['permit_type'],
                            'description': row['description'],
                            'status': row['status'],
                            'issued_date': self.parse_date(row['issued_date']),
                            'applicant_name': row['applicant_name'],
                            'contractor_name': row['contractor_name'],
                            'estimated_value': self.parse_decimal(row['estimated_value']),
                            'lead_type': row['lead_type'],
                            'lead_subtypes': self.parse_json(row['lead_subtypes']),
                            'categorization_confidence': row['categorization_confidence'],
                            'scraped_at': self.parse_datetime(row['scraped_at']) or timezone.now(),
                        }
                    )
                imported += 1
            except Exception as e:
                self.stderr.write(f"  Error importing permit {row['permit_id']}: {e}")

        self.stdout.write(self.style.SUCCESS(f"  ✓ Imported {imported} permits"))

    def import_properties(self, conn, dry_run):
        """Import properties from the Scraper database."""
        cursor = conn.execute("SELECT * FROM properties")
        rows = cursor.fetchall()

        self.stdout.write(f"Found {len(rows)} properties to import...")

        imported = 0
        for row in rows:
            try:
                if not dry_run:
                    Property.objects.update_or_create(
                        property_address=row['property_address'],
                        defaults={
                            'property_address_normalized': row['property_address_normalized'],
                            'cad_account_id': row['cad_account_id'],
                            'county': row['county'],
                            'owner_name': row['owner_name'],
                            'mailing_address': row['mailing_address'],
                            'mailing_address_normalized': row['mailing_address_normalized'],
                            'market_value': self.parse_decimal(row['market_value']),
                            'land_value': self.parse_decimal(row['land_value']),
                            'improvement_value': self.parse_decimal(row['improvement_value']),
                            'year_built': row['year_built'],
                            'square_feet': row['square_feet'],
                            'lot_size': self.parse_decimal(row['lot_size']),
                            'property_type': row['property_type'],
                            'neighborhood_code': row['neighborhood_code'],
                            'neighborhood_median': self.parse_decimal(row['neighborhood_median']),
                            'is_absentee': bool(row['is_absentee']),
                            'homestead_exempt': bool(row['homestead_exempt']),
                            'enrichment_status': row['enrichment_status'] or 'pending',
                            'enriched_at': self.parse_datetime(row['enriched_at']),
                        }
                    )
                imported += 1
            except Exception as e:
                self.stderr.write(f"  Error importing property {row['property_address']}: {e}")

        self.stdout.write(self.style.SUCCESS(f"  ✓ Imported {imported} properties"))

    def import_leads(self, conn, dry_run):
        """Import leads from the Scraper database."""
        cursor = conn.execute("SELECT * FROM leads")
        rows = cursor.fetchall()

        self.stdout.write(f"Found {len(rows)} leads to import...")

        imported = 0
        skipped = 0
        for row in rows:
            try:
                # Need to have property first
                property_address = row['property_address']
                try:
                    prop = Property.objects.get(property_address=property_address)
                except Property.DoesNotExist:
                    # Create placeholder property
                    if not dry_run:
                        prop = Property.objects.create(
                            property_address=property_address,
                            enrichment_status='pending'
                        )
                    else:
                        skipped += 1
                        continue

                if not dry_run:
                    Lead.objects.update_or_create(
                        lead_id=row['lead_id'],
                        defaults={
                            'property': prop,
                            'lead_type': row['lead_type'],
                            'lead_subtypes': self.parse_json(row['lead_subtypes']),
                            'is_high_contrast': bool(row['is_high_contrast']),
                            'contrast_ratio': row['contrast_ratio'],
                            'is_absentee': bool(row['is_absentee']),
                            'score': row['score'],
                            'score_breakdown': self.parse_json(row['score_breakdown']),
                            'tier': row['tier'],
                            'permit_date': self.parse_date(row['permit_date']),
                            'days_since_permit': row['days_since_permit'],
                            'freshness_tier': row['freshness_tier'],
                            'status': row['status'] or 'new',
                        }
                    )
                imported += 1
            except Exception as e:
                self.stderr.write(f"  Error importing lead {row['lead_id']}: {e}")

        self.stdout.write(self.style.SUCCESS(f"  ✓ Imported {imported} leads (skipped {skipped})"))

    def import_scraper_runs(self, conn, dry_run):
        """Import scraper runs from the Scraper database."""
        try:
            cursor = conn.execute("SELECT * FROM scraper_runs")
            rows = cursor.fetchall()
        except:
            self.stdout.write("  No scraper_runs table found, skipping...")
            return

        self.stdout.write(f"Found {len(rows)} scraper runs to import...")

        imported = 0
        for row in rows:
            try:
                if not dry_run:
                    ScraperRun.objects.create(
                        city=row['city'],
                        started_at=self.parse_datetime(row['started_at']) or timezone.now(),
                        completed_at=self.parse_datetime(row['completed_at']),
                        status=row['status'] or 'success',
                        permits_found=row['permits_found'] or 0,
                        errors=self.parse_json(row['errors']),
                    )
                imported += 1
            except Exception as e:
                self.stderr.write(f"  Error importing scraper run: {e}")

        self.stdout.write(self.style.SUCCESS(f"  ✓ Imported {imported} scraper runs"))

    def import_neighborhood_medians(self, conn, dry_run):
        """Import neighborhood medians from the Scraper database."""
        try:
            cursor = conn.execute("SELECT * FROM neighborhood_medians")
            rows = cursor.fetchall()
        except:
            self.stdout.write("  No neighborhood_medians table found, skipping...")
            return

        self.stdout.write(f"Found {len(rows)} neighborhood medians to import...")

        imported = 0
        for row in rows:
            try:
                if not dry_run:
                    NeighborhoodMedian.objects.update_or_create(
                        neighborhood_code=row['neighborhood_code'],
                        defaults={
                            'county': row['county'],
                            'median_value': self.parse_decimal(row['median_value']),
                            'property_count': row['property_count'],
                        }
                    )
                imported += 1
            except Exception as e:
                self.stderr.write(f"  Error importing neighborhood median: {e}")

        self.stdout.write(self.style.SUCCESS(f"  ✓ Imported {imported} neighborhood medians"))

    def parse_date(self, value):
        """Parse date string to date object."""
        if not value:
            return None
        try:
            if isinstance(value, str):
                return datetime.fromisoformat(value.replace('Z', '+00:00')).date()
            return value
        except:
            return None

    def parse_datetime(self, value):
        """Parse datetime string to datetime object."""
        if not value:
            return None
        try:
            if isinstance(value, str):
                dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
                if dt.tzinfo is None:
                    return timezone.make_aware(dt)
                return dt
            return value
        except:
            return None

    def parse_decimal(self, value):
        """Parse value to Decimal."""
        if value is None:
            return None
        try:
            return Decimal(str(value))
        except:
            return None

    def parse_json(self, value):
        """Parse JSON string to object."""
        if not value:
            return None
        try:
            import json
            if isinstance(value, str):
                return json.loads(value)
            return value
        except:
            return None
