#!/usr/bin/env python3
"""
GOOGLE MAPS SCRAPER (Playwright Python)
NO API - scrapes directly from Google Maps search results.

Gets review count and rating without Google Places API limits/costs.
Uses playwright-stealth to avoid bot detection.

Usage:
  python scrapers/google_maps.py "Orange Elephant Roofing" "Fort Worth, TX"
  python scrapers/google_maps.py "Smith Electric" --max-reviews 50
  python scrapers/google_maps.py "Claffey Pools" "Southlake, TX" --visible --json
"""

import asyncio
import json
import re
import sys
import urllib.parse
from dataclasses import dataclass, field
from typing import Optional

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
from playwright_stealth import Stealth

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
class GoogleMapsReview:
    """Individual Google Maps review."""
    text: str
    rating: int
    date: str
    reviewer_name: str
    source: str = "google_maps"


@dataclass
class GoogleMapsResult:
    """Google Maps scrape result."""
    found: bool
    maps_url: Optional[str] = None
    name: Optional[str] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    status: Optional[str] = None  # Open, Closed, Temporarily closed
    hours: Optional[str] = None
    categories: list[str] = field(default_factory=list)
    reviews: list[GoogleMapsReview] = field(default_factory=list)
    source: str = "google_maps"
    error: Optional[str] = None


