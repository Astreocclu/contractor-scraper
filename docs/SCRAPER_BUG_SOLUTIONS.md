# Permit Scraper Bug Solutions Document
**Date:** 2025-12-08
**Status:** Ready for Implementation
**Confidence:** High (self-reviewed with rigorous edge case analysis)

---

## Executive Summary

Three permit scraper bugs identified. Solutions prioritized by impact and risk.

| Bug | Impact | Solution Confidence | Estimated Effort |
|-----|--------|---------------------|------------------|
| McKinney CSS search | HIGH - 325k permits | 85% | Medium |
| Frisco eTRAKiT pagination | Medium - 4,112 more permits | 80% | Low |
| Allen EnerGov hallucination | Medium - Data quality | 75% | Low |

---

## Problem 1: McKinney Citizen Self Service Search Not Executing (HIGH)

### Issue
Search button click doesn't execute search. 325,149 permits available but scraper returns 0.

### Root Cause Analysis (Confirmed via investigation)
1. **Angular SPA with hash routing** - Direct link found: `#/search`
2. **API base confirmed**: `/energov_prod/selfservice/api`
3. **Current code uses generic button click** - Angular apps need proper routing

### Current Code (`scrapers/citizen_self_service.py:161-180`)
```python
# Current: Generic button click via page.evaluate()
search_btn_clicked = await page.evaluate('''() => {
    const buttons = document.querySelectorAll('button, input[type="submit"], a');
    for (const btn of buttons) {
        const text = (btn.textContent || btn.value || '').toLowerCase();
        if (text.includes('search') && !text.includes('reset')) {
            btn.click();
            return true;
        }
    }
    return false;
}''')
```

### Proposed Solution: Direct API Access + Hash Navigation

**Solution A: Direct Hash Navigation (Primary)**
```python
async def scrape_mckinney_permits(page, target_count: int):
    """Navigate directly to search results via Angular hash route."""

    # Direct navigation to search interface
    base_url = "https://egov.mckinneytexas.org/EnerGov_Prod/SelfService"
    search_url = f"{base_url}#/search"

    await page.goto(search_url, wait_until='networkidle', timeout=60000)
    await asyncio.sleep(5)  # Wait for Angular hydration

    # Wait for search module to load
    await page.wait_for_selector('[class*="search"], [class*="result"]', timeout=30000)

    # Select "Permit" module if dropdown exists
    await page.evaluate('''() => {
        const moduleSelect = document.querySelector('select[ng-model*="module"], [data-module]');
        if (moduleSelect) {
            // Find and select "Permit" option
            for (const opt of moduleSelect.options) {
                if (opt.textContent.toLowerCase().includes('permit')) {
                    moduleSelect.value = opt.value;
                    moduleSelect.dispatchEvent(new Event('change', {bubbles: true}));
                    // Trigger Angular digest
                    angular.element(moduleSelect).triggerHandler('change');
                    return true;
                }
            }
        }
        return false;
    }''')

    await asyncio.sleep(2)

    # Trigger empty search (all results)
    await page.evaluate('''() => {
        // Find Angular scope and call search
        const searchBtn = document.querySelector('[ng-click*="search"], [class*="search-btn"]');
        if (searchBtn) {
            angular.element(searchBtn).triggerHandler('click');
            return true;
        }

        // Fallback: Submit form
        const form = document.querySelector('form[ng-submit]');
        if (form) {
            angular.element(form).triggerHandler('submit');
            return true;
        }

        return false;
    }''')
```

**Solution B: Intercept and Call API Directly (Backup)**
```python
async def scrape_via_api(page, target_count: int):
    """Intercept network requests to find and use API directly."""

    api_calls = []

    def capture_request(request):
        if '/api/' in request.url:
            api_calls.append({
                'url': request.url,
                'method': request.method,
                'post_data': request.post_data
            })

    page.on('request', capture_request)

    # Navigate and trigger one search to capture API pattern
    await page.goto(f"{base_url}#/search", wait_until='networkidle')
    await asyncio.sleep(5)

    # Try clicking search to capture API call
    await page.click('button:has-text("Search"), [ng-click*="search"]')
    await asyncio.sleep(3)

    # Analyze captured API calls
    for call in api_calls:
        if 'search' in call['url'].lower() or 'permit' in call['url'].lower():
            print(f"Found API: {call['url']}")
            # Now call API directly with httpx for faster pagination
            return await fetch_via_api(call['url'], call['post_data'], target_count)

    return []  # Fallback to DOM scraping
```

