# Session Handoff: Lead Scoring & CAD Enrichment
**Date:** 2025-12-08
**Status:** Complete - Ready for next engineer

---

## What Was Done

### 1. Imported Raw Scraped Permits
- Found **5,094 permits** in `*_raw.json` files from recent scraper runs
- Imported **2,357 new permits** (rest were duplicates already in DB)
- **Total permits in database: 4,703**

Raw JSON files processed:
- `dallas_raw.json`: 1000 permits
- `fort_worth_raw.json`: 1000 permits
- `keller_raw.json`: 1000 permits
- `mesquite_raw.json`: 1000 permits
- `irving_raw.json`: 399 permits
- `lewisville_raw.json`: 394 permits
- `frisco_raw.json`: 200 permits
- `allen_raw.json`: 100 permits

### 2. Added Collin County to CAD Enrichment
**File:** `clients/management/commands/enrich_cad.py`

Changes made:
- Added Collin County API config using City of Allen's ArcGIS endpoint
- API URL: `https://gismaps.cityofallen.org/arcgis/rest/services/ReferenceData/Collin_County_Appraisal_District_Parcels/MapServer/1/query`
- Added Collin County zip codes (75002, 75013, 75069-75098, etc.)
- Fixed `extract_street_address()` to handle more DFW city names (was only stripping "Fort Worth")
- Added Collin to `supported_counties` list

**Tested and working** - example:
```
Address: 14 HERITAGE WOODS PL ALLEN TX 75002
Owner: COLVER THOMAS F
Value: $498,102
```

### 3. Scored 1000 Leads with V2 System
**Command:** `python3 manage.py score_leads_v2 --limit 1000 --concurrent 5 --save-to-db`

Results:
| Metric | Count |
|--------|-------|
| Input | 1,000 |
| Discarded | 343 |
| Scored | 657 |
| Tier A (80+) | 37 |
| Tier B (50-79) | 183 |
| Tier C (<50) | 437 |

Database:
- 589 new ScoredLead records created
- 68 existing records updated
- **Total ScoredLeads: 657**

---

## Current Database State

```
Permits:        4,703
Properties:     4,042
  - Enriched:   1,534
  - Failed:     ~550
  - Pending:    ~1,958
ScoredLeads:    657
Unscored:       ~4,046
```

---

## Key Files

| Purpose | File |
|---------|------|
| V2 Scoring command | `clients/management/commands/score_leads_v2.py` |
| V2 Scoring service | `clients/services/scoring_v2.py` |
| CAD enrichment | `clients/management/commands/enrich_cad.py` |
| Models | `clients/models.py` (Permit, Property, ScoredLead) |
| Exports | `exports/` (organized by trade_group/category/tier) |

---

## Next Steps

### Priority 1: Score Remaining Permits
```bash
# ~4,046 permits still unscored
python3 manage.py score_leads_v2 --limit 500 --save-to-db
```

### Priority 2: Enrich More Properties
Many Collin County properties now have API support but haven't been enriched yet.

The `enrich_cad` command works on the OLD Lead model. To enrich new permits directly, either:
1. Create Lead records for new permits, OR
2. Write a script to enrich Properties directly (see session for example)

### Priority 3: Handle "No Owner/Market Value" Discards
210 permits were discarded due to missing data. These are from cities without CAD API coverage or failed enrichment. Consider:
- Adding more county APIs (Rockwall, Kaufman)
- Retrying failed enrichments with alternative address formats

---

## Commands Reference

```bash
# Activate environment
source venv/bin/activate && set -a && . ./.env && set +a

# Check stats
python3 manage.py score_leads_v2 --stats

# Dry run (preview what would be scored)
python3 manage.py score_leads_v2 --limit 100 --dry-run

# Score and save to DB
python3 manage.py score_leads_v2 --limit 500 --save-to-db

# Score with chain-of-thought reasoning (slower)
python3 manage.py score_leads_v2 --limit 100 --reasoner --save-to-db

# CAD enrichment (uses old Lead model)
python3 manage.py enrich_cad --limit 50
```

---

## API Keys Required
- `DEEPSEEK_API_KEY` - for AI scoring (in `.env`)

---

## Export Structure
```
exports/
├── luxury_outdoor/
│   ├── pool/
│   │   ├── tier_a.csv  (6 leads)
│   │   ├── tier_b.csv  (5 leads)
│   │   └── tier_c.csv  (3 leads)
│   ├── fence/
│   └── outdoor_living/
├── home_systems/
│   ├── plumbing/
│   ├── electrical/
│   └── hvac/
├── structural/
│   ├── foundation/
│   ├── roof/
│   └── remodel/
└── flagged/
    └── needs_review.csv  (189 leads)
```

---

## Known Issues

1. **Collin County situs_num field** - The API uses string type for house numbers, so queries use `= '14'` not `= 14`

2. **High discard rate** - 34% of permits discarded due to:
   - Missing owner name AND market value (need CAD enrichment)
   - Junk project types (sheds, water heaters, etc.)
   - Production builders (Lennar, DR Horton, etc.)

3. **Flagged for review** - 189 leads flagged, likely edge cases needing manual review

---

## Session Notes

- User mentioned "5k leads" but raw files only had 5,094, with ~2,700 being duplicates
- Collin County API is hosted by City of Allen, updates weekly on Fridays
- Scoring uses DeepSeek API with async batching (concurrent=5 for overnight runs)
