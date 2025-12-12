"""
Base class for county OPR (Official Public Records) scrapers.

Implements common patterns for searching Texas county clerk websites
for mechanic's liens, tax liens, and abstracts of judgment.
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime, date
from decimal import Decimal
from typing import Optional
from playwright.async_api import async_playwright, Browser, Page, TimeoutError as PlaywrightTimeout
from playwright_stealth import Stealth

logger = logging.getLogger(__name__)


# ============================================================
# DATA STRUCTURES
# ============================================================

@dataclass
class LienRecord:
    """Standardized lien record from any county."""
    
    # Source identification
    county: str
    instrument_number: str
    document_type: str  # MECH_LIEN, REL_LIEN, ABS_JUDG, FED_TAX_LIEN, STATE_TAX_LIEN
    
    # Parties
    grantor: str  # Who filed (creditor/plaintiff)
    grantee: str  # Who owes (debtor/defendant - the contractor)
    
    # Dates
    filing_date: date
    recording_date: Optional[date] = None
    
    # Amounts
    amount: Optional[Decimal] = None
    
    # Source
    source_url: str = ""
    
    # Raw data for debugging
    raw_data: dict = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        d = asdict(self)
        # Convert dates to ISO strings
        if d['filing_date']:
            d['filing_date'] = d['filing_date'].isoformat()
        if d['recording_date']:
            d['recording_date'] = d['recording_date'].isoformat()
        # Convert Decimal to float
        if d['amount']:
            d['amount'] = float(d['amount'])
        return d


# ============================================================
# CONSTANTS
# ============================================================

# Document types we're interested in
LIEN_DOCUMENT_TYPES = {
    # Mechanic's Liens
    'MECH LIEN': 'MECH_LIEN',
    'MECHANICS LIEN': 'MECH_LIEN',
    'MECHANIC\'S LIEN': 'MECH_LIEN',
    'MECHANICS LIEN AFFIDAVIT': 'MECH_LIEN',
    'MECHANICS LIEN & AFFIDAVIT': 'MECH_LIEN',
    'MEC LIEN': 'MECH_LIEN',
    'ML': 'MECH_LIEN',
    'LIEN': 'MECH_LIEN',  # Generic lien treated as mechanic's

    # Releases
    'REL LIEN': 'REL_LIEN',
    'RELEASE LIEN': 'REL_LIEN',
    'RELEASE OF LIEN': 'REL_LIEN',
    'RELEASE': 'REL_LIEN',
    'RLS': 'REL_LIEN',
    'REL': 'REL_LIEN',
    'RELEASE OF STATE TAX LIEN': 'REL_LIEN',

    # Abstracts of Judgment
    'ABS JUDG': 'ABS_JUDG',
    'ABSTRACT JUDGMENT': 'ABS_JUDG',
    'ABSTRACT OF JUDGMENT': 'ABS_JUDG',
    'AJ': 'ABS_JUDG',

    # Federal Tax Liens
    'FED TAX LIEN': 'FED_TAX_LIEN',
    'FEDERAL TAX LIEN': 'FED_TAX_LIEN',
    'FEDERAL TAX LIEN ON REAL PROPERTY': 'FED_TAX_LIEN',
    'FTL': 'FED_TAX_LIEN',

    # State Tax Liens
    'STATE TAX LIEN': 'STATE_TAX_LIEN',
    'STATE TAX LIEN - PROPERTY': 'STATE_TAX_LIEN',
    'ST TAX LIEN': 'STATE_TAX_LIEN',
    'STL': 'STATE_TAX_LIEN',
}

# Severity mapping for scoring
LIEN_SEVERITY = {
    'FED_TAX_LIEN': 'CRITICAL',
    'ABS_JUDG': 'CRITICAL',
    'STATE_TAX_LIEN': 'HIGH',
    'MECH_LIEN': 'HIGH',
    'REL_LIEN': 'CONTEXT',  # Not a red flag - provides context
}

# Rate limits per county (requests per minute)
RATE_LIMITS = {
    'tarrant': 60,  # 1 per second
    'dallas': 60,
    'collin': 30,   # More conservative
    'denton': 60,
}


# ============================================================
# EXCEPTIONS
# ============================================================

class LienScraperError(Exception):
    """Base exception for lien scraping."""
    pass


class CountyPortalUnavailable(LienScraperError):
    """County portal is down or blocked."""
    pass


class RateLimitExceeded(LienScraperError):
    """Too many requests - back off."""
    pass


class NoResultsFound(LienScraperError):
    """Search returned no results (may be valid/expected)."""
    pass


class CaptchaDetected(LienScraperError):
    """Portal is showing CAPTCHA."""
    pass


# ============================================================
# BASE SCRAPER
# ============================================================

class BaseCountyLienScraper(ABC):
    """
    Base class for county OPR scrapers.
    
    Each county has its own portal with different HTML structure,
    but the patterns are similar:
    1. Navigate to search page
    2. Fill in search form (name, date range, document types)
    3. Submit and wait for results
    4. Extract results from table
    5. Handle pagination
    """
    
    # Must be set by subclasses
    COUNTY_NAME: str = ""
    BASE_URL: str = ""
    
    def __init__(self, headless: bool = True, debug: bool = False):
        self.rate_limit = RATE_LIMITS.get(self.COUNTY_NAME.lower(), 60) / 60  # Seconds between requests
        self.timeout = 30000  # 30 second timeout
        self.max_results = 500  # Safety limit
        self.headless = headless
        self.debug = debug
    
    @abstractmethod
    async def search_by_name(self, name: str) -> list[LienRecord]:
        """
        Search for liens by grantor/grantee name.
        
        Args:
            name: Business or person name to search
            
        Returns:
            List of LienRecord objects
        """
        pass
    
    @abstractmethod
    async def search_by_date_range(
        self, 
        start: date, 
        end: date,
        document_types: list[str] = None
    ) -> list[LienRecord]:
        """
        Search all liens in date range.
        
        Args:
            start: Start date
            end: End date
            document_types: Optional filter by document type
            
        Returns:
            List of LienRecord objects
        """
        pass
    
    async def search_with_retry(
        self, 
        name: str, 
        max_retries: int = 3
    ) -> list[dict]:
        """
        Execute search with retry logic and exponential backoff.
        
        Args:
            name: Search term
            max_retries: Maximum retry attempts
            
        Returns:
            List of lien record dicts
        """
        last_error = None
        
        for attempt in range(max_retries):
            try:
                records = await self.search_by_name(name)
                return [r.to_dict() for r in records]
            
            except (PlaywrightTimeout, CountyPortalUnavailable) as e:
                last_error = e
                wait_time = 2 ** attempt  # 1, 2, 4 seconds
                logger.warning(f"Attempt {attempt + 1} failed for {self.COUNTY_NAME}: {e}. Retrying in {wait_time}s")
                await asyncio.sleep(wait_time)
                
            except RateLimitExceeded as e:
                last_error = e
                logger.warning(f"Rate limited on {self.COUNTY_NAME}, waiting 60s")
                await asyncio.sleep(60)
                
            except CaptchaDetected as e:
                logger.error(f"CAPTCHA detected on {self.COUNTY_NAME} - manual intervention needed")
                raise
                
            except Exception as e:
                logger.error(f"Unexpected error on {self.COUNTY_NAME}: {e}")
                raise
        
        # All retries exhausted
        logger.error(f"All retries failed for {self.COUNTY_NAME}: {last_error}")
        return []
    
    def normalize_document_type(self, doc_type: str) -> Optional[str]:
        """
        Normalize document type to standard enum value.
        
        Args:
            doc_type: Raw document type string from portal
            
        Returns:
            Normalized type or None if not a lien type we care about
        """
        if not doc_type:
            return None
        
        doc_type_upper = doc_type.upper().strip()
        return LIEN_DOCUMENT_TYPES.get(doc_type_upper)
    
    def parse_amount(self, amount_str: str) -> Optional[Decimal]:
        """
        Parse amount string to Decimal.
        
        Handles: "$1,234.56", "1234.56", "1,234", etc.
        """
        if not amount_str:
            return None
        
        # Remove currency symbols and commas
        cleaned = amount_str.replace('$', '').replace(',', '').strip()
        
        try:
            return Decimal(cleaned)
        except Exception:
            return None
    
    def parse_date(self, date_str: str) -> Optional[date]:
        """
        Parse date string to date object.
        
        Handles: "12/25/2024", "2024-12-25", "Dec 25, 2024", etc.
        """
        if not date_str:
            return None
        
        date_str = date_str.strip()
        
        # Try common formats
        formats = [
            '%m/%d/%Y',      # 12/25/2024
            '%Y-%m-%d',      # 2024-12-25
            '%m-%d-%Y',      # 12-25-2024
            '%b %d, %Y',     # Dec 25, 2024
            '%B %d, %Y',     # December 25, 2024
            '%m/%d/%y',      # 12/25/24
        ]
        
        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt).date()
            except ValueError:
                continue
        
        logger.warning(f"Could not parse date: {date_str}")
        return None
    
    async def create_browser_context(self) -> tuple:
        """
        Create Playwright browser and context with anti-detection settings.
        
        Returns:
            Tuple of (playwright, browser, context, page)
        """
        playwright = await async_playwright().start()
        
        browser = await playwright.chromium.launch(
            headless=self.headless,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
            ]
        )
        
        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale='en-US',
        )
        
        page = await context.new_page()

        # Apply stealth settings to avoid bot detection
        stealth = Stealth()
        await stealth.apply_stealth_async(page)

        # Set extra headers
        await page.set_extra_http_headers({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        })
        
        return playwright, browser, context, page
    
    async def cleanup(self, playwright, browser, context):
        """Clean up browser resources."""
        try:
            await context.close()
            await browser.close()
            await playwright.stop()
        except Exception as e:
            logger.warning(f"Cleanup error: {e}")


def classify_severity(record: LienRecord) -> str:
    """
    Get severity level for a lien record.
    
    Returns: CRITICAL, HIGH, MODERATE, or CONTEXT
    """
    return LIEN_SEVERITY.get(record.document_type, 'MODERATE')
