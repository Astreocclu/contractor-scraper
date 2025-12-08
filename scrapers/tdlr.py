#!/usr/bin/env python3
"""
TDLR LICENSE SCRAPER (Playwright Python)
Texas Department of Licensing and Regulation

Searches the TDLR license database for contractor licenses.
Handles form submission since TDLR requires interactive search.

Note: Many home improvement trades (roofing, fencing, pools, general
contracting) do NOT require TDLR licenses in Texas. Only specific
trades like HVAC, electrical, plumbing, and irrigation require licensing.

Usage:
  python scrapers/tdlr.py "ABC Roofing"
  python scrapers/tdlr.py "Smith Electric" --no-cache
"""

import asyncio
import re
import sys
from dataclasses import dataclass, field
from typing import Optional

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

try:
    from scrapers.utils import (
        cache,
        rate_limiter,
        get_random_user_agent,
        clean_html,
        ScraperError,
    )
    from scrapers.deepseek import extract_json
except ImportError:
    from utils import (
        cache,
        rate_limiter,
        get_random_user_agent,
        clean_html,
        ScraperError,
    )
    from deepseek import extract_json

TDLR_SEARCH_URL = "https://www.tdlr.texas.gov/LicenseSearch/"

# License types relevant to contractors
CONTRACTOR_LICENSE_TYPES = [
    "Air Conditioning and Refrigeration Contractor",
    "Electrician",
    "Electrical Contractor",
    "Plumber",
    "Boiler",
    "Water Well",
    "Irrigation",
]

# Keywords that suggest TDLR license is required
LICENSED_TRADE_KEYWORDS = [
    "hvac", "air condition", "ac ", "a/c", "heating", "cooling",
    "electric", "electrical", "electrician",
    "plumb", "plumber", "plumbing",
    "irrigation", "sprinkler",
    "well", "water well",
    "boiler",
]


@dataclass
class TDLRLicense:
    """Individual license record."""
    license_number: str
    license_type: str = ""
    holder_name: str = ""
    business_name: str = ""
    status: str = ""  # Active, Expired, Revoked, Suspended
    expiration_date: Optional[str] = None
    issue_date: Optional[str] = None
    raw_text: str = ""


@dataclass
class TDLRResult:
    """TDLR search result."""
    found: bool
    licenses: list[TDLRLicense] = field(default_factory=list)
    search_term: str = ""
    requires_license: bool = False  # Whether this trade typically requires TDLR
    source: str = "tdlr"
    error: Optional[str] = None


def requires_tdlr_license(business_name: str, vertical: str = "") -> bool:
    """
    Determine if a contractor type likely requires TDLR licensing.

    Many home improvement trades (roofing, fencing, pools, general contracting)
    do NOT require licenses in Texas.

    Args:
        business_name: Name of the business
        vertical: Business category/vertical

    Returns:
        True if trade typically requires TDLR license
    """
    name = (business_name or "").lower()
    vert = (vertical or "").lower()

    return any(kw in name or kw in vert for kw in LICENSED_TRADE_KEYWORDS)


async def search_tdlr(
    business_name: str,
    use_cache: bool = True,
    headless: bool = True
) -> TDLRResult:
    """
    Search TDLR for contractor licenses.

    Args:
        business_name: Business name to search for
        use_cache: Whether to use cached results
        headless: Whether to run browser in headless mode

    Returns:
        TDLRResult with found licenses
    """
    cache_key = business_name.lower().strip()

    # Check cache
    if use_cache:
        cached = cache.get("tdlr", cache_key)
        if cached:
            # Reconstruct dataclass from cached dict
            licenses = [TDLRLicense(**lic) for lic in cached.get("licenses", [])]
            return TDLRResult(
                found=cached["found"],
                licenses=licenses,
                search_term=cached.get("search_term", business_name),
                requires_license=cached.get("requires_license", False),
                source="tdlr"
            )

    # Rate limit
    await rate_limiter.acquire("tdlr.texas.gov")

    result = TDLRResult(
        found=False,
        search_term=business_name,
        requires_license=requires_tdlr_license(business_name)
    )

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled"]
        )
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=get_random_user_agent()
        )
        page = await context.new_page()

        try:
            # Navigate to TDLR search page
            print(f"[TDLR] Searching for: {business_name}", file=sys.stderr)
            await page.goto(TDLR_SEARCH_URL, wait_until="networkidle", timeout=30000)

            # Wait for the search form - TDLR uses specific field names
            # pht_oth_name = "Inquire by Name (Last, First) or by Business Name"
            await page.wait_for_selector('input[name="pht_oth_name"]', timeout=10000)

            # Fill the business name search field
            await page.fill('input[name="pht_oth_name"]', business_name)

            # Click the Search button
            await page.click('input[name="B1"]')

            # Wait for results
            await asyncio.sleep(3)

            # Get page content
            content = await page.content()
            text_content = await page.evaluate("() => document.body.innerText")

            # Check for no results
            if "no records found" in text_content.lower() or "0 results" in text_content.lower():
                result.found = False
                _cache_result(cache_key, result)
                return result

            # Try to extract licenses directly from page
            licenses = await _extract_licenses_from_page(page)

            if licenses:
                result.found = True
                result.licenses = licenses
            else:
                # Fall back to DeepSeek extraction
                html = clean_html(content)
                extracted = await _extract_with_deepseek(html, business_name)
                if extracted:
                    result.found = True
                    result.licenses = extracted

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


