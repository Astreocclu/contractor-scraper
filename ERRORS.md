# Contractor Auditor - Error Log

## Format
| Date | Phase | Error | Resolution |

## Critical Architecture Mistakes (DO NOT REPEAT)

### Google Places API - BANNED
**What happened:** Google Places API caused $300 overcharge.

**Fix:** Use Playwright scraping for Google Maps instead. NEVER enable Google Places API.

---

## Resolved Issues

| Date | Issue | Resolution |
|------|-------|------------|
| 2025-12-09 | Trustpilot SERP matching wrong companies | Fixed - now uses direct URL check (`trustpilot.com/review/{domain}`) |
| 2025-12-09 | JSON parse error in review_analyzer.js | Fixed - added error handling |
| 2025-12-08 | Only 4 contractors showing despite 116 qualified | Fixed - `passes_threshold` now updates correctly |

---

## Current Known Issues

### County Lien Portals Blocking Automation (2025-12-10)
**Problem:** All Texas county OPR portals are blocking Playwright scrapers:
- **Tarrant:** CAPTCHA detected immediately
- **Dallas:** Navigation blocked/redirected to error page
- **Collin:** Connects but no results (selector mismatch or blocking)
- **Denton:** Untested but likely similar

**Impact:** Cannot collect mechanic's liens, tax liens, or judgment data automatically.

**Legitimate alternatives:**
1. **TexasFile.com** - Commercial aggregator with county records, deeds, liens across TX
2. **CourthouseDirect.com** - Nationwide records including Abstracts of Judgment, Liens
3. **Manual FOIA requests** - Texas Public Information Act allows 10-day turnaround
4. **Harris County portal** - Has working Document Search (may work differently than DFW)
5. **Contact county clerks** - Ask about bulk data access or API availability

**Note:** Lien scoring/pairing logic is fully tested (14 unit tests passing). Only the portal scraping is blocked.
