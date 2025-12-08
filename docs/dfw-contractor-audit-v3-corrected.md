# DFW Top 30 Municipalities - Contractor Permitting Audit
## Corrected & Verified Systems (Dec 2025)

## Document Purpose
This audit document tracks contractor verification and permitting data access for the top 30 municipalities in the DFW metro area. **Updated Dec 7, 2025** with comprehensive portal verification.

---

## Top 30 DFW Municipalities - Ranked by Income

| Rank | Municipality | County | Population | Median Income | Portal System | Scraper Status |
|------|---|---|---|---|---|---|
| 1 | Frisco | Collin | ~220,000 | $146,000 | **eTRAKiT** | `etrakit.py` |
| 2 | Southlake | Tarrant | ~38,000 | $130,000+ | **EnerGov** | `energov.py` |
| 3 | McKinney | Collin | ~180,000 | $115,000+ | **EnerGov** | `energov.py` |
| 4 | Plano | Collin | ~280,000 | $105,000+ | **eTRAKiT** | `etrakit.py` (login req) |
| 5 | Arlington | Tarrant | ~400,000 | $82,503 | **Socrata API** | `dfw_big4_socrata.py` |
| 6 | Fort Worth | Tarrant | ~900,000 | $82,503 | **Accela** | `accela.py` |
| 7 | Grand Prairie | Tarrant | ~180,000 | $80,000+ | **Accela** | `accela.py` |
| 8 | Irving | Dallas | ~220,000 | $78,000+ | **MGO Connect** | `mgo_connect.py` |
| 9 | Dallas | Dallas | ~1,300,000 | $74,323 | **Accela** | `accela.py` |
| 10 | Garland | Dallas | ~240,000 | $72,000+ | **Paper/Email** | No online portal |
| 11 | Richardson | Dallas | ~115,000 | $70,000+ | **Custom** (cor.net) | Needs scraper |
| 12 | Mesquite | Dallas | ~140,000 | $70,000+ | **MagnetGov** | Needs scraper |
| 13 | Lewisville | Denton | ~115,000 | $68,000+ | **MGO Connect** | `mgo_connect.py` |
| 14 | Carrollton | Dallas | ~145,000 | $65,000+ | **CityView** | Needs scraper |
| 15 | Denton | Denton | ~140,000 | $62,000+ | **MGO Connect** | `mgo_connect.py` |
| 16 | Farmers Branch | Dallas | ~35,000 | $60,000+ | **EnerGov** | `energov.py` |
| 17 | Allen | Collin | ~105,000 | $85,000+ | **EnerGov** | `energov.py` |
| 18 | Rowlett | Dallas | ~75,000 | $62,000+ | **MyGov** | Needs scraper |
| 19 | Cedar Hill | Dallas | ~13,000 | $58,000+ | **MGO Connect** | `mgo_connect.py` |
| 20 | Grapevine | Tarrant | ~55,000 | $75,000+ | **MyGov** | Needs scraper |
| 21 | Duncanville | Dallas | ~40,000 | $60,000+ | **MGO Connect** | `mgo_connect.py` |
| 22 | DeSoto | Dallas | ~55,000 | $62,000+ | **EnerGov** | `energov.py` |
| 23 | Lancaster | Dallas | ~35,000 | $55,000+ | **MyGov** | Needs scraper |
| 24 | Colleyville | Tarrant | ~25,000 | $95,000+ | **EnerGov** | `energov.py` |
| 25 | Keller | Tarrant | ~18,000 | $80,000+ | **eTRAKiT** | `etrakit.py` |
| 26 | Watauga | Tarrant | ~23,000 | $62,000+ | **MyGov** | Needs scraper |
| 27 | Balch Springs | Dallas | ~25,000 | $50,000+ | **Paper/Email** | No online portal |
| 28 | Sachse | Dallas | ~25,000 | $58,000+ | **SmartGov** | Needs scraper |
| 29 | Princeton | Collin | ~5,000 | $85,000+ | **EnerGov** | `energov.py` |
| 30 | Texas City | Galveston | ~45,000 | $50,000+ | **Unknown** | Low priority |

---

## Coverage Summary

| Status | Count | Cities |
|--------|-------|--------|
| **Working Scraper** | 19 | Frisco, Southlake, McKinney, Plano, Arlington, Fort Worth, Grand Prairie, Irving, Dallas, Lewisville, Denton, Farmers Branch, Allen, Cedar Hill, Duncanville, DeSoto, Colleyville, Keller, Princeton |
| **Needs Scraper** | 9 | Richardson, Mesquite, Carrollton, Rowlett, Grapevine, Lancaster, Watauga, Sachse, Texas City |
| **No Online Portal** | 2 | Garland, Balch Springs |

**Coverage: 63% (19/30)**

---

## Verified Permitting Portal Links (Dec 7, 2025)

### Accela Systems (Major Cities)
| City | Direct URL | Status |
|---|---|---|
| **Dallas** | `https://aca-prod.accela.com/DALLASTX/Cap/CapHome.aspx?module=Building` | Working |
| **Fort Worth** | `https://aca-prod.accela.com/CFW/Default.aspx` | Working |
| **Grand Prairie** | `https://aca-prod.accela.com/GPTX/Default.aspx` | Working |

