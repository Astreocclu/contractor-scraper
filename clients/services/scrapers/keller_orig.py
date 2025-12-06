#!/usr/bin/env python3
"""
DFW Signal Engine - Keller Permit Scraper

Scrapes building permits from Keller's eTRAKiT portal.
URL: https://trakitweb.cityofkeller.com/etrakit/

Search options:
- Search By: "Permit Number" or "Address"
- Operators: "Begins With", "Contains", "Equals"

Strategy: Search by address patterns to get recent permits,
then filter by permit type.
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
CITY = "keller"
CITY_NAME = "Keller"
ETRAKIT_URL = "https://trakitweb.cityofkeller.com/etrakit/"
ETRAKIT_SEARCH_URL = "https://trakitweb.cityofkeller.com/etrakit/Search/permit.aspx"
LOOKBACK_DAYS = 90

# Form element IDs (from exploration - note mixed ID formats in eTRAKiT)
SEARCH_BY_SELECT = "cplMain_ddSearchBy"
SEARCH_OPER_SELECT = "cplMain_ddSearchOper"
SEARCH_VALUE_INPUT = "cplMain_txtSearchString"
SEARCH_BUTTON = "ctl00_cplMain_btnSearch"

# Search patterns - common Keller street prefixes
# Using address "Begins With" to get bulk results
ADDRESS_PATTERNS = [
    "1", "2", "3", "4", "5", "6", "7", "8", "9"
]

# Permit number patterns - search for high-value permit types directly
# Format: (pattern, search_type) where search_type is "Permit Number" or "Address"
PERMIT_NUMBER_PATTERNS = [
    "POOL",      # Pool permits - highest priority
    "B24",       # 2024 building permits
    "B25",       # 2025 building permits
    "B23",       # 2023 building permits
    "MISC24",    # 2024 miscellaneous (decks, patios)
    "MISC25",    # 2025 miscellaneous
    "R24",       # 2024 roofing
    "R25",       # 2025 roofing
]

# Permit types we care about
TARGET_PERMIT_TYPES = [
    "pool", "spa", "swim",
    "patio", "deck", "pergola",
    "new", "addition", "remodel", "alteration",
    "accessory", "residential", "single family"
]

logger = setup_logging("scrape", CITY)


def navigate_to_search(page: Page) -> bool:
    """Navigate to the eTRAKiT permit search page."""
    try:
        logger.info(f"Navigating to {ETRAKIT_URL}")
        page.goto(ETRAKIT_URL, timeout=60000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)  # Let page settle

        # Click permit search link
        search_link = page.query_selector('a[href*="permit" i]')
        if search_link:
            logger.info("Clicking permit search link...")
            search_link.click()
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_timeout(3000)

        # Verify we're on the search page
        search_by = page.query_selector(f"#{SEARCH_BY_SELECT}")
        if not search_by:
            logger.warning("Search form not found after navigation")
            return False

        return True
    except Exception as e:
        logger.error(f"Failed to navigate: {e}")
        return False


def search_permits_by_number(page: Page, permit_pattern: str, max_pages: int = 50) -> List[ScrapedPermit]:
    """
    Search for permits by permit number prefix.

    Uses "Permit Number" + "Begins With" to find permits.
    Handles pagination to get all results.
    """
    permits = []

    try:
        # Select "Permit Number" search type
        page.select_option(f"#{SEARCH_BY_SELECT}", label="Permit Number")
        page.wait_for_timeout(2000)  # Wait for postback

        # Select "Begins With" operator
        page.select_option(f"#{SEARCH_OPER_SELECT}", label="Begins With")
        page.wait_for_timeout(1000)

        # Find and fill search value input
        search_input = page.query_selector(f"#{SEARCH_VALUE_INPUT}")
        if not search_input:
            logger.warning("Could not find search input")
            return permits

        # Clear and fill the search input
        search_input.fill(permit_pattern)
        page.wait_for_timeout(1000)

        # Click search button
        search_btn = page.query_selector(f"#{SEARCH_BUTTON}")
        if search_btn:
            search_btn.click()
            page.wait_for_timeout(5000)  # Wait for results
        else:
            logger.warning("Could not find search button")
            return permits

        # Parse results from all pages
        page_num = 1
        while page_num <= max_pages:
            # Parse current page
            page_permits = parse_search_results(page)
            permits.extend(page_permits)

            if not page_permits:
                break

            # Check for Next button
            next_btn = page.query_selector('.PagerButton.NextPage:not(.aspNetDisabled)')
            if not next_btn:
                break

            # Click Next and wait for results
            logger.debug(f"Clicking Next (page {page_num + 1})...")
            next_btn.click()
            page.wait_for_timeout(3000)
            page_num += 1
            rate_limit()

        logger.info(f"Found {len(permits)} permits for permit pattern '{permit_pattern}' ({page_num} pages)")

    except PlaywrightTimeout:
        logger.warning(f"Timeout searching for permit '{permit_pattern}'")
    except Exception as e:
        logger.error(f"Error searching for permit '{permit_pattern}': {e}")

    return permits


def search_permits_by_address(page: Page, address_pattern: str, max_pages: int = 50) -> List[ScrapedPermit]:
    """
    Search for permits using an address pattern.

    Uses "Address" + "Begins With" to find permits.
    Handles pagination to get all results.
    """
    permits = []

    try:
        # Select "Address" search type
        page.select_option(f"#{SEARCH_BY_SELECT}", label="Address")
        page.wait_for_timeout(2000)  # Wait for postback

        # Select "Begins With" operator
        page.select_option(f"#{SEARCH_OPER_SELECT}", label="Begins With")
        page.wait_for_timeout(1000)

        # Find and fill search value input
        search_input = page.query_selector(f"#{SEARCH_VALUE_INPUT}")
        if not search_input:
            logger.warning("Could not find search input")
            return permits

        # Clear and fill the search input
        search_input.fill(address_pattern)
        page.wait_for_timeout(1000)

        # Click search button
        search_btn = page.query_selector(f"#{SEARCH_BUTTON}")
        if search_btn:
            search_btn.click()
            page.wait_for_timeout(5000)  # Wait for results
        else:
            logger.warning("Could not find search button")
            return permits

        # Parse results from all pages
        page_num = 1
        while page_num <= max_pages:
            # Parse current page
            page_permits = parse_search_results(page)
            permits.extend(page_permits)

            if not page_permits:
                break

            # Check for Next button
            next_btn = page.query_selector('.PagerButton.NextPage:not(.aspNetDisabled)')
            if not next_btn:
                # No more pages or Next is disabled
                break

            # Click Next and wait for results
            logger.debug(f"Clicking Next (page {page_num + 1})...")
            next_btn.click()
            page.wait_for_timeout(3000)
            page_num += 1
            rate_limit()  # Be polite between pages

        logger.info(f"Found {len(permits)} permits for pattern '{address_pattern}' ({page_num} pages)")

    except PlaywrightTimeout:
        logger.warning(f"Timeout searching for '{address_pattern}'")
    except Exception as e:
        logger.error(f"Error searching for '{address_pattern}': {e}")

    return permits


def parse_search_results(page: Page) -> List[ScrapedPermit]:
    """Parse permit results from eTRAKiT search results page."""
    permits = []

    try:
        html = page.content()
        soup = BeautifulSoup(html, 'lxml')

        # Find the results grid
        grid = soup.find('table', id=lambda x: x and 'SearchRslts' in x if x else False)
        if not grid:
            # Try other selectors
            grid = soup.find('table', class_=lambda c: c and 'rgMasterTable' in c if c else False)

        if not grid:
            logger.info("No results grid found")
            return permits

        # Get data rows (rows with class containing "Row")
        result_rows = grid.find_all('tr', class_=lambda c: c and 'Row' in c if c else False)
        logger.info(f"Found {len(result_rows)} result rows")

        for row in result_rows:
            permit = parse_etrakit_row(row)
            if permit:
                permits.append(permit)

    except Exception as e:
        logger.error(f"Error parsing results: {e}")

    return permits


def parse_etrakit_row(row) -> Optional[ScrapedPermit]:
    """
    Parse a single eTRAKiT result row.

    Keller eTRAKiT structure (3 columns):
    - Column 0: Permit ID (e.g., "B21-0107", "POOL19-0001")
    - Column 1: Address (e.g., "100 BOURLAND RD")
    - Column 2: Tracking number (e.g., "MAH:1203260356040682")
    """
    try:
        cells = row.find_all('td')
        if len(cells) < 2:
            return None

        cell_texts = [c.get_text(strip=True) for c in cells]

        # Skip empty rows
        if not any(cell_texts):
            return None

        # Column 0: Permit ID
        permit_id = cell_texts[0] if len(cell_texts) > 0 else None

        # Column 1: Address
        address = cell_texts[1] if len(cell_texts) > 1 else None

        # Need both permit_id and address
        if not permit_id or not address:
            return None

        # Infer permit type from permit ID prefix
        # Common prefixes: B=Building, POOL, FD=Fire, MISC, E=Electrical, P=Plumbing
        permit_type = infer_permit_type(permit_id)

        return ScrapedPermit(
            permit_id=permit_id,
            city=CITY,
            property_address=address + ", Keller TX",  # Add city for enrichment
            permit_type=permit_type,
            description="",
            status="Unknown",
            issued_date=None,  # Not available in search results
            city_name=CITY_NAME,
            scraped_at=datetime.now()
        )

    except Exception as e:
        logger.warning(f"Error parsing row: {e}")
        return None


def infer_permit_type(permit_id: str) -> str:
    """Infer permit type from Keller permit ID prefix."""
    permit_upper = permit_id.upper()

    if permit_upper.startswith("POOL"):
        return "Pool"
    elif permit_upper.startswith("B"):
        return "Building"
    elif permit_upper.startswith("E"):
        return "Electrical"
    elif permit_upper.startswith("P"):
        return "Plumbing"
    elif permit_upper.startswith("M"):
        return "Mechanical"
    elif permit_upper.startswith("FD"):
        return "Fire"
    elif permit_upper.startswith("MISC"):
        return "Miscellaneous"
    elif permit_upper.startswith("S"):
        return "Sign"
    elif permit_upper.startswith("R"):
        return "Roofing"
    else:
        return "Unknown"


def is_target_permit(permit: ScrapedPermit) -> bool:
    """
    Check if permit matches our target types.

    Target types for security screen leads:
    - Pool (highest priority)
    - Building (new construction, additions - residential & commercial)
    - Roofing (may indicate remodel)
    - Miscellaneous (could be deck, patio, etc.)
    - Sign (commercial properties)
    - Fire (commercial properties with fire systems)

    Exclude:
    - Electrical (usually minor work)
    - Plumbing (usually repairs)
    """
    if not permit.permit_type:
        return True  # Include unknown for review

    permit_type = permit.permit_type.lower()

    # Include residential and commercial targets
    if permit_type in ["pool", "building", "roofing", "miscellaneous", "unknown", "sign", "fire"]:
        return True

    return False


def scrape_keller() -> List[ScrapedPermit]:
    """Main scraping function for Keller permits."""
    all_permits = []
    errors = []
    seen_permits = set()  # Deduplicate by permit_id

    logger.info(f"Starting Keller eTRAKiT scrape")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            if not navigate_to_search(page):
                raise Exception("Failed to navigate to eTRAKiT search")

            # First, search by permit number patterns (high-value types)
            logger.info("=== Searching by permit number patterns ===")
            for pattern in PERMIT_NUMBER_PATTERNS:
                try:
                    logger.info(f"Searching for permit numbers starting with '{pattern}'")
                    permits = search_permits_by_number(page, pattern)

                    for permit in permits:
                        if permit.permit_id not in seen_permits:
                            seen_permits.add(permit.permit_id)
                            if is_target_permit(permit):
                                all_permits.append(permit)

                    rate_limit()

                except Exception as e:
                    error_msg = f"Error with permit pattern '{pattern}': {e}"
                    logger.error(error_msg)
                    errors.append(error_msg)

            # Then search by address patterns to catch anything else
            logger.info("=== Searching by address patterns ===")
            for pattern in ADDRESS_PATTERNS:
                try:
                    logger.info(f"Searching for addresses starting with '{pattern}'")
                    permits = search_permits_by_address(page, pattern)

                    for permit in permits:
                        if permit.permit_id not in seen_permits:
                            seen_permits.add(permit.permit_id)
                            if is_target_permit(permit):
                                all_permits.append(permit)

                    rate_limit()

                except Exception as e:
                    error_msg = f"Error with address pattern '{pattern}': {e}"
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
    permits = scrape_keller()
    print(f"\nScraped {len(permits)} permits from Keller")

    if permits:
        print("\nSample permits:")
        for p in permits[:10]:
            print(f"  {p.permit_id}: {p.property_address} ({p.permit_type})")
