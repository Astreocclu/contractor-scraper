# Web Scraping Migration Plan

## Overview

Migrate all scrapers from Puppeteer (Node.js) + requests to the new directive-compliant stack:
- **httpx + BeautifulSoup** for static pages
- **Playwright (Python)** for JavaScript-rendered pages
- Shared utilities for rate limiting, caching, retry, error handling

## Current State

### What Exists

| Location | Stack | Status |
|----------|-------|--------|
| `services/*.js` | Node.js + Puppeteer | **Needs migration** |
| `contractors/services/*.py` | Python + `requests` | **Needs httpx migration** |
| `scrapers/*.py` | Python + Playwright | Already compliant |

### Files to Migrate

**Node.js (Puppeteer) → Python (Playwright/httpx):**
- `services/collection_service.js` - Main scraper orchestration (~30 sources)
- `services/audit_agent.js` - DeepSeek integration
- `services/audit_agent_v2.js` - Score enforcement
- `services/review_analyzer.js` - Fake review detection
- `services/orchestrator.js` - Workflow orchestration
- `lib/tdlr_scraper.js` - TDLR license lookup
- `lib/court_scraper.js` - Court records

**Python (`requests` → `httpx`):**
- `contractors/services/enrichment.py` - BBB/Yelp enrichment
- `contractors/services/yelp_service.py` - Yelp API

### Data Sources (~30 total)

**Tier 1 - Static (httpx + BeautifulSoup):**
- BBB search/profile
- News sites (via Google News)
- OSHA/EPA public records
- Court record searches

**Tier 2 - JavaScript Required (Playwright):**
- TDLR license lookup
- Texas SOS business search
- Google Maps reviews
- Yelp (if no API key)
- Glassdoor/Indeed

---

## Phase 1: Foundation Layer

Create shared utilities that all scrapers will use.

### Tasks

1. **Create `contractors/services/scraper/` package**
   ```
   contractors/services/scraper/
   ├── __init__.py
   ├── base.py          # Abstract base classes
   ├── rate_limiter.py  # Per-domain rate limiting
   ├── cache.py         # File-based caching with TTL
   ├── retry.py         # Exponential backoff
   ├── errors.py        # Custom exception classes
   ├── user_agents.py   # UA rotation
   └── utils.py         # HTML extraction helpers
   ```

2. **Files to create:**

   **`errors.py`** - Exception hierarchy:
   - `ScraperError` (base)
   - `RateLimitError`
   - `BlockedError`
   - `ContentNotFoundError`
   - `TimeoutError`

   **`rate_limiter.py`** - Per-domain limiting:
   - Configurable requests/minute per domain
   - Government portals: 5-10 rpm
   - Review sites: 10-20 rpm
   - News sites: 20-30 rpm

   **`cache.py`** - TTL-based caching:
   - Use `.scraper_cache/` directory
   - TTLs from directive (7d for gov, 1d for reviews, etc.)
   - JSON file storage with metadata

   **`retry.py`** - Exponential backoff:
   - Max 3 retries
   - Base delay 1s, max 30s
   - Configurable per-source

   **`user_agents.py`** - UA pool:
   - Chrome (Win/Mac)
   - Firefox
   - Safari
   - Edge

3. **Update `requirements.txt`:**
   ```
   playwright>=1.40.0
   playwright-stealth>=1.0.0
   httpx>=0.25.0
   beautifulsoup4>=4.12.0
   lxml>=4.9.0
   ```

---

## Phase 2: Static Scrapers (httpx + BeautifulSoup)

Migrate sources that work with static HTML.

### Tasks

1. **Create `contractors/services/scraper/static.py`**
   - `fetch_static_page(url)` - async httpx GET
   - `fetch_with_cache(source, identifier, url)` - cached fetching
   - Common headers (UA, Accept, Accept-Language)

2. **Migrate BBB scraper** (`contractors/services/scraper/bbb.py`)
   - Port from `enrichment.py`
   - Use httpx instead of requests
   - Parse with BeautifulSoup
   - Add rate limiting + caching

3. **Create news scraper** (`contractors/services/scraper/news.py`)
   - Google News search
   - Local news site searches
   - Rate limited to avoid blocks

4. **Create government scrapers** (`contractors/services/scraper/government.py`)
   - OSHA establishment search
   - EPA ECHO facility search
   - TX Attorney General complaints

---

## Phase 3: Dynamic Scrapers (Playwright)

Migrate sources requiring JavaScript.

### Tasks

1. **Create `contractors/services/scraper/browser.py`**
   - `BrowserPool` class - shared browser, isolated contexts
   - `fetch_js_page(url, wait_for)` - basic JS rendering
   - `fetch_protected_page(url)` - with stealth
   - Proper context cleanup in `finally` blocks

2. **Create TDLR scraper** (`contractors/services/scraper/tdlr.py`)
   - Port from `lib/tdlr_scraper.js`
   - License lookup by business name
   - Extract: license number, status, expiration, holder name
   - 7-day cache TTL

3. **Create Texas SOS scraper** (`contractors/services/scraper/texas_sos.py`)
   - Port from `scrape_tx_sos.js`
   - Business entity search
   - Extract: entity name, type, status, formation date
   - 7-day cache TTL

