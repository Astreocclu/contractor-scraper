"""
Dallas County Official Public Records scraper.

Portal: https://dallas.tx.publicsearch.us/
Searches for mechanic's liens, tax liens, and abstracts of judgment.
"""

import asyncio
import logging
from datetime import date, timedelta
from typing import Optional

from playwright.async_api import TimeoutError as PlaywrightTimeout

from .base import (
    BaseCountyLienScraper,
    LienRecord,
    CountyPortalUnavailable,
    CaptchaDetected,
)

logger = logging.getLogger(__name__)


class DallasCountyScraper(BaseCountyLienScraper):
    """
    Scraper for Dallas County Official Public Records.
    
    The Dallas County portal may redirect to a third-party records system.
    This implementation handles both scenarios.
    """
    
    COUNTY_NAME = "dallas"
    BASE_URL = "https://dallas.tx.publicsearch.us/"
    SEARCH_URL = "https://dallas.tx.publicsearch.us/"
    
    async def search_by_name(self, name: str) -> list[LienRecord]:
        """
        Search Dallas County records by grantee (debtor) name.
        
        Args:
            name: Business or person name to search
            
        Returns:
            List of LienRecord matching the search
        """
        logger.info(f"Searching Dallas County for: {name}")
        
        playwright = None
        browser = None
        context = None
        
        try:
            playwright, browser, context, page = await self.create_browser_context()
            
            # First try the direct search URL
            try:
                await page.goto(self.SEARCH_URL, wait_until='networkidle', timeout=self.timeout)
            except Exception:
                # Fall back to main page which may redirect
                await page.goto(self.BASE_URL, wait_until='networkidle', timeout=self.timeout)
                await asyncio.sleep(1.0)
                
                # Look for link to search system
                search_link = await page.query_selector('a:has-text("Search"), a:has-text("Records"), a[href*="search"]')
                if search_link:
                    await search_link.click()
                    await page.wait_for_load_state('networkidle')
            
            await asyncio.sleep(1.0)

            # Check for actual CAPTCHA challenge (not just config strings)
            captcha_visible = await page.query_selector('iframe[src*="recaptcha"], .g-recaptcha, #captcha, [class*="captcha-challenge"]')
            if captcha_visible:
                raise CaptchaDetected("CAPTCHA challenge detected on Dallas County portal")

            # Close any popup/tour dialog
            try:
                close_btn = await page.query_selector('button:has-text("×"), [aria-label="close"], .close-button')
                if close_btn:
                    await close_btn.click()
                    await asyncio.sleep(0.5)
            except:
                pass

            # Wait for search form to load (publicsearch.us portal)
            await page.wait_for_selector('input[placeholder*="grantor"], input[placeholder*="Search for"]', timeout=10000)

            # Enter search term in main search box
            search_input = await page.query_selector('input[placeholder*="grantor"], input[placeholder*="Search for"]')
            if search_input:
                await search_input.fill(name)
            else:
                raise CountyPortalUnavailable("Could not find search input on Dallas portal")

            # Submit search - click the search button
            search_btn = await page.query_selector('button[type="submit"], button[aria-label*="search"], button:has-text("Search"), .search-button')
            if search_btn:
                await search_btn.click()
            else:
                await search_input.press('Enter')

            # Wait for results to load
            await asyncio.sleep(2.0)
            await page.wait_for_selector('table, .results, .no-results, [class*="result"]', timeout=15000)
            
            # Extract results
            records = await self._extract_results(page, name)
            
            # Handle pagination
            page_num = 1
            while page_num < 20:
                next_button = await page.query_selector(
                    'a:has-text("Next"), button:has-text("Next"), '
                    '.next, [aria-label*="next"]'
                )
                
                if not next_button:
                    break
                
                is_disabled = await next_button.get_attribute('disabled')
                aria_disabled = await next_button.get_attribute('aria-disabled')
                if is_disabled or aria_disabled == 'true':
                    break
                
                await next_button.click()
                await asyncio.sleep(self.rate_limit)
                
                try:
                    await page.wait_for_selector('table tbody tr', timeout=10000)
                    page_records = await self._extract_results(page, name)
                    if not page_records:
                        break
                    records.extend(page_records)
                except PlaywrightTimeout:
                    break
                    
                page_num += 1
            
            logger.info(f"Found {len(records)} records in Dallas County for {name}")
            return records
            
        except PlaywrightTimeout as e:
            logger.error(f"Timeout on Dallas County portal: {e}")
            raise CountyPortalUnavailable(f"Dallas County portal timeout: {e}")
            
        finally:
            if playwright and browser and context:
                await self.cleanup(playwright, browser, context)
    
    async def _extract_results(self, page, search_name: str) -> list[LienRecord]:
        """
        Extract lien records from results page.

        publicsearch.us portal column order:
        0-2: checkboxes/actions (empty)
        3: GRANTOR
        4: GRANTEE
        5: DOC TYPE
        6: DATE
        7: INST NUMBER
        8: BOOK/PAGE
        9: LEGAL DESCRIPTION
        """
        records = []

        rows = await page.query_selector_all('table tbody tr')

        if not rows:
            logger.debug("No result rows found")
            return records

        for row in rows:
            try:
                cells = await row.query_selector_all('td')

                if len(cells) < 8:
                    continue

                # Get text from cells
                cell_texts = []
                for cell in cells:
                    text = await cell.inner_text()
                    cell_texts.append(text.strip())

                # publicsearch.us column mapping
                grantor = cell_texts[3] if len(cell_texts) > 3 else ''
                grantee = cell_texts[4] if len(cell_texts) > 4 else ''
                doc_type_raw = cell_texts[5] if len(cell_texts) > 5 else ''
                filing_date_str = cell_texts[6] if len(cell_texts) > 6 else ''
                instrument_number = cell_texts[7] if len(cell_texts) > 7 else ''

                # Normalize document type
                doc_type = self.normalize_document_type(doc_type_raw)
                if not doc_type:
                    # Skip non-lien document types
                    continue

                # Parse date
                filing_date = self.parse_date(filing_date_str)
                if not filing_date:
                    continue

                record = LienRecord(
                    county=self.COUNTY_NAME,
                    instrument_number=instrument_number,
                    document_type=doc_type,
                    grantor=grantor,
                    grantee=grantee,
                    filing_date=filing_date,
                    amount=None,  # Amount not shown in list view
                    source_url=self.SEARCH_URL,
                    raw_data={
                        'search_term': search_name,
                        'doc_type_raw': doc_type_raw,
                        'cell_texts': cell_texts,
                    }
                )
                records.append(record)

            except Exception as e:
                logger.debug(f"Error parsing Dallas row: {e}")
                continue

        return records
    
    async def search_by_date_range(
        self,
        start: date,
        end: date,
        document_types: list[str] = None
    ) -> list[LienRecord]:
        """Search Dallas County by date range."""
        logger.info(f"Searching Dallas County from {start} to {end}")
        
        playwright = None
        browser = None
        context = None
        
        try:
            playwright, browser, context, page = await self.create_browser_context()
            
            await page.goto(self.SEARCH_URL, wait_until='networkidle', timeout=self.timeout)
            await asyncio.sleep(1.0)
            
            # Fill date range
            start_input = await page.query_selector('input[name*="start"]')
            end_input = await page.query_selector('input[name*="end"]')
            
            if start_input:
                await start_input.fill(start.strftime('%m/%d/%Y'))
            if end_input:
                await end_input.fill(end.strftime('%m/%d/%Y'))
            
            # Submit
            submit = await page.query_selector('button[type="submit"]')
            if submit:
                await submit.click()
            
            await asyncio.sleep(2.0)
            await page.wait_for_selector('table, .results', timeout=15000)
            
            records = await self._extract_results(page, f"date:{start}:{end}")
            
            if document_types:
                records = [r for r in records if r.document_type in document_types]
            
            return records
            
        finally:
            if playwright and browser and context:
                await self.cleanup(playwright, browser, context)


async def main():
    """Test from command line."""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python -m scrapers.county_liens.dallas <business_name>")
        sys.exit(1)
    
    name = ' '.join(sys.argv[1:])
    
    scraper = DallasCountyScraper()
    try:
        results = await scraper.search_with_retry(name)
        print(f"\nFound {len(results)} records:")
        for r in results:
            print(f"  {r['document_type']}: {r['grantee']} - ${r.get('amount', 'N/A')} ({r['filing_date']})")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == '__main__':
    asyncio.run(main())
