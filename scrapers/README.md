# Permit Scrapers

## Last Updated: Dec 6, 2025

## Quick Start
```bash
set -a && source .env && set +a
node scrapers/southlake.js 50
```

## Working Scrapers
| Scraper | Portal | Status |
|---------|--------|--------|
| `southlake.js` | EnerGov | Working |
| `fort_worth.js` | Accela | Working |

## New Scrapers (Untested)
| Scraper | Portal | Status |
|---------|--------|--------|
| `dallas.js` | Accela | Ready to test |
| `grand_prairie.js` | Accela | Ready to test |
| `richardson.js` | Accela | Ready to test |
| `mgo_connect.js` | MGO Connect | Login works, extraction TBD |

## MGO Connect
Covers: Irving, Lewisville, Denton, Cedar Hill

**Credentials in .env:**
- `MGO_EMAIL=resultsandgoaloriented@gmail.com`
- `MGO_PASSWORD=SleepyPanda123!`

**Usage:** `node scrapers/mgo_connect.js Irving 10`

**Status:** Login works. Extraction needs debugging - check `debug_html/mgo_irving_results.png`

## Multi-City Test
`multi_city_test.js` - Tests 12 cities, URLs corrected Dec 6.

## Portal Reference
See `docs/dfw-contractor-audit-v3-corrected.md` for correct URLs.
