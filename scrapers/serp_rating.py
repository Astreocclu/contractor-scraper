#!/usr/bin/env python3
"""
SERP RATING SCRAPER (Playwright Python)

Extracts business ratings from Yahoo Search snippets.
Bypasses anti-bot protection by reading SERP results instead of visiting sites directly.

Supports: Angi, Trustpilot, Houzz, and any site that shows ratings in search snippets.

Usage:
  python scrapers/serp_rating.py "Orange Elephant Roofing" "Fort Worth, TX" --site angi.com
  python scrapers/serp_rating.py "Berkeys Plumbing" "Southlake, TX" --site trustpilot.com
  python scrapers/serp_rating.py "Company Name" "City, ST" --site houzz.com
"""

import asyncio
import json
import re
import sys
from dataclasses import dataclass
from typing import Optional

from playwright.async_api import async_playwright
from playwright_stealth import Stealth

try:
    from scrapers.utils import cache, rate_limiter
except ImportError:
    from utils import cache, rate_limiter


@dataclass
class SerpRatingResult:
    """SERP rating extraction result."""
    found: bool
    site: str
    rating: Optional[float] = None
    review_count: Optional[int] = None
    url: Optional[str] = None
    name: Optional[str] = None
    source: str = "serp"
    error: Optional[str] = None
    confidence: str = "unknown"  # high, medium, low, mismatch
    matched_name: Optional[str] = None  # Name found in SERP result


