"""
Fort Worth Permit Scraper

Scrapes building permits from Fort Worth's Accela Citizen Access portal.
Uses Playwright for JavaScript rendering.
"""

import re
from datetime import date
from typing import List, Optional

from playwright.sync_api import sync_playwright, Page, TimeoutError as PlaywrightTimeout
from bs4 import BeautifulSoup

from .base import BaseScraper, ScrapedPermit, rate_limit, parse_date


class FortWorthScraper(BaseScraper):
    """Scraper for Fort Worth permits via Accela portal."""

    CITY = "fort_worth"
    CITY_NAME = "Fort Worth"
    BASE_URL = "https://aca-prod.accela.com/CFW"

    # Permit types we care about
    PERMIT_TYPES = [
        # HIGH PRIORITY - Pool permits are best leads
        ("Bldg - Pool/Spa", "Pool/Spa"),

        # HIGH PRIORITY - Residential new construction and additions
        ("Development/Residential Building Permit/New/NA", "Residential New"),
        ("Development/Residential Building Permit/Addition/NA", "Residential Addition"),
        ("Development/Residential Accessory Struct/New/NA", "Residential Accessory New"),
        ("Development/Residential Accessory Struct/Addition/NA", "Residential Accessory Addition"),
        ("Development/Residential Building Permit/Remodel/Construction", "Residential Remodel"),

        # HIGH PRIORITY - Commercial new construction and additions
        ("Development/Commercial Building Permit/New/NA", "Commercial New"),
        ("Development/Commercial Building Permit/Addition/NA", "Commercial Addition"),
        ("Development/Commercial Building Permit/Remodel/Construction", "Commercial Remodel"),
        ("Development/Commercial Accessory Struct/New/NA", "Commercial Accessory New"),

        # LOWER PRIORITY - Fence indicates security-conscious homeowner
        ("Bldg - Fence", "Fence"),
    ]

    def navigate_to_search(self, page: Page) -> bool:
        """Navigate to the Development search page."""
        try:
            self.logger.info("Navigating to Accela portal...")
            page.goto(f"{self.BASE_URL}/Default.aspx", timeout=60000)
            page.wait_for_load_state("networkidle", timeout=30000)

            # Click Development tab
            self.logger.info("Clicking Development tab...")
            page.click('text=Development', timeout=10000)
            rate_limit()

            # Click Search Applications and Permits
            self.logger.info("Clicking Search link...")
            page.click('text=Search Applications and Permits', timeout=10000)
            page.wait_for_load_state("networkidle", timeout=30000)

            return True
        except Exception as e:
            self.logger.error(f"Failed to navigate to search: {e}")
            return False

    def search_permits(self, page: Page, permit_type_value: str, permit_type_name: str,
                       start_date: date, end_date: date) -> List[ScrapedPermit]:
        """Search for permits of a specific type within date range."""
        permits = []

        try:
            self.logger.info(f"Searching for {permit_type_name} permits...")

            # Fill in date range
            start_input = page.query_selector('#ctl00_PlaceHolderMain_generalSearchForm_txtGSStartDate')
            end_input = page.query_selector('#ctl00_PlaceHolderMain_generalSearchForm_txtGSEndDate')

            if start_input:
                start_input.fill("")
                start_input.fill(start_date.strftime('%m/%d/%Y'))
            if end_input:
                end_input.fill("")
                end_input.fill(end_date.strftime('%m/%d/%Y'))

            # Select permit type
            permit_select = '#ctl00_PlaceHolderMain_generalSearchForm_ddlGSPermitType'
            page.select_option(permit_select, value=permit_type_value, timeout=10000)
            rate_limit()

            # Wait for any postback to complete
            page.wait_for_load_state("networkidle", timeout=30000)

            # Click Search button
            search_btn = page.query_selector('#ctl00_PlaceHolderMain_btnNewSearch')
            if search_btn:
                search_btn.click()
                page.wait_for_load_state("networkidle", timeout=60000)
                rate_limit()

                # Parse results
                permits = self.parse_results_page(page, permit_type_name)

                # Handle pagination
                page_num = 1
                while True:
                    next_link = self.find_next_page(page, page_num)
                    if not next_link:
                        break

                    page_num += 1
                    self.logger.info(f"Going to page {page_num}...")
                    next_link.click()
                    page.wait_for_load_state("networkidle", timeout=60000)
                    rate_limit()

                    page_permits = self.parse_results_page(page, permit_type_name)
                    permits.extend(page_permits)

                    if page_num > 20:  # Safety limit
                        self.logger.warning("Hit page limit, stopping pagination")
                        break

        except PlaywrightTimeout as e:
            self.logger.warning(f"Timeout searching {permit_type_name}: {e}")
        except Exception as e:
            self.logger.error(f"Error searching {permit_type_name}: {e}")

        self.logger.info(f"Found {len(permits)} {permit_type_name} permits")
        return permits

    def find_next_page(self, page: Page, current_page: int) -> Optional[any]:
        """Find the next page link if it exists."""
        try:
            next_page = current_page + 1

            # Try direct page number link
            next_link = page.query_selector(f'a[href*="Page${next_page}"]')
            if next_link and next_link.is_visible():
                return next_link

            # Try text-based page number link
            paging_links = page.query_selector_all('a')
            for link in paging_links:
                text = link.inner_text().strip()
                if text == str(next_page):
                    return link

            # Try "Next" button (various selectors)
            for selector in [
                'a:has-text("Next")',
                'a[title*="Next"]',
                'a.aca_simple_paging_next',
                'input[value="Next"]'
            ]:
                next_btn = page.query_selector(selector)
                if next_btn and next_btn.is_visible():
                    return next_btn

        except Exception as e:
            self.logger.debug(f"Pagination lookup error: {e}")

        return None

    def parse_results_page(self, page: Page, permit_type: str) -> List[ScrapedPermit]:
        """Parse the results table and extract permits."""
        permits = []

        try:
            html = page.content()
            soup = BeautifulSoup(html, 'lxml')

            # Look for result table rows
            rows = soup.select('tr.ACA_TabRow_Odd, tr.ACA_TabRow_Even')

            if not rows:
                # Try alternative selectors
                rows = soup.select('table[id*="gdvPermitList"] tr')
                rows = [r for r in rows if r.find('td')]

            self.logger.info(f"Found {len(rows)} result rows")

            for row in rows:
                try:
                    permit = self.parse_permit_row(row, permit_type)
                    if permit:
                        permits.append(permit)
                except Exception as e:
                    self.logger.warning(f"Error parsing row: {e}")

        except Exception as e:
            self.logger.error(f"Error parsing results page: {e}")

        return permits

    def parse_permit_row(self, row, permit_type: str) -> Optional[ScrapedPermit]:
        """Parse a single result row into a permit object."""
        cells = row.find_all('td')

        if len(cells) < 8:
            return None

        # Extract text from cells
        cell_texts = [c.get_text(strip=True) for c in cells]

        # Get permit ID from cell 3
        permit_id = cell_texts[3] if len(cell_texts) > 3 else None

        # Skip header rows or empty permit IDs
        if not permit_id or permit_id in ['Permit Number', 'Record Number', '']:
            return None

        # Skip temporary permits
        if permit_id.startswith('25TMP-') or permit_id.startswith('TMP'):
            return None

        # Get other fields from known positions
        issued_date = parse_date(cell_texts[2]) if len(cell_texts) > 2 else None
        status = cell_texts[4] if len(cell_texts) > 4 else ""
        record_type = cell_texts[5] if len(cell_texts) > 5 else ""
        applicant = cell_texts[6] if len(cell_texts) > 6 else ""
        address = cell_texts[7] if len(cell_texts) > 7 else ""

        # Try cell 11 if cell 7 doesn't have a valid address
        if not address or not re.search(r'\d+', address):
            address = cell_texts[11] if len(cell_texts) > 11 else ""

        # Skip if no valid address
        if not address or not re.search(r'\d+', address):
            return None

        # Build description from applicant/project name
        description = applicant if applicant else record_type

        return ScrapedPermit(
            permit_id=permit_id,
            city=self.CITY,
            property_address=address,
            permit_type=permit_type,
            description=description,
            status=status,
            issued_date=issued_date,
            city_name=self.CITY_NAME,
        )

    def scrape(self) -> List[ScrapedPermit]:
        """Main scraping method for Fort Worth permits."""
        all_permits = []
        start_date, end_date = self.get_date_range()

        self.logger.info(f"Starting Fort Worth scrape for {start_date} to {end_date}")

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()

            try:
                if not self.navigate_to_search(page):
                    raise Exception("Failed to navigate to search page")

                for permit_type_value, permit_type_name in self.PERMIT_TYPES:
                    try:
                        permits = self.search_permits(page, permit_type_value, permit_type_name,
                                                      start_date, end_date)
                        all_permits.extend(permits)

                        # Navigate back to search for next type
                        if permit_type_value != self.PERMIT_TYPES[-1][0]:
                            self.navigate_to_search(page)

                    except Exception as e:
                        self.logger.error(f"Error scraping {permit_type_name}: {e}")
                        # Try to recover
                        try:
                            self.navigate_to_search(page)
                        except:
                            pass

            finally:
                browser.close()

        self.logger.info(f"Scrape complete: {len(all_permits)} permits found")
        return all_permits
