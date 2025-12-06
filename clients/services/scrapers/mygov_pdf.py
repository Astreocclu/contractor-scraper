#!/usr/bin/env python3
"""
DFW Signal Engine - MyGov PDF Report Scraper

Scrapes building permits from MyGov public portals that provide PDF reports.
Supports: Grapevine, Westlake (and other MyGov-based cities)

Strategy:
1. Download PDF reports from the MyGov public portal
2. Parse PDFs using pdftotext
3. Extract permit records
4. Save to database
"""

import sys
import os
import re
import subprocess
import json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from datetime import date, datetime
from typing import List, Dict, Optional, Tuple
import requests

from scripts.utils import (
    ScrapedPermit, setup_logging, save_permit,
    DATA_DIR, log_scraper_run, rate_limit
)

# City configurations
MYGOV_CITIES = {
    "grapevine": {
        "base_url": "https://public.mygov.us/tx_grapevine",
        "city_name": "Grapevine",
        "county": "tarrant",
        # Report IDs for permit data
        "reports": {
            "all_permits_last_month": 415,
            "all_permits_this_month": 423,
        }
    },
    "westlake": {
        "base_url": "https://public.mygov.us/westlake_tx",
        "city_name": "Westlake",
        "county": "tarrant",
        "reports": {
            "building_permits_last_month": 361,
            "building_permits_this_month": 364,
            "building_permits_this_year": 365,
            "new_homes_last_month": 370,
            "new_homes_this_month": 371,
        }
    }
}

logger = setup_logging("scrape", "mygov")


def download_pdf(city: str, report_id: int) -> Optional[Path]:
    """Download a PDF report from MyGov."""
    config = MYGOV_CITIES.get(city)
    if not config:
        logger.error(f"Unknown city: {city}")
        return None

    url = f"{config['base_url']}/downloadReport?moduleName=pi&id={report_id}"

    # Create cache directory
    cache_dir = DATA_DIR / "pdf_cache" / city
    cache_dir.mkdir(parents=True, exist_ok=True)

    pdf_path = cache_dir / f"report_{report_id}_{date.today()}.pdf"

    # Check if already downloaded today
    if pdf_path.exists():
        logger.info(f"Using cached PDF: {pdf_path}")
        return pdf_path

    try:
        logger.info(f"Downloading PDF from {url}")
        response = requests.get(url, timeout=60)
        response.raise_for_status()

        if b'%PDF' not in response.content[:10]:
            logger.warning(f"Response is not a PDF: {response.content[:100]}")
            return None

        with open(pdf_path, 'wb') as f:
            f.write(response.content)

        logger.info(f"Saved PDF to {pdf_path}")
        return pdf_path

    except Exception as e:
        logger.error(f"Failed to download PDF: {e}")
        return None


def pdf_to_text(pdf_path: Path) -> str:
    """Convert PDF to text using pdftotext."""
    try:
        result = subprocess.run(
            ['pdftotext', '-layout', str(pdf_path), '-'],
            capture_output=True,
            text=True,
            timeout=60
        )
        return result.stdout
    except subprocess.TimeoutExpired:
        logger.error(f"pdftotext timed out for {pdf_path}")
        return ""
    except FileNotFoundError:
        logger.error("pdftotext not found. Install with: apt install poppler-utils")
        return ""
    except Exception as e:
        logger.error(f"pdftotext error: {e}")
        return ""


