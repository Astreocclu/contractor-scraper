# Contractor Auditor - System Architecture

**Generated:** 2026-01-09
**Purpose:** Factual documentation of current codebase state

---

## 1. APIs Used for Data Collection

### Primary APIs (with keys in .env)

| API | Key Variable | Purpose | Status |
|-----|--------------|---------|--------|
| DeepSeek | `DEEPSEEK_API_KEY` | LLM for audit analysis, review analysis | Active |
| Serper | `SERPER_API_KEY` | Google search API for reviews, ratings, news | Active |
| SerpAPI | `SERPAPI_API_KEY` / `SERPAPI_KEY` | Google Places reviews (backup) | Active |
| Outscraper | (via Serper fallback) | Google/Yelp/BBB reviews | Available |
| Anthropic | `ANTHROPIC_API_KEY` | Claude Vision for screenshot analysis | Available |
| Google | `GOOGLE_API_KEY` | Gemini for browser-use automation | Available |
| Yelp | `YELP_API_KEY` | Yelp business data | Available |
| Socrata | `SOCRATA_APP_TOKEN` | Open data (permits) | Available |
| Tracerfy | `TRACERFY_API_KEY` | Unknown/unused | Present |

### Free APIs (no key required)

| API | Purpose |
|-----|---------|
| OpenCorporates | Company registration lookup |
| Texas Comptroller | Franchise tax status |
| CourtListener | Federal court cases (key optional) |

---

## 2. Council/Shepherd System

**Status: NOT IMPLEMENTED**

There is no "council" or "shepherd" system in the codebase. These terms appear only in:
- Documentation/plans
- CLAUDE.md references
- CSV exports (unrelated)

### What Exists Instead: Three-Persona Dialectic Audit

Located in `services/audit_agent.js`:

| Persona | Role | Output |
|---------|------|--------|
| **Consumer Advocate** | Skeptical - finds reasons NOT to trust | `trust_score`, `key_concerns`, `reasoning` |
| **Fair Arbiter** | Charitable - finds reasons TO trust | `trust_score`, `key_positives`, `reasoning` |
| **Synthesizer** | Senior analyst - weighs both, produces verdict | `final_trust_score`, `agreements`, `disagreements`, `summary` |

Flow:
```
Advocate runs → Arbiter runs → Synthesizer reads both → Final score
```

---

## 3. Audit Pipeline Flow

### Entry Points

| File | Purpose |
|------|---------|
| `bin/run_audit.js` | CLI entry - single contractor audit |
| `bin/batch_audit_runner.js` | Batch processing multiple contractors |
| `bin/batch_collect.js` | Data collection only (no audit) |
| `bin/batch_dialectic.js` | Batch dialectic audits |

### Pipeline Sequence

```
run_audit.js
    │
    ▼
orchestrator.js :: runForensicAudit()
    │
    ├── 1. Find/create contractor in DB
    │
    ├── 2. CollectionService.runInitialCollection()
    │       │
    │       ├── Scrape all sources (see Section 4)
    │       ├── Store raw data in contractor_raw_data table
    │       └── Run review_analyzer.js on collected reviews
    │
    ├── 3. AuditAgent.run() OR DialecticAuditAgent.run()
    │       │
    │       ├── Build prompt with all collected data
    │       ├── Call DeepSeek API (seed:42 for determinism)
    │       ├── [Dialectic] Run 3 personas sequentially
    │       └── Parse JSON response
    │
    └── 4. Save to audit_records table
```

### Key Files by Function

| Function | File |
|----------|------|
| CLI entry | `bin/run_audit.js` |
| Orchestration | `services/orchestrator.js` |
| Data collection | `services/collection_service.js` |
| DeepSeek audit agent | `services/audit_agent.js` |
| Review authenticity check | `services/review_analyzer.js` |
| External APIs | `services/api_sources.js` |
| Score constraints | `services/scoring_constraints.js` |
| Database | `services/db_pg.js` |

---

## 4. Data Sources - Status

### Tier 1: Reviews (24h cache)

