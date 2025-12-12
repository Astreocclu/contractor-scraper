#!/usr/bin/env python3
"""
Batch email discovery pipeline.
Runs Google Maps → Website scraper chain to find and store emails.

Usage:
    python scrapers/batch_email_discovery.py --limit 100
    python scrapers/batch_email_discovery.py --limit 100 --offset 500
    python scrapers/batch_email_discovery.py --continuous  # Run until done
"""

import asyncio
import subprocess
import json
import os
import sys
import argparse
from datetime import datetime

# Unbuffered output
sys.stdout.reconfigure(line_buffering=True)

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')
SCRAPERS_DIR = os.path.dirname(os.path.abspath(__file__))


def get_db_connection():
    """Get database connection."""
    return psycopg2.connect(DATABASE_URL)


def get_contractors_without_email(limit=100, offset=0, no_cache_only=False):
    """Get contractors that need email discovery."""
    conn = get_db_connection()
    cur = conn.cursor()

    if no_cache_only:
        # Prioritize contractors with NO cached data (higher email hit rate)
        cur.execute("""
            SELECT id, business_name, city, state
            FROM contractors_contractor
            WHERE (email IS NULL OR email = '')
            AND id NOT IN (SELECT DISTINCT contractor_id FROM contractor_raw_data)
            ORDER BY id
            LIMIT %s OFFSET %s
        """, (limit, offset))
    else:
        cur.execute("""
            SELECT id, business_name, city, state
            FROM contractors_contractor
            WHERE (email IS NULL OR email = '')
            ORDER BY id
            LIMIT %s OFFSET %s
        """, (limit, offset))

    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [{'id': r[0], 'name': r[1], 'city': r[2], 'state': r[3] or 'TX'} for r in rows]


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
        # Parse full JSON output (may span multiple lines)
        output = result.stdout.strip()
        if output:
            # Find the JSON object in output
            start = output.find('{')
            if start >= 0:
                return json.loads(output[start:])
        return {'found': False, 'website': None, 'email': None}
    except subprocess.TimeoutExpired:
        return {'found': False, 'website': None, 'email': None, 'error': 'timeout'}
    except json.JSONDecodeError as e:
        return {'found': False, 'website': None, 'email': None, 'error': f'JSON parse: {e}'}
    except Exception as e:
        return {'found': False, 'website': None, 'email': None, 'error': str(e)}


def run_website_scraper(url):
    """Run website scraper to get email."""
    if not url:
        return {'email': None, 'source': None, 'error': 'No URL'}

    # Skip social media / non-business URLs
    skip_domains = ['facebook.com', 'instagram.com', 'twitter.com', 'linkedin.com', 'bit.ly', 'tinyurl.com']
    if any(d in url.lower() for d in skip_domains):
        return {'email': None, 'source': None, 'error': 'Social media URL'}

    cmd = ['node', os.path.join(SCRAPERS_DIR, 'website_scraper.js'), url]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=45,
            cwd=os.path.dirname(SCRAPERS_DIR)
        )
        return json.loads(result.stdout.strip())
    except subprocess.TimeoutExpired:
        return {'email': None, 'source': None, 'error': 'timeout'}
    except Exception as e:
        return {'email': None, 'source': None, 'error': str(e)}


def guess_email_from_domain(url):
    """Guess common email patterns from website domain."""
    if not url:
        return None

    import re
    from urllib.parse import urlparse

    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()

        # Remove www. prefix
        if domain.startswith('www.'):
            domain = domain[4:]

        # Skip if not a real domain
        if not domain or '.' not in domain:
            return None

        # Skip generic/platform domains
        skip = ['wix.com', 'squarespace.com', 'weebly.com', 'godaddy.com', 'wordpress.com']
        if any(s in domain for s in skip):
            return None

        # Common email prefixes (in order of likelihood based on our data)
        prefixes = ['info', 'contact', 'sales', 'office', 'hello', 'admin', 'service']

        # Return most likely guess: info@domain
        return f"info@{domain}"

    except Exception:
        return None


def save_email(contractor_id, email, source=None, website=None):
    """Save discovered email to database."""
    conn = get_db_connection()
    cur = conn.cursor()

    # Update contractor email
    cur.execute("""
        UPDATE contractors_contractor
        SET email = %s, website = COALESCE(website, %s)
        WHERE id = %s AND (email IS NULL OR email = '')
    """, (email, website, contractor_id))

    conn.commit()
    cur.close()
    conn.close()


