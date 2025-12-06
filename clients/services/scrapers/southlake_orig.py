#!/usr/bin/env python3
"""
DFW Signal Engine - Southlake Permit Scraper

Scrapes building permits from Southlake's EnerGov Citizen Self-Service portal.
Uses Playwright for JavaScript rendering.
"""

import sys
import json
import re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from datetime import date, timedelta, datetime
from typing import List, Optional, Dict, Any
from playwright.sync_api import sync_playwright, Page, TimeoutError as PlaywrightTimeout
from bs4 import BeautifulSoup

from scripts.utils import (
    ScrapedPermit, rate_limit, setup_logging, save_permit,
    normalize_address, parse_date, DATA_DIR, log_scraper_run
)

# Configuration
CITY = "southlake"
CITY_NAME = "Southlake"
BASE_URL = "https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService"
LOOKBACK_DAYS = 90

# Permit types we care about - (value, display_name, our_category)
# Values from EnerGov dropdown inspection
PERMIT_TYPES = [
    # HIGH PRIORITY - Pool permits (50 points per LEAD_SCORING.md)
    ("string:3d735da1-b8e4-4ae7-a739-1867516aa671_732e26f3-7cc9-4952-b958-7e1d570f0bda",
     "Pool & Spa (Residential)", "Pool/Spa"),
    ("string:3d735da1-b8e4-4ae7-a739-1867516aa671_8d4e9d79-3287-4cce-9dd1-e534e112bc8b",
     "Pool (Residential)", "Pool"),
    ("string:3d735da1-b8e4-4ae7-a739-1867516aa671_3057c3ba-6681-40f8-b5c5-21ef06e739c3",
     "Spa (Residential)", "Spa"),

    # Pool barrier indicates pool construction
    ("string:89d1ba72-bb00-47f8-9dd1-e971260c7f33_907f21ae-7b74-4afc-946a-ed0a1c386ca7",
     "Fence - Pool Barrier (Residential)", "Pool Barrier"),

    # HIGH PRIORITY - New construction (45 points)
    ("string:e330afc9-71f1-41b8-af5c-0a164d89b67b_15237fd7-e9c6-4867-9d1e-fe29b4309341",
     "Residential New Building (Single Family Home)", "Residential New"),
    ("string:e330afc9-71f1-41b8-af5c-0a164d89b67b_b03e9d45-5364-42cc-8bff-3ab74af79fc7",
     "Residential New Building (Townhome)", "Residential New"),

    # MEDIUM PRIORITY - Additions (35-40 points)
    ("string:e83e0acd-a14d-4087-b8e7-fcdad87a699a_44d83d59-2b0e-423e-a99e-91bd3c0e45dd",
     "Residential Addition Conditioned Space", "Residential Addition"),
    ("string:e83e0acd-a14d-4087-b8e7-fcdad87a699a_ab81c238-981f-4ae3-a757-61d923c890ba",
     "Residential Addition Conditioned & Uncond", "Residential Addition"),
    ("string:e83e0acd-a14d-4087-b8e7-fcdad87a699a_c781ebe0-75bf-4822-be85-2eb70de8f141",
     "Residential Addition Shade Structure Attached", "Patio/Deck"),

    # Accessory structures (often pools, patios, outdoor kitchens)
    ("string:ad16eb54-7c3e-4ac2-8db9-01fdd61267c0_7a5b34ba-f07f-4847-adb3-2ee743985ec0",
     "Residential Accessory Conditioned Building", "Residential Accessory"),
    ("string:ad16eb54-7c3e-4ac2-8db9-01fdd61267c0_939fc13c-b525-415c-8ad1-9f98d5a45682",
     "Residential Accessory Shade Structure Detached", "Patio/Deck"),

    # MEDIUM PRIORITY - Remodels (30 points)
    ("string:008dc7bf-77e4-4bc5-97e9-ce6af6f71e11_dc8fd144-dcd9-4851-8534-a70577c4cb27",
     "Residential Remodel", "Residential Remodel"),

    # LOWER PRIORITY - Fence (15 points, security-conscious)
    ("string:89d1ba72-bb00-47f8-9dd1-e971260c7f33_407bd64d-b25b-4d71-9e8d-c9eb83f3108f",
     "Fence (Residential)", "Fence"),
]

# Status filter - we want issued permits
ISSUED_STATUS = "string:f8b6324d-f3b0-4efc-be19-e171ae0410d4"

logger = setup_logging("scrape", CITY)


