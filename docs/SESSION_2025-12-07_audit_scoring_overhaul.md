# Session Log: Audit Scoring Overhaul
**Date:** 2025-12-07
**Focus:** Fix false negatives in Trust Score system, add new review sources

---

## Summary

Overhauled the contractor audit scoring system to eliminate false negatives caused by:
1. Texas-only license verification (TDLR) penalizing out-of-state contractors
2. Treating missing data as red flags
3. Not aggregating review counts across locations
4. Flagging normal Glassdoor vs Google gaps as "discrepancies"

Also added SERP-based scrapers for Angi, Trustpilot, and Houzz to detect rating conflicts.

---

## Key Results

| Contractor | Before | After | Issue Fixed |
|------------|--------|-------|-------------|
| Orange Elephant Roofing | 5 | 11 | Still AVOID (real red flags) |
| SPF Screens & Awnings | 42 | 92 | Was penalized for missing FL license |
| Shade Doctor | 9 | 32 | Real rating conflicts remain |
| Southwest Shade Solutions | 37 | 82 | Was penalized for missing data |
| American Security Screens | 36 | 35 | Real rating conflicts remain |

---

## Files Modified

### 1. `services/audit_agent.js`
**Changes:**
- Removed `tdlr` from tool enum
- Removed `license_issue` from red flag categories
- Added "REVIEW COUNT RULES" - aggregate across locations
- Added "NORMAL PATTERNS" section (Glassdoor vs Google is expected)
- Added "SCORING MINDSET" with positive framing
- Changed baseline: 50+ reviews at 4.8+ = 90+ score

**Key prompt changes (positive framing):**
```
Before: "Do not penalize for gaps"
After:  "Require EVIDENCE to deduct points"

Before: "NOT RED FLAGS: Glassdoor vs Google gap"
After:  "NORMAL PATTERNS: Glassdoor 3.4 with Google 5.0 is expected"
```

### 2. `services/audit_agent_v2.js`
- Removed TDLR licensing section entirely

### 3. `services/collection_service.js`
**Removed:**
- TDLR collection from `runInitialCollection()`
- TDLR from `fetchSpecificSource()`
- TDLR from `SOURCES` config
- TDLR from `calculateInsuranceConfidence()`

**Added:**
- `scrapeYelpYahooPython()` - Yelp rating via Yahoo Search
- `scrapeSerpRatingPython()` - Generic SERP scraper for any site
- Wired Angi, Trustpilot, Houzz into collection pipeline
- Added `yelp_yahoo`, `angi`, `trustpilot`, `houzz` to review sources list
- Increased Google Maps review limit from 5 → 20

### 4. `services/review_analyzer.js`
- Fixed `INSUFFICIENT_REVIEWS` to use MAX of Google locations (not sum)
- Added Angi, Trustpilot, Houzz to total review count

### 5. `scrapers/serp_rating.py` (NEW)
Generic SERP rating scraper that extracts ratings from Yahoo Search snippets.
Bypasses anti-bot protection on Angi, Trustpilot, Houzz.

```bash
python scrapers/serp_rating.py "Company Name" "City, TX" --site angi.com
python scrapers/serp_rating.py "Company Name" "City, TX" --site trustpilot.com
python scrapers/serp_rating.py "Company Name" "City, TX" --site houzz.com
```

### 6. `services/orchestrator.js`
- Fixed temporary contractor INSERT to include all NOT NULL fields

---

## Architecture Decisions

### Why TDLR was removed
1. Texas-only - penalizes FL, AZ, etc. contractors
2. Many DFW trades don't require TDLR (pools, patios, screens, fences)
3. Search often fails or returns nothing
4. "Not found" was treated as red flag, creating false negatives

### Why SERP scraping for Angi/Trustpilot/Houzz
1. Direct scraping blocked by DataDome/Cloudflare
2. Yahoo Search snippets show ratings (e.g., "4.7/5 (281 reviews)")
3. Only need rating + count for discrepancy detection
4. Implemented same pattern as Yelp Yahoo workaround

### Scoring philosophy change
**Before:** Pessimistic - start low, penalize for gaps
**After:** Optimistic - start at baseline for review quality, require evidence to deduct

```
BASELINE SCORING:
- 70: Any established business with reviews
- 80: 4.5+ rating with 20+ reviews
- 90: 4.8+ rating with 50+ reviews, consistent across platforms

Only deduct for EVIDENCE of problems, not missing data.
```

---

## Collection Pipeline Flow

```
runInitialCollection():
  1. URL batch (news, social, regulatory)
  2. BBB (Python scraper)
  3. Google Maps x3 locations (Python, 20 reviews each)
  4. Yelp Yahoo (Python)
  5. Angi, Trustpilot, Houzz (SERP Python)  ← NEW
  6. Court records (Puppeteer)
  7. APIs (TX Franchise, etc.)

  8. Filter to review sources → analyzeReviews() [DeepSeek]

audit_agent.js:
  9. DeepSeek audits ALL data → Trust Score
```

---

## Rating Conflict Detection

The system now catches major discrepancies:

| Contractor | Google | Trustpilot | Angi | Conflict? |
|------------|--------|------------|------|-----------|
| Orange Elephant | 4.8★ | 1.5★ | 4.7★ | YES - fake reviews |
| SPF Screens | 5.0★ | - | - | No data, neutral |
| Shade Doctor | 2.9★ | 1.7★ | 4.8★ | YES - fake reviews |
| Southwest Shade | 4.7★ | 2.6★ (wrong co) | - | Agent detected error |

---

## Outstanding Issues / Next Steps

### P0 - Should fix
1. **Trustpilot SERP pulls wrong companies** - "Southwest Shade Solutions" matched "southwestpestsolutions.com". Need stricter name matching or verification step.

2. **Houzz ratings not extracting** - URL found but rating/count not in Yahoo snippets. May need different search pattern.

### P1 - Nice to have
3. **Florida license verification** - Add FL DBPR scraper for FL contractors
4. **Multi-state support** - Detect contractor state and use appropriate license API
5. **Review text analysis** - SERP only gets rating/count, not actual review text for fake detection

### P2 - Future
6. **Angi direct scraping** - If SERP stops working, need proxy/API solution
7. **BBB rating letter parsing** - Currently gets A+/F but not always reliably

---

## Test Commands

```bash
# Activate environment
source venv/bin/activate && set -a && source .env && set +a

# Run audit
node run_audit.js --name "Company Name" --city "Dallas" --state "TX"

# Skip collection (use cached data)
node run_audit.js --name "Company Name" --city "Dallas" --state "TX" --skip-collection

# Test SERP scraper directly
python scrapers/serp_rating.py "Orange Elephant Roofing" "Fort Worth, TX" --site trustpilot.com

# Test Yelp Yahoo scraper
python scrapers/yelp.py "Company Name" "City, TX" --yahoo
```

---

## Key Learnings

1. **Positive framing in prompts works better** - "Reward what you CAN verify" beats "Don't penalize gaps"

2. **Aggregate metrics across locations** - Multi-location businesses should sum reviews

3. **Employee vs customer reviews are different** - Glassdoor 3.4 with Google 5.0 is normal, not suspicious

4. **Missing data ≠ failed verification** - Treat absence as neutral, not negative

5. **SERP scraping bypasses anti-bot** - Yahoo/Brave search results expose ratings without visiting blocked sites
