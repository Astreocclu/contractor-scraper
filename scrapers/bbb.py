#!/usr/bin/env python3
"""
BBB SCRAPER (httpx + BeautifulSoup)
Tier 1: Static HTML - no browser needed.

Usage:
  python scrapers/bbb.py "Orange Elephant Roofing" "Fort Worth" "TX"
  python scrapers/bbb.py "Smith Electric" --with-details
"""

import asyncio
import re
import urllib.parse
from dataclasses import dataclass, field
from typing import Optional

import httpx
from bs4 import BeautifulSoup

try:
    from scrapers.utils import (
        cache,
        rate_limiter,
        get_headers,
        clean_html,
    )
    from scrapers.deepseek import extract_json
except ImportError:
    from utils import (
        cache,
        rate_limiter,
        get_headers,
        clean_html,
    )
    from deepseek import extract_json


@dataclass
class BBBComplaint:
    """BBB complaint record."""
    date: str
    type: str
    status: str
    description: str = ""


@dataclass
class BBBResult:
    """BBB scrape result."""
    found: bool
    name: Optional[str] = None
    rating: Optional[str] = None  # A+, A, B, C, D, F
    accredited: bool = False
    profile_url: Optional[str] = None
    email: Optional[str] = None  # Business contact email
    phone: Optional[str] = None  # Business phone number
    years_in_business: Optional[int] = None
    complaint_count: Optional[int] = None
    complaints_closed_12mo: Optional[int] = None
    review_count: Optional[int] = None
    customer_review_rating: Optional[float] = None  # 1-5 stars from customers
    complaints: list[BBBComplaint] = field(default_factory=list)
    source: str = "bbb"
    error: Optional[str] = None


async def scrape_bbb(
    business_name: str,
    city: str = "Fort Worth",
    state: str = "TX",
    with_details: bool = False,
    use_cache: bool = True
) -> BBBResult:
    """
    Scrape BBB for business profile.

    Uses httpx (Tier 1) - BBB embeds search results in JSON in the HTML.

    Args:
        business_name: Business name to search for
        city: City name
        state: State abbreviation
        with_details: Whether to fetch full profile page for complaints
        use_cache: Whether to use cached results

    Returns:
        BBBResult with business info
    """
    cache_key = f"{business_name.lower().strip()}:{city.lower()}:{state.lower()}"

    # Check cache
    if use_cache:
        cached = cache.get("bbb", cache_key)
        if cached:
            complaints = [BBBComplaint(**c) for c in cached.get("complaints", [])]
            return BBBResult(
                found=cached["found"],
                name=cached.get("name"),
                rating=cached.get("rating"),
                accredited=cached.get("accredited", False),
                profile_url=cached.get("profile_url"),
                email=cached.get("email"),
                phone=cached.get("phone"),
                years_in_business=cached.get("years_in_business"),
                complaint_count=cached.get("complaint_count"),
                complaints_closed_12mo=cached.get("complaints_closed_12mo"),
                review_count=cached.get("review_count"),
                customer_review_rating=cached.get("customer_review_rating"),
                complaints=complaints,
                source="bbb"
            )

    # Rate limit
    await rate_limiter.acquire("bbb.org")

    result = BBBResult(found=False)

    # Build search URL
    query = urllib.parse.quote(business_name)
    location = urllib.parse.quote(f"{city}, {state}")
    search_url = f"https://www.bbb.org/search?find_text={query}&find_loc={location}&find_type=Category"

    import sys as _sys
    print(f"[BBB] Searching for: {business_name} in {city}, {state}", file=_sys.stderr)

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # Step 1: Search page
            response = await client.get(search_url, headers=get_headers(), follow_redirects=True)
            response.raise_for_status()

            html = response.text

            # BBB embeds search results in webDigitalData JSON
            json_result = _parse_embedded_json(html, business_name)
            if json_result:
                result = json_result
                _cache_result(cache_key, result)
                return result

            # Fallback: Try BeautifulSoup parsing
            soup = BeautifulSoup(html, "html.parser")

            # Check for "no results" message first
            no_results = soup.select_one('[class*="no-results"], .dtm-no-results')
            if no_results:
                result.found = False
                _cache_result(cache_key, result)
                return result

            cards = (
                soup.select('[data-testid="search-result"]') or
                soup.select(".search-result-item") or
                soup.select('[class*="BusinessCard"]') or
                soup.select(".result-item")
                # Removed: soup.select('[class*="result"]') - too broad, matches no-results
            )

            if cards:
                card = cards[0]
                result = _parse_search_card(card)
                if with_details and result.profile_url:
                    result = await _fetch_profile_details(client, result)
                _cache_result(cache_key, result)
                return result

            # Fallback: DeepSeek extraction
            cleaned = clean_html(html)
            data = await _extract_search_results(cleaned, business_name)
            if data and data.get("found"):
                result = _build_result_from_data(data)
                if with_details and result.profile_url:
                    result = await _fetch_profile_details(client, result)
                _cache_result(cache_key, result)
                return result

            result.found = False
            _cache_result(cache_key, result)
            return result

        except httpx.HTTPStatusError as e:
            result.error = f"HTTP {e.response.status_code}"
            return result
        except Exception as e:
            result.error = str(e)
            return result