### Edge Cases & Mitigations

| Edge Case | Risk | Mitigation |
|-----------|------|------------|
| **Angular version mismatch** | Medium | Check `window.angular` exists before using |
| **API requires auth token** | High | Extract token from page cookies/localStorage |
| **Rate limiting** | Medium | Add 2s delay between API calls |
| **CORS on direct API** | Low | API called from browser context, not direct |
| **Module IDs change** | Low | Use text matching, not hardcoded IDs |

### What Could Break
1. **Angular scope not accessible** - Fallback to form submission
2. **API endpoint changes** - Network interception will discover new endpoint
3. **Session timeout** - Re-navigate to refresh session

### Testing Steps
```bash
# Run with visible browser to debug
python3 scrapers/citizen_self_service.py mckinney 50 --visible

# Check debug screenshots
ls -la debug_html/mckinney_*
```

---

## Problem 2: Frisco eTRAKiT Pagination Stops at 200 (Medium)

### Issue
Scraper times out after 200 permits (4 pages of 50). Frisco has 4,312 permits available.

### Root Cause Analysis (Confirmed via HTML inspection)
1. **"of 4,312" found in HTML** - Server knows full count
2. **"prev" and "next" elements exist** - Pagination is available
3. **ViewState may be expiring** - ASP.NET state management issue
4. **Postback not completing** - No explicit wait for response

### Current Code (`scrapers/etrakit.py:289-323`)
```python
# Current: Click next link, sleep 4s, continue
has_next = await page.evaluate('''() => {
    const links = document.querySelectorAll('a');
    for (const link of links) {
        const text = (link.textContent || '').toLowerCase().trim();
        if ((text === 'next' || text === '>') && href.includes('__doPostBack')) {
            link.click();
            return true;
        }
    }
    return false;
}''')
```

### Proposed Solution: Robust Postback Handling

**Solution A: Wait for ViewState Change (Primary)**
```python
async def click_next_page_robust(page, current_page: int) -> bool:
    """Click next page with robust postback completion detection."""

    # Capture current ViewState hash
    old_viewstate = await page.evaluate('''() => {
        const vs = document.getElementById("__VIEWSTATE");
        return vs ? vs.value.slice(0, 50) : null;
    }''')

    # Click next page link
    clicked = await page.evaluate('''() => {
        // Method 1: Direct "Next" link
        const nextLink = document.querySelector('a[href*="Page$Next"]');
        if (nextLink) {
            nextLink.click();
            return "next_link";
        }

        // Method 2: Page number (current + 1)
        const pageLinks = document.querySelectorAll('.paging a, [id*="Pager"] a');
        for (const link of pageLinks) {
            const pageNum = parseInt(link.textContent);
            if (!isNaN(pageNum) && pageNum > 0) {
                // Find current page indicator and click next
                // (implementation depends on specific HTML structure)
            }
        }

        // Method 3: > or >> button
        for (const link of document.querySelectorAll('a')) {
            if (link.textContent.trim() === '>' || link.textContent.trim() === '>>') {
                link.click();
                return "arrow_link";
            }
        }

        return null;
    }''')

    if not clicked:
        return False

    # Wait for ViewState to change (indicates postback completed)
    try:
        await page.wait_for_function(
            f'''() => {{
                const vs = document.getElementById("__VIEWSTATE");
                return vs && vs.value.slice(0, 50) !== "{old_viewstate}";
            }}''',
            timeout=30000
        )
        return True
    except:
        # ViewState didn't change - postback may have failed
        print(f"WARNING: ViewState unchanged after clicking {clicked}")
        return False
```

