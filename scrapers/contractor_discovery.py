#!/usr/bin/env python3
"""
CONTRACTOR DISCOVERY SCRAPER (Playwright Python)
Discovers contractors in DFW by scraping Google Maps search results.

Searches for category + city combinations and extracts all business cards.
Uses playwright-stealth to avoid bot detection.

Usage:
  python scrapers/contractor_discovery.py "plumber" "Fort Worth"
  python scrapers/contractor_discovery.py "roofing contractor" "Dallas" --limit 30
  python scrapers/contractor_discovery.py "HVAC contractor" "Keller" --visible --json
"""

import asyncio
import json
import re
import sys
import urllib.parse
from dataclasses import dataclass, field
from typing import Optional, List

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
from playwright_stealth import Stealth

try:
    from scrapers.utils import (
        cache,
        rate_limiter,
        get_random_user_agent,
    )
except ImportError:
    from utils import (
        cache,
        rate_limiter,
        get_random_user_agent,
    )


# Search matrix
CATEGORIES = [
    "plumber",
    "electrician",
    "HVAC contractor",
    "roofing contractor",
    "foundation repair",
    "pool contractor",
    "outdoor living contractor",
    "window contractor",
]

CITIES = [
    # Core DFW
    "Fort Worth",
    "Dallas",
    "Arlington",
    "Plano",
    "Irving",
    "Garland",
    "Frisco",
    "McKinney",
    # Mid-size
    "Grand Prairie",
    "Mesquite",
    "Denton",
    "Carrollton",
    "Richardson",
    "Lewisville",
    "Allen",
    "Flower Mound",
    # Smaller but active
    "Keller",
    "Grapevine",
    "Bedford",
    "Euless",
    "Hurst",
    "Colleyville",
    "Southlake",
    "Coppell",
]


@dataclass
class DiscoveredContractor:
    """A contractor discovered from Google Maps search."""
    business_name: str
    city: str
    state: str = "TX"
    address: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    google_place_id: Optional[str] = None
    google_rating: Optional[float] = None
    google_review_count: Optional[int] = None
    maps_url: Optional[str] = None
    categories: List[str] = field(default_factory=list)
    source_category: str = ""  # The category search that found this contractor


@dataclass
class DiscoveryResult:
    """Result of a contractor discovery search."""
    category: str
    city: str
    state: str
    contractors: List[DiscoveredContractor] = field(default_factory=list)
    total_found: int = 0
    error: Optional[str] = None
    cached: bool = False


async def scrape_contractors_in_area(
    category: str,
    city: str,
    state: str = "TX",
    max_results: int = 60,
    use_cache: bool = True,
    headless: bool = True
) -> DiscoveryResult:
    """
    Discover contractors by searching Google Maps for a category in a city.

    Args:
        category: Business category (e.g., "plumber", "roofing contractor")
        city: City name (e.g., "Fort Worth")
        state: State abbreviation (default: "TX")
        max_results: Maximum number of contractors to extract
        use_cache: Whether to use cached results
        headless: Whether to run browser headless

    Returns:
        DiscoveryResult with list of discovered contractors
    """
    cache_key = f"{category.lower().strip()}:{city.lower().strip()}:{state.lower()}"

    # Check cache
    if use_cache:
        cached = cache.get("contractor_discovery", cache_key)
        if cached:
            contractors = [DiscoveredContractor(**c) for c in cached.get("contractors", [])]
            return DiscoveryResult(
                category=category,
                city=city,
                state=state,
                contractors=contractors,
                total_found=cached.get("total_found", len(contractors)),
                cached=True
            )

    # Rate limit
    await rate_limiter.acquire("google.com")

    result = DiscoveryResult(category=category, city=city, state=state)

    # Build search URL
    query = urllib.parse.quote(f"{category} near {city}, {state}")
    search_url = f"https://www.google.com/maps/search/{query}"

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-sandbox",
            ]
        )
        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent=get_random_user_agent(),
            locale="en-US",
            geolocation={"latitude": 32.7767, "longitude": -96.7970},  # Dallas area
            permissions=["geolocation"],
        )
        page = await context.new_page()

        # Apply stealth to avoid bot detection
        stealth = Stealth()
        await stealth.apply_stealth_async(page)

        try:
            print(f"[Discovery] Searching: {category} in {city}, {state}", file=sys.stderr)
            await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)

            # Wait for results to load
            await asyncio.sleep(3)

            # CAPTCHA Detection
            if await _is_captcha(page):
                result.error = "CAPTCHA_DETECTED"
                print("[Discovery] CAPTCHA detected - cannot proceed", file=sys.stderr)
                return result

            # Extract contractors from search results
            contractors = await _extract_business_cards(page, max_results, category, city, state)
            result.contractors = contractors
            result.total_found = len(contractors)

            print(f"[Discovery] Found {len(contractors)} contractors", file=sys.stderr)

            # Cache the result
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


