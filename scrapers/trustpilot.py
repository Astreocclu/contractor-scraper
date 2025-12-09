#!/usr/bin/env python3
"""
TRUSTPILOT SCRAPER (httpx + BeautifulSoup)
Tier 1: Direct URL check - no search needed.

Unlike other scrapers, this uses the contractor's DOMAIN to check
if they have a Trustpilot profile at trustpilot.com/review/{domain}.

Usage:
  python scrapers/trustpilot.py "puryearpools.com"
  python scrapers/trustpilot.py "www.lesliespool.com"
"""

import asyncio
import json
import re
import sys
from dataclasses import dataclass, asdict
from typing import Optional
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

try:
    from scrapers.utils import cache, rate_limiter, get_headers
except ImportError:
    from utils import cache, rate_limiter, get_headers


@dataclass
class TrustpilotResult:
    """Trustpilot scrape result."""
    found: bool
    domain: Optional[str] = None
    rating: Optional[float] = None  # 1-5 stars
    review_count: Optional[int] = None
    trust_score: Optional[str] = None  # "Excellent", "Great", "Average", etc.
    profile_url: Optional[str] = None
    business_name: Optional[str] = None
    source: str = "trustpilot"
    error: Optional[str] = None


def extract_domain(url_or_domain: str) -> str:
    """Extract clean domain from URL or domain string."""
    if not url_or_domain:
        return ""

    # If it looks like a URL, parse it
    if "://" in url_or_domain:
        try:
            parsed = urlparse(url_or_domain)
            domain = parsed.netloc
        except:
            domain = url_or_domain
    else:
        domain = url_or_domain

    # Remove www. prefix
    domain = re.sub(r'^www\.', '', domain.lower())

    # Remove trailing slashes/paths
    domain = domain.split('/')[0]

    return domain


async def check_profile_exists(client: httpx.AsyncClient, domain: str) -> Optional[str]:
    """
    Check if Trustpilot profile exists for domain.

    Returns the working URL if found, None otherwise.
    Tries both {domain} and www.{domain} variants.
    """
    variants = [domain, f"www.{domain}"]

    for variant in variants:
        url = f"https://www.trustpilot.com/review/{variant}"
        try:
            resp = await client.head(url, follow_redirects=False)
            if resp.status_code == 200:
                return url
            # Handle redirects to the canonical URL
            if resp.status_code in (301, 302, 307, 308):
                location = resp.headers.get('location', '')
                if 'trustpilot.com/review/' in location:
                    return location
        except Exception:
            continue

    return None


async def scrape_trustpilot_page(client: httpx.AsyncClient, url: str) -> TrustpilotResult:
    """Scrape rating and review count from Trustpilot profile page."""
    try:
        resp = await client.get(url, follow_redirects=True)
        if resp.status_code != 200:
            return TrustpilotResult(found=False, error=f"HTTP {resp.status_code}")

        html = resp.text
        soup = BeautifulSoup(html, 'html.parser')

        # Extract rating from JSON-LD structured data (most reliable)
        rating = None
        review_count = None
        business_name = None
        trust_score = None

        # Method 1: JSON-LD structured data
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string)
                if isinstance(data, dict):
                    if data.get('@type') == 'Organization':
                        agg = data.get('aggregateRating', {})
                        if agg:
                            rating = float(agg.get('ratingValue', 0))
                            review_count = int(agg.get('reviewCount', 0))
                            business_name = data.get('name')
                            break
            except (json.JSONDecodeError, ValueError, TypeError):
                continue

        # Method 2: Parse from HTML if JSON-LD failed
        if rating is None:
            # Look for rating in the page
            rating_elem = soup.select_one('[data-rating-typography]')
            if rating_elem:
                try:
                    rating = float(rating_elem.text.strip())
                except ValueError:
                    pass

            # Alternative: look for star rating element
            if rating is None:
                star_elem = soup.select_one('.star-rating')
                if star_elem:
                    img = star_elem.find('img')
                    if img and img.get('alt'):
                        match = re.search(r'([\d.]+)', img['alt'])
                        if match:
                            rating = float(match.group(1))

        if review_count is None:
            # Look for review count
            count_elem = soup.select_one('[data-reviews-count-typography]')
            if count_elem:
                text = count_elem.text.strip()
                # Parse "1,234 reviews" or "1234"
                match = re.search(r'([\d,]+)', text)
                if match:
                    review_count = int(match.group(1).replace(',', ''))

        if business_name is None:
            # Get business name from title or h1
            title_elem = soup.select_one('h1[data-business-unit-name-typography]')
            if title_elem:
                business_name = title_elem.text.strip()
            else:
                title = soup.find('title')
                if title:
                    # Title format: "Company Name Reviews | Read Customer Service Reviews..."
                    business_name = title.text.split('Reviews')[0].strip()

        # Get trust score label (Excellent, Great, Average, Poor, Bad)
        score_elem = soup.select_one('[data-consumer-rating-title-typography]')
        if score_elem:
            trust_score = score_elem.text.strip()

        # Extract domain from URL
        domain = url.split('/review/')[-1].split('?')[0]

        return TrustpilotResult(
            found=True,
            domain=domain,
            rating=rating,
            review_count=review_count,
            trust_score=trust_score,
            profile_url=url,
            business_name=business_name,
        )

    except Exception as e:
        return TrustpilotResult(found=False, error=str(e))


async def scrape_trustpilot(
    domain_or_url: str,
    use_cache: bool = True
) -> TrustpilotResult:
    """
    Scrape Trustpilot profile by domain.

    Args:
        domain_or_url: Domain name or full URL (e.g., "lesliespool.com" or "https://www.lesliespool.com")
        use_cache: Whether to use cached results

    Returns:
        TrustpilotResult with rating and review data
    """
    domain = extract_domain(domain_or_url)

    if not domain:
        return TrustpilotResult(found=False, error="Invalid domain")

    # Skip social media and marketplace domains
    skip_domains = [
        'facebook.com', 'instagram.com', 'twitter.com', 'linkedin.com',
        'youtube.com', 'yelp.com', 'google.com', 'homeadvisor.com',
        'angi.com', 'thumbtack.com', 'houzz.com', 'bbb.org'
    ]
    if any(skip in domain for skip in skip_domains):
        return TrustpilotResult(found=False, error="Social/marketplace domain skipped")

    cache_key = f"trustpilot:{domain}"

    # Check cache
    if use_cache:
        cached = cache.get("trustpilot", cache_key)
        if cached:
            return TrustpilotResult(**cached)

    # Rate limit
    await rate_limiter.acquire("trustpilot.com")

    async with httpx.AsyncClient(
        headers=get_headers(),
        timeout=15.0,
        follow_redirects=True
    ) as client:
        # Check if profile exists
        profile_url = await check_profile_exists(client, domain)

        if not profile_url:
            result = TrustpilotResult(found=False, domain=domain)
        else:
            # Scrape the profile page
            result = await scrape_trustpilot_page(client, profile_url)
            result.domain = domain

    # Cache result
    if use_cache:
        cache.set("trustpilot", cache_key, asdict(result))

    return result


async def main():
    """CLI entry point."""
    if len(sys.argv) < 2:
        print("Usage: python scrapers/trustpilot.py <domain>", file=sys.stderr)
        print("Example: python scrapers/trustpilot.py lesliespool.com", file=sys.stderr)
        sys.exit(1)

    domain = sys.argv[1]

    result = await scrape_trustpilot(domain)

    # Output as JSON for Node.js consumption
    print(json.dumps(asdict(result), indent=2))


if __name__ == "__main__":
    asyncio.run(main())
