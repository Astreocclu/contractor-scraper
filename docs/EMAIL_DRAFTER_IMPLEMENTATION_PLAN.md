# Email Drafter Enhancement - Implementation Plan

**Created:** 2025-12-07
**Status:** AWAITING APPROVAL
**Rating from Gemini:** 9/10

---

## Executive Summary

Upgrade the email-drafter from generic "43 pool leads" emails to **personalized, geo-targeted outreach** with real sample addresses and dynamic stats.

**Architecture:** Python preprocessor + Node executor (Option B)
- Python does all matching logic, stats calculation
- Node just reads JSON and creates Gmail drafts
- Preserves working Gmail OAuth

---

## What Changes

| Before | After |
|--------|-------|
| Hardcoded "43 pool permits" | Dynamic stats per contractor |
| Same email to all contractors | Geo-targeted by metro cluster |
| No sample leads in email | 2-3 real addresses with values |
| No tracking | sent_history.json prevents duplicates |

---

## Files to Create/Modify

```
email-drafter/
├── tools/
│   └── matcher.py           # NEW: Python preprocessor
├── leads_enriched.json      # NEW: Generated output
├── sent_history.json        # NEW: Tracking
├── index.js                 # MODIFY: Make "dumb executor"
└── prompts.py               # NEW: Dynamic prompt templates
```

---

## Data Flow

```
┌─────────────────┐     ┌─────────────────┐
│  leads.csv      │     │ tracerfy.csv    │
│  (permit_date,  │     │ (market_value)  │
│   lead_type)    │     │                 │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
            ┌────────────────┐
            │  matcher.py    │
            │  - Join files  │
            │  - Cluster     │
            │  - Match trade │
            │  - Calc stats  │
            └────────┬───────┘
                     ▼
         ┌───────────────────────┐
         │  leads_enriched.json  │
         │  (ready for Node)     │
         └───────────┬───────────┘
                     ▼
            ┌────────────────┐
            │   index.js     │
            │   - Read JSON  │
            │   - DeepSeek   │
            │   - Gmail API  │
            └────────┬───────┘
                     ▼
              Gmail Drafts
              (manual review)
```

---

## Metro Clusters

Geographic clustering for matching (contractors drive 20-30 miles):

| Cluster | Cities |
|---------|--------|
| **North** | Plano, Frisco, McKinney, Allen, Prosper, The Colony |
| **East** | Dallas, Richardson, Garland, Mesquite, Rowlett |
| **West** | Fort Worth, Arlington, Grand Prairie, Irving, Hurst |
| **South** | Cedar Hill, Duncanville, DeSoto, Lancaster, Midlothian |
| **Central** | Carrollton, Lewisville, Flower Mound, Coppell |
| **Premium** | Southlake, Westlake, Highland Park, University Park, Colleyville |

**Luxury Overlay:** Leads with value > $1M are shown to Premium cluster contractors regardless of geography.

---

## Trade Mapping

Map lead types to contractor trades:

| Lead Type (from permits) | Contractor Trade |
|--------------------------|------------------|
| pool, spa | pool |
| roofing, roof, hail | roofing |
| residential remodel, addition, patio | patio |
| fence | fence |
| hvac, mechanical | hvac |
| new construction, residential, other | general |

---

## Matching Rules

```python
for contractor in contractors:
    # 1. Filter leads by trade
    matching_leads = filter_by_trade(leads, contractor.trade)

    # 2. Apply geography
    if contractor.city in PREMIUM_CITIES:
        # Premium contractors see luxury leads from anywhere
        leads_to_show = sort_by_value(matching_leads)[:5]
    else:
        # Standard contractors see same-cluster + luxury overlay
        cluster_leads = filter_by_cluster(matching_leads, contractor.cluster)
        luxury_leads = [l for l in matching_leads if l.value > 1_000_000]
        leads_to_show = cluster_leads[:3] + luxury_leads[:2]

    # 3. Skip if <2 matching leads (prevent zero-lead emails)
    if len(leads_to_show) < 2:
        skip_contractor()
        continue

    # 4. Calculate dynamic stats
    stats = calculate_stats(matching_leads)

    output.append({contractor, stats, sample_leads})
```

