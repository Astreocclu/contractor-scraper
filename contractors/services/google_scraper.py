import os
import time
import logging
import requests
from typing import List
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ScrapedContractor:
    business_name: str
    address: str
    city: str
    state: str = 'TX'
    zip_code: str = ''
    phone: str = ''
    website: str = ''
    google_place_id: str = ''
    google_rating: float = None
    google_review_count: int = 0


class GoogleScraper:
    TARGET_CITIES = [
        'Fort Worth', 'Dallas', 'Southlake', 'Colleyville',
        'Keller', 'Grapevine', 'North Richland Hills',
        'Arlington', 'Plano', 'Frisco',
    ]

    def __init__(self):
        self.google_key = os.environ.get('GOOGLE_PLACES_API_KEY')
        self.serpapi_key = os.environ.get('SERPAPI_KEY')

        if not self.google_key and not self.serpapi_key:
            raise ValueError("Need GOOGLE_PLACES_API_KEY or SERPAPI_KEY")

    def search(self, query: str, city: str, max_results: int = 20) -> List[ScrapedContractor]:
        if self.google_key:
            try:
                return self._google_search(query, city, max_results)
            except Exception as e:
                logger.warning(f"Google failed: {e}")

        if self.serpapi_key:
            return self._serpapi_search(query, city, max_results)

        return []

    def _google_search(self, query: str, city: str, max_results: int) -> List[ScrapedContractor]:
        url = 'https://maps.googleapis.com/maps/api/place/textsearch/json'
        params = {
            'query': f"{query} in {city}, TX",
            'key': self.google_key,
        }

        resp = requests.get(url, params=params, timeout=30)
        data = resp.json()

        contractors = []
        for r in data.get('results', [])[:max_results]:
            c = ScrapedContractor(
                business_name=r.get('name', ''),
                address=r.get('formatted_address', ''),
                city=city,
                google_place_id=r.get('place_id', ''),
                google_rating=r.get('rating'),
                google_review_count=r.get('user_ratings_total', 0),
            )
            c = self._get_details(c)
            contractors.append(c)
            time.sleep(0.1)

        return contractors

    def _get_details(self, c: ScrapedContractor) -> ScrapedContractor:
        if not c.google_place_id or not self.google_key:
            return c

        try:
            url = 'https://maps.googleapis.com/maps/api/place/details/json'
            params = {
                'place_id': c.google_place_id,
                'fields': 'formatted_phone_number,website',
                'key': self.google_key,
            }
            resp = requests.get(url, params=params, timeout=15)
            data = resp.json()
            if data.get('status') == 'OK':
                c.phone = data.get('result', {}).get('formatted_phone_number', '')
                c.website = data.get('result', {}).get('website', '')
        except Exception:
            pass
        return c

    def _serpapi_search(self, query: str, city: str, max_results: int) -> List[ScrapedContractor]:
        params = {
            'engine': 'google_maps',
            'q': f"{query} near {city}, TX",
            'api_key': self.serpapi_key,
        }

        resp = requests.get('https://serpapi.com/search', params=params, timeout=30)
        data = resp.json()

        contractors = []
        for r in data.get('local_results', [])[:max_results]:
            contractors.append(ScrapedContractor(
                business_name=r.get('title', ''),
                address=r.get('address', ''),
                city=city,
                phone=r.get('phone', ''),
                website=r.get('website', ''),
                google_place_id=r.get('place_id', ''),
                google_rating=r.get('rating'),
                google_review_count=r.get('reviews', 0),
            ))

        return contractors

    def fetch_reviews(self, place_id: str, max_reviews: int = 50) -> List[dict]:
        reviews = []

        if self.serpapi_key:
            try:
                params = {
                    'engine': 'google_maps_reviews',
                    'place_id': place_id,
                    'api_key': self.serpapi_key,
                }
                resp = requests.get('https://serpapi.com/search', params=params, timeout=30)
                data = resp.json()
                for r in data.get('reviews', [])[:max_reviews]:
                    reviews.append({
                        'author': r.get('user', {}).get('name', ''),
                        'rating': r.get('rating'),
                        'text': r.get('snippet', ''),
                    })
                if reviews:
                    return reviews
            except Exception:
                pass

        if self.google_key:
            try:
                url = 'https://maps.googleapis.com/maps/api/place/details/json'
                params = {
                    'place_id': place_id,
                    'fields': 'reviews',
                    'key': self.google_key,
                }
                resp = requests.get(url, params=params, timeout=15)
                data = resp.json()
                for r in data.get('result', {}).get('reviews', []):
                    reviews.append({
                        'author': r.get('author_name', ''),
                        'rating': r.get('rating'),
                        'text': r.get('text', ''),
                    })
            except Exception:
                pass

        return reviews

    def scrape_all(self, search_terms: List[str], cities: List[str] = None, max_per_city: int = 20, delay: float = 1.5) -> List[ScrapedContractor]:
        cities = cities or self.TARGET_CITIES
        all_contractors = []
        seen = set()

        for term in search_terms:
            for city in cities:
                logger.info(f"Searching: {term} in {city}")
                try:
                    results = self.search(term, city, max_per_city)
                    for c in results:
                        key = (c.business_name.lower(), c.city.lower())
                        if key not in seen:
                            seen.add(key)
                            all_contractors.append(c)
                    time.sleep(delay)
                except Exception as e:
                    logger.error(f"Failed: {e}")

        return all_contractors
