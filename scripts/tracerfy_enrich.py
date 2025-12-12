#!/usr/bin/env python3
"""
Tracerfy Skip Tracing Integration for Contractor Auditor

Enriches contractors with phone/email via Tracerfy API.
Cost: $0.009/lead

Usage:
    python3 scripts/tracerfy_enrich.py --limit 20          # Test with 20 contractors
    python3 scripts/tracerfy_enrich.py                     # Process all contractors without email
    python3 scripts/tracerfy_enrich.py --dry-run           # Show CSV without submitting
"""

import os
import re
import csv
import json
import time
import argparse
import logging
import requests
import psycopg2
from io import StringIO
from datetime import datetime
from typing import Optional, Tuple, List, Dict

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# =============================================================================
# ADDRESS NORMALIZATION (ported from permit-scraper/scripts/score_leads.py)
# =============================================================================

# Unit/apartment indicators to extract
UNIT_PATTERNS = [
    r'\b(apt\.?|apartment)\s*#?\s*(\S+)',
    r'\b(unit)\s*#?\s*(\S+)',
    r'\b(suite)\s*#?\s*(\S+)',
    r'(?<![A-Za-z])(ste\.)\s*#?\s*(\S+)',
    r'\b(bldg\.?|building)\s*#?\s*(\S+)',
    r'\b(fl\.?|floor)\s*#?\s*(\S+)',
    r'\b(rm\.?|room)\s*#?\s*(\S+)',
    r'#\s*(\d+\w*)',
]

# Street suffixes to standardize
STREET_SUFFIX_MAP = {
    'avenue': 'AVE', 'ave': 'AVE', 'av': 'AVE',
    'boulevard': 'BLVD', 'blvd': 'BLVD',
    'circle': 'CIR', 'cir': 'CIR',
    'court': 'CT', 'ct': 'CT',
    'drive': 'DR', 'dr': 'DR',
    'expressway': 'EXPY', 'expy': 'EXPY',
    'freeway': 'FWY', 'fwy': 'FWY',
    'highway': 'HWY', 'hwy': 'HWY',
    'lane': 'LN', 'ln': 'LN',
    'parkway': 'PKWY', 'pkwy': 'PKWY',
    'place': 'PL', 'pl': 'PL',
    'road': 'RD', 'rd': 'RD',
    'street': 'ST', 'st': 'ST', 'str': 'ST',
    'terrace': 'TER', 'ter': 'TER',
    'trail': 'TRL', 'trl': 'TRL',
    'way': 'WAY',
}

# Directional abbreviations
DIRECTIONAL_MAP = {
    'north': 'N', 'n': 'N',
    'south': 'S', 's': 'S',
    'east': 'E', 'e': 'E',
    'west': 'W', 'w': 'W',
    'northeast': 'NE', 'ne': 'NE',
    'northwest': 'NW', 'nw': 'NW',
    'southeast': 'SE', 'se': 'SE',
    'southwest': 'SW', 'sw': 'SW',
}


