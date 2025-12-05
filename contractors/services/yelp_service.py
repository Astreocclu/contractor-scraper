"""
Yelp Fusion API service for contractor enrichment.
"""

import os
import time
import logging
import requests
from difflib import SequenceMatcher
from typing import Optional, List

logger = logging.getLogger(__name__)


class YelpService:
    """Service for fetching contractor data from Yelp Fusion API."""

    BASE_URL = "https://api.yelp.com/v3"

    def __init__(self):
        self.api_key = os.environ.get("YELP_API_KEY")
        if not self.api_key:
            raise ValueError("YELP_API_KEY not set in environment")
        self.headers = {"Authorization": f"Bearer {self.api_key}"}

    def search_business(self, business_name: str, city: str, state: str = "TX") -> Optional[dict]:
        """
        Search for a business on Yelp and return best match.

        Args:
            business_name: Name of the business to search for
            city: City name
            state: State abbreviation (default: TX)

        Returns:
            {
                "yelp_id": str,
                "yelp_url": str,
                "yelp_rating": float,
                "yelp_review_count": int,
                "yelp_price": str or None,
                "match_confidence": float
            }
            or None if no good match found
        """
        url = f"{self.BASE_URL}/businesses/search"
        params = {
            "term": business_name,
            "location": f"{city}, {state}",
            "categories": "contractors,homeservices,poolservice",
            "limit": 10
        }

        try:
            response = requests.get(url, headers=self.headers, params=params, timeout=15)
            response.raise_for_status()

            businesses = response.json().get("businesses", [])

            # Find best match by name similarity
            best_match = None
            best_score = 0

            for biz in businesses:
                score = self._name_similarity(business_name, biz["name"])
                if score > best_score and score > 0.6:  # Minimum 60% match
                    best_score = score
                    best_match = biz

            if best_match:
                return {
                    "yelp_id": best_match["id"],
                    "yelp_url": best_match["url"],
                    "yelp_rating": best_match.get("rating"),
                    "yelp_review_count": best_match.get("review_count", 0),
                    "yelp_price": best_match.get("price"),
                    "match_confidence": best_score
                }

            return None

        except requests.RequestException as e:
            logger.warning(f"Yelp API error for {business_name}: {e}")
            return None

        finally:
            time.sleep(0.5)  # Rate limiting: 2 calls/second max

    def get_reviews(self, yelp_id: str) -> List[dict]:
        """
        Get reviews for a business.

        Note: Yelp API returns up to 3 reviews on free tier.
        For more reviews, would need SerpAPI.

        Args:
            yelp_id: Yelp business ID

        Returns:
            List of {"text": str, "rating": int, "date": str, "source": "yelp"}
        """
        url = f"{self.BASE_URL}/businesses/{yelp_id}/reviews"
        params = {"limit": 50, "sort_by": "newest"}

        try:
            response = requests.get(url, headers=self.headers, params=params, timeout=15)
            response.raise_for_status()

            reviews = response.json().get("reviews", [])

            return [
                {
                    "text": r.get("text", ""),
                    "rating": r.get("rating"),
                    "date": r.get("time_created", "")[:10],  # YYYY-MM-DD
                    "source": "yelp",
                    "reviewer_name": r.get("user", {}).get("name", "Anonymous")
                }
                for r in reviews
            ]

        except requests.RequestException as e:
            logger.warning(f"Yelp reviews error for {yelp_id}: {e}")
            return []

    def get_business_details(self, yelp_id: str) -> Optional[dict]:
        """
        Get detailed business information.

        Args:
            yelp_id: Yelp business ID

        Returns:
            Full business details dict or None
        """
        url = f"{self.BASE_URL}/businesses/{yelp_id}"

        try:
            response = requests.get(url, headers=self.headers, timeout=15)
            response.raise_for_status()
            return response.json()

        except requests.RequestException as e:
            logger.warning(f"Yelp details error for {yelp_id}: {e}")
            return None

    def _name_similarity(self, name1: str, name2: str) -> float:
        """Calculate similarity between business names."""
        def normalize(s):
            return (s.lower()
                    .replace("llc", "")
                    .replace("inc", "")
                    .replace("corp", "")
                    .replace(",", "")
                    .replace(".", "")
                    .strip())

        n1, n2 = normalize(name1), normalize(name2)
        return SequenceMatcher(None, n1, n2).ratio()
