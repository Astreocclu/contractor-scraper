# Session Log: Batch Audit Results & Scoring Validation
**Date:** 2025-12-08
**Focus:** Validate scoring logic updates from 2025-12-07 overhaul by running 20 contractor audits

---

## Summary

Ran batch audits on contractors 1-20 to validate the scoring logic changes made in the previous session (see `SESSION_2025-12-07_audit_scoring_overhaul.md`). The core scoring logic is working well - rating conflicts are detected, good contractors score high (88-92), and missing data is no longer penalized. However, several issues need fixing.

---

## Batch Results (20 Contractors)

| ID | Score | Recommendation | Key Finding |
|----|-------|----------------|-------------|
| 1 | 85 | Good | BBB A+, 387 reviews |
| 2 | ~high | Recommended | 4.9★ Google, clean |
| 3 | ~high | Recommended | BBB A+, 47 years |
| 4 | ~high | Good | 5.0★ Google, LOW flags only |
| 5 | **56** | VERIFY | **FALSE NEGATIVE** - Trustpilot pulled wrong company |
| 6 | ~low | **SEVERE** | 4.4★ Google vs 1.4★ everywhere - real fake reviews |
| 7 | ~high | Recommended | BBB A+, 4.4★ Google |
| 8 | ~high | Recommended | BBB A+, 4.5★ Google, 4.8★ Yelp |
| 9 | **90** | RECOMMENDED | 4.9★ Google (141), 4.8★ Angi |
| 10 | ~high | RECOMMENDED | 4.6★ Google (478!) |
| 11 | **92** | RECOMMENDED | 4.8★ Google (201), BBB A+ |
| 12 | ~med | MEDIUM flag | Angi 2.8 vs Google 4.4 |
| 13 | **68** | VERIFY | Google 4.5 vs Yelp/Angi ~3.3 |
| 14 | ~low | **CRITICAL** | Review manipulation detected - company self-posting |
| 15 | **88** | RECOMMENDED | Allied Outdoor, 374+ reviews |
| 16 | 72 | Recommended | Minor Yelp discrepancy |
| 17 | ~high | Recommended | 5.0★ Google (69) |
| 18 | **92** | HIGHLY REC | 4.8★ Google (152), BBB A+ |
| 19 | **92** | Recommended | 4.9★ Google, multi-location |
| 20 | ~low | **HIGH flag** | Trustpilot 1.5 vs Google 3-4.5, no TX registration |

---

## What's Working

1. **Rating conflict detection** - Correctly caught:
   - Contractor 6: 4.4★ Google vs 1.4★ on Angi/Houzz/Trustpilot/Yelp
   - Contractor 14: Self-posted reviews detected, company posting as itself
   - Contractor 20: Trustpilot 1.5 vs Google 3-4.5

2. **High scores for good contractors** - 9, 11, 15, 18, 19 all scored 88-92

3. **Glassdoor vs Google gaps NOT penalized** - As intended per the overhaul

4. **Missing BBB treated as neutral** - No false negatives from missing BBB profiles

5. **Agent correctly identifies Trustpilot misattributions** - In reasoning, notes when Trustpilot data appears to be for wrong company (but still penalizes in some cases)

---

## Outstanding Issues (Priority Order)

### P0: Trustpilot SERP Pulling Wrong Companies

**Problem:** The `scrapers/serp_rating.py` Trustpilot scraper frequently returns data for wrong companies. Examples from batch:
- Contractor 3: Trustpilot 2.2 for "patioenclosures.com" (different company)
- Contractor 5: Trustpilot pulled wrong company, caused 56 score (FALSE NEGATIVE)
- Contractor 7: Trustpilot shows "urbanadventurequest.com"
- Contractor 10: Trustpilot points to "Blue Haven"
- Contractor 17: Trustpilot shows "allstarpros.com"
- Contractor 19: Trustpilot shows "allstarpros.com"

**Impact:** Creates false negatives when wrong company has bad rating, or agent wastes time investigating

**Fix needed in:** `scrapers/serp_rating.py`
- Add stricter name matching/verification
- Or: Add domain verification step
- Or: Return confidence score with rating

**Relevant file:** `services/collection_service.js` line ~400 where `scrapeSerpRatingPython()` is called

---

### P1: Local Google Maps Score Prioritization

**Problem:** Agent sometimes uses lower HQ/Listed score instead of local DFW score.

**Example from Contractor 20:**
- Google Maps DFW: 4.5★ (387 reviews)
- Google Maps Listed (Fort Worth): 3.0★ (48 reviews)
- Agent used 3.0★ in scoring calculation

**Expected behavior:** Prioritize local/DFW market score when available, as it represents actual customer experience in the service area.

**Fix needed in:** `services/audit_agent.js` - Update prompt to prioritize local scores, or `services/collection_service.js` - Only return highest-volume Google location

---

### P1: Review Analysis JSON Parse Error

**Problem:** Intermittent JSON parse error during review analysis phase.

**Error from batch:**
```
Review analysis error: JSON parse error: Unexpected token '<', ..."w_score": <0-100>, "... is not valid JSON
```

**Impact:** Review analysis skipped, agent proceeds without fake review detection insights

**Fix needed in:** `services/review_analyzer.js` - DeepSeek response parsing, likely needs better prompt to ensure valid JSON output

---

## Files Modified/Relevant

| File | Purpose |
|------|---------|
| `run_batch.sh` | Script created to run batch audits (can delete) |
| `services/audit_agent.js` | Main audit logic, prompt engineering |
| `services/audit_agent_v2.js` | Score enforcement with multipliers |
| `services/collection_service.js` | Data collection pipeline |
| `services/review_analyzer.js` | Review authenticity analysis |
| `scrapers/serp_rating.py` | SERP-based rating scraper (Trustpilot/Angi/Houzz) |

---

## Test Commands

```bash
# Activate environment
source venv/bin/activate && set -a && source .env && set +a

# Run single audit
node run_audit.js --id 5

# Run audit with skip collection (use cached data)
node run_audit.js --id 5 --skip-collection

# Test SERP scraper directly
python3 scrapers/serp_rating.py "Company Name" "City, TX" --site trustpilot.com

# Run batch (uses run_batch.sh)
./run_batch.sh
```

---

## Recommended Next Steps

1. **Fix Trustpilot matching** - Highest impact, causing false negatives
2. **Fix local score prioritization** - Quick prompt fix in audit_agent.js
3. **Fix JSON parse error** - Improve review_analyzer.js prompt/parsing

---

## Session Stats

- **Duration:** ~95 minutes for 20 audits
- **Average per audit:** ~4-5 minutes
- **API cost range:** $0.016 - $0.032 per audit
- **Total estimated cost:** ~$0.45
