# Contractor Auditor - Status Report
**Updated:** 2026-01-09

> **Note:** If the date above isn't today, this document may be out of date. Check SESSION-NOTES.md for the latest work.

---

## Executive Summary

The contractor auditing system is **fully operational** with V2 pipeline achieving **zero variance** scoring. Data collection pipeline works end-to-end, scoring is accurate with 72% recommendation rate validated as statistically appropriate.

**Scoring Validation (Dec 25):**
- 72% RECOMMENDED rate confirmed appropriate (not inflated)
- HIGH-severity flags are primary differentiator
- Low-review contractors with no issues correctly score 85
- Contractors with lawsuits/fraud correctly score 65 or below

**V2 Consolidation (Dec 22):**
- Removed V1 agent (had tools, web access, 12-point variance)
- V2 is now the only pipeline (`services/audit_agent.js`)
- Zero variance achieved with `deepseek-chat` + `seed: 42`
- Score caps removed - trust pre-analyzed data
- Lien summaries extracted (not 110KB raw records)

**Infrastructure (Dec 12-15):**
- Batch audit runner with sequential execution and state persistence
- Async subprocess handling (replaced blocking execSync)
- Cost tracking and rate limiting infrastructure
- Website discovery: 31% → 61% coverage (+1,291 websites)

---

## What's Working

### 1. Project Infrastructure
| Component | Status | Notes |
|-----------|--------|-------|
| Django project | Working | Runs on port 8002 |
| Database | Working | PostgreSQL (contractors_dev) |
| Models | Working | Vertical, Contractor, ContractorAudit |
| Admin interface | Working | Full CRUD at /admin/ |
| REST API | Working | DRF with pagination |
| Virtual environment | Working | All dependencies installed |

### 2. Data Collection Sources

#### Tier 1: Reviews (Primary)
| Source | Method | Status |
|--------|--------|--------|
| Google Maps | Playwright scraper | Working - searches LOCAL/LISTED/HQ |
| BBB | Python httpx | Working - rating, accreditation, complaints |
| Yelp | Yahoo Search workaround | Working - bypasses DataDome |
| Trustpilot | Direct URL check | Working - checks domain directly |
| Angi | SERP scraper | Working - bypasses anti-bot |
| Houzz | SERP scraper | Working - bypasses anti-bot |

#### Tier 2+: Additional Sources
| Source | Method | Status |
|--------|--------|--------|
| HomeAdvisor | Serper API | Working |
| Glassdoor | Serper API | Working |
| Indeed | Serper API | Working |
| Reddit | Serper API | Working |
| OSHA | Serper API | Working |
| News | Serper API | Working |
| Court Records | Puppeteer | Working - Tarrant, Dallas, Collin, Denton |
| TX Franchise | API | Working |
| County Liens | Playwright | Working - Tarrant (48), Collin (50), Dallas (942) records |

### 3. AI Auditor (DeepSeek)
| Feature | Status |
|---------|--------|
| Model connection | Working (deepseek-chat) |
| Sentiment analysis | Working |
| Fake review detection | Working |
| Source conflict detection | Working |
| Red flag detection | Working |
| Confidence scoring | Working |

### 4. Trust Score Calculator
| Feature | Status | Notes |
|---------|--------|-------|
| Score calculation | Working | 0-100 scale |
| Category breakdown | Working | Verification, Reputation, Credibility, Red Flags |
| Tier system | Working | Gold (80+), Silver (65+), Bronze (50+) |
| Score caps | Working | CRITICAL=15, SEVERE=35, MODERATE=60 |

### 5. Dialectic Audit System (NEW Jan 2026)
| Feature | Status |
|---------|--------|
| 3-persona mode | Working |
| Consumer Advocate persona | Working |
| Fair Arbiter persona | Working |
| Synthesizer persona | Working |
| audit_version=4 storage | Working |
| Full reasoning trace | Working |

### 6. API Endpoints
| Endpoint | Status |
|----------|--------|
| GET /api/verticals/ | Working |
| GET /api/contractors/ | Working (passing only) |
| GET /api/contractors/?all=true | Working (all) |
| GET /api/contractors/stats/ | Working |
| GET /api/contractors/top/ | Working |
| GET /api/contractors/{slug}/ | Working |

