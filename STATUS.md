# Contractor Scraper - Status Report
**Date:** 2025-12-02

---

## Executive Summary

The contractor scraper system is **functionally complete** but producing low trust scores due to missing data sources. The core pipeline works end-to-end, but enrichment services need API keys or alternative approaches.

---

## What's Working

### 1. Project Infrastructure
| Component | Status | Notes |
|-----------|--------|-------|
| Django project | Working | Runs on port 8002 |
| Database | Working | SQLite (PostgreSQL not installed) |
| Models | Working | Vertical, Contractor, ContractorAudit |
| Admin interface | Working | Full CRUD at /admin/ |
| REST API | Working | DRF with pagination |
| Virtual environment | Working | All dependencies installed |

### 2. Google Maps Scraper (Puppeteer)
| Feature | Status | Notes |
|---------|--------|-------|
| Text search | Working | Finds contractors by search terms |
| Place details | Working | Gets phone, website |
| Review fetching | Partial | Puppeteer scraping returns limited reviews |
| Rate limiting | Working | 1.5s delay between requests |
| Deduplication | Working | By business name + city |

**Test Results:**
- Scraped 10 pool enclosure contractors in DFW
- Retrieved business names, addresses, ratings, review counts
- Phone/website populated for most

### 3. AI Auditor (DeepSeek)
| Feature | Status | Notes |
|---------|--------|-------|
| Model connection | Ready | Using deepseek-chat (DeepSeek 3.2) |
| Sentiment analysis | Ready | Returns 0-100 scores |
| Fake review detection | Ready | Counts + indicators |
| Source conflict detection | Ready | Google vs Yelp comparison |
| Red flag detection | Ready | Returns list of concerns |
| Confidence scoring | Ready | high/medium/low based on review volume |

**New Features (DeepSeek upgrade):**
- Detects fake review patterns
- Compares Google vs Yelp sentiment
- Returns confidence level based on data quality
- Weight adjustment recommendations

### 4. Trust Score Calculator (REVISED)
| Feature | Status | Notes |
|---------|--------|-------|
| Score calculation | Working | 52-point system normalized to 0-100 |
| Category breakdown | Working | Verification (12), Reputation (20), Credibility (12), Red Flags (8) |
| Tier system | NEW | Gold (80+), Silver (65+), Bronze (50+), Unranked (<50) |
| Pass threshold | LOWERED | 50 = Bronze tier (was 80) |
| Admin override | Working | Can manually set scores |

**Key Change:** License verification REMOVED - Texas doesn't require licenses for pool enclosures, patio covers, or motorized shades.

### 5. API Endpoints
| Endpoint | Status | Notes |
|----------|--------|-------|
| GET /api/verticals/ | Working | Returns 3 verticals |
| GET /api/contractors/ | Working | Returns passing contractors only |
| GET /api/contractors/?all=true | Working | Returns all contractors |
| GET /api/contractors/stats/ | Working | Returns totals, avg score |
| GET /api/contractors/top/ | Working | Returns top 10 |
| GET /api/contractors/{slug}/ | Working | Returns full detail |

---

## What's NOT Working

### 1. BBB Enrichment
| Issue | Impact | Root Cause |
|-------|--------|------------|
| No BBB data retrieved | -6 to -9 points per contractor | BBB website scraping blocked or name matching failing |

**Details:**
- BBB search returns no results for any contractor
- Likely causes:
  - BBB anti-scraping measures (Cloudflare, rate limiting)
  - Business name variations not matching BBB listings
  - Need to use BBB API instead of scraping

**Missing Points:**
- BBB Rating (A+/A): 2 pts
- BBB Accredited: 4 pts (verification) + 2 pts (bonus)
- Years in Business: 3 pts

### 2. Yelp Enrichment - DISABLED
| Issue | Impact | Root Cause |
|-------|--------|------------|
| Yelp DISABLED | N/A - not factored into scoring | Intentionally disabled until further notice |

**Status:** DISABLED as of 2025-12-08. Yelp data is NOT factored into contractor scoring. Do not penalize contractors for missing Yelp data.

### 3. License Verification
| Issue | Impact | Root Cause |
|-------|--------|------------|
| No license data | -8 points per contractor | Not implemented |

**Details:**
- Texas contractors should be checked against TDLR (Texas Dept of Licensing)
- Would need to scrape or API access to: https://www.tdlr.texas.gov/
- License verification is the single biggest score component

**Missing Points:**
- Active License: 8 pts
- License expiration tracking: not implemented

### 4. Review Volume
| Issue | Impact | Root Cause |
|-------|--------|------------|
| Low review counts | -2 to -3 points | Scraping limitations |

**Details:**
- Puppeteer scraping returns limited reviews per business (Google Places API is BANNED - caused $300 overcharge)
- SerpAPI can get 50+ reviews but requires paid key ($50/mo)
- Most scraped contractors show 0 reviews in our DB despite having reviews on Google

**Missing Points:**
- 100+ reviews: 3 pts
- 50+ reviews: 2 pts

---

## Current Score Breakdown

**Average Contractor Score: 35-48 / 100**

