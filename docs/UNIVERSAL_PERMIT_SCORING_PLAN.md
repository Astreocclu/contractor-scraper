# Universal Permit Scoring System - Implementation Plan

## Vision
Every permit that comes in gets automatically: categorized → enriched → scored → bucketed → ready to sell.

---

## Current State
- **Categories**: pool, outdoor_living, roof, fence, other
- **Scoring**: Optimized for "luxury outdoor" contractors only
- **Problem**: HVAC, plumbing, concrete, etc. all dumped in "other" with low scores

## Target State
- **Categories**: 15+ trade types, each with proper scoring
- **Scoring**: Each trade scored by its own criteria
- **Output**: Trade-specific buckets ready for contractor sales

---

## Phase 1: Expand Categories (Day 1)

### New Category Structure
```
LUXURY_OUTDOOR (current buyers):
  - pool
  - outdoor_living (patio, pergola, deck, screen)
  - fence

HOME_EXTERIOR:
  - roof
  - siding
  - windows
  - garage_door
  - concrete (driveway, sidewalk)

HOME_SYSTEMS:
  - hvac
  - plumbing
  - electrical
  - solar

STRUCTURAL:
  - foundation
  - addition
  - new_construction
  - remodel

COMMERCIAL:
  - commercial_hvac
  - commercial_roof
  - commercial_plumbing
  - commercial_pool
  - commercial_electrical
  - tenant_improvement

UNSELLABLE (truly junk):
  - demolition
  - temporary
  - signage
  - no_contact
```

### Implementation
1. Update `categorize_permit()` with expanded keyword matching
2. Add `trade_group` field (LUXURY_OUTDOOR, HOME_EXTERIOR, etc.)
3. Export to `exports/{trade_group}/{category}/tier_{a,b,c}.csv`

---

## Phase 2: Trade-Specific Scoring (Day 2)

### Problem
Current prompt says "score for pool/patio/roof/fence contractors" - penalizes HVAC leads unfairly.

### Solution
Dynamic prompt based on detected category:

```python
SCORING_PROMPTS = {
    "pool": "Score for luxury pool builders. $750k+ = premium...",
    "hvac": "Score for HVAC contractors. Urgency matters (broken AC in summer)...",
    "roof": "Score for roofers. 2-week window, storm damage = urgent...",
    "plumbing": "Score for plumbers. Emergency vs scheduled matters...",
    "foundation": "Score for foundation repair. High property value = big job...",
    # etc.
}
```

### Scoring Criteria by Trade
| Trade | Freshness Window | Wealth Threshold | Key Signals |
|-------|------------------|------------------|-------------|
| Pool | 60 days | $500k+ | Custom vs vinyl |
| Roof | 14 days | $300k+ | Storm damage, full replacement |
| HVAC | 7 days | $250k+ | Emergency, system age |
| Plumbing | 3 days | Any | Emergency keywords |
| Foundation | 30 days | $400k+ | Pier count, symptoms |
| Concrete | 30 days | $300k+ | Sqft, decorative vs basic |

---

## Phase 3: Database Architecture (Day 3)

### Current Flow
```
Scraper → Permit table → Manual scoring → CSV exports
```

### New Flow
```
Scraper → Permit table → Auto-enrich → Auto-score → Lead table → Auto-export
                              ↓              ↓
                         Property      ScoredLead
                          table          table
```

### New Models

```python
class ScoredLead(models.Model):
    """Scored and categorized permit ready for sale."""
    permit = models.OneToOneField(Permit, on_delete=models.CASCADE)
    property = models.ForeignKey(Property, null=True)

    # Categorization
    category = models.CharField(max_length=50)  # pool, hvac, roof, etc.
    trade_group = models.CharField(max_length=50)  # LUXURY_OUTDOOR, HOME_SYSTEMS, etc.

    # Scoring
    score = models.IntegerField()
    tier = models.CharField(max_length=1)  # A, B, C
    reasoning = models.TextField()
    chain_of_thought = models.TextField(blank=True)

    # Sales status
    is_sellable = models.BooleanField(default=True)
    unsellable_reason = models.CharField(max_length=200, blank=True)

    # Flags
    flags = models.JSONField(default=list)
    ideal_contractor = models.CharField(max_length=200)
    contact_priority = models.CharField(max_length=20)

    # Metadata
    scored_at = models.DateTimeField(auto_now_add=True)
    scoring_method = models.CharField(max_length=50)  # ai, ai-reasoner, pending_retry

    class Meta:
        indexes = [
            models.Index(fields=['category', 'tier']),
            models.Index(fields=['trade_group', 'is_sellable']),
            models.Index(fields=['score']),
        ]
```

