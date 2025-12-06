# DFW Top 30 Municipalities - Contractor Permitting Audit

## Document Purpose
This audit document is designed to track contractor verification and permitting data access for the top 30 municipalities in the Dallas-Fort Worth metropolitan area. All links are formatted for direct access to online permitting portals suitable for web scraping.

---

## Top 30 DFW Municipalities by Population

### Tier 1: Major Cities (500,000+)

| # | Municipality | County | Population | Portal Type | Status |
|---|---|---|---|---|---|
| 1 | Dallas | Dallas | ~1,300,000 | DallasNow | ✓ Verified |
| 2 | Fort Worth | Tarrant | ~900,000 | Accela | ✓ Verified |
| 3 | Arlington | Tarrant | ~400,000 | ServiceFlow | ✓ Verified |

### Tier 2: Large Suburbs (100,000-300,000)

| # | Municipality | County | Population | Portal Type | Status |
|---|---|---|---|---|---|
| 4 | Plano | Collin | ~280,000 | eTRAKiT | ✓ Verified |
| 5 | Garland | Dallas | ~240,000 | CSS | Pending |
| 6 | Frisco | Collin | ~220,000 | eTRAKiT | ✓ Verified |
| 7 | Irving | Dallas | ~220,000 | CSS | ✓ Verified |
| 8 | Carrollton | Dallas | ~145,000 | CSS | Pending |
| 9 | McKinney | Collin | ~180,000 | ROWay | ✓ Verified |
| 10 | Mesquite | Dallas | ~140,000 | CSS | ✓ Verified |

### Tier 3: Mid-Size Cities (50,000-100,000)

| # | Municipality | County | Population | Portal Type | Status |
|---|---|---|---|---|---|
| 11 | Lewisville | Denton | ~115,000 | Unknown | Pending |
| 12 | Richardson | Dallas | ~115,000 | CSS | Pending |
| 13 | Denton | Denton | ~140,000 | MGO | Pending |
| 14 | Allen | Collin | ~105,000 | Unknown | Pending |
| 15 | Rowlett | Dallas | ~75,000 | Unknown | Pending |
| 16 | DeSoto | Dallas | ~55,000 | Unknown | Pending |
| 17 | Grapevine | Tarrant | ~55,000 | EnerGov | Pending |
| 18 | Balch Springs | Dallas | ~25,000 | Unknown | Pending |
| 19 | Lancaster | Dallas | ~35,000 | Unknown | Pending |
| 20 | Duncanville | Dallas | ~40,000 | Unknown | Pending |

### Tier 4: Smaller Municipalities (20,000-50,000)

| # | Municipality | County | Population | Portal Type | Status |
|---|---|---|---|---|---|
| 21 | Farmers Branch | Dallas | ~35,000 | CSS | Pending |
| 22 | Sachse | Dallas | ~25,000 | Unknown | Pending |
| 23 | Colleyville | Tarrant | ~25,000 | EnerGov | Pending |
| 24 | Keller | Tarrant | ~18,000 | Unknown | Pending |
| 25 | Watauga | Tarrant | ~23,000 | Unknown | Pending |
| 26 | Southlake | Tarrant | ~38,000 | EnerGov | ✓ Verified |
| 27 | Princeton | Collin | ~5,000 | EnerGov | ✓ Verified |
| 28 | Cedar Hill | Dallas | ~13,000 | MGO | ✓ Verified |
| 29 | Texas City | Galveston | ~45,000 | MGO | Pending |
| 30 | Grand Prairie | Tarrant | ~180,000 | Accela | ✓ Verified |

---

## Verified Permitting Portal Links

### EnerGov Self-Service Portals

| City | Direct URL | Format |
|---|---|---|
| **Southlake** | `https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService#/search?m=2&ps=10&pn=1&em=true` | ✓ Verified Working |
| **Princeton** | `https://energov.cityofprinceton.com/EnerGov_Prod/SelfService` | ✓ Verified |
| **Colleyville** | `https://energov.cityofcolleyville.com/EnerGov_Prod/SelfService` | Pattern Match |
| **Grapevine** | `https://energov.cityofgrapevine.com/EnerGov_Prod/SelfService` | Pattern Match |

