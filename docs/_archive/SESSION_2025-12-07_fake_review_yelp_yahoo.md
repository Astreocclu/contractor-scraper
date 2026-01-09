# Session Log: Fake Review Detection & Yelp Yahoo Workaround

**Date:** 2025-12-07
**Engineer:** Claude (Opus 4.5)
**Status:** Yelp Yahoo workaround implemented and working

---

## TL;DR

- **Yelp ratings now extractable** via Yahoo Search (bypasses DataDome)
- Orange Elephant: **1.9★ (10 reviews)** - confirmed working
- Added `--yahoo` flag to `scrapers/yelp.py`
- Updated `collection_service.js` with Trustpilot, yelp_yahoo sources
- Updated `review_analyzer.js` to check all rating sources

---

## Problem Statement

Yelp uses DataDome anti-bot protection that blocks all automated access:
- Direct scraping → CAPTCHA
- DuckDuckGo HTML → "Select the duck" CAPTCHA (new as of Dec 2025)
- Ecosia → Cloudflare challenge
- Bing → Empty results
- Google → CAPTCHA

User reported seeing Yelp ratings in Yahoo Search results visually:
```
Orange Elephant Roofing & Construction - Yelp
1.9/5 (10)
Latitude: 32.738375
Phone: (817) 341-9590
```

---

## Solution: Yahoo Search with Playwright

Yahoo Search shows Yelp rich snippets with rating when rendered with JavaScript. Key findings:

1. **Headless Chromium works** with stealth settings
2. **Rating format:** `X.X/5 (N)` - regex: `(\d\.\d)/5\s*\((\d+)\)`
3. **Not all businesses show rating** - Yahoo only displays it for some listings

### Working Code

```python
# scrapers/yelp.py - new function
async def scrape_yelp_via_yahoo(business_name, location, use_cache=True, headless=True):
    """Get Yelp rating via Yahoo Search (bypasses DataDome)"""

    browser = await p.chromium.launch(
        headless=headless,
        args=["--disable-blink-features=AutomationControlled"]
    )
    context = await browser.new_context(
        viewport={"width": 1920, "height": 1080},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36..."
    )
    page = await context.new_page()
    await page.add_init_script("delete Object.getPrototypeOf(navigator).webdriver")

    await page.goto(f"https://search.yahoo.com/search?p={query}")
    await asyncio.sleep(3)

    body = await page.inner_text("body")
    ratings = re.findall(r'(\d\.\d)/5\s*\((\d+)\)', body)
    # Returns: [('1.9', '10')]
```

### Test Results

```bash
$ python scrapers/yelp.py "Orange Elephant Roofing" "Fort Worth, TX" --yahoo --no-cache

[Yelp/Yahoo] Searching for: Orange Elephant Roofing in Fort Worth, TX
[Yelp/Yahoo] Found: 1.9/5 (10 reviews)

==================================================
YELP: Orange Elephant Roofing
Source: yahoo_yelp
==================================================
Found: True
Name: Orange Elephant Roofing
Rating: 1.9
Reviews: 10
URL: https://www.yelp.com/biz/orange-elephant-roofing-and-construction-willow-park
```

---

## Files Modified

### 1. `scrapers/yelp.py`

Added two new functions:

```python
async def scrape_yelp_via_yahoo(...)     # Yahoo Search fallback
async def scrape_yelp_with_fallback(...) # Try direct Yelp, fall back to Yahoo
```

New CLI flags:
- `--yahoo` - Use Yahoo Search only
- `--with-fallback` - Try direct Yelp, fall back to Yahoo if blocked

### 2. `services/collection_service.js`

Added sources:
```javascript
yelp_yahoo: { ttl: 86400, tier: 1, type: 'scraper' },  // Yahoo fallback
trustpilot: { ttl: 86400, tier: 1, type: 'url' },      // Trustpilot reviews
```

