#!/usr/bin/env python3
"""
Outscraper Reviews Scraper

Fetches reviews from Google Maps, Yelp, BBB, and Trustpilot via Outscraper API.
Designed as a cost-effective replacement for Serper API.

Usage:
    python3 outscraper_reviews.py "Business Name" "City, State" --source google --max-reviews 20 --json

Sources: google, yelp, bbb, trustpilot

Pricing (as of Jan 2026):
    - Google: $3/1000 reviews (500 free/month)
    - Yelp: ~$5/1000
    - BBB: ~$5/1000
    - Trustpilot: ~$3/1000
"""

import argparse
import json
import os
import sys
import time
from typing import Optional

# Outscraper SDK
try:
    from outscraper import ApiClient
except ImportError:
    print(json.dumps({"error": "outscraper package not installed. Run: pip install outscraper"}))
    sys.exit(1)


def get_client() -> ApiClient:
    """Initialize Outscraper client with API key from environment."""
    api_key = os.environ.get('OUTSCRAPER_API_KEY')
    if not api_key:
        raise ValueError("OUTSCRAPER_API_KEY environment variable not set")
    return ApiClient(api_key=api_key)


def scrape_google_reviews(business_name: str, location: str, max_reviews: int = 20) -> dict:
    """
    Fetch Google Maps reviews via Outscraper.

    Args:
        business_name: Company name
        location: City, State
        max_reviews: Maximum reviews to fetch

    Returns:
        dict with rating, total_reviews, reviews list
    """
    client = get_client()
    query = f"{business_name}, {location}"

    try:
        # Use google_maps_reviews method
        results = client.google_maps_reviews(
            query,
            reviews_limit=max_reviews,
            language='en',
            sort='newest'
        )

        if not results or not results[0]:
            return {
                "source": "google",
                "query": query,
                "rating": None,
                "total_reviews": 0,
                "reviews": [],
                "error": "No results found"
            }

        place = results[0]
        reviews = []

        for r in place.get('reviews_data', []):
            reviews.append({
                "author": r.get('author_title', 'Anonymous'),
                "rating": r.get('review_rating'),
                "date": r.get('review_datetime_utc'),
                "text": r.get('review_text', ''),
                "response": r.get('owner_answer')
            })

        return {
            "source": "google",
            "query": query,
            "name": place.get('name'),
            "address": place.get('full_address'),
            "rating": place.get('rating'),
            "total_reviews": place.get('reviews', 0),
            "reviews": reviews,
            "place_id": place.get('place_id'),
            "website": place.get('site')
        }

    except Exception as e:
        return {
            "source": "google",
            "query": query,
            "error": str(e),
            "rating": None,
            "total_reviews": 0,
            "reviews": []
        }


def scrape_yelp_reviews(business_name: str, location: str, max_reviews: int = 20) -> dict:
    """
    Fetch Yelp reviews via Outscraper.

    Note: Requires business Yelp URL or will search by name.
    """
    client = get_client()
    query = f"{business_name} {location}"

    try:
        # Search Yelp
        results = client.yelp_reviews(
            query,
            limit=max_reviews
        )

        if not results or not results[0]:
            return {
                "source": "yelp",
                "query": query,
                "rating": None,
                "total_reviews": 0,
                "reviews": [],
                "error": "No results found"
            }

        biz = results[0]
        reviews = []

        for r in biz.get('reviews', []):
            reviews.append({
                "author": r.get('user_name', 'Anonymous'),
                "rating": r.get('rating'),
                "date": r.get('date'),
                "text": r.get('comment', '')
            })

        return {
            "source": "yelp",
            "query": query,
            "name": biz.get('name'),
            "rating": biz.get('rating'),
            "total_reviews": biz.get('review_count', 0),
            "reviews": reviews,
            "url": biz.get('url')
        }

    except Exception as e:
        return {
            "source": "yelp",
            "query": query,
            "error": str(e),
            "rating": None,
            "total_reviews": 0,
            "reviews": []
        }