def navigate_to_search(page: Page) -> bool:
    """Navigate to the search page and open advanced options."""
    try:
        logger.info("Navigating to EnerGov search page...")
        page.goto(f"{BASE_URL}#/search", timeout=60000)
        page.wait_for_load_state("networkidle", timeout=30000)
        rate_limit()

        # Handle Tyler Identity popup if it appears
        try:
            cancel_btn = page.query_selector('button:has-text("Cancel")')
            if cancel_btn and cancel_btn.is_visible():
                cancel_btn.click()
                rate_limit()
        except:
            pass

        # Select Permit module
        logger.info("Selecting Permit module...")
        module_select = page.query_selector('select[name="SearchModule"]')
        if module_select:
            module_select.select_option("Permit")
            rate_limit()

        # Open Advanced search
        logger.info("Opening Advanced search...")
        advanced_btn = page.query_selector('button:has-text("Advanced")')
        if advanced_btn:
            advanced_btn.click()
            rate_limit()

        return True
    except Exception as e:
        logger.error(f"Failed to navigate to search: {e}")
        return False


def search_permits_by_type(page: Page, permit_type_value: str, permit_type_name: str,
                           our_category: str) -> List[ScrapedPermit]:
    """Search for permits of a specific type."""
    permits = []

    try:
        logger.info(f"Searching for {permit_type_name}...")

        # Select permit type from dropdown
        type_select = page.query_selector('select[name="PermitCriteria_PermitTypeId"]')
        if type_select:
            type_select.select_option(permit_type_value)
            rate_limit()

        # Select "Issued" status
        status_select = page.query_selector('select[name="PermitCriteria_PermitStatusId"]')
        if status_select:
            status_select.select_option(ISSUED_STATUS)
            rate_limit()

        # Click Search
        search_btn = page.query_selector('button:has-text("Search")')
        if search_btn:
            search_btn.click()
            page.wait_for_load_state("networkidle", timeout=60000)
            rate_limit()

        # Check result count
        result_label = page.query_selector('label:has-text("Found")')
        if result_label:
            result_text = result_label.inner_text()
            logger.info(f"  {result_text}")

            # Extract count
            match = re.search(r'Found (\d+)', result_text)
            if match:
                count = int(match.group(1))
                if count > 0:
                    # Parse results
                    permits = parse_results(page, our_category)

                    # Handle pagination if needed
                    page_num = 1
                    while has_more_pages(page) and page_num < 20:
                        page_num += 1
                        if click_next_page(page):
                            logger.info(f"  Page {page_num}...")
                            page_permits = parse_results(page, our_category)
                            permits.extend(page_permits)
                        else:
                            break

        # Reset form for next search
        reset_btn = page.query_selector('button:has-text("Reset")')
        if reset_btn:
            reset_btn.click()
            rate_limit()

            # Re-open advanced and re-select Permit module
            module_select = page.query_selector('select[name="SearchModule"]')
            if module_select:
                module_select.select_option("Permit")
                rate_limit()

            advanced_btn = page.query_selector('button:has-text("Advanced")')
            if advanced_btn:
                advanced_btn.click()
                rate_limit()

    except PlaywrightTimeout as e:
        logger.warning(f"Timeout searching {permit_type_name}: {e}")
    except Exception as e:
        logger.error(f"Error searching {permit_type_name}: {e}")

    logger.info(f"  Found {len(permits)} {our_category} permits")
    return permits


def parse_results(page: Page, permit_type: str) -> List[ScrapedPermit]:
    """Parse the search results page."""
    permits = []

    try:
        html = page.content()
        soup = BeautifulSoup(html, 'lxml')

        # EnerGov typically displays results in a list/card format
        # Look for result items
        result_items = soup.select('[ng-repeat*="result"], .search-result-item, .result-row')

        if not result_items:
            # Try finding links to permit details
            # EnerGov URLs often contain /cap/ for records
            links = soup.find_all('a', href=re.compile(r'cap|permit|record', re.I))

            for link in links:
                try:
                    # Get the parent row/container to extract all data
                    container = link.find_parent(['tr', 'div', 'li'])
                    if container:
                        permit = extract_permit_from_container(container, link, permit_type)
                        if permit:
                            permits.append(permit)
                except Exception as e:
                    logger.debug(f"Error parsing result: {e}")

        # Alternative: look for any text that matches permit number pattern
        if not permits:
            # Southlake permit numbers might be like BP-XXXX or similar
            text = soup.get_text()
            permit_numbers = re.findall(r'(BP-\d+[-\w]*|\d{4}-\d+)', text)

            if permit_numbers:
                logger.debug(f"Found permit numbers in text: {permit_numbers[:5]}")

                # Try to get structured data via JavaScript
                permits = extract_permits_via_js(page, permit_type)

    except Exception as e:
        logger.error(f"Error parsing results: {e}")

    return permits


