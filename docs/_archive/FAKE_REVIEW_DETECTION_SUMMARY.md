# Fake Review Detection - Engineering Summary

**Date:** 2025-12-07
**Status:** Partially implemented, needs completion

---

## TL;DR

Detect fake/inflated Google reviews by comparing ratings across platforms and analyzing review content. AI-only approach using DeepSeek. Already wired into collection pipeline.

---

## Current State

### What's Working
- `services/review_analyzer.js` - DeepSeek analyzes reviews for fake signals
- Runs automatically in `collection_service.js:938-1002` during data collection
- Returns `fake_review_score` (0-100), `complaint_patterns`, `recommendation`

### What's Not Working
- Yelp scraping blocked (DataDome CAPTCHA)
- Only scraping 5-7 Google reviews (need 20)

---

## Key Finding: Orange Elephant Test Case

| Location | Google Rating | Reviews | BBB |
|----------|---------------|---------|-----|
| Fort Worth | 5.0★ | 1 | F |
| Dallas | 4.8★ | 35 | F |
| Elmhurst IL (HQ) | 4.3★ | 191 | F |

**Verdict:** BBB F + Google 4.3+ = mathematically impossible without fake reviews. Self-reviews and storm chaser language detected.

---

## TODO for Next Engineer

### 1. Increase Google Review Limit
```python
# In scrapers/google_maps.py, change default max_reviews from 5 to 20
# Focus on HQ location for deeper analysis
```

### 2. Add Yelp Existence Check via Search Engines
```bash
# These work with curl (no CAPTCHA):
curl -s "https://html.duckduckgo.com/html/?q=BUSINESS+NAME+CITY+yelp" | grep -oE 'yelp\.com/biz/[^"&]+'

# Rotate through: DuckDuckGo, Bing, Yahoo, Brave, Ecosia
# If no Yelp URL found = suspicious (ghost profile)
```

### 3. Extract Yelp Ratings (Unsolved)
User reports seeing star ratings in search results visually. Likely in:
- Structured data (JSON-LD)
- Aria-labels
- SVG/image alt text

Need to investigate further.

---

## Architecture Decision

**AI-only approach** (no code-based scoring). Rationale:
- Simpler to maintain
- DeepSeek already catches patterns well
- Add code checks later only if AI consistently misses obvious fraud

---

## Files Reference

| File | What It Does |
|------|--------------|
| `services/review_analyzer.js` | DeepSeek prompt + API call |
| `services/collection_service.js` | Calls analyzer at line 938 |
| `scrapers/google_maps.py` | Playwright scraper for GMaps |
| `scrapers/yelp.py` | Blocked, needs API |

---

## Test Command

```bash
# Run full audit on Orange Elephant (ID: 1524)
node run_audit.js --id 1524
```

---

## Deep Dive: Implementation Status

### Review Analyzer (`services/review_analyzer.js`)

**Status: Strong**

- Uses `deepseek-reasoner` model for sophisticated analysis
- Aggregates data from multiple sources (Google, BBB, Glassdoor, Yelp)
- `quickDiscrepancyCheck()` provides heuristic fallback (BBB F vs Google 4.8★)
- Returns structured data: `fake_review_score`, `complaint_patterns`, `recommendation`

**Data Flow** (from `collection_service.js:938-1002`):
1. Collects review data from all sources
2. Runs quick discrepancy check (no API needed)
3. If 2+ sources available, runs full AI analysis
4. Logs findings with severity levels (60+ = 🚨, 30-60 = ⚠️)

### Google Maps Scraper (`scrapers/google_maps.py`)

**Status: Functional but Limited**

- Playwright-based scraping works
- Clever DeepSeek fallback for HTML parsing
- **Problem:** Defaults to `max_reviews=5` — insufficient for burst pattern detection

### Yelp Scraper (`scrapers/yelp.py`)

**Status: Blocked**

- DataDome CAPTCHA blocks all requests
- Code exists but returns errors in production
- Requires residential proxies or API alternative

---

## Gap Analysis