### 7. Batch Audit System (Dec 12)
| Component | Status | Notes |
|-----------|--------|-------|
| bin/batch_audit_runner.js | Working | Sequential execution with state persistence |
| State persistence | Working | `batch_progress.json` tracks pending/completed/failed |
| Review analysis bucket | Working | Separate retry queue for JSON parse failures |
| async_command.js | Working | Replaced blocking execSync calls |
| cost_tracker.js | Working | JSON-L logging of API costs |
| rate_limiter.js | Working | Token bucket rate limiting |

**State Buckets:**
- `completed` - Successful audits with review analysis
- `needsReviewAnalysis` - Audits where DeepSeek returned non-JSON
- `failed` - Audits that threw errors
- `pending` - Queued contractors

### 8. Email Collection
| Metric | Value |
|--------|-------|
| Contractors with email | 679/2,529 (26.8%) |
| Coverage gap cause | Discovery pipeline doesn't collect email |
| Tracerfy integration | Created but 3% hit rate |

### 9. Website Discovery (Dec 13)
| Metric | Value |
|--------|-------|
| Contractors with website | 2,575/4,195 (61.4%) |
| Batch run results | 1,605 processed, 1,338 websites found (83.4% hit rate) |
| Before batch | 1,284 websites (31%) |
| After batch | 2,575 websites (61%) |
| Script | `scrapers/batch_website_discovery.py` |

**Usage:**
```bash
python3 scrapers/batch_website_discovery.py --limit 100    # Single batch
python3 scrapers/batch_website_discovery.py --continuous   # Process all
```

---

## API Keys Status

| Key | Status | Notes |
|-----|--------|-------|
| DEEPSEEK_API_KEY | Ready | platform.deepseek.com |
| SERPER_API_KEY | Ready | For additional sources |
| GOOGLE_PLACES_API_KEY | **BANNED** | DO NOT USE - caused $300 overcharge |

---

## Commands

```bash
# Activate environment
source venv/bin/activate && set -a && . ./.env && set +a

# Run single audit
node bin/run_audit.js --id 123
node bin/run_audit.js --name "Company" --city "Dallas" --state "TX"

# Batch audit
node bin/batch_audit_runner.js --reset --limit 10    # Fresh batch of 10
node bin/batch_audit_runner.js --status              # Check progress
node bin/batch_audit_runner.js --retry-review        # Retry failed review analysis
node bin/batch_audit_runner.js --resume              # Continue interrupted batch

# Batch collection
node bin/batch_collect.js --id 123 --force

# Start server
export DATABASE_URL=postgresql://contractors_user:localdev123@localhost/contractors_dev
python3 manage.py runserver 8002
```

---

## Files Reference

```
services/
├── collection_service.js   # All data collection (Playwright/Python scrapers)
├── audit_agent.js          # DeepSeek agentic audit loop (V2)
├── review_analyzer.js      # Fake review detection (4-tier JSON fallback)
├── orchestrator.js         # Core audit orchestration (batchMode flag)
├── async_command.js        # Async subprocess runner (replaced execSync)
├── cost_tracker.js         # API cost tracking with JSON-L logging
└── rate_limiter.js         # Token bucket rate limiting

scrapers/
├── bbb.py                  # BBB httpx scraper
├── google_maps.py          # Google Maps Playwright scraper (stealth, CAPTCHA detection)
├── yelp.py                 # Yelp via Yahoo Search
├── trustpilot.py           # Trustpilot direct URL check
├── serp_rating.py          # Angi/Houzz via SERP
├── county_liens/           # Texas county lien scrapers (Tarrant, Collin, Dallas)
├── batch_website_discovery.py  # Batch website lookup via Google Maps
└── utils.py                # Rate limiting, caching, retry

bin/
├── run_audit.js            # Single contractor audit CLI
├── batch_audit_runner.js   # Batch orchestration with state persistence
├── batch_collect.js        # Data collection only
├── batch_full_pipeline.js  # Full V2 pipeline (experimental)
└── audit_only.js           # Analysis only (requires pre-collected data)

root/
└── batch_progress.json     # State file (pending/completed/failed/needsReviewAnalysis)

scripts/
└── tracerfy_enrich.py      # Tracerfy skip tracing integration
```