Added URL:
```javascript
trustpilot: `https://www.trustpilot.com/search?query=${encodedName}`,
```

### 3. `services/review_analyzer.js`

Added rating checks for:
```javascript
if (reviewData.yelp_yahoo?.rating) { ... }
if (reviewData.trustpilot?.rating) { ... }
if (reviewData.angi?.rating) { ... }
if (reviewData.houzz?.rating) { ... }
```

### 4. `docs/FAKE_REVIEW_DETECTION_SUMMARY.md`

Major update with:
- SERP workaround reality check (what works/doesn't)
- Review count thresholds (20 minimum for pattern detection)
- Complete source inventory table
- Updated TODOs with priorities

---

## Current Review Source Status

### Fully Working (Have Scrapers)

| Source | File | Rating | Reviews | Notes |
|--------|------|--------|---------|-------|
| Google Maps | `scrapers/google_maps.py` | ✅ | ✅ (max 20) | Primary source |
| BBB | `scrapers/bbb.py` | ✅ A-F | Complaints | Letter grade |
| Yelp (Yahoo) | `scrapers/yelp.py --yahoo` | ✅ | Count only | **NEW** |
| TDLR | `scrapers/tdlr.py` | License | - | TX licenses |

### Configured but URL-only (Need Scrapers)

| Source | URL in collection_service.js | Priority |
|--------|------------------------------|----------|
| Trustpilot | ✅ Added | Medium |
| Angi | ✅ Exists | High - has ratings |
| Houzz | ✅ Exists | Medium |
| Glassdoor | ✅ Exists | Low - employee reviews |
| Porch | ✅ Exists | Low |
| HomeAdvisor | ✅ Exists | Low |

### Blocked

| Source | Issue |
|--------|-------|
| Yelp (direct) | DataDome CAPTCHA |
| Facebook | Login wall |
| Nextdoor | Login wall |
| DuckDuckGo | "Select the duck" CAPTCHA |

---

## Next Steps for Engineer

### P0: Quick Wins

1. **Wire Yahoo Yelp into collection pipeline**
   - Call `scrape_yelp_via_yahoo()` from `collection_service.js`
   - Store result as `yelp_yahoo` source
   - Already configured in SOURCES, just needs the scraper call

2. **Increase Google review limit**
   ```python
   # scrapers/google_maps.py - change default
   async def scrape_business(..., max_reviews: int = 20)  # was 5
   ```

3. **Add review count threshold**
   - Flag `INSUFFICIENT_REVIEWS` if < 20 total reviews
   - Skip fake detection for low-data contractors

### P1: Medium Priority

4. **Add Angi scraper**
   - Angi shows ratings in search results (3.3/5 for Orange Elephant)
   - Could use similar Yahoo/Brave approach if blocked

5. **Add HQ location lookup**
   - Orange Elephant HQ (Elmhurst IL) has 191 reviews vs 1 in Fort Worth
   - Search Google Maps for HQ specifically

### P2: Future

6. **Trustpilot scraper** - URL configured, needs implementation
7. **Houzz scraper** - URL configured, needs implementation

---

## Key Test Cases

### Orange Elephant Roofing (ID: 1524)
- **Known fraud** - BBB F rating, lawsuits, 350+ victims
- Google: 4.3-5.0★ (varies by location)
- Yelp: **1.9★ (10 reviews)** ← Now detectable!
- Expected score: ~15 CRITICAL

### Berkeys Plumbing
- **Legitimate contractor** - BBB A+, established
- Google: ~4.8★
- Yelp: URL found but no rating in Yahoo snippet
- Expected score: 70+ SILVER/GOLD

---

## Commands Reference

```bash
# Activate environment
source venv/bin/activate && set -a && . ./.env && set +a

# Test Yelp Yahoo scraper
python scrapers/yelp.py "Orange Elephant Roofing" "Fort Worth, TX" --yahoo
python scrapers/yelp.py "Berkeys Plumbing" "Southlake, TX" --with-fallback

# Run full audit
node run_audit.js --id 1524

# Test BBB scraper
python scrapers/bbb.py "Orange Elephant Roofing" "Fort Worth" "TX"

# Test Google Maps scraper
python scrapers/google_maps.py "Orange Elephant Roofing" "Fort Worth, TX" --max-reviews 20
```

---

## Technical Notes

### Why Yahoo Works

1. Yahoo Search renders Yelp rich snippets server-side
2. Rating appears in `X.X/5 (N)` format in page text
3. Playwright with stealth settings bypasses bot detection
4. Key settings:
   - `--disable-blink-features=AutomationControlled`
   - Remove `navigator.webdriver` property
   - Real viewport size (1920x1080)
   - Real user agent string

### Why Other SERPs Don't Work

- **DuckDuckGo HTML:** Added "select the duck" image CAPTCHA (Dec 2025)
- **Brave:** Works for URL but not rating in snippets; blocks headless
- **Bing:** Returns empty results for automated requests
- **Google:** CAPTCHA for all automated requests

### Rate Limiting

Yahoo has rate limiting. The `rate_limiter.acquire("search.yahoo.com")` call in the scraper should prevent 429 errors. If issues occur, increase delay between requests.

---

## Related Documentation

- `docs/FAKE_REVIEW_DETECTION_SUMMARY.md` - Full fake review detection spec
- `docs/FAKE_REVIEW_DETECTION_PLAN.md` - Original planning doc
- `scrapers/README.md` - Scraper overview
- `CLAUDE.md` - Project instructions

---

## Questions for Next Engineer

1. Should we call Yahoo Yelp automatically for every contractor, or only as fallback?
2. Threshold for "insufficient reviews" - is 20 the right number?
3. Priority on Angi/Trustpilot scrapers vs other work?