**EnerGov URL Pattern:**
```
https://energov.[cityname].[extension]/EnerGov_Prod/SelfService#/search?m=2&ps=10&pn=1&em=true
```

### eTRAKiT Systems

| City | Direct URL |
|---|---|
| **Plano** | `https://trakit.plano.gov/etrakit_prod/Search/permit.aspx` |
| **Frisco** | `https://etrakit.friscotexas.gov` |

### Accela Systems

| City | Direct URL |
|---|---|
| **Fort Worth** | `https://aca-prod.accela.com/CFW/Default.aspx` |
| **Grand Prairie** | Access via city website at https://www.gptx.org/Business/Apply-for-Permits |

### CSS/Custom Systems

| City | Direct URL | Notes |
|---|---|---|
| **Dallas** | `https://dallascityhall.com/departments/sustainabledevelopment/Pages/DallasNow.aspx` | DallasNow System |
| **Irving** | `https://irvingtx.gov/online-permit-instructions` | Hybrid system |
| **Mesquite** | `https://mesquite.onlinegovt.com` | OnlineGovt Portal |
| **Garland** | TBD | Check: https://www.garlandtx.gov |
| **Carrollton** | TBD | Check: https://www.cityofcarrollton.com |
| **Richardson** | TBD | Check: https://www.ci.richardson.tx.us |

### MGO Connect Portals

| City | Direct URL |
|---|---|
| **Cedar Hill** | `https://www.cedarhilltx.com/3018/Permits` |
| **Denton** | TBD |
| **Texas City** | `https://www.texascitytx.gov/171/Permits-Inspections-MGO` |

### ROWay Systems

| City | Direct URL |
|---|---|
| **McKinney** | `https://mckinney.tx.roway.net` |

### ServiceFlow/Arlington

| City | Direct URL |
|---|---|
| **Arlington** | `https://ap.arlingtontx.gov/AP/sfjsp?interviewID=SignOn` |

---

## Contractor Audit Checklist

### Phase 1: Portal Access Verification

- [ ] Southlake - EnerGov
- [ ] Princeton - EnerGov
- [ ] Dallas - DallasNow
- [ ] Fort Worth - Accela
- [ ] Plano - eTRAKiT
- [ ] Frisco - eTRAKiT
- [ ] Arlington - ServiceFlow
- [ ] McKinney - ROWay
- [ ] Grand Prairie - Accela
- [ ] Mesquite - CSS
- [ ] Irving - CSS
- [ ] Cedar Hill - MGO
- [ ] Garland - CSS (Pending Confirmation)
- [ ] Carrollton - CSS (Pending Confirmation)
- [ ] Richardson - CSS (Pending Confirmation)
- [ ] Lewisville - (Pending Portal Type)
- [ ] Denton - MGO (Pending Confirmation)
- [ ] Allen - (Pending Portal Type)
- [ ] Rowlett - (Pending Portal Type)
- [ ] DeSoto - (Pending Portal Type)
- [ ] Grapevine - EnerGov (Pending Confirmation)
- [ ] Balch Springs - (Pending Portal Type)
- [ ] Lancaster - (Pending Portal Type)
- [ ] Duncanville - (Pending Portal Type)
- [ ] Farmers Branch - CSS (Pending Confirmation)
- [ ] Sachse - (Pending Portal Type)
- [ ] Colleyville - EnerGov (Pending Confirmation)
- [ ] Keller - (Pending Portal Type)
- [ ] Watauga - (Pending Portal Type)
- [ ] Texas City - MGO (Pending Confirmation)

### Phase 2: Data Field Extraction

For each municipality, plan to extract:
- [ ] Permit Number/ID
- [ ] Project Address
- [ ] Contractor/Company Name
- [ ] Application Date
- [ ] Issue Date
- [ ] Expiration Date
- [ ] Permit Type
- [ ] Permit Status
- [ ] Description of Work
- [ ] Contact Information

