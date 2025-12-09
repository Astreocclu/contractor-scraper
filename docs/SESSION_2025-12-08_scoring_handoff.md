# Session Handoff: Lead Scoring Pipeline Issues
**Date:** 2025-12-08
**Status:** Blocked - Needs enrichment before scoring

---

## Summary

Attempted to score ~2,000 permit leads in bulk. Discovered two major issues:
1. **Async scoring is broken** - aiohttp/asyncio hangs, likely Django event loop conflict
2. **Permits are not enriched** - No owner name or market value from CAD

---

## Current Database State

```
Total Permits:    2,409
Scored Leads:     ~325
Unscored:         ~2,084

Tier Breakdown:
  A (80+):  19
  B (50-79): 118
  C (<50):  188
```

---

## What Was Attempted

### 1. Async Scoring (BROKEN)
```bash
python3 manage.py score_leads_v2 --limit 2000 --concurrent 2 --save-to-db
```
- Command hangs after "Scoring leads..." message
- Process shows <1% CPU usage, appears stuck
- Issue is in `clients/services/scoring_v2.py` - aiohttp ClientSession with asyncio.gather

### 2. Sync Scoring Workaround (WORKS but slow)
Created `scripts/sync_score.py` - uses `requests` instead of `aiohttp`:
```bash
source venv/bin/activate && set -a && . ./.env && set +a
python3 scripts/sync_score.py --limit 500
```
- Works but slow (~8 leads/min)
- 2,000 leads would take ~4 hours

### 3. Enrichment Issue (BLOCKER)
Discovered permits have NO enrichment data:
- `cad_property_id = None` on all ScoredLead records
- `applicant_name = ''` on all permits
- No market_value data

The AI is scoring with only: permit_type, description, city - **no owner name, no property value**.

---

## Root Cause

The pipeline should be: **Scrape → Enrich (CAD) → Score**

But:
- `enrich_cad` command works on OLD **Lead model** (doesn't exist anymore)
- New **Permit model** has no enrichment command
- Permits were scraped but never enriched with CAD data

---

## Files Reference

| Purpose | File |
|---------|------|
| Async scoring (broken) | `clients/services/scoring_v2.py` |
| Async command | `clients/management/commands/score_leads_v2.py` |
| Sync workaround | `scripts/sync_score.py` |
| Old enrichment (Lead model) | `clients/management/commands/enrich_cad.py` |
| Models | `clients/models.py` (Permit, ScoredLead) |

---

## Next Steps (Priority Order)

### 1. Create `enrich_permits` Command
Adapt `enrich_cad.py` to work on Permit model instead of Lead model:
- Query Permits without CAD data
- Call county CAD APIs (Tarrant, Dallas, Denton, Collin)
- Store owner_name, market_value on Permit or linked Property model

### 2. Fix Async Scoring (Optional)
Debug why aiohttp hangs:
- Likely event loop conflict with Django
- Could try `nest_asyncio` or switch to `httpx` async client
- Or just use sync scoring (slower but works)

### 3. Score Enriched Permits Only
Modify scoring to require enrichment:
```python
# In score_leads_v2.py or sync_score.py
permits = Permit.objects.exclude(scored_lead__isnull=False).exclude(
    applicant_name__isnull=True
).exclude(applicant_name='')
```

---

## CAD API Info

From `enrich_cad.py`, these counties are supported:
- **Tarrant** (Fort Worth area)
- **Dallas**
- **Denton**
- **Collin** (Allen area) - uses City of Allen ArcGIS endpoint

Example API call pattern:
```python
# Tarrant County
url = "https://publicaccess.tarrantcounty.com/api/Property/Search"
params = {"Address": "123 MAIN ST"}
```

---

## Quick Test Commands

```bash
# Activate environment
source venv/bin/activate && set -a && . ./.env && set +a

# Check current counts
python3 -c "
import os; os.environ['DJANGO_SETTINGS_MODULE']='config.settings'
import django; django.setup()
from clients.models import Permit, ScoredLead
print(f'Permits: {Permit.objects.count()}')
print(f'Scored: {ScoredLead.objects.count()}')
"

# Check enrichment status
python3 -c "
import os; os.environ['DJANGO_SETTINGS_MODULE']='config.settings'
import django; django.setup()
from clients.models import Permit
has_applicant = Permit.objects.exclude(applicant_name='').exclude(applicant_name__isnull=True).count()
print(f'Permits with applicant: {has_applicant}')
"

# Test DeepSeek API
python3 -c "
import os, requests
api_key = os.environ['DEEPSEEK_API_KEY']
resp = requests.post('https://api.deepseek.com/chat/completions',
    headers={'Authorization': f'Bearer {api_key}'},
    json={'model': 'deepseek-chat', 'messages': [{'role': 'user', 'content': 'hi'}], 'max_tokens': 10})
print(f'API Status: {resp.status_code}')
"
```

---

## Known Issues

1. **High discard rate (~7%)** - Junk permits (water heaters, furnace replacements) still in data
2. **Production builders** - Lennar, DR Horton, M/I Homes permits need filtering at scrape time
3. **ScoredLead model mismatch** - Some fields in scoring code don't match model (city, market_value, etc.)

---

## Background Processes

Several zombie background processes may still be running. Kill with:
```bash
pkill -f "score_leads"
```

---

## Decision Needed

Before continuing, decide:
1. **Enrich first** (recommended) - More accurate scores, but need to write command
2. **Score without enrichment** - Fast but lower quality scores
3. **Different approach** - Maybe skip scoring entirely and just use permit data directly

---

## Session Notes

- User has low RAM (7/8 GB used) - use `--concurrent 1` or `--concurrent 2`
- DeepSeek API works fine, issue is async code
- ~325 leads already scored but without enrichment data
