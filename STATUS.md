# Contractor Auditor - Status Report
**Updated:** 2025-12-12

> **Note:** If the date above isn't today, this document may be out of date. Check SESSION-NOTES.md for the latest work.

---

## Executive Summary

The contractor auditing system is **fully operational** with new **batch processing capabilities**. Data collection pipeline works end-to-end, scoring is accurate, and contractors are passing/failing appropriately based on real data.

**Recent Additions (Dec 12):**
- Batch audit runner with sequential execution and state persistence
- Review analysis tracking with separate retry bucket
- Async subprocess handling (replaced blocking execSync)
- Cost tracking and rate limiting infrastructure

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

### 5. API Endpoints
| Endpoint | Status |
|----------|--------|
| GET /api/verticals/ | Working |
| GET /api/contractors/ | Working (passing only) |
| GET /api/contractors/?all=true | Working (all) |
| GET /api/contractors/stats/ | Working |
| GET /api/contractors/top/ | Working |
| GET /api/contractors/{slug}/ | Working |

### 6. Batch Audit System (NEW Dec 12)
| Component | Status | Notes |
|-----------|--------|-------|
| batch_audit_runner.js | Working | Sequential execution with state persistence |
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

### 7. Email Collection
| Metric | Value |
|--------|-------|
| Contractors with email | 679/2,529 (26.8%) |
| Coverage gap cause | Discovery pipeline doesn't collect email |
| Tracerfy integration | Created but 3% hit rate |

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
node run_audit.js --id 123
node run_audit.js --name "Company" --city "Dallas" --state "TX"

# Batch audit (NEW)
node batch_audit_runner.js --reset --limit 10    # Fresh batch of 10
node batch_audit_runner.js --status              # Check progress
node batch_audit_runner.js --retry-review        # Retry failed review analysis
node batch_audit_runner.js --resume              # Continue interrupted batch

# Batch collection
node batch_collect.js --id 123 --force

# Start server
export DATABASE_URL=postgresql://contractors_user:localdev123@localhost/contractors_dev
python3 manage.py runserver 8002
```

### Nightly Scheduler

```bash
# Test nightly scheduler (bypasses time window)
node scripts/nightly_scheduler.js --force

# Test without lien scraping (faster, ~2x throughput)
node scripts/nightly_scheduler.js --force --skip-liens

# Install systemd timer (runs 8 PM - 6 AM Central)
sudo cp systemd/*.service systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now contractor-audit.timer

# Check timer status
systemctl list-timers contractor-audit.timer

# View logs
journalctl -u contractor-audit.service -f
```

---

## Files Reference

```
services/
├── collection_service.js   # All data collection (Playwright/Python scrapers)
├── audit_agent.js          # DeepSeek agentic audit loop
├── audit_agent_v2.js       # Score enforcement with caps
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
└── utils.py                # Rate limiting, caching, retry

root/
├── batch_audit_runner.js   # Batch orchestration with state persistence
└── batch_progress.json     # State file (pending/completed/failed/needsReviewAnalysis)

scripts/
└── tracerfy_enrich.py      # Tracerfy skip tracing integration
```
