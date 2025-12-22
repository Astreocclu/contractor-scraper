#!/usr/bin/env python3
"""
Sync lien data from contractor_raw_data to county_lien_records table.

The collection service stores lien data in contractor_raw_data.structured_data,
but the county_lien_records table stays empty. This script syncs them.

Usage:
    python3 bin/sync_liens_to_db.py           # Sync all
    python3 bin/sync_liens_to_db.py --id 39   # Sync specific contractor
"""

import os
import sys
import json
import argparse
from datetime import datetime
from decimal import Decimal

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from django.db import connection
from contractors.models import CountyLienRecord


def sync_contractor_liens(contractor_id: int = None, verbose: bool = True) -> dict:
    """
    Sync lien records from contractor_raw_data to county_lien_records.

    Returns:
        Dict with sync statistics
    """
    stats = {'synced': 0, 'skipped': 0, 'errors': 0, 'contractors': 0}

    with connection.cursor() as cursor:
        # Get lien data from contractor_raw_data
        query = """
            SELECT r.contractor_id, c.business_name, r.structured_data
            FROM contractor_raw_data r
            JOIN contractors_contractor c ON r.contractor_id = c.id
            WHERE r.source_name = 'county_liens'
              AND r.structured_data IS NOT NULL
        """
        if contractor_id:
            query += f" AND r.contractor_id = {contractor_id}"

        cursor.execute(query)
        rows = cursor.fetchall()

    if verbose:
        print(f"Found {len(rows)} contractors with lien data to sync")

    for cid, name, data_str in rows:
        try:
            data = json.loads(data_str) if isinstance(data_str, str) else data_str

            # Records are nested inside counties.[county_name].records
            records = []
            counties_data = data.get('counties', {})
            for county_name, county_info in counties_data.items():
                if isinstance(county_info, dict) and 'records' in county_info:
                    for rec in county_info['records']:
                        rec['county'] = county_name  # Ensure county is set
                        records.append(rec)

            if not records:
                continue

            stats['contractors'] += 1

            if verbose:
                print(f"\n  [{cid}] {name}: {len(records)} records")

            for rec in records:
                try:
                    # Build unique key
                    county = rec.get('county', 'Unknown')
                    instrument = rec.get('instrument_number', rec.get('id', f"UNK-{cid}-{stats['synced']}"))

                    # Check if already exists
                    existing = CountyLienRecord.objects.filter(
                        county=county,
                        instrument_number=instrument
                    ).first()

                    if existing:
                        # Update contractor link if missing
                        if not existing.matched_contractor_id:
                            existing.matched_contractor_id = cid
                            existing.save()
                        stats['skipped'] += 1
                        continue

                    # Parse filing date
                    filing_date = rec.get('filing_date')
                    if filing_date:
                        if isinstance(filing_date, str):
                            # Handle various date formats
                            for fmt in ['%Y-%m-%d', '%m/%d/%Y', '%Y-%m-%dT%H:%M:%S']:
                                try:
                                    filing_date = datetime.strptime(filing_date.split('T')[0], fmt.split('T')[0]).date()
                                    break
                                except:
                                    pass
                            else:
                                filing_date = None

                    # Parse amount
                    amount = rec.get('amount')
                    if amount:
                        try:
                            amount = Decimal(str(amount).replace(',', '').replace('$', ''))
                        except:
                            amount = None

                    # Determine direction (against or by contractor)
                    direction = rec.get('direction', 'unclear')
                    doc_type = rec.get('document_type', 'UNKNOWN')

                    # Create record
                    lien = CountyLienRecord(
                        county=county,
                        instrument_number=instrument,
                        document_type=doc_type,
                        grantor=rec.get('grantor', rec.get('creditor', '')),
                        grantee=rec.get('grantee', rec.get('debtor', '')),
                        filing_date=filing_date or datetime.now().date(),
                        amount=amount,
                        has_release=rec.get('status', '').upper() == 'RELEASED',
                        source_url=rec.get('source_url', ''),
                        raw_data=rec,
                        matched_contractor_id=cid,
                        match_confidence='exact' if direction != 'unclear' else 'fuzzy',
                    )
                    lien.save()
                    stats['synced'] += 1

                except Exception as e:
                    if verbose:
                        print(f"    Error syncing record: {e}")
                    stats['errors'] += 1

        except Exception as e:
            if verbose:
                print(f"  Error processing contractor {cid}: {e}")
            stats['errors'] += 1

    return stats


def main():
    parser = argparse.ArgumentParser(description='Sync lien data to county_lien_records table')
    parser.add_argument('--id', type=int, help='Sync specific contractor ID')
    parser.add_argument('--quiet', action='store_true', help='Suppress output')
    args = parser.parse_args()

    print("=" * 60)
    print("  LIEN DATA SYNC: contractor_raw_data -> county_lien_records")
    print("=" * 60)

    # Show current state
    before_count = CountyLienRecord.objects.count()
    print(f"\nBefore sync: {before_count} records in county_lien_records")

    # Run sync
    stats = sync_contractor_liens(args.id, verbose=not args.quiet)

    # Show results
    after_count = CountyLienRecord.objects.count()
    print(f"\n{'=' * 60}")
    print(f"  SYNC COMPLETE")
    print(f"{'=' * 60}")
    print(f"  Contractors processed: {stats['contractors']}")
    print(f"  Records synced:        {stats['synced']}")
    print(f"  Records skipped:       {stats['skipped']} (already exist)")
    print(f"  Errors:                {stats['errors']}")
    print(f"  Total in table now:    {after_count}")
    print()


if __name__ == '__main__':
    main()