def _parse_embedded_json(html: str, business_name: str) -> Optional[BBBResult]:
    """
    Parse BBB's embedded webDigitalData JSON from HTML.

    BBB embeds search results in a JavaScript variable like:
    var webDigitalData = {..., "search_info": {"results": [...]}}
    """
    import json

    # Find the webDigitalData JSON
    # BBB uses: var webDigitalData={...} or webDigitalData={...}
    match = re.search(r'(?:var\s+)?webDigitalData\s*=\s*(\{.*?\})(?:;|<)', html, re.DOTALL)
    if not match:
        return None

    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None

    search_info = data.get("search_info", {})
    results = search_info.get("results", [])

    if not results:
        return None

    # Find best match by name similarity
    business_lower = business_name.lower()
    best_match = None
    best_score = 0

    for r in results:
        name = r.get("business_name", "")
        # Simple matching
        if business_lower in name.lower() or name.lower() in business_lower:
            score = 1.0
        else:
            # Word overlap
            words1 = set(business_lower.split())
            words2 = set(name.lower().split())
            overlap = len(words1 & words2)
            score = overlap / max(len(words1), 1)

        if score > best_score:
            best_score = score
            best_match = r

    if not best_match or best_score < 0.5:  # Require 50% match minimum
        return None

    # Parse the match
    rating = best_match.get("business_rating", "").strip()
    accredited = best_match.get("accredited_status", "") == "AB"
    name = best_match.get("business_name", "")
    business_id = best_match.get("business_id", "")
    bbb_id = best_match.get("bbb_id", "")

    # Construct profile URL if we have the IDs
    profile_url = None
    if business_id:
        # BBB profile URLs follow pattern like /us/tx/fort-worth/profile/roofing-contractors/business-name-id
        # We'd need to fetch or construct this - for now leave it None and let details fetch find it
        pass

    return BBBResult(
        found=True,
        name=name,
        rating=rating if rating else None,
        accredited=accredited,
        profile_url=profile_url,
        source="bbb"
    )


def _parse_search_card(card: BeautifulSoup) -> BBBResult:
    """Parse a BBB search result card."""
    result = BBBResult(found=True)

    # Rating (A+, A, B, F, etc.)
    rating_elem = (
        card.select_one('[class*="rating"]') or
        card.select_one('[class*="grade"]') or
        card.select_one(".bbb-rating")
    )
    if rating_elem:
        rating_text = rating_elem.get_text(strip=True)
        # Extract letter grade
        grade_match = re.search(r"([A-F][+-]?)", rating_text)
        if grade_match:
            result.rating = grade_match.group(1)

    # Business name
    name_elem = (
        card.select_one("h3") or
        card.select_one('[class*="business-name"]') or
        card.select_one('a[href*="/business-reviews/"]')
    )
    if name_elem:
        result.name = name_elem.get_text(strip=True)

    # Accreditation
    accredited = bool(
        card.select_one('[class*="accredited"]') or
        card.select_one('[class*="Accredited"]') or
        card.select_one('[class*="ab-seal"]') or
        "accredited" in card.get_text().lower()
    )
    result.accredited = accredited

    # Profile URL
    link = card.select_one('a[href*="/business-reviews/"]')
    if link and link.get("href"):
        href = link["href"]
        if href.startswith("/"):
            result.profile_url = f"https://www.bbb.org{href}"
        elif href.startswith("http"):
            result.profile_url = href

    return result


