# Session Summary: Lead Scoring V2 Database Integration

**Date:** 2025-12-07
**Status:** COMPLETE

---

## What Was Accomplished

### 1. ScoredLead Django Model Created
Added a new `ScoredLead` model to `clients/models.py` for persistent storage of AI-scored leads.

**Key fields:**
- `permit` - OneToOne FK to Permit (source data)
- `cad_property` - FK to Property (CAD enrichment data)
- `category` - Trade category (pool, hvac, roof, etc.)
- `trade_group` - Parent group (luxury_outdoor, home_systems, commercial, etc.)
- `is_commercial` - Boolean flag
- `score` - 0-100 integer (-1 for pending retry)
- `tier` - A/B/C/RETRY
- `reasoning` - AI explanation
- `chain_of_thought` - DeepSeek reasoner's thinking process
- `flags` - JSONField list of concerns
- `ideal_contractor` - Who should buy this lead
- `contact_priority` - call/email/skip
- `scoring_method` - ai/ai-reasoner/pending_retry
- Sales tracking: `status`, `sold_to`, `sold_at`, `sold_price`

**Important:** Field was renamed from `property` to `cad_property` because `property` shadows Python's built-in `@property` decorator.

### 2. Migration Created and Applied
```bash
python manage.py makemigrations clients --name add_scored_lead_model
python manage.py migrate clients
```
Migration file: `clients/migrations/0004_add_scored_lead_model.py`

### 3. Database Save Function Added
Added `save_scored_leads_to_db()` function to `clients/services/scoring_v2.py`:

```python
def save_scored_leads_to_db(
    leads: List[ScoredLead],
    permit_lookup: Dict[str, Any] = None
) -> Dict[str, int]:
    """
    Save scored leads to Django database.
    Returns: {'created': N, 'updated': N, 'skipped': N, 'errors': N}
    """
```

---

## What Was Completed (Resumed Session)

### 1. Management Command Updated
Added `--save-to-db` flag to `clients/management/commands/score_leads_v2.py`:
- Added `save_scored_leads_to_db` to imports
- Added `--save-to-db` argument
- Added database save logic after CSV export

### 2. Large Batch Test Results (100 leads)
```
Input:     100
Discarded: 33 (junk projects, no data, production builders)
Scored:    67

Tier A (80+):  5
Tier B (50-79): 22
Tier C (<50):   39
Pending retry: 1

Database results:
  Created: 64
  Updated: 3
  Skipped: 0
```

Categories scored: pool, roof, hvac, plumbing, electrical, concrete, fence, outdoor_living, foundation, new_construction, etc.

---

## Prior Context (from earlier session)

### Universal Permit Scoring System
The larger project goal is to build a system where ALL permits are:
1. **Auto-categorized** into ~20 trade categories
2. **Enriched** with CAD data (property value, owner info)
3. **AI-scored** by DeepSeek Reasoner (0-100 with chain-of-thought)
4. **Filtered** into trade group buckets for sale

### Trade Groups & Categories

```python
TRADE_GROUPS = {
    # Luxury outdoor - current buyers
    "pool": "luxury_outdoor",
    "outdoor_living": "luxury_outdoor",
    "fence": "luxury_outdoor",

    # Home exterior
    "roof": "home_exterior",
    "concrete": "home_exterior",
    "siding": "home_exterior",

    # Home systems
    "hvac": "home_systems",
    "plumbing": "home_systems",
    "electrical": "home_systems",

    # Structural
    "foundation": "structural",
    "new_construction": "structural",

    # Commercial (same trades, commercial properties)
    "commercial_pool": "commercial",
    "commercial_hvac": "commercial",
    # etc.
}
```

### Key Decisions Made
1. **Fallback scorer removed entirely** - If API fails, leads are flagged for retry (tier="RETRY", score=-1)
2. **Commercial is sellable** - Not marked as unsellable, gets its own trade group
3. **Categories expanded** - From 5 to ~20 categories with keyword detection
4. **Export structure** - `exports/{trade_group}/{category}/tier_{x}.csv`

---

## Files Modified

| File | Changes |
|------|---------|
| `clients/models.py` | Added `ScoredLead` model |
| `clients/services/scoring_v2.py` | Added `save_scored_leads_to_db()` function |
| `clients/migrations/0004_add_scored_lead_model.py` | New migration |

---

## Background Processes (may be stale)

There were several background bash processes running from earlier in the session:
- Gemini analysis task (d3438e)
- Score batches (9d456c, 4b9567, 8dcf6c, d5c776)

These can be killed or ignored - they were from earlier testing.

---

## Quick Resume Commands

```bash
cd /home/reid/testhome/contractors
source venv/bin/activate
set -a && . ./.env && set +a

# Check model is working
python manage.py shell -c "from clients.models import ScoredLead; print(ScoredLead.objects.count())"

# Run batch with DB save (after adding --save-to-db flag)
python manage.py score_leads_v2 --limit 100 --reasoner --save-to-db
```

---

## Architecture Overview

```
Permit (raw scraped data)
    │
    ├── Property (CAD enrichment)
    │
    └── ScoredLead (AI scoring results)
            ├── category (pool, hvac, roof...)
            ├── trade_group (luxury_outdoor, home_systems...)
            ├── score (0-100)
            ├── tier (A/B/C)
            ├── reasoning (AI explanation)
            └── status (new → exported → sold → converted)
```