| Gap | Impact | Solution | Status |
|-----|--------|----------|--------|
| Only 5 Google reviews | Can't detect burst patterns | Increase to 20 | **TODO** |
| No Yelp rating | Missing cross-platform comparison | Use Angi as proxy | **Workaround** |
| No Yelp profile check | Missing ghost company detection | Brave Search | **Ready to implement** |
| Review summaries only | Can't detect stylistic similarities | Pass full review text | **TODO** |
| No review count threshold | Low-data analysis misleading | Flag `INSUFFICIENT_REVIEWS` if <20 | **Ready to implement** |

---

## SERP Workaround for Yelp (Tested Dec 2025)

### What Works

**Brave Search** is the only reliable SERP that returns Yelp data without CAPTCHA:
- ✅ Yelp profile URL
- ✅ Review count (from title: "349 Reviews")
- ❌ Star rating (NOT in snippets)

**Blocked:**
- DuckDuckGo HTML — Now shows "select the duck" CAPTCHA
- Ecosia — Cloudflare challenge
- Google — CAPTCHA for automated requests
- Bing — Empty results
- Direct Yelp — DataDome blocks everything

### What We CAN Extract

```python
# From Brave Search, we can reliably get:
{
    "found": True,
    "url": "yelp.com/biz/berkeys-air-conditioning-plumbing-and-electrical-southlake-4",
    "review_count": 349,  # From title "349 Reviews"
    "rating": None        # NOT AVAILABLE via SERP
}
```

### Implementation

```python
# scrapers/yelp.py - Brave Search workaround

import httpx
import re
from urllib.parse import quote_plus

async def check_yelp_via_brave(business_name: str, city: str) -> dict:
    """Check for Yelp listing via Brave Search (only reliable SERP)"""

    query = quote_plus(f"{business_name} {city} yelp")
    url = f"https://search.brave.com/search?q={query}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url, headers=headers, timeout=15)
            html = resp.text

            # Extract Yelp URLs
            yelp_urls = list(set(re.findall(r'yelp\.com/biz/([^"&\s<>]+)', html)))

            # Extract review counts from titles like "349 Reviews"
            review_counts = re.findall(r'(\d+)\s*Reviews', html)

            if yelp_urls:
                return {
                    "found": True,
                    "url": f"https://www.yelp.com/biz/{yelp_urls[0]}",
                    "review_count": int(review_counts[0]) if review_counts else None,
                    "rating": None,  # Cannot extract from SERP
                    "source": "brave_search"
                }

        except Exception as e:
            pass

    return {
        "found": False,
        "suspicious": True,
        "reason": "No Yelp profile found via SERP"
    }
```

### Rating Workaround: Use Angi/HomeAdvisor

Since Yelp star ratings can't be extracted, use **Angi** ratings as a secondary signal:
- Orange Elephant: **3.3/5 on Angi** (confirms suspicions)
- Berkeys: **4.7/5 on Angi** (aligns with A+ BBB)

Angi ratings often correlate with Yelp and provide the comparison data we need.

---

## Review Count Thresholds

### Minimum Reviews for Analysis

**20 reviews** is the minimum threshold for meaningful fake review detection.

| Reviews | Flag | Reason |
|---------|------|--------|
| < 20 | `INSUFFICIENT_REVIEWS` | Can't detect patterns, burst behavior, or statistical anomalies |
| 20-50 | `LIMITED_DATA` | Basic analysis possible, lower confidence |
| 50+ | `ADEQUATE_DATA` | Full pattern detection enabled |

### Implementation

```javascript
// In services/review_analyzer.js

function assessDataQuality(reviewData) {
    const googleReviews = reviewData.google_maps?.review_count || 0;
    const googleHQReviews = reviewData.google_maps_hq?.review_count || 0;
    const totalGoogle = Math.max(googleReviews, googleHQReviews);

    if (totalGoogle < 20) {
        return {
            flag: 'INSUFFICIENT_REVIEWS',
            confidence: 'very_low',
            message: `Only ${totalGoogle} Google reviews found. Need 20+ for pattern detection.`,
            can_detect_fakes: false
        };
    }

    if (totalGoogle < 50) {
        return {
            flag: 'LIMITED_DATA',
            confidence: 'low',
            message: `${totalGoogle} reviews available. Analysis possible with reduced confidence.`,
            can_detect_fakes: true
        };
    }

    return {
        flag: 'ADEQUATE_DATA',
        confidence: 'high',
        message: `${totalGoogle} reviews. Full pattern analysis enabled.`,
        can_detect_fakes: true
    };
}
```