def normalize_address(raw_address: str, default_city: str = "") -> Dict[str, str]:
    """
    Normalize address to standard format.

    Returns dict with:
        - address: Normalized street address (uppercase, standardized suffixes)
        - unit: Extracted apartment/suite/unit number
        - city: Extracted or default city (Title Case)
        - state: Always "TX"
        - zip: Extracted ZIP code
    """
    if not raw_address:
        return {"address": "", "unit": "", "city": default_city.title(), "state": "TX", "zip": ""}

    addr = raw_address.strip()
    unit = ""
    city = default_city
    zip_code = ""

    # Extract ZIP code (5 or 9 digit)
    zip_match = re.search(r'\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$', addr, re.IGNORECASE)
    if zip_match:
        zip_code = zip_match.group(2)
        addr = addr[:zip_match.start()].strip()
    else:
        zip_match = re.search(r'\s(\d{5})(?:-\d{4})?\s*$', addr)
        if zip_match:
            zip_code = zip_match.group(1)
            addr = addr[:zip_match.start()].strip()

    # Extract city if it follows a comma
    city_match = re.search(r',\s*([A-Za-z\s]+?)(?:,|\s*$)', addr)
    if city_match:
        potential_city = city_match.group(1).strip()
        if potential_city.lower() not in STREET_SUFFIX_MAP:
            city = potential_city
            addr = addr[:city_match.start()]

    # Extract unit/apt/suite
    for pattern in UNIT_PATTERNS:
        match = re.search(pattern, addr, re.IGNORECASE)
        if match:
            if len(match.groups()) >= 2:
                unit = match.group(2).strip()
            else:
                unit = match.group(1).strip()
            addr = addr[:match.start()] + addr[match.end():]
            break

    # Clean up the address
    addr = addr.upper()

    # Standardize street suffixes and directionals
    words = addr.split()
    normalized_words = []
    for word in words:
        word_clean = word.strip('.,;:')
        word_lower = word_clean.lower()

        if word_lower in STREET_SUFFIX_MAP:
            normalized_words.append(STREET_SUFFIX_MAP[word_lower])
        elif word_lower in DIRECTIONAL_MAP:
            normalized_words.append(DIRECTIONAL_MAP[word_lower])
        else:
            normalized_words.append(word_clean)

    # Rebuild address
    addr = ' '.join(normalized_words)
    addr = re.sub(r'[.,;:\s]+$', '', addr)
    addr = re.sub(r'\s+', ' ', addr).strip()

    return {
        "address": addr,
        "unit": unit.upper() if unit else "",
        "city": city.title() if city else "",
        "state": "TX",
        "zip": zip_code,
    }


def normalize_for_matching(addr: str) -> str:
    """Simple normalization for address matching (uppercase, no punctuation)."""
    if not addr:
        return ""
    addr = addr.upper()
    addr = re.sub(r'[,.]', ' ', addr)
    addr = re.sub(r'\s+', ' ', addr).strip()
    return addr


def parse_business_name(name: str) -> Tuple[str, str]:
    """
    Parse business name for Tracerfy lookup.
    Returns (first_name, last_name) - uses business name as last_name.

    For businesses, we use company name since there's no owner name.
    """
    if not name or name.strip() in ("", "Unknown", "None"):
        return ("", "")

    name = name.strip()

    # For businesses, just use the full name as "last name"
    # Tracerfy will search by address + name
    return ("", name)


# =============================================================================
# DATABASE CONNECTION
# =============================================================================

def get_db_connection():
    """Get PostgreSQL connection from DATABASE_URL."""
    url = os.environ.get('DATABASE_URL', 'postgresql://contractors_user:localdev123@localhost/contractors_dev')
    return psycopg2.connect(url)


def get_contractors_for_tracing(conn, limit: Optional[int] = None) -> List[Dict]:
    """
    Fetch contractors that need email enrichment.
    """
    query = """
        SELECT
            id,
            business_name,
            address,
            city,
            state,
            zip_code,
            phone,
            email,
            website
        FROM contractors_contractor
        WHERE is_active = true
          AND (email IS NULL OR email = '')
          AND address IS NOT NULL
          AND address != ''
        ORDER BY trust_score DESC
    """

    if limit:
        query += f" LIMIT {limit}"

    with conn.cursor() as cur:
        cur.execute(query)
        columns = [desc[0] for desc in cur.description]
        rows = cur.fetchall()

    return [dict(zip(columns, row)) for row in rows]


# =============================================================================
# TRACERFY API
# =============================================================================

