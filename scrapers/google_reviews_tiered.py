#!/usr/bin/env python3
"""
Tiered Google Reviews Scraper

Strategies:
  current:  Serper(8) + SerpAPI(100) if >50 reviews or fraud signals
  proposed: Serper(10) + SerpAPI(10% or 10 min) - cost-optimized

Usage:
  python3 scrapers/google_reviews_tiered.py "Business Name" "City, State" --strategy current
  python3 scrapers/google_reviews_tiered.py "Business Name" "City, State" --strategy proposed
"""

import argparse
import json
import os
import sys
import re
from typing import Optional
import requests


# Cost constants
SERPER_COST_PER_CALL = 0.001
SERPAPI_COST_PER_CALL = 0.015


def estimate_serpapi_calls(reviews_needed: int) -> int:
    """Estimate SerpAPI calls: 1 search + ceil((reviews-8)/10) pages"""
    if reviews_needed <= 0:
        return 1  # Just search
    if reviews_needed <= 8:
        return 2  # Search + 1 review page
    return 2 + ((reviews_needed - 8) + 9) // 10


def calculate_cost(serper_calls: int, serpapi_calls: int) -> float:
    """Calculate total API cost"""
    return round(serper_calls * SERPER_COST_PER_CALL + serpapi_calls * SERPAPI_COST_PER_CALL, 4)


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
    force_full: bool = False,
    strategy: str = "current"
) -> dict:
    """
    Tiered scraping strategy:

    current:  Serper(8) + SerpAPI(100) if >50 reviews or fraud signals
    proposed: Serper(10) + SerpAPI(max(10, 10%) - serper_count) if target > serper_count
    """
    print(f"[Tiered] Starting for: {business_name} in {location} (strategy={strategy})", file=sys.stderr)

    # Track metrics
    metrics = {
        "strategy": strategy,
        "serper_calls": 0,
        "serpapi_calls": 0,
        "target_reviews": 0,
        "actual_reviews": 0
    }

    # Step 1: Serper (fast/cheap)
    print("[Tiered] Step 1: Serper quick check...", file=sys.stderr)
    serper_result = scrape_serper(business_name, location)
    metrics["serper_calls"] = 2  # places + reviews

    if not serper_result.get("found"):
        print(f"[Tiered] Serper failed: {serper_result.get('error')}", file=sys.stderr)
        # Try SerpApi directly as fallback
        print("[Tiered] Falling back to SerpApi...", file=sys.stderr)
        fallback_result = scrape_serpapi(business_name, location, max_reviews)
        metrics["serpapi_calls"] = estimate_serpapi_calls(max_reviews)
        metrics["target_reviews"] = max_reviews
        metrics["actual_reviews"] = len(fallback_result.get("reviews", []))
        fallback_result["metrics"] = metrics
        fallback_result["collection_cost"] = calculate_cost(metrics["serper_calls"], metrics["serpapi_calls"])
        return fallback_result

    serper_reviews = serper_result.get("reviews", [])
    total_available = serper_result.get("review_count", 0) or 0

    print(f"[Tiered] Serper found: {len(serper_reviews)} reviews ({total_available} total available)", file=sys.stderr)

    # Step 2: Quick fraud check (used by current strategy)
    fraud_check = quick_fraud_check(serper_reviews)
    serper_result["fraud_check"] = fraud_check

    print(f"[Tiered] Fraud check: {fraud_check['reason']} (escalate={fraud_check['escalate']})", file=sys.stderr)

    # Step 3: Strategy-specific escalation logic
    if strategy == "proposed":
        # PROPOSED: 10% or 10 minimum
        target_reviews = max(10, int(total_available * 0.10))
        serper_count = len(serper_reviews)
        should_escalate = target_reviews > serper_count
        escalation_reason = f"PROPOSED_STRATEGY (target={target_reviews}, have={serper_count})"
        reviews_to_fetch = target_reviews  # SerpAPI will fetch this many total
    else:
        # CURRENT: Escalate if >50 reviews or fraud signals
        should_escalate = (
            force_full or
            fraud_check["escalate"] or
            total_available > 50
        )
        target_reviews = 100 if should_escalate else len(serper_reviews)
        escalation_reason = fraud_check["reason"] if fraud_check["escalate"] else f"HIGH_VOLUME ({total_available} reviews)"
        reviews_to_fetch = max_reviews

    metrics["target_reviews"] = target_reviews

    if not should_escalate:
        print(f"[Tiered] No escalation needed - returning Serper results (target={target_reviews})", file=sys.stderr)
        serper_result["escalated"] = False
        metrics["actual_reviews"] = len(serper_reviews)
        serper_result["metrics"] = metrics
        serper_result["collection_cost"] = calculate_cost(metrics["serper_calls"], metrics["serpapi_calls"])
        return serper_result

    # Step 4: Escalate to SerpApi
    print(f"[Tiered] Escalating to SerpApi: {escalation_reason}", file=sys.stderr)

    serpapi_result = scrape_serpapi(business_name, location, reviews_to_fetch)
    metrics["serpapi_calls"] = estimate_serpapi_calls(reviews_to_fetch)

    if serpapi_result.get("found") and serpapi_result.get("reviews"):
        serpapi_result["escalated"] = True
        serpapi_result["escalation_reason"] = escalation_reason
        serpapi_result["serper_fraud_check"] = fraud_check
        metrics["actual_reviews"] = len(serpapi_result.get("reviews", []))
        serpapi_result["metrics"] = metrics
        serpapi_result["collection_cost"] = calculate_cost(metrics["serper_calls"], metrics["serpapi_calls"])
        print(f"[Tiered] SerpApi returned {len(serpapi_result['reviews'])} reviews (cost=${serpapi_result['collection_cost']})", file=sys.stderr)
        return serpapi_result

    # SerpApi failed - return Serper results
    print("[Tiered] SerpApi failed, using Serper results", file=sys.stderr)
    serper_result["escalated"] = False
    serper_result["serpapi_error"] = serpapi_result.get("error")
    metrics["actual_reviews"] = len(serper_reviews)
    serper_result["metrics"] = metrics
    serper_result["collection_cost"] = calculate_cost(metrics["serper_calls"], metrics["serpapi_calls"])
    return serper_result