async def scrape_google_maps(
    business_name: str,
    location: str = "Fort Worth, TX",
    max_reviews: int = 50,  # Increased for pattern analysis
    use_cache: bool = True,
    headless: bool = True
) -> GoogleMapsResult:
    """
    Scrape Google Maps for business reviews.

    Args:
        business_name: Business name to search for
        location: City, State to search in
        max_reviews: Maximum number of reviews to extract
        use_cache: Whether to use cached results
        headless: Whether to run browser headless

    Returns:
        GoogleMapsResult with business info and reviews
    """
    cache_key = f"{business_name.lower().strip()}:{location.lower().strip()}"

    # Check cache
    if use_cache:
        cached = cache.get("google_maps", cache_key)
        if cached:
            reviews = [GoogleMapsReview(**r) for r in cached.get("reviews", [])]
            return GoogleMapsResult(
                found=cached["found"],
                maps_url=cached.get("maps_url"),
                name=cached.get("name"),
                rating=cached.get("rating"),
                review_count=cached.get("review_count"),
                address=cached.get("address"),
                phone=cached.get("phone"),
                email=cached.get("email"),
                website=cached.get("website"),
                status=cached.get("status"),
                hours=cached.get("hours"),
                categories=cached.get("categories", []),
                reviews=reviews,
                source="google_maps"
            )

    # Rate limit
    await rate_limiter.acquire("google.com")

    result = GoogleMapsResult(found=False)

    # Build search URL - Google Maps search
    query = urllib.parse.quote(f"{business_name} {location}")
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
            # Navigate to Google Maps search
            print(f"[Google Maps] Searching for: {business_name} in {location}", file=sys.stderr)
            await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)

            # Wait for results to load
            await asyncio.sleep(3)

            # CAPTCHA Detection
            if await _is_captcha(page):
                result.error = "CAPTCHA_DETECTED"
                print("[Google Maps] CAPTCHA detected - cannot proceed", file=sys.stderr)
                return result

            # Check if we landed on a business page directly or search results
            current_url = page.url
            result.maps_url = current_url

            # Try to extract directly from page first
            page_text = await page.evaluate("() => document.body.innerText")

            # Look for rating pattern: "4.5 (123)" or "4.5(123 reviews)"
            rating_match = re.search(r'(\d\.\d)\s*[\(\[]?\s*(\d[\d,]*)\s*(?:reviews?|ratings?)?\s*[\)\]]?', page_text)
            if rating_match:
                result.found = True
                result.rating = float(rating_match.group(1))
                result.review_count = int(rating_match.group(2).replace(',', ''))

            # Try to find business name from the page title or header
            title = await page.title()
            if title and " - Google Maps" in title:
                result.name = title.replace(" - Google Maps", "").strip()
            elif not result.name:
                # Try to extract from page content
                name_match = re.search(r'^([A-Za-z0-9][^\n]{3,50})\n', page_text)
                if name_match:
                    result.name = name_match.group(1).strip()

            # Look for address
            address_match = re.search(r'(\d+\s+[A-Za-z0-9\s,\.]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Hwy|Highway)[^\n]*)', page_text)
            if address_match:
                result.address = address_match.group(1).strip()[:200]

            # Look for phone number
            phone_match = re.search(r'\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}', page_text)
            if phone_match:
                result.phone = phone_match.group(0)

            # Look for email address (Google sometimes shows it on business profiles)
            email_match = re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b', page_text)
            if email_match:
                email_candidate = email_match.group(0).lower()
                # Filter out junk emails
                junk_domains = ['wix.com', 'sentry.io', 'example.com', 'google.com', 'gstatic.com']
                if not any(junk in email_candidate for junk in junk_domains):
                    result.email = email_candidate

            # Look for website URL - Google Maps shows this as a button/link
            # Try multiple methods to extract the website
            try:
                # Method 1: Look for website button (aria-label contains "Website")
                website_btn = await page.query_selector('a[data-item-id="authority"], a[aria-label*="Website"], a[data-tooltip*="website" i]')
                if website_btn:
                    website_href = await website_btn.get_attribute('href')
                    if website_href and not website_href.startswith('https://www.google.com'):
                        result.website = website_href

                # Method 2: Look for links that look like business websites (not google/maps/etc)
                if not result.website:
                    all_links = await page.query_selector_all('a[href^="http"]')
                    for link in all_links[:20]:  # Check first 20 links
                        href = await link.get_attribute('href')
                        if href and not any(skip in href for skip in ['google.com', 'gstatic.com', 'youtube.com', 'facebook.com', 'yelp.com', 'bbb.org']):
                            # Check if it looks like a business website
                            if re.match(r'https?://(?:www\.)?[a-z0-9-]+\.[a-z]{2,}/?$', href, re.I):
                                result.website = href
                                break

                # Method 3: Regex on page text for URL patterns
                if not result.website:
                    url_match = re.search(r'(?:Website|Visit)\s*:?\s*(https?://[^\s<>"]+)', page_text, re.I)
                    if url_match:
                        result.website = url_match.group(1)
            except Exception as e:
                print(f"[Google Maps] Website extraction error: {e}", file=sys.stderr)

            # Look for status (Open/Closed)
            if re.search(r'\bOpen\b.*(?:24 hours|Opens|hours)', page_text, re.I):
                result.status = "open"
            elif re.search(r'\b(?:Closed|Temporarily closed)\b', page_text, re.I):
                result.status = "closed"

            # If we didn't find rating/reviews, try clicking on a search result
            if not result.found:
                # Look for business cards in search results
                cards = await page.query_selector_all('[data-value], [role="article"], .Nv2PK')
                if cards:
                    for card in cards[:3]:  # Check first 3 results
                        card_text = await card.inner_text()
                        card_lower = card_text.lower()
                        name_lower = business_name.lower()

                        # Check if this card matches our business
                        name_words = name_lower.split()
                        match_score = sum(1 for w in name_words if w in card_lower) / len(name_words)

                        if match_score >= 0.5:  # At least 50% of words match
                            # Extract rating from card
                            card_rating = re.search(r'(\d\.\d)\s*[\(\[]?\s*(\d[\d,]*)', card_text)
                            if card_rating:
                                result.found = True
                                result.rating = float(card_rating.group(1))
                                result.review_count = int(card_rating.group(2).replace(',', ''))

                                # Click to get more details
                                try:
                                    await card.click()
                                    await asyncio.sleep(2)
                                    result.maps_url = page.url
                                except:
                                    pass
                                break

            # If still not found, use DeepSeek extraction
            if not result.found or not result.rating:
                html = await page.content()
                cleaned = clean_html(html)
                extracted = await _extract_with_deepseek(cleaned, business_name, location)

                if extracted and extracted.get("found"):
                    result.found = True
                    result.name = extracted.get("name") or result.name
                    result.rating = extracted.get("rating") or result.rating
                    result.review_count = extracted.get("review_count") or result.review_count
                    result.address = extracted.get("address") or result.address
                    result.phone = extracted.get("phone") or result.phone
                    result.email = extracted.get("email") or result.email
                    result.website = extracted.get("website")
                    result.status = extracted.get("status") or result.status
                    result.categories = extracted.get("categories", [])

            # Try to extract actual reviews if we found the business
            if result.found and max_reviews > 0:
                reviews = await _extract_reviews_from_page(page, max_reviews, business_name)
                if reviews:
                    result.reviews = reviews
                elif not result.reviews:
                    # Fallback to DeepSeek extraction for reviews
                    html = await page.content()
                    cleaned = clean_html(html)
                    extracted = await _extract_with_deepseek(cleaned, business_name, location)
                    if extracted and extracted.get("reviews"):
                        for r in extracted["reviews"][:max_reviews]:
                            result.reviews.append(GoogleMapsReview(
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


async def _is_captcha(page) -> bool:
    """Check if Google is showing a CAPTCHA challenge."""
    try:
        page_text = await page.evaluate("document.body.innerText")
        if "unusual traffic" in page_text.lower():
            return True
        if "robot" in page_text.lower() and "are you a robot" in page_text.lower():
            return True
        # Check for reCAPTCHA iframe
        captcha_iframe = await page.query_selector('iframe[src*="recaptcha"]')
        if captcha_iframe:
            return True
        return False
    except:
        return False


async def _extract_reviews_from_page(page, max_reviews: int, business_name: str = "") -> list[GoogleMapsReview]:
    """
    Extract reviews using robust selectors and smart scrolling.
    """
    reviews = []

    try:
        # Step 0: Make sure we're on a business detail page, not search results
        # Check if we're still on search results (multiple article cards visible)
        search_cards = await page.query_selector_all('[role="article"]')
        if len(search_cards) > 2:
            print(f"[Google Maps] Still on search results, clicking into business...", file=sys.stderr)
            # Click the first matching card
            for card in search_cards[:5]:
                try:
                    card_text = await card.inner_text()
                    if business_name.split()[0].lower() in card_text.lower():
                        await card.click()
                        await asyncio.sleep(3)
                        print(f"[Google Maps] Clicked into business detail", file=sys.stderr)
                        break
                except:
                    continue

        # Step 1: Open reviews panel
        print(f"[Google Maps] Opening reviews panel...", file=sys.stderr)

        # Try multiple selectors for the reviews button/tab
        review_buttons = [
            'button[aria-label*="Reviews"]',
            'div[role="tab"][aria-label*="Reviews"]',
            'button:has-text("Reviews")',
            '[data-tab-id="2"]',  # Sometimes reviews tab is index 2
            'button[aria-label*="review"]',
            '.fontTitleSmall:has-text("reviews")',
        ]

        opened = False
        for selector in review_buttons:
            try:
                btn = await page.query_selector(selector)
                if btn:
                    await btn.click()
                    await asyncio.sleep(2)
                    opened = True
                    print(f"[Google Maps] Clicked: {selector}", file=sys.stderr)
                    break
            except:
                continue

        # Fallback: click on the star rating/review count
        if not opened:
            try:
                await page.click('[aria-label*="reviews"]')
                await asyncio.sleep(2)
                opened = True
            except:
                pass

        # Step 2: Scroll to load reviews
        print(f"[Google Maps] Scrolling to load up to {max_reviews} reviews...", file=sys.stderr)

        no_new_count = 0
        previous_count = 0
        seen_texts = set()  # For deduplication

        # Scroll up to 20 times (usually gets ~100 reviews)
        for scroll_num in range(20):
            if len(reviews) >= max_reviews:
                break

            # Extract currently visible reviews using robust selectors
            review_elements = await page.query_selector_all('div[data-review-id]')

            # If primary selector fails, try fallback
            if not review_elements:
                review_elements = await page.query_selector_all('[role="article"]')

            for elem in review_elements:
                if len(reviews) >= max_reviews:
                    break

                try:
                    # Get full text first for dedup check
                    full_text = await elem.inner_text()

                    # Skip if we've seen this review (dedup)
                    text_hash = full_text[:100]
                    if text_hash in seen_texts:
                        continue
                    seen_texts.add(text_hash)

                    # Extract rating from aria-label like "5 stars"
                    rating = 5
                    rating_el = await elem.query_selector('[role="img"][aria-label*="star"]')
                    if rating_el:
                        rating_label = await rating_el.get_attribute("aria-label")
                        if rating_label and rating_label[0].isdigit():
                            rating = int(rating_label[0])

                    # Extract author from "Photo of [Name]" button
                    author = "Anonymous"
                    author_btn = await elem.query_selector('button[aria-label^="Photo of"]')
                    if author_btn:
                        author_label = await author_btn.get_attribute("aria-label")
                        if author_label:
                            author = author_label.replace("Photo of ", "")

                    # Extract date (relative like "2 months ago")
                    date = ""
                    date_match = re.search(r'(\d+\s+(?:day|week|month|year)s?\s+ago|a\s+(?:day|week|month|year)\s+ago)', full_text, re.I)
                    if date_match:
                        date = date_match.group(1)

                    # Try to click "More" button to expand text
                    try:
                        more_btn = await elem.query_selector('button:has-text("More")')
                        if more_btn:
                            await more_btn.click()
                            await asyncio.sleep(0.2)
                            full_text = await elem.inner_text()
                    except:
                        pass

                    # Extract review text (try specific class, then fallback to filtering)
                    review_text = ""
                    text_el = await elem.query_selector('.wiI7pd')  # Common class for review text
                    if text_el:
                        review_text = await text_el.inner_text()
                    else:
                        # Filter out metadata from full text
                        lines = [l.strip() for l in full_text.split('\n')
                                if len(l.strip()) > 30
                                and not re.match(r'^(Local Guide|Level \d|\d+ review|\d+ photo|ago$)', l.strip(), re.I)]
                        if lines:
                            review_text = ' '.join(lines)

                    # Only add if we have meaningful content
                    if len(review_text) > 20:
                        reviews.append(GoogleMapsReview(
                            text=review_text[:500],
                            rating=rating,
                            date=date,
                            reviewer_name=author
                        ))

                except Exception as e:
                    continue

            # Check if we got new reviews this scroll
            if len(reviews) == previous_count:
                no_new_count += 1
            else:
                no_new_count = 0
            previous_count = len(reviews)

            # Stop if no new reviews after 3 scrolls
            if no_new_count >= 3:
                break

            # Scroll down
            try:
                # Scroll the last review into view
                if review_elements:
                    await review_elements[-1].scroll_into_view_if_needed()
                # Also try scrolling the main panel
                await page.mouse.wheel(0, 2000)
                await asyncio.sleep(1.5)
            except:
                break

        print(f"[Google Maps] Extracted {len(reviews)} reviews", file=sys.stderr)

    except Exception as e:
        print(f"[Google Maps] Review extraction error: {e}", file=sys.stderr)

    return reviews


async def _extract_with_deepseek(html: str, business_name: str, location: str) -> Optional[dict]:
    """Use DeepSeek to extract business data from Google Maps page."""
    prompt = f'''Extract business information from this Google Maps page for "{business_name}" near "{location}".

Find the business that best matches "{business_name}" and extract:
- found: true if a matching business was found
- name: Business name as shown
- rating: Star rating (1.0-5.0, decimal)
- review_count: Total number of reviews (just the number)
- address: Full street address
- phone: Phone number
- email: Email address if shown
- website: Website URL if shown
- status: "open" or "closed" based on current status
- categories: List of business categories/types
- reviews: Up to 5 reviews with: text, rating (1-5), date, reviewer_name

Important: Only match businesses that are clearly the same as "{business_name}".
Ignore other businesses in the search results.

Return JSON:
{{
  "found": true,
  "name": "...",
  "rating": 4.5,
  "review_count": 123,
  "address": "123 Main St, City, TX",
  "phone": "(555) 123-4567",
  "email": "info@business.com",
  "website": "https://...",
  "status": "open",
  "categories": ["Roofing Contractor", "Home Services"],
  "reviews": [
    {{"text": "...", "rating": 5, "date": "2 months ago", "reviewer_name": "John D"}}
  ]
}}

If no matching business found, return {{"found": false}}

HTML (first 80k chars):
{html[:80000]}'''

    try:
        return await extract_json(prompt)
    except Exception:
        return None


def _cache_result(cache_key: str, result: GoogleMapsResult):
    """Cache the result."""
    cache.set("google_maps", cache_key, {
        "found": result.found,
        "maps_url": result.maps_url,
        "name": result.name,
        "rating": result.rating,
        "review_count": result.review_count,
        "address": result.address,
        "phone": result.phone,
        "email": result.email,
        "website": result.website,
        "status": result.status,
        "hours": result.hours,
        "categories": result.categories,
        "reviews": [
            {
                "text": r.text,
                "rating": r.rating,
                "date": r.date,
                "reviewer_name": r.reviewer_name,
                "source": "google_maps"
            }
            for r in result.reviews
        ],
        "source": "google_maps"
    })


def result_to_dict(result: GoogleMapsResult) -> dict:
    """Convert GoogleMapsResult to JSON-serializable dict."""
    return {
        "found": result.found,
        "maps_url": result.maps_url,
        "name": result.name,
        "rating": result.rating,
        "review_count": result.review_count,
        "address": result.address,
        "phone": result.phone,
        "email": result.email,
        "website": result.website,
        "status": result.status,
        "hours": result.hours,
        "categories": result.categories,
        "reviews": [
            {
                "text": r.text,
                "rating": r.rating,
                "date": r.date,
                "reviewer_name": r.reviewer_name,
                "source": "google_maps"
            }
            for r in result.reviews
        ],
        "source": result.source,
        "error": result.error,
    }


# ============================================================
# CLI
# ============================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Scrape Google Maps for business reviews")
    parser.add_argument("business_name", help="Business name to search for")
    parser.add_argument("location", nargs="?", default="Fort Worth, TX", help="City, State")
    parser.add_argument("--max-reviews", type=int, default=50, help="Max reviews to extract")
    parser.add_argument("--no-cache", action="store_true", help="Skip cache")
    parser.add_argument("--visible", action="store_true", help="Show browser window")
    parser.add_argument("--json", action="store_true", help="Output JSON format")

    args = parser.parse_args()

    result = asyncio.run(scrape_google_maps(
        args.business_name,
        args.location,
        max_reviews=args.max_reviews,
        use_cache=not args.no_cache,
        headless=not args.visible
    ))

    if args.json:
        print(json.dumps(result_to_dict(result), indent=2))
    else:
        print(f"\n{'='*50}")
        print(f"GOOGLE MAPS: {args.business_name}")
        print(f"{'='*50}")
        print(f"Found: {result.found}")

        if result.error:
            print(f"Error: {result.error}")

        if result.found:
            print(f"Name: {result.name}")
            print(f"Rating: {result.rating}")
            print(f"Reviews: {result.review_count}")
            print(f"Address: {result.address or 'N/A'}")
            print(f"Phone: {result.phone or 'N/A'}")
            print(f"Email: {result.email or 'N/A'}")
            print(f"Website: {result.website or 'N/A'}")
            print(f"Status: {result.status or 'Unknown'}")
            print(f"Categories: {', '.join(result.categories) if result.categories else 'N/A'}")
            print(f"URL: {result.maps_url}")

            if result.reviews:
                print(f"\nSample Reviews ({len(result.reviews)}):")
                for r in result.reviews[:3]:
                    print(f"  [{r.rating}] {r.reviewer_name} ({r.date})")
                    print(f"      {r.text[:100]}...")
