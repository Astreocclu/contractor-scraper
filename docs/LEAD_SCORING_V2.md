# Lead Scoring System v2

## Overview

A new scoring system designed specifically for contractor leads from permit data. Replaces the v1 system which included irrelevant "high contrast" scoring from the security screens project.

## Current Problems with v1

1. **High Contrast Score** - Comparing property value to neighborhood median was designed for security screen sales (wealthy house in modest neighborhood = security conscious). Not relevant for contractor leads.

2. **Tier vs Score Confusion** - The "tier" (A/B/C/D) is assigned at import based on permit keywords, while "score" is calculated separately. These should be unified.

3. **Missing Factors** - Doesn't consider owner type (builder vs individual), lot size potential, or repeat customer indicators.

---

## Proposed v2 Scoring System

### Score Components (0-100 scale)

#### 1. Project Type Score (0-40 points)
Based on permit type and typical project value/margin for contractors.

| Category | Permit Types | Points | Rationale |
|----------|--------------|--------|-----------|
| Premium Outdoor | Pool, outdoor kitchen, cabana | 40 | High-value, high-margin projects |
| Outdoor Living | Patio, deck, pergola, gazebo | 35 | Good margins, leads to add-ons |
| New Construction | New build, new home | 30 | Many upsell opportunities |
| Major Renovation | Addition, remodel, renovation | 25 | Engaged homeowner, budget exists |
| Roofing | Roof replacement, re-roof | 20 | Necessary spend, referral potential |
| Foundation | Foundation repair | 20 | Necessary spend |
| HVAC | HVAC, A/C, heating | 15 | Commodity service |
| Fence | Fence, gate | 15 | Lower value but high volume |
| Minor Work | Electrical, plumbing, general | 10 | Low value per job |
| Commercial | Commercial permits | 5 | Different sales process |

#### 2. Property Value Score (0-20 points)
Higher property values indicate higher budgets.

| Property Value | Points |
|----------------|--------|
| $750k+ | 20 |
| $500k - $749k | 15 |
| $350k - $499k | 10 |
| $200k - $349k | 5 |
| < $200k | 0 |

#### 3. Owner Profile Score (0-20 points)
Who owns the property matters.

| Owner Type | Points | Detection Method |
|------------|--------|------------------|
| Individual homeowner (owner-occupied) | 20 | Not absentee, not company name |
| Individual investor (absentee) | 15 | Absentee + individual name |
| Property management company | 10 | Absentee + "LLC", "PROPERTIES", "MANAGEMENT" |
| Builder/Developer | 0 | "HOMES", "BUILDERS", "CONSTRUCTION", "DEVELOPMENT" |

**Builder Detection Keywords:**
- HOMES, BUILDERS, CONSTRUCTION, DEVELOPMENT, DEVELOPERS
- WEEKLEY, BEAZER, LENNAR, DR HORTON, PULTE, KB HOME, MERITAGE
- BRIGHTLAND, ASHTON WOODS, TAYLOR MORRISON

#### 4. Freshness Score (0-15 points)
Recent permits = active buyers.

| Days Since Permit | Points | Label |
|-------------------|--------|-------|
| 0-7 days | 15 | Hot |
| 8-14 days | 12 | Warm |
| 15-30 days | 8 | Active |
| 31-60 days | 4 | Cooling |
| 61-90 days | 2 | Cold |
| 90+ days | 0 | Stale |

#### 5. Property Potential Score (0-5 points)
Lot size indicates outdoor project potential.

| Lot Size | Points |
|----------|--------|
| 0.5+ acres | 5 |
| 0.25 - 0.49 acres | 3 |
| 0.1 - 0.24 acres | 1 |
| < 0.1 acres | 0 |

---

## Tier Assignment

Tiers are derived from total score (not set independently).

| Tier | Score Range | Description |
|------|-------------|-------------|
| A | 75-100 | High-value leads, prioritize outreach |
| B | 50-74 | Good leads, standard follow-up |
| C | 25-49 | Lower priority, batch outreach |
| D | 0-24 | Skip or minimal effort |

---

## Example Scores

### Example 1: Hot Pool Lead
- Pool permit (40) + $600k home (15) + Owner-occupied (20) + 5 days old (15) + 0.3 acre lot (3)
- **Total: 93 (Tier A)**

### Example 2: Builder New Construction
- New construction (30) + $400k home (10) + Builder owner (0) + 10 days old (12) + 0.2 acre lot (1)
- **Total: 53 (Tier B)** - but should be flagged as "Builder - Skip"

### Example 3: Old Fence Permit
- Fence (15) + $250k home (5) + Investor (15) + 75 days old (2) + 0.1 acre lot (0)
- **Total: 37 (Tier C)**

### Example 4: Investor Remodel
- Remodel (25) + $500k home (15) + Investor absentee (15) + 20 days old (8) + 0.15 acre lot (1)
- **Total: 64 (Tier B)**

---

## Implementation Notes

### Database Changes
- Add `owner_type` field to Property: `individual`, `investor`, `property_mgmt`, `builder`
- Add `is_builder` boolean flag for quick filtering
- Remove `is_high_contrast` and `contrast_ratio` fields from Lead (no longer used)
- Add `score_version` field to track which scoring algorithm was used

### New Scoring Command
```bash
python manage.py score_leads_v2          # Score all unscored leads
python manage.py score_leads_v2 --rescore  # Rescore all leads
python manage.py score_leads_v2 --limit 100  # Test run
```

### Builder Filtering
Leads with `is_builder=True` should be:
- Automatically set to Tier D or excluded
- Filterable in the UI
- Excluded from outreach lists

### Migration Path
1. Add new fields to models
2. Run owner type detection on all enriched properties
3. Run v2 scoring on all leads
4. Update UI to show new score breakdown

---

## Future Enhancements

### Phase 2: Repeat Customer Detection
- Track if same owner has multiple properties with permits
- Bonus points for multi-property owners (potential portfolio relationship)

### Phase 3: Neighborhood Quality
- Average permit activity in zip code
- Hot neighborhoods get bonus points

### Phase 4: Permit Value Integration
- Use `estimated_value` from permit data when available
- Higher permit values = larger project budgets
