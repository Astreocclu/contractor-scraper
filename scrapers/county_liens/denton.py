"""
Denton County Official Public Records scraper.

Portal: https://apps.dentoncounty.gov/CountyClerk/Search
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


class DentonCountyScraper(BaseCountyLienScraper):
    """
    Scraper for Denton County Official Public Records.
    
    Denton County uses a modern search portal at apps.dentoncounty.gov.
    """
    
    COUNTY_NAME = "denton"
    BASE_URL = "https://apps.dentoncounty.gov/CountyClerk/Search"
    SEARCH_URL = "https://apps.dentoncounty.gov/CountyClerk/Search"
    
    async def search_by_name(self, name: str) -> list[LienRecord]:
        """
        Search Denton County records by grantee (debtor) name.
        """
        logger.info(f"Searching Denton County for: {name}")
        
        playwright = None
        browser = None
        context = None
        
        try:
            playwright, browser, context, page = await self.create_browser_context()
            
            await page.goto(self.SEARCH_URL, wait_until='networkidle', timeout=self.timeout)
            await asyncio.sleep(1.0)
            
            content = await page.content()
            if 'captcha' in content.lower():
                raise CaptchaDetected("CAPTCHA detected on Denton County portal")
            
            # Look for name search fields
            # Denton may have separate grantor/grantee fields
            grantee_input = await page.query_selector(
                'input[name*="grantee"], input#grantee, '
                'input[placeholder*="Grantee"], input[aria-label*="Grantee"]'
            )
            
            if grantee_input:
                await grantee_input.fill(name)
            else:
                # Try generic name field
                name_input = await page.query_selector('input[name*="name"], input[type="text"]')
                if name_input:
                    await name_input.fill(name)
            
            # Set date range
            end_date = date.today()
            start_date = end_date - timedelta(days=365 * 10)
            
            try:
                start_input = await page.query_selector(
                    'input[name*="start"], input[name*="from"], '
                    'input[name*="Begin"], input#startDate'
                )
                end_input = await page.query_selector(
                    'input[name*="end"], input[name*="to"], '
                    'input[name*="End"], input#endDate'
                )
                
                if start_input:
                    await start_input.fill(start_date.strftime('%m/%d/%Y'))
                if end_input:
                    await end_input.fill(end_date.strftime('%m/%d/%Y'))
            except Exception:
                pass
            
            # Submit search
            submit = await page.query_selector(
                'button[type="submit"], input[type="submit"], '
                'button:has-text("Search"), button:has-text("Find")'
            )
            if submit:
                await submit.click()
            else:
                await page.keyboard.press('Enter')
            
            await asyncio.sleep(2.0)
            
            try:
                await page.wait_for_selector('table, .results, .search-results, #results', timeout=15000)
            except PlaywrightTimeout:
                logger.warning("No results container found")
            
            records = await self._extract_results(page, name)
            
            # Handle pagination
            page_num = 1
            while page_num < 20:
                next_button = await page.query_selector(
                    'a:has-text("Next"), button:has-text("Next"), '
                    'li.next a, .pagination-next'
                )
                
                if not next_button:
                    break
                
                is_disabled = await next_button.get_attribute('disabled')
                classes = await next_button.get_attribute('class') or ''
                if is_disabled or 'disabled' in classes:
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
            
            logger.info(f"Found {len(records)} records in Denton County for {name}")
            return records
            
        except PlaywrightTimeout as e:
            logger.error(f"Timeout on Denton County portal: {e}")
            raise CountyPortalUnavailable(f"Denton County portal timeout: {e}")
            
        finally:
            if playwright and browser and context:
                await self.cleanup(playwright, browser, context)
    
    async def _extract_results(self, page, search_name: str) -> list[LienRecord]:
        """Extract lien records from results page."""
        records = []
        
        # Try multiple selector patterns
        rows = await page.query_selector_all('table tbody tr')
        
        if not rows:
            rows = await page.query_selector_all('.result-row, .search-result, [class*="result"]')
        
        if not rows:
            return records
        
        for row in rows:
            try:
                cells = await row.query_selector_all('td, .cell')
                
                if len(cells) < 4:
                    continue
                
                cell_texts = []
                for cell in cells:
                    text = await cell.inner_text()
                    cell_texts.append(text.strip())
                
                # Parse fields
                instrument_number = cell_texts[0] if len(cell_texts) > 0 else ''
                doc_type_raw = cell_texts[1] if len(cell_texts) > 1 else ''
                filing_date_str = cell_texts[2] if len(cell_texts) > 2 else ''
                grantor = cell_texts[3] if len(cell_texts) > 3 else ''
                grantee = cell_texts[4] if len(cell_texts) > 4 else ''
                amount_str = cell_texts[5] if len(cell_texts) > 5 else ''
                
                doc_type = self.normalize_document_type(doc_type_raw)
                if not doc_type:
                    continue
                
                filing_date = self.parse_date(filing_date_str)
                if not filing_date:
                    continue
                
                amount = self.parse_amount(amount_str)
                
                record = LienRecord(
                    county=self.COUNTY_NAME,
                    instrument_number=instrument_number,
                    document_type=doc_type,
                    grantor=grantor,
                    grantee=grantee,
                    filing_date=filing_date,
                    amount=amount,
                    source_url=self.SEARCH_URL,
                    raw_data={
                        'search_term': search_name,
                        'doc_type_raw': doc_type_raw,
                        'cell_texts': cell_texts,
                    }
                )
                records.append(record)
                
            except Exception as e:
                logger.debug(f"Error parsing Denton row: {e}")
                continue
        
        return records
    
    async def search_by_date_range(
        self,
        start: date,
        end: date,
        document_types: list[str] = None
    ) -> list[LienRecord]:
        """Search Denton County by date range."""
        logger.info(f"Searching Denton County from {start} to {end}")
        
        playwright = None
        browser = None
        context = None
        
        try:
            playwright, browser, context, page = await self.create_browser_context()
            
            await page.goto(self.SEARCH_URL, wait_until='networkidle', timeout=self.timeout)
            await asyncio.sleep(1.0)
            
            start_input = await page.query_selector('input[name*="start"], input[name*="Begin"]')
            end_input = await page.query_selector('input[name*="end"], input[name*="End"]')
            
            if start_input:
                await start_input.fill(start.strftime('%m/%d/%Y'))
            if end_input:
                await end_input.fill(end.strftime('%m/%d/%Y'))
            
            submit = await page.query_selector('button[type="submit"], input[type="submit"]')
            if submit:
                await submit.click()
            
            await asyncio.sleep(2.0)
            
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
        print("Usage: python -m scrapers.county_liens.denton <business_name>")
        sys.exit(1)
    
    name = ' '.join(sys.argv[1:])
    
    scraper = DentonCountyScraper()
    try:
        results = await scraper.search_with_retry(name)
        print(f"\nFound {len(results)} records:")
        for r in results:
            print(f"  {r['document_type']}: {r['grantee']} - ${r.get('amount', 'N/A')} ({r['filing_date']})")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == '__main__':
    asyncio.run(main())
