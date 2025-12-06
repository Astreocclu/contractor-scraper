#!/usr/bin/env python3
"""
DFW Signal Engine - North Richland Hills Permit Scraper

Scrapes building permits from NRH's monthly PDF archives.
URL: https://www.nrhtx.com/Archive.aspx?AMID=95

The NRH website publishes monthly PDF reports of all issued permits.
This scraper downloads the PDFs and extracts permit data.

Archive contains 25 months of data (Nov 2023 - present).
"""

import sys
import json
import re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from datetime import date, datetime
from typing import List, Dict, Optional
from playwright.sync_api import sync_playwright
import pdfplumber

from scripts.utils import (
    ScrapedPermit, rate_limit, setup_logging, save_permit,
    DATA_DIR, log_scraper_run
)

# Configuration
CITY = "north_richland_hills"
CITY_NAME = "North Richland Hills"
ARCHIVE_URL = "https://www.nrhtx.com/Archive.aspx?AMID=95"
MONTHS_TO_SCRAPE = 3  # How many months back to scrape

# Target permit types for lead generation
TARGET_PERMIT_PATTERNS = [
    r"pool",
    r"spa",
    r"swim",
    r"patio",
    r"deck",
    r"pergola",
    r"shade.?structure",
    r"accessory.?structure",
    r"new.?(residential|building|construction|single.?family)",
    r"addition",
    r"fence",
    r"remodel",
]

logger = setup_logging("scrape", CITY)


def get_archive_links(months: int = MONTHS_TO_SCRAPE) -> List[Dict]:
    """
    Get archive PDF links from NRH website.

    Returns list of dicts with 'month', 'year', 'url' keys.
    """
    archives = []

    logger.info(f"Getting archive links for last {months} months...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(ARCHIVE_URL, timeout=60000)
        page.wait_for_timeout(3000)

        # Find all month links
        all_links = page.query_selector_all('a')
        month_pattern = re.compile(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})')

        for link in all_links:
            try:
                text = link.inner_text().strip()
                href = link.get_attribute('href') or ''

                match = month_pattern.match(text)
                if match and 'ADID=' in href:
                    month_name = match.group(1)
                    year = int(match.group(2))

                    archives.append({
                        'month': month_name,
                        'year': year,
                        'text': text,
                        'href': href
                    })
            except:
                pass

        browser.close()

    logger.info(f"Found {len(archives)} archive entries")

    # Return only the requested number of months
    return archives[:months]


