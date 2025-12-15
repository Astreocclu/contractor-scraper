# Contractor Auditor - Error Log

## Format
| Date | Phase | Error | Resolution |

## Critical Architecture Mistakes (DO NOT REPEAT)

### Google Places API - BANNED
**What happened:** Google Places API caused $300 overcharge.

**Fix:** Use Playwright scraping for Google Maps instead. NEVER enable Google Places API.

---

## Current Known Issues

None at this time.

---

## Resolved Issues

| Date | Issue | Resolution |
|------|-------|------------|
| 2025-12-14 | Score variance (29 points) at temperature 0.1 | Fixed - set `temperature: 0` in all audit agents, variance now 2 points |
| 2025-12-14 | Liens filed BY contractor counted as red flags | Fixed - updated prompt and scraper to correctly interpret lien direction |
| 2025-12-14 | `calculate_lien_score()` not categorizing by direction | Fixed - added GRANTEE/GRANTOR matching to distinguish BY vs AGAINST liens |
| 2025-12-11 | County lien portals blocking Playwright | Fixed - portals moved to `*.tx.publicsearch.us`, updated URLs |
| 2025-12-09 | Trustpilot SERP matching wrong companies | Fixed - now uses direct URL check (`trustpilot.com/review/{domain}`) |
| 2025-12-09 | JSON parse error in review_analyzer.js | Fixed - added error handling |
| 2025-12-08 | Only 4 contractors showing despite 116 qualified | Fixed - `passes_threshold` now updates correctly |

### County Lien Portals - RESOLVED (2025-12-11)
**Original Problem:** All Texas county OPR portals were blocking Playwright scrapers.

**Root Cause:** Portals moved to new URLs at `*.tx.publicsearch.us`.

**Fix:** Updated all county scraper URLs:
- `scrapers/county_liens/tarrant.py`
- `scrapers/county_liens/collin.py` (also increased wait time for loading)
- `scrapers/county_liens/dallas.py`

**Current Status:** All working - Tarrant (48 records), Collin (50 records), Dallas (942 records).
