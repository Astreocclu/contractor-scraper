# DFW Top 30 Municipalities - Contractor Permitting Audit
## Corrected & Verified Systems (Dec 2025)

## Document Purpose
This audit document tracks contractor verification and permitting data access for the top 30 municipalities in the DFW metro area. **Updated Dec 6, 2025** to reflect the recent City of Dallas migration to Accela (DallasNow) and other confirmed system changes.

---

## Top 30 DFW Municipalities - Ranked by Income

| Rank | Municipality | County | Population | Median Income | Portal System | Status |
|------|---|---|---|---|---|---|
| 1 | Frisco | Collin | ~220,000 | $146,000 | **eTRAKiT** / CommunityCore | ✓ Verified |
| 2 | Southlake | Tarrant | ~38,000 | $130,000+ | **EnerGov** | ✓ Verified |
| 3 | McKinney | Collin | ~180,000 | $115,000+ | **ROWay / EnerGov** | ✓ Verified |
| 4 | Plano | Collin | ~280,000 | $105,000+ | **eTRAKiT** | ✓ Verified |
| 5 | Arlington | Tarrant | ~400,000 | $82,503 | **AMANDA** (ArlingtonPermits.com) | ✓ Verified |
| 6 | Fort Worth | Tarrant | ~900,000 | $82,503 | **Accela** | ✓ Verified |
| 7 | Grand Prairie | Tarrant | ~180,000 | $80,000+ | **Accela** | ✓ Verified |
| 8 | Irving | Dallas | ~220,000 | $78,000+ | **MGO Connect** | ✓ Verified |
| 9 | Dallas | Dallas | ~1,300,000 | $74,323 | **Accela** (DallasNow) | ✓ Verified |
| 10 | Garland | Dallas | ~240,000 | $72,000+ | **CSS** (Tyler) | Pending |
| 11 | Richardson | Dallas | ~115,000 | $70,000+ | **CSS** (Tyler) | Pending |
| 12 | Mesquite | Dallas | ~140,000 | $70,000+ | **CSS** (Tyler) | ✓ Verified |
| 13 | Lewisville | Denton | ~115,000 | $68,000+ | **MGO Connect** | ✓ Verified |
| 14 | Carrollton | Dallas | ~145,000 | $65,000+ | **CSS** (Tyler) | Pending |
| 15 | Denton | Denton | ~140,000 | $62,000+ | **MGO** / eTRAKiT (Legacy) | Pending |
| 16 | Farmers Branch | Dallas | ~35,000 | $60,000+ | **CSS** (Tyler) | Pending |
| 17 | Allen | Collin | ~105,000 | $85,000+ | **CSS** (Tyler) | Pending |
| 18 | Rowlett | Dallas | ~75,000 | $62,000+ | **CSS** (Tyler) | Pending |
| 19 | Cedar Hill | Dallas | ~13,000 | $58,000+ | **MGO Connect** | ✓ Verified |
| 20 | Grapevine | Tarrant | ~55,000 | $75,000+ | **EnerGov** | Pending |
| 21 | Duncanville | Dallas | ~40,000 | $60,000+ | **MGO Connect** | Pending |
| 22 | DeSoto | Dallas | ~55,000 | $62,000+ | **EnerGov** | Pending |
| 23 | Lancaster | Dallas | ~35,000 | $55,000+ | **MGO Connect** | Pending |
| 24 | Colleyville | Tarrant | ~25,000 | $95,000+ | **EnerGov** | Pending |
| 25 | Keller | Tarrant | ~18,000 | $80,000+ | **CSS** (Tyler) | Pending |
| 26 | Watauga | Tarrant | ~23,000 | $62,000+ | **MyGov** | Pending |
| 27 | Balch Springs | Dallas | ~25,000 | $50,000+ | **MGO Connect** | Pending |
| 28 | Sachse | Dallas | ~25,000 | $58,000+ | **MGO Connect** | Pending |
| 29 | Princeton | Collin | ~5,000 | $85,000+ | **EnerGov** | ✓ Verified |
| 30 | Texas City | Galveston | ~45,000 | $50,000+ | **MGO Connect** | Pending |

