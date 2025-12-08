# Scraper Migration Plan: Puppeteer → Playwright

**Status:** Planning
**Created:** Dec 7, 2025
**Directive:** Follow `WEB_SCRAPING_DIRECTIVE.md` (httpx > Playwright > Playwright+Stealth)

---

## Overview

Migrate all remaining Puppeteer/Node.js scrapers to Python/Playwright following the tool hierarchy:
1. **Tier 1:** httpx + BeautifulSoup (static HTML)
2. **Tier 2:** Playwright (JavaScript-rendered pages)
3. **Tier 3:** Playwright + Stealth (anti-bot sites)

---

## Current State

### Already Migrated (Python/Playwright)
| File | Portal | Status |
|------|--------|--------|
| `scrapers/mgo_connect.py` | MGO Connect | ✅ Working |
| `scrapers/energov.py` | Tyler EnerGov | ✅ Working |
| `scrapers/accela.py` | Accela Citizen Access | ✅ Ready |
| `scrapers/dfw_big4_socrata.py` | Socrata/ArcGIS APIs | ✅ Working (httpx) |

### To Migrate
| Source | Current | Tier | Priority |
|--------|---------|------|----------|
| **TDLR** | `lib/tdlr_scraper.js` | Tier 2 (form) | HIGH |
| **Yelp** | `yelp_service.py` (API) | Tier 2 (scrape) | HIGH |
| **BBB** | `collection_service.js` | Tier 1 (static) | MEDIUM |
| **Google Maps** | `collection_service.js` | Tier 2 (JS) | MEDIUM |
| **TX SOS** | `collection_service.js` | Tier 2 (form) | MEDIUM |
| **Court Records** | `lib/court_scraper.js` | Tier 2/3 | LOW |

---

## Phase 1: Foundation (Create shared utilities)

### Task 1.1: Create `scrapers/utils.py`

Shared utilities following the directive:

