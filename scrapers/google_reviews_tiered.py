#!/usr/bin/env python3
"""
Tiered Google Reviews Scraper

Strategy:
1. Call Serper first (8 reviews, cheap)
2. Quick fraud check on those 8 reviews
3. If suspicious or high-volume contractor, escalate to SerpApi for full reviews

Usage:
  python3 scrapers/google_reviews_tiered.py "Business Name" "City, State" [max_reviews]
"""

import json
import os
import sys
import re
from typing import Optional
import requests


def quick_fraud_check(reviews: list) -> dict:
    """
    Quick heuristic check for fraud signals in reviews.
    Returns escalation recommendation.
    """
    if not reviews:
        return {
            "escalate": True,
            "reason": "NO_REVIEWS",
            "confidence": "HIGH"
        }

    signals = []

    # Check 1: All 5-star reviews (suspicious if all 8 are perfect)
    ratings = [r.get("rating", 0) for r in reviews]
    if all(r == 5 for r in ratings) and len(ratings) >= 5:
        signals.append("ALL_PERFECT_SCORES")

    # Check 2: Very short reviews (generic/fake)
    short_reviews = sum(1 for r in reviews if len(r.get("text", "")) < 50)
    if short_reviews >= len(reviews) * 0.5:
        signals.append("MANY_SHORT_REVIEWS")

    # Check 3: Similar text patterns (copy-paste reviews)
    texts = [r.get("text", "").lower() for r in reviews]
    generic_phrases = ["great service", "highly recommend", "best company", "amazing work", "would recommend"]
    generic_count = sum(1 for t in texts if any(p in t for p in generic_phrases))
    if generic_count >= len(reviews) * 0.7:
        signals.append("GENERIC_LANGUAGE")

    # Check 4: Extreme negativity in any review
    negative_phrases = ["scam", "fraud", "ripped off", "never showed", "took my money", "lawsuit", "bbb complaint"]
    for t in texts:
        if any(p in t for p in negative_phrases):
            signals.append("NEGATIVE_SIGNAL_FOUND")
            break

    # Check 5: Very low rating mixed with high (manipulation sign)
    if ratings:
        has_low = any(r <= 2 for r in ratings)
        has_high = any(r >= 4 for r in ratings)
        if has_low and has_high:
            signals.append("POLARIZED_RATINGS")

    # Decision logic
    if "NEGATIVE_SIGNAL_FOUND" in signals:
        return {
            "escalate": True,
            "reason": "NEGATIVE_SIGNAL_FOUND",
            "signals": signals,
            "confidence": "HIGH"
        }

    if "NO_REVIEWS" in signals:
        return {
            "escalate": False,  # No point escalating if no reviews exist
            "reason": "NO_REVIEWS",
            "signals": signals,
            "confidence": "HIGH"
        }

    if len(signals) >= 2:
        return {
            "escalate": True,
            "reason": "MULTIPLE_SUSPICIOUS_SIGNALS",
            "signals": signals,
            "confidence": "MEDIUM"
        }

    # Clean - no need to escalate
    return {
        "escalate": False,
        "reason": "CLEAN",
        "signals": signals,
        "confidence": "HIGH"
    }


def scrape_serper(business_name: str, location: str, max_reviews: int = 20) -> dict:
    """Call Serper API (fast, cheap, 8 reviews max)"""
    api_key = os.environ.get("SERPER_API_KEY")
    if not api_key:
        return {"found": False, "error": "SERPER_API_KEY not set", "reviews": []}

    headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}

    # Step 1: Get place CID
    try:
        places_resp = requests.post(
            "https://google.serper.dev/places",
            headers=headers,
            json={"q": f"{business_name} {location}"},
            timeout=30
        )
        places_data = places_resp.json()
    except Exception as e:
        return {"found": False, "error": f"Serper places error: {e}", "reviews": []}

    places = places_data.get("places", [])
    if not places:
        return {"found": False, "error": "No places found", "reviews": []}

    place = places[0]
    cid = place.get("cid")

    result = {
        "found": True,
        "name": place.get("title"),
        "rating": place.get("rating"),
        "review_count": place.get("ratingCount"),
        "address": place.get("address"),
        "cid": cid,
        "source": "serper",
        "reviews": []
    }

    if not cid:
        return result

    # Step 2: Get reviews
    try:
        reviews_resp = requests.post(
            "https://google.serper.dev/reviews",
            headers=headers,
            json={"cid": cid, "num": min(max_reviews, 100)},
            timeout=30
        )
        reviews_data = reviews_resp.json()
    except Exception as e:
        result["error"] = f"Serper reviews error: {e}"
        return result

    raw_reviews = reviews_data.get("reviews", [])
    result["reviews"] = [
        {
            "text": r.get("snippet", ""),
            "rating": r.get("rating"),
            "author": r.get("user", {}).get("name", "Unknown"),
            "date": r.get("date", "")
        }
        for r in raw_reviews[:max_reviews]
    ]

    return result


