#!/usr/bin/env python3
"""
DFW Signal Engine - Colleyville Permit Scraper

Scrapes building permits from Colleyville's eTRAKiT portal.
URL: https://crw.colleyville.com/etrakit3/

Strategy:
1. Search for permits by common street patterns
2. Filter results by permit type and date
"""

import sys
import json
import re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from datetime import date, timedelta, datetime
from typing import List, Optional
from playwright.sync_api import sync_playwright, Page, TimeoutError as PlaywrightTimeout
from bs4 import BeautifulSoup

from scripts.utils import (
    ScrapedPermit, rate_limit, setup_logging, save_permit,
    normalize_address, parse_date, DATA_DIR, log_scraper_run
)

# Configuration
CITY = "colleyville"
CITY_NAME = "Colleyville"
ETRAKIT_URL = "https://crw.colleyville.com/etrakit3/"
ETRAKIT_SEARCH_URL = "https://crw.colleyville.com/etrakit3/Search/permit.aspx"
LOOKBACK_DAYS = 90

# Common street prefixes to search for (Colleyville streets)
# This helps us find permits across the city
SEARCH_PATTERNS = [
    "1",  # Addresses starting with 1
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
]

# Permit types we care about
TARGET_PERMIT_TYPES = [
    "pool", "spa", "swim",
    "patio", "deck",
    "new", "addition", "remodel",
    "accessory", "residential"
]

logger = setup_logging("scrape", CITY)


def navigate_to_search(page: Page) -> bool:
    """Navigate to the eTRAKiT search page."""
    try:
        logger.info(f"Navigating to {ETRAKIT_URL}")
        page.goto(ETRAKIT_URL, timeout=60000)
        page.wait_for_load_state("networkidle", timeout=30000)

        # Save debug screenshot
        debug_path = DATA_DIR.parent / "debug" / f"colleyville_etrakit_{date.today()}.html"
        debug_path.parent.mkdir(exist_ok=True)
        with open(debug_path, 'w') as f:
            f.write(page.content())
        logger.info(f"Saved debug HTML to {debug_path}")

        return True
    except Exception as e:
        logger.error(f"Failed to navigate: {e}")
        return False


def explore_etrakit_structure(page: Page) -> dict:
    """
    Explore the eTRAKiT page structure to understand available options.
    Returns dict with findings about the portal.
    """
    findings = {
        'links': [],
        'forms': [],
        'tables': [],
        'permit_search_available': False
    }

    try:
        html = page.content()
        soup = BeautifulSoup(html, 'lxml')

        # Find all links
        for link in soup.find_all('a', href=True):
            href = link.get('href', '')
            text = link.get_text(strip=True)
            if text and 'permit' in text.lower():
                findings['links'].append({'text': text, 'href': href})
                logger.info(f"Found permit link: {text} -> {href}")

        # Check for search forms
        forms = soup.find_all('form')
        for form in forms:
            form_id = form.get('id', 'unknown')
            form_action = form.get('action', '')
            findings['forms'].append({'id': form_id, 'action': form_action})

        # Check for permit-related elements
        if soup.find(text=re.compile(r'permit', re.I)):
            findings['permit_search_available'] = True

        # Look for recent permits or activity links
        for link in soup.find_all('a', href=True):
            text = link.get_text(strip=True).lower()
            if any(kw in text for kw in ['recent', 'issued', 'search', 'lookup']):
                logger.info(f"Found useful link: {text}")
                findings['links'].append({'text': text, 'href': link.get('href')})

    except Exception as e:
        logger.error(f"Error exploring structure: {e}")

    return findings


def search_permits_by_address(page: Page, address_pattern: str) -> List[ScrapedPermit]:
    """
    Search for permits using an address pattern.

    eTRAKiT typically allows searching by address beginning with a pattern.
    """
    permits = []

    try:
        # Navigate to permit search
        page.goto(ETRAKIT_SEARCH_URL, timeout=60000)
        page.wait_for_load_state("networkidle", timeout=30000)
        rate_limit()

        # Look for search form elements
        html = page.content()
        soup = BeautifulSoup(html, 'lxml')

        # Find search type dropdown
        search_by = page.query_selector('select[name*="SearchBy"], select[id*="SearchBy"]')
        search_value = page.query_selector('input[name*="SearchValue"], input[id*="SearchValue"]')
        search_btn = page.query_selector('input[type="submit"], button[type="submit"]')

        if not search_value:
            logger.warning("Could not find search input")
            return permits

        # Select "Address" search if dropdown exists
        if search_by:
            try:
                page.select_option(search_by, label="Address")
            except:
                try:
                    page.select_option(search_by, value="Address")
                except:
                    pass

        # Enter search pattern
        search_value.fill(address_pattern)
        rate_limit()

        # Submit search
        if search_btn:
            search_btn.click()
        else:
            search_value.press("Enter")

        page.wait_for_load_state("networkidle", timeout=60000)

        # Parse results
        permits = parse_search_results(page)

    except PlaywrightTimeout:
        logger.warning(f"Timeout searching for {address_pattern}")
    except Exception as e:
        logger.error(f"Error searching for {address_pattern}: {e}")

    return permits