| Source | Method | File | Status |
|--------|--------|------|--------|
| BBB | Python httpx scraper | `scrapers/bbb.py` | Working |
| Yelp | Yahoo Search bypass | `scrapers/yelp.py` | Working |
| Google Maps (local) | Serper API | `collection_service.js` | Working |
| Google Maps (HQ) | Serper API | `collection_service.js` | Working |
| Angi | Serper rating extraction | `collection_service.js` | Working |
| Houzz | Serper rating extraction | `collection_service.js` | Working |
| Trustpilot | Direct URL scraper | `scrapers/trustpilot.py` | Working |
| Thumbtack | Puppeteer | `collection_service.js` | Unknown |
| Facebook | Puppeteer | `collection_service.js` | Unknown |

### Tier 2: News (12h cache)

| Source | Method | Status |
|--------|--------|--------|
| Google News | Serper search | Working |
| Local News | Serper search | Working |

### Tier 3: Social (24h cache)

| Source | Method | Status |
|--------|--------|--------|
| Reddit | Serper site:reddit.com | Working |
| YouTube | Serper site:youtube.com | Working |
| Nextdoor | Serper site:nextdoor.com | Working |

### Tier 4: Employee (7d cache)

| Source | Method | Status |
|--------|--------|--------|
| Indeed | Serper site:indeed.com | Working |
| Glassdoor | Serper site:glassdoor.com | Working |

### Tier 5: Government (7d cache)

| Source | Method | Status |
|--------|--------|--------|
| OSHA | Serper site:osha.gov | Working |
| EPA ECHO | Serper site:echo.epa.gov | Working |

### Tier 6: Texas-Specific (7d cache)

| Source | Method | Status |
|--------|--------|--------|
| TX AG Complaints | Puppeteer | Unknown |
| TX SOS Search | Puppeteer | Unknown |
| TX Franchise Tax | API | Working |
| TDLR | Removed | N/A - unreliable |

### Tier 7: Courts (7d cache)

| Source | Method | File | Status |
|--------|--------|------|--------|
| Tarrant Court | Puppeteer | `scrapers/court_scraper.js` | Partial - CAPTCHA issues |
| Dallas Court | Puppeteer | `scrapers/court_scraper.js` | Partial - CAPTCHA issues |
| Collin Court | Puppeteer | `scrapers/court_scraper.js` | Partial - CAPTCHA issues |
| Denton Court | Puppeteer | `scrapers/court_scraper.js` | Partial - CAPTCHA issues |
| CourtListener | API | `services/api_sources.js` | Working (federal only) |
| County Liens | Python Playwright | `scrapers/county_liens/` | Working |

### Tier 8: Industry (24h cache)

| Source | Method | Status |
|--------|--------|--------|
| Porch | Serper | Working |
| BuildZoom | Serper | Working |
| HomeAdvisor | Serper | Working |

### Review Scraper Options

| Scraper | File | Method | Notes |
|---------|------|--------|-------|
| google_maps.py | `scrapers/` | Playwright | Hardcoded selectors, breaks often |
| google_maps_browseruse.py | `scrapers/` | browser-use + Gemini | Slower, more robust |
| google_maps_claude_vision.py | `scrapers/` | Playwright + Claude Vision | Most robust, expensive |
| google_reviews_serper.py | `scrapers/` | Serper /places + /reviews | Recommended - 100% success |
| google_reviews_tiered.py | `scrapers/` | Serper → SerpAPI fallback | Tiered approach |
| outscraper_reviews.py | `scrapers/` | Outscraper API | $3/1000 reviews |

---

## 5. Database Tables

| Table | Purpose |
|-------|---------|
| `contractors_contractor` | Contractor master data |
| `contractor_raw_data` | Cached scraper results |
| `audit_records` | Audit results (V4 dialectic) |
| `contractors_contractoraudit` | Old audit results |
| `collection_log` | Scraping activity log |
| `county_lien_records` | Lien search results |

---

## 6. Environment Variables Required

```bash
# Required
DATABASE_URL=postgresql://...
DEEPSEEK_API_KEY=sk-...
SERPER_API_KEY=...

# Optional but recommended
SERPAPI_API_KEY=...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# Feature flags
USE_OUTSCRAPER=true/false
USE_CLAUDE_VISION=true/false
USE_BROWSERUSE=true/false
```

---

## 7. Commands

```bash
# Single audit
node bin/run_audit.js --id 123
node bin/run_audit.js --id 123 --mode dialectic

# Batch
node bin/batch_audit_runner.js --limit 100
node bin/batch_dialectic.js

# Collection only
node bin/batch_collect.js --id 123 --force

# Django server
python3 manage.py runserver 8002
```
