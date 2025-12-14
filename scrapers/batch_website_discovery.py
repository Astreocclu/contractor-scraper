#!/usr/bin/env python3
"""
Batch website discovery via Google Maps.
Finds websites for contractors that don't have one.

Usage:
    python scrapers/batch_website_discovery.py --limit 100
    python scrapers/batch_website_discovery.py --continuous
"""

import subprocess
import json
import os
import sys
import argparse
from datetime import datetime

sys.stdout.reconfigure(line_buffering=True)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')
SCRAPERS_DIR = os.path.dirname(os.path.abspath(__file__))

SKIP_DOMAINS = ['facebook.com', 'instagram.com', 'twitter.com', 'linkedin.com', 'bit.ly']


def get_db_connection():
    return psycopg2.connect(DATABASE_URL)


def get_contractors_without_website(limit=100, offset=0):
    """Get contractors that need website discovery."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, business_name, city, state
        FROM contractors_contractor
        WHERE (website IS NULL OR website = '')
        ORDER BY id
        LIMIT %s OFFSET %s
    """, (limit, offset))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [{'id': r[0], 'name': r[1], 'city': r[2] or 'Fort Worth', 'state': r[3] or 'TX'} for r in rows]


def run_google_maps(name, city, state):
    """Run Google Maps scraper to get website URL."""
    location = f"{city}, {state}"
    cmd = [
        sys.executable,
        os.path.join(SCRAPERS_DIR, 'google_maps.py'),
        name,
        location,
        '--json'
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=90,
            cwd=os.path.dirname(SCRAPERS_DIR)
        )
        output = result.stdout.strip()
        if output:
            start = output.find('{')
            if start >= 0:
                return json.loads(output[start:])
        return {'found': False, 'website': None, 'phone': None}
    except subprocess.TimeoutExpired:
        return {'found': False, 'website': None, 'phone': None, 'error': 'timeout'}
    except json.JSONDecodeError as e:
        return {'found': False, 'website': None, 'phone': None, 'error': f'JSON parse: {e}'}
    except Exception as e:
        return {'found': False, 'website': None, 'phone': None, 'error': str(e)}


def save_website_and_phone(contractor_id, website=None, phone=None):
    """Save discovered website and phone to database."""
    if not website and not phone:
        return

    conn = get_db_connection()
    cur = conn.cursor()

    updates = []
    values = []

    if website:
        updates.append("website = %s")
        values.append(website)
    if phone:
        updates.append("phone = %s")
        values.append(phone)

    values.append(contractor_id)

    cur.execute(f"""
        UPDATE contractors_contractor
        SET {', '.join(updates)}
        WHERE id = %s
    """, values)

    conn.commit()
    cur.close()
    conn.close()


def process_contractor(contractor):
    """Process single contractor through Google Maps."""
    cid = contractor['id']
    name = contractor['name']
    city = contractor['city']
    state = contractor['state']

    result = {
        'id': cid,
        'name': name,
        'website_found': False,
        'phone_found': False,
        'website': None,
        'phone': None
    }

    gm_result = run_google_maps(name, city, state)

    website = gm_result.get('website')
    phone = gm_result.get('phone')

    # Skip social media URLs
    if website and any(d in website.lower() for d in SKIP_DOMAINS):
        website = None

    if website:
        result['website_found'] = True
        result['website'] = website

    if phone:
        result['phone_found'] = True
        result['phone'] = phone

    if website or phone:
        save_website_and_phone(cid, website, phone)

    return result


def main():
    parser = argparse.ArgumentParser(description='Batch website discovery via Google Maps')
    parser.add_argument('--limit', type=int, default=100, help='Number of contractors per batch')
    parser.add_argument('--offset', type=int, default=0, help='Starting offset')
    parser.add_argument('--continuous', action='store_true', help='Run until all processed')
    args = parser.parse_args()

    total_processed = 0
    total_websites = 0
    total_phones = 0
    offset = args.offset

    print(f"\n{'='*60}")
    print(f"  BATCH WEBSITE DISCOVERY (Google Maps)")
    print(f"  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    while True:
        contractors = get_contractors_without_website(args.limit, offset)

        if not contractors:
            print("\n✅ No more contractors to process!")
            break

        print(f"\n📦 Processing batch: offset={offset}, count={len(contractors)}")
        print("-" * 60)

        for i, contractor in enumerate(contractors):
            result = process_contractor(contractor)
            total_processed += 1

            if result['website_found']:
                total_websites += 1
                print(f"  [{offset + i + 1}] ✅ {contractor['name'][:35]:<35} {result['website'][:40]}")
            elif result['phone_found']:
                total_phones += 1
                print(f"  [{offset + i + 1}] 📞 {contractor['name'][:35]:<35} phone only")
            else:
                print(f"  [{offset + i + 1}] ❌ {contractor['name'][:35]:<35} not found")

        print(f"\n  Batch complete. Running totals:")
        print(f"    Processed: {total_processed}")
        print(f"    Websites found: {total_websites} ({100*total_websites/total_processed:.1f}%)")
        print(f"    Phones only: {total_phones}")

        if not args.continuous:
            break

        offset += args.limit

    print(f"\n{'='*60}")
    print(f"  FINAL SUMMARY")
    print(f"{'='*60}")
    print(f"  Total processed: {total_processed}")
    print(f"  Websites found: {total_websites} ({100*total_websites/total_processed:.1f}%)")
    print(f"  Phones found: {total_phones + total_websites}")
    print(f"  Completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
