# Session Log: Email Drafter Implementation
**Date:** 2025-12-07
**Duration:** ~2 hours
**Participants:** Reid + Claude + Gemini (iterative brainstorming)

---

## TL;DR

Built a cold email system to sell homeowner permit leads to contractors. System is functional and ready to test.

**Status:** 5 Gmail drafts created, ready to send as MVP test.

---

## What Was Built

### 1. Python Matcher (`email-drafter/tools/matcher.py`)
- Joins `leads.csv` (permit data) with `tracerfy.csv` (property values)
- Matches contractors to leads by geography (DFW metro clusters) and trade
- Rotates sample leads so each contractor gets different addresses
- Outputs `leads_enriched.json`

### 2. Node Executor (`email-drafter/index.js`)
- Reads enriched JSON
- Calls DeepSeek API to generate personalized emails
- Creates Gmail drafts (does NOT auto-send)
- Tracks sent history to prevent duplicates

### 3. Data Pipeline
```
leads.csv + tracerfy.csv
         ↓
    matcher.py (Python)
         ↓
  leads_enriched.json
         ↓
    index.js (Node)
         ↓
    Gmail Drafts
```

---

## Commands to Run

```bash
cd /home/reid/testhome/contractors/email-drafter

# 1. Generate enriched JSON (pool contractors, limit to N)
source ../venv/bin/activate
python3 tools/matcher.py --trade pool --limit 20

# 2. Create Gmail drafts
set -a && source ../.env && set +a && node index.js

# 3. Review drafts in Gmail, then send manually
```

---

## Current Prompt (index.js)

```javascript
const prompt = `You're Reid, a lead data analyst. Write a short cold email to ${business_name}, a ${trade} contractor in ${city}.

You have ${stats.overall_lead_count} homeowner leads in DFW who are starting ${trade} projects. ${stats.overall_hot_count} are from the last 30 days. Average home value: ${formatMoney(stats.avg_value)}.

Sample properties you could mention:
${leadHook}

Keep it short and natural. Sign off as "Reid - Lead Data Analyst".

Return JSON: {"subject": "...", "body": "..."}`;
```

---

## Debate Summary (Claude + Gemini, 5 Rounds)

### Key Decisions Made

| Topic | Decision | Reasoning |
|-------|----------|-----------|
| **What to sell** | Addresses + permit data | Phone numbers = TCPA liability |
| **Subject line** | Let AI decide, but avoid "Lead Gen Agency Stench" | Generic subjects get deleted |
| **Template style** | "I track permit filings" + free samples | Explains the HOW, builds credibility |
| **Signature** | "Reid - Lead Data Analyst" | User's preference (Gemini suggested just "Reid") |
| **Price** | Don't mention until they reply | Build curiosity first, then "$50/month" |
| **Phone numbers** | NOT selling (yet) | Requires Tracerfy skip trace (~$7) + DNC scrubbing |

### Gemini's Key Insights

1. **"Lead Gen Agency Stench"** - Contractors get 10-20 "I have leads" emails/week. We need to stand out with specificity.

2. **TCPA Liability** - Selling skip-traced phone numbers for cold calling is legally risky. Addresses are public record = safe.

3. **"Territory Intelligence"** - Reframe from "leads" to "market intel" - where are permits being filed, what's the home value, etc.

4. **MVP First** - Stop building infrastructure. Send 5 emails manually and see if anyone replies.

### Open Questions (Unresolved)

1. **Exclusivity** - Should we sell the same leads to multiple contractors, or exclusive territories?
2. **Price point** - $50/month? $25/lead? Need market validation.
3. **Fulfillment** - When they reply "yes", what exactly do we send? (Gemini proposed a `fulfill.py` script)

---

## Files Created/Modified

| File | Status | Purpose |
|------|--------|---------|
| `email-drafter/tools/matcher.py` | NEW | Python preprocessor - joins data, matches by geo/trade |
| `email-drafter/index.js` | MODIFIED | Simplified to "dumb executor" - reads JSON, creates drafts |
| `email-drafter/leads_enriched.json` | GENERATED | Output from matcher, input to executor |
| `email-drafter/sent_history.json` | GENERATED | Tracks who was already drafted |
| `docs/EMAIL_DRAFTER_IMPLEMENTATION_PLAN.md` | NEW | Full implementation plan (approved) |
| `docs/SESSION_2025-12-07_email_drafter.md` | NEW | This file |

---

## Current Data

| Metric | Count |
|--------|-------|
| Total homeowner leads | 1,243 |
| Pool-specific leads | 77 |
| Pool contractors with emails | 233 |
| Drafts created (test) | 5 |

---

## Next Steps (For Next Engineer)

### Immediate (MVP Test)
1. Review the 5 drafts in Gmail
2. Send them
3. Track replies
4. If someone replies "yes" → manually send them a CSV of matching leads

### If MVP Works
1. Create `fulfill.py` script to auto-generate lead CSVs per contractor
2. Scale to 20-50 emails/day
3. Add other trades (roofing, patio, HVAC)
4. Consider Tracerfy skip trace for phone numbers (if legal concerns addressed)

### If MVP Fails (0 Replies)
1. A/B test subject lines
2. Try different contractor segments
3. Reconsider the value prop - maybe they want something else

---

## Technical Notes

### Metro Clusters (matcher.py)
```python
CLUSTERS = {
    "north": ["plano", "frisco", "mckinney", "allen", "prosper"],
    "east": ["dallas", "richardson", "garland", "mesquite"],
    "west": ["fort worth", "arlington", "grand prairie", "irving"],
    "south": ["cedar hill", "duncanville", "desoto", "lancaster"],
    "central": ["carrollton", "lewisville", "flower mound", "coppell"],
    "premium": ["southlake", "westlake", "highland park", "colleyville"],
}
```

### Lead Rotation
Each contractor gets different sample leads via index-based rotation:
```python
start_idx = (contractor_index * 2) % len(cluster_leads)
cluster_leads = cluster_leads[start_idx:] + cluster_leads[:start_idx]
```

### Environment Variables Required
- `DEEPSEEK_API_KEY` - for email generation
- Gmail OAuth credentials in `credentials.json` and `token.json`

---

## Session Context

This session continued from `docs/SESSION_LOG_2025-12-07_lead_analysis.md` where we:
1. Analyzed lead sales blockers
2. Discovered 46% of permits are homeowner-pulled (real leads)
3. Created Tracerfy export (754 unique leads, ~$7 to skip trace)

The email drafter is the mechanism to monetize those leads by selling to contractors.

---

*Generated by Claude + Gemini iterative brainstorming session*
