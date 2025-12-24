#!/usr/bin/env python3
"""
Google Reviews Scraper using Serper API

Uses Serper's /places and /reviews endpoints to get Google review data
without hitting Google's "limited view" restrictions.

Usage:
  python3 scrapers/google_reviews_serper.py "Business Name" "City, State" [max_reviews]
"""

import json
import os
import sys
from typing import Optional
import requests


def scrape_google_reviews(
    business_name: str,
    location: str = "Fort Worth, TX",
    max_reviews: int = 20,
    api_key: Optional[str] = None
) -> dict:
    """
    Get Google reviews using Serper API.

    Two-step process:
    1. /places - Get business CID and basic info
    2. /reviews - Get full review text using CID

    Args:
        business_name: Name of the business
        location: City, State
        max_reviews: Maximum reviews to return
        api_key: Serper API key (or uses SERPER_API_KEY env var)

    Returns:
        dict with found, rating, review_count, reviews[], source
    """
    api_key = api_key or os.environ.get("SERPER_API_KEY")
    if not api_key:
        return {
            "found": False,
            "error": "SERPER_API_KEY not set",
            "reviews": [],
            "source": "serper_google"
        }

    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json"
    }

    print(f"[Serper] Searching for: {business_name} in {location}", file=sys.stderr)

    # Step 1: Get business CID from /places
    try:
        places_response = requests.post(
            "https://google.serper.dev/places",
            headers=headers,
            json={"q": f"{business_name} {location}"},
            timeout=30
        )
        places_data = places_response.json()
    except Exception as e:
        return {
            "found": False,
            "error": f"Places API error: {e}",
            "reviews": [],
            "source": "serper_google"
        }

    places = places_data.get("places", [])
    if not places:
        return {
            "found": False,
            "error": "No places found",
            "reviews": [],
            "source": "serper_google"
        }

    # Find best match (first result usually)
    place = places[0]
    cid = place.get("cid")

    if not cid:
        return {
            "found": True,
            "name": place.get("title"),
            "rating": place.get("rating"),
            "review_count": place.get("ratingCount"),
            "reviews": [],
            "source": "serper_google",
            "error": "No CID for reviews lookup"
        }

    print(f"[Serper] Found: {place.get('title')} (CID: {cid})", file=sys.stderr)
    print(f"[Serper] Rating: {place.get('rating')} ({place.get('ratingCount')} reviews)", file=sys.stderr)

    # Step 2: Get reviews from /reviews endpoint
    try:
        reviews_response = requests.post(
            "https://google.serper.dev/reviews",
            headers=headers,
            json={"cid": cid, "num": min(max_reviews, 100)},
            timeout=30
        )
        reviews_data = reviews_response.json()
    except Exception as e:
        return {
            "found": True,
            "name": place.get("title"),
            "rating": place.get("rating"),
            "review_count": place.get("ratingCount"),
            "reviews": [],
            "source": "serper_google",
            "error": f"Reviews API error: {e}"
        }

    raw_reviews = reviews_data.get("reviews", [])

    # Format reviews to match our standard structure
    reviews = []
    for r in raw_reviews[:max_reviews]:
        review = {
            "text": r.get("snippet", ""),
            "rating": r.get("rating"),
            "author": r.get("user", {}).get("name", "Unknown"),
            "date": r.get("date", ""),
            "likes": r.get("likes"),
            "id": r.get("id")
        }
        reviews.append(review)

    print(f"[Serper] Extracted {len(reviews)} reviews", file=sys.stderr)

    return {
        "found": True,
        "name": place.get("title"),
        "rating": place.get("rating"),
        "review_count": place.get("ratingCount"),
        "address": place.get("address"),
        "phone": place.get("phoneNumber"),
        "website": place.get("website"),
        "category": place.get("category"),
        "cid": cid,
        "reviews": reviews,
        "source": "serper_google",
        "error": None
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 google_reviews_serper.py 'Business Name' ['City, State'] [max_reviews]")
        sys.exit(1)

    business_name = sys.argv[1]
    location = sys.argv[2] if len(sys.argv) > 2 else "Fort Worth, TX"
    max_reviews = int(sys.argv[3]) if len(sys.argv) > 3 else 20

    result = scrape_google_reviews(business_name, location, max_reviews)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