---

## Output Format (leads_enriched.json)

```json
{
  "contractor_email": "info@claffeypools.com",
  "business_name": "Claffey Pools",
  "city": "Southlake",
  "cluster": "premium",
  "trade": "pool",
  "stats": {
    "lead_count": 30,
    "hot_count": 18,
    "avg_value": 547000,
    "high_value_count": 8
  },
  "sample_leads": [
    {
      "address": "1209 Pedernalas Trl, Westlake",
      "value": 6172060,
      "permit_date": "2025-11-15"
    },
    {
      "address": "1861 Post Oak Pl, Westlake",
      "value": 3995881,
      "permit_date": "2025-11-20"
    }
  ]
}
```

---

## DeepSeek Prompt Update

The prompt will be dynamic, using stats from JSON:

```
You are Reid. Style: {personality}

Write a cold email to "{business_name}" (a {trade} contractor in {city}).

The Hook:
I have {lead_count} verified homeowner permits in DFW for {trade} work.
{hot_count} are HOT (filed in last 30 days).
Average property value: ${avg_value}.

Mention these specific properties naturally:
{sample_leads formatted}

Guidelines:
- Subject line: boring/internal looking ("Permit for [Address]")
- Body: under 120 words
- Offer 2-3 free samples to prove quality
- CTA: "Want to see the full list?"
```

---

## Tracking (sent_history.json)

Prevent duplicate sends:

```json
{
  "info@claffeypools.com": {
    "leads_pitched": ["lead_123", "lead_456"],
    "last_sent": "2025-12-07",
    "campaign": "pool_dec_2025"
  }
}
```

---

## Batch Strategy

| Phase | Days | Drafts/Day | Notes |
|-------|------|------------|-------|
| Warm-up | 1-7 | 20 | Build sender reputation |
| Ramp | 8-14 | 35 | Monitor for bounces |
| Cruise | 15+ | 50 | Steady state |

Command flag: `python matcher.py --limit 20`

---

## Commands

```bash
# 1. Generate enriched JSON
cd email-drafter
python tools/matcher.py --trade pool --limit 20

# 2. Create Gmail drafts
node index.js

# 3. Review drafts in Gmail, then send manually
```

---

## Implementation Steps

### Step 1: Create matcher.py (1-2 hours)
- Load and join leads.csv + tracerfy.csv
- Implement cluster logic
- Implement trade matching
- Calculate dynamic stats
- Output leads_enriched.json

### Step 2: Modify index.js (30 min)
- Remove hardcoded stats
- Read from leads_enriched.json
- Pass stats to DeepSeek prompt
- Add 1s delay between drafts

### Step 3: Test Run (30 min)
- Generate 5 test drafts
- Review in Gmail
- Verify personalization works

### Step 4: Initial Campaign (ongoing)
- Start with pool contractors (most leads)
- 20 drafts/day for first week
- Monitor replies and adjust

---

## Open Questions for Approval

1. **Start with pools only or all trades?**
   - Recommendation: Start with pools (30 leads), expand after validation

2. **Premium contractor detection?**
   - Current plan: Infer from city (Southlake = premium)
   - Alternative: Use trust_score or google_rating

3. **Include homeowner NAME in email?**
   - Recommendation: NO - just address. Names feel creepy in cold email.

4. **Confirm: Gmail drafts only, no auto-send?**
   - YES - all emails go to Drafts folder for manual review

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Zero-lead emails | Skip contractors with <2 matching leads |
| Wrong trade match | Strict LEAD_TYPE_TO_TRADE mapping |
| Gmail rate limit | 1s delay between drafts, 50/day max |
| Duplicate sends | sent_history.json tracking |
| Spam complaints | Plain text, boring subjects, clear opt-out |

---

## Success Metrics

- **Reply rate:** Target 5-10% (B2B cold email benchmark)
- **Positive replies:** Target 50% of replies interested
- **Conversion:** Track how many buy lead packages

---

**AWAITING YOUR APPROVAL TO PROCEED**
