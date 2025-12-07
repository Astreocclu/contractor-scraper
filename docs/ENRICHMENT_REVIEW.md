# Enrichment Process Review

**Date:** 2025-12-06
**Status:** Critical gaps identified
**Author:** Claude Code Analysis

---

## Executive Summary

The contractor project has **two separate enrichment pipelines** that are **not properly connected**:

| Pipeline | Target | Status | Issue |
|----------|--------|--------|-------|
| Property/CAD Enrichment | Leads (homeowners) | Broken | Standalone scripts, not connected to Django |
| Contractor Enrichment | Contractors | Working | Django management commands functional |

**Key Finding:** 490 properties have been enriched with owner/value data, but **none are linked to the 510 A/B leads**. The enrichment ran on different addresses than the leads reference.

---

## Pipeline 1: Property/Lead Enrichment (CAD)

### Purpose
Enrich permit-based leads with County Appraisal District (CAD) data:
- Owner name
- Mailing address (for absentee detection)
- Market value
- Year built, square footage, lot size

### Current Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│ Permit Scraper  │────▶│ Standalone CAD Script│────▶│ SQLite (direct) │
│ (Django)        │     │ (tarrant_cad.py)     │     │ NOT Django ORM  │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                                  │
                                  ▼
                        ┌──────────────────────┐
                        │ scripts.utils module │
                        │ (MISSING/EXTERNAL)   │
                        └──────────────────────┘
```

### Files

| File | Purpose | Status |
|------|---------|--------|
| `clients/services/enrichment/tarrant_cad.py` | Tarrant County ArcGIS API | Has import error |
| `clients/services/enrichment/parker_cad.py` | Parker County | Placeholder only |
| `clients/services/scoring.py` | Lead scoring with property data | Works if data exists |
| `clients/management/commands/score_leads.py` | Django command | Works |

### Critical Issues

#### 1. Missing `scripts.utils` Module
```python
# tarrant_cad.py line 19-22
from scripts.utils import (
    PropertyData, rate_limit, setup_logging, save_property,
    normalize_address, get_db_connection, DATA_DIR
)
```
This module doesn't exist in the codebase. The CAD enrichment scripts appear to have been copied from an external project without their dependencies.

#### 2. Data Not Flowing to Django Models
The CAD scripts use `get_db_connection()` and `save_property()` which bypass Django ORM:
- Property data is saved somewhere, but not to Django's `leads_property` table
- Or it's saved with different address formatting that doesn't match

#### 3. Address Mismatch
```
A/B Lead addresses:     "5429 HUNTLY DR, Fort Worth TX 76109"
Enriched property:      "2552 S UNIVERSITY DR" (no city/zip)
```
Different address formats prevent matching.

### Data Status

| Metric | Count | Notes |
|--------|-------|-------|
| Total Properties in DB | 2,506 | |
| Enriched (status=success) | 490 | Have owner/value data |
| A/B Leads | 510 | |
| A/B Leads with enriched property | **0** | CRITICAL GAP |

### How Tarrant CAD Works (When Functional)

1. Query ArcGIS REST API: `https://tad.newedgeservices.com/arcgis/rest/services/TAD/ParcelView/MapServer/1/query`
2. Search by address using `Situs_Addr LIKE '123 %MAIN%'`
3. Returns: Owner_Name, Total_Valu, Year_Built, Living_Are, etc.
4. Detects absentee owners by comparing situs vs mailing address

### Fix Required

Option A: **Fix the standalone scripts**
1. Create `scripts/utils.py` with required functions
2. Ensure it writes to Django's `leads_property` table
3. Normalize addresses on both sides

Option B: **Rewrite as Django management command**
1. Create `clients/management/commands/enrich_properties.py`
2. Use Django ORM directly
3. Match on normalized addresses

---

## Pipeline 2: Contractor Enrichment

### Purpose
Enrich scraped contractor records with:
- Yelp ratings/reviews
- BBB rating, accreditation, complaint count
- Email addresses (scraped from websites)
- Trust scores

### Current Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│ Google Places   │────▶│ Django Commands      │────▶│ Django ORM      │
│ Scraper         │     │ (enrich_contractors) │     │ Contractor model│
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                                  │
                        ┌─────────┴─────────┐
                        ▼                   ▼
              ┌──────────────────┐  ┌──────────────────┐
              │ EnrichmentService│  │ YelpService      │
              │ (BBB scraping)   │  │ (Yelp API)       │
              └──────────────────┘  └──────────────────┘
```

### Files

| File | Purpose | Status |
|------|---------|--------|
| `contractors/services/enrichment.py` | BBB scraper + basic Yelp | Working |
| `contractors/services/yelp_service.py` | Yelp Fusion API | Working (needs API key) |
| `contractors/management/commands/enrich_contractors.py` | Django command | Working |
| `contractors/management/commands/scrape_emails.py` | Website email extraction | Working |
| `services/collection_service.js` | Node.js Puppeteer scraping | Working |

### Enrichment Sources

#### Python/Django Pipeline

| Source | Method | Status | Notes |
|--------|--------|--------|-------|
| BBB | Web scraping | Partial | Often blocked by Cloudflare |
| Yelp | Fusion API | Ready | Needs `YELP_API_KEY` |
| Email | Website scraping | Working | 44% success rate |

#### Node.js Pipeline (collection_service.js)

| Source | TTL | Tier | Status |
|--------|-----|------|--------|
| BBB | 24h | 1 | Working with parser |
| Yelp | 24h | 1 | Working |
| Google Maps | 24h | 1 | Working (local + HQ) |
| Angi | 24h | 1 | Working |
| Houzz | 24h | 1 | Working |
| Thumbtack | 24h | 1 | Working |
| Facebook | 24h | 1 | Working |
| Google News | 12h | 2 | Working |
| Reddit | 24h | 3 | Working |
| Indeed | 7d | 4 | Working |
| Glassdoor | 7d | 4 | Working |
| OSHA | 7d | 5 | Working |
| TDLR | 7d | 6 | Working (form submit) |
| Court Records | 7d | 7 | Working |

### Data Status

| Metric | Count | Notes |
|--------|-------|-------|
| Total Contractors | 1,525 | |
| With Email | 670 (44%) | Good capture rate |
| With Yelp Data | ~10 | API key needed |
| With BBB Data | ~10 | Scraping often fails |
| Audited (AI) | 10 | DeepSeek analysis |

### Commands

```bash
# Enrich contractors with BBB/Yelp
python manage.py enrich_contractors --limit 100

