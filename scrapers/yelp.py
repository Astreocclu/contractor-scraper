#!/usr/bin/env python3
"""
YELP SCRAPER (Playwright Python)

STATUS: LIMITED - Yelp uses DataDome anti-bot protection that blocks
most automated access. This scraper may fail with CAPTCHA errors.

Options for reliable Yelp data:
  1. Residential proxy service
  2. SerpAPI (paid, $50/mo for 5000 searches)
  3. Manual review during audits

For now, this scraper is included but may return not_found due to blocking.

Usage:
  python scrapers/yelp.py "Orange Elephant Roofing" "Fort Worth, TX"
  python scrapers/yelp.py "Smith Electric" --max-reviews 20
"""

import asyncio
import re
import sys
import urllib.parse
from dataclasses import dataclass, field
from typing import Optional

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

try:
    from scrapers.utils import (
        cache,
        rate_limiter,
        get_random_user_agent,
        clean_html,
    )
    from scrapers.deepseek import extract_json
except ImportError:
    from utils import (
        cache,
        rate_limiter,
        get_random_user_agent,
        clean_html,
    )
    from deepseek import extract_json


@dataclass
class YelpReview:
    """Individual Yelp review."""
    text: str
    rating: int
    date: str
    reviewer_name: str
    source: str = "yelp"


@dataclass
class YelpResult:
    """Yelp scrape result."""
    found: bool
    yelp_url: Optional[str] = None
    name: Optional[str] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    price: Optional[str] = None  # $, $$, $$$
    categories: list[str] = field(default_factory=list)
    reviews: list[YelpReview] = field(default_factory=list)
    source: str = "yelp"
    error: Optional[str] = None


async def scrape_yelp(
    business_name: str,
    location: str = "Fort Worth, TX",
    max_reviews: int = 10,
    use_cache: bool = True,
    headless: bool = True
) -> YelpResult:
    """
    Scrape Yelp for business reviews.

    Args:
        business_name: Business name to search for
        location: City, State to search in
        max_reviews: Maximum number of reviews to extract
        use_cache: Whether to use cached results
        headless: Whether to run browser headless

    Returns:
        YelpResult with business info and reviews
    """
    cache_key = f"{business_name.lower().strip()}:{location.lower().strip()}"

    # Check cache
    if use_cache:
        cached = cache.get("yelp", cache_key)
        if cached:
            reviews = [YelpReview(**r) for r in cached.get("reviews", [])]
            return YelpResult(
                found=cached["found"],
                yelp_url=cached.get("yelp_url"),
                name=cached.get("name"),
                rating=cached.get("rating"),
                review_count=cached.get("review_count"),
                price=cached.get("price"),
                categories=cached.get("categories", []),
                reviews=reviews,
                source="yelp"
            )

    # Rate limit
    await rate_limiter.acquire("yelp.com")

    result = YelpResult(found=False)

    # Build search URL
    query = urllib.parse.quote(f"{business_name}")
    loc = urllib.parse.quote(location)
    search_url = f"https://www.yelp.com/search?find_desc={query}&find_loc={loc}"

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled"]
        )
        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent=get_random_user_agent(),
            locale="en-US"
        )
        page = await context.new_page()

        try:
            # Step 1: Search for business
            print(f"[Yelp] Searching for: {business_name} in {location}")
            await page.goto(search_url, wait_until="networkidle", timeout=30000)
            await asyncio.sleep(2)

            html = await page.content()

            # Check for DataDome CAPTCHA block
            if "captcha" in html.lower() or "datadome" in html.lower() or len(html) < 5000:
                result.error = "Blocked by DataDome CAPTCHA - Yelp requires proxy or API access"
                return result

            html = clean_html(html)

            # Use DeepSeek to find matching business
            search_data = await _find_business_in_search(html, business_name, location)

            if not search_data or not search_data.get("found"):
                result.found = False
                _cache_result(cache_key, result)
                return result

            biz_path = search_data.get("url", "")
            if not biz_path or not biz_path.startswith("/biz/"):
                result.found = False
                _cache_result(cache_key, result)
                return result

            # Step 2: Navigate to business page
            biz_url = f"https://www.yelp.com{biz_path}"
            print(f"[Yelp] Found: {biz_url}")
            await page.goto(biz_url, wait_until="networkidle", timeout=30000)
            await asyncio.sleep(2)

            html = clean_html(await page.content())

            # Step 3: Extract business info and reviews
            biz_data = await _extract_business_data(html, max_reviews)

            if biz_data:
                result.found = True
                result.yelp_url = biz_url
                result.name = biz_data.get("name") or search_data.get("name")
                result.rating = biz_data.get("rating") or search_data.get("rating")
                result.review_count = biz_data.get("review_count") or search_data.get("review_count")
                result.price = biz_data.get("price")
                result.categories = biz_data.get("categories", [])

                # Parse reviews
                if biz_data.get("reviews"):
                    for r in biz_data["reviews"][:max_reviews]:
                        result.reviews.append(YelpReview(
                            text=r.get("text", "")[:500],
                            rating=r.get("rating", 0),
                            date=r.get("date", ""),
                            reviewer_name=r.get("reviewer_name", "Anonymous")
                        ))

            _cache_result(cache_key, result)
            return result

        except PlaywrightTimeout as e:
            result.error = f"Timeout: {e}"
            return result
        except Exception as e:
            result.error = f"Error: {e}"
            return result
        finally:
            await browser.close()


