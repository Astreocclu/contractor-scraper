"""
Django management command to import permit data from JSON files (scraped by etrakit.py, etc.)

Usage:
    python3 manage.py import_json_permits frisco_B_raw.json frisco_E_raw.json frisco_M_raw.json
    python3 manage.py import_json_permits *.json --dry-run
"""

import json
import logging
from datetime import datetime
from pathlib import Path

from django.core.management.base import BaseCommand
from django.utils import timezone

from clients.models import Permit


class Command(BaseCommand):
    help = 'Import permit data from JSON files produced by scrapers'

    def add_arguments(self, parser):
        parser.add_argument(
            'files',
            nargs='+',
            type=str,
            help='JSON files to import (e.g., frisco_B_raw.json)'
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
        files = options['files']
        dry_run = options['dry_run']
        verbose = options['verbose']

        log_level = logging.DEBUG if verbose else logging.INFO
        logging.basicConfig(level=log_level)

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN - no changes will be made'))

        total_imported = 0
        total_skipped = 0
        total_errors = 0

        for file_path in files:
            path = Path(file_path)
            if not path.exists():
                self.stderr.write(self.style.ERROR(f'File not found: {file_path}'))
                continue

            self.stdout.write(f'\nImporting from: {file_path}')
            imported, skipped, errors = self.import_file(path, dry_run, verbose)
            total_imported += imported
            total_skipped += skipped
            total_errors += errors

        self.stdout.write('\n' + '=' * 50)
        self.stdout.write(self.style.SUCCESS(f'TOTAL: {total_imported} imported, {total_skipped} skipped, {total_errors} errors'))

    def import_file(self, path: Path, dry_run: bool, verbose: bool) -> tuple:
        """Import permits from a single JSON file."""
        try:
            with open(path) as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            self.stderr.write(self.style.ERROR(f'  Invalid JSON: {e}'))
            return 0, 0, 1

        # Extract metadata
        source = data.get('source', '')
        portal_type = data.get('portal_type', '')
        scraped_at_str = data.get('scraped_at', '')
        permits = data.get('permits', [])

        # Parse city name from source (e.g., "frisco" -> "Frisco")
        city = source.replace('_', ' ').title() if source else path.stem.split('_')[0].title()

        # Parse scraped_at timestamp
        scraped_at = self.parse_datetime(scraped_at_str) or timezone.now()

        self.stdout.write(f'  City: {city}, Portal: {portal_type}')
        self.stdout.write(f'  Found {len(permits)} permits')

        imported = 0
        skipped = 0
        errors = 0

        for permit_data in permits:
            try:
                permit_id = permit_data.get('permit_id', '').strip()
                if not permit_id:
                    skipped += 1
                    continue

                address = permit_data.get('address', '').strip()
                if not address:
                    skipped += 1
                    continue

                # Map JSON fields to model fields
                defaults = {
                    'property_address': address,
                    'city_name': city,
                    'permit_type': permit_data.get('type', '') or None,
                    'status': permit_data.get('status', '') or None,
                    'issued_date': self.parse_date(permit_data.get('date', '')),
                    'description': permit_data.get('description', '') or None,
                    'contractor_name': permit_data.get('contractor', '') or None,
                    'applicant_name': permit_data.get('owner', '') or None,
                    'scraped_at': scraped_at,
                }

                if not dry_run:
                    Permit.objects.update_or_create(
                        city=city,
                        permit_id=permit_id,
                        defaults=defaults
                    )

                imported += 1

                if verbose:
                    self.stdout.write(f'    {permit_id} | {defaults["permit_type"]} | {address[:40]}')

            except Exception as e:
                self.stderr.write(f'    Error importing {permit_data.get("permit_id", "?")}: {e}')
                errors += 1

        self.stdout.write(self.style.SUCCESS(f'  Imported: {imported}, Skipped: {skipped}, Errors: {errors}'))
        return imported, skipped, errors

    def parse_date(self, value):
        """Parse date string to date object."""
        if not value or not value.strip():
            return None
        try:
            # Try common formats
            for fmt in ['%Y-%m-%d', '%m/%d/%Y', '%m-%d-%Y', '%Y/%m/%d']:
                try:
                    return datetime.strptime(value.strip(), fmt).date()
                except ValueError:
                    continue
            return None
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
