# Puppeteer to Playwright Migration Plan

## Migration Status: IN PROGRESS
Last Updated: Dec 7, 2025

---

## Why Migrate?

1. **Puppeteer/Pyppeteer is unmaintained** - Playwright was created by the same team to fix Puppeteer's issues
2. **Better Python support** - First-class async/await, auto-waiting
3. **Less flaky** - Built-in auto-waiting reduces race conditions
4. **Banned per project directive** - See BROWSER_AUTOMATION_DIRECTIVE

---

## Migration Summary

| Category | Total Files | Migrated | Remaining |
|----------|-------------|----------|-----------|
| Scrapers | 14 | 4 | 10 (deprecated) |
| Services | 1 | 0 | 1 |
| Scripts | 5 | 0 | 5 |
| Tests | 5 | 0 | 5 |
| **Total** | **25** | **4** | **21** |

---

## COMPLETED Migrations

### Scrapers (Python/Playwright)

| Original (JS) | New (Python) | Status |
|---------------|--------------|--------|
| `scrapers/mgo_connect.js` | `scrapers/mgo_connect.py` | ✅ Tested, Working |
| `scrapers/southlake.js` | `scrapers/energov.py` | ✅ Ready |
| `scrapers/grand_prairie.js` | `scrapers/energov.py` | ✅ Ready |
| `scrapers/fort_worth.js` | `scrapers/accela.py` | ✅ Ready |
| `scrapers/dallas.js` | `scrapers/accela.py` | ✅ Ready |
| `scrapers/richardson.js` | `scrapers/accela.py` | ✅ Ready |

### API-Based (No Browser Needed)
| File | Status |
|------|--------|
| `scrapers/dfw_big4_socrata.py` | ✅ Uses httpx, no Puppeteer |

---

## PENDING Migrations

### Priority 1: Core Services (CRITICAL)

| File | Lines | Purpose | Complexity |
|------|-------|---------|------------|
| `services/collection_service.js` | 958 | Core data collection - BBB, Yelp, Google Maps scraping | HIGH |

**collection_service.js functions to migrate:**
- `collectBBBData()` - BBB profile scraping
- `collectYelpData()` - Yelp reviews scraping
- `collectGoogleData()` - Google Maps scraping (replaces banned API)
- `collectTDLRData()` - TDLR license verification
- `collectSOSData()` - Texas SOS business search
- `collectPermitData()` - Multi-city permit scraping
- `collectCourtRecords()` - Court records search

### Priority 2: Standalone Scripts

| File | Lines | Purpose | Complexity |
|------|-------|---------|------------|
| `scrape_emails_deepseek.js` | 437 | Email extraction from websites | MEDIUM |
| `pull_50_permits.js` | 387 | Batch permit pulling | MEDIUM |
| `pull_southlake_permits.js` | 289 | Southlake-specific permit pull | LOW |
| `collect_southlake_30.js` | 222 | Southlake batch collection | LOW |
| `audit_only.js` | 207 | Audit runner | LOW |

### Priority 3: Legacy Scrapers (Can Delete After Python Versions Verified)

| File | Replacement |
|------|-------------|
| `scrapers/mgo_connect.js` | `mgo_connect.py` |
| `scrapers/southlake.js` | `energov.py` |
| `scrapers/grand_prairie.js` | `energov.py` |
| `scrapers/fort_worth.js` | `accela.py` |
| `scrapers/dallas.js` | `accela.py` |
| `scrapers/richardson.js` | `accela.py` |
| `scrapers/multi_city_test.js` | N/A (test script) |
| `scrapers/mgo_recon*.js` | N/A (debug scripts) |

### Priority 4: Test Files

| File | Purpose |
|------|---------|
| `tests/test_bbb.js` | BBB scraping tests |
| `tests/test_sort.js` | Sort functionality tests |
| `tests/test_all_portals.js` | Portal integration tests |
| `tests/batch_audit_test.js` | Batch audit tests |
| `tests/test_insurance_confidence.js` | Insurance scoring tests |

