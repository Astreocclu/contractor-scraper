"""
Base scraper class with common functionality.
"""

import os
import re
import time
import random
import logging
from abc import ABC, abstractmethod
from datetime import date, datetime, timedelta
from typing import List, Optional
from dataclasses import dataclass, field, asdict

from django.conf import settings
from django.utils import timezone

from clients.models import Permit, ScraperRun


# Rate limiting settings
SCRAPE_DELAY_MIN = float(os.getenv("SCRAPE_DELAY_MIN", 2))
SCRAPE_DELAY_MAX = float(os.getenv("SCRAPE_DELAY_MAX", 5))
MAX_RETRIES = 3

# HTTP headers for requests
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
}


@dataclass
class ScrapedPermit:
    """Raw permit data from city portal (intermediate format before Django model)."""
    permit_id: str
    city: str
    property_address: str
    permit_type: str
    description: str = ""
    status: str = ""
    issued_date: Optional[date] = None
    applicant_name: Optional[str] = None
    contractor_name: Optional[str] = None
    estimated_value: Optional[float] = None
    city_name: Optional[str] = None
    zip_code: Optional[str] = None
    scraped_at: datetime = field(default_factory=datetime.now)

    def to_dict(self):
        d = asdict(self)
        if d['issued_date']:
            d['issued_date'] = d['issued_date'].isoformat()
        if d['scraped_at']:
            d['scraped_at'] = d['scraped_at'].isoformat()
        return d


def rate_limit():
    """Random delay between requests to avoid rate limiting."""
    delay = SCRAPE_DELAY_MIN + random.random() * (SCRAPE_DELAY_MAX - SCRAPE_DELAY_MIN)
    time.sleep(delay)


def normalize_address(addr: str) -> str:
    """
    Normalize address for consistent matching between sources.
    Converts to uppercase, standardizes abbreviations, removes apartment numbers.
    """
    if not addr:
        return ""

    addr = addr.upper().strip()

    # Remove "UNITED STATES" suffix
    addr = re.sub(r',?\s*UNITED STATES\s*$', '', addr, flags=re.IGNORECASE)

    # Remove extra whitespace
    addr = re.sub(r'\s+', ' ', addr)

    # Standard abbreviations
    replacements = {
        " STREET": " ST",
        " AVENUE": " AVE",
        " DRIVE": " DR",
        " BOULEVARD": " BLVD",
        " ROAD": " RD",
        " LANE": " LN",
        " COURT": " CT",
        " CIRCLE": " CIR",
        " PLACE": " PL",
        " PARKWAY": " PKWY",
        " HIGHWAY": " HWY",
        " NORTH ": " N ",
        " SOUTH ": " S ",
        " EAST ": " E ",
        " WEST ": " W ",
        ".": "",
    }

    for old, new in replacements.items():
        addr = addr.replace(old, new)

    # Remove apartment/unit numbers for matching
    addr = re.sub(r'\s+(APT|UNIT|STE|SUITE|#)\s*\S*$', '', addr)

    return addr.strip()


def parse_date(date_str: str) -> Optional[date]:
    """Parse any reasonable date format."""
    if not date_str:
        return None

    try:
        from dateutil import parser as date_parser
        return date_parser.parse(date_str).date()
    except Exception:
        return None


class BaseScraper(ABC):
    """
    Abstract base class for city permit scrapers.

    Subclasses must implement:
    - CITY: str - city slug (e.g., "fort_worth")
    - CITY_NAME: str - display name (e.g., "Fort Worth")
    - scrape() -> List[ScrapedPermit]
    """

    CITY: str = ""
    CITY_NAME: str = ""
    LOOKBACK_DAYS: int = 90

    def __init__(self, lookback_days: int = None):
        self.lookback_days = lookback_days or self.LOOKBACK_DAYS
        self.logger = logging.getLogger(f"scraper.{self.CITY}")
        self.scraper_run: Optional[ScraperRun] = None

    def start_run(self):
        """Create a scraper run record."""
        self.scraper_run = ScraperRun.objects.create(
            city=self.CITY,
            started_at=timezone.now(),
            status='running'
        )
        self.logger.info(f"Started scraper run {self.scraper_run.id} for {self.CITY_NAME}")

    def end_run(self, permits_found: int, errors: List[str] = None):
        """Complete the scraper run record."""
        if self.scraper_run:
            self.scraper_run.completed_at = timezone.now()
            self.scraper_run.status = 'success' if not errors else 'failed'
            self.scraper_run.permits_found = permits_found
            self.scraper_run.errors = errors or []
            self.scraper_run.save()
            self.logger.info(f"Completed scraper run: {permits_found} permits, status={self.scraper_run.status}")

    def save_permit(self, scraped: ScrapedPermit) -> Permit:
        """Save a scraped permit to the database."""
        permit, created = Permit.objects.update_or_create(
            city=scraped.city,
            permit_id=scraped.permit_id,
            defaults={
                'property_address': scraped.property_address,
                'property_address_normalized': normalize_address(scraped.property_address),
                'city_name': scraped.city_name,
                'zip_code': scraped.zip_code,
                'permit_type': scraped.permit_type,
                'description': scraped.description,
                'status': scraped.status,
                'issued_date': scraped.issued_date,
                'applicant_name': scraped.applicant_name,
                'contractor_name': scraped.contractor_name,
                'estimated_value': scraped.estimated_value,
                'scraped_at': timezone.now(),
            }
        )
        action = "Created" if created else "Updated"
        self.logger.debug(f"{action} permit {permit.permit_id}")
        return permit

    def save_all_permits(self, permits: List[ScrapedPermit]) -> int:
        """Save all scraped permits and return count of saved."""
        saved = 0
        for permit in permits:
            try:
                self.save_permit(permit)
                saved += 1
            except Exception as e:
                self.logger.warning(f"Error saving permit {permit.permit_id}: {e}")
        return saved

    def get_date_range(self) -> tuple:
        """Get the date range for scraping."""
        end_date = date.today()
        start_date = end_date - timedelta(days=self.lookback_days)
        return start_date, end_date

    @abstractmethod
    def scrape(self) -> List[ScrapedPermit]:
        """
        Main scraping method. Must be implemented by subclasses.
        Returns list of ScrapedPermit objects.
        """
        pass

    def run(self) -> int:
        """
        Execute the full scraping workflow.
        Returns number of permits saved.
        """
        self.start_run()
        errors = []
        permits = []

        try:
            permits = self.scrape()
            saved = self.save_all_permits(permits)
            self.logger.info(f"Saved {saved} of {len(permits)} permits")
        except Exception as e:
            self.logger.error(f"Scraping failed: {e}")
            errors.append(str(e))
            saved = 0
        finally:
            self.end_run(len(permits), errors if errors else None)

        return saved
