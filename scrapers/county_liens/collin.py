"""
Collin County Official Public Records scraper.

Portal: https://collin.tx.publicsearch.us/
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


class CollinCountyScraper(BaseCountyLienScraper):
    """
    Scraper for Collin County Official Public Records.
    
    Collin County uses a custom portal at apps.collincountytx.gov.
    The rate limit is more conservative as the server is slower.
    """
    
    COUNTY_NAME = "collin"
    BASE_URL = "https://collin.tx.publicsearch.us/"
    SEARCH_URL = "https://collin.tx.publicsearch.us/"
    
    def __init__(self):
        super().__init__()
        self.rate_limit = 2.0  # Slower server, be more conservative
    
    async def search_by_name(self, name: str) -> list[LienRecord]:
        """
        Search Collin County records by grantee (debtor) name.
        """
        logger.info(f"Searching Collin County for: {name}")
        
        playwright = None
        browser = None
        context = None
        
        try:
            playwright, browser, context, page = await self.create_browser_context()
            
            await page.goto(self.SEARCH_URL, wait_until='networkidle', timeout=self.timeout)
            await asyncio.sleep(1.5)  # Extra wait for slower server
            
            # Check for actual CAPTCHA challenge (not just config strings)
            captcha_visible = await page.query_selector('iframe[src*="recaptcha"], .g-recaptcha, #captcha, [class*="captcha-challenge"]')
            if captcha_visible:
                raise CaptchaDetected("CAPTCHA challenge detected on Collin County portal")
            
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
                raise CountyPortalUnavailable("Could not find search input on Collin portal")

            # Submit search
            search_btn = await page.query_selector('button[type="submit"], button[aria-label*="search"], button:has-text("Search")')
            if search_btn:
                await search_btn.click()
            else:
                await search_input.press('Enter')
            
            await asyncio.sleep(5.0)  # Extra wait for slower server

            try:
                # Wait for table container first
                await page.wait_for_selector('table, .results, .no-results, #results', timeout=20000)
                # Then wait for actual data cells (not just loading skeleton)
                await page.wait_for_selector('table tbody tr td', timeout=15000)
            except PlaywrightTimeout:
                logger.warning("No results selector found, checking page content")
            
            records = await self._extract_results(page, name)
            
            # Handle pagination
            page_num = 1
            while page_num < 15:  # Lower limit for slower server
                next_button = await page.query_selector('a:has-text("Next"), input[value*="Next"]')
                
                if not next_button:
                    break
                
                await next_button.click()
                await asyncio.sleep(self.rate_limit)
                
                try:
                    await page.wait_for_selector('table tbody tr', timeout=15000)
                    page_records = await self._extract_results(page, name)
                    if not page_records:
                        break
                    records.extend(page_records)
                except PlaywrightTimeout:
                    break
                    
                page_num += 1
            
            logger.info(f"Found {len(records)} records in Collin County for {name}")
            return records
            
        except PlaywrightTimeout as e:
            logger.error(f"Timeout on Collin County portal: {e}")
            raise CountyPortalUnavailable(f"Collin County portal timeout: {e}")
            
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
            return records

        for row in rows:
            try:
                cells = await row.query_selector_all('td')

                if len(cells) < 8:
                    continue

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

                doc_type = self.normalize_document_type(doc_type_raw)
                if not doc_type:
                    continue

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
                logger.debug(f"Error parsing Collin row: {e}")
                continue

        return records
    
    async def search_by_date_range(
        self,
        start: date,
        end: date,
        document_types: list[str] = None
    ) -> list[LienRecord]:
        """Search Collin County by date range."""
        logger.info(f"Searching Collin County from {start} to {end}")
        
        playwright = None
        browser = None
        context = None
        
        try:
            playwright, browser, context, page = await self.create_browser_context()
            
            await page.goto(self.SEARCH_URL, wait_until='networkidle', timeout=self.timeout)
            await asyncio.sleep(1.5)
            
            start_input = await page.query_selector('input[name*="start"]')
            end_input = await page.query_selector('input[name*="end"]')
            
            if start_input:
                await start_input.fill(start.strftime('%m/%d/%Y'))
            if end_input:
                await end_input.fill(end.strftime('%m/%d/%Y'))
            
            submit = await page.query_selector('input[type="submit"], button[type="submit"]')
            if submit:
                await submit.click()
            
            await asyncio.sleep(3.0)
            
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
        print("Usage: python -m scrapers.county_liens.collin <business_name>")
        sys.exit(1)
    
    name = ' '.join(sys.argv[1:])
    
    scraper = CollinCountyScraper()
    try:
        results = await scraper.search_with_retry(name)
        print(f"\nFound {len(results)} records:")
        for r in results:
            print(f"  {r['document_type']}: {r['grantee']} - ${r.get('amount', 'N/A')} ({r['filing_date']})")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == '__main__':
    asyncio.run(main())
