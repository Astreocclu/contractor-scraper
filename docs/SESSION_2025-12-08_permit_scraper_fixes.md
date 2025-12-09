# Session Log: Permit Scraper Bug Fixes
**Date:** 2025-12-08
**Engineer:** Claude (handoff document)
**Status:** In Progress - Ready for pickup

---

## Summary

Worked on fixing 3 permit scraper bugs. Created comprehensive solutions document and implemented code fixes. Testing blocked by server rate-limiting.

**Key Achievement:** McKinney search now works - **325,151 permits accessible** (was 0 before).

---

## Bugs Addressed

| Bug | Status | File | Notes |
|-----|--------|------|-------|
| McKinney CSS search not executing | 80% Fixed | `scrapers/citizen_self_service.py` | Search works, extraction regex needs tuning |
| Frisco eTRAKiT pagination stops at 200 | Code Updated | `scrapers/etrakit.py` | ViewState wait added, needs testing |
| Allen EnerGov DeepSeek hallucinating | Not Started | `scrapers/energov.py` | Pre/post validation planned |

---

## McKinney CSS - Detailed Status

### Problem
Search button click wasn't executing. Angular SPA needed proper navigation.

### Root Cause
- Portal is Angular with hash routing (`#/search`)
- Generic button click wasn't triggering Angular digest cycle
- API base at `/energov_prod/selfservice/api`

### Fixes Applied (lines ~128-343 in `citizen_self_service.py`)

1. **Direct hash navigation:**
```python
search_url = f'{base_url}#/search'
await page.goto(search_url, wait_until='networkidle', timeout=60000)
```

2. **Angular module selection:**
```python
await page.select_option('select[id*="Module"]', label='Permit')
```

3. **Multi-method search triggering:**
- Button click with Angular trigger
- Form submit via Angular
- Enter key in search input

4. **Switched to DOM parsing** (no LLM for extraction):
```python
page_data = await page.evaluate(r'''() => {
    // Parse "Permit Number 000001-2024" format
    const parts = text.split('Permit Number');
    // ... extraction logic
}''')
```

### Current State
- Search navigation: ✅ Working
- Module selection: ✅ Working
- Results loading: ✅ Working (325,151 permits!)
- Pagination: ✅ Working
- **Extraction: ❌ Regex not matching**

### Screenshot Evidence
- `debug_html/mckinney_css_step3.png` - Shows "Found 325,151 results"
- `debug_html/mckinney_css_filtered.png` - Shows actual permit data

### Remaining Work
The extraction regex isn't matching. The page shows:
```
Permit Number 000001-2024
Type Fire Service Underground Water Line
Status Void
Address 1880 BRAY CENTRAL DR MCKINNEY TX 75069
Applied Date 04/22/2024
```

Current regex in code:
```javascript
const idMatch = block.match(/Permit Number\s+(\d{6}-\d{4})/);
```

**Debug approach:** Get `document.body.innerText` sample and verify text format matches regex expectations.

---

## Frisco eTRAKiT - Detailed Status

### Problem
Pagination stops at 200 permits. Server has 4,312 available.

### Root Cause (Suspected)
- ViewState expiration during pagination
- Postback not completing before next page click

### Fix Applied (lines ~289-347 in `etrakit.py`)

Added ViewState change detection:
```python
# Capture ViewState before clicking Next
old_viewstate = await page.evaluate('''() => {
    const vs = document.getElementById("__VIEWSTATE");
    return vs ? vs.value.slice(0, 100) : null;
}''')

# ... click next ...

# Wait for ViewState to change (indicates postback completed)
await page.wait_for_function(
    f'''() => {{
        const vs = document.getElementById("__VIEWSTATE");
        return vs && vs.value.slice(0, 100) !== "{old_viewstate}";
    }}''',
    timeout=30000
)
```

### Testing Needed
```bash
source venv/bin/activate && set -a && source .env && set +a
python3 scrapers/etrakit.py frisco 300
```

Target: Get >200 permits (currently stuck at 200).

---

## Allen EnerGov - Not Implemented

### Problem
DeepSeek returns placeholder data like "PERMIT-2024-12345 | 123 Main St"

### Planned Solution (from `docs/SCRAPER_BUG_SOLUTIONS.md`)

**Pre-validation:** Check page has actual data before LLM call
```python
has_data = await page.evaluate('''() => {
    const rows = document.querySelectorAll('table tbody tr, .result-item');
    return rows.length > 0;
}''')
```

**Post-validation:** Reject placeholder patterns
```python
def is_hallucinated(permit_id, address):
    if re.match(r'^PERMIT-\d{4}-\d{5}$', permit_id):
        return True
    if address.lower() == '123 main st':
        return True
    return False
```

---

## Files Modified

| File | Changes |
|------|---------|
| `scrapers/citizen_self_service.py` | Complete rewrite of search/extraction logic |
| `scrapers/etrakit.py` | Added ViewState pagination detection |
| `docs/SCRAPER_BUG_SOLUTIONS.md` | NEW - Comprehensive solutions document |

---

## Blockers Encountered

1. **Server rate-limiting** - McKinney returned HTTP2 protocol errors after multiple requests
2. **Gemini quota exhausted** - Couldn't do back-and-forth critique (resets in ~5h)
3. **DeepSeek latency** - Each page extraction takes 30-60s, making testing slow

---

## Debug Files Available

```
debug_html/mckinney_css_step1.png    # Search page loaded
debug_html/mckinney_css_step3.png    # Results (325k permits!)
debug_html/mckinney_css_filtered.png # After Permit filter
debug_html/mckinney_css_error.png    # Error state (before fix)
debug_html/frisco_etrakit_*.html     # Frisco page states
```

---

## Testing Commands

```bash
# Activate environment
source venv/bin/activate && set -a && source .env && set +a

# Test McKinney (when rate limits reset)
python3 scrapers/citizen_self_service.py mckinney 20

# Test Frisco
python3 scrapers/etrakit.py frisco 300

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

## Recommended Next Steps

### Priority 1: Fix McKinney extraction
1. Wait for rate limits to reset (or use different IP)
2. Get `document.body.innerText` sample from live page
3. Verify regex matches actual text format
4. May need to adjust field delimiters

### Priority 2: Test Frisco ViewState fix
1. Run with target 300+ permits
2. Verify it gets past 200
3. If still stuck, implement multiple search prefix approach:
```python
for prefix in ['B25-0', 'B25-1', 'B25-2', ...]:
    permits.extend(await search_with_prefix(page, prefix))
```

### Priority 3: Allen pre/post validation
1. Add data presence check before LLM call
2. Add hallucination pattern rejection after LLM call

---

## Key Insights

1. **McKinney is NOT a "Citizen Self Service" in the traditional sense** - it's a full Angular SPA that requires hash routing
2. **The permit ID format varies by search type:**
   - When searching "All": `GEN2023-04-00662`, `WILDLIFE2023-03-01424`
   - When filtered to "Permit": `000001-2024`, `000001-2025`
3. **DOM parsing is faster and more reliable than LLM extraction** for structured pages
4. **ViewState change is the definitive signal** that ASP.NET postback completed

---

## Environment

- Python 3.10+
- Playwright with Chromium
- `.env` with: `DEEPSEEK_API_KEY`, `MGO_EMAIL`, `MGO_PASSWORD`
- DeepSeek API for LLM extraction (where still used)

---

## Questions for Next Engineer

1. Should we abandon LLM extraction entirely for McKinney in favor of pure DOM parsing?
2. Is 325k permits overkill? Should we limit to recent permits (last 2 years)?
3. Should we add retry logic for HTTP2 protocol errors?
