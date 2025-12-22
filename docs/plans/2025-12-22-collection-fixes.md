# Collection System Fixes - Implementation Plan

**Date:** 2025-12-22  
**Status:** Ready for implementation  
**Confidence:** 95%

---

## Overview

Fix 3 collection issues:
1. **TDLR** - Skip for non-licensed trades (pools, patios)
2. **Tarrant Court** - Fix broken URL
3. **Google Maps Reviews** - Use browser-use + DeepSeek for robust extraction

---

## Task 1: Category-Conditional TDLR

### 1.1 Add Database Column

**File:** New migration or direct SQL

```sql
ALTER TABLE contractors_contractor 
ADD COLUMN IF NOT EXISTS category VARCHAR(50);

COMMENT ON COLUMN contractors_contractor.category IS 
'Trade category: Pool, Patio, Screen, HVAC, Electrical, Roofing, etc.';
```

**Verification:**
```bash
psql "$DATABASE_URL" -c "\d contractors_contractor" | grep category
# Expected: category | character varying(50)
```

### 1.2 Update Collection Service

**File:** `services/collection_service.js`

**Location:** Inside `runInitialCollection()`, before TDLR fetch (~line 1400)

**Current code:**
```javascript
// Fetching TDLR (Python scraper)...
log('\n  Fetching TDLR (Python scraper)...');
```

**New code:**
```javascript
// TDLR only required for specific trades in Texas
const TDLR_REQUIRED_TRADES = ['HVAC', 'Electrical', 'AC', 'Air Conditioning', 'Mold'];
const shouldCheckTdlr = contractor.category && 
  TDLR_REQUIRED_TRADES.some(trade => 
    contractor.category.toLowerCase().includes(trade.toLowerCase())
  );

if (shouldCheckTdlr) {
  log('\n  Fetching TDLR (Python scraper)...');
  // ... existing TDLR code
} else {
  log(`\n  Skipping TDLR (not required for ${contractor.category || 'unknown'} trade)`);
  await this.storeRawData(contractorId, 'tdlr', {
    source: 'tdlr',
    status: 'skipped',
    structured: { 
      skipped: true, 
      reason: `TDLR not required for ${contractor.category || 'unspecified'} trade in Texas` 
    }
  });
}
```

**Verification:**
```bash
node bin/batch_collect.js --id 1 --force 2>&1 | grep -i tdlr
# Expected: "Skipping TDLR (not required for Pool trade)"
```

---

## Task 2: Fix Tarrant Court URL

### 2.1 Update Search URL

**File:** `services/collection_service.js`

**Location:** `buildUrls()` function (~line 872)

**Current code:**
```javascript
urls.tarrant_court = `https://www.google.com/search?q=site:apps.tarrantcounty.com+${encodedName}`;
```

**New code:**
```javascript
urls.tarrant_court = `https://www.google.com/search?q=site:odyssey.tarrantcounty.com+${encodedName}`;
```

**Verification:**
```bash
node bin/batch_collect.js --id 1 --force 2>&1 | grep -i tarrant
# Expected: "tarrant_court: Found X results via API"
```

---

## Task 3: Google Maps Review Extraction with browser-use

### 3.1 Install browser-use

```bash
cd /home/reid/command-center/testhome/contractor-auditor
pip install browser-use langchain-openai  # or appropriate provider
```

### 3.2 Create browser-use Review Scraper

**File:** `scrapers/google_maps_browseruse.py` (NEW)

```python
#!/usr/bin/env python3
"""
Google Maps Review Scraper using browser-use + DeepSeek
Uses DOM extraction mode (no vision required)
"""

import asyncio
import json
import sys
from browser_use import Agent
from langchain_openai import ChatOpenAI  # Or DeepSeek provider