async def _is_captcha(page) -> bool:
    """Check if Google is showing a CAPTCHA challenge."""
    try:
        page_text = await page.evaluate("document.body.innerText")
        if "unusual traffic" in page_text.lower():
            return True
        if "robot" in page_text.lower() and "are you a robot" in page_text.lower():
            return True
        captcha_iframe = await page.query_selector('iframe[src*="recaptcha"]')
        if captcha_iframe:
            return True
        return False
    except:
        return False


async def _extract_business_cards(
    page,
    max_results: int,
    category: str,
    city: str,
    state: str
) -> List[DiscoveredContractor]:
    """
    Extract business cards from Google Maps search results.
    Scrolls the results feed to load more businesses.
    """
    contractors = []
    seen_names = set()  # Deduplication

    print(f"[Discovery] Scrolling to load up to {max_results} results...", file=sys.stderr)

    no_new_count = 0
    previous_count = 0

    # Find the scrollable feed container
    feed_selector = 'div[role="feed"]'
    feed = await page.query_selector(feed_selector)

    # Scroll up to 30 times to load more results
    for scroll_num in range(30):
        if len(contractors) >= max_results:
            break

        # Look for business cards - try multiple selectors
        cards = await page.query_selector_all('[data-result-index], div[jsaction*="mouseover:pane"]')

        # Fallback selectors
        if not cards:
            cards = await page.query_selector_all('div.Nv2PK')
        if not cards:
            cards = await page.query_selector_all('[role="article"]')

        for card in cards:
            if len(contractors) >= max_results:
                break

            try:
                contractor = await _extract_single_card(card, category, city, state)
                if contractor and contractor.business_name not in seen_names:
                    seen_names.add(contractor.business_name)
                    contractors.append(contractor)
            except Exception as e:
                continue

        # Check if we got new results this scroll
        if len(contractors) == previous_count:
            no_new_count += 1
        else:
            no_new_count = 0
        previous_count = len(contractors)

        # Stop if no new results after 5 scrolls
        if no_new_count >= 5:
            print(f"[Discovery] No new results after {no_new_count} scrolls, stopping", file=sys.stderr)
            break

        # Scroll down in the feed
        try:
            if feed:
                await feed.evaluate('el => el.scrollBy(0, 1000)')
            else:
                await page.mouse.wheel(0, 1000)
            await asyncio.sleep(1.5)
        except:
            break

    return contractors