def scrape_serpapi(business_name: str, location: str, max_reviews: int = 100) -> dict:
    """Call SerpApi (thorough, paginated, gets all reviews)"""
    api_key = os.environ.get("SERPAPI_API_KEY")
    if not api_key:
        return {"found": False, "error": "SERPAPI_API_KEY not set", "reviews": []}

    # Step 1: Find place
    try:
        resp = requests.get(
            "https://serpapi.com/search.json",
            params={
                "engine": "google_maps",
                "q": f"{business_name} {location}",
                "api_key": api_key,
                "type": "search"
            },
            timeout=30
        )
        data = resp.json()
    except Exception as e:
        return {"found": False, "error": f"SerpApi search error: {e}", "reviews": []}

    # SerpApi returns place_results for single match, local_results for multiple
    place = data.get("place_results", {})
    if isinstance(place, list):
        place = place[0] if place else {}

    # Fallback to local_results if no place_results
    if not place:
        local_results = data.get("local_results", [])
        if local_results:
            place = local_results[0]

    if not place:
        return {"found": False, "error": "No place found", "reviews": []}

    data_id = place.get("data_id")
    result = {
        "found": True,
        "name": place.get("title"),
        "rating": place.get("rating"),
        "review_count": place.get("reviews"),
        "address": place.get("address"),
        "data_id": data_id,
        "source": "serpapi",
        "reviews": []
    }

    if not data_id:
        return result

    # Step 2: Paginate through reviews
    all_reviews = []
    next_token = None
    max_pages = (max_reviews // 10) + 1

    for page in range(max_pages):
        try:
            params = {
                "engine": "google_maps_reviews",
                "data_id": data_id,
                "api_key": api_key,
                "hl": "en"
            }
            if next_token:
                params["next_page_token"] = next_token

            resp = requests.get("https://serpapi.com/search.json", params=params, timeout=30)
            reviews_data = resp.json()
        except Exception as e:
            result["error"] = f"SerpApi reviews error on page {page}: {e}"
            break

        reviews = reviews_data.get("reviews", [])
        if not reviews:
            break

        all_reviews.extend([
            {
                "text": r.get("snippet", ""),
                "rating": r.get("rating"),
                "author": r.get("user", {}).get("name", "Unknown"),
                "date": r.get("date", "")
            }
            for r in reviews
        ])

        if len(all_reviews) >= max_reviews:
            break

        pagination = reviews_data.get("serpapi_pagination", {})
        next_token = pagination.get("next_page_token")
        if not next_token:
            break

    result["reviews"] = all_reviews[:max_reviews]
    result["pages_fetched"] = page + 1

    return result


def scrape_tiered(
    business_name: str,
    location: str = "Fort Worth, TX",
    max_reviews: int = 100,
    force_full: bool = False
) -> dict:
    """
    Tiered scraping strategy:
    1. Serper first (8 reviews)
    2. Quick fraud check
    3. Escalate to SerpApi if suspicious or high-volume
    """
    print(f"[Tiered] Starting for: {business_name} in {location}", file=sys.stderr)

    # Step 1: Serper (fast/cheap)
    print("[Tiered] Step 1: Serper quick check...", file=sys.stderr)
    serper_result = scrape_serper(business_name, location)

    if not serper_result.get("found"):
        print(f"[Tiered] Serper failed: {serper_result.get('error')}", file=sys.stderr)
        # Try SerpApi directly as fallback
        print("[Tiered] Falling back to SerpApi...", file=sys.stderr)
        return scrape_serpapi(business_name, location, max_reviews)

    serper_reviews = serper_result.get("reviews", [])
    total_available = serper_result.get("review_count", 0) or 0

    print(f"[Tiered] Serper found: {len(serper_reviews)} reviews ({total_available} total available)", file=sys.stderr)

    # Step 2: Quick fraud check
    fraud_check = quick_fraud_check(serper_reviews)
    serper_result["fraud_check"] = fraud_check

    print(f"[Tiered] Fraud check: {fraud_check['reason']} (escalate={fraud_check['escalate']})", file=sys.stderr)

    # Step 3: Decide on escalation
    should_escalate = (
        force_full or
        fraud_check["escalate"] or
        total_available > 50  # High-volume contractor - get more data
    )

    if not should_escalate:
        print("[Tiered] No escalation needed - returning Serper results", file=sys.stderr)
        serper_result["escalated"] = False
        return serper_result

    # Step 4: Escalate to SerpApi
    escalation_reason = fraud_check["reason"] if fraud_check["escalate"] else f"HIGH_VOLUME ({total_available} reviews)"
    print(f"[Tiered] Escalating to SerpApi: {escalation_reason}", file=sys.stderr)

    serpapi_result = scrape_serpapi(business_name, location, max_reviews)

    if serpapi_result.get("found") and serpapi_result.get("reviews"):
        serpapi_result["escalated"] = True
        serpapi_result["escalation_reason"] = escalation_reason
        serpapi_result["serper_fraud_check"] = fraud_check
        print(f"[Tiered] SerpApi returned {len(serpapi_result['reviews'])} reviews", file=sys.stderr)
        return serpapi_result

    # SerpApi failed - return Serper results
    print("[Tiered] SerpApi failed, using Serper results", file=sys.stderr)
    serper_result["escalated"] = False
    serper_result["serpapi_error"] = serpapi_result.get("error")
    return serper_result


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 google_reviews_tiered.py 'Business Name' ['City, State'] [max_reviews]")
        sys.exit(1)

    business_name = sys.argv[1]
    location = sys.argv[2] if len(sys.argv) > 2 else "Fort Worth, TX"
    max_reviews = int(sys.argv[3]) if len(sys.argv) > 3 else 100

    result = scrape_tiered(business_name, location, max_reviews)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
