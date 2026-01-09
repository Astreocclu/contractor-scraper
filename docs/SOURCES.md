# Contractor Auditor - Data Sources Reference

**Updated:** 2026-01-09

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

---

## Tier 1: Reviews (24h cache)

| Source | Method | File | Status |
|--------|--------|------|--------|
| Google Maps (local) | Serper API | `collection_service.js` | Working |
| Google Maps (HQ) | Serper API | `collection_service.js` | Working |
| BBB | Python httpx | `scrapers/bbb.py` | Working |
| Yelp | Yahoo Search bypass | `scrapers/yelp.py` | Working |
| Trustpilot | Direct URL check | `scrapers/trustpilot.py` | Working |
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
| TX AG Complaints | Puppeteer | Unknown |
| TX SOS Search | Puppeteer | Unknown |
| TDLR | Removed | N/A - unreliable |

---

## Tier 7: Courts (7d cache)

| Source | Method | File | Status |
|--------|--------|------|--------|
| Tarrant County Liens | Playwright | `scrapers/county_liens/tarrant.py` | Working (48 records) |
| Collin County Liens | Playwright | `scrapers/county_liens/collin.py` | Working (50 records) |
| Dallas County Liens | Playwright | `scrapers/county_liens/dallas.py` | Working (942 records) |
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
| google_reviews_serper.py | `scrapers/` | Serper /places + /reviews | **Recommended** - 100% success |
| google_reviews_tiered.py | `scrapers/` | Serper → SerpAPI fallback | Good backup |
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