async def _fetch_profile_details(client: httpx.AsyncClient, result: BBBResult) -> BBBResult:
    """Fetch additional details from the profile page."""
    if not result.profile_url:
        return result

    await rate_limiter.acquire("bbb.org")

    try:
        response = await client.get(result.profile_url, headers=get_headers(), follow_redirects=True)
        response.raise_for_status()

        raw_html = response.text
        html = clean_html(raw_html)

        # === EMAIL REGEX EXTRACTION (before LLM call - $0 cost) ===
        # Junk domains to filter
        junk_domains = ['wix.com', 'squarespace.com', 'example.com', 'domain.com', 'bbb.org']

        # 1. Look for mailto links (highest confidence)
        email_match = re.search(
            r'mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})',
            raw_html,
            re.IGNORECASE
        )
        if email_match:
            candidate = email_match.group(1).strip().lower()
            if not any(j in candidate for j in junk_domains):
                result.email = candidate

        # 2. Fallback: Search visible text for email pattern
        if not result.email:
            text_email = re.search(
                r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
                html
            )
            if text_email:
                candidate = text_email.group(0).strip().lower()
                if not any(j in candidate for j in junk_domains):
                    result.email = candidate

        # === PHONE REGEX EXTRACTION ===
        # Look for phone patterns: (XXX) XXX-XXXX or XXX-XXX-XXXX
        phone_match = re.search(
            r'\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}',
            html
        )
        if phone_match:
            result.phone = phone_match.group(0).strip()

        details = await _extract_profile_details(html)

        if details:
            if details.get("rating"):
                result.rating = details["rating"]
            if details.get("years_in_business"):
                result.years_in_business = details["years_in_business"]
            if details.get("complaint_count") is not None:
                result.complaint_count = details["complaint_count"]
            if details.get("complaints_closed_12mo") is not None:
                result.complaints_closed_12mo = details["complaints_closed_12mo"]
            if details.get("review_count") is not None:
                result.review_count = details["review_count"]
            if details.get("customer_review_rating") is not None:
                result.customer_review_rating = details["customer_review_rating"]
            if details.get("accredited") is not None:
                result.accredited = details["accredited"]

    except Exception as e:
        # Don't fail if details fetch fails
        pass

    return result


async def _extract_search_results(html: str, business_name: str) -> Optional[dict]:
    """Use DeepSeek to extract search results."""
    prompt = f'''Find the business "{business_name}" in these BBB search results.

Look for the business card/listing that best matches "{business_name}".

Extract:
- found: true if a match exists
- name: Business name as shown
- rating: BBB letter rating (A+, A, B, C, D, F)
- accredited: true if BBB Accredited Business
- profile_url: Link to full profile (contains /business-reviews/)

Return JSON:
{{"found": true, "name": "...", "rating": "A+", "accredited": true, "profile_url": "https://..."}}

If no match found, return {{"found": false}}

HTML (first 50k chars):
{html[:50000]}'''

    try:
        return await extract_json(prompt)
    except Exception:
        return None


async def _extract_profile_details(html: str) -> Optional[dict]:
    """Use DeepSeek to extract profile page details."""
    prompt = '''Extract BBB profile details from this page.

Look for:
- rating: BBB letter rating (A+, A, B, C, D, F)
- accredited: true if BBB Accredited Business
- years_in_business: Number of years in business
- complaint_count: Total complaints on file
- complaints_closed_12mo: Complaints closed in last 12 months
- review_count: Number of customer reviews
- customer_review_rating: Average customer review rating (1-5 stars)

Return JSON:
{
  "rating": "F",
  "accredited": false,
  "years_in_business": 5,
  "complaint_count": 23,
  "complaints_closed_12mo": 15,
  "review_count": 45,
  "customer_review_rating": 1.5
}

Only include fields you can find. Return empty {} if nothing found.

HTML (first 60k chars):
''' + html[:60000]

    try:
        return await extract_json(prompt)
    except Exception:
        return None


def _build_result_from_data(data: dict) -> BBBResult:
    """Build BBBResult from extracted data dict."""
    return BBBResult(
        found=True,
        name=data.get("name"),
        rating=data.get("rating"),
        accredited=data.get("accredited", False),
        profile_url=data.get("profile_url")
    )