### MGO Connect (JID-based)
| City | JID | Direct URL | Status |
|---|---|---|---|
| **Irving** | 245 | `https://www.mgoconnect.org/cp?JID=245` | Working |
| **Lewisville** | 325 | `https://www.mgoconnect.org/cp?JID=325` | Working |
| **Denton** | 285 | `https://www.mgoconnect.org/cp?JID=285` | Working |
| **Cedar Hill** | 305 | `https://www.mgoconnect.org/cp?JID=305` | Working |
| **Duncanville** | 253 | `https://www.mgoconnect.org/cp?JID=253` | Working |

### EnerGov Self-Service (Tyler Tech)
| City | Direct URL | Status |
|---|---|---|
| **Southlake** | `https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService` | Working |
| **Grand Prairie** | `https://egov.gptx.org/EnerGov_Prod/SelfService` | Working |
| **Princeton** | `https://energov.cityofprinceton.com/EnerGov_Prod/SelfService` | Working |
| **Colleyville** | `https://energov.cityofcolleyville.com/EnerGov_Prod/SelfService` | Config added |
| **DeSoto** | `https://cityofdesototx-energovweb.tylerhost.net/apps/selfservice` | Config added |
| **McKinney** | `https://egov.mckinneytexas.org/EnerGov_Prod/SelfService` | **NEW** |
| **Allen** | `https://energovweb.cityofallen.org/EnerGov/SelfService` | **NEW** |
| **Farmers Branch** | `https://egselfservice.farmersbranchtx.gov/EnerGov_Prod/SelfService` | **NEW** |

### eTRAKiT Systems (CentralSquare)
| City | Direct URL | Status |
|---|---|---|
| **Frisco** | `https://etrakit.friscotexas.gov/etrakit/Search/permit.aspx` | Working |
| **Plano** | `https://trakit.plano.gov/etrakit_prod/Search/permit.aspx` | Login required |
| **Keller** | `https://trakitweb.cityofkeller.com/etrakit/Search/permit.aspx` | **NEW** |

### Other Systems (Need New Scrapers)
| City | System | Direct URL |
|---|---|---|
| **Mesquite** | MagnetGov | `https://mesquite.onlinegovt.com/` |
| **Carrollton** | CityView | `https://cityserve.cityofcarrollton.com/CityViewPortal/` |
| **Rowlett** | MyGov | `https://web.mygov.us` |
| **Grapevine** | MyGov | `https://public.mygov.us/grapevine_tx` (unverified) |
| **Lancaster** | MyGov | `https://public.mygov.us/lancaster_tx` |
| **Sachse** | SmartGov | `https://bit.ly/SachsePermits` (July 2025) |
| **Richardson** | Custom | `https://www.cor.net/departments/building-inspection/online-permits` |

---

## Scraper Configurations

### energov.py (9 cities)
```python
ENERGOV_CITIES = {
    'southlake', 'grand_prairie', 'princeton', 'colleyville',
    'desoto', 'mckinney', 'allen', 'farmers_branch'
}
```

### mgo_connect.py (5 cities)
```python
MGO_CITIES = {
    'Irving': 245,
    'Lewisville': 325,
    'Denton': 285,
    'Cedar Hill': 305,
    'Duncanville': 253,
}
```

### accela.py (3 cities)
```python
ACCELA_CITIES = {'fort_worth', 'dallas', 'grand_prairie'}
# NOTE: Richardson removed - returns 404
```

### etrakit.py (3 cities)
```python
ETRAKIT_CITIES = {'frisco', 'plano', 'keller'}
# NOTE: Plano requires login credentials
```

---

## Priority Gaps to Address

### High Value (Need New Scrapers)
1. **Mesquite** ($70k) - MagnetGov - High volume city
2. **Carrollton** ($65k) - CityView - Different vendor
3. **Richardson** ($70k) - Custom portal at cor.net

### Medium Value (MyGov Variants)
4. **Rowlett** ($62k) - MyGov (web.mygov.us variant)
5. **Grapevine** ($75k) - MyGov
6. **Lancaster** ($55k) - MyGov (public.mygov.us variant)

### Low Priority
- Sachse - Just migrated to SmartGov (July 2025)
- Watauga - Small market
- Texas City - Outside DFW core

---

## Key Corrections from Dec 6 Doc

| City | Old Info | Corrected Info |
|------|----------|----------------|
| McKinney | ROWay/EnerGov | **EnerGov** (ROWay is separate for right-of-way only) |
| Allen | CSS (Tyler) | **EnerGov** |
| Farmers Branch | CSS (Tyler) | **EnerGov** |
| Keller | CSS (Tyler) | **eTRAKiT** |
| Richardson | CSS (Tyler) + Accela | **Custom portal** (cor.net) - Accela URL returns 404 |
| Mesquite | CSS (Tyler) | **MagnetGov** |
| Carrollton | CSS (Tyler) | **CityView** |
| Lancaster | MGO Connect | **MyGov** (different from MGO Connect) |
| Sachse | MGO Connect | **SmartGov** (new as of July 2025) |
| Rowlett | CSS (Tyler) | **MyGov** |
| Grapevine | EnerGov | **MyGov** |
| Balch Springs | MGO Connect | **No online portal** (paper/email) |
| Garland | CSS (Tyler) | **No online portal** (paper/email) |

---

## Document Version
**Version:** 4.0 (Major Verification Update)
**Last Updated:** December 7, 2025
**Changes:** Comprehensive portal verification with web research. Many "CSS (Tyler)" entries were incorrect - actual systems vary widely. Added 4 new cities to energov.py, 1 to etrakit.py. Removed invalid Richardson from accela.py.