---

## Verified Permitting Portal Links (Dec 2025)

### Accela Systems (Major Cities)
*The City of Dallas migrated to Accela (branded as "DallasNow") in May 2025.*

| City | Direct URL | Notes |
|---|---|---|
| **Dallas** | `https://aca-prod.accela.com/DALLASTX/Cap/CapHome.aspx?module=Building&TabName=Home` | **NEW** (Launched May '25) |
| **Fort Worth** | `https://aca-prod.accela.com/CFW/Default.aspx` | "Accela Citizen Access" |
| **Grand Prairie** | `https://aca-prod.accela.com/GPTX/Default.aspx` | Access via city site |

### MGO Connect (Growing Adoption)
*My Government Online (MGO) is becoming the standard for mid-sized DFW suburbs.*

| City | Direct URL |
|---|---|
| **Irving** | `https://www.mgoconnect.org/cp?JID=320` |
| **Lewisville** | `https://www.mgoconnect.org/cp?JID=325` |
| **Cedar Hill** | `https://www.mgoconnect.org/cp?JID=305` |
| **Denton** | `https://www.mgoconnect.org/cp?JID=285` |

### EnerGov Self-Service (Tyler Tech)

| City | Direct URL | Pattern |
|---|---|---|
| **Southlake** | `https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService` | Verified |
| **Princeton** | `https://energov.cityofprinceton.com/EnerGov_Prod/SelfService` | Verified |
| **Colleyville** | `https://energov.cityofcolleyville.com/EnerGov_Prod/SelfService` | Pattern |

### eTRAKiT Systems (Legacy/Stable)

| City | Direct URL |
|---|---|
| **Plano** | `https://trakit.plano.gov/etrakit_prod/Search/permit.aspx` |
| **Frisco** | `https://etrakit.friscotexas.gov` (Plus CommunityCore) |

### AMANDA (Granicus)

| City | Direct URL |
|---|---|
| **Arlington** | `https://ap.arlingtontx.gov/AP/sfjsp?interviewID=PublicSearch` |

---

## Audit Checklist by Portal Type

### Accela Scraper (High Priority)
*These represent the largest volume of permits in DFW.*
- [ ] Dallas (DallasNow) - **New Scraper Required**
- [ ] Fort Worth
- [ ] Grand Prairie

### MGO Connect Scraper (High Volume)
*Standardized portal used by many mid-sized cities.*
- [ ] Irving
- [ ] Lewisville
- [ ] Cedar Hill
- [ ] Denton
- [ ] Duncanville
- [ ] Lancaster
- [ ] Balch Springs

### eTRAKiT Scraper (Premium Markets)
- [ ] Frisco
- [ ] Plano

### EnerGov Scraper
- [ ] Southlake
- [ ] Princeton
- [ ] Colleyville
- [ ] Grapevine

### AMANDA/Custom Scrapers
- [ ] Arlington (AMANDA)
- [ ] Garland (CSS/Custom)
- [ ] McKinney (ROWay)

---

## Migration Notes
- **Dallas:** Migrated from POSSE to **Accela** in May 2025. Old scrapers will fail.
- **Irving:** Moved to **MGO Connect** (previously referenced as generic online portal).
- **Lewisville:** Confirmed **MGO Connect**.
- **Frisco:** Hybrid environment. Most data still in **eTRAKiT**, but minor permits in **CommunityCore**.
- **Arlington:** Uses **AMANDA** (branded as ArlingtonPermits.com).

---

## Document Version
**Version:** 3.0 (Correction)  
**Last Updated:** December 6, 2025  
**Changes:** Corrected Dallas to Accela; Irving/Lewisville to MGO; Arlington to AMANDA.