```python
# scrapers/utils.py
"""
Shared utilities for all scrapers.
Implements patterns from WEB_SCRAPING_DIRECTIVE.
"""

import asyncio
import hashlib
import json
import logging
import random
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional, TypeVar

import httpx
from bs4 import BeautifulSoup
from playwright.async_api import (
    Browser,
    Page,
    TimeoutError as PlaywrightTimeout,
    async_playwright,
)

logger = logging.getLogger(__name__)

# ============== USER AGENTS ==============

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
]

HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

def get_random_user_agent() -> str:
    return random.choice(USER_AGENTS)

def get_headers() -> dict:
    return {**HEADERS, "User-Agent": get_random_user_agent()}


# ============== RATE LIMITING ==============

class RateLimiter:
    """Per-domain rate limiting."""

    LIMITS = {
        "tdlr.texas.gov": 5,
        "bbb.org": 10,
        "yelp.com": 10,
        "google.com": 10,
        "default": 15,
    }

    def __init__(self):
        self.requests = defaultdict(list)

    async def acquire(self, domain: str):
        """Wait if necessary to respect rate limit."""
        rpm = self.LIMITS.get(domain, self.LIMITS["default"])
        now = datetime.now()
        minute_ago = now - timedelta(minutes=1)

        self.requests[domain] = [t for t in self.requests[domain] if t > minute_ago]

        if len(self.requests[domain]) >= rpm:
            oldest = self.requests[domain][0]
            wait_time = (oldest + timedelta(minutes=1) - now).total_seconds()
            if wait_time > 0:
                logger.info(f"Rate limit: waiting {wait_time:.1f}s for {domain}")
                await asyncio.sleep(wait_time)

        self.requests[domain].append(now)


# Global rate limiter
rate_limiter = RateLimiter()


# ============== CACHING ==============

class ScraperCache:
    """File-based cache with TTL by source type."""

    TTL = {
        "tdlr": timedelta(days=7),
        "sos": timedelta(days=7),
        "bbb": timedelta(days=7),
        "google_reviews": timedelta(days=1),
        "yelp": timedelta(days=1),
        "court_records": timedelta(days=3),
    }

    DEFAULT_TTL = timedelta(days=1)

    def __init__(self, cache_dir: str = ".scraper_cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)

    def _get_key(self, source: str, identifier: str) -> str:
        raw = f"{source}:{identifier}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def _get_path(self, key: str) -> Path:
        return self.cache_dir / f"{key}.json"

    def get(self, source: str, identifier: str) -> Optional[Any]:
        key = self._get_key(source, identifier)
        path = self._get_path(key)

        if not path.exists():
            return None

        with open(path, 'r') as f:
            cached = json.load(f)

        cached_at = datetime.fromisoformat(cached['cached_at'])
        ttl = self.TTL.get(source, self.DEFAULT_TTL)

        if datetime.now() - cached_at > ttl:
            path.unlink()
            return None

        return cached['data']

    def set(self, source: str, identifier: str, data: Any):
        key = self._get_key(source, identifier)
        path = self._get_path(key)

        with open(path, 'w') as f:
            json.dump({
                'source': source,
                'identifier': identifier,
                'cached_at': datetime.now().isoformat(),
                'data': data
            }, f)


# Global cache
cache = ScraperCache()


# ============== RETRY LOGIC ==============

T = TypeVar('T')

async def retry_with_backoff(
    func: Callable[[], Awaitable[T]],
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
) -> T:
    """Retry async function with exponential backoff."""
    last_exception = None

    for attempt in range(max_retries):
        try:
            return await func()
        except Exception as e:
            last_exception = e
            if attempt < max_retries - 1:
                delay = min(base_delay * (2 ** attempt), max_delay)
                logger.warning(f"Attempt {attempt + 1} failed: {e}. Retrying in {delay}s")
                await asyncio.sleep(delay)

    raise last_exception


# ============== EXCEPTIONS ==============

class ScraperError(Exception):
    """Base scraper exception."""
    pass

class RateLimitError(ScraperError):
    """Hit rate limit."""
    pass

class BlockedError(ScraperError):
    """Detected and blocked."""
    pass

class ContentNotFoundError(ScraperError):
    """Expected content missing."""
    pass


# ============== TIER 1: STATIC HTML ==============

async def fetch_static_page(url: str) -> BeautifulSoup:
    """Fetch static HTML page with httpx."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        await rate_limiter.acquire(url.split('/')[2])
        response = await client.get(url, headers=get_headers(), follow_redirects=True)
        response.raise_for_status()
        return BeautifulSoup(response.text, 'html.parser')


# ============== TIER 2: PLAYWRIGHT ==============

async def fetch_js_page(
    browser: Browser,
    url: str,
    wait_for: Optional[str] = None,
    timeout: int = 30000
) -> str:
    """Fetch page that requires JavaScript rendering."""
    context = await browser.new_context(
        viewport={'width': 1920, 'height': 1080},
        user_agent=get_random_user_agent()
    )
    page = await context.new_page()

    try:
        await page.goto(url, wait_until='networkidle', timeout=timeout)
        if wait_for:
            await page.wait_for_selector(wait_for, timeout=10000)
        return await page.content()
    finally:
        await context.close()


# ============== HTML CLEANING ==============

def clean_html(html: str) -> str:
    """Remove scripts, styles, and normalize whitespace."""
    html = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'<!--[\s\S]*?-->', '', html)
    html = re.sub(r'<svg[^>]*>[\s\S]*?</svg>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'\s+', ' ', html)
    return html


# ============== JSON PARSING ==============

def parse_json(text: str) -> Optional[dict]:
    """Parse JSON from text, handling markdown code blocks."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text) or re.search(r'(\{[\s\S]*\})', text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    return None
```

### Task 1.2: Create `scrapers/deepseek.py`

DeepSeek API wrapper:

```python
# scrapers/deepseek.py
"""DeepSeek API client for data extraction."""

import os
import httpx

DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')


async def extract_with_deepseek(prompt: str, max_tokens: int = 4000) -> str:
    """Call DeepSeek API for extraction."""
    if not DEEPSEEK_API_KEY:
        raise ValueError("DEEPSEEK_API_KEY not set")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            'https://api.deepseek.com/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {DEEPSEEK_API_KEY}'
            },
            json={
                'model': 'deepseek-chat',
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0.1,
                'max_tokens': max_tokens
            },
            timeout=60.0
        )
        data = response.json()
        return data.get('choices', [{}])[0].get('message', {}).get('content', '')
```

---

## Phase 2: TDLR Scraper (HIGH PRIORITY)

### Task 2.1: Create `scrapers/tdlr.py`

Texas Department of Licensing and Regulation license lookup.