---

## Migration Pattern

### Puppeteer → Playwright Cheatsheet

| Puppeteer (Node.js) | Playwright (Python) |
|---------------------|---------------------|
| `puppeteer.launch()` | `playwright.chromium.launch()` |
| `browser.newPage()` | `context.new_page()` |
| `page.goto(url)` | `await page.goto(url)` |
| `page.waitForSelector(sel)` | `await page.wait_for_selector(sel)` |
| `page.$(sel)` | `page.query_selector(sel)` |
| `page.$$(sel)` | `page.query_selector_all(sel)` |
| `page.evaluate(() => ...)` | `page.evaluate("() => ...")` |
| `page.click(sel)` | `await page.click(sel)` |
| `page.type(sel, text)` | `await page.fill(sel, text)` |
| `page.waitForTimeout(ms)` | `await asyncio.sleep(ms/1000)` |
| `page.content()` | `await page.content()` |
| `page.screenshot()` | `await page.screenshot()` |

### Key Differences
1. Playwright uses **snake_case** in Python
2. Playwright **auto-waits** by default
3. Use **contexts** for isolation: `browser.new_context()`
4. Use **httpx** instead of Puppeteer for static pages

---

## Recommended Migration Order

### Phase 1: Verify Python Scrapers (Current)
- [x] Test mgo_connect.py with Irving
- [ ] Test energov.py with Southlake
- [ ] Test energov.py with Grand Prairie
- [ ] Test accela.py with Fort Worth

### Phase 2: Migrate Core Service
- [ ] Create `services/collection_service.py`
- [ ] Migrate BBB scraping
- [ ] Migrate Yelp scraping
- [ ] Migrate Google Maps scraping
- [ ] Migrate TDLR lookup
- [ ] Migrate SOS lookup
- [ ] Migrate permit collection
- [ ] Migrate court records

### Phase 3: Migrate Scripts
- [ ] Create `scrape_emails.py`
- [ ] Create `pull_permits.py` (consolidate multiple scripts)
- [ ] Create `audit.py`

### Phase 4: Migrate Tests
- [ ] Create Python test equivalents using pytest

### Phase 5: Cleanup
- [ ] Delete deprecated .js files
- [ ] Update all documentation
- [ ] Remove puppeteer from package.json

---

## Files to DELETE After Migration

Once Python versions are verified working:

```bash
# Legacy scrapers (replaced by Python)
rm scrapers/mgo_connect.js
rm scrapers/southlake.js
rm scrapers/grand_prairie.js
rm scrapers/fort_worth.js
rm scrapers/dallas.js
rm scrapers/richardson.js
rm scrapers/multi_city_test.js
rm scrapers/mgo_recon*.js
rm scrapers/mgo_debug.js
rm scrapers/mgo_check_signup.js

# Legacy scripts (after Python migration)
rm pull_50_permits.js
rm pull_southlake_permits.js
rm collect_southlake_30.js
rm audit_only.js
rm scrape_emails_deepseek.js

# Legacy service (after Python migration)
rm services/collection_service.js
```

---

## New Python File Structure

```
scrapers/
├── mgo_connect.py      # MGO Connect (Irving, Lewisville, etc.)
├── energov.py          # EnerGov (Southlake, Grand Prairie, etc.)
├── accela.py           # Accela (Fort Worth, Dallas, etc.)
├── dfw_big4_socrata.py # Socrata/ArcGIS API (Arlington)
└── README.md

services/
├── collection_service.py  # NEW - Core collection service
└── ...

scripts/
├── scrape_emails.py    # NEW - Email scraper
├── pull_permits.py     # NEW - Consolidated permit puller
└── audit.py            # NEW - Audit runner
```

---

## Dependencies

### Python (requirements.txt additions)
```
playwright>=1.40.0
playwright-stealth>=2.0.0
httpx>=0.25.0
beautifulsoup4>=4.12.0
```

### Install Playwright browsers
```bash
playwright install chromium
```
