#!/usr/bin/env python3.11
"""
Google Maps Review Scraper using browser-use + Gemini 3 Pro
Uses vision mode for better accuracy

Usage:
  python3.11 scrapers/google_maps_browseruse.py "Business Name" "City, State" [max_reviews]
"""

import asyncio
import json
import os
import re
import sys
from typing import Optional

# browser-use imports
from browser_use import Agent

# Local Gemini wrapper with rate limiting
from llm_gemini import ChatGemini


async def scrape_reviews(
    business_name: str,
    location: str = "Fort Worth, TX",
    max_reviews: int = 20
) -> dict:
    """
    Use browser-use + Gemini 3 Pro to navigate Google Maps and extract reviews.
    Vision mode enabled for better element detection.
    """

    # Check for API key
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return {
            "found": False,
            "error": "GOOGLE_API_KEY not set",
            "reviews": [],
            "source": "browser_use_gemini"
        }

    # Configure Gemini 3 Pro with vision support
    llm = ChatGemini(
        model="gemini-3-pro-preview",
        api_key=api_key,
        temperature=0.1,
        min_interval=10.0,     # 10s between requests
        max_per_minute=10,     # Max 10 RPM
        backoff_seconds=60.0,  # 60s backoff on 429
    )

    # Task with vision-aware instructions
    task = f"""
TASK: Find and extract Google Maps reviews for "{business_name}" in "{location}".

VISUAL NAVIGATION:
1. Go to https://www.google.com/maps
2. Search for "{business_name} {location}"
3. LOOK at the search results - click the one matching the business name
4. Find the Reviews section (look for star icons and review count)
5. Scroll to load reviews

EXTRACTION (up to {max_reviews} reviews):
For each review, extract:
- Full review text (click "More" if truncated)
- Star rating (count filled stars, 1-5)
- Reviewer name
- Date (e.g., "2 months ago")

Also extract:
- Overall rating (e.g., 4.5)
- Total review count

OUTPUT FORMAT (JSON only):
{{
  "business_name": "...",
  "rating": 4.5,
  "review_count": 123,
  "reviews": [
    {{"text": "...", "rating": 5, "author": "...", "date": "..."}}
  ]
}}
"""

    try:
        print(f"[browser-use+Gemini] Starting for: {business_name}", file=sys.stderr)

        agent = Agent(
            task=task,
            llm=llm,
            use_vision=True,   # ENABLED - Gemini has native vision
            headless=True,
            max_steps=15,
        )

        result = await agent.run()
        parsed = parse_agent_result(result)

        if parsed and parsed.get("reviews"):
            print(f"[browser-use+Gemini] Extracted {len(parsed['reviews'])} reviews", file=sys.stderr)
            return {
                "found": True,
                "name": parsed.get("business_name", business_name),
                "rating": parsed.get("rating"),
                "review_count": parsed.get("review_count") or len(parsed["reviews"]),
                "reviews": parsed["reviews"][:max_reviews],
                "source": "browser_use_gemini",
                "error": None
            }
        else:
            return {
                "found": True if parsed else False,
                "name": parsed.get("business_name") if parsed else None,
                "rating": parsed.get("rating") if parsed else None,
                "review_count": parsed.get("review_count") if parsed else None,
                "error": "No reviews extracted" if not parsed else None,
                "reviews": [],
                "source": "browser_use_gemini"
            }

    except Exception as e:
        print(f"[browser-use+Gemini] Error: {e}", file=sys.stderr)
        return {
            "found": False,
            "error": str(e),
            "reviews": [],
            "source": "browser_use_gemini"
        }


def parse_agent_result(result) -> Optional[dict]:
    """
    Parse the agent's output to extract structured review data.
    The agent returns its final answer which should contain JSON.
    """
    if not result:
        return None

    # browser-use returns AgentHistoryList, get the final output
    result_text = str(result)

    # Try to find JSON in the response
    try:
        # Look for JSON block with reviews
        json_match = re.search(r'\{[^{}]*"reviews"\s*:\s*\[[^\]]*\][^{}]*\}', result_text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
    except json.JSONDecodeError:
        pass

    # Try finding any JSON object
    try:
        json_match = re.search(r'\{[\s\S]*?\}(?=\s*$|\s*\n)', result_text)
        if json_match:
            return json.loads(json_match.group())
    except json.JSONDecodeError:
        pass

    # Try parsing the whole thing as JSON
    try:
        return json.loads(result_text)
    except json.JSONDecodeError:
        pass

    return None


async def main():
    if len(sys.argv) < 2:
        print("Usage: python3.11 google_maps_browseruse.py 'Business Name' ['City, State'] [max_reviews]")
        sys.exit(1)

    business_name = sys.argv[1]
    location = sys.argv[2] if len(sys.argv) > 2 else "Fort Worth, TX"
    max_reviews = int(sys.argv[3]) if len(sys.argv) > 3 else 20

    result = await scrape_reviews(business_name, location, max_reviews)

    # Output as JSON
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
