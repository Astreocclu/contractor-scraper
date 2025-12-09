# Session Log: Permit Scraper Filter Fixes
**Date:** 2025-12-08
**Engineer:** Claude (handoff document)
**Status:** Code complete, needs testing

---

## Summary

Added filtering logic to permit scrapers to remove garbage data (complaints, code enforcement, garage sales, rentals) and enforce 2-month date range. Code changes complete but testing was interrupted.

---

## Problem Statement

Working scrapers were pulling garbage data:

| Scraper | Problem Data |
|---------|--------------|
| **Fort Worth** (Accela) | 400 Pre-Development Conference, 200 Complaints, 200 Sign Permits |
| **Keller** (EnerGov) | 987 Code Enforcement, 13 Environmental Health (0% usable) |
| **Mesquite** (EnerGov) | 949 Rental Property licenses (0% usable) |
| **Lewisville** (MGO) | 79 Garage Sale permits mixed in |
| **Dallas** (Accela) | 250 Commercial Plumbing mixed in |

---

## Changes Made

### 1. `scrapers/energov.py`

**Added type whitelist/blacklist:**
```python
VALID_PERMIT_TYPES = {
    'building', 'residential', 'roof', 'roofing', 'hvac', 'mechanical',
    'plumbing', 'electrical', 'foundation', 'addition', 'alteration',
    'renovation', 'remodel', 'new construction', 'solar', 'pv', 'photovoltaic',
    'fence', 'deck', 'patio', 'pool', 'spa', 'water heater', 'ac', 'air conditioning',
    'window', 'door', 'siding', 'insulation', 'driveway', 'garage', 'carport',
}

EXCLUDED_PERMIT_TYPES = {
    'code enforcement', 'complaint', 'rental', 'license', 'garage sale',
    'pre-development', 'conference', 'sign', 'billboard', 'commercial',
    'environmental', 'health', 'zoning', 'variance', 'planning', 'subdivision',
    'right-of-way', 'row', 'encroachment', 'special event', 'food', 'alcohol',
}
```

**Added functions:**
- `is_valid_permit_type()` - checks against whitelist/blacklist
- `is_within_date_range()` - filters to last 2 months (60 days)
- `filter_permits()` - combines all filtering, returns stats

**Added module selection for Tyler CSS (Keller/Mesquite):**
- Lines ~350-430: Tries to select Building/Permit module before searching
- Method 1: Module dropdown selection
- Method 2: Tab/link clicking
- Method 3: Checkbox selection
- Falls back to filtering results if module selection fails

### 2. `scrapers/accela.py`

**Added same filtering logic:**
- Type whitelist/blacklist (same as energov.py)
- `is_within_date_range()` - 2 month filter
- `filter_permits()` - also filters empty/undefined addresses

**Config unchanged:**
- Fort Worth stays on Development module (Building module 404s)
- Filtering handles the garbage

### 3. `scrapers/mgo_connect.py`

**Added type filtering:**
- `EXCLUDED_PERMIT_TYPES` set (garage sale, etc.)
- `filter_permits()` function

**Changed date range:**
- Was: 12 weeks (84 days)
- Now: 2 months (60 days)

---

## Filter Test Results (on existing data)

```
dallas_raw.json           1000 total ->  750 valid (filtered 250 Commercial)
fort_worth_raw.json       1000 total ->  200 valid (filtered 800 garbage)
frisco_raw.json            200 total ->  200 valid (all good)
irving_raw.json            399 total ->  397 valid (filtered 2)
lewisville_raw.json        394 total ->  315 valid (filtered 79 Garage Sales)
keller_raw.json           1000 total ->    0 valid (ALL Code Enforcement)
mesquite_raw.json         1000 total ->    0 valid (ALL Rental Licenses)
```

**Note:** Keller and Mesquite filtering to 0 means the scrapers are hitting the WRONG MODULE entirely. The module selection fix should help, but needs testing.

---

## Testing Needed

### Priority 1: Test Keller/Mesquite Module Selection

```bash
source venv/bin/activate && set -a && source .env && set +a

# Test with small count first
python3 scrapers/energov.py keller 20
python3 scrapers/energov.py mesquite 20
```

**Expected:** Should now pull Building permits, not Code Enforcement/Rental
**If still wrong:** Check `debug_html/keller_p1.png` to see what module is showing

### Priority 2: Test Fort Worth Filtering

```bash
python3 scrapers/accela.py fort_worth 20
```

**Expected:** Should filter out Pre-Dev, Complaints, Signs and keep only Electrical/Building permits

### Priority 3: Test Lewisville Garage Sale Filtering

```bash
python3 scrapers/mgo_connect.py Lewisville 50
```

**Expected:** Garage Sales should be filtered out

---

## Key Files Modified

| File | Lines Changed | Description |
|------|---------------|-------------|
| `scrapers/energov.py` | ~88-260, ~350-430, ~530 | Filter functions, module selection, filter call |
| `scrapers/accela.py` | ~52-136, ~343-355 | Filter functions, filter call |
| `scrapers/mgo_connect.py` | ~63-104, ~439-444, ~609-618 | Filter functions, date range, filter call |

---

## Known Issues

1. **Keller/Mesquite may still hit wrong module** - Tyler CSS portals vary; module selection logic may need adjustment based on actual portal UI
2. **DeepSeek extraction is slow** - Each page takes 30-60s; consider reducing LLM calls or using DOM parsing
3. **Fort Worth Building module 404s** - Had to revert to Development module; filtering handles it

---

## Debug Commands

```bash
# Check what permit types are in a file
python3 -c "
import json
from collections import Counter
data = json.load(open('keller_raw.json'))
types = Counter(p.get('type', 'unknown') for p in data.get('permits', []))
for t, c in types.most_common(10):
    print(f'{c:4} {t}')
"

# View debug screenshot
xdg-open debug_html/keller_p1.png
```

---

## Quick Reference

**Working scrapers (good data):**
- Irving (MGO) - Roof, HVAC, Plumbing, Foundation
- Lewisville (MGO) - Same (minus garage sales now)
- Dallas (Accela) - Residential New Construction, Solar
- Frisco (eTRAKiT) - Building permits

**Scrapers that need module fix testing:**
- Keller (EnerGov Tyler CSS)
- Mesquite (EnerGov Tyler CSS)

**Scrapers that need filter testing:**
- Fort Worth (Accela)

---

## Environment

```bash
source venv/bin/activate && set -a && source .env && set +a
```

Required env vars: `DEEPSEEK_API_KEY`, `MGO_EMAIL`, `MGO_PASSWORD`