**Tier:** 2 (Playwright - form submission required)

**What it does:**
- Search for contractor licenses by business name
- Return license number, status, expiration, holder name

```python
# scrapers/tdlr.py
"""
TDLR LICENSE SCRAPER (Playwright Python)
Texas Department of Licensing and Regulation

Usage:
  python scrapers/tdlr.py "ABC Roofing"
"""

import asyncio
import sys
from dataclasses import dataclass
from typing import Optional

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

from scrapers.utils import (
    cache,
    rate_limiter,
    retry_with_backoff,
    get_random_user_agent,
    ScraperError,
    ContentNotFoundError,
)


@dataclass
class TDLRLicense:
    license_number: str
    license_type: str
    holder_name: str
    business_name: Optional[str]
    status: str  # Active, Expired, Revoked, etc.
    expiration_date: Optional[str]
    issue_date: Optional[str]


@dataclass
class TDLRResult:
    found: bool
    licenses: list[TDLRLicense]
    source: str = "tdlr"
    error: Optional[str] = None


async def scrape_tdlr(business_name: str, use_cache: bool = True) -> TDLRResult:
    """
    Search TDLR for contractor licenses.

    Note: Many home improvement trades don't require TX licenses.
    No license found != unlicensed fraud.
    """
    cache_key = business_name.lower().strip()

    if use_cache:
        cached = cache.get("tdlr", cache_key)
        if cached:
            return TDLRResult(**cached)

    await rate_limiter.acquire("tdlr.texas.gov")

    url = "https://www.tdlr.texas.gov/LicenseSearch/"

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--disable-blink-features=AutomationControlled']
        )
        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent=get_random_user_agent()
        )
        page = await context.new_page()

        try:
            await page.goto(url, wait_until='networkidle', timeout=30000)

            # Fill search form
            await page.fill('#SearchName', business_name)
            await page.select_option('#SearchType', 'Business')
            await page.click('button[type="submit"]')

            # Wait for results
            try:
                await page.wait_for_selector(
                    '.search-results, .no-results, #resultsTable, [class*="result"]',
                    timeout=15000
                )
            except PlaywrightTimeout:
                # Check page content for results manually
                pass

            # Check for no results
            no_results = await page.query_selector('.no-results, [class*="no-match"]')
            content = await page.content()

            if no_results or 'no records found' in content.lower():
                result = TDLRResult(found=False, licenses=[])
                cache.set("tdlr", cache_key, result.__dict__)
                return result

            # Parse results
            licenses = []
            rows = await page.query_selector_all('.result-row, #resultsTable tr, [class*="license-row"]')

            for row in rows:
                try:
                    license_num = await row.get_attribute('data-license')
                    if not license_num:
                        license_elem = await row.query_selector('[class*="license"], td:first-child')
                        license_num = await license_elem.inner_text() if license_elem else None

                    status_elem = await row.query_selector('.status, [class*="status"]')
                    status = await status_elem.inner_text() if status_elem else "Unknown"

                    exp_elem = await row.query_selector('.expiration, [class*="expir"]')
                    expiration = await exp_elem.inner_text() if exp_elem else None

                    holder_elem = await row.query_selector('.holder, [class*="name"]')
                    holder = await holder_elem.inner_text() if holder_elem else business_name

                    type_elem = await row.query_selector('.type, [class*="type"]')
                    license_type = await type_elem.inner_text() if type_elem else "Unknown"

                    if license_num:
                        licenses.append(TDLRLicense(
                            license_number=license_num.strip(),
                            license_type=license_type.strip(),
                            holder_name=holder.strip(),
                            business_name=business_name,
                            status=status.strip(),
                            expiration_date=expiration.strip() if expiration else None,
                            issue_date=None
                        ))
                except Exception:
                    continue

            result = TDLRResult(found=len(licenses) > 0, licenses=licenses)
            cache.set("tdlr", cache_key, {
                "found": result.found,
                "licenses": [l.__dict__ for l in result.licenses],
                "source": "tdlr"
            })
            return result

        except Exception as e:
            return TDLRResult(found=False, licenses=[], error=str(e))

        finally:
            await browser.close()


if __name__ == '__main__':
    name = sys.argv[1] if len(sys.argv) > 1 else "Orange Elephant Roofing"
    result = asyncio.run(scrape_tdlr(name))
    print(f"Found: {result.found}")
    print(f"Licenses: {len(result.licenses)}")
    for lic in result.licenses:
        print(f"  - {lic.license_number}: {lic.status} ({lic.license_type})")
```