async def _extract_single_card(card, category: str, city: str, state: str) -> Optional[DiscoveredContractor]:
    """Extract contractor info from a single business card element."""
    try:
        card_text = await card.inner_text()
        if not card_text or len(card_text) < 10:
            return None

        # Extract business name (usually first line or in specific element)
        name_el = await card.query_selector('.qBF1Pd, .fontHeadlineSmall, a[aria-label]')
        business_name = None

        if name_el:
            # Try aria-label first (usually has full name)
            aria_label = await name_el.get_attribute("aria-label")
            if aria_label:
                business_name = aria_label.strip()
            else:
                business_name = await name_el.inner_text()

        if not business_name:
            # Fallback: first line of card text
            lines = [l.strip() for l in card_text.split('\n') if l.strip()]
            if lines:
                business_name = lines[0]

        if not business_name or len(business_name) < 2:
            return None

        # Filter out UI elements and non-business entries
        ui_elements = [
            "collapse side panel",
            "expand side panel",
            "update results",
            "redo search",
            "search this area",
            "zoom in",
            "zoom out",
            "view larger map",
            "directions",
            "nearby",
        ]
        name_lower = business_name.lower()
        # Remove unicode characters for comparison
        name_clean = ''.join(c for c in name_lower if c.isalnum() or c.isspace())
        for ui_elem in ui_elements:
            if ui_elem in name_clean:
                return None

        # Skip if name is too short or looks like a UI element
        if len(business_name.strip()) < 3:
            return None

        # Skip sponsored/ad results
        if "Sponsored" in card_text or "Ad " in card_text[:10]:
            return None

        # Extract rating and review count
        rating = None
        review_count = None
        rating_match = re.search(r'(\d\.\d)\s*[\(\[]?\s*(\d[\d,]*)\s*(?:reviews?|ratings?)?\s*[\)\]]?', card_text)
        if rating_match:
            rating = float(rating_match.group(1))
            review_count = int(rating_match.group(2).replace(',', ''))

        # Extract address
        address = None
        # Look for typical address patterns
        addr_match = re.search(
            r'(\d+\s+[A-Za-z0-9\s,\.]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Hwy|Highway)[^\n]*)',
            card_text
        )
        if addr_match:
            address = addr_match.group(1).strip()[:200]

        # Extract phone number
        phone = None
        phone_match = re.search(r'\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}', card_text)
        if phone_match:
            phone = phone_match.group(0)

        # Try to get Google Place ID from card attributes or link
        place_id = None
        link_el = await card.query_selector('a[href*="/maps/place/"]')
        if link_el:
            href = await link_el.get_attribute("href")
            if href:
                # Extract place ID from URL like /maps/place/.../.../data=...!3m1!4b1!4m2!3m1!1s0x...
                place_match = re.search(r'!1s(0x[a-f0-9]+:[a-f0-9]+)', href)
                if place_match:
                    place_id = place_match.group(1)

        # Also try data attribute
        if not place_id:
            data_pid = await card.get_attribute("data-place-id")
            if data_pid:
                place_id = data_pid

        # Get maps URL
        maps_url = None
        if link_el:
            maps_url = await link_el.get_attribute("href")

        # Extract categories/types from card
        categories = []
        # Common category patterns
        cat_patterns = [
            r'(Plumb(?:er|ing))',
            r'(Electric(?:ian|al))',
            r'(HVAC|Air Conditioning|Heating)',
            r'(Roof(?:er|ing))',
            r'(Foundation)',
            r'(Pool)',
            r'(Landscap(?:er|ing))',
            r'(Contractor)',
        ]
        for pattern in cat_patterns:
            if re.search(pattern, card_text, re.I):
                match = re.search(pattern, card_text, re.I)
                if match:
                    categories.append(match.group(1))

        return DiscoveredContractor(
            business_name=business_name.strip(),
            city=city,
            state=state,
            address=address,
            phone=phone,
            google_place_id=place_id,
            google_rating=rating,
            google_review_count=review_count,
            maps_url=maps_url,
            categories=categories,
            source_category=category
        )

    except Exception as e:
        return None


def _cache_result(cache_key: str, result: DiscoveryResult):
    """Cache the discovery result."""
    cache.set("contractor_discovery", cache_key, {
        "category": result.category,
        "city": result.city,
        "state": result.state,
        "total_found": result.total_found,
        "contractors": [
            {
                "business_name": c.business_name,
                "city": c.city,
                "state": c.state,
                "address": c.address,
                "phone": c.phone,
                "website": c.website,
                "google_place_id": c.google_place_id,
                "google_rating": c.google_rating,
                "google_review_count": c.google_review_count,
                "maps_url": c.maps_url,
                "categories": c.categories,
                "source_category": c.source_category,
            }
            for c in result.contractors
        ]
    })


def result_to_dict(result: DiscoveryResult) -> dict:
    """Convert DiscoveryResult to JSON-serializable dict."""
    return {
        "category": result.category,
        "city": result.city,
        "state": result.state,
        "total_found": result.total_found,
        "cached": result.cached,
        "error": result.error,
        "contractors": [
            {
                "business_name": c.business_name,
                "city": c.city,
                "state": c.state,
                "address": c.address,
                "phone": c.phone,
                "website": c.website,
                "google_place_id": c.google_place_id,
                "google_rating": c.google_rating,
                "google_review_count": c.google_review_count,
                "maps_url": c.maps_url,
                "categories": c.categories,
                "source_category": c.source_category,
            }
            for c in result.contractors
        ]
    }