class TracerfyClient:
    """Client for Tracerfy skip tracing API."""

    BASE_URL = "https://tracerfy.com/v1/api"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

    def transform_contractors_to_csv(self, contractors: List[Dict]) -> str:
        """
        Transform contractors into Tracerfy-ready CSV format.
        Uses smart address normalization to improve match rates.
        """
        output = StringIO()
        writer = csv.writer(output)

        # Header row
        writer.writerow([
            'address', 'city', 'state', 'zip',
            'first_name', 'last_name',
            'mail_address', 'mail_city', 'mail_state', 'mail_zip',
            'contractor_id'  # Keep for merging later
        ])

        for c in contractors:
            # Parse business name (using as identifier)
            first_name, last_name = parse_business_name(c.get('business_name', ''))

            # Normalize address - extracts city/zip if embedded
            raw_address = c.get('address', '') or ''
            default_city = c.get('city', '') or ''
            addr_parts = normalize_address(raw_address, default_city=default_city)

            # Use normalized parts, fall back to DB fields if normalization didn't extract
            street = addr_parts['address'] or raw_address
            city = addr_parts['city'] or default_city
            state = addr_parts['state'] or c.get('state', 'TX') or 'TX'
            zip_code = addr_parts['zip'] or c.get('zip_code', '') or ''

            writer.writerow([
                street,
                city,
                state,
                zip_code,
                first_name,
                last_name,
                street,  # mail_address
                city,    # mail_city
                state,   # mail_state
                zip_code,  # mail_zip
                c.get('id', '')
            ])

        return output.getvalue()

    def submit_trace(self, csv_data: str) -> Dict:
        """
        Submit CSV for skip tracing via multipart form upload.
        Returns: {"queue_id": "...", "status": "pending", ...}
        """
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as f:
            f.write(csv_data)
            temp_path = f.name

        try:
            with open(temp_path, 'rb') as csv_file:
                files = {'csv_file': ('contractors.csv', csv_file, 'text/csv')}
                data = {
                    'address_column': 'address',
                    'city_column': 'city',
                    'state_column': 'state',
                    'zip_column': 'zip',
                    'first_name_column': 'first_name',
                    'last_name_column': 'last_name',
                    'mail_address_column': 'mail_address',
                    'mail_city_column': 'mail_city',
                    'mail_state_column': 'mail_state',
                    'mailing_zip_column': 'mail_zip'
                }

                headers = {"Authorization": f"Bearer {self.api_key}"}

                response = requests.post(
                    f"{self.BASE_URL}/trace/",
                    headers=headers,
                    files=files,
                    data=data,
                    timeout=60
                )
            response.raise_for_status()
            return response.json()
        finally:
            os.unlink(temp_path)

    def get_queues(self) -> List[Dict]:
        """List all queues with retry on temporary errors."""
        for attempt in range(3):
            try:
                response = requests.get(
                    f"{self.BASE_URL}/queues/",
                    headers=self.headers,
                    timeout=30
                )
                response.raise_for_status()
                return response.json()
            except requests.exceptions.HTTPError as e:
                if response.status_code in (502, 503, 504) and attempt < 2:
                    logger.warning(f"Server error {response.status_code}, retrying in 5s...")
                    time.sleep(5)
                else:
                    raise
        return []

    def get_queue(self, queue_id: int) -> Dict:
        """Get individual queue status by filtering from list."""
        queues = self.get_queues()
        for q in queues:
            if q.get('id') == queue_id:
                return q
        return {'pending': True}

    def wait_for_completion(self, queue_id: str, poll_interval: int = 10, max_wait: int = 600) -> Dict:
        """
        Poll queue until completion or timeout.
        """
        start_time = time.time()

        while True:
            elapsed = time.time() - start_time
            if elapsed > max_wait:
                raise TimeoutError(f"Queue {queue_id} did not complete within {max_wait}s")

            queue_data = self.get_queue(queue_id)

            if not queue_data.get('pending', True):
                logger.info(f"Queue {queue_id} completed!")
                return queue_data

            logger.info(f"Queue {queue_id} still pending... ({int(elapsed)}s elapsed)")
            time.sleep(poll_interval)

    def download_results(self, download_url: str) -> List[Dict]:
        """Download traced results from URL (CSV format)."""
        response = requests.get(download_url, timeout=60)
        response.raise_for_status()

        reader = csv.DictReader(StringIO(response.text))
        results = []
        for row in reader:
            phone = row.get('primary_phone') or row.get('Mobile-1') or row.get('Landline-1') or ''
            email = row.get('Email-1') or ''

            results.append({
                'address': row.get('address', ''),
                'first_name': row.get('first_name', ''),
                'last_name': row.get('last_name', ''),
                'phone': phone,
                'email': email,
                'contractor_id': row.get('contractor_id', '')
            })

        return results