| Category | Max Points | Typical Actual | Why |
|----------|------------|----------------|-----|
| Verification | 15 | 0 | No license/BBB data |
| Reputation | 15 | 6-9 | Only Google rating (no Yelp/BBB) |
| Credibility | 10 | 3-7 | Website/phone + sentiment |
| Red Flags | 7 | 5-7 | Points for absence of issues |
| Bonus | 5 | 0-2 | Low review volume |
| **Total** | **52 (raw)** | **14-25** | |
| **Normalized** | **100** | **31-48** | |

**To reach 80 (passing), a contractor needs:**
- Active license (+8)
- BBB accredited (+4 verification, +2 bonus)
- 5+ years in business (+3)
- Google 4.5+ rating (+6)
- 100+ reviews (+3)
- Yelp 4.0+ rating (+3)
- Good sentiment (+4)
- Website (+2) + Phone (+1)

---

## Improvements Needed

### Priority 1: Critical (Blocking Pass Threshold)

#### 1.1 Implement TDLR License Verification
- Create `contractors/services/license_checker.py`
- Scrape or API to Texas TDLR database
- Match by business name or license number
- Impact: +8 points per licensed contractor

#### 1.3 Fix BBB Enrichment
Options:
1. **Use BBB API** (if available) instead of scraping
2. **Use SerpAPI** for BBB data (`engine: google`, search "business name BBB")
3. **Manual data entry** for key contractors
- Impact: +6 to +9 points per contractor

### Priority 2: High (Score Improvement)

#### 2.1 Add SerpAPI for More Reviews
```bash
# In .env
SERPAPI_KEY=your_key_here
```
- Cost: ~$50/month for 5000 searches
- Gets 50+ reviews vs Google's 5
- Better sentiment analysis with more data

#### 2.2 Lower Pass Threshold
```python
# In contractors/models.py
PASS_THRESHOLD = 60  # Instead of 80
```
- Quick fix to show more contractors
- Consider tiered system: Bronze (60+), Silver (70+), Gold (80+)

#### 2.3 Adjust Scoring Weights
Current scoring heavily penalizes missing BBB/license data. Consider:
- Reducing verification category weight
- Increasing reputation category weight
- Adding points for having a website with SSL

### Priority 3: Medium (Quality of Life)

#### 3.1 PostgreSQL Setup
```bash
sudo apt install postgresql postgresql-contrib
sudo -u postgres createdb contractor_db
# Update .env: DATABASE_URL=postgresql://localhost/contractor_db
```
- Better performance with JSON fields
- Required for production

#### 3.2 Add Logging
- Currently using print statements
- Add proper Django logging to files
- Track API call failures

#### 3.3 Add Insurance Verification
- Check for general liability insurance
- Would add to verification score

### Priority 4: Low (Nice to Have)

#### 4.1 Add More Verticals
- Currently: Pool Enclosures, Patio Covers, Motorized Shades
- Could add: Fencing, Landscaping, HVAC, etc.

#### 4.2 Contractor Claiming System
- Allow contractors to claim their profile
- Verify via phone/email
- +1 bonus point for claimed profiles

#### 4.3 Review Freshness
- Weight recent reviews higher
- Flag contractors with no recent activity

---

## API Keys Status

| Key | Status | Where to Get |
|-----|--------|--------------|
| GOOGLE_PLACES_API_KEY | **BANNED** | DO NOT USE - caused $300 overcharge. Use Puppeteer scraping instead. |
| DEEPSEEK_API_KEY | **READY** | platform.deepseek.com (free 5M tokens) |
| YELP_API_KEY | **DISABLED** | Yelp disabled until further notice |
| SERPAPI_KEY | Optional | serpapi.com ($50/mo) - for more reviews |
| GOOGLE_API_KEY (Gemini) | Legacy | makersuite.google.com - replaced by DeepSeek |

---

## Files Reference

```
/home/reid/testhome/contractors/
├── .env                          # API keys (DEEPSEEK_API_KEY ready, needs YELP_API_KEY)
├── CLAUDE.md                     # Project instructions
├── ERRORS.md                     # Error log
├── STATUS.md                     # This file
├── config/
│   └── settings.py               # Django settings + API key loading
├── contractors/
│   ├── models.py                 # PASS_THRESHOLD = 50, tier field added
│   ├── services/
│   │   ├── google_scraper.py     # Working
│   │   ├── enrichment.py         # BBB scraper + fallback Yelp
│   │   ├── yelp_service.py       # NEW - Improved Yelp API integration
│   │   ├── ai_auditor.py         # UPDATED - Now uses DeepSeek
│   │   ├── scoring.py            # REWRITTEN - No license requirement
│   │   └── deduplication.py      # NEW - Duplicate detection/merge
│   └── management/commands/
│       ├── scrape_contractors.py # Working
│       ├── enrich_contractors.py # UPDATED - Uses new YelpService
│       └── audit_contractors.py  # Working
```

---

## Quick Wins

1. **Lower threshold to 60** - 1 line change, shows more contractors
2. **Add SerpAPI key** - Better reviews, better BBB data

---

## Conclusion

The system architecture is sound and the pipeline works. The low scores are a **data problem**, not a code problem.

**Recommended Next Steps:**
1. Implement TDLR license checker
2. Consider SerpAPI for BBB data
3. Re-run pipeline after fixes

**Note:** Yelp and BBB are currently disabled/blocked - do not factor into scoring.