def parse_westlake_pdf(text: str, city_config: dict) -> List[ScrapedPermit]:
    """
    Parse Westlake-style permit PDF.

    The PDF format has columns that span multiple lines:
       25-    The Broadmoor       1500              10/21/2025    3700    $ 13,520.77
       000318 House - Access      Solana
              Control Permit      Blvd., Terrace 6

    Strategy:
    1. Find lines starting with "25-" (year prefix)
    2. Next line has the permit number continuation (e.g., "000318")
    3. Collect data from surrounding lines
    """
    permits = []
    lines = text.split('\n')

    i = 0
    while i < len(lines):
        line = lines[i]

        # Look for permit start: "25-" at start of a field (with possible whitespace)
        # Pattern: whitespace + "25-" + whitespace + permit title
        permit_start = re.search(r'^\s+(\d{2})-\s+(.+?)\s{2,}(\d+)\s', line)

        if permit_start:
            year_prefix = permit_start.group(1)  # "25"
            title_start = permit_start.group(2)  # "The Broadmoor"
            address_num = permit_start.group(3)  # "1500"

            # Look for date in this line
            date_match = re.search(r'(\d{1,2}/\d{1,2}/\d{4})', line)
            issued_date = None
            if date_match:
                try:
                    issued_date = datetime.strptime(date_match.group(1), '%m/%d/%Y').date()
                except ValueError:
                    pass

            # Look for valuation
            value_match = re.search(r'\$\s*([\d,]+(?:\.\d{2})?)', line)
            valuation = None
            if value_match:
                try:
                    valuation = float(value_match.group(1).replace(',', ''))
                except ValueError:
                    pass

            # Next line should have the permit number continuation
            permit_id = None
            if i + 1 < len(lines):
                next_line = lines[i + 1]
                num_match = re.search(r'^\s+(\d{6})\s', next_line)
                if num_match:
                    permit_id = f"{year_prefix}{num_match.group(1)}"

            # Collect address from multiple lines
            address_parts = [address_num]
            for j in range(i + 1, min(i + 6, len(lines))):
                addr_line = lines[j].strip()
                # Stop at next permit or category header
                if re.search(r'^\d{2}-', addr_line) or re.search(r'^[A-Z]{2,}.*\(\d+\)', addr_line):
                    break
                # Look for address continuation (street names like "Solana Blvd")
                if re.search(r'(Blvd|Dr|St|Ave|Rd|Ln|Way|Ct|Cir|Pl|Pkwy)', addr_line, re.I):
                    # Extract the address part
                    addr_match = re.search(r'([A-Za-z\s]+(?:Blvd|Dr|St|Ave|Rd|Ln|Way|Ct|Cir|Pl|Pkwy)[.,]?)', addr_line, re.I)
                    if addr_match:
                        address_parts.append(addr_match.group(1).strip())

            # Determine permit type from title
            full_title = title_start
            permit_type = 'Building'
            type_patterns = [
                (r'Pool', 'Pool'),
                (r'Spa', 'Spa'),
                (r'New Home', 'Residential New'),
                (r'Remodel', 'Remodel'),
                (r'Addition', 'Addition'),
                (r'Fence', 'Fence'),
                (r'Deck', 'Deck'),
                (r'Patio', 'Patio'),
                (r'Access Control', 'Access Control'),
                (r'Commercial', 'Commercial'),
                (r'Demolition', 'Demolition'),
            ]
            for pattern, ptype in type_patterns:
                if re.search(pattern, full_title, re.I):
                    permit_type = ptype
                    break

            # Build address
            address = ' '.join(address_parts).strip()
            if address and len(address) > 3:
                address = re.sub(r'\s+', ' ', address)  # Normalize whitespace

            if permit_id and address:
                permit_data = {
                    'permit_id': permit_id,
                    'address': address,
                    'permit_type': permit_type,
                    'description': full_title,
                    'issued_date': issued_date,
                    'valuation': valuation
                }
                permits.append(create_permit(permit_data, city_config))

        i += 1

    # Fallback: try simpler pattern matching if no permits found
    if not permits:
        permits = parse_westlake_pdf_fallback(text, city_config)

    return permits


def parse_westlake_pdf_fallback(text: str, city_config: dict) -> List[ScrapedPermit]:
    """Fallback parser using simpler pattern matching."""
    permits = []
    lines = text.split('\n')

    current_permit = {}

    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            continue

        # Look for permit number pattern (e.g., "25-000342", "25000342")
        permit_match = re.search(r'\b(\d{2}[-]?\d{6})\b', line)
        if permit_match:
            # Save previous permit if exists
            if current_permit.get('permit_id') and current_permit.get('address'):
                permits.append(create_permit(current_permit, city_config))

            current_permit = {
                'permit_id': permit_match.group(1).replace('-', ''),
                'raw_line': line
            }

            # Try to extract permit type from same line
            type_patterns = [
                (r'Pool', 'Pool'),
                (r'Spa', 'Spa'),
                (r'New Home', 'Residential New'),
                (r'Remodel', 'Remodel'),
                (r'Addition', 'Addition'),
                (r'Fence', 'Fence'),
                (r'Deck', 'Deck'),
                (r'Patio', 'Patio'),
            ]
            for pattern, ptype in type_patterns:
                if re.search(pattern, line, re.I):
                    current_permit['permit_type'] = ptype
                    break

            if 'permit_type' not in current_permit:
                current_permit['permit_type'] = 'Building'

        # Look for address (typically after permit number)
        if current_permit.get('permit_id') and not current_permit.get('address'):
            # Address pattern: number + street name
            addr_match = re.search(r'\b(\d+\s+[A-Z][A-Za-z\s]+(?:St|Dr|Ln|Rd|Blvd|Ave|Way|Ct|Cir|Pl|Pkwy)[.,]?)\b', line)
            if addr_match:
                current_permit['address'] = addr_match.group(1).strip()

        # Look for date (MM/DD/YYYY format)
        if current_permit.get('permit_id'):
            date_match = re.search(r'(\d{1,2}/\d{1,2}/\d{4})', line)
            if date_match and not current_permit.get('issued_date'):
                try:
                    current_permit['issued_date'] = datetime.strptime(
                        date_match.group(1), '%m/%d/%Y'
                    ).date()
                except ValueError:
                    pass

        # Look for valuation
        if current_permit.get('permit_id'):
            value_match = re.search(r'\$\s*([\d,]+(?:\.\d{2})?)', line)
            if value_match and not current_permit.get('valuation'):
                try:
                    current_permit['valuation'] = float(
                        value_match.group(1).replace(',', '')
                    )
                except ValueError:
                    pass

    # Save last permit
    if current_permit.get('permit_id') and current_permit.get('address'):
        permits.append(create_permit(current_permit, city_config))

    return permits