# =============================================================================
# MERGE & UPDATE
# =============================================================================

def update_contractors_with_trace_data(conn, trace_results: List[Dict], original_contractors: List[Dict]):
    """
    Update contractor records with phone/email from trace results.
    """
    # Build lookup by contractor_id (most reliable) and normalized address (fallback)
    trace_by_id = {}
    trace_by_addr = {}

    for result in trace_results:
        cid = result.get('contractor_id')
        if cid:
            trace_by_id[str(cid)] = result

        addr = normalize_for_matching(result.get('address', ''))
        if addr:
            trace_by_addr[addr] = result

    updated = 0
    with conn.cursor() as cur:
        for c in original_contractors:
            # Try to match by ID first
            trace_result = trace_by_id.get(str(c.get('id')))

            # Fallback to address matching
            if not trace_result:
                norm_addr = normalize_for_matching(c.get('address', ''))
                trace_result = trace_by_addr.get(norm_addr)

            if not trace_result:
                continue

            phone = trace_result.get('phone', '')
            email = trace_result.get('email', '')

            if email:  # Only update if we got an email (that's what we're after)
                cur.execute("""
                    UPDATE contractors_contractor
                    SET email = %s
                    WHERE id = %s AND (email IS NULL OR email = '')
                """, (email, c.get('id')))

                if cur.rowcount > 0:
                    updated += 1
                    logger.info(f"  Updated {c.get('business_name')}: {email}")

    conn.commit()
    logger.info(f"Updated {updated} contractors with email")
    return updated


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='Tracerfy Skip Tracing for Contractors')
    parser.add_argument('--limit', type=int, help='Limit number of contractors to process')
    parser.add_argument('--dry-run', action='store_true', help='Transform and show CSV without submitting')
    parser.add_argument('--check-queues', action='store_true', help='Check status of pending queues')
    args = parser.parse_args()

    # Get API key
    api_key = os.environ.get('TRACERFY_API_KEY')
    if not api_key and not args.dry_run:
        raise ValueError("TRACERFY_API_KEY environment variable not set")

    conn = get_db_connection()

    try:
        if args.check_queues:
            client = TracerfyClient(api_key)
            queues = client.get_queues()
            print(json.dumps(queues, indent=2))
            return

        # Fetch contractors
        contractors = get_contractors_for_tracing(conn, limit=args.limit)

        if not contractors:
            logger.info("No contractors need email enrichment (all have emails or no addresses)")
            return

        logger.info(f"Found {len(contractors)} contractors to enrich")

        # Calculate cost
        cost = len(contractors) * 0.009
        logger.info(f"Estimated cost: ${cost:.2f}")

        # Transform to CSV
        client = TracerfyClient(api_key or "dry-run-no-key")
        csv_data = client.transform_contractors_to_csv(contractors)

        if args.dry_run:
            print("\n=== TRANSFORMED CSV (first 20 lines) ===")
            lines = csv_data.split('\n')[:20]
            for line in lines:
                print(line)
            print(f"\n... ({len(contractors)} total rows)")
            return

        # Submit to Tracerfy
        logger.info("Submitting to Tracerfy API...")
        result = client.submit_trace(csv_data)
        queue_id = result.get('queue_id')
        logger.info(f"Submitted! Queue ID: {queue_id}")

        # Wait for completion
        logger.info("Waiting for trace completion...")
        queue_data = client.wait_for_completion(queue_id)

        # Get results
        if 'download_url' in queue_data:
            trace_results = client.download_results(queue_data['download_url'])
        elif 'results' in queue_data:
            trace_results = queue_data['results']
        else:
            trace_results = []

        logger.info(f"Received {len(trace_results)} traced records")

        # Update database
        updated = update_contractors_with_trace_data(conn, trace_results, contractors)

        # Summary
        print(f"\n=== TRACERFY ENRICHMENT COMPLETE ===")
        print(f"Contractors processed: {len(contractors)}")
        print(f"Records returned: {len(trace_results)}")
        print(f"Emails updated: {updated}")
        print(f"Cost: ${cost:.2f}")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
