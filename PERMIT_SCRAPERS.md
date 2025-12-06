# DFW Permit Scrapers

## Overview

Standalone scrapers for pulling building permits from DFW municipal portals. Each city has its own script tailored to that portal's structure.

## Status Summary

| Status | Count | Cities |
|--------|-------|--------|
| Working | 1 | Southlake |
| Needs Work | 29 | See below |

## Working Scrapers

### Southlake (EnerGov)

**Script:** `pull_southlake_permits.js`

**What it does:**
- Searches for permits by keyword (e.g., "pool")
- Sorts by Finalized Date (descending) to get recent permits
- Extracts permit list with addresses, types, dates
- Clicks into individual permits to get full details including contractor info

**Data extracted:**
- Permit ID, address, type, status
- Applied/Issued/Finalized dates
- Description, valuation
- **Contractor info:** Company name, contact name (from Contacts table)
- Inspections list
- Fees (total/paid/unpaid)

**Run:**
```bash
DEEPSEEK_API_KEY=your_key node pull_southlake_permits.js
```

**Key patterns discovered:**
- EnerGov uses Angular SPA - need to wait for page load and click Search button
- Sort field values use format: `string:FinalDate`, `string:IssueDate`
- Sort direction is a separate dropdown: `#SortAscending` with `boolean:false` for descending
- Contractor info is in Contacts table with aria-label attributes
- Detail links use GUIDs: `#/permit/{guid}`

---

## Portal Types

### EnerGov (8 cities)
Angular SPA portal. Requires:
1. Wait for page load (~5s)
2. Click `#button-Search` to trigger search
3. Set sort with `#PermitCriteria_SortBy` and `#SortAscending`
4. Parse results from `[id^="entityRecordDiv"]` elements
5. Navigate to detail page via GUID link

**Working:** Southlake
**Not working:** Denton, Lewisville, Allen, Rowlett, Colleyville, Keller, Princeton (DNS errors - wrong URLs)

### Accela (2 cities)
Older portal with form submission required.

**Status:** Fort Worth shows search form, needs form submission
**Key selector:** `#ctl00_PlaceHolderMain_btnNewSearch`

### eTRAKiT (3 cities)
Often requires login.

**Status:** Plano requires login, Frisco returns 404, NRH has DNS error

### CSS / MyGov (8 cities)
Various implementations.

**Status:** Mesquite has `/case_status/` page that might work

---

## Test Results (Dec 6, 2025)

Full test of 30 cities: **1/30 successful (3%)**

### By Error Type:

| Error | Count | Cities |
|-------|-------|--------|
| DNS Error | 10 | Dallas, Denton, Lewisville, Allen, Rowlett, Colleyville, Princeton, NRH, Duncanville SSL |
| 404/Wrong URL | 9 | Garland, Frisco, McKinney, Grand Prairie, Carrollton, Grapevine, Lancaster, Cedar Hill |
| Search Form (needs interaction) | 4 | Fort Worth, Arlington, Mesquite, Sachse |
| Info Page (wrong page) | 5 | Irving, Richardson, DeSoto, Farmers Branch, Balch Springs |
| Timeout | 1 | Keller |

---

## Files

| File | Purpose |
|------|---------|
| `pull_southlake_permits.js` | Southlake EnerGov scraper (working) |
| `test_all_portals.js` | Tests all 30 cities, saves results |
| `test_sort.js` | Test script for sort functionality |
| `portal_test_results.json` | Results from last test run |
| `portal_learning.json` | Accumulated patterns per portal type |
| `southlake_permits.json` | Last Southlake permit list |
| `southlake_permit_sample.json` | Full details of one permit |
| `debug_html/` | Saved HTML for debugging |

---

## Next Steps

1. **Fix DNS errors** - Many EnerGov cities have wrong URLs. Need to find current portal URLs.
2. **Add form submission** - Fort Worth, Mesquite need search form interaction
3. **Handle logins** - Plano eTRAKiT requires contractor login
4. **Create per-city scripts** - Once patterns confirmed, create dedicated scripts

---

## DeepSeek Integration

All scrapers use DeepSeek API to analyze HTML and extract permit data. This allows handling variations in HTML structure without brittle selectors.

**Key prompts:**
- Search results: Extract permit ID, address, type, dates, detail link
- Detail page: Extract full permit info including Contacts table

**HTML cleaning:** Remove `<style>`, `<script>`, `<svg>`, comments before sending to API (reduces 500KB+ to ~150KB).

---

## Environment

```bash
DEEPSEEK_API_KEY=your_key  # Required for all scrapers
```

Dependencies: `puppeteer`, `fs` (Node.js built-in)
