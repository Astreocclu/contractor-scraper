# Session Log: Permit Scraper Debugging
**Date:** 2025-12-08
**Engineer:** Claude (handoff document)
**Status:** In Progress - Ready for pickup

---

## Summary

Tested all permit scrapers, identified working vs broken ones, and attempted fixes. **4,994 permits collected from 6 working cities.** Several scrapers need additional work.

---

## Working Scrapers (6 cities, 4,994 permits)

| City | Scraper | File | Permits | Notes |
|------|---------|------|---------|-------|
| Fort Worth | Accela | `scrapers/accela.py` | 1,000 | Stable |
| Dallas | Accela | `scrapers/accela.py` | 1,000 | Stable |
| Keller | EnerGov Tyler CSS | `scrapers/energov.py` | 1,000 | `tyler_css: True` |
| Mesquite | EnerGov Tyler CSS | `scrapers/energov.py` | 1,000 | `tyler_css: True` |
| Irving | MGO Connect | `scrapers/mgo_connect.py` | 399 | Requires login |
| Lewisville | MGO Connect | `scrapers/mgo_connect.py` | 394 | Requires login |

---

## Broken/Incomplete Scrapers

### 1. Frisco (eTRAKiT) - STUCK AT 200
- **File:** `scrapers/etrakit.py`
- **Issue:** Scraper times out trying to paginate beyond 200 permits
- **Debug:** Process hangs, likely stuck on postback pagination
- **Priority:** Medium (200 permits is usable but want 1000)

### 2. Allen (EnerGov) - EXTRACTION BROKEN
- **File:** `scrapers/energov.py`
- **Issue:** DeepSeek returns placeholder data like "PERMIT-2024-12345 | Building | 123 Main St"
- **Root cause:** Page loads but extraction prompt getting wrong HTML or LLM hallucinating
- **Debug screenshot:** `debug_html/allen_results.png`
- **Priority:** Medium

### 3. McKinney & Southlake (Citizen Self Service) - SEARCH NOT EXECUTING
- **File:** `scrapers/citizen_self_service.py` (NEW - created this session)
- **Issue:** Search button click doesn't execute search. Form shows but no results.
- **Screenshots:**
  - `debug_html/mckinney_css_search.png` - Search form (no results)
  - `debug_html/mckinney_css_filtered.png` - Still no results after filter
  - `debug_html/mckinney_results.png` - Shows 2.7M results when manually tested (earlier screenshot)
- **Root cause:** JavaScript click not triggering form submission properly
- **Potential fix:** Try form.submit(), or navigate directly to results URL with query params
- **Data available:** 325,149 permits in McKinney alone!
- **Priority:** HIGH (huge dataset)

### 4. Colleyville - SSL CERTIFICATE BROKEN
- **Issue:** `curl` returns exit code 35 (SSL handshake failure)
- **URL:** `https://energov.cityofcolleyville.com/EnerGov_Prod/SelfService`
- **Root cause:** Server-side SSL configuration issue
- **Priority:** Low (skip until they fix their cert)

### 5. Grand Prairie - MIGRATED FROM ACCELA
- **Old URL:** `https://aca-prod.accela.com/GPTX` (returns 404)
- **New portal:** EnerGov CSS at `https://egov.gptx.org/EnerGov_Prod/SelfService`
- **Fix applied:** Added `grand_prairie_energov` config to `scrapers/energov.py`
- **Status:** Config added, NOT TESTED
- **Priority:** Medium

### 6. Denton & Duncanville (MGO Connect) - ACCESS ISSUES
- **Denton:** NOT available on MGO Connect (city not in dropdown)
- **Duncanville:** Requires contractor license association to search
- **Priority:** Low (need different portal or credentials)

---

## Code Changes Made This Session

### 1. `scrapers/energov.py`
- **Line 239-271:** Fixed sort selector timeout - now checks if dropdown exists first, uses 5s timeout, tries column header fallback
- **Line 180-206:** Added "Search Public Records" link detection for traditional EnerGov portals
- **Line 75-80:** Added `grand_prairie_energov` config

