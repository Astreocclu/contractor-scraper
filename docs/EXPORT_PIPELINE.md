# Export Pipeline Documentation

## Overview

The lead scoring system exports scored leads into a directory structure organized by trade group, category, and tier. This enables easy delivery of targeted leads to specific contractor buyers.

## Directory Structure

```
exports/
├── luxury_outdoor/          # Premium outdoor contractors (current buyers)
│   ├── pool/
│   │   ├── tier_a.csv       # Score 80+ (hot leads)
│   │   ├── tier_b.csv       # Score 50-79 (warm leads)
│   │   └── tier_c.csv       # Score <50 (cool leads)
│   ├── outdoor_living/
│   └── fence/
├── home_exterior/           # Exterior contractors
│   ├── roof/
│   ├── concrete/
│   ├── windows/
│   └── siding/
├── home_systems/            # HVAC/Plumbing/Electrical
│   ├── hvac/
│   ├── plumbing/
│   └── electrical/
├── structural/              # Foundation/Construction
│   ├── foundation/
│   ├── new_construction/
│   ├── remodel/
│   └── addition/
├── commercial/              # Commercial-scale projects
│   ├── commercial_hvac/
│   └── commercial_electrical/
├── flagged/
│   └── needs_review.csv     # Leads requiring human review
├── pending_retry/
│   └── retry_queue.csv      # Failed scoring, retry later
└── other/
    └── other/tier_c.csv     # Uncategorized leads
```

## CSV Format

Each tier CSV contains these columns:

| Column | Description |
|--------|-------------|
| `permit_id` | Unique permit identifier |
| `city` | City where permit was filed |
| `property_address` | Full address |
| `owner_name` | Property owner (homeowner) |
| `project_description` | What they're building |
| `market_value` | CAD market value ($) |
| `days_old` | Days since permit filed |
| `is_absentee` | Boolean: owner lives elsewhere |
| `score` | AI score 0-100 (-1 = retry) |
| `tier` | A/B/C/RETRY |
| `trade_group` | Parent category |
| `category` | Specific trade |
| `reasoning` | AI explanation for score |
| `ideal_contractor` | Who should buy this lead |
| `contact_priority` | call/email/skip |
| `flags` | Any concerns (pipe-separated) |
| `scored_at` | Timestamp |

## Tier Definitions

| Tier | Score Range | Lead Quality | Recommended Action |
|------|-------------|--------------|-------------------|
| **A** | 80-100 | Hot | Call immediately |
| **B** | 50-79 | Warm | Email within 24h |
| **C** | 0-49 | Cool | Batch contact |
| **RETRY** | -1 | Failed | Auto-retry via cron |

## Running the Export

```bash
# Activate environment
cd /home/reid/testhome/contractors
source venv/bin/activate
set -a && . ./.env && set +a

# Score and export (dry run - no database save)
python manage.py score_leads_v2 --limit 100 --reasoner

# Score, export, AND save to database
python manage.py score_leads_v2 --limit 100 --reasoner --save-to-db

# Score specific cities only
python manage.py score_leads_v2 --cities plano frisco mckinney --reasoner --save-to-db
```

## Retry Failed Leads

A cron job handles retry automatically:

```bash
# Daily at 6 AM
0 6 * * * /home/reid/testhome/contractors/scripts/retry_failed_leads.sh
```

Manual retry:
```bash
python manage.py score_leads_v2 --retry-only exports/pending_retry/retry_queue.csv --reasoner --save-to-db
```

## Workflow for Selling Leads

1. **Daily Processing**: Run `score_leads_v2` on new permits
2. **QA Check**: Review `flagged/needs_review.csv` for edge cases
3. **Package by Buyer**: Pool contractors get `luxury_outdoor/pool/tier_a.csv`
4. **Update Database**: Use `--save-to-db` to track sold status
5. **Archive**: Move delivered CSVs to `exports/_delivered/YYYY-MM-DD/`

## Database Model (ScoredLead)

Scored leads are also persisted to Django database:

```python
from clients.models import ScoredLead

# Get all Tier A pool leads
hot_pool_leads = ScoredLead.objects.filter(
    category='pool',
    tier='A',
    status='new'
)

# Mark as sold
lead.status = 'sold'
lead.sold_to = 'ABC Pool Company'
lead.sold_at = timezone.now()
lead.sold_price = Decimal('25.00')
lead.save()
```

## Trade Groups Reference

| Trade Group | Categories |
|-------------|------------|
| `luxury_outdoor` | pool, outdoor_living, fence |
| `home_exterior` | roof, concrete, siding, windows |
| `home_systems` | hvac, plumbing, electrical |
| `structural` | foundation, new_construction, remodel, addition |
| `commercial` | commercial_pool, commercial_hvac, commercial_electrical, commercial_plumbing |