---

## Phase 3: Yelp Scraper (HIGH PRIORITY)

### Task 3.1: Create `scrapers/yelp.py`

Replace the API-based `yelp_service.py` with Puppeteer scraping.

**Tier:** 2 (Playwright - JavaScript-heavy SPA)

**What it extracts:**
- Rating (1-5 stars)
- Review count
- Reviews (text, rating, date)
- Business URL

```python
# scrapers/yelp.py
"""
YELP SCRAPER (Playwright Python)
No API key required - scrapes public pages.

Usage:
  python scrapers/yelp.py "Orange Elephant Roofing" "Fort Worth, TX"
"""

import asyncio
import re
import sys
import urllib.parse
from dataclasses import dataclass
from typing import Optional

from playwright.async_api import async_playwright

from scrapers.utils import (
    cache,
    rate_limiter,
    get_random_user_agent,
    clean_html,
)
from scrapers.deepseek import extract_with_deepseek
from scrapers.utils import parse_json


@dataclass
class YelpReview:
    text: str
    rating: int
    date: str
    reviewer_name: str
    source: str = "yelp"


@dataclass
class YelpResult:
    found: bool
    yelp_url: Optional[str] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    reviews: list[YelpReview] = None
    source: str = "yelp"
    error: Optional[str] = None

    def __post_init__(self):
        if self.reviews is None:
            self.reviews = []


async def scrape_yelp(
    business_name: str,
    location: str = "Fort Worth, TX",
    max_reviews: int = 10,
    use_cache: bool = True
) -> YelpResult:
    """
    Scrape Yelp for business reviews.
    """
    cache_key = f"{business_name.lower()}:{location.lower()}"

    if use_cache:
        cached = cache.get("yelp", cache_key)
        if cached:
            return YelpResult(**cached)

    await rate_limiter.acquire("yelp.com")

    # Build search URL
    query = urllib.parse.quote(f"{business_name} {location}")
    search_url = f"https://www.yelp.com/search?find_desc={query}"

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--disable-blink-features=AutomationControlled']
        )
        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent=get_random_user_agent(),
            locale='en-US'
        )
        page = await context.new_page()

        try:
            # Step 1: Search for business
            await page.goto(search_url, wait_until='networkidle', timeout=30000)
            await asyncio.sleep(2)

            html = clean_html(await page.content())

            # Use DeepSeek to find the best matching business
            search_prompt = f'''Find the business "{business_name}" in these Yelp search results.

Look for:
1. Business name that closely matches "{business_name}"
2. Location matching "{location}"
3. Category: contractors, home services, roofing, etc.

Extract from the BEST match:
- name: Business name as shown
- url: The href link to the business page (starts with /biz/)
- rating: Star rating (1-5)
- review_count: Number of reviews

Return JSON:
{{"found": true/false, "name": "...", "url": "/biz/...", "rating": 4.5, "review_count": 123}}

If no good match found, return {{"found": false}}

HTML (first 50k chars):
{html[:50000]}'''

            response = await extract_with_deepseek(search_prompt)
            data = parse_json(response)

            if not data or not data.get('found') or not data.get('url'):
                result = YelpResult(found=False)
                cache.set("yelp", cache_key, result.__dict__)
                return result

            # Step 2: Navigate to business page
            biz_url = f"https://www.yelp.com{data['url']}"
            await page.goto(biz_url, wait_until='networkidle', timeout=30000)
            await asyncio.sleep(2)

            html = clean_html(await page.content())

            # Step 3: Extract reviews
            reviews_prompt = f'''Extract reviews from this Yelp business page.

Get up to {max_reviews} reviews with:
- text: The review text (first 500 chars)
- rating: Star rating (1-5)
- date: Review date
- reviewer_name: Reviewer's name

Also confirm:
- overall_rating: The business's overall star rating
- total_reviews: Total review count

Return JSON:
{{"overall_rating": 4.5, "total_reviews": 123, "reviews": [{{"text": "...", "rating": 5, "date": "12/1/2024", "reviewer_name": "John D."}}]}}

HTML (first 80k chars):
{html[:80000]}'''

            response = await extract_with_deepseek(reviews_prompt)
            reviews_data = parse_json(response)

            reviews = []
            if reviews_data and reviews_data.get('reviews'):
                for r in reviews_data['reviews'][:max_reviews]:
                    reviews.append(YelpReview(
                        text=r.get('text', '')[:500],
                        rating=r.get('rating', 0),
                        date=r.get('date', ''),
                        reviewer_name=r.get('reviewer_name', 'Anonymous')
                    ))

            result = YelpResult(
                found=True,
                yelp_url=biz_url,
                rating=reviews_data.get('overall_rating') if reviews_data else data.get('rating'),
                review_count=reviews_data.get('total_reviews') if reviews_data else data.get('review_count'),
                reviews=reviews
            )

            cache.set("yelp", cache_key, {
                "found": result.found,
                "yelp_url": result.yelp_url,
                "rating": result.rating,
                "review_count": result.review_count,
                "reviews": [r.__dict__ for r in result.reviews],
                "source": "yelp"
            })

            return result

        except Exception as e:
            return YelpResult(found=False, error=str(e))

        finally:
            await browser.close()


if __name__ == '__main__':
    name = sys.argv[1] if len(sys.argv) > 1 else "Orange Elephant Roofing"
    loc = sys.argv[2] if len(sys.argv) > 2 else "Fort Worth, TX"

    result = asyncio.run(scrape_yelp(name, loc))
    print(f"Found: {result.found}")
    if result.found:
        print(f"URL: {result.yelp_url}")
        print(f"Rating: {result.rating}")
        print(f"Reviews: {result.review_count}")
        print(f"\nSample reviews:")
        for r in result.reviews[:3]:
            print(f"  [{r.rating}★] {r.reviewer_name}: {r.text[:100]}...")
```

