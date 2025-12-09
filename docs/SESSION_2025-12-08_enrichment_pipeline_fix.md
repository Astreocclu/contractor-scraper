# Session: Enrichment Pipeline Fix
**Date:** 2025-12-08
**Status:** Partially complete - enrichment needs to run

---

## Problem Discovered

CAD enrichment was only at **38%** despite the system being "functional". Investigation revealed a fundamental architecture flaw.

### Root Cause

`enrich_cad.py` was querying `Lead.objects.all()` instead of `Permit.objects.all()`:

```python
# BROKEN (was this)
leads = Lead.objects.all().select_related('property')
for lead in leads:
    prop = lead.property  # Only enriches if Lead exists!
```

This meant:
- **49% of Properties were stuck as "pending"** - they had no Lead pointing to them
- **1,914 orphan Properties** accumulated (existed in DB with no matching Permit)
- Scoring failed silently because CAD data was missing

---

## Data Model Clarification

The correct data flow is:

```
PERMIT (scraped from city portals)
    ↓
enrich_cad.py - looks up CAD data by address
    ↓
PROPERTY (cache of CAD data: owner, market value, year built, etc.)
    ↓
scoring_v2.py - scores permits using Property data
    ↓
SCOREDLEAD (the sellable product)
```

**Key points:**
- `Permit` = the INPUT (scraped permit data)
- `Property` = a CACHE of CAD data, keyed by `property_address`
- `ScoredLead` = the OUTPUT (sellable lead with score/tier)
- `Lead` model = **LEGACY** - do not use

---

## Fixes Applied

### 1. Deleted orphan Properties
```python
# Deleted 1,914 Properties that had no matching Permit
# Also deleted 317 Leads pointing to orphan Properties
```

### 2. Fixed `enrich_cad.py` to work on Permits

Changed from querying Leads to querying Permits:

```python
# FIXED (now this)
permits = Permit.objects.all()
# ... filter by enrichment status ...
for permit in permits:
    address = permit.property_address
    prop, created = Property.objects.get_or_create(
        property_address=address,
        defaults={'enrichment_status': 'pending'}
    )
    # ... enrich prop with CAD data ...
```

### 3. Added city-to-county mapping

For addresses without zip codes (like Frisco permits that just have "123 MAIN ST"), added:

```python
CITY_TO_COUNTY = {
    'frisco': 'collin',
    'allen': 'collin',
    'mckinney': 'collin',
    # ... etc
}
```

### 4. Added documentation

- Updated `ERRORS.md` with "Critical Architecture Mistakes" section
- Updated docstring in `enrich_cad.py` with data flow diagram

---

## Current State

| Metric | Before | After |
|--------|--------|-------|
| Properties | 4,042 | 2,203 |
| Orphan Properties | 1,914 | 0 |
| Enrichment % | 38% | 63% |
| Permits needing enrichment | - | 1,717 |

---

## What Needs to Happen Next

### 1. Run full enrichment
```bash
source venv/bin/activate && set -a && source .env && set +a
python3 manage.py enrich_cad
```

This will:
- Process 1,717 permits that don't have enriched Property records
- Create Property records for each permit address
- Query CAD APIs (Tarrant, Denton, Dallas, Collin) for property data
- Rate limited at ~1 req/sec, will take ~30 minutes

### 2. After enrichment, run scoring
```bash
python3 manage.py score_leads  # or whatever the scoring command is
```

### 3. Verify the pipeline
```python
# Check enrichment status
from clients.models import Permit, Property
total = Permit.objects.count()
enriched = Property.objects.filter(enrichment_status='success').count()
print(f'{enriched}/{total} permits have enriched Property')
```

---

## Files Modified

| File | Change |
|------|--------|
| `clients/management/commands/enrich_cad.py` | Works on Permits now, not Leads |
| `ERRORS.md` | Added critical architecture mistake documentation |

---

## Known Limitations

1. **Parker County** - No CAD API (76008 zip codes will fail)
2. **Johnson County** - No CAD API
3. Some addresses genuinely not in CAD (new construction, data mismatches)

---

## Key Lesson

**The business logic is: Permits are the input, ScoredLeads are the output.**

Property is just a cache. If you're ever confused about what to query, ask: "What is the source of truth?" The answer is always Permit for input data.