---

## Phase 4: Auto-Pipeline (Day 4)

### Management Command: `process_permits`
```bash
# Run daily via cron
python manage.py process_permits

# What it does:
# 1. Find unprocessed permits (no ScoredLead)
# 2. Enrich with CAD data (if not already)
# 3. Categorize by trade
# 4. Score with trade-specific prompt
# 5. Save to ScoredLead table
# 6. Export updated CSVs
```

### Celery Tasks (Optional)
```python
@shared_task
def process_new_permit(permit_id):
    """Process single permit through full pipeline."""
    permit = Permit.objects.get(id=permit_id)

    # 1. Enrich
    property = enrich_from_cad(permit.property_address)

    # 2. Categorize
    category = categorize_permit(permit)

    # 3. Score (with trade-specific prompt)
    scored = score_for_trade(permit, property, category)

    # 4. Save
    ScoredLead.objects.create(
        permit=permit,
        property=property,
        **scored
    )
```

---

## Phase 5: Unsellable Bucket (Day 5)

### What's Unsellable?
```python
UNSELLABLE_REASONS = {
    "commercial": "Commercial property, not residential",
    "production_builder": "Production builder, not homeowner",
    "llc_landlord": "LLC owner with low value = landlord seeking cheapest",
    "no_contact_info": "Cannot identify or contact owner",
    "too_old": "Lead over 90 days, likely already contracted",
    "duplicate": "Duplicate of existing lead",
    "out_of_area": "Outside serviceable geography",
}
```

### Export Structure
```
exports/
├── luxury_outdoor/
│   ├── pool/
│   │   ├── tier_a.csv
│   │   ├── tier_b.csv
│   │   └── tier_c.csv
│   ├── outdoor_living/
│   └── fence/
├── home_exterior/
│   ├── roof/
│   ├── concrete/
│   └── windows/
├── home_systems/
│   ├── hvac/
│   ├── plumbing/
│   └── electrical/
├── structural/
│   ├── foundation/
│   ├── addition/
│   └── new_construction/
├── unsellable/
│   ├── commercial.csv
│   ├── production_builder.csv
│   └── no_contact.csv
└── pending_retry/
    └── retry_queue.csv
```

---

## Phase 6: Dashboard & Metrics (Day 6-7)

### Django Admin Enhancements
- ScoredLead list with filters by category, tier, trade_group
- Bulk actions: mark sold, mark unsellable, re-score
- Charts: leads by category, conversion rates, score distribution

### Daily Report
```
=== DAILY PERMIT REPORT ===
New permits scraped: 45
Successfully enriched: 42 (93%)
Scored: 40
  - Tier A: 5 (12%)
  - Tier B: 15 (38%)
  - Tier C: 20 (50%)

By Trade Group:
  - Luxury Outdoor: 8
  - Home Exterior: 12
  - Home Systems: 15
  - Structural: 5

Unsellable: 3
  - Commercial: 2
  - Production builder: 1

Pending retry: 2
```

---

## Implementation Order

| Day | Task | Outcome |
|-----|------|---------|
| 1 | Expand categories (15+ trades) | All permits properly categorized |
| 2 | Trade-specific scoring prompts | Fair scores for all trades |
| 3 | ScoredLead model + migrations | Database stores all scored leads |
| 4 | Auto-pipeline command | `process_permits` runs end-to-end |
| 5 | Unsellable detection + buckets | Clean separation of sellable/unsellable |
| 6 | Export restructure | Trade-group organized CSVs |
| 7 | Dashboard + daily report | Visibility into pipeline health |

---

## Quick Wins (Do First)

1. **Expand `categorize_permit()`** - 30 min
   - Add hvac, plumbing, electrical, concrete, foundation, windows, solar, addition, new_construction

2. **Add `trade_group` field** - 10 min
   - Map categories to groups

3. **Update export structure** - 20 min
   - `exports/{trade_group}/{category}/tier_{x}.csv`

This gets you organized buckets immediately, even before trade-specific scoring.

---

## Questions to Resolve

1. **Which trades do you have buyers for TODAY?**
   - Pool, patio, roof, fence = current
   - HVAC, plumbing, concrete = future?

2. **Geography expansion?**
   - Currently DFW only
   - When do other metros come in?

3. **Scoring priority?**
   - Score all trades equally, or prioritize current buyers?