def parse_search_results(page: Page) -> List[ScrapedPermit]:
    """Parse permit results from eTRAKiT search results page."""
    permits = []

    try:
        html = page.content()
        soup = BeautifulSoup(html, 'lxml')

        # Save debug HTML for analysis
        debug_path = DATA_DIR.parent / "debug" / f"colleyville_results_{datetime.now().strftime('%H%M%S')}.html"
        with open(debug_path, 'w') as f:
            f.write(html)

        # eTRAKiT typically shows results in a table or grid
        # Look for result rows
        result_rows = soup.select('tr.SearchResults, tr.DataRow, tr[class*="Row"]')

        if not result_rows:
            # Try finding any table with permit-like data
            tables = soup.find_all('table')
            for table in tables:
                rows = table.find_all('tr')
                for row in rows[1:]:  # Skip header
                    cells = row.find_all('td')
                    if len(cells) >= 3:
                        result_rows.append(row)

        logger.info(f"Found {len(result_rows)} result rows")

        for row in result_rows:
            permit = parse_etrakit_row(row)
            if permit:
                permits.append(permit)

    except Exception as e:
        logger.error(f"Error parsing results: {e}")

    return permits


def parse_etrakit_row(row) -> Optional[ScrapedPermit]:
    """Parse a single eTRAKiT result row."""
    try:
        cells = row.find_all('td')
        if len(cells) < 2:
            return None

        cell_texts = [c.get_text(strip=True) for c in cells]

        # Try to extract permit data
        permit_id = None
        address = None
        permit_type = None
        issued_date = None
        status = None

        for i, text in enumerate(cell_texts):
            # Permit IDs often match patterns
            if re.match(r'^[A-Z]{1,4}[-\s]?\d{2,4}[-\s]?\d{1,5}$', text):
                permit_id = text
            # Addresses start with numbers
            elif re.match(r'^\d+\s+[A-Za-z]', text) and not address:
                address = text
            # Dates
            elif re.match(r'\d{1,2}[/-]\d{1,2}[/-]\d{2,4}', text) and not issued_date:
                issued_date = parse_date(text)
            # Status keywords
            elif text.lower() in ['issued', 'active', 'final', 'closed', 'pending']:
                status = text

        # Check links in cells for permit ID
        for cell in cells:
            link = cell.find('a')
            if link:
                link_text = link.get_text(strip=True)
                if re.match(r'^[A-Z]{1,4}[-\s]?\d', link_text):
                    permit_id = link_text

        if not address:
            return None

        if not permit_id:
            permit_id = f"COLV-{date.today().strftime('%y%m%d')}-{hash(address) % 10000:04d}"

        return ScrapedPermit(
            permit_id=permit_id,
            city=CITY,
            property_address=address,
            permit_type=permit_type or "Unknown",
            description="",
            status=status or "Unknown",
            issued_date=issued_date,
            city_name=CITY_NAME,
            scraped_at=datetime.now()
        )

    except Exception as e:
        logger.warning(f"Error parsing row: {e}")
        return None


def scrape_colleyville() -> List[ScrapedPermit]:
    """Main scraping function for Colleyville permits."""
    all_permits = []
    errors = []
    seen_permits = set()  # Deduplicate by permit_id

    logger.info(f"Starting Colleyville eTRAKiT scrape")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            if not navigate_to_search(page):
                raise Exception("Failed to navigate to eTRAKiT")

            # Explore the structure first
            findings = explore_etrakit_structure(page)
            logger.info(f"Structure findings: {json.dumps(findings, indent=2)}")

            # Search for permits using address patterns
            for pattern in SEARCH_PATTERNS:
                try:
                    logger.info(f"Searching for addresses starting with '{pattern}'")
                    permits = search_permits_by_address(page, pattern)

                    for permit in permits:
                        if permit.permit_id not in seen_permits:
                            seen_permits.add(permit.permit_id)
                            all_permits.append(permit)

                    logger.info(f"Found {len(permits)} permits for pattern '{pattern}'")
                    rate_limit()

                except Exception as e:
                    error_msg = f"Error with pattern {pattern}: {e}"
                    logger.error(error_msg)
                    errors.append(error_msg)

        except Exception as e:
            error_msg = f"Scraper error: {e}"
            logger.error(error_msg)
            errors.append(error_msg)

        finally:
            browser.close()

    # Save results
    save_results(all_permits)

    # Log the run
    status = "success" if not errors else "partial" if all_permits else "failed"
    log_scraper_run(CITY, status, len(all_permits), errors)

    logger.info(f"Scrape complete: {len(all_permits)} permits found")
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
    permits = scrape_colleyville()
    print(f"\nScraped {len(permits)} permits from Colleyville")

    if permits:
        print("\nSample permits:")
        for p in permits[:5]:
            print(f"  {p.permit_id}: {p.property_address} ({p.permit_type})")