### 2. `scrapers/mgo_connect.py`
- **Line 324-394:** Added jurisdiction selection on search page (not just home page)
- Fixed dropdown selection to actually click options, not just type and press Enter

### 3. `scrapers/citizen_self_service.py` (NEW FILE)
- Created for McKinney/Southlake "Citizen Self Service" interface
- Different from standard EnerGov Angular SPA
- Uses keyword search with filter sidebar
- **Currently broken** - search execution not working

---

## Portal Types Reference

| Portal Type | Cities | Characteristics |
|-------------|--------|-----------------|
| **Accela** | Fort Worth, Dallas | `aca-prod.accela.com`, ASP.NET postback |
| **EnerGov Angular SPA** | Allen, others | Hash routing `#/search?m=2` |
| **EnerGov Tyler CSS** | Keller, Mesquite | `tylerhost.net`, simpler UI |
| **Citizen Self Service** | McKinney, Southlake | Keyword search, filter sidebar |
| **MGO Connect** | Irving, Lewisville | PrimeNG dropdowns, requires login |
| **eTRAKiT** | Frisco, Plano | CentralSquare, `__doPostBack` pagination |

---

## Debug Files

All screenshots saved to `debug_html/`:
- `{city}_p1.png` - Initial page load
- `{city}_results.png` - Search results
- `{city}_filtered.png` - After filtering
- `{city}_error.png` - Error state

---

## Raw Data Files

All output in project root as `{city}_raw.json`:
```
fort_worth_raw.json    1000 permits (Accela)
dallas_raw.json        1000 permits (Accela)
keller_raw.json        1000 permits (EnerGov Tyler CSS)
mesquite_raw.json      1000 permits (EnerGov Tyler CSS)
irving_raw.json         399 permits (MGO Connect)
lewisville_raw.json     394 permits (MGO Connect)
frisco_raw.json         200 permits (eTRAKiT)
allen_raw.json            1 permit  (broken)
mckinney_raw.json         0 permits (broken)
```

---

## Recommended Next Steps

### High Priority
1. **Fix McKinney CSS scraper** - 325k permits available
   - Try `page.evaluate('document.forms[0].submit()')` instead of button click
   - Or navigate directly to results URL if discoverable
   - Check network tab for API endpoints

### Medium Priority
2. **Test Grand Prairie EnerGov** - Config added, needs testing
   ```bash
   python3 scrapers/energov.py grand_prairie_energov 100
   ```

3. **Debug Frisco pagination** - Check what's blocking after 200
   - Add more logging to pagination loop
   - Check if postback is failing silently

### Low Priority
4. **Fix Allen extraction** - DeepSeek returning fake data
5. **Investigate Plano eTRAKiT** - Listed but requires login

---

## Commands to Run

```bash
# Activate environment
source venv/bin/activate && set -a && source .env && set +a

# Test specific scraper
python3 scrapers/energov.py keller 50
python3 scrapers/accela.py fort_worth 50
python3 scrapers/mgo_connect.py Irving 50
python3 scrapers/citizen_self_service.py mckinney 50
python3 scrapers/etrakit.py frisco 50

# Check current permit counts
python3 -c "
import json
from pathlib import Path
for f in sorted(Path('.').glob('*_raw.json')):
    try:
        d = json.load(open(f))
        print(f'{f.name:30} {len(d.get(\"permits\", [])):5} permits')
    except: pass
"
```

---

## Environment Requirements

- Python 3.11+
- Playwright (with chromium)
- `.env` with: `DEEPSEEK_API_KEY`, `MGO_EMAIL`, `MGO_PASSWORD`

---

## Questions for Next Engineer

1. Should we try browser automation with visible browser (`headless=False`) for McKinney to debug?
2. Is 4,994 permits sufficient to proceed with lead scoring, or do we need McKinney's 325k?
3. Should we investigate API endpoints instead of scraping for Citizen Self Service portals?
