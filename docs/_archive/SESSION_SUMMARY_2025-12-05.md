# Contractor Scraper - Session Summary
**Date:** December 5, 2025
**Session Focus:** Insurance confidence scoring, BBB parsing, review fraud detection

---

## Project Overview

**Purpose:** Scrape DFW contractors, enrich with data from 30+ sources, calculate trust scores, and detect fraud/fake reviews.

**Tech Stack:**
- Django 5.2 + DRF (API)
- Node.js (scraping services)
- Puppeteer (browser automation)
- DeepSeek AI (audit analysis, review analysis)
- SQLite (database)

**Port:** 8002

---

## What We Built This Session

### 1. Insurance Confidence Calculator
**File:** `services/collection_service.js` (lines 586-635)

Calculates insurance confidence score (0-9) based on indirect signals:

| Signal | Points | Source |
|--------|--------|--------|
| BBB Accredited | +3 | BBB verification |
| Active TDLR License | +2 | Texas licensing |
| Recent Permits (3+) | +2 | City permit records |
| Business Age (5+ yrs) | +1 | TX Secretary of State |
| Website mentions insurance | +1 | Website scrape |

**Levels:** HIGH (6+), MEDIUM (3-5), LOW (0-2)

```javascript
const { calculateInsuranceConfidence } = require('./services/collection_service');
```

### 2. Score Enforcement System
**File:** `services/audit_agent_v2.js` (lines 94-146)

LLM was scoring too high despite critical red flags. Added post-processing enforcement:

```javascript
function enforceScoreMultipliers(auditResult) {
  // CRITICAL flag → max 15
  // SEVERE/HIGH flag → max 35
  // MODERATE/MEDIUM flag → max 60
  // No flags → 60-100
}
```

**Example:** Orange Elephant had CRITICAL BBB F rating. LLM scored 48 → enforced to 15.

### 3. BBB Parser
**File:** `services/collection_service.js` (lines 82-173)

Extracts structured data from BBB search results:

```javascript
{
  found: true,
  rating: "F",           // A+ to F
  accredited: false,
  locations_count: 4,
  complaint_count: null,
  years_in_business: null
}
```

**Key Features:**
- Matches contractor name near rating (filters out ads)
- Takes worst rating if multiple locations found
- Conservative accreditation detection

### 4. Google Maps Parser
**File:** `services/collection_service.js` (lines 181-226)

```javascript
{
  found: true,
  rating: 4.8,
  review_count: 35,
  status: "open"
}
```

### 5. Glassdoor Parser
**File:** `services/collection_service.js` (lines 228-272)

```javascript
{
  found: true,
  rating: 3.2,
  review_count: 79,
  salary_count: 111
}
```

### 6. AI Review Analyzer
**File:** `services/review_analyzer.js`

Analyzes reviews for fraud patterns using DeepSeek AI:

```javascript
const { analyzeReviews, quickDiscrepancyCheck } = require('./services/review_analyzer');

// Output:
{
  fake_review_score: 85,        // 0-100, higher = more likely fake
  confidence: "HIGH",
  discrepancy_detected: true,
  discrepancy_explanation: "...",
  fake_signals: ["Generic language", "No negative reviews despite BBB F"],
  complaint_patterns: ["BBB F indicates unresolved complaints"],
  summary: "...",               // For audit agent
  recommendation: "DISTRUST_REVIEWS"
}
```