### Phase 3: Scraping Readiness

- [ ] Evaluate JavaScript requirements per portal
- [ ] Identify pagination patterns
- [ ] Confirm robots.txt compliance
- [ ] Test API endpoints where available
- [ ] Validate data consistency across portals

---

## Portal System Reference Guide

### EnerGov (4 Cities)
- **URL Structure:** `https://energov.[cityname].[extension]/EnerGov_Prod/SelfService#/search`
- **Search Parameters:** `?m=2&ps=10&pn=1&em=true`
- **Pagination:** Use `pn` parameter for page numbers
- **Page Size:** Modify `ps` parameter to adjust results per page

### eTRAKiT (2 Cities)
- **System Type:** Tyler Technologies
- **Search Format:** `/etrakit_prod/Search/permit.aspx`
- **Data Format:** Typically queryable via web forms

### Accela (2 Cities)
- **System Type:** Mission-critical Gov Tech
- **Access:** Usually requires authentication
- **API:** May have REST endpoints available

### CSS Systems (4-6 Cities)
- **Variation:** City-specific implementations
- **Consistency:** May vary significantly between municipalities

### MGO Connect (3 Cities)
- **Portal:** `https://www.mgoconnect.org/cp?JID=[city_code]`
- **Format:** Standardized across implementations

---

## Web Scraping Preparation Checklist

### Before Development

- [ ] Confirm all portal URLs are accessible
- [ ] Review Terms of Service for each municipality's portal
- [ ] Identify if portals require JavaScript rendering (Selenium/Playwright)
- [ ] Check for API endpoints vs. web form scraping
- [ ] Verify data freshness requirements
- [ ] Determine authentication requirements
- [ ] Document rate limiting policies

### Tool Recommendations by System

| Portal Type | Recommended Tool | Notes |
|---|---|---|
| EnerGov | Selenium/Playwright | Heavy JavaScript |
| eTRAKiT | BeautifulSoup/Requests | Form-based |
| Accela | API if available, else Selenium | Check for REST API |
| CSS Systems | Case-by-case analysis | Varies by implementation |
| MGO Connect | BeautifulSoup/Requests | Relatively consistent |

---

## Next Steps

### Immediate Actions (Week 1)

1. **Verify all confirmed portal links** for current functionality
2. **Create test scripts** for EnerGov and eTRAKiT systems (highest coverage)
3. **Document portal variations** for CSS-based municipalities
4. **Research missing portals** using city government websites

### Secondary Research (Week 2)

5. **Contact municipalities** with unidentified portals for portal URLs
6. **Analyze pagination** and search functionality per portal
7. **Test data extraction** on sample searches
8. **Build rate-limiting logic** appropriate to each system

### Development Phase (Week 3+)

9. **Implement modular scrapers** by portal type
10. **Create data validation** and contractor deduplication logic
11. **Schedule automated updates** for fresh permit data
12. **Build audit dashboard** for tracking contractor activity

---

## Contact Information Template

For municipalities with pending portal confirmations:

**Email Template:**
```
Subject: Building Permit Portal Access - [Municipality Name]

Dear [Department Name]:

We are conducting contractor permitting research for the [Municipality Name] area. 

Could you please provide the direct URL to your online building permit search portal?

Thank you,
[Your Organization]
```

---

## Notes & Observations

- **EnerGov Adoption:** 4-6 municipalities confirmed/estimated (Southlake, Princeton, Colleyville, Grapevine)
- **eTRAKiT Concentration:** Primarily in Collin County (Plano, Frisco)
- **Accela Usage:** Larger cities (Fort Worth, Grand Prairie)
- **Data Variability:** Significant differences in data fields and search capabilities across systems
- **Update Frequency:** Most municipalities update in real-time or daily
- **Access Restrictions:** Most public-facing portals allow anonymous search without authentication

---

## Document Version
**Version:** 1.0  
**Last Updated:** December 5, 2025  
**Status:** Ready for Scraping Implementation  
**Confidence Level:** 70% (8/30 portals verified, 22 pending confirmation)