# Scrape emails from websites
python manage.py scrape_emails --deep --limit 100

# Run full audit (Node.js)
node run_audit.js --name "Company" --city "Dallas" --state "TX"
```

---

## Pipeline 3: Lead Scoring

### Purpose
Score leads based on multiple signals to prioritize outreach.

### Scoring Algorithm

| Signal | Max Points | Description |
|--------|------------|-------------|
| Permit Type | 50 | Pool=50, Patio=40, New Construction=45 |
| High Contrast | 20 | Property value vs neighborhood median |
| Absentee Owner | 15 | Mailing != property address |
| Freshness | 15 | Days since permit issued |
| **Total** | **100** | |

### Tier Thresholds

| Tier | Score Range | Count |
|------|-------------|-------|
| A | 80-100 | 34 |
| B | 60-79 | 476 |
| C | 40-59 | 246 |
| D | 0-39 | 1,240 |

### Current Limitation
Without CAD enrichment:
- No contrast scoring (market_value is NULL)
- No absentee detection (mailing_address is NULL)
- Leads max out at ~65 points (permit type + freshness only)

---

## Historical Changes

### Git History Summary

| Commit | Change |
|--------|--------|
| `9ae27c3` | Renamed `leads` app to `clients`, consolidated docs |
| `ec0c003` | Merged Scraper project into contractors as leads app |
| `ffb8441` | Enhanced audit with review analysis |
| `47ad665` | Added agentic audit system with fraud detection |
| `3c2f66e` | Added contractor enrichment pipeline |
| `49179dc` | Initial commit |

### Key Architectural Decisions

1. **Two Languages:** Python (Django) for data models + Node.js (Puppeteer) for scraping
2. **Standalone CAD Scripts:** Copied from external project, not integrated
3. **App Rename:** `leads` → `clients` (recent, may have broken imports)

---

## Recommendations

### Immediate (Fix Data Gap)

1. **Run CAD Enrichment on A/B Lead Addresses**
   ```bash
   # Option 1: Fix standalone script
   # Create scripts/utils.py with Django ORM integration

   # Option 2: Manual query each address via API
   python manage.py shell
   >>> from clients.services.enrichment.tarrant_cad import enrich_property
   >>> # Iterate through Lead.objects.filter(tier__in=['A','B'])
   ```

2. **Normalize Addresses**
   - Strip city/state/zip from permit addresses before CAD lookup
   - Store normalized version in `property_address_normalized`

### Short-term

3. **Create Django Management Command for CAD**
   ```python
   # clients/management/commands/enrich_properties.py
   # Use Django ORM instead of raw SQLite
   ```

4. **Add YELP_API_KEY**
   - Sign up at https://www.yelp.com/developers
   - Free tier: 5,000 calls/day

### Medium-term

5. **Unify Enrichment Pipeline**
   - Single entry point for all enrichment
   - Consistent data flow through Django ORM
   - Logging and retry logic

6. **Add Dallas/Collin/Denton CAD**
   - Currently only Tarrant County implemented
   - Many DFW leads are in other counties

---

## File Reference

### Property Enrichment
```
clients/services/enrichment/
├── __init__.py
├── tarrant_cad.py          # Tarrant County ArcGIS (broken import)
├── parker_cad.py           # Parker County (placeholder)
├── gemini_categorize.py    # AI permit categorization
└── neighborhood_medians.py # Median value calculations
```

### Contractor Enrichment
```
contractors/services/
├── enrichment.py           # BBB + basic Yelp
├── yelp_service.py         # Yelp Fusion API
├── ai_auditor.py           # DeepSeek analysis
├── scoring.py              # Trust score calculation
└── deduplication.py        # Duplicate detection

contractors/management/commands/
├── enrich_contractors.py   # BBB/Yelp enrichment
├── scrape_emails.py        # Website email scraping
├── audit_contractors.py    # Run AI audit
└── dedupe_contractors.py   # Remove duplicates

services/
├── collection_service.js   # Puppeteer multi-source scraping
├── audit_agent.js          # DeepSeek agent
├── audit_agent_v2.js       # Score enforcement
├── review_analyzer.js      # Fake review detection
└── orchestrator.js         # Audit coordination
```

---

## Appendix: Environment Variables

| Variable | Purpose | Status |
|----------|---------|--------|
| `YELP_API_KEY` | Yelp Fusion API | **Not configured** |
| `DEEPSEEK_API_KEY` | AI auditor | Configured |
| `GOOGLE_PLACES_API_KEY` | Google scraping | Configured |
| `COURTLISTENER_API_KEY` | Federal court records | Optional |

---

*Report generated: 2025-12-06*
