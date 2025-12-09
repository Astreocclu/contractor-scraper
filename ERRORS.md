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

None at this time.
