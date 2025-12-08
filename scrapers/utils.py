"""
Shared utilities for all scrapers.
Implements patterns from WEB_SCRAPING_DIRECTIVE.

Tier Hierarchy:
  1. httpx + BeautifulSoup (static HTML)
  2. Playwright (JavaScript-rendered)
  3. Playwright + Stealth (anti-bot sites)
"""

import asyncio
import hashlib
import json
import logging
import random
import re
from collections import defaultdict
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


# ============================================================
# USER AGENTS
# ============================================================

USER_AGENTS = [
    # Chrome Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # Chrome Mac
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    # Firefox Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    # Safari Mac
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    # Edge Windows
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
]

HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def get_random_user_agent() -> str:
    """Get a random user agent string."""
    return random.choice(USER_AGENTS)


def get_headers() -> dict:
    """Get headers with random user agent."""
    return {**HEADERS, "User-Agent": get_random_user_agent()}


# ============================================================
# RATE LIMITING
# ============================================================

class RateLimiter:
    """
    Per-domain rate limiting.

    Rate limits by source type:
      - Government portals: 5-10 rpm
      - Review sites: 10-20 rpm
      - News sites: 20-30 rpm
    """

    LIMITS = {
        # Government (conservative)
        "tdlr.texas.gov": 5,
        "cpa.state.tx.us": 5,
        "sos.state.tx.us": 5,
        # Review sites
        "bbb.org": 10,
        "yelp.com": 10,
        "google.com": 10,
        # Court systems
        "tarrantcounty.com": 5,
        "dallascounty.org": 5,
        # Default
        "default": 15,
    }

    def __init__(self):
        self.requests: dict[str, list[datetime]] = defaultdict(list)

    def _get_domain(self, url_or_domain: str) -> str:
        """Extract domain from URL or return as-is."""
        if "://" in url_or_domain:
            return url_or_domain.split("/")[2]
        return url_or_domain

    def _get_limit(self, domain: str) -> int:
        """Get rate limit for domain."""
        for key, limit in self.LIMITS.items():
            if key in domain:
                return limit
        return self.LIMITS["default"]

    async def acquire(self, url_or_domain: str):
        """Wait if necessary to respect rate limit."""
        domain = self._get_domain(url_or_domain)
        rpm = self._get_limit(domain)
        now = datetime.now()
        minute_ago = now - timedelta(minutes=1)

        # Clean old requests
        self.requests[domain] = [t for t in self.requests[domain] if t > minute_ago]

        # Wait if at limit
        if len(self.requests[domain]) >= rpm:
            oldest = self.requests[domain][0]
            wait_time = (oldest + timedelta(minutes=1) - now).total_seconds()
            if wait_time > 0:
                logger.info(f"Rate limit: waiting {wait_time:.1f}s for {domain}")
                await asyncio.sleep(wait_time)
                # Clean again after waiting
                now = datetime.now()
                minute_ago = now - timedelta(minutes=1)
                self.requests[domain] = [t for t in self.requests[domain] if t > minute_ago]

        self.requests[domain].append(now)


# Global rate limiter instance
rate_limiter = RateLimiter()


# ============================================================
# CACHING
# ============================================================