async def scrape_reviews(business_name: str, location: str, max_reviews: int = 20):
    """
    Use browser-use to navigate Google Maps and extract reviews.
    Falls back to cached selectors if LLM approach fails.
    """
    
    # Configure LLM (DeepSeek or fallback)
    llm = ChatOpenAI(
        model="deepseek-chat",
        base_url="https://api.deepseek.com/v1",
        api_key=os.environ.get("DEEPSEEK_API_KEY")
    )
    
    task = f"""
    1. Go to Google Maps and search for "{business_name}" in "{location}"
    2. Click on the business listing if it appears in search results
    3. Find and click the "Reviews" tab or button
    4. Scroll down to load at least {max_reviews} reviews
    5. Extract each review with:
       - Review text (full content)
       - Star rating (1-5)
       - Reviewer name
       - Date posted (e.g., "2 months ago")
    6. Return the reviews as a JSON array
    """
    
    agent = Agent(task=task, llm=llm)
    
    try:
        result = await agent.run()
        reviews = parse_reviews_from_result(result)
        return {
            "found": True,
            "reviews": reviews,
            "review_count": len(reviews),
            "source": "browser_use"
        }
    except Exception as e:
        return {
            "found": False,
            "error": str(e),
            "reviews": [],
            "source": "browser_use"
        }

def parse_reviews_from_result(result):
    """Extract structured review data from agent result."""
    # Implementation depends on browser-use output format
    # Typically returns extracted content as text/JSON
    pass

if __name__ == "__main__":
    business = sys.argv[1]
    location = sys.argv[2] if len(sys.argv) > 2 else "Fort Worth, TX"
    max_reviews = int(sys.argv[3]) if len(sys.argv) > 3 else 20
    
    result = asyncio.run(scrape_reviews(business, location, max_reviews))
    print(json.dumps(result, indent=2))
```

### 3.3 Update Collection Service to Use browser-use

**File:** `services/collection_service.js`

**Add new function:**
```javascript
async function scrapeGoogleMapsBrowserUse(businessName, location, maxReviews = 20) {
  return callPythonScraper('google_maps_browseruse.py', [
    businessName, 
    location, 
    String(maxReviews)
  ], 120000);  // 2 min timeout for LLM
}
```

**Update review scraping logic:**
```javascript
// Try browser-use first, fall back to traditional scraper
let gmapsResult;
try {
  gmapsResult = await scrapeGoogleMapsBrowserUse(contractor.name, TARGET_MARKET, 20);
  if (!gmapsResult.found || gmapsResult.reviews.length === 0) {
    throw new Error('browser-use returned no reviews');
  }
  log(`    📋 Google Maps (browser-use): ${gmapsResult.reviews.length} reviews`);
} catch (e) {
  log(`    ⚠️ browser-use failed: ${e.message}, falling back to traditional scraper`);
  gmapsResult = await scrapeGoogleMapsPython(contractor.name, TARGET_MARKET, 20);
}
```

### 3.4 Verification

```bash
# Test browser-use scraper directly
python3 scrapers/google_maps_browseruse.py "Puryear Custom Pools" "Fort Worth, TX" 5

# Expected output:
{
  "found": true,
  "reviews": [
    {"text": "Great pool builder...", "rating": 5, "author": "John D.", "date": "2 months ago"},
    ...
  ],
  "review_count": 5
}

# Test full collection
node bin/batch_collect.js --id 1 --force 2>&1 | grep -i review
# Expected: "Google Maps (browser-use): 20 reviews"
```

---

## Task Order

1. **Task 2 (Tarrant Court)** - 5 min, one-line fix
2. **Task 1 (TDLR)** - 15 min, DB + code change  
3. **Task 3 (Google Maps)** - 45 min, new scraper + integration

---

## Rollback Plan

If browser-use causes issues:
1. Set `USE_BROWSERUSE=false` in .env
2. Collection falls back to existing `google_maps.py` scraper
3. Reviews will be empty but ratings still work

---

## Success Criteria

- [ ] TDLR skipped for Pool/Patio contractors (check logs)
- [ ] Tarrant Court returns results (>0)
- [ ] Google Maps reviews populated (reviews.length > 0)
- [ ] No increase in collection time >30%
- [ ] API costs <$5/day