**Solution B: Multiple Search Queries (Backup)**
```python
async def scrape_with_prefixes(page, base_count: int = 200):
    """Bypass 200-limit by splitting into multiple searches."""

    all_permits = []

    # B25-* for 2025, split by second digit
    prefixes = ['B25-0', 'B25-1', 'B25-2', 'B25-3', 'B25-4',
                'B25-5', 'B25-6', 'B25-7', 'B25-8', 'B25-9']

    for prefix in prefixes:
        await fill_search_box(page, prefix)
        await click_search(page)
        await asyncio.sleep(3)

        # Extract permits from this search
        batch = await extract_current_page(page)

        # Deduplicate
        existing_ids = {p['permit_id'] for p in all_permits}
        new_permits = [p for p in batch if p['permit_id'] not in existing_ids]
        all_permits.extend(new_permits)

        print(f"Prefix {prefix}: {len(new_permits)} new permits")

    return all_permits
```

### Edge Cases & Mitigations

| Edge Case | Risk | Mitigation |
|-----------|------|------------|
| **Server-side 200 limit** | Medium | Multiple prefix queries bypass this |
| **ViewState expires mid-session** | Medium | Detect and re-start search |
| **Grid loads but data unchanged** | Low | Compare first permit ID, not just ViewState |
| **Permit number format changes** | Low | Dynamic prefix detection from first result |

### What Could Break
1. **Permit numbering scheme differs** - Inspect first result to determine pattern
2. **Server blocks rapid requests** - Add 3s delay between pages
3. **Session timeout** - Limit to 500 permits per session, restart if needed

---

## Problem 3: Allen EnerGov DeepSeek Hallucinating (Medium)

### Issue
DeepSeek returns placeholder data like "PERMIT-2024-12345 | Building | 123 Main St"

### Root Cause Analysis
1. **Page not fully loaded** - Angular SPA hydration incomplete
2. **Empty HTML sent to LLM** - No actual permit data in DOM
3. **LLM fills gaps with plausible data** - Classic hallucination pattern

### Current Code (`scrapers/energov.py` extraction)
```python
# Current: Send raw HTML to DeepSeek without validation
html = clean_html(await page.content())
extract_prompt = f'''Extract permit records from this HTML...
{html[:100000]}'''
response = await call_deepseek(extract_prompt)
```

### Proposed Solution: Pre-Validation + Post-Validation

```python
async def extract_permits_with_validation(page, city_name: str) -> list[dict]:
    """Extract permits with hallucination prevention."""

    # PRE-VALIDATION: Ensure page has actual data
    page_state = await page.evaluate('''() => {
        const state = {
            hasResultCount: false,
            hasTableRows: false,
            hasPermitText: false,
            sampleText: ''
        };

        // Check for result count indicator
        const countEl = document.querySelector(
            '[class*="result-count"], [class*="total"], [class*="showing"]'
        );
        if (countEl && /\d+/.test(countEl.textContent)) {
            state.hasResultCount = true;
        }

        // Check for table rows or result items
        const rows = document.querySelectorAll(
            'table tbody tr, .result-item, .permit-row, [class*="search-result"]'
        );
        state.hasTableRows = rows.length > 0;

        // Check for permit-like text patterns
        const bodyText = document.body.textContent;
        state.hasPermitText = /[A-Z]{2,4}-?\d{4,}|BLDG|POOL|MECH|ELEC/i.test(bodyText);

        // Get sample text for debugging
        state.sampleText = bodyText.slice(0, 500);

        return state;
    }''')

    if not page_state['hasTableRows'] and not page_state['hasPermitText']:
        print(f"WARNING: No permit data detected on page")
        print(f"Sample text: {page_state['sampleText'][:200]}")
        return []

    # EXTRACTION: Send to DeepSeek with stricter prompt
    html = clean_html(await page.content())

    extract_prompt = f'''Extract permit records from this {city_name} search results page.

CRITICAL RULES:
1. ONLY extract data that is EXPLICITLY VISIBLE in the HTML
2. Do NOT generate, invent, or guess any data
3. If a field is not visible, use null (not a placeholder)
4. Permit IDs must match patterns like "B24-12345", "BLDG-2024-001", etc.
5. Addresses must be real street addresses (numbers + street name)

If no permits are visible, return: {{"permits": [], "error": "no_data_visible"}}

HTML:
{html[:100000]}'''

    response = await call_deepseek(extract_prompt)
    data = parse_json(response)

    if not data or not data.get('permits'):
        return []

    # POST-VALIDATION: Filter out obvious hallucinations
    valid_permits = []

    for permit in data['permits']:
        pid = permit.get('permit_id', '')
        addr = permit.get('address', '')

        # Reject placeholder patterns
        if is_hallucinated(pid, addr):
            print(f"REJECTED hallucination: {pid} | {addr}")
            continue

        valid_permits.append(permit)

    return valid_permits


def is_hallucinated(permit_id: str, address: str) -> bool:
    """Detect common LLM hallucination patterns."""

    # Pattern 1: Generic placeholder IDs
    placeholder_patterns = [
        r'^PERMIT-\d{4}-\d{5}$',      # PERMIT-2024-12345
        r'^[A-Z]+-\d{4}-\d{4,5}$',    # Generic TYPE-YEAR-XXXXX
        r'12345|99999|00000',          # Obvious placeholders
    ]

    for pattern in placeholder_patterns:
        if re.match(pattern, permit_id):
            return True

    # Pattern 2: Generic placeholder addresses
    fake_addresses = [
        '123 main st', '456 oak st', '789 elm st',
        '1234 example', 'test address', 'n/a'
    ]

    if address.lower().strip() in fake_addresses:
        return True

    # Pattern 3: Sequential IDs (LLM generates 001, 002, 003...)
    if re.match(r'.*-00[1-9]$', permit_id):
        return True

    return False
```