def _cache_result(cache_key: str, result: BBBResult):
    """Cache the result."""
    cache.set("bbb", cache_key, {
        "found": result.found,
        "name": result.name,
        "rating": result.rating,
        "accredited": result.accredited,
        "profile_url": result.profile_url,
        "email": result.email,
        "phone": result.phone,
        "years_in_business": result.years_in_business,
        "complaint_count": result.complaint_count,
        "complaints_closed_12mo": result.complaints_closed_12mo,
        "review_count": result.review_count,
        "customer_review_rating": result.customer_review_rating,
        "complaints": [
            {"date": c.date, "type": c.type, "status": c.status, "description": c.description}
            for c in result.complaints
        ],
        "source": "bbb"
    })


# ============================================================
# RATING ANALYSIS
# ============================================================

def is_critical_rating(rating: Optional[str]) -> bool:
    """Check if BBB rating indicates critical issues."""
    if not rating:
        return False
    return rating.upper() in ("F", "D", "D+", "D-")


def is_warning_rating(rating: Optional[str]) -> bool:
    """Check if BBB rating indicates warnings."""
    if not rating:
        return False
    return rating.upper() in ("C", "C+", "C-")


# ============================================================
# CLI
# ============================================================

def result_to_dict(result: BBBResult) -> dict:
    """Convert BBBResult to JSON-serializable dict."""
    return {
        "found": result.found,
        "name": result.name,
        "rating": result.rating,
        "accredited": result.accredited,
        "profile_url": result.profile_url,
        "email": result.email,
        "phone": result.phone,
        "years_in_business": result.years_in_business,
        "complaint_count": result.complaint_count,
        "complaints_closed_12mo": result.complaints_closed_12mo,
        "review_count": result.review_count,
        "customer_review_rating": result.customer_review_rating,
        "complaints": [
            {"date": c.date, "type": c.type, "status": c.status, "description": c.description}
            for c in result.complaints
        ],
        "source": result.source,
        "error": result.error,
        "is_critical": is_critical_rating(result.rating),
        "is_warning": is_warning_rating(result.rating),
    }


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Scrape BBB for business profile")
    parser.add_argument("business_name", help="Business name to search for")
    parser.add_argument("city", nargs="?", default="Fort Worth", help="City")
    parser.add_argument("state", nargs="?", default="TX", help="State abbreviation")
    parser.add_argument("--with-details", action="store_true", help="Fetch full profile details")
    parser.add_argument("--no-cache", action="store_true", help="Skip cache")
    parser.add_argument("--json", action="store_true", help="Output JSON format")

    args = parser.parse_args()

    result = asyncio.run(scrape_bbb(
        args.business_name,
        args.city,
        args.state,
        with_details=args.with_details,
        use_cache=not args.no_cache
    ))

    if args.json:
        print(json.dumps(result_to_dict(result), indent=2))
    else:
        print(f"\n{'='*50}")
        print(f"BBB: {args.business_name}")
        print(f"{'='*50}")
        print(f"Found: {result.found}")

        if result.error:
            print(f"Error: {result.error}")

        if result.found:
            print(f"Name: {result.name}")
            print(f"Rating: {result.rating}")
            print(f"Accredited: {result.accredited}")
            print(f"URL: {result.profile_url}")
            if result.email:
                print(f"Email: {result.email}")
            if result.phone:
                print(f"Phone: {result.phone}")

            if result.years_in_business:
                print(f"Years in Business: {result.years_in_business}")
            if result.complaint_count is not None:
                print(f"Total Complaints: {result.complaint_count}")
            if result.complaints_closed_12mo is not None:
                print(f"Complaints (12mo): {result.complaints_closed_12mo}")
            if result.review_count is not None:
                print(f"Customer Reviews: {result.review_count}")
            if result.customer_review_rating is not None:
                print(f"Customer Rating: {result.customer_review_rating}/5")

            if is_critical_rating(result.rating):
                print(f"\n*** CRITICAL: BBB rating {result.rating} indicates serious issues ***")
            elif is_warning_rating(result.rating):
                print(f"\n** WARNING: BBB rating {result.rating} indicates concerns **")