**Quick Check (no API):**
```javascript
quickDiscrepancyCheck(reviewData)
// Flags: "CRITICAL: BBB F rating vs high Google rating"
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    COLLECTION PHASE                          │
├─────────────────────────────────────────────────────────────┤
│  batch_collect.js                                            │
│       │                                                      │
│       ▼                                                      │
│  CollectionService.runInitialCollection()                    │
│       │                                                      │
│       ├── Puppeteer scrapes 25 URL sources                   │
│       │      └── BBB, Google Maps, Glassdoor parsed          │
│       │                                                      │
│       ├── TDLR license search (form submission)              │
│       │                                                      │
│       ├── Court record searches (4 counties)                 │
│       │                                                      │
│       ├── API sources (TX Franchise, etc.)                   │
│       │                                                      │
│       └── AI Review Analysis                                 │
│              └── Stored as 'review_analysis' source          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      AUDIT PHASE                             │
├─────────────────────────────────────────────────────────────┤
│  run_audit_v2.js                                             │
│       │                                                      │
│       ▼                                                      │
│  AuditAgentV2.run()                                          │
│       │                                                      │
│       ├── Loads ALL collected data into prompt               │
│       │                                                      │
│       ├── DeepSeek analyzes (can use investigate() tool)     │
│       │                                                      │
│       ├── Returns trust_score, red_flags, reasoning          │
│       │                                                      │
│       └── enforceScoreMultipliers() caps score               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Sources (30 total)

### Tier 1: Reviews
- google_maps, yelp, bbb, angi, houzz, thumbtack, porch, buildzoom, homeadvisor

### Tier 2: Social/News
- facebook, reddit, youtube, nextdoor_search, google_news, local_news

### Tier 3: Employment
- glassdoor, indeed

### Tier 4: Government/Legal
- tdlr (Texas licensing), osha, epa_echo, tx_ag_complaints
- tx_sos_search, tx_franchise
- dallas_court, tarrant_court, collin_court, denton_court

### Special
- review_analysis (AI-generated)

---

## Test Case: Orange Elephant Roofing

### Collected Data
| Source | Status | Key Finding |
|--------|--------|-------------|
| BBB | F rating | 4 locations, all F-rated |
| Google Maps | 4.8★ (35 reviews) | Suspicious |
| Glassdoor | 3.2★ (79 reviews) | Employee issues |
| TDLR | Not found | No license on file |
| Courts | No cases | Clean |
| TX Franchise | Registered | Legitimate LLC |

### Review Analysis
- **Fake Review Score:** 85/100 (HIGH confidence)
- **Discrepancy:** Google 4.8 vs BBB F
- **Recommendation:** DISTRUST_REVIEWS

### Final Audit
- **Trust Score:** 15/100
- **Risk Level:** CRITICAL
- **Recommendation:** AVOID

**Red Flags:**
1. CRITICAL: BBB F rating
2. HIGH: Review manipulation detected
3. HIGH: Unverified TDLR license
4. MEDIUM: Glassdoor 3.2★ employee rating

---

## Commands

```bash
# Activate environment
cd /home/reid/testhome/contractors
source venv/bin/activate  # Python
set -a && . ./.env && set +a  # Load env vars

# Collection
node batch_collect.js --id 1524
node batch_collect.js --id 1524 --force  # Refresh cache

# Audit
node run_audit_v2.js --id 1524

# Test insurance confidence
node test_insurance_confidence.js --name "Company Name" --city "Dallas"

# Django server
python manage.py runserver 8002
```

---

## Files Modified This Session

| File | Changes |
|------|---------|
| `services/collection_service.js` | Added parsers (BBB, Google Maps, Glassdoor), insurance confidence, review analysis integration |
| `services/audit_agent_v2.js` | Added `enforceScoreMultipliers()` |
| `services/review_analyzer.js` | **NEW** - AI review fraud detection |
| `test_insurance_confidence.js` | **NEW** - Test script |

---

## Known Issues / TODO

### Parsing Needed
- [ ] Angi parser (has raw data)
- [ ] Houzz parser (has raw data)
- [ ] Porch parser (has raw data)
- [ ] HomeAdvisor parser

### Collection Issues
- [ ] Yelp blocked (only returns "yelp.com")
- [ ] BBB sometimes times out
- [ ] Court searches rate limited

### Scoring Improvements
- [ ] LLM still scores too high initially (relies on enforcement)
- [ ] Consider deterministic scoring instead of LLM

### Features
- [ ] Actual review text scraping (currently just ratings)
- [ ] Google Places API integration for reviews
- [ ] Permit data integration

---

## Cost Summary

| Operation | Cost |
|-----------|------|
| Audit (DeepSeek) | ~$0.007-0.008 |
| Review Analysis (DeepSeek) | ~$0.0006 |
| Total per contractor | ~$0.008-0.01 |

---

## Key Learnings

1. **LLMs don't follow scoring rubrics strictly** - Need post-processing enforcement
2. **Raw text isn't enough** - Structured parsing catches things LLM misses (BBB F rating)
3. **Platform discrepancies are powerful signals** - Google 4.8 vs BBB F = fake reviews
4. **Quick checks save API costs** - `quickDiscrepancyCheck()` catches obvious issues without AI

---

## Next Steps

1. Run full pipeline on more contractors to validate
2. Add remaining parsers (Angi, Houzz, Porch)
3. Consider scraping actual review text for deeper analysis
4. Build API endpoints for frontend consumption
5. Set up batch processing for 300+ DFW contractors

---

*Generated from Claude Code session on December 5, 2025*