### Edge Cases & Mitigations

| Edge Case | Risk | Mitigation |
|-----------|------|------------|
| **Real permit "B24-00001"** | Low | Actual first permit of year - check context |
| **Unusual address format** | Medium | Don't reject based on address alone |
| **LLM generates realistic IDs** | Medium | Cross-reference with visible HTML text |
| **Partial page load** | High | Wait for networkidle + explicit selectors |

### What Could Break
1. **Over-filtering** - Legitimate edge-case permits rejected
2. **New hallucination patterns** - Monitor and update blocklist
3. **City-specific ID formats** - Make patterns configurable

---

## Implementation Priority

1. **McKinney CSS (HIGH)** - 325k permits, highest value
2. **Frisco eTRAKiT (Medium)** - 4k more permits, lower effort
3. **Allen EnerGov (Medium)** - Quality improvement, can wait

## Testing Checklist

- [ ] McKinney: Get >100 permits successfully
- [ ] Frisco: Get >500 permits (currently stuck at 200)
- [ ] Allen: Get real permit data (not placeholders)

---

## Implementation Progress (2025-12-08)

### McKinney CSS - PARTIALLY FIXED
**Changes Made:**
1. Added direct hash navigation to `#/search` (bypasses broken click)
2. Added Angular detection and scope triggering
3. Added module selection (dropdown to "Permit")
4. Added multi-method search execution (button, Angular trigger, form submit, Enter key)
5. Switched from DeepSeek extraction to direct DOM parsing

**Results:**
- Search navigation: ✅ Working (325,151 permits accessible!)
- Module selection: ✅ Working (Permit selected)
- Results loading: ✅ Working
- Permit filter: ✅ Working
- Pagination: ✅ Working (Next button clicks)
- Extraction: ❌ Regex not matching (needs field format tuning)

**Remaining Work:**
- Tune regex to match "Permit Number 000001-2024" format correctly
- Server rate-limiting prevented debugging extraction patterns

### Frisco eTRAKiT - CODE UPDATED
**Changes Made:**
1. Added ViewState change detection before/after pagination
2. Wait for ViewState update instead of fixed 4s sleep
3. Added timeout handling with fallback

**Results:**
- Not fully tested yet (servers slow/rate-limiting)
- Previous: 200 permits
- Target: 4,312 permits

### Allen EnerGov - NOT STARTED
**Planned:**
- Add pre-validation (check page has data before LLM)
- Add post-validation (reject placeholder patterns)

---

## Appendix: Debug Commands

```bash
# Activate environment
source venv/bin/activate && set -a && source .env && set +a

# Test individual scrapers
python3 scrapers/citizen_self_service.py mckinney 50
python3 scrapers/etrakit.py frisco 300
python3 scrapers/energov.py allen 50

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
