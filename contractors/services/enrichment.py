import os
import re
import time
import logging
import requests
from dataclasses import dataclass
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


@dataclass
class BBBData:
    rating: str = None
    accredited: bool = False
    complaint_count: int = 0
    years_in_business: int = None


@dataclass
class YelpData:
    yelp_id: str = None
    rating: float = None
    review_count: int = 0


class EnrichmentService:
    def __init__(self):
        self.yelp_key = os.environ.get('YELP_API_KEY')
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
        })

    def get_bbb(self, name: str, city: str, state: str = 'TX') -> BBBData:
        data = BBBData()
        try:
            url = "https://www.bbb.org/search"
            params = {'find_text': name, 'find_loc': f"{city}, {state}"}
            resp = self.session.get(url, params=params, timeout=15)
            soup = BeautifulSoup(resp.text, 'html.parser')

            link = soup.find('a', class_='text-blue-medium')
            if link and link.get('href'):
                profile_url = link['href']
                if not profile_url.startswith('http'):
                    profile_url = f"https://www.bbb.org{profile_url}"
                data = self._parse_bbb_profile(profile_url)
        except Exception as e:
            logger.debug(f"BBB failed for {name}: {e}")
        return data

    def _parse_bbb_profile(self, url: str) -> BBBData:
        data = BBBData()
        try:
            resp = self.session.get(url, timeout=15)
            soup = BeautifulSoup(resp.text, 'html.parser')

            rating = soup.find('span', class_='dtm-rating')
            if rating:
                data.rating = rating.get_text(strip=True)[:2]

            if soup.find(string=re.compile('BBB Accredited', re.I)):
                data.accredited = True

            years = re.search(r'(\d+)\s*Years?\s*in\s*Business', resp.text, re.I)
            if years:
                data.years_in_business = int(years.group(1))

            complaints = re.search(r'(\d+)\s*complaints?\s*closed', resp.text, re.I)
            if complaints:
                data.complaint_count = int(complaints.group(1))
        except Exception:
            pass
        return data

    def get_yelp(self, name: str, city: str, state: str = 'TX') -> YelpData:
        data = YelpData()
        if not self.yelp_key:
            return data

        try:
            url = "https://api.yelp.com/v3/businesses/search"
            headers = {'Authorization': f'Bearer {self.yelp_key}'}
            params = {'term': name, 'location': f"{city}, {state}", 'limit': 5}

            resp = requests.get(url, headers=headers, params=params, timeout=15)
            results = resp.json()

            for biz in results.get('businesses', []):
                if name.lower() in biz.get('name', '').lower():
                    data.yelp_id = biz.get('id')
                    data.rating = biz.get('rating')
                    data.review_count = biz.get('review_count', 0)
                    break
        except Exception as e:
            logger.debug(f"Yelp failed for {name}: {e}")
        return data

    def enrich(self, name: str, city: str, state: str = 'TX', delay: float = 1.0):
        bbb = self.get_bbb(name, city, state)
        time.sleep(delay)
        yelp = self.get_yelp(name, city, state)
        return bbb, yelp