---

## Phase 4: BBB Scraper (MEDIUM PRIORITY)

### Task 4.1: Create `scrapers/bbb.py`

**Tier:** 1 (httpx + BeautifulSoup - mostly static HTML)

```python
# scrapers/bbb.py
"""
BBB SCRAPER (httpx + BeautifulSoup)
Static HTML - no browser needed.

Usage:
  python scrapers/bbb.py "Orange Elephant Roofing" "Fort Worth" "TX"
"""

import asyncio
import sys
import urllib.parse
from dataclasses import dataclass
from typing import Optional

import httpx
from bs4 import BeautifulSoup

from scrapers.utils import (
    cache,
    rate_limiter,
    get_headers,
    ScraperError,
)


@dataclass
class BBBResult:
    found: bool
    name: Optional[str] = None
    rating: Optional[str] = None  # A+, A, B, F, etc.
    accredited: bool = False
    profile_url: Optional[str] = None
    years_in_business: Optional[int] = None
    complaints: Optional[int] = None
    source: str = "bbb"
    error: Optional[str] = None


async def scrape_bbb(
    business_name: str,
    city: str = "Fort Worth",
    state: str = "TX",
    use_cache: bool = True
) -> BBBResult:
    """
    Scrape BBB for business profile.
    Uses httpx (Tier 1) - BBB search results are static HTML.
    """
    cache_key = f"{business_name.lower()}:{city.lower()}:{state.lower()}"

    if use_cache:
        cached = cache.get("bbb", cache_key)
        if cached:
            return BBBResult(**cached)

    await rate_limiter.acquire("bbb.org")

    # Build search URL
    query = urllib.parse.quote(business_name)
    location = urllib.parse.quote(f"{city}, {state}")
    search_url = f"https://www.bbb.org/search?find_text={query}&find_loc={location}&find_type=Category"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(search_url, headers=get_headers(), follow_redirects=True)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, 'html.parser')

            # Find business cards in search results
            # BBB uses various selectors - try multiple
            cards = (
                soup.select('[data-testid="search-result"]') or
                soup.select('.search-result-item') or
                soup.select('[class*="BusinessCard"]') or
                soup.select('.result-item')
            )

            if not cards:
                result = BBBResult(found=False)
                cache.set("bbb", cache_key, result.__dict__)
                return result

            # Get first matching result
            card = cards[0]

            # Extract rating (A+, A, B, F, etc.)
            rating_elem = (
                card.select_one('[class*="rating"]') or
                card.select_one('[class*="grade"]') or
                card.select_one('.bbb-rating')
            )
            rating = rating_elem.get_text(strip=True) if rating_elem else None

            # Extract name
            name_elem = (
                card.select_one('h3') or
                card.select_one('[class*="business-name"]') or
                card.select_one('a[href*="/business-reviews/"]')
            )
            name = name_elem.get_text(strip=True) if name_elem else None

            # Check accreditation
            accredited = bool(
                card.select_one('[class*="accredited"]') or
                card.select_one('[class*="Accredited"]') or
                'accredited' in card.get_text().lower()
            )

            # Get profile URL
            link = card.select_one('a[href*="/business-reviews/"]')
            profile_url = f"https://www.bbb.org{link['href']}" if link and link.get('href') else None

            result = BBBResult(
                found=True,
                name=name,
                rating=rating,
                accredited=accredited,
                profile_url=profile_url
            )

            cache.set("bbb", cache_key, result.__dict__)
            return result

        except httpx.HTTPStatusError as e:
            return BBBResult(found=False, error=f"HTTP {e.response.status_code}")
        except Exception as e:
            return BBBResult(found=False, error=str(e))


if __name__ == '__main__':
    name = sys.argv[1] if len(sys.argv) > 1 else "Orange Elephant Roofing"
    city = sys.argv[2] if len(sys.argv) > 2 else "Fort Worth"
    state = sys.argv[3] if len(sys.argv) > 3 else "TX"

    result = asyncio.run(scrape_bbb(name, city, state))
    print(f"Found: {result.found}")
    if result.found:
        print(f"Name: {result.name}")
        print(f"Rating: {result.rating}")
        print(f"Accredited: {result.accredited}")
        print(f"URL: {result.profile_url}")
```