def scrape_bbb_data(business_name: str, location: str) -> dict:
    """
    Fetch BBB profile data via Outscraper.

    Returns rating, accreditation status, complaints, etc.
    """
    client = get_client()
    query = f"{business_name} {location}"

    try:
        results = client.bbb(query, limit=1)

        if not results or not results[0]:
            return {
                "source": "bbb",
                "query": query,
                "rating": None,
                "accredited": False,
                "error": "No BBB profile found"
            }

        biz = results[0]

        return {
            "source": "bbb",
            "query": query,
            "name": biz.get('name'),
            "rating": biz.get('rating'),
            "accredited": biz.get('is_accredited', False),
            "years_in_business": biz.get('years_in_business'),
            "complaints_count": biz.get('complaints_count', 0),
            "reviews_count": biz.get('reviews_count', 0),
            "url": biz.get('url')
        }

    except Exception as e:
        return {
            "source": "bbb",
            "query": query,
            "error": str(e),
            "rating": None,
            "accredited": False
        }


def scrape_trustpilot_reviews(domain: str, max_reviews: int = 20) -> dict:
    """
    Fetch Trustpilot reviews via Outscraper.

    Args:
        domain: Business domain (e.g., "example.com")
        max_reviews: Maximum reviews to fetch
    """
    client = get_client()
    query = f"trustpilot.com/review/{domain}"

    try:
        results = client.trustpilot_reviews(
            query,
            limit=max_reviews
        )

        if not results or not results[0]:
            return {
                "source": "trustpilot",
                "query": domain,
                "rating": None,
                "total_reviews": 0,
                "reviews": [],
                "error": "No Trustpilot profile found"
            }

        biz = results[0]
        reviews = []

        for r in biz.get('reviews', []):
            reviews.append({
                "author": r.get('author', 'Anonymous'),
                "rating": r.get('rating'),
                "date": r.get('date'),
                "text": r.get('text', ''),
                "title": r.get('title')
            })

        return {
            "source": "trustpilot",
            "query": domain,
            "name": biz.get('name'),
            "rating": biz.get('rating'),
            "total_reviews": biz.get('reviews_count', 0),
            "reviews": reviews,
            "trust_score": biz.get('trust_score')
        }

    except Exception as e:
        return {
            "source": "trustpilot",
            "query": domain,
            "error": str(e),
            "rating": None,
            "total_reviews": 0,
            "reviews": []
        }


def main():
    parser = argparse.ArgumentParser(description='Outscraper Reviews Scraper')
    parser.add_argument('business_name', help='Business name to search')
    parser.add_argument('location', nargs='?', default='Fort Worth, TX', help='City, State')
    parser.add_argument('--source', '-s', choices=['google', 'yelp', 'bbb', 'trustpilot', 'all'],
                        default='google', help='Review source to scrape')
    parser.add_argument('--max-reviews', '-m', type=int, default=100, help='Max reviews to fetch')
    parser.add_argument('--domain', '-d', help='Domain for Trustpilot (overrides business_name)')
    parser.add_argument('--json', action='store_true', help='Output as JSON')

    args = parser.parse_args()

    try:
        if args.source == 'google':
            result = scrape_google_reviews(args.business_name, args.location, args.max_reviews)
        elif args.source == 'yelp':
            result = scrape_yelp_reviews(args.business_name, args.location, args.max_reviews)
        elif args.source == 'bbb':
            result = scrape_bbb_data(args.business_name, args.location)
        elif args.source == 'trustpilot':
            domain = args.domain or args.business_name.lower().replace(' ', '') + '.com'
            result = scrape_trustpilot_reviews(domain, args.max_reviews)
        elif args.source == 'all':
            # Scrape all sources
            result = {
                "google": scrape_google_reviews(args.business_name, args.location, args.max_reviews),
                "yelp": scrape_yelp_reviews(args.business_name, args.location, args.max_reviews),
                "bbb": scrape_bbb_data(args.business_name, args.location),
            }
            # Only add trustpilot if domain provided
            if args.domain:
                result["trustpilot"] = scrape_trustpilot_reviews(args.domain, args.max_reviews)

        if args.json:
            print(json.dumps(result, indent=2, default=str))
        else:
            print(f"Source: {args.source}")
            print(f"Rating: {result.get('rating')}")
            print(f"Total Reviews: {result.get('total_reviews', 0)}")
            if result.get('reviews'):
                print(f"Fetched: {len(result['reviews'])} reviews")

    except ValueError as e:
        error = {"error": str(e)}
        if args.json:
            print(json.dumps(error))
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        error = {"error": f"Unexpected error: {str(e)}"}
        if args.json:
            print(json.dumps(error))
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