### Where to Check Reviews

1. **Local branch** (e.g., Fort Worth location)
2. **HQ location** (e.g., Elmhurst IL for Orange Elephant)
3. **Use the higher count** — HQ often has 10x more reviews

---

## Updated TODO (Priority Order)

### P0: Quick Wins (< 1 hour each)

1. **Increase Google review limit**
   ```python
   # scrapers/google_maps.py - change default
   async def scrape_business(..., max_reviews: int = 20)  # was 5
   ```

2. **Add review count threshold check**
   - Flag `INSUFFICIENT_REVIEWS` if < 20
   - Return early with low-confidence score
   - Add to `review_analyzer.js`

3. **Add Brave Search Yelp check**
   - Implement `check_yelp_via_brave()` above
   - Returns profile existence + review count (no rating)

### P1: Medium Effort (2-4 hours)

4. **Add HQ location lookup**
   - Search Google Maps for company HQ (often has more reviews)
   - Orange Elephant: Elmhurst IL = 191 reviews vs Fort Worth = 1

5. **Pass full review text to analyzer**
   - Currently only passing summaries
   - Full text enables stylistic similarity detection
   - Update `collection_service.js:942-957`

### P2: Future Enhancements

6. **Review timing analysis**
   - Detect "burst patterns" (10 reviews in one day)
   - Flag review swapping rings

7. **Add Angi scraper for ratings**
   - Angi shows ratings in search results
   - Use as Yelp rating proxy

---

## Detection Signals (AI + Heuristic)

### Heuristic (Code-based)

| Signal | Rule | Severity |
|--------|------|----------|
| BBB F + Google 4.5+ | Mathematically suspicious | CRITICAL |
| No Yelp profile | Ghost profile detection | MODERATE |
| Google-only presence | No cross-platform validation | LOW |
| All 5-star reviews | Statistically improbable | MODERATE |

### AI-detected (DeepSeek)

| Signal | What to Look For |
|--------|-----------------|
| Burst patterns | Many reviews in short timeframe |
| Self-reviews | Owner/employee language patterns |
| Storm chaser language | "Insurance work", "emergency response" |
| Stylistic similarity | Same phrases across reviews |
| Generic praise | "Best ever!", "Highly recommend!" without specifics |

---

## Review Source Inventory (Dec 2025)

### Fully Working

| Source | Scraper | Has Rating | Has Reviews | Notes |
|--------|---------|------------|-------------|-------|
| **Google Maps** | `scrapers/google_maps.py` | ✅ Yes | ✅ Yes (max 20) | Primary source |
| **BBB** | `scrapers/bbb.py` | ✅ Letter grade | ❌ Complaints only | A-F rating |
| **Yelp (Yahoo)** | `scrapers/yelp.py --yahoo` | ✅ Yes | ✅ Count only | **NEW** - bypasses DataDome |

### Configured but URL-only (No dedicated scraper)

| Source | URL Pattern | Needs Scraper |
|--------|-------------|---------------|
| **Trustpilot** | `trustpilot.com/search?query=` | Yes |
| **Angi** | `angi.com/search?query=` | Yes |
| **Houzz** | `houzz.com/search/professionals/` | Yes |
| **Glassdoor** | `glassdoor.com/Search/results.htm` | Partial |
| **Porch** | `porch.com/search/contractors` | Yes |
| **HomeAdvisor** | `homeadvisor.com/rated.` | Yes |

### Blocked/Not Working

| Source | Issue |
|--------|-------|
| **Yelp (direct)** | DataDome CAPTCHA - use Yahoo fallback |
| **Facebook** | Login wall |
| **Nextdoor** | Login wall |

### Usage in Review Analyzer

The `review_analyzer.js` now checks for ratings from:
- `google_maps` / `google_maps_local` / `google_maps_hq`
- `bbb`
- `glassdoor`
- `yelp` / `yelp_yahoo`
- `trustpilot`
- `angi`
- `houzz`

---

## Contact

See `docs/chat_log_2025-12-07_fake_review_detection.md` for full session details.
