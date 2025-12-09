# Contractor Data Scrapers

## Last Updated: Dec 9, 2025

## Quick Start
```bash
source venv/bin/activate && set -a && source .env && set +a

# BBB - Rating, accreditation, complaints
python3 scrapers/bbb.py "Company Name" "Fort Worth" "TX" --with-details

# Google Maps - Rating, reviews (NO API - uses Playwright)
python3 scrapers/google_maps.py "Company Name" "Fort Worth, TX" --max-reviews 20

# Yelp - Via Yahoo Search (bypasses DataDome)
python3 scrapers/yelp.py "Company Name" "Fort Worth, TX" --yahoo

# Trustpilot - Direct URL check by domain
python3 scrapers/trustpilot.py "https://company-website.com"

# SERP Rating - Angi, Houzz (bypasses anti-bot)
python3 scrapers/serp_rating.py "Company Name" "Fort Worth, TX" --site angi.com --json
python3 scrapers/serp_rating.py "Company Name" "Fort Worth, TX" --site houzz.com --json
```

## Scraper Reference

| Scraper | Source | Method | Output |
|---------|--------|--------|--------|
| `bbb.py` | BBB | httpx | Rating, accreditation, complaints, years |
| `google_maps.py` | Google Maps | Playwright | Rating, review count, reviews |
| `yelp.py` | Yelp | Yahoo Search | Rating, review count, URL |
| `trustpilot.py` | Trustpilot | Direct URL | Rating, review count, business name |
| `serp_rating.py` | Angi/Houzz | Yahoo SERP | Rating, review count |

## Integration

All scrapers are called from `services/collection_service.js` via:
```javascript
const result = callPythonScraper('bbb.py', [name, city, state, '--with-details']);
```

## Environment Variables
```bash
DEEPSEEK_API_KEY=your_key  # For AI analysis
SERPER_API_KEY=your_key    # For additional sources (HomeAdvisor, Reddit, etc.)
```

## Utilities

`utils.py` provides:
- Rate limiting (prevent blocks)
- Caching (reduce duplicate requests)
- Retry logic (handle transient failures)