def extract_permit_from_container(container, link, permit_type: str) -> Optional[ScrapedPermit]:
    """Extract permit data from a result container element."""
    try:
        # Get permit number from link text or href
        permit_id = link.get_text(strip=True)
        if not permit_id or len(permit_id) < 3:
            href = link.get('href', '')
            match = re.search(r'capId=([^&]+)', href)
            if match:
                permit_id = match.group(1)

        if not permit_id:
            return None

        # Get all text from container
        all_text = container.get_text(separator='|', strip=True)
        parts = [p.strip() for p in all_text.split('|') if p.strip()]

        # Try to find address (usually contains numbers and street indicators)
        address = None
        for part in parts:
            if re.search(r'\d+.*(?:ST|AVE|DR|RD|LN|CT|BLVD|WAY|PL|CIR)', part, re.I):
                address = part
                break

        # Try to find date
        issued_date = None
        for part in parts:
            if re.search(r'\d{1,2}/\d{1,2}/\d{2,4}', part):
                issued_date = parse_date(part)
                break

        if not address:
            return None

        return ScrapedPermit(
            permit_id=permit_id,
            city=CITY,
            property_address=address,
            permit_type=permit_type,
            description=permit_type,
            status="Issued",
            issued_date=issued_date,
            city_name=CITY_NAME,
            scraped_at=datetime.now()
        )

    except Exception as e:
        logger.debug(f"Error extracting permit: {e}")
        return None


def extract_permits_via_js(page: Page, permit_type: str) -> List[ScrapedPermit]:
    """Try to extract permit data via JavaScript/Angular scope."""
    permits = []

    try:
        # EnerGov uses Angular, try to access scope data
        # This is a fallback approach
        result = page.evaluate("""
            () => {
                const results = [];
                // Try to find Angular scope with results
                const elements = document.querySelectorAll('[ng-repeat]');
                elements.forEach(el => {
                    try {
                        const scope = angular.element(el).scope();
                        if (scope && scope.result) {
                            results.push({
                                permitNumber: scope.result.PermitNumber || scope.result.RecordNumber,
                                address: scope.result.Address || scope.result.SitusAddress,
                                issuedDate: scope.result.IssuedDate || scope.result.IssueDate,
                                status: scope.result.Status
                            });
                        }
                    } catch (e) {}
                });
                return results;
            }
        """)

        if result:
            for r in result:
                if r.get('permitNumber') and r.get('address'):
                    permit = ScrapedPermit(
                        permit_id=r['permitNumber'],
                        city=CITY,
                        property_address=r['address'],
                        permit_type=permit_type,
                        description=permit_type,
                        status=r.get('status', 'Issued'),
                        issued_date=parse_date(r.get('issuedDate')),
                        city_name=CITY_NAME,
                        scraped_at=datetime.now()
                    )
                    permits.append(permit)

    except Exception as e:
        logger.debug(f"JS extraction failed: {e}")

    return permits


def has_more_pages(page: Page) -> bool:
    """Check if there are more result pages."""
    try:
        # Look for pagination elements
        next_btn = page.query_selector('a:has-text("Next"), button:has-text("Next"), [class*="next"]')
        if next_btn and next_btn.is_visible() and next_btn.is_enabled():
            return True
    except:
        pass
    return False


def click_next_page(page: Page) -> bool:
    """Click to the next page of results."""
    try:
        next_btn = page.query_selector('a:has-text("Next"), button:has-text("Next")')
        if next_btn and next_btn.is_visible():
            next_btn.click()
            page.wait_for_load_state("networkidle", timeout=30000)
            rate_limit()
            return True
    except:
        pass
    return False


def scrape_southlake() -> List[ScrapedPermit]:
    """Main scraping function for Southlake permits."""
    all_permits = []
    errors = []

    logger.info(f"Starting Southlake scrape")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            if not navigate_to_search(page):
                raise Exception("Failed to navigate to search page")

            for permit_type_value, permit_type_name, our_category in PERMIT_TYPES:
                try:
                    permits = search_permits_by_type(
                        page, permit_type_value, permit_type_name, our_category
                    )
                    all_permits.extend(permits)

                except Exception as e:
                    error_msg = f"Error scraping {permit_type_name}: {e}"
                    logger.error(error_msg)
                    errors.append(error_msg)

                    # Try to recover
                    try:
                        navigate_to_search(page)
                    except:
                        pass

        finally:
            # Save debug screenshot
            debug_dir = DATA_DIR.parent / "debug"
            debug_dir.mkdir(exist_ok=True)
            page.screenshot(path=str(debug_dir / f"southlake_final_{date.today()}.png"))

            browser.close()

    # Deduplicate by permit_id
    seen = set()
    unique_permits = []
    for p in all_permits:
        if p.permit_id not in seen:
            seen.add(p.permit_id)
            unique_permits.append(p)

    # Save results
    save_results(unique_permits)

    # Log the run
    status = "success" if not errors else "partial"
    log_scraper_run(CITY, status, len(unique_permits), errors)

    logger.info(f"Scrape complete: {len(unique_permits)} permits found")
    return unique_permits


def save_results(permits: List[ScrapedPermit]):
    """Save permits to JSON file and database."""
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
    permits = scrape_southlake()
    print(f"\nScraped {len(permits)} permits from Southlake")

    # Show sample
    if permits:
        print("\nSample permits:")
        for p in permits[:5]:
            print(f"  {p.permit_id}: {p.property_address} ({p.permit_type})")