async def _extract_licenses_from_page(page) -> list[TDLRLicense]:
    """Extract license information directly from page elements."""
    licenses = []
    seen_licenses = set()  # Dedupe

    try:
        # Get full page text for parsing
        page_text = await page.evaluate("() => document.body.innerText")

        # TDLR results format:
        # License#  Exp Date  Name  City  Zip  County  Phone
        # TACLB00133168E  09/21/2026  JOHNSON, RYAN MARC (BERKEYS LLC)  ...
        # EC - 30739  02/09/2026  BERKEYS LLC  SOUTHLAKE TX  ...

        # Look for license patterns - TDLR uses formats like:
        # TACLB00133168E, EC - 30739, TECL12345, etc.
        license_patterns = [
            r"(TACL[AB]\d+[A-Z]?)",  # Air Conditioning License
            r"(EC\s*-?\s*\d+)",       # Electrician
            r"(TECL\d+)",             # Electrical Contractor
            r"(M\d{5,})",             # Master Plumber
            r"(J\d{5,})",             # Journeyman
            r"([A-Z]{2,5}\d{5,}[A-Z]?)",  # Generic TDLR format
        ]

        for pattern in license_patterns:
            for match in re.finditer(pattern, page_text):
                license_num = match.group(1).strip()
                # Normalize EC format
                license_num = re.sub(r"EC\s*-?\s*", "EC-", license_num)

                if license_num in seen_licenses:
                    continue
                seen_licenses.add(license_num)

                # Find expiration date near this license
                context_start = max(0, match.start() - 20)
                context_end = min(len(page_text), match.end() + 100)
                context = page_text[context_start:context_end]

                date_match = re.search(r"(\d{1,2}/\d{1,2}/\d{4})", context)
                exp_date = date_match.group(1) if date_match else None

                # Determine status based on expiration date
                status = "Active"  # Default for TDLR search results
                if exp_date:
                    from datetime import datetime
                    try:
                        exp = datetime.strptime(exp_date, "%m/%d/%Y")
                        if exp < datetime.now():
                            status = "Expired"
                    except ValueError:
                        pass

                # Find name near this license
                name_match = re.search(r"(\d{4})\s+([A-Z][A-Z\s,]+(?:LLC|INC|CORP)?)", context)
                holder_name = name_match.group(2).strip() if name_match else ""

                licenses.append(TDLRLicense(
                    license_number=license_num,
                    status=status,
                    expiration_date=exp_date,
                    holder_name=holder_name,
                    raw_text=context[:200]
                ))

    except Exception as e:
        pass

    return licenses


async def _extract_with_deepseek(html: str, business_name: str) -> list[TDLRLicense]:
    """Use DeepSeek to extract license data from HTML."""
    prompt = f'''Extract all license records from this TDLR search results page for "{business_name}".

For each license found, extract:
- license_number: The license number (format like TACLA12345 or similar)
- license_type: Type of license (e.g., "Air Conditioning Contractor", "Electrician")
- holder_name: Name of the license holder
- business_name: Business name if shown
- status: License status (Active, Expired, Revoked, Suspended)
- expiration_date: Expiration date if shown
- issue_date: Issue date if shown

Return JSON:
{{"found": true/false, "licenses": [{{"license_number": "...", "license_type": "...", "holder_name": "...", "business_name": "...", "status": "...", "expiration_date": "...", "issue_date": "..."}}]}}

If no licenses found, return {{"found": false, "licenses": []}}

HTML (first 50k chars):
{html[:50000]}'''

    try:
        data = await extract_json(prompt)
        if data and data.get("licenses"):
            return [
                TDLRLicense(
                    license_number=lic.get("license_number", ""),
                    license_type=lic.get("license_type", ""),
                    holder_name=lic.get("holder_name", ""),
                    business_name=lic.get("business_name", ""),
                    status=lic.get("status", ""),
                    expiration_date=lic.get("expiration_date"),
                    issue_date=lic.get("issue_date")
                )
                for lic in data["licenses"]
                if lic.get("license_number")
            ]
    except Exception:
        pass

    return []


def _cache_result(cache_key: str, result: TDLRResult):
    """Cache the result."""
    cache.set("tdlr", cache_key, {
        "found": result.found,
        "licenses": [
            {
                "license_number": lic.license_number,
                "license_type": lic.license_type,
                "holder_name": lic.holder_name,
                "business_name": lic.business_name,
                "status": lic.status,
                "expiration_date": lic.expiration_date,
                "issue_date": lic.issue_date,
                "raw_text": lic.raw_text
            }
            for lic in result.licenses
        ],
        "search_term": result.search_term,
        "requires_license": result.requires_license,
        "source": "tdlr"
    })


