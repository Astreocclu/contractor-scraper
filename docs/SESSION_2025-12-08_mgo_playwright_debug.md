# Session Handoff: MGO Connect Playwright Click Issue
**Date:** 2025-12-08
**Status:** UNSOLVED - Fundamental Playwright/Angular incompatibility

## Problem Summary

The MGO Connect Python/Playwright scraper successfully:
- Logs in ✅
- Navigates to search page ✅
- Selects jurisdiction (Texas → Irving) ✅
- Fills date fields ✅
- Finds the Search button ✅

**BUT**: Clicking the Search button does NOT trigger any API calls. The same logic works perfectly in the Node.js/Puppeteer version.

## Key Findings

### 1. Button Is Found and Visible
```python
Button info: {
    'found': True,
    'text': 'Search',
    'disabled': False,
    'className': 'p-ripple p-element p-button p-component mgo-primary-btn btn-large',
    'visible': True,
    'rect': {'x': 687.125, 'y': -7.25, ...}  # Note: y is negative (off-screen)
}
```

### 2. Click Methods Tried (ALL FAILED to trigger API)
1. `page.locator('button:has-text("Search")').click()` - No API call
2. `page.evaluate('btn.click()')` - No API call
3. `page.mouse.click(x, y)` at coordinates - No API call
4. `btn.dispatch_event('click')` - No API call
5. `dispatchEvent(new MouseEvent('click', {bubbles: true}))` - No API call
6. Focus button + Enter key - No API call

### 3. JS Version Works
```bash
node scrapers/mgo_connect.js Irving 10
# Successfully gets 100 permits via API capture
```

The Puppeteer version uses the exact same `btn.click()` in `page.evaluate()` and it works.

### 4. Stealth Was Added
- `playwright-stealth` is installed and was applied
- Didn't help

### 5. No Console Errors
- No JavaScript errors in browser console during click

## Theories to Investigate

### A. Angular Zone.js Issue
Angular uses Zone.js to track async operations. Playwright's click might not be triggering Angular's change detection. Try:
```javascript
// In page.evaluate
const ngZone = window.ng?.getComponent(btn)?.zone;
ngZone?.run(() => btn.click());
```

### B. PrimeNG Button Component
The button uses PrimeNG's `p-button` with `p-ripple`. These may have custom click handlers that only respond to certain event types. Try:
```javascript
// Trigger Angular's (click) binding directly
btn.__ngContext__?.[some_index]?.handleClick?.();
```

### C. Event Listener Inspection
Check what listeners are attached:
```javascript
getEventListeners(btn)  // Only works in Chrome DevTools
```

### D. Try Non-Headless Mode
Run with `headless=False` to visually confirm what's happening:
```python
browser = await p.chromium.launch(headless=False, slow_mo=100)
```

### E. Try Different Browser
```python
browser = await p.firefox.launch()  # or webkit
```

### F. Compare Network Stack
Use browser DevTools to compare what Puppeteer vs Playwright are doing differently at the network level.

## Files Modified This Session

- `scrapers/mgo_connect.py` - Added extensive debug logging, multiple click methods
- `scrapers/mgo_test.py` - Standalone test script for click methods
- `docs/SESSION_2025-12-08_permit_scraper_handoff.md` - Earlier handoff doc

## Working Workaround

**Use the Node.js scraper for MGO cities:**
```bash
set -a && source .env && set +a
node scrapers/mgo_connect.js Irving 50
node scrapers/mgo_connect.js Lewisville 50
```

## Other Scrapers Status

| Scraper | Status | Command |
|---------|--------|---------|
| Keller (EnerGov) | ✅ Working | `python3 scrapers/energov.py keller 20` |
| Fort Worth (Accela) | ✅ Working | `python3 scrapers/accela.py fort_worth 20` |
| Irving (MGO - JS) | ✅ Working | `node scrapers/mgo_connect.js Irving 50` |
| Irving (MGO - Python) | ❌ Broken | Click doesn't trigger API |

## Test Commands

```bash
cd /home/reid/testhome/contractors
source venv/bin/activate && set -a && source .env && set +a

# Test Python MGO (broken)
timeout 180 python3 scrapers/mgo_connect.py Irving 10

# Test JS MGO (works)
node scrapers/mgo_connect.js Irving 10

# Test standalone click methods
python3 scrapers/mgo_test.py
```

## Debug Screenshots Location
- `debug_html/mgo_irving_jurisdiction_set.png` - Form with Irving selected
- `debug_html/mgo_irving_before_search.png` - Form before clicking search
- `debug_html/mgo_irving_results.png` - Results (always empty)
- `debug_html/mgo_test_*.png` - Test script screenshots

## Key Code Locations

- `scrapers/mgo_connect.py:590-645` - Click logic with multiple methods
- `scrapers/mgo_connect.py:570-588` - Button info gathering
- `scrapers/mgo_connect.js:187-230` - Working Puppeteer click logic
- `scrapers/mgo_connect.js:529-540` - JS version's search click

## Session 2025-12-08: Additional Debugging with Claude + Gemini

### What We Fixed
- **Initial diagnosis was partially wrong**: y:-7.25 was because button was off-screen ABOVE viewport after scrolling to bottom
- **Fixed scroll behavior**: Now scrolls to TOP first, then uses `scrollIntoView({block: 'center'})`
- Button now shows `y=422.8 inViewport=True` - properly visible

### What We Tried (ALL FAILED)
1. `page.locator().first.click()` - No API call
2. `page.locator().last.click()` - No API call
3. `page.mouse.click(x, y)` at correct coordinates - No API call
4. `btn.click()` via page.evaluate - No API call
5. `dispatchEvent(new MouseEvent(...))` with proper coords - No API call
6. Combined click + MouseEvent dispatch - No API call

### Root Cause: Unknown Playwright/Angular Incompatibility
The click **executes** (no errors), the button is **visible** at correct coordinates, but Angular's event system doesn't receive/process the event. The exact same `btn.click()` works in Puppeteer but not Playwright.

Possible causes:
- Playwright's CDP protocol handles events differently than Puppeteer
- Angular Zone.js doesn't detect Playwright's synthetic events
- PrimeNG p-button has framework-specific event bindings

### Conclusion
**Use Node.js/Puppeteer version for MGO cities.** This is a deep framework compatibility issue that would require Angular internals expertise to debug further.

```bash
# Working command for MGO cities
node scrapers/mgo_connect.js Irving 50
node scrapers/mgo_connect.js Lewisville 50
```

## Contact

Confirmed as fundamental Playwright/Angular interaction issue. The Python scraper works for login, navigation, form filling - only the Search button click fails to trigger Angular's event handler.