def parse_grapevine_pdf(text: str, city_config: dict) -> List[ScrapedPermit]:
    """
    Parse Grapevine-style permit PDF.

    Grapevine format:
    - Columns: PERMIT NUMBER | TITLE | DESCRIPTION | ADDRESS | DATES | VALUATION
    - Address is around column position 53-70
    - Multi-line entries span several lines
    """
    permits = []
    lines = text.split('\n')

    i = 0
    while i < len(lines):
        line = lines[i]

        # Look for permit start: "25-" followed by permit title
        permit_start = re.search(r'^\s+(\d{2})-\s+(.+?)\s{2,}', line)

        if permit_start:
            year_prefix = permit_start.group(1)  # "25"
            title_start = permit_start.group(2).strip()

            # Get permit number from next line
            permit_id = None
            if i + 1 < len(lines):
                next_line = lines[i + 1]
                num_match = re.search(r'^\s+(\d{6})\s', next_line)
                if num_match:
                    permit_id = f"{year_prefix}{num_match.group(1)}"

            # Extract address using column position (typically chars 53-75)
            # First try to find address in the main line
            address = None

            # Look for specific address patterns with street suffixes
            # Pattern: number + words + street suffix
            addr_pattern = r'(\d+\s+(?:[A-Z][a-z]+\s+)*(?:N|S|E|W|North|South|East|West)?\s*(?:[A-Z][a-z]+\s+)*(?:St|Dr|Ln|Rd|Blvd|Ave|Way|Ct|Cir|Pl|Pkwy|Hwy)[.,]?)'

            # Search in the line after column ~50
            if len(line) > 50:
                line_section = line[45:]
                addr_match = re.search(addr_pattern, line_section, re.I)
                if addr_match:
                    address = addr_match.group(1).strip()

            # If not found, look in subsequent lines
            if not address:
                for j in range(i, min(i + 5, len(lines))):
                    check_line = lines[j]
                    if len(check_line) > 50:
                        line_section = check_line[45:85] if len(check_line) > 85 else check_line[45:]
                        addr_match = re.search(addr_pattern, line_section, re.I)
                        if addr_match:
                            address = addr_match.group(1).strip()
                            break

            # Clean up address
            if address:
                address = re.sub(r'\s+', ' ', address)
                # Remove trailing numbers that might be dates
                address = re.sub(r'\s+\d{1,2}/\d{1,2}/\d{4}.*$', '', address)

            # Look for dates (MM/DD/YYYY format)
            date_matches = re.findall(r'(\d{1,2}/\d{1,2}/\d{4})', line)
            issued_date = None
            if len(date_matches) >= 2:
                try:
                    issued_date = datetime.strptime(date_matches[1], '%m/%d/%Y').date()
                except ValueError:
                    pass
            elif date_matches:
                try:
                    issued_date = datetime.strptime(date_matches[0], '%m/%d/%Y').date()
                except ValueError:
                    pass

            # Look for valuation
            value_match = re.search(r'\$\s*([\d,]+(?:\.\d{2})?)', line)
            valuation = None
            if value_match:
                try:
                    valuation = float(value_match.group(1).replace(',', ''))
                except ValueError:
                    pass

            # Determine permit type from title
            permit_type = 'Building'
            type_patterns = [
                (r'Pool', 'Pool'),
                (r'Spa', 'Spa'),
                (r'New Home|New Residential|Single Family', 'Residential New'),
                (r'Remodel|Alteration', 'Remodel'),
                (r'Addition', 'Addition'),
                (r'Fence', 'Fence'),
                (r'Deck', 'Deck'),
                (r'Patio', 'Patio'),
                (r'Roofing', 'Roofing'),
                (r'Plumbing', 'Plumbing'),
                (r'Electrical', 'Electrical'),
                (r'Sign', 'Sign'),
                (r'HVAC|Mechanical', 'Mechanical'),
                (r'Temporary', 'Temporary Use'),
                (r'Certificate', 'Certificate of Occupancy'),
            ]
            for pattern, ptype in type_patterns:
                if re.search(pattern, title_start, re.I):
                    permit_type = ptype
                    break

            # Validate address - must have a number and street suffix
            if address and permit_id:
                if re.match(r'^\d+\s+', address) and len(address) >= 8:
                    permit_data = {
                        'permit_id': permit_id,
                        'address': address,
                        'permit_type': permit_type,
                        'description': title_start,
                        'issued_date': issued_date,
                        'valuation': valuation
                    }
                    permits.append(create_permit(permit_data, city_config))

        i += 1

    return permits