def save_website(contractor_id, website):
    """Save discovered website (even if no email found)."""
    if not website:
        return
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        UPDATE contractors_contractor
        SET website = %s
        WHERE id = %s AND (website IS NULL OR website = '')
    """, (website, contractor_id))
    conn.commit()
    cur.close()
    conn.close()


def process_contractor(contractor, guess_emails=False):
    """Process single contractor through the pipeline."""
    cid = contractor['id']
    name = contractor['name']
    city = contractor['city'] or 'Fort Worth'
    state = contractor['state'] or 'TX'

    result = {
        'id': cid,
        'name': name,
        'website_found': False,
        'email_found': False,
        'email': None,
        'website': None,
        'source': None
    }

    # Step 1: Google Maps for website
    gm_result = run_google_maps(name, city, state)
    website = gm_result.get('website')
    gm_email = gm_result.get('email')

    if website:
        result['website_found'] = True
        result['website'] = website
        save_website(cid, website)

    # Check if Google Maps found email directly
    if gm_email:
        result['email_found'] = True
        result['email'] = gm_email
        result['source'] = 'google_maps'
        save_email(cid, gm_email, 'google_maps', website)
        return result

    # Step 2: Website scraper for email
    if website:
        ws_result = run_website_scraper(website)
        email = ws_result.get('email')

        if email:
            result['email_found'] = True
            result['email'] = email
            result['source'] = ws_result.get('source', 'website')
            save_email(cid, email, ws_result.get('source'), website)
            return result

        # Step 3: Guess email from domain if scraping failed
        if guess_emails and not email:
            guessed = guess_email_from_domain(website)
            if guessed:
                result['email_found'] = True
                result['email'] = guessed
                result['source'] = 'guessed'
                save_email(cid, guessed, 'guessed', website)

    return result


def main():
    parser = argparse.ArgumentParser(description='Batch email discovery')
    parser.add_argument('--limit', type=int, default=100, help='Number of contractors per batch')
    parser.add_argument('--offset', type=int, default=0, help='Starting offset')
    parser.add_argument('--continuous', action='store_true', help='Run until all processed')
    parser.add_argument('--no-cache-only', action='store_true', help='Only process contractors without cached data (higher hit rate)')
    parser.add_argument('--guess', action='store_true', help='Guess info@domain when scraping fails')
    args = parser.parse_args()

    total_processed = 0
    total_websites = 0
    total_emails = 0
    offset = args.offset

    print(f"\n{'='*60}")
    print(f"  BATCH EMAIL DISCOVERY")
    print(f"  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    while True:
        contractors = get_contractors_without_email(args.limit, offset, no_cache_only=getattr(args, 'no_cache_only', False))

        if not contractors:
            print("\n✅ No more contractors to process!")
            break

        print(f"\n📦 Processing batch: offset={offset}, count={len(contractors)}")
        print("-" * 50)

        for i, contractor in enumerate(contractors):
            result = process_contractor(contractor, guess_emails=args.guess)
            total_processed += 1

            status = ""
            if result['email_found']:
                total_emails += 1
                source = f" ({result['source']})" if result.get('source') == 'guessed' else ""
                status = f"✅ {result['email']}{source}"
            elif result['website_found']:
                total_websites += 1
                status = f"🌐 website only"
            else:
                status = "❌ not found"

            print(f"  [{offset + i + 1}] {contractor['name'][:40]:<40} {status}")

        # Summary for batch
        print(f"\n  Batch complete. Running totals:")
        print(f"    Processed: {total_processed}")
        print(f"    Emails found: {total_emails} ({100*total_emails/total_processed:.1f}%)")
        print(f"    Websites only: {total_websites}")

        if not args.continuous:
            break

        offset += args.limit

    print(f"\n{'='*60}")
    print(f"  FINAL SUMMARY")
    print(f"{'='*60}")
    print(f"  Total processed: {total_processed}")
    print(f"  Emails found: {total_emails} ({100*total_emails/total_processed:.1f}%)")
    print(f"  Websites found: {total_websites + total_emails}")
    print(f"  Completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
