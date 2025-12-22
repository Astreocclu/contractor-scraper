#!/usr/bin/env python3.11
"""
Google Maps Review Scraper using browser-use + DeepSeek
Uses DOM extraction mode (no vision required)

Usage:
  python3.11 scrapers/google_maps_browseruse.py "Business Name" "City, State" [max_reviews]
"""

import asyncio
import json
import os
import re
import sys
from typing import Optional

# browser-use imports (has built-in DeepSeek support)
from browser_use import Agent
from browser_use.llm.deepseek.chat import ChatDeepSeek


async def scrape_reviews(
    business_name: str,
    location: str = "Fort Worth, TX",
    max_reviews: int = 20
) -> dict:
    """
    Use browser-use + DeepSeek to navigate Google Maps and extract reviews.

    Args:
        business_name: Name of the business to search
        location: City, State to search in
        max_reviews: Maximum number of reviews to extract

    Returns:
        dict with found, reviews, review_count, rating, error
    """

    # Configure DeepSeek as the LLM
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        return {
            "found": False,
            "error": "DEEPSEEK_API_KEY not set",
            "reviews": [],
            "source": "browser_use"
        }

    llm = ChatDeepSeek(
        model="deepseek-chat",
        api_key=api_key,
        temperature=0,  # Deterministic
    )

    # Task instructions for the agent
    task = f"""
Go to Google Maps and find reviews for "{business_name}" in "{location}".

Steps:
1. Navigate to https://www.google.com/maps
2. Search for "{business_name} {location}"
3. Click on the business result that matches (look for the correct name)
4. Find and click the "Reviews" tab or button (it shows the star count)
5. Scroll down in the reviews section to load more reviews
6. Extract up to {max_reviews} reviews

For each review, extract:
- The full review text
- Star rating (1-5)
- Reviewer name
- Date (like "2 months ago")

Also extract:
- Overall business rating (like 4.5)
- Total review count

Return results as JSON with this exact format:
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
        print(f"[browser-use] Starting agent for: {business_name}", file=sys.stderr)

        agent = Agent(
            task=task,
            llm=llm,
            use_vision=False,  # DOM-only mode, no screenshots
        )

        result = await agent.run()

        # Parse the result
        parsed = parse_agent_result(result)

        if parsed and parsed.get("reviews"):
            print(f"[browser-use] Extracted {len(parsed['reviews'])} reviews", file=sys.stderr)
            return {
                "found": True,
                "name": parsed.get("business_name", business_name),
                "rating": parsed.get("rating"),
                "review_count": parsed.get("review_count") or len(parsed["reviews"]),
                "reviews": parsed["reviews"][:max_reviews],
                "source": "browser_use",
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
                "source": "browser_use"
            }

    except Exception as e:
        print(f"[browser-use] Error: {e}", file=sys.stderr)
        return {
            "found": False,
            "error": str(e),
            "reviews": [],
            "source": "browser_use"
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
