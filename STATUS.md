# Contractor Auditor - Status Report
**Updated:** 2025-12-09

---

## Executive Summary

The contractor auditing system is **fully operational**. Data collection pipeline works end-to-end, scoring is accurate, and contractors are passing/failing appropriately based on real data.

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
| **County Liens** | Playwright | **BLOCKED** - Portals showing CAPTCHA (see ERRORS.md) |

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

# Batch collection
node batch_collect.js --id 123 --force

# Start server
export DATABASE_URL=postgresql://contractors_user:localdev123@localhost/contractors_dev
python3 manage.py runserver 8002
```

---

## Files Reference

```
services/
├── collection_service.js   # All data collection (Playwright/Python scrapers)
├── audit_agent.js          # DeepSeek agentic audit loop
├── audit_agent_v2.js       # Score enforcement with caps
└── review_analyzer.js      # Fake review detection

scrapers/
├── bbb.py                  # BBB httpx scraper
├── google_maps.py          # Google Maps Playwright scraper
├── yelp.py                 # Yelp via Yahoo Search
├── trustpilot.py           # Trustpilot direct URL check
├── serp_rating.py          # Angi/Houzz via SERP
└── utils.py                # Rate limiting, caching, retry
```