def normalize_company_name(name: str) -> str:
    """Normalize company name for comparison."""
    if not name:
        return ""
    # Lowercase, remove common suffixes and punctuation
    name = name.lower().strip()
    # Remove common business suffixes
    for suffix in [' llc', ' inc', ' corp', ' co', ' company', ' ltd', ' lp', ' llp',
                   ' roofing', ' plumbing', ' hvac', ' construction', ' builders',
                   ' services', ' solutions', ' group', ' enterprises']:
        name = name.replace(suffix, '')
    # Remove punctuation and extra spaces
    name = re.sub(r'[^\w\s]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name


def calculate_name_similarity(name1: str, name2: str) -> float:
    """Calculate similarity between two company names (0.0 to 1.0)."""
    n1 = normalize_company_name(name1)
    n2 = normalize_company_name(name2)

    if not n1 or not n2:
        return 0.0

    # Exact match after normalization
    if n1 == n2:
        return 1.0

    # Check if one contains the other
    if n1 in n2 or n2 in n1:
        return 0.85

    # Word overlap check
    words1 = set(n1.split())
    words2 = set(n2.split())

    if not words1 or not words2:
        return 0.0

    # Jaccard similarity on words
    intersection = words1 & words2
    union = words1 | words2
    jaccard = len(intersection) / len(union)

    # Bonus if first word matches (usually most important - company name)
    first_word_match = n1.split()[0] == n2.split()[0] if n1 and n2 else False
    if first_word_match:
        jaccard = min(1.0, jaccard + 0.3)

    return jaccard


# Site-specific rating patterns
SITE_PATTERNS = {
    "angi.com": {
        "rating": [
            r'(\d\.\d)\s*/\s*5',           # 4.5 / 5
            r'(\d\.\d)\s*out of\s*5',      # 4.5 out of 5
            r'(\d\.\d)\s*stars?',          # 4.5 stars
            r'Rating:\s*(\d\.\d)',         # Rating: 4.5
        ],
        "count": [
            r'(\d[\d,]*)\s*(?:reviews?|ratings?)',  # 123 reviews
            r'\((\d[\d,]*)\)',                      # (123)
        ],
        "url": r'angi\.com/[^\s"<>]+',
    },
    "trustpilot.com": {
        "rating": [
            r'(\d\.\d)\s*/\s*5',
            r'TrustScore\s*(\d\.\d)',      # TrustScore 4.5
            r'(\d\.\d)\s*stars?',
        ],
        "count": [
            r'(\d[\d,]*)\s*(?:reviews?|ratings?)',
            r'\((\d[\d,]*)\)',
        ],
        "url": r'trustpilot\.com/review/[^\s"<>]+',
    },
    "houzz.com": {
        "rating": [
            r'(\d\.\d)\s*/\s*5',
            r'(\d\.\d)\s*(?:average|stars?)',
        ],
        "count": [
            r'(\d[\d,]*)\s*(?:reviews?|ratings?|projects?)',
            r'\((\d[\d,]*)\)',
        ],
        "url": r'houzz\.com/professionals/[^\s"<>]+',
    },
}


async def scrape_serp_rating(
    business_name: str,
    location: str = "Fort Worth, TX",
    site: str = "angi.com",
    use_cache: bool = True,
    headless: bool = True
) -> SerpRatingResult:
    """
    Get business rating via Yahoo Search for a specific site.

    Args:
        business_name: Business name to search for
        location: City, State to search in
        site: Domain to search (angi.com, trustpilot.com, houzz.com)
        use_cache: Whether to use cached results
        headless: Whether to run browser headless

    Returns:
        SerpRatingResult with rating and review count
    """
    # Trustpilot SERP is disabled - Yahoo returns garbage results for local contractors
    # See: docs/SESSION_2025-12-08_batch_audit_results.md for details
    if site == "trustpilot.com":
        print(f"[SERP/{site}] DISABLED - Yahoo returns unreliable results for Trustpilot", file=sys.stderr)
        return SerpRatingResult(
            found=False,
            site=site,
            source=f"serp_{site.replace('.com', '')}",
            error="Trustpilot SERP disabled - unreliable Yahoo indexing"
        )

    cache_key = f"serp_{site}:{business_name.lower().strip()}:{location.lower().strip()}"

    # Check cache
    if use_cache:
        cached = cache.get("serp", cache_key)
        if cached:
            return SerpRatingResult(
                found=cached["found"],
                site=site,
                rating=cached.get("rating"),
                review_count=cached.get("review_count"),
                url=cached.get("url"),
                name=cached.get("name"),
                source=f"serp_{site.replace('.com', '')}",
                confidence=cached.get("confidence", "unknown"),
                matched_name=cached.get("matched_name"),
                error=cached.get("error")
            )

    # Rate limit
    await rate_limiter.acquire("search.yahoo.com")

    result = SerpRatingResult(found=False, site=site, source=f"serp_{site.replace('.com', '')}")

    # Build Yahoo search URL with site filter
    query = f"{business_name} {location} site:{site}".replace(" ", "+")
    search_url = f"https://search.yahoo.com/search?p={query}"

    stealth = Stealth()

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

        # Apply stealth to bypass bot detection
        await stealth.apply_stealth_async(context)
        page = await context.new_page()

        try:
            print(f"[SERP/{site}] Searching for: {business_name} in {location}", file=sys.stderr)
            await page.goto(search_url, timeout=15000)
            await asyncio.sleep(3)

            body = await page.inner_text("body")
            html = await page.content()

            # Get patterns for this site (or use defaults)
            patterns = SITE_PATTERNS.get(site, {
                "rating": [r'(\d\.\d)\s*/\s*5', r'(\d\.\d)\s*stars?'],
                "count": [r'(\d[\d,]*)\s*reviews?', r'\((\d[\d,]*)\)'],
                "url": rf'{re.escape(site)}/[^\s"<>]+',
            })

            # Extract rating
            for pattern in patterns["rating"]:
                match = re.search(pattern, body, re.IGNORECASE)
                if match:
                    result.rating = float(match.group(1))
                    result.found = True
                    break

            # Extract review count
            for pattern in patterns["count"]:
                match = re.search(pattern, body, re.IGNORECASE)
                if match:
                    result.review_count = int(match.group(1).replace(",", ""))
                    result.found = True
                    break

            # Extract URL
            url_pattern = patterns.get("url", rf'{re.escape(site)}/[^\s"<>]+')
            url_match = re.search(url_pattern, html, re.IGNORECASE)
            if url_match:
                result.url = f"https://www.{url_match.group(0)}"
                if not result.url.startswith("https://www."):
                    result.url = f"https://www.{site}" + url_match.group(0).split(site)[-1]
                result.found = True

            result.name = business_name

            # Extract matched company name from SERP title and verify it matches
            # Look for title patterns in SERP results
            matched_name = None

            # Try to extract company name from Trustpilot URL path or title
            if site == "trustpilot.com" and result.url:
                # Extract from URL like trustpilot.com/review/companyname
                url_name_match = re.search(r'trustpilot\.com/review/([^/\s"<>]+)', result.url)
                if url_name_match:
                    # Convert URL slug to name (e.g., "berkeys-plumbing" -> "berkeys plumbing")
                    matched_name = url_name_match.group(1).replace('-', ' ').replace('.com', '').replace('.', ' ')

            # Also try to find company name in search result titles
            # Pattern: "Company Name Reviews | Read Customer..."
            title_match = re.search(r'<a[^>]*>([^<]+(?:Reviews|Trustpilot))', html, re.IGNORECASE)
            if title_match:
                title_text = title_match.group(1)
                # Extract name before "Reviews" or "Trustpilot"
                name_from_title = re.sub(r'\s*(Reviews|Trustpilot|Read|Customer).*$', '', title_text, flags=re.IGNORECASE).strip()
                if name_from_title and len(name_from_title) > 2:
                    matched_name = name_from_title

            result.matched_name = matched_name

            # Calculate confidence based on name similarity
            if matched_name:
                similarity = calculate_name_similarity(business_name, matched_name)
                if similarity >= 0.7:
                    result.confidence = "high"
                elif similarity >= 0.4:
                    result.confidence = "medium"
                elif similarity >= 0.2:
                    result.confidence = "low"
                else:
                    result.confidence = "mismatch"
                    print(f"[SERP/{site}] WARNING: Name mismatch! Searched '{business_name}', found '{matched_name}' (similarity: {similarity:.2f})", file=sys.stderr)
            else:
                result.confidence = "unknown"

            # If confidence is "mismatch", mark as not found to prevent false data
            if result.confidence == "mismatch":
                print(f"[SERP/{site}] Rejecting result due to company name mismatch", file=sys.stderr)
                result.found = False
                result.rating = None
                result.review_count = None
                result.error = f"Company mismatch: searched '{business_name}', found '{matched_name}'"

            if result.found:
                print(f"[SERP/{site}] Found: {result.rating}/5 ({result.review_count} reviews) [confidence: {result.confidence}]", file=sys.stderr)
            else:
                print(f"[SERP/{site}] Not found in search results", file=sys.stderr)

            # Cache the result
            cache.set("serp", cache_key, {
                "found": result.found,
                "rating": result.rating,
                "review_count": result.review_count,
                "url": result.url,
                "name": result.name,
                "site": site,
                "source": result.source,
                "confidence": result.confidence,
                "matched_name": result.matched_name,
                "error": result.error
            })

            return result

        except Exception as e:
            result.error = f"SERP search error: {e}"
            print(f"[SERP/{site}] Error: {e}", file=sys.stderr)
            return result
        finally:
            await browser.close()


def result_to_dict(result: SerpRatingResult) -> dict:
    """Convert result to JSON-serializable dict."""
    return {
        "found": result.found,
        "site": result.site,
        "rating": result.rating,
        "review_count": result.review_count,
        "url": result.url,
        "name": result.name,
        "source": result.source,
        "error": result.error,
        "confidence": result.confidence,
        "matched_name": result.matched_name,
    }


# ============================================================
# CLI
# ============================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Extract business rating from SERP results")
    parser.add_argument("business_name", help="Business name to search for")
    parser.add_argument("location", nargs="?", default="Fort Worth, TX", help="City, State")
    parser.add_argument("--site", default="angi.com", help="Site domain (angi.com, trustpilot.com, houzz.com)")
    parser.add_argument("--no-cache", action="store_true", help="Skip cache")
    parser.add_argument("--visible", action="store_true", help="Show browser window")
    parser.add_argument("--json", action="store_true", help="Output JSON format")

    args = parser.parse_args()

    result = asyncio.run(scrape_serp_rating(
        args.business_name,
        args.location,
        site=args.site,
        use_cache=not args.no_cache,
        headless=not args.visible
    ))

    if args.json:
        print(json.dumps(result_to_dict(result)))
    else:
        print(f"\n{'='*50}")
        print(f"SERP RATING: {args.business_name}")
        print(f"Site: {args.site}")
        print(f"{'='*50}")
        print(f"Found: {result.found}")

        if result.error:
            print(f"Error: {result.error}")

        if result.found:
            print(f"Rating: {result.rating}")
            print(f"Reviews: {result.review_count}")
            print(f"URL: {result.url}")
