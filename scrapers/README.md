# Permit Scrapers

## Last Updated: Dec 7, 2025

## Quick Start (Python - Preferred)
```bash
source venv/bin/activate && set -a && source .env && set +a

# MGO Connect (Irving, Lewisville, etc.)
python scrapers/mgo_connect.py Irving 50

# EnerGov (Southlake, Grand Prairie)
python scrapers/energov.py southlake 50

# Accela (Fort Worth, Dallas)
python scrapers/accela.py fort_worth 50

# Socrata/ArcGIS (Arlington - API-based, no browser)
python scrapers/dfw_big4_socrata.py --months 1
```

## Python Scrapers (Playwright) - PREFERRED
| Scraper | Portal | Cities | Status |
|---------|--------|--------|--------|
| `mgo_connect.py` | MGO Connect | Irving, Lewisville, Denton, Cedar Hill | Working |
| `energov.py` | EnerGov | Southlake, Grand Prairie, Princeton | Working |
| `accela.py` | Accela | Fort Worth, Dallas, Richardson | Ready to test |
| `dfw_big4_socrata.py` | Socrata/ArcGIS | Arlington (18k permits) | Working |

## Legacy Node.js Scrapers (Puppeteer) - DEPRECATED
| Scraper | Portal | Status |
|---------|--------|--------|
| `southlake.js` | EnerGov | Replaced by energov.py |
| `fort_worth.js` | Accela | Replaced by accela.py |
| `mgo_connect.js` | MGO Connect | Replaced by mgo_connect.py |
| `grand_prairie.js` | EnerGov | Replaced by energov.py |

## MGO Connect Credentials
Stored in `.env`:
- `MGO_EMAIL`
- `MGO_PASSWORD`

## Portal Reference
See `docs/dfw-contractor-audit-v3-corrected.md` for correct URLs.
