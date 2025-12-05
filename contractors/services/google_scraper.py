import os
import time
import logging
import requests
from typing import List
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Rate limiting settings
SEARCH_DELAY = 2.0        # Seconds between text searches
DETAIL_DELAY = 0.3        # Seconds between place detail calls
MAX_RETRIES = 3           # Max retry attempts on failure
BACKOFF_MULTIPLIER = 2    # Exponential backoff multiplier


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
    # Full DFW Metroplex coverage - 40+ cities
    TARGET_CITIES = [
        # Core cities
        'Fort Worth', 'Dallas', 'Arlington', 'Irving', 'Grand Prairie',
        # North/Northeast
        'Plano', 'Frisco', 'McKinney', 'Allen', 'Richardson',
        'Garland', 'Mesquite', 'Rowlett', 'Rockwall', 'Wylie',
        'Murphy', 'Sachse', 'Lucas', 'Prosper', 'Celina',
        # Northwest
        'Denton', 'Lewisville', 'Flower Mound', 'Carrollton', 'The Colony',
        'Little Elm', 'Corinth', 'Highland Village', 'Coppell', 'Addison',
        # West/Southwest Fort Worth area
        'Southlake', 'Colleyville', 'Keller', 'Grapevine', 'North Richland Hills',
        'Hurst', 'Euless', 'Bedford', 'Haltom City', 'Watauga',
        'Saginaw', 'Lake Worth', 'White Settlement', 'Benbrook', 'Crowley',
        # South
        'Mansfield', 'Burleson', 'Cleburne', 'Midlothian', 'Waxahachie',
        'Cedar Hill', 'DeSoto', 'Duncanville', 'Lancaster', 'Red Oak',
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

        # Retry with exponential backoff
        for attempt in range(MAX_RETRIES):
            try:
                resp = requests.get(url, params=params, timeout=30)
                data = resp.json()

                # Check for API errors
                status = data.get('status', '')
                if status == 'OVER_QUERY_LIMIT':
                    wait_time = SEARCH_DELAY * (BACKOFF_MULTIPLIER ** attempt)
                    logger.warning(f"Rate limited, waiting {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                elif status not in ('OK', 'ZERO_RESULTS'):
                    logger.warning(f"API error: {status}")
                    return []

                break  # Success
            except requests.exceptions.Timeout:
                wait_time = SEARCH_DELAY * (BACKOFF_MULTIPLIER ** attempt)
                logger.warning(f"Timeout on attempt {attempt + 1}, waiting {wait_time}s...")
                time.sleep(wait_time)
            except Exception as e:
                logger.error(f"Search failed: {e}")
                return []
        else:
            logger.error(f"Max retries exceeded for {query} in {city}")
            return []

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
            time.sleep(DETAIL_DELAY)

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

    def scrape_all(self, search_terms: List[str], cities: List[str] = None, max_per_city: int = 20, delay: float = None) -> List[ScrapedContractor]:
        cities = cities or self.TARGET_CITIES
        delay = delay or SEARCH_DELAY
        all_contractors = []
        seen = set()

        total_searches = len(search_terms) * len(cities)
        search_num = 0

        for term in search_terms:
            for city in cities:
                search_num += 1
                print(f"[{search_num}/{total_searches}] {term} in {city}", flush=True)
                try:
                    results = self.search(term, city, max_per_city)
                    new_count = 0
                    for c in results:
                        key = (c.business_name.lower(), c.city.lower())
                        if key not in seen:
                            seen.add(key)
                            all_contractors.append(c)
                            new_count += 1
                    if new_count > 0:
                        print(f"    Found {len(results)} results, {new_count} new", flush=True)
                    time.sleep(delay)
                except Exception as e:
                    logger.error(f"Failed: {e}")
                    print(f"    ERROR: {e}", flush=True)
                    time.sleep(delay * 2)  # Extra delay on error

        return all_contractors
