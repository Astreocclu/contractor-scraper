# Session Handoff: CAD Enrichment City Fallback Fix

**Date:** 2025-12-08
**Status:** IN PROGRESS - 80% complete, needs one more edit

---

## Summary

Fixing CAD enrichment to work with Frisco permits that lack zip codes in their addresses. The enrichment uses zip codes to determine which county CAD to query, but Frisco addresses from eTRAKiT only have street addresses (e.g., "13108 MAPLETON DR" with no city/state/zip).

---

## Problem

### Root Cause
1. Frisco permits scraped from eTRAKiT have addresses like: `13108 MAPLETON DR`
2. CAD enrichment uses `get_county_from_zip(address)` to determine county
3. No zip code = returns `None` = tries all counties blindly = fails

### Evidence
```python
# What Frisco addresses look like in DB:
B25-00001 | 13108 MAPLETON DR
B25-00002 | 11471 MOUSER LN
B25-00003 | 12505 LEBANON RD
```

---

## Changes Made

### File: `clients/management/commands/enrich_cad.py`

#### 1. Added CITY_TO_COUNTY mapping (lines 219-283)
```python
CITY_TO_COUNTY = {
    # Collin County cities
    'frisco': 'collin',
    'allen': 'collin',
    'mckinney': 'collin',
    'plano': 'collin',
    # ... (full DFW city list)

    # Denton County cities
    'denton': 'denton',
    'lewisville': 'denton',
    # ...

    # Tarrant County cities
    'fort worth': 'tarrant',
    'arlington': 'tarrant',
    # ...

    # Dallas County cities
    'dallas': 'dallas',
    'irving': 'dallas',
    # ...
}
```

#### 2. Added `get_county_from_city()` function (lines 286-290)
```python
def get_county_from_city(city):
    """Get county from city name."""
    if not city:
        return None
    return CITY_TO_COUNTY.get(city.lower().strip())
```

#### 3. Updated county detection in handle() (lines 816-820)
```python
# Detect county for display - try zip first, then city
detected_county = get_county_from_zip(address)
if not detected_county:
    detected_county = get_county_from_city(permit.city)
county_display = detected_county.upper() if detected_county else '???'
```

---

## REMAINING WORK (Not Yet Done)

### 1. Update `query_cad_multi_county()` to accept county hint

The function at line 633 needs to accept an optional `county_hint` parameter:

**Current (line 633-659):**
```python
def query_cad_multi_county(address, timeout=30):
    # Determine primary county from zip
    primary_county = get_county_from_zip(address)
    ...
```

**Should become:**
```python
def query_cad_multi_county(address, county_hint=None, timeout=30):
    # Determine primary county from zip, or use hint
    primary_county = get_county_from_zip(address) or county_hint
    ...
```

### 2. Update the call site in handle() (line 837)

**Current:**
```python
cad_data, county_name, variant_used = query_cad_multi_county(address)
```

**Should become:**
```python
cad_data, county_name, variant_used = query_cad_multi_county(address, county_hint=detected_county)
```

---

## Related Context

### Prior Work This Session
1. Fixed `scoring_v2.py` to populate `contractor_name` in `from_permit_model()` (line 174)
2. Scored 50 Frisco permits - all scored Tier C (10-15) due to missing owner/value data
3. Realized CAD enrichment was needed to get owner names and market values

### Scoring Results (Before Enrichment)
```
Input:     50
Discarded: 0
Scored:    50
Tier A (80+):  0
Tier B (50-79): 0
Tier C (<50):   50
```

AI correctly identified missing data:
> "The owner is 'Unknown,' making direct contact impossible, and the $0 market value provides no ability to assess the homeowner's wealth"

### Database State
- 895 Frisco permits in database (from earlier session)
- 50 have ScoredLead records (all Tier C)
- 0 have Property records with CAD data

---

## Commands to Test

```bash
cd /home/reid/testhome/contractors
source venv/bin/activate && set -a && source .env && set +a

# After completing the remaining edits, test with:
python3 manage.py enrich_cad --limit 10

# Expected output should show [COLLIN] for Frisco addresses:
# [1/10] [COLLIN] 13108 MAPLETON DR
#   -> [Collin] Owner: SMITH JOHN | Value: $450,000

# Then re-score to see improved scores:
python3 manage.py score_leads_v2 --city Frisco --limit 50 --save-to-db --rescore
```

---

## Files Modified This Session

| File | Status | Changes |
|------|--------|---------|
| `clients/services/scoring_v2.py` | COMPLETE | Added `contractor_name` to `from_permit_model()` |
| `clients/management/commands/enrich_cad.py` | 80% DONE | Added city-to-county mapping, need to wire it through |

---

## Collin County CAD API Info

Already configured in `COUNTY_CONFIGS['collin']`:
- **URL:** `https://gismaps.cityofallen.org/arcgis/rest/services/ReferenceData/Collin_County_Appraisal_District_Parcels/MapServer/1/query`
- **Query format:** `GIS_DBO_AD_Entity_situs_num = '13108' AND GIS_DBO_AD_Entity_situs_street LIKE '%MAPLETON%'`

The API is confirmed working - just need to pass the county hint so it tries Collin first.

---

## Quick Reference

```bash
# Check Frisco permit count
python3 manage.py shell -c "from clients.models import Permit; print(Permit.objects.filter(city='Frisco').count())"

# Check Property records for Frisco
python3 manage.py shell -c "from clients.models import Property; print(Property.objects.filter(property_address__contains='Frisco').count())"

# Check scored leads
python3 manage.py shell -c "from clients.models import ScoredLead; print(ScoredLead.objects.filter(permit__city='Frisco').count())"
```