def download_pdf(archive: Dict, download_dir: Path) -> Optional[Path]:
    """
    Download a permit archive PDF.

    Returns path to downloaded file or None on failure.
    """
    filename = f"nrh_{archive['month']}_{archive['year']}.pdf"
    pdf_path = download_dir / filename

    # Check if already downloaded
    if pdf_path.exists():
        logger.info(f"PDF already exists: {pdf_path}")
        return pdf_path

    logger.info(f"Downloading {archive['text']}...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()

        try:
            # Go to archive page
            page.goto(ARCHIVE_URL, timeout=60000)
            page.wait_for_timeout(3000)

            # Find and click the month link
            link = page.query_selector(f'a:has-text("{archive["text"]}")')
            if not link:
                logger.error(f"Could not find link for {archive['text']}")
                browser.close()
                return None

            # Click and wait for download
            with page.expect_download(timeout=60000) as download_info:
                link.click()

            download = download_info.value
            download.save_as(str(pdf_path))
            logger.info(f"Saved: {pdf_path}")

        except Exception as e:
            logger.error(f"Download error: {e}")
            browser.close()
            return None

        browser.close()

    return pdf_path


def parse_pdf(pdf_path: Path) -> List[Dict]:
    """
    Parse permit data from a PDF.

    Returns list of permit dicts.
    """
    permits = []

    logger.info(f"Parsing {pdf_path.name}...")

    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                text = page.extract_text()
                if not text:
                    continue

                # Parse permits from text
                page_permits = parse_permit_text(text)
                permits.extend(page_permits)

    except Exception as e:
        logger.error(f"PDF parse error: {e}")

    logger.info(f"Extracted {len(permits)} permit records from {pdf_path.name}")
    return permits


def parse_permit_text(text: str) -> List[Dict]:
    """
    Parse permit records from PDF text.

    The PDF format has records like:
    ADDRESS
    PERMIT-ID CITY, STATE ZIP  Permit Type  Status  Date  SqFt  Description  Class  Valuation ...
    """
    permits = []

    # Split into lines
    lines = text.split('\n')

    # Pattern to match permit IDs (e.g., AFS-1125-0628, FENC-1025-1320, POOL-0924-0123)
    permit_id_pattern = re.compile(r'([A-Z]{2,4}-\d{4}-\d{4})')

    # Pattern to match addresses (number + street name + type)
    address_pattern = re.compile(r'^(\d+\s+[A-Z][A-Z\s]+(?:ST|RD|DR|CT|LN|WAY|BLVD|CIR|PL|AVE|TRL|PKWY|CV|RUN|XING|LOOP|CRK|BND|PT))\s*$', re.I)

    current_address = None

    for i, line in enumerate(lines):
        line = line.strip()

        # Check if this line is an address
        addr_match = address_pattern.match(line)
        if addr_match:
            current_address = addr_match.group(1).strip()
            continue

        # Check if line contains a permit ID
        permit_match = permit_id_pattern.search(line)
        if permit_match and current_address:
            permit_id = permit_match.group(1)

            # Extract permit type from ID prefix
            prefix = permit_id.split('-')[0]
            permit_type = infer_permit_type(prefix)

            # Extract date (MM/DD/YYYY pattern)
            date_match = re.search(r'(\d{1,2}/\d{1,2}/\d{4})', line)
            issued_date = date_match.group(1) if date_match else None

            # Extract valuation ($X,XXX.XX pattern)
            val_match = re.search(r'\$([0-9,]+\.?\d*)', line)
            valuation = val_match.group(0) if val_match else None

            # Extract description - text between permit type indicators
            description = extract_description(line, permit_type)

            # Extract status
            status = "Issued" if "Issued" in line else "Complete" if "Complete" in line else "Unknown"

            # Determine work class
            work_class = "Residential" if "Residential" in line else "Commercial" if "Commercial" in line else "Unknown"

            permits.append({
                'permit_id': permit_id,
                'address': current_address,
                'permit_type': permit_type,
                'description': description,
                'issued_date': issued_date,
                'valuation': valuation,
                'status': status,
                'work_class': work_class,
                'raw_line': line[:200]  # For debugging
            })

    return permits


def infer_permit_type(prefix: str) -> str:
    """Infer permit type from NRH permit ID prefix."""
    prefix_map = {
        'POOL': 'Swimming Pool',
        'FENC': 'Fence',
        'ROOF': 'Roofing',
        'MECHR': 'Mechanical (Residential)',
        'MECHC': 'Mechanical (Commercial)',
        'PLMR': 'Plumbing (Residential)',
        'PLMC': 'Plumbing (Commercial)',
        'ELEC': 'Electrical',
        'AFS': 'Fire Sprinkler',
        'FAS': 'Fire Alarm',
        'ACST': 'Accessory Structure',
        'BLDG': 'Building',
        'DEMO': 'Demolition',
        'SIGN': 'Sign',
        'GRAD': 'Grading',
        'SOLR': 'Solar',
    }

    # Try exact match first
    if prefix in prefix_map:
        return prefix_map[prefix]

    # Try partial match
    for key, value in prefix_map.items():
        if prefix.startswith(key):
            return value

    return f"Other ({prefix})"


def extract_description(line: str, permit_type: str) -> str:
    """Extract description from permit line."""
    # Remove common patterns to isolate description
    clean = line

    # Remove permit ID
    clean = re.sub(r'[A-Z]{2,4}-\d{4}-\d{4}', '', clean)

    # Remove city/zip
    clean = re.sub(r'NRH,?\s*TX\s*\d{5}', '', clean)

    # Remove dates
    clean = re.sub(r'\d{1,2}/\d{1,2}/\d{4}', '', clean)

    # Remove valuations
    clean = re.sub(r'\$[0-9,]+\.?\d*', '', clean)

    # Remove status words
    clean = re.sub(r'\b(Issued|Complete|Pending|Approved)\b', '', clean)

    # Remove work class
    clean = re.sub(r'\b(Residential|Commercial|New|Alteration)\b', '', clean)

    # Remove permit type if present
    clean = re.sub(re.escape(permit_type), '', clean, flags=re.I)

    # Clean up whitespace
    clean = re.sub(r'\s+', ' ', clean).strip()

    # Limit length
    if len(clean) > 200:
        clean = clean[:200] + "..."

    return clean


def is_target_permit(permit: Dict) -> bool:
    """Check if permit matches target types for lead generation."""
    # Check permit type
    permit_type = permit.get('permit_type', '').lower()
    description = permit.get('description', '').lower()
    combined = f"{permit_type} {description}"

    # Include both residential and commercial permits

    # Check against target patterns
    for pattern in TARGET_PERMIT_PATTERNS:
        if re.search(pattern, combined, re.I):
            return True

    return False


def convert_to_scraped_permit(permit: Dict) -> ScrapedPermit:
    """Convert parsed permit dict to ScrapedPermit."""
    # Parse date
    issued_date = None
    if permit.get('issued_date'):
        try:
            issued_date = datetime.strptime(permit['issued_date'], '%m/%d/%Y')
        except:
            pass

    # Parse valuation to float
    estimated_value = None
    if permit.get('valuation'):
        try:
            val_str = permit['valuation'].replace('$', '').replace(',', '')
            estimated_value = float(val_str)
        except:
            pass

    # Format address
    address = permit.get('address', '')
    if address and 'NRH' not in address.upper():
        address = f"{address}, North Richland Hills TX"

    return ScrapedPermit(
        permit_id=permit.get('permit_id', ''),
        city=CITY,
        property_address=address,
        permit_type=permit.get('permit_type', ''),
        description=permit.get('description', ''),
        status=permit.get('status', 'Unknown'),
        issued_date=issued_date,
        city_name=CITY_NAME,
        scraped_at=datetime.now(),
        estimated_value=estimated_value,
    )


def scrape_nrh(months: int = MONTHS_TO_SCRAPE) -> List[ScrapedPermit]:
    """Main scraping function for North Richland Hills permits."""
    all_permits = []
    errors = []
    seen_permits = set()

    logger.info(f"Starting NRH PDF archive scrape for last {months} months")

    # Create download directory
    download_dir = DATA_DIR / "pdf_cache" / CITY
    download_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Get archive links
        archives = get_archive_links(months)

        if not archives:
            raise Exception("No archive links found")

        # Process each month
        for archive in archives:
            try:
                # Download PDF
                pdf_path = download_pdf(archive, download_dir)
                if not pdf_path:
                    errors.append(f"Failed to download {archive['text']}")
                    continue

                # Parse PDF
                permits = parse_pdf(pdf_path)

                # Filter and convert permits
                for permit in permits:
                    if permit['permit_id'] in seen_permits:
                        continue
                    seen_permits.add(permit['permit_id'])

                    # Check if target permit type
                    if is_target_permit(permit):
                        scraped = convert_to_scraped_permit(permit)
                        all_permits.append(scraped)

                rate_limit()

            except Exception as e:
                error_msg = f"Error processing {archive['text']}: {e}"
                logger.error(error_msg)
                errors.append(error_msg)

    except Exception as e:
        error_msg = f"Scraper error: {e}"
        logger.error(error_msg)
        errors.append(error_msg)

    # Save results
    save_results(all_permits)

    # Log the run
    status = "success" if not errors else "partial" if all_permits else "failed"
    log_scraper_run(CITY, status, len(all_permits), errors)

    logger.info(f"Scrape complete: {len(all_permits)} target permits found")
    return all_permits


def save_results(permits: List[ScrapedPermit]):
    """Save permits to JSON file and database."""
    if not permits:
        logger.warning("No permits to save")
        return

    # Save to JSON
    raw_dir = DATA_DIR / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    filename = raw_dir / f"{CITY}_{date.today()}.json"
    with open(filename, 'w') as f:
        json.dump([p.to_dict() for p in permits], f, indent=2, default=str)

    logger.info(f"Saved {len(permits)} permits to {filename}")

    # Save to database
    for permit in permits:
        try:
            save_permit(permit)
        except Exception as e:
            logger.warning(f"Error saving permit {permit.permit_id}: {e}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Scrape NRH permit archives')
    parser.add_argument('--months', type=int, default=MONTHS_TO_SCRAPE,
                        help=f'Number of months to scrape (default: {MONTHS_TO_SCRAPE})')
    args = parser.parse_args()

    permits = scrape_nrh(months=args.months)
    print(f"\nScraped {len(permits)} target permits from North Richland Hills")

    if permits:
        print("\nSample permits:")
        for p in permits[:15]:
            print(f"  {p.permit_id}: {p.property_address[:40]}... ({p.permit_type})")