def main():
    parser = argparse.ArgumentParser(
        description='Tiered Google Reviews Scraper with A/B test support',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Strategies:
  current   Serper(8) + SerpAPI(100) if >50 reviews or fraud signals
  proposed  Serper(10) + SerpAPI(10%% or 10 min) - cost-optimized

Examples:
  python3 scrapers/google_reviews_tiered.py "Texas Outdoor Oasis" "Dallas, TX" --strategy current
  python3 scrapers/google_reviews_tiered.py "Small Contractor" "Fort Worth, TX" --strategy proposed
  # Legacy (backward compatible):
  python3 scrapers/google_reviews_tiered.py "Business" "City, TX" 100 --json
        """
    )
    parser.add_argument('business_name', help='Business name to search')
    parser.add_argument('location', nargs='?', default='Fort Worth, TX', help='City, State (default: Fort Worth, TX)')
    # Backward compatibility: accept optional 3rd positional arg for max_reviews
    parser.add_argument('max_reviews_pos', nargs='?', type=int, default=None,
                        help=argparse.SUPPRESS)  # Hidden: legacy positional max_reviews
    parser.add_argument('--max-reviews', type=int, default=100, help='Max reviews for current strategy (default: 100)')
    parser.add_argument('--strategy', choices=['current', 'proposed'], default='current',
                        help='Collection strategy (default: current)')
    parser.add_argument('--force-full', action='store_true', help='Force full SerpAPI collection')
    parser.add_argument('--json', action='store_true', help='Output JSON (default, kept for compatibility)')

    args = parser.parse_args()

    # Legacy positional arg takes precedence if provided
    max_reviews = args.max_reviews_pos if args.max_reviews_pos is not None else args.max_reviews

    result = scrape_tiered(
        args.business_name,
        args.location,
        max_reviews,
        args.force_full,
        args.strategy
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
