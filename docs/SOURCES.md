# Contractor Auditor - Data Sources Reference

**Updated:** 2026-02-18

---

## API Keys

| API | Env Variable | Purpose | Status |
|-----|--------------|---------|--------|
| DeepSeek | `DEEPSEEK_API_KEY` | LLM audit analysis | Active |
| Serper | `SERPER_API_KEY` | Google search API | Active |
| SerpAPI | `SERPAPI_API_KEY` | Google Places (backup) | Active |
| Anthropic | `ANTHROPIC_API_KEY` | Claude Vision | Available |
| Google | `GOOGLE_API_KEY` | Gemini for browser-use | Available |
| Yelp | `YELP_API_KEY` | Yelp business data | Available |

**BANNED:** `GOOGLE_PLACES_API_KEY` - caused $300 overcharge. Use Playwright scraping instead.

**Python scrapers:** Collection uses `venv/bin/python` by default if present. Override with `PYTHON_SCRAPER` env var.

---

## Tier 1: Reviews (24h cache)

| Source | Method | File | Status |
|--------|--------|------|--------|
| Google Maps (local) | Serper API | `collection_service.js` | Working |
| Google Maps (HQ) | Serper API | `collection_service.js` | Working |
| Google Maps (listed address) | Playwright scraper | `scrapers/google_maps.py` | Working (venv python) |
| Google Maps reviews (tiered) | Serper → SerpAPI fallback | `scrapers/google_reviews_tiered.py` | Working |
| Google Reviews remediation (primary lane) | DataForSEO Business Data API | `services/dataforseo_service.js`, `services/collection_service.js` | Working |
| BBB (primary) | Serper API + parser | `collection_service.js` | Working |
| BBB (detail fallback) | Python + BeautifulSoup | `scrapers/bbb.py` | Working (venv python) |
| Yelp (primary) | Serper API | `collection_service.js` | Working |
| Yelp (Yahoo fallback) | Playwright scraper | `scrapers/yelp.py` | Working (venv python) |
| Trustpilot (primary) | Direct URL check (Python) | `scrapers/trustpilot.py` | Working (venv python) |
| Angi | Serper rating extraction | `collection_service.js` | Working |
| Houzz | Serper rating extraction | `collection_service.js` | Working |

---

## Tier 2: News (12h cache)

| Source | Method | Status |
|--------|--------|--------|
| Google News | Serper search | Working |
| Local News | Serper search | Working |

---

## Tier 3: Social (24h cache)

| Source | Method | Status |
|--------|--------|--------|
| Reddit | Serper site:reddit.com | Working |
| YouTube | Serper site:youtube.com | Working |
| Nextdoor | Serper site:nextdoor.com | Working |

---

## Tier 4: Employee (7d cache)

| Source | Method | Status |
|--------|--------|--------|
| Indeed | Serper site:indeed.com | Working |
| Glassdoor | Serper site:glassdoor.com | Working |

---

## Tier 5: Government (7d cache)

| Source | Method | Status |
|--------|--------|--------|
| OSHA | Serper site:osha.gov | Working |
| EPA ECHO | Serper site:echo.epa.gov | Working |

---

## Tier 6: Texas-Specific (7d cache)

| Source | Method | Status |
|--------|--------|--------|
| TX Franchise Tax | API | Working |
| TX AG Complaints | Serper API | Working |
| TX SOS Search | Serper API | Working |
| OpenCorporates | API (no key) | Working |
| TDLR | Removed | N/A - unreliable |

---

## Tier 7: Courts (7d cache)

**Launch focus counties (DFW):** Denton, Collin, Tarrant, Dallas

| Source | Method | File | Status |
|--------|--------|------|--------|
| Court records (generic) | Playwright (JS) | `scrapers/court_scraper.js` | Working |
| Tarrant Court | Serper API | `collection_service.js` | Working |
| Dallas Court | Serper API | `collection_service.js` | Working |
| Collin Court | Serper API | `collection_service.js` | Working |
| Denton Court | Serper API | `collection_service.js` | Working |
| Tarrant County Liens | Playwright | `scrapers/county_liens/tarrant.py` | Working (venv python) |
| Collin County Liens | Playwright | `scrapers/county_liens/collin.py` | Working (venv python) |
| Dallas County Liens | Playwright | `scrapers/county_liens/dallas.py` | Working (venv python) |
| Denton County Liens | Playwright | `scrapers/county_liens/denton.py` | Working (venv python) |
| CourtListener | API | `services/api_sources.js` | Working (federal only) |

**Note:** County portals at `*.tx.publicsearch.us` (updated Dec 2025)

---

## Tier 8: Industry (24h cache)

| Source | Method | Status |
|--------|--------|--------|
| Porch | Serper | Working |
| BuildZoom | Serper | Working |
| HomeAdvisor | Serper | Working |

---

## Review Scraper Options

| Scraper | File | Method | Recommendation |
|---------|------|--------|----------------|
| dataforseo_service.js | `services/` | DataForSEO Google Reviews API | **Primary remediation lane** |
| google_reviews_serper.py | `scrapers/` | Serper /places + /reviews | **Recommended** - 100% success |
| google_reviews_tiered.py | `scrapers/` | Serper → SerpAPI fallback | Good backup |
| apify_service.js | `services/` | Apify Google Maps Reviews Scraper | Fallback lane (guarded) |
| google_maps_browseruse.py | `scrapers/` | browser-use + Gemini | Slower, robust |
| google_maps_claude_vision.py | `scrapers/` | Playwright + Claude Vision | Most robust, expensive |
| outscraper_reviews.py | `scrapers/` | Outscraper API | $3/1000 reviews |
| google_maps.py | `scrapers/` | Playwright hardcoded | Breaks often |

---

## Cache TTLs

| Tier | TTL | Rationale |
|------|-----|-----------|
| Reviews (T1) | 24h | Ratings change slowly |
| News (T2) | 12h | News cycles faster |
| Social (T3) | 24h | Discussions slow |
| Employee (T4) | 7d | Job reviews rare |
| Government (T5) | 7d | Records stable |
| Texas (T6) | 7d | State data stable |
| Courts (T7) | 7d | Liens don't change |
| Industry (T8) | 24h | Platform updates |
