# Conversation Log - December 5, 2025

## Session Overview
Working on contractor scraper project. Main accomplishments:
- Added insurance confidence scoring
- Fixed BBB parsing (caught F rating that LLM missed)
- Added score enforcement (LLM was giving 48 for CRITICAL flags, now capped at 15)
- Built AI review analyzer for fake review detection

---

## Key Exchanges

### 1. Initial Task: Insurance Confidence Function
**User provided code for `calculateInsuranceConfidence()`**

Added to `collection_service.js` - calculates 0-9 score based on:
- BBB Accredited (+3)
- Active TDLR license (+2)
- Recent permits (+2)
- Business age 5+ years (+1)
- Website mentions insurance (+1)

### 2. Running First Audit on Orange Elephant

```bash
node batch_collect.js --id 1524
node run_audit_v2.js --id 1524
```

**Initial Result:** Trust Score 48/100 (AVOID)

**Problem Identified:** Score too high for contractor with:
- CRITICAL license issue
- Multiple red flags

### 3. Score Enforcement Fix

**User provided `enforceScoreMultipliers()` function**

Logic:
- CRITICAL flag → cap at 15
- SEVERE/HIGH flag → cap at 35
- MODERATE/MEDIUM flag → cap at 60

**Result after fix:** 48 → 15 (properly capped)

### 4. Discovering BBB F Rating Was Missed

**User asked:** "how did they get to 48, thats pretty high considering how many red flags"

**Investigation:** Checked raw BBB data:
```
Orange Elephant Roofing & Construction, LLC
Roofing Contractors
BBB Rating: F
```

**Problem:** BBB data was collected but:
1. `structured_data` was null (no parsing)
2. LLM saw raw text but missed "BBB Rating: F" buried in noise

### 5. Building BBB Parser

Created `parseBBBResults()` function:
- Matches contractor name near rating
- Filters out ads (A+ rated advertisers were polluting results)
- Takes worst rating if multiple locations
- Conservative accreditation detection

**Test result:**
```json
{
  "found": true,
  "rating": "F",
  "accredited": false,
  "locations_count": 4
}
```

### 6. Adding More Parsers

Added parsers for:
- **Google Maps:** `{ rating: 4.8, review_count: 35 }`
- **Glassdoor:** `{ rating: 3.2, review_count: 79 }`

### 7. AI Review Analysis

**User request:** "add the review analysis...have the ai store its summary on the reviews"

Created `services/review_analyzer.js`:
- Takes review data from multiple platforms
- Calls DeepSeek to analyze for fake patterns
- Stores summary for audit agent

**Orange Elephant analysis:**
```json
{
  "fake_review_score": 85,
  "confidence": "HIGH",
  "discrepancy_detected": true,
  "discrepancy_explanation": "Google 4.8★ vs BBB F rating",
  "fake_signals": [
    "Generic language",
    "No negative reviews despite BBB F",
    "Possible shill accounts"
  ],
  "recommendation": "DISTRUST_REVIEWS"
}
```

### 8. Final Audit Result

After all fixes:

```
Trust Score:    15/100
Risk Level:     CRITICAL
Recommendation: AVOID

RED FLAGS:
- [CRITICAL] BBB F rating
- [HIGH] Review manipulation (85 fake score)
- [HIGH] Unverified TDLR license
- [MEDIUM] Glassdoor 3.2★ employee rating

POSITIVE SIGNALS:
- No court cases found
- Registered with Texas Franchise Tax
```

---

## Code Changes Summary

### services/collection_service.js

**Added imports:**
```javascript
const { analyzeReviews, quickDiscrepancyCheck } = require('./review_analyzer');
```

**Added functions:**
- `parseBBBResults(text, contractorName)` - lines 82-173
- `parseGoogleMapsResults(text, contractorName)` - lines 181-226
- `parseGlassdoorResults(text, contractorName)` - lines 228-272
- `calculateInsuranceConfidence(collectedData)` - lines 586-635

**Modified `runInitialCollection()`:**
- Added parsing calls for BBB, Google Maps, Glassdoor
- Added AI review analysis at end of collection

### services/audit_agent_v2.js

**Added function:**
```javascript
function enforceScoreMultipliers(auditResult) {
  // Caps score based on worst red flag severity
}
```

**Modified `finalizeResult()`:**
```javascript
result = enforceScoreMultipliers(result);
```

### services/review_analyzer.js (NEW)

**Exports:**
- `analyzeReviews(contractorName, reviewData)` - AI analysis
- `quickDiscrepancyCheck(reviewData)` - Fast check without API
- `extractRatings(reviewData)` - Helper

---

## Test Commands Used

```bash
# Load environment
set -a && . ./.env && set +a

# Run collection
node batch_collect.js --id 1524 --force

# Run audit
node run_audit_v2.js --id 1524

# Test insurance confidence
node test_insurance_confidence.js --name "Orange Elephant Roofing" --city "Dallas"

# Check database
node -e "
const initSqlJs = require('sql.js');
const fs = require('fs');
initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync('db.sqlite3'));
  const r = db.exec('SELECT source_name, structured_data FROM contractor_raw_data WHERE contractor_id = 1524');
  console.log(r);
  db.close();
});
"
```

---

## Orange Elephant Final Data

**Contractor ID:** 1524

**Structured Data in DB:**
| Source | Structured Data |
|--------|-----------------|
| bbb | `{"found":true,"rating":"F","accredited":false,"locations_count":4}` |
| google_maps | `{"found":true,"rating":4.8,"review_count":35}` |
| glassdoor | `{"found":true,"rating":3.2,"review_count":79}` |
| review_analysis | `{"fake_review_score":85,"recommendation":"DISTRUST_REVIEWS",...}` |

---

## Issues Encountered

1. **BBB timeout** - Sometimes BBB page doesn't load in 20s
2. **Yelp blocked** - Only returns "yelp.com" (anti-scraping)
3. **Court rate limiting** - Some county searches blocked
4. **TDLR not found** - Orange Elephant has no TDLR license on file

---

## Session Duration
~2 hours of active development

## API Costs
- Audits: ~$0.008 each
- Review analysis: ~$0.0006 each
- Total session: ~$0.05

---

*End of conversation log*
