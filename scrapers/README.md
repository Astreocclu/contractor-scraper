# Permit Scrapers

## Last Updated: Dec 7, 2025

## Quick Start (Python - Preferred)
```bash
source venv/bin/activate && set -a && source .env && set +a

# EnerGov (9 cities - largest coverage)
python scrapers/energov.py southlake 50
python scrapers/energov.py mckinney 50     # NEW
python scrapers/energov.py allen 50        # NEW - high income ($85k)
python scrapers/energov.py farmers_branch 50  # NEW
python scrapers/energov.py colleyville 50  # high income ($95k)

# MGO Connect (5 cities)
python scrapers/mgo_connect.py Irving 50
python scrapers/mgo_connect.py Denton 50
python scrapers/mgo_connect.py Duncanville 50

# Accela (3 major cities - highest volume)
python scrapers/accela.py fort_worth 50
python scrapers/accela.py dallas 50
python scrapers/accela.py grand_prairie 50

# eTRAKiT (3 cities - premium markets)
python scrapers/etrakit.py frisco 50       # $146k median income!
python scrapers/etrakit.py keller 50       # NEW - $80k median
python scrapers/etrakit.py plano 50        # requires login

# Socrata/ArcGIS (Arlington - API-based, no browser)
python scrapers/dfw_big4_socrata.py --months 1
```

## Coverage Summary

| Scraper | Portal | Cities | Status |
|---------|--------|--------|--------|
| `energov.py` | EnerGov | Southlake, Grand Prairie, Princeton, Colleyville, DeSoto, **McKinney**, **Allen**, **Farmers Branch** (8) | Working |
| `mgo_connect.py` | MGO Connect | Irving, Lewisville, Denton, Cedar Hill, Duncanville (5) | Working |
| `accela.py` | Accela | Fort Worth, Dallas, Grand Prairie (3) | Working |
| `etrakit.py` | eTRAKiT | Frisco, Plano, **Keller** (3) | Working |
| `dfw_big4_socrata.py` | Socrata/API | Arlington (1) | Working |

**Total: 19 cities covered (63% of DFW Top 30)**

## Cities NOT Covered (Need New Scrapers)

| City | System | URL | Priority |
|------|--------|-----|----------|
| Mesquite | MagnetGov | mesquite.onlinegovt.com | High |
| Carrollton | CityView | cityserve.cityofcarrollton.com | High |
| Richardson | Custom | cor.net | High |
| Grapevine | MyGov | public.mygov.us | Medium |
| Rowlett | MyGov | web.mygov.us | Medium |
| Lancaster | MyGov | public.mygov.us/lancaster_tx | Medium |
| Sachse | SmartGov | bit.ly/SachsePermits | Low (new July '25) |
| Watauga | MyGov | - | Low |
| Garland | Paper/Email | - | No online portal |
| Balch Springs | Paper/Email | - | No online portal |

## Environment Variables
```bash
# Required
DEEPSEEK_API_KEY=your_key

# MGO Connect (login required)
MGO_EMAIL=your_email
MGO_PASSWORD=your_password
```

## Portal Reference
See `docs/dfw-contractor-audit-v3-corrected.md` for verified URLs and portal details.

## Recent Changes (Dec 7, 2025)
- Added McKinney, Allen, Farmers Branch to `energov.py`
- Added Keller to `etrakit.py`
- Removed invalid Richardson config from `accela.py` (returns 404)
- Corrected many "CSS (Tyler)" entries - actual systems vary widely
- Updated Irving JID from 320 to 245 in `mgo_connect.py`