4. **Create Google Maps scraper** (`contractors/services/scraper/google_maps.py`)
   - Port from `collection_service.js` (google_maps_local/hq)
   - Extract: rating, review_count, business name, status
   - 1-day cache TTL
   - Use stealth mode

5. **Create review platform scrapers** (`contractors/services/scraper/reviews.py`)
   - Yelp (fallback when no API key)
   - Glassdoor
   - Indeed reviews
   - Angi/HomeAdvisor/Porch

---

## Phase 4: Collection Service Rewrite

Replace `collection_service.js` with Python.

### Tasks

1. **Create `contractors/services/scraper/collection.py`**
   - `ContractorScraper` class - orchestrates all scrapers
   - `scrape_all(contractor)` - run all relevant scrapers
   - Parallel execution with semaphore (max 3-5 concurrent)
   - Results stored to Django models

2. **Define source registry:**
   ```python
   SOURCES = {
       # Static (httpx)
       'bbb': {'tier': 1, 'ttl': 86400, 'scraper': 'static'},
       'google_news': {'tier': 2, 'ttl': 43200, 'scraper': 'static'},
       'osha': {'tier': 5, 'ttl': 604800, 'scraper': 'static'},

       # Dynamic (Playwright)
       'tdlr': {'tier': 6, 'ttl': 604800, 'scraper': 'browser'},
       'google_maps': {'tier': 1, 'ttl': 86400, 'scraper': 'browser'},
       'yelp': {'tier': 1, 'ttl': 86400, 'scraper': 'browser'},
   }
   ```

3. **Create Django management command:**
   - `python manage.py scrape_contractor --id 123`
   - `python manage.py scrape_contractor --name "Company" --city "Dallas"`
   - Replace `node batch_collect.js`

4. **Integrate with existing models:**
   - Store raw data in `ContractorRawData` model (or create if needed)
   - Update `Contractor` model with enriched data
   - Trigger audit after scraping complete

---

## Phase 5: Audit Agent Migration

Migrate the DeepSeek audit pipeline.

### Tasks

1. **Create `contractors/services/audit/agent.py`**
   - Port `audit_agent.js` logic
   - Use httpx for DeepSeek API calls
   - Structured prompt templates
   - Score cap enforcement from v2

2. **Create `contractors/services/audit/analyzer.py`**
   - Port `review_analyzer.js`
   - Fake review detection
   - Cross-platform discrepancy checks

3. **Create CLI entry point:**
   - `python manage.py run_audit --id 123`
   - Replace `node run_audit.js`

---

## Phase 6: Testing & Cleanup

### Tasks

1. **Create tests** (`tests/test_scrapers.py`)
   - Test against known contractors (Orange Elephant = bad, verify CRITICAL)
   - Test rate limiting behavior
   - Test cache hit/miss
   - Test error handling

2. **Update documentation:**
   - `scrapers/README.md` - new Python commands
   - `CLAUDE.md` - update file map
   - `STATUS.md` - mark migration complete

3. **Deprecate Node.js:**
   - Add deprecation notices to `services/*.js`
   - Remove from `package.json` scripts
   - Keep files for reference during transition

4. **Install Playwright browsers:**
   ```bash
   pip install playwright
   playwright install chromium
   ```

---

## File Structure After Migration

```
contractors/services/
├── scraper/
│   ├── __init__.py
│   ├── base.py
│   ├── rate_limiter.py
│   ├── cache.py
│   ├── retry.py
│   ├── errors.py
│   ├── user_agents.py
│   ├── utils.py
│   ├── static.py          # httpx + BeautifulSoup
│   ├── browser.py         # Playwright base
│   ├── bbb.py
│   ├── tdlr.py
│   ├── texas_sos.py
│   ├── google_maps.py
│   ├── reviews.py         # Yelp, Glassdoor, etc.
│   ├── government.py      # OSHA, EPA, courts
│   ├── news.py
│   └── collection.py      # Main orchestrator
├── audit/
│   ├── __init__.py
│   ├── agent.py           # DeepSeek integration
│   └── analyzer.py        # Review analysis
├── enrichment.py          # (Updated to use httpx)
├── yelp_service.py        # (Updated to use httpx)
├── scoring.py
├── deduplication.py
└── ai_auditor.py
```

---

## Execution Order

1. **Phase 1** - Foundation (rate limiter, cache, errors, retry)
2. **Phase 2** - Static scrapers (BBB, news, government)
3. **Phase 3** - Dynamic scrapers (TDLR, Texas SOS, Google Maps)
4. **Phase 4** - Collection service rewrite
5. **Phase 5** - Audit agent migration
6. **Phase 6** - Testing & cleanup

Each phase should be testable independently before moving to the next.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Selectors changed on target sites | Store debug HTML on failure for inspection |
| Rate limiting too aggressive | Start conservative, tune based on blocks |
| Cache invalidation issues | Add `--force` flag to bypass cache |
| Playwright memory leaks | Always close contexts in `finally` blocks |
| Breaking existing audits | Keep Node.js working until Python validated |

---

## Success Criteria

- [ ] All 30 sources migrated to Python
- [ ] No Puppeteer/requests imports remaining
- [ ] Rate limiting prevents blocks
- [ ] Cache reduces redundant fetches
- [ ] Orange Elephant test case still scores CRITICAL (~15)
- [ ] `node run_audit.js` replaced by `python manage.py run_audit`