async def lookup_license(
    license_number: str,
    use_cache: bool = True,
    headless: bool = True
) -> TDLRResult:
    """
    Look up a specific license by number.

    Args:
        license_number: License number to look up
        use_cache: Whether to use cached results
        headless: Whether to run browser in headless mode

    Returns:
        TDLRResult with license details
    """
    cache_key = f"license:{license_number.upper()}"

    if use_cache:
        cached = cache.get("tdlr", cache_key)
        if cached:
            licenses = [TDLRLicense(**lic) for lic in cached.get("licenses", [])]
            return TDLRResult(
                found=cached["found"],
                licenses=licenses,
                search_term=license_number,
                source="tdlr"
            )

    await rate_limiter.acquire("tdlr.texas.gov")

    result = TDLRResult(found=False, search_term=license_number)

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=headless,
            args=["--disable-blink-features=AutomationControlled"]
        )
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=get_random_user_agent()
        )
        page = await context.new_page()

        try:
            await page.goto(TDLR_SEARCH_URL, wait_until="networkidle", timeout=30000)

            # Look for license number search option
            license_radio = await page.query_selector(
                'input[value="license"], input[name="searchType"][value="license"]'
            )
            if license_radio:
                await license_radio.click()
                await asyncio.sleep(0.5)

            # Fill in license number
            search_input = (
                await page.query_selector('input[name="SearchTerm"]') or
                await page.query_selector('input[type="text"]')
            )

            if search_input:
                await search_input.click(click_count=3)
                await search_input.fill(license_number)
                await page.keyboard.press("Enter")

                await asyncio.sleep(3)

                text_content = await page.evaluate("() => document.body.innerText")

                if "no records found" not in text_content.lower():
                    result.found = True
                    # Extract status and dates
                    status_match = re.search(r"(Active|Expired|Revoked|Suspended)", text_content, re.I)
                    exp_match = re.search(r"Expir\w*[:\s]+(\d{1,2}/\d{1,2}/\d{4})", text_content, re.I)
                    issue_match = re.search(r"Issue\w*[:\s]+(\d{1,2}/\d{1,2}/\d{4})", text_content, re.I)

                    result.licenses = [TDLRLicense(
                        license_number=license_number,
                        status=status_match.group(1) if status_match else "",
                        expiration_date=exp_match.group(1) if exp_match else None,
                        issue_date=issue_match.group(1) if issue_match else None,
                        raw_text=text_content[:2000]
                    )]

            _cache_result(cache_key, result)
            return result

        except Exception as e:
            result.error = str(e)
            return result
        finally:
            await browser.close()


# ============================================================
# CLI
# ============================================================

def result_to_dict(result: TDLRResult) -> dict:
    """Convert TDLRResult to JSON-serializable dict."""
    return {
        "found": result.found,
        "licenses": [
            {
                "license_number": lic.license_number,
                "license_type": lic.license_type,
                "holder_name": lic.holder_name,
                "business_name": lic.business_name,
                "status": lic.status,
                "expiration_date": lic.expiration_date,
                "issue_date": lic.issue_date,
            }
            for lic in result.licenses
        ],
        "search_term": result.search_term,
        "requires_license": result.requires_license,
        "source": result.source,
        "error": result.error,
    }


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Search TDLR for contractor licenses")
    parser.add_argument("business_name", help="Business name to search for")
    parser.add_argument("--no-cache", action="store_true", help="Skip cache")
    parser.add_argument("--visible", action="store_true", help="Show browser window")
    parser.add_argument("--json", action="store_true", help="Output JSON format")

    args = parser.parse_args()

    result = asyncio.run(search_tdlr(
        args.business_name,
        use_cache=not args.no_cache,
        headless=not args.visible
    ))

    if args.json:
        print(json.dumps(result_to_dict(result), indent=2))
    else:
        print(f"\n{'='*50}")
        print(f"TDLR SEARCH: {result.search_term}")
        print(f"{'='*50}")
        print(f"Found: {result.found}")
        print(f"Requires TDLR License: {result.requires_license}")

        if result.error:
            print(f"Error: {result.error}")

        if result.licenses:
            print(f"\nLicenses ({len(result.licenses)}):")
            for lic in result.licenses:
                print(f"  - {lic.license_number}: {lic.status}")
                if lic.license_type:
                    print(f"    Type: {lic.license_type}")
                if lic.expiration_date:
                    print(f"    Expires: {lic.expiration_date}")
        elif result.found:
            print("\nLicense data found but could not parse details.")
        else:
            if result.requires_license:
                print("\nWARNING: This trade typically requires a TDLR license but none was found.")
            else:
                print("\nNote: Many TX contractors (roofing, fencing, pools) don't need TDLR licenses.")