async def run_full_matrix(
    categories: List[str] = None,
    cities: List[str] = None,
    max_results_per_search: int = 60,
    use_cache: bool = True,
    headless: bool = True
) -> List[DiscoveryResult]:
    """
    Run the full discovery matrix across all categories and cities.

    Args:
        categories: List of categories to search (default: CATEGORIES)
        cities: List of cities to search (default: CITIES)
        max_results_per_search: Max contractors per search
        use_cache: Whether to use cached results
        headless: Whether to run browser headless

    Returns:
        List of DiscoveryResult for each category/city combination
    """
    if categories is None:
        categories = CATEGORIES
    if cities is None:
        cities = CITIES

    results = []
    total_searches = len(categories) * len(cities)
    completed = 0

    for category in categories:
        for city in cities:
            completed += 1
            print(f"\n[{completed}/{total_searches}] {category} in {city}...", file=sys.stderr)

            result = await scrape_contractors_in_area(
                category=category,
                city=city,
                max_results=max_results_per_search,
                use_cache=use_cache,
                headless=headless
            )
            results.append(result)

            # Small delay between searches
            if not result.cached:
                await asyncio.sleep(2)

    return results


# ============================================================
# CLI
# ============================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Discover contractors from Google Maps")
    parser.add_argument("category", nargs="?", help="Business category (e.g., 'plumber')")
    parser.add_argument("city", nargs="?", help="City name (e.g., 'Fort Worth')")
    parser.add_argument("--state", default="TX", help="State abbreviation")
    parser.add_argument("--limit", type=int, default=60, help="Max results per search")
    parser.add_argument("--no-cache", action="store_true", help="Skip cache")
    parser.add_argument("--visible", action="store_true", help="Show browser window")
    parser.add_argument("--json", action="store_true", help="Output JSON format")
    parser.add_argument("--full-matrix", action="store_true", help="Run full category/city matrix")

    args = parser.parse_args()

    if args.full_matrix:
        # Run full matrix
        results = asyncio.run(run_full_matrix(
            max_results_per_search=args.limit,
            use_cache=not args.no_cache,
            headless=not args.visible
        ))

        if args.json:
            print(json.dumps([result_to_dict(r) for r in results], indent=2))
        else:
            total = sum(r.total_found for r in results)
            print(f"\n{'='*60}")
            print(f"DISCOVERY COMPLETE: {total} contractors found")
            print(f"{'='*60}")
            for r in results:
                status = "CACHED" if r.cached else "FRESH"
                if r.error:
                    status = f"ERROR: {r.error}"
                print(f"  {r.category} in {r.city}: {r.total_found} [{status}]")

    elif args.category and args.city:
        # Single search
        result = asyncio.run(scrape_contractors_in_area(
            args.category,
            args.city,
            state=args.state,
            max_results=args.limit,
            use_cache=not args.no_cache,
            headless=not args.visible
        ))

        if args.json:
            print(json.dumps(result_to_dict(result), indent=2))
        else:
            print(f"\n{'='*60}")
            print(f"DISCOVERY: {args.category} in {args.city}, {args.state}")
            print(f"{'='*60}")
            print(f"Found: {result.total_found} contractors")
            if result.cached:
                print("(from cache)")
            if result.error:
                print(f"Error: {result.error}")

            if result.contractors:
                print(f"\nContractors:")
                for i, c in enumerate(result.contractors[:20], 1):
                    rating_str = f"{c.google_rating}" if c.google_rating else "N/A"
                    reviews_str = f"({c.google_review_count})" if c.google_review_count else ""
                    print(f"  {i}. {c.business_name}")
                    print(f"     Rating: {rating_str} {reviews_str}")
                    if c.address:
                        print(f"     Address: {c.address}")
                    if c.phone:
                        print(f"     Phone: {c.phone}")
                if result.total_found > 20:
                    print(f"\n  ... and {result.total_found - 20} more")

    else:
        parser.print_help()
        print("\nExamples:")
        print('  python contractor_discovery.py "plumber" "Fort Worth"')
        print('  python contractor_discovery.py --full-matrix --json')