def create_permit(data: dict, city_config: dict) -> ScrapedPermit:
    """Create a ScrapedPermit from parsed data."""
    city = city_config['city_name'].lower()
    city_name = city_config['city_name']

    address = data.get('address', '')
    if address and city_name not in address:
        address = f"{address}, {city_name} TX"

    return ScrapedPermit(
        permit_id=data.get('permit_id', ''),
        city=city,
        property_address=address,
        permit_type=data.get('permit_type', 'Building'),
        description=data.get('description', ''),
        status='Issued',
        issued_date=data.get('issued_date'),
        estimated_value=data.get('valuation'),
        city_name=city_name,
        scraped_at=datetime.now()
    )


def scrape_city(city: str, report_names: Optional[List[str]] = None) -> List[ScrapedPermit]:
    """Scrape permits for a city from MyGov PDF reports."""
    config = MYGOV_CITIES.get(city)
    if not config:
        logger.error(f"Unknown city: {city}")
        return []

    all_permits = []
    seen_ids = set()

    # Determine which reports to download
    reports_to_fetch = config['reports']
    if report_names:
        reports_to_fetch = {k: v for k, v in reports_to_fetch.items() if k in report_names}

    for report_name, report_id in reports_to_fetch.items():
        logger.info(f"Processing {report_name} (ID: {report_id})")

        # Download PDF
        pdf_path = download_pdf(city, report_id)
        if not pdf_path:
            continue

        # Convert to text
        text = pdf_to_text(pdf_path)
        if not text:
            continue

        # Parse based on city
        if city == 'westlake':
            permits = parse_westlake_pdf(text, config)
        elif city == 'grapevine':
            permits = parse_grapevine_pdf(text, config)
        else:
            permits = parse_westlake_pdf(text, config)  # Default parser

        # Deduplicate
        for permit in permits:
            if permit.permit_id not in seen_ids:
                seen_ids.add(permit.permit_id)
                all_permits.append(permit)

        logger.info(f"  Extracted {len(permits)} permits from {report_name}")
        rate_limit()

    return all_permits


def save_results(city: str, permits: List[ScrapedPermit]):
    """Save permits to JSON and database."""
    if not permits:
        logger.warning(f"No permits to save for {city}")
        return

    # Save to JSON
    raw_dir = DATA_DIR / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    filename = raw_dir / f"{city}_{date.today()}.json"
    with open(filename, 'w') as f:
        json.dump([p.to_dict() for p in permits], f, indent=2, default=str)

    logger.info(f"Saved {len(permits)} permits to {filename}")

    # Save to database
    for permit in permits:
        try:
            save_permit(permit)
        except Exception as e:
            logger.warning(f"Error saving permit {permit.permit_id}: {e}")


def scrape_mygov(cities: Optional[List[str]] = None) -> Dict[str, int]:
    """Scrape permits from all configured MyGov cities."""
    if cities is None:
        cities = list(MYGOV_CITIES.keys())

    results = {}

    for city in cities:
        logger.info(f"Scraping {city}...")
        try:
            permits = scrape_city(city)
            save_results(city, permits)
            results[city] = len(permits)

            status = "success" if permits else "empty"
            log_scraper_run(city, status, len(permits), [])

        except Exception as e:
            logger.error(f"Error scraping {city}: {e}")
            results[city] = 0
            log_scraper_run(city, "failed", 0, [str(e)])

    return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Scrape permits from MyGov PDF reports")
    parser.add_argument("--city", choices=list(MYGOV_CITIES.keys()),
                        help="Specific city to scrape")
    parser.add_argument("--report", help="Specific report name to download")
    parser.add_argument("--list-reports", action="store_true",
                        help="List available reports")
    args = parser.parse_args()

    if args.list_reports:
        for city, config in MYGOV_CITIES.items():
            print(f"\n{city.upper()}:")
            for name, rid in config['reports'].items():
                print(f"  {name}: ID {rid}")
        sys.exit(0)

    cities = [args.city] if args.city else None
    results = scrape_mygov(cities)

    print("\n=== Scrape Results ===")
    for city, count in results.items():
        print(f"  {city}: {count} permits")