---

## Phase 5: Google Maps Scraper (MEDIUM PRIORITY)

### Task 5.1: Create `scrapers/google_maps.py`

**Tier:** 2 (Playwright - heavy JavaScript)

**Important:** DO NOT use Google Places API (caused $300 overcharge).

```python
# scrapers/google_maps.py
"""
GOOGLE MAPS SCRAPER (Playwright Python)
DO NOT USE GOOGLE PLACES API - billing issues.

Usage:
  python scrapers/google_maps.py "Orange Elephant Roofing" "Fort Worth, TX"
"""

# Similar pattern to yelp.py
# - Search Google Maps for business
# - Extract rating, review count
# - Use DeepSeek to parse the JavaScript-rendered content
```

---

## Phase 6: Integration

### Task 6.1: Create `scrapers/contractor_scraper.py`

Orchestrates all scrapers for contractor audits:

```python
# scrapers/contractor_scraper.py
"""
CONTRACTOR SCRAPER ORCHESTRATOR

Runs all scrapers for a contractor and returns unified results.
Replaces collection_service.js for Python-based audits.

Usage:
  python scrapers/contractor_scraper.py "Orange Elephant Roofing" "Fort Worth, TX"
"""

import asyncio
from dataclasses import dataclass
from typing import Optional

from scrapers.tdlr import scrape_tdlr, TDLRResult
from scrapers.yelp import scrape_yelp, YelpResult
from scrapers.bbb import scrape_bbb, BBBResult
# from scrapers.google_maps import scrape_google_maps, GoogleMapsResult


@dataclass
class ContractorData:
    business_name: str
    location: str
    tdlr: Optional[TDLRResult] = None
    yelp: Optional[YelpResult] = None
    bbb: Optional[BBBResult] = None
    # google_maps: Optional[GoogleMapsResult] = None


async def scrape_contractor(
    business_name: str,
    location: str = "Fort Worth, TX",
    sources: list[str] = None
) -> ContractorData:
    """
    Scrape all sources for a contractor.

    Args:
        business_name: Company name
        location: City, State
        sources: List of sources to scrape. Default: all.
                 Options: tdlr, yelp, bbb, google_maps
    """
    if sources is None:
        sources = ["tdlr", "yelp", "bbb"]

    city = location.split(",")[0].strip()
    state = location.split(",")[1].strip() if "," in location else "TX"

    result = ContractorData(business_name=business_name, location=location)

    # Run scrapers concurrently (max 3 at a time)
    tasks = []

    if "tdlr" in sources:
        tasks.append(("tdlr", scrape_tdlr(business_name)))
    if "yelp" in sources:
        tasks.append(("yelp", scrape_yelp(business_name, location)))
    if "bbb" in sources:
        tasks.append(("bbb", scrape_bbb(business_name, city, state)))

    # Execute with semaphore for rate limiting
    semaphore = asyncio.Semaphore(3)

    async def run_with_semaphore(name, coro):
        async with semaphore:
            try:
                return name, await coro
            except Exception as e:
                print(f"Error in {name}: {e}")
                return name, None

    results = await asyncio.gather(*[run_with_semaphore(n, c) for n, c in tasks])

    for name, data in results:
        setattr(result, name, data)

    return result


if __name__ == '__main__':
    import sys
    name = sys.argv[1] if len(sys.argv) > 1 else "Orange Elephant Roofing"
    loc = sys.argv[2] if len(sys.argv) > 2 else "Fort Worth, TX"

    data = asyncio.run(scrape_contractor(name, loc))

    print(f"\n{'='*50}")
    print(f"CONTRACTOR: {data.business_name}")
    print(f"LOCATION: {data.location}")
    print(f"{'='*50}\n")

    if data.tdlr:
        print(f"TDLR: {'Licensed' if data.tdlr.found else 'No license found'}")
        if data.tdlr.licenses:
            for lic in data.tdlr.licenses:
                print(f"  - {lic.license_number}: {lic.status}")

    if data.bbb:
        print(f"\nBBB: {data.bbb.rating or 'Not rated'} {'(Accredited)' if data.bbb.accredited else ''}")

    if data.yelp:
        print(f"\nYelp: {data.yelp.rating or 'N/A'}★ ({data.yelp.review_count or 0} reviews)")
```