class ScraperCache:
    """
    File-based cache with TTL by source type.

    TTL by source:
      - TDLR, SOS, BBB: 7 days (data changes slowly)
      - Reviews: 1 day (more dynamic)
      - Court records: 3 days
      - News: 6 hours
    """

    TTL = {
        "tdlr": timedelta(days=7),
        "sos": timedelta(days=7),
        "bbb": timedelta(days=7),
        "google_reviews": timedelta(days=1),
        "yelp": timedelta(days=1),
        "court_records": timedelta(days=3),
        "news": timedelta(hours=6),
        "permits": timedelta(days=7),
    }

    DEFAULT_TTL = timedelta(days=1)

    def __init__(self, cache_dir: str = ".scraper_cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)

    def _get_key(self, source: str, identifier: str) -> str:
        """Generate cache key from source and identifier."""
        raw = f"{source}:{identifier}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def _get_path(self, key: str) -> Path:
        """Get file path for cache key."""
        return self.cache_dir / f"{key}.json"

    def get(self, source: str, identifier: str) -> Optional[Any]:
        """
        Get cached data if fresh.

        Args:
            source: Data source name (tdlr, bbb, yelp, etc.)
            identifier: Unique identifier (business name, etc.)

        Returns:
            Cached data or None if not found/stale
        """
        key = self._get_key(source, identifier)
        path = self._get_path(key)

        if not path.exists():
            return None

        try:
            with open(path, 'r') as f:
                cached = json.load(f)
        except (json.JSONDecodeError, IOError):
            return None

        cached_at = datetime.fromisoformat(cached['cached_at'])
        ttl = self.TTL.get(source, self.DEFAULT_TTL)

        if datetime.now() - cached_at > ttl:
            path.unlink()  # Delete stale cache
            return None

        logger.debug(f"Cache hit: {source}:{identifier}")
        return cached['data']

    def set(self, source: str, identifier: str, data: Any):
        """
        Cache data.

        Args:
            source: Data source name
            identifier: Unique identifier
            data: Data to cache (must be JSON-serializable)
        """
        key = self._get_key(source, identifier)
        path = self._get_path(key)

        with open(path, 'w') as f:
            json.dump({
                'source': source,
                'identifier': identifier,
                'cached_at': datetime.now().isoformat(),
                'data': data
            }, f)

        logger.debug(f"Cached: {source}:{identifier}")

    def clear(self, source: Optional[str] = None):
        """
        Clear cache, optionally by source.

        Args:
            source: If provided, only clear cache for this source
        """
        for path in self.cache_dir.glob("*.json"):
            if source:
                try:
                    with open(path, 'r') as f:
                        cached = json.load(f)
                    if cached.get('source') == source:
                        path.unlink()
                except (json.JSONDecodeError, IOError):
                    pass
            else:
                path.unlink()


# Global cache instance
cache = ScraperCache()


# ============================================================
# RETRY LOGIC
# ============================================================

T = TypeVar('T')


async def retry_with_backoff(
    func: Callable[[], Awaitable[T]],
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
) -> T:
    """
    Retry async function with exponential backoff.

    Args:
        func: Async function to retry
        max_retries: Maximum number of attempts
        base_delay: Initial delay in seconds
        max_delay: Maximum delay in seconds

    Returns:
        Result of successful function call

    Raises:
        Last exception if all retries fail
    """
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


# ============================================================
# EXCEPTIONS
# ============================================================

class ScraperError(Exception):
    """Base scraper exception."""
    pass


class RateLimitError(ScraperError):
    """Hit rate limit (HTTP 429)."""
    pass


class BlockedError(ScraperError):
    """Detected and blocked (HTTP 403)."""
    pass


class ContentNotFoundError(ScraperError):
    """Expected content missing from page."""
    pass


# ============================================================
# TIER 1: STATIC HTML (httpx + BeautifulSoup)
# ============================================================

async def fetch_static_page(url: str, timeout: float = 30.0) -> BeautifulSoup:
    """
    Fetch static HTML page with httpx.

    Use when: Page content exists in initial HTML response.
    Good for: BBB profiles, news articles, static permit pages.

    Args:
        url: URL to fetch
        timeout: Request timeout in seconds

    Returns:
        BeautifulSoup parsed HTML
    """
    domain = url.split("/")[2]
    await rate_limiter.acquire(domain)

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(url, headers=get_headers(), follow_redirects=True)

        if response.status_code == 429:
            raise RateLimitError(f"Rate limited at {url}")
        if response.status_code == 403:
            raise BlockedError(f"Blocked at {url}")

        response.raise_for_status()
        return BeautifulSoup(response.text, 'html.parser')


# ============================================================
# TIER 2: PLAYWRIGHT (JavaScript-rendered pages)
# ============================================================

async def create_browser(headless: bool = True) -> tuple:
    """
    Create Playwright browser instance.

    Returns:
        Tuple of (playwright, browser) - caller must close both
    """
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(
        headless=headless,
        args=[
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox',
        ]
    )
    return playwright, browser


async def fetch_js_page(
    browser: Browser,
    url: str,
    wait_for: Optional[str] = None,
    timeout: int = 30000
) -> str:
    """
    Fetch page that requires JavaScript rendering.

    Use when: Content requires JavaScript to render, forms need interaction.
    Good for: TDLR lookup, Texas SOS, review platforms.

    Args:
        browser: Playwright browser instance
        url: URL to fetch
        wait_for: CSS selector to wait for
        timeout: Navigation timeout in milliseconds

    Returns:
        Page HTML content
    """
    context = await browser.new_context(
        viewport={'width': 1920, 'height': 1080},
        user_agent=get_random_user_agent(),
        locale='en-US',
    )
    page = await context.new_page()

    try:
        await page.goto(url, wait_until='networkidle', timeout=timeout)
        if wait_for:
            await page.wait_for_selector(wait_for, timeout=10000)
        return await page.content()
    finally:
        await context.close()


# ============================================================
# HTML UTILITIES
# ============================================================

def clean_html(html: str) -> str:
    """
    Remove scripts, styles, SVGs, and normalize whitespace.

    Use before sending HTML to LLM for extraction.
    """
    html = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'<!--[\s\S]*?-->', '', html)
    html = re.sub(r'<svg[^>]*>[\s\S]*?</svg>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'\s+', ' ', html)
    return html


def parse_json(text: str) -> Optional[dict]:
    """
    Parse JSON from text, handling markdown code blocks.

    Tries:
      1. Direct JSON parse
      2. Extract from ```json ... ``` block
      3. Extract first { ... } object
    """
    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try markdown code block
    match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try first JSON object
    match = re.search(r'(\{[\s\S]*\})', text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    return None


# ============================================================
# PARALLEL EXECUTION
# ============================================================

async def scrape_batch(
    items: list[dict],
    scrape_func: Callable,
    max_concurrent: int = 5
) -> list[dict]:
    """
    Scrape multiple items with controlled concurrency.

    Args:
        items: List of items to scrape
        scrape_func: Async function that takes an item and returns data
        max_concurrent: Maximum concurrent scrapers

    Returns:
        List of {item, data, success} or {item, error, success: False}
    """
    semaphore = asyncio.Semaphore(max_concurrent)

    async def scrape_one(item: dict) -> dict:
        async with semaphore:
            try:
                data = await scrape_func(item)
                return {"item": item, "data": data, "success": True}
            except Exception as e:
                return {"item": item, "error": str(e), "success": False}

    return await asyncio.gather(*[scrape_one(i) for i in items])