async def _find_business_in_search(html: str, business_name: str, location: str) -> Optional[dict]:
    """Use DeepSeek to find the business in search results."""
    prompt = f'''Find the business "{business_name}" in these Yelp search results.

Look for:
1. Business name that closely matches "{business_name}"
2. Location matching "{location}"
3. Category: contractors, home services, roofing, HVAC, plumbing, etc.

Extract from the BEST matching result:
- found: true if a good match exists
- name: Business name as shown
- url: The href link to the business page (starts with /biz/)
- rating: Star rating (1-5, can be decimal like 4.5)
- review_count: Number of reviews

Return JSON:
{{"found": true, "name": "...", "url": "/biz/...", "rating": 4.5, "review_count": 123}}

If no good match found, return {{"found": false}}

HTML (first 60k chars):
{html[:60000]}'''

    try:
        return await extract_json(prompt)
    except Exception:
        return None


async def _extract_business_data(html: str, max_reviews: int) -> Optional[dict]:
    """Use DeepSeek to extract business data and reviews."""
    prompt = f'''Extract business information and reviews from this Yelp business page.

Extract:
- name: Business name
- rating: Overall star rating (1-5, decimal)
- review_count: Total number of reviews
- price: Price level ($, $$, $$$, $$$$) if shown
- categories: List of business categories
- reviews: Up to {max_reviews} reviews with:
  - text: Review text (first 500 chars)
  - rating: Star rating (1-5)
  - date: Review date
  - reviewer_name: Reviewer's name/username

Return JSON:
{{
  "name": "...",
  "rating": 4.5,
  "review_count": 123,
  "price": "$$",
  "categories": ["Roofing", "Contractors"],
  "reviews": [
    {{"text": "...", "rating": 5, "date": "12/1/2024", "reviewer_name": "John D."}}
  ]
}}

HTML (first 80k chars):
{html[:80000]}'''

    try:
        return await extract_json(prompt)
    except Exception:
        return None


def _cache_result(cache_key: str, result: YelpResult):
    """Cache the result."""
    cache.set("yelp", cache_key, {
        "found": result.found,
        "yelp_url": result.yelp_url,
        "name": result.name,
        "rating": result.rating,
        "review_count": result.review_count,
        "price": result.price,
        "categories": result.categories,
        "reviews": [
            {
                "text": r.text,
                "rating": r.rating,
                "date": r.date,
                "reviewer_name": r.reviewer_name,
                "source": "yelp"
            }
            for r in result.reviews
        ],
        "source": "yelp"
    })


# ============================================================
# YAHOO SEARCH FALLBACK (Bypasses DataDome)
# ============================================================

async def scrape_yelp_via_yahoo(
    business_name: str,
    location: str = "Fort Worth, TX",
    use_cache: bool = True,
    headless: bool = True
) -> YelpResult:
    """
    Get Yelp rating via Yahoo Search (bypasses DataDome blocking).

    Yahoo Search shows Yelp rich snippets with:
    - Star rating (X.X/5)
    - Review count
    - Yelp URL

    This is more reliable than direct Yelp scraping.

    Args:
        business_name: Business name to search for
        location: City, State to search in
        use_cache: Whether to use cached results
        headless: Whether to run browser headless

    Returns:
        YelpResult with rating and review count (no individual reviews)
    """
    cache_key = f"yahoo_yelp:{business_name.lower().strip()}:{location.lower().strip()}"

    # Check cache
    if use_cache:
        cached = cache.get("yelp", cache_key)
        if cached:
            return YelpResult(
                found=cached["found"],
                yelp_url=cached.get("yelp_url"),
                name=cached.get("name"),
                rating=cached.get("rating"),
                review_count=cached.get("review_count"),
                source="yahoo_yelp"
            )

    # Rate limit
    await rate_limiter.acquire("search.yahoo.com")

    result = YelpResult(found=False, source="yahoo_yelp")

    # Build Yahoo search URL
    query = f"{business_name} {location} yelp".replace(" ", "+")
    search_url = f"https://search.yahoo.com/search?p={query}"

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled"]
        )
        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="en-US"
        )
        page = await context.new_page()

        # Stealth: remove webdriver detection
        await page.add_init_script("delete Object.getPrototypeOf(navigator).webdriver")

        try:
            print(f"[Yelp/Yahoo] Searching for: {business_name} in {location}")
            await page.goto(search_url, timeout=15000)
            await asyncio.sleep(3)

            body = await page.inner_text("body")
            html = await page.content()

            # Extract rating pattern: X.X/5 (N reviews)
            ratings = re.findall(r'(\d\.\d)/5\s*\((\d+)\)', body)

            # Extract Yelp URLs
            yelp_urls = list(set(re.findall(r'yelp\.com/biz/([^"&\s<>]+)', html)))

            if ratings:
                result.found = True
                result.rating = float(ratings[0][0])
                result.review_count = int(ratings[0][1])
                result.name = business_name
                print(f"[Yelp/Yahoo] Found: {result.rating}/5 ({result.review_count} reviews)")

            if yelp_urls:
                # Find best matching URL based on business name
                best_url = None
                best_score = 0
                normalized_name = business_name.lower().replace(' ', '-').replace("'", '').replace('.', '').replace(',', '')
                name_words = set(normalized_name.split('-'))

                for url_slug in yelp_urls:
                    # Skip search/category pages
                    if 'search?' in url_slug or url_slug.startswith('c/'):
                        continue
                    slug_words = set(url_slug.lower().split('-'))
                    # Calculate word overlap
                    overlap = len(name_words & slug_words)
                    # Bonus if first word matches
                    first_match = normalized_name.split('-')[0] in url_slug.lower()
                    score = overlap + (2 if first_match else 0)
                    if score > best_score:
                        best_score = score
                        best_url = url_slug

                if best_url and best_score >= 2:
                    result.found = True
                    result.yelp_url = f"https://www.yelp.com/biz/{best_url}"
                    print(f"[Yelp/Yahoo] Best URL match: {best_url} (score: {best_score})")
                elif yelp_urls:
                    # Fallback to first URL but warn
                    result.yelp_url = f"https://www.yelp.com/biz/{yelp_urls[0]}"
                    print(f"[Yelp/Yahoo] WARNING: No good URL match, using first: {yelp_urls[0]}")

                if not result.name:
                    result.name = business_name

            # Cache the result
            cache.set("yelp", cache_key, {
                "found": result.found,
                "yelp_url": result.yelp_url,
                "name": result.name,
                "rating": result.rating,
                "review_count": result.review_count,
                "source": "yahoo_yelp"
            })

            return result

        except Exception as e:
            result.error = f"Yahoo search error: {e}"
            return result
        finally:
            await browser.close()