---

## File Structure After Migration

```
scrapers/
├── __init__.py
├── utils.py              # Shared utilities (rate limit, cache, retry)
├── deepseek.py           # DeepSeek API wrapper
├── tdlr.py               # TDLR license lookup (Tier 2)
├── yelp.py               # Yelp scraper (Tier 2)
├── bbb.py                # BBB scraper (Tier 1)
├── google_maps.py        # Google Maps scraper (Tier 2)
├── contractor_scraper.py # Orchestrator
├── mgo_connect.py        # (existing) Permit scraper
├── energov.py            # (existing) Permit scraper
├── accela.py             # (existing) Permit scraper
├── dfw_big4_socrata.py   # (existing) API-based permits
└── README.md
```

---

## Dependencies

Add to `requirements.txt`:

```
playwright>=1.40.0
playwright-stealth>=2.0.0
httpx>=0.25.0
beautifulsoup4>=4.12.0
lxml>=4.9.0
```

Install:

```bash
pip install playwright playwright-stealth httpx beautifulsoup4 lxml
playwright install chromium
```

---

## Migration Checklist

### Phase 1: Foundation
- [ ] Create `scrapers/utils.py`
- [ ] Create `scrapers/deepseek.py`
- [ ] Test utilities with existing scrapers

### Phase 2: TDLR
- [ ] Create `scrapers/tdlr.py`
- [ ] Test with known contractors (Orange Elephant)
- [ ] Integrate with audit pipeline

### Phase 3: Yelp
- [ ] Create `scrapers/yelp.py`
- [ ] Test scraping (no API key)
- [ ] Delete `contractors/services/yelp_service.py`
- [ ] Update TODO.md

### Phase 4: BBB
- [ ] Create `scrapers/bbb.py`
- [ ] Test with known contractors
- [ ] Compare output with existing JS scraper

### Phase 5: Google Maps
- [ ] Create `scrapers/google_maps.py`
- [ ] Test extraction
- [ ] Verify no API calls (billing!)

### Phase 6: Integration
- [ ] Create `scrapers/contractor_scraper.py`
- [ ] Test full pipeline
- [ ] Update `services/audit_agent.py` to use Python scrapers

### Cleanup
- [ ] Delete deprecated JS scrapers
- [ ] Update documentation
- [ ] Remove puppeteer from package.json (if safe)

---

## Testing

Test with known contractors:

```bash
# Bad contractor (expect CRITICAL score)
python scrapers/contractor_scraper.py "Orange Elephant Roofing" "Fort Worth, TX"

# Good contractor (expect higher score)
python scrapers/contractor_scraper.py "Sun Protection of Florida" "Tampa, FL"
```

---

*Last updated: Dec 7, 2025*