async def scrape_yelp_with_fallback(
    business_name: str,
    location: str = "Fort Worth, TX",
    max_reviews: int = 10,
    use_cache: bool = True,
    headless: bool = True
) -> YelpResult:
    """
    Try direct Yelp scraping first, fall back to Yahoo Search if blocked.

    This is the recommended function to use - it tries direct scraping
    for full review data, then falls back to Yahoo for rating/count.
    """
    # Try direct Yelp first (may get full reviews)
    result = await scrape_yelp(
        business_name, location, max_reviews, use_cache, headless
    )

    # If blocked or not found, try Yahoo fallback
    if result.error and "DataDome" in result.error:
        print("[Yelp] Direct scraping blocked, trying Yahoo fallback...")
        yahoo_result = await scrape_yelp_via_yahoo(
            business_name, location, use_cache, headless
        )
        if yahoo_result.found:
            return yahoo_result

    return result


# ============================================================
# CLI
# ============================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Scrape Yelp for business reviews")
    parser.add_argument("business_name", help="Business name to search for")
    parser.add_argument("location", nargs="?", default="Fort Worth, TX", help="City, State")
    parser.add_argument("--max-reviews", type=int, default=10, help="Max reviews to extract")
    parser.add_argument("--no-cache", action="store_true", help="Skip cache")
    parser.add_argument("--visible", action="store_true", help="Show browser window")
    parser.add_argument("--yahoo", action="store_true", help="Use Yahoo Search fallback (bypasses DataDome)")
    parser.add_argument("--with-fallback", action="store_true", help="Try direct Yelp, fall back to Yahoo if blocked")

    args = parser.parse_args()

    if args.yahoo:
        # Yahoo-only mode
        result = asyncio.run(scrape_yelp_via_yahoo(
            args.business_name,
            args.location,
            use_cache=not args.no_cache,
            headless=not args.visible
        ))
    elif args.with_fallback:
        # Try direct Yelp, fall back to Yahoo
        result = asyncio.run(scrape_yelp_with_fallback(
            args.business_name,
            args.location,
            max_reviews=args.max_reviews,
            use_cache=not args.no_cache,
            headless=not args.visible
        ))
    else:
        # Direct Yelp only
        result = asyncio.run(scrape_yelp(
            args.business_name,
            args.location,
            max_reviews=args.max_reviews,
            use_cache=not args.no_cache,
            headless=not args.visible
        ))

    print(f"\n{'='*50}")
    print(f"YELP: {args.business_name}")
    print(f"Source: {result.source}")
    print(f"{'='*50}")
    print(f"Found: {result.found}")

    if result.error:
        print(f"Error: {result.error}")

    if result.found:
        print(f"Name: {result.name}")
        print(f"Rating: {result.rating}")
        print(f"Reviews: {result.review_count}")
        print(f"Price: {result.price or 'N/A'}")
        if result.categories:
            print(f"Categories: {', '.join(result.categories)}")
        print(f"URL: {result.yelp_url}")

        if result.reviews:
            print(f"\nSample Reviews ({len(result.reviews)}):")
            for r in result.reviews[:3]:
                print(f"  [{r.rating}] {r.reviewer_name} ({r.date})")
                print(f"      {r.text[:100]}...")
