# Documentation Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update contractor-auditor/docs/ to be current, congruent, and agent-friendly with 4 core docs replacing 15+ outdated files.

**Architecture:** Archive obsolete docs to _archive/, then create 4 new core docs (QUICKREF, ARCHITECTURE, SOURCES, DATABASE) by extracting and updating content from existing files. Update root status files (TODO.md, STATUS.md) to reflect current state. Update CLAUDE.md documentation index.

**Tech Stack:** Markdown, no code changes

---

## Task 1: Archive Obsolete Documentation

**Files:**
- Move: `docs/AGENTIC_AUDIT_SPEC.md` → `docs/_archive/`
- Move: `docs/CODEBASE_DOCUMENTATION.md` → `docs/_archive/`
- Move: `docs/POSTGRESQL_MIGRATION_FINAL.md` → `docs/_archive/`
- Move: `docs/POSTGRESQL_MIGRATION_PLAN.md` → `docs/_archive/`
- Move: `docs/POSTGRESQL_MIGRATION_TEST_PLAN.md` → `docs/_archive/`
- Move: `docs/CLEANUP_PLAN.md` → `docs/_archive/`
- Move: `docs/FAKE_REVIEW_DETECTION_PLAN.md` → `docs/_archive/`
- Move: `docs/FAKE_REVIEW_DETECTION_SUMMARY.md` → `docs/_archive/`
- Move: `docs/ISSUE_4_CONTRACTORS_SHOWING.md` → `docs/_archive/`
- Move: `docs/SCORING_INVESTIGATION.md` → `docs/_archive/`
- Move: `docs/chat_log_*.md` → `docs/_archive/`
- Move: `docs/SESSION_*.md` → `docs/_archive/`
- Move: `docs/variance_test_report.md` → `docs/_archive/`
- Move: `docs/COUNTY_LIENS_SCRAPER.md` → `docs/_archive/`

**Step 1: List files to archive**

```bash
cd /home/astre/command-center/testhome/contractor-auditor
ls -la docs/*.md | grep -E "(AGENTIC_AUDIT_SPEC|CODEBASE_DOCUMENTATION|POSTGRESQL|CLEANUP_PLAN|FAKE_REVIEW|ISSUE_4|SCORING_INVESTIGATION|chat_log|SESSION_|variance_test|COUNTY_LIENS)"
```

**Step 2: Move files to _archive/**

```bash
cd /home/astre/command-center/testhome/contractor-auditor/docs
mv AGENTIC_AUDIT_SPEC.md _archive/
mv CODEBASE_DOCUMENTATION.md _archive/
mv POSTGRESQL_MIGRATION_FINAL.md _archive/
mv POSTGRESQL_MIGRATION_PLAN.md _archive/
mv POSTGRESQL_MIGRATION_TEST_PLAN.md _archive/
mv CLEANUP_PLAN.md _archive/
mv FAKE_REVIEW_DETECTION_PLAN.md _archive/
mv FAKE_REVIEW_DETECTION_SUMMARY.md _archive/
mv ISSUE_4_CONTRACTORS_SHOWING.md _archive/
mv SCORING_INVESTIGATION.md _archive/
mv COUNTY_LIENS_SCRAPER.md _archive/
mv chat_log_*.md _archive/
mv SESSION_*.md _archive/
mv variance_test_report.md _archive/
```

**Step 3: Verify archive**

```bash
ls docs/_archive/ | wc -l
ls docs/*.md
```

Expected: 20+ files in _archive/, only core docs remaining in docs/

**Step 4: Commit**

```bash
git add docs/
git commit -m "docs: archive obsolete documentation files"
```

---

## Task 2: Create QUICKREF.md (Session Start Guide)

**Files:**
- Create: `docs/QUICKREF.md`
- Delete: `docs/AGENTIC_QUICKREF.md` (after content extracted)

**Step 1: Create QUICKREF.md**

Create file `docs/QUICKREF.md` with this content:

```markdown
# Contractor Auditor - Quick Reference

**Purpose:** Forensic contractor auditing. Playwright scrapes → DeepSeek analyzes → Trust Score.

---

## Commands

| Task | Command |
|------|---------|
| Single audit | `node bin/run_audit.js --id 123` |
| Dialectic audit | `node bin/run_audit.js --id 123 --mode dialectic` |
| Batch audit | `node bin/batch_audit_runner.js --limit 100` |
| Collection only | `node bin/batch_collect.js --id 123 --force` |
| Django server | `python3 manage.py runserver 8002` |

**Environment setup:**
```bash
source venv/bin/activate && set -a && . ./.env && set +a
```

---

## Key Files

| Purpose | File |
|---------|------|
| CLI entry | `bin/run_audit.js` |
| Batch runner | `bin/batch_audit_runner.js` |
| Orchestrator | `services/orchestrator.js` |
| Data collection | `services/collection_service.js` |
| Standard audit agent | `services/audit_agent.js` |
| Dialectic audit agent | `services/audit_agent.js` (DialecticAuditAgent class) |
| Review analysis | `services/review_analyzer.js` |
| Database | `services/db_pg.js` |

---

## What's Working

| Component | Status |
|-----------|--------|
| Standard audit pipeline | Working |
| Dialectic audit (3-persona) | Working |
| Google/BBB/Yelp collection | Working |
| County liens (Tarrant/Collin/Dallas) | Working |
| Review strategic sampling | Working |
| PostgreSQL database | Working |

---

## Test Contractor

**Orange Elephant Roofing (ID: 1524)** - Known fraud, expect score ~15, CRITICAL

```bash
node bin/run_audit.js --id 1524
```

---

## Session Start Checklist

1. Read `TODO.md` - current priorities
2. Read `STATUS.md` - system state
3. Read `ERRORS.md` - known issues
4. Run `git status` - check branch state

---

## Documentation Index

| Need | File |
|------|------|
| System design | `docs/ARCHITECTURE.md` |
| Data sources | `docs/SOURCES.md` |
| Database schema | `docs/DATABASE.md` |
| Experiment log | `docs/EXPERIMENTS.md` |
| Implementation plans | `docs/plans/` |
```

**Step 2: Delete old AGENTIC_QUICKREF.md**

```bash
mv docs/AGENTIC_QUICKREF.md docs/_archive/
```

**Step 3: Verify QUICKREF.md renders correctly**

```bash
head -50 docs/QUICKREF.md
```

**Step 4: Commit**

```bash
git add docs/QUICKREF.md docs/_archive/AGENTIC_QUICKREF.md
git commit -m "docs: create QUICKREF.md session start guide"
```

---

## Task 3: Create ARCHITECTURE.md (System Design)

**Files:**
- Create: `docs/ARCHITECTURE.md` (expand from SYSTEM_ARCHITECTURE.md)
- Move: `docs/SYSTEM_ARCHITECTURE.md` → `docs/_archive/`

**Step 1: Create ARCHITECTURE.md**

Create file `docs/ARCHITECTURE.md` with this content:

```markdown
# Contractor Auditor - System Architecture

**Updated:** 2026-01-09

---

## Overview

Forensic contractor auditing system that collects data from 30+ sources, analyzes with DeepSeek LLM, and produces Trust Scores (0-100).

---

## Pipeline Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    AUDIT PIPELINE                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. ENTRY POINT                                              │
│     └─ bin/run_audit.js --id 123 [--mode dialectic]         │
│                                                              │
│  2. ORCHESTRATOR (services/orchestrator.js)                  │
│     ├─ Find/create contractor in PostgreSQL                  │
│     ├─ Check for cached data (TTL-based)                    │
│     └─ Dispatch to collection or audit                      │
│                                                              │
│  3. COLLECTION (services/collection_service.js)              │
│     ├─ Tier 1: Reviews (Google, BBB, Yelp, Trustpilot)      │
│     ├─ Tier 2: News (Google News, local)                    │
│     ├─ Tier 3: Social (Reddit, YouTube)                     │
│     ├─ Tier 4: Employee (Indeed, Glassdoor)                 │
│     ├─ Tier 5: Government (OSHA, EPA)                       │
│     ├─ Tier 6: Texas (Franchise Tax)                        │
│     ├─ Tier 7: Courts (County liens)                        │
│     └─ Tier 8: Industry (Porch, BuildZoom, HomeAdvisor)     │
│                                                              │
│  4. REVIEW ANALYSIS (services/review_analyzer.js)            │
│     ├─ Strategic sampling: 10 five-star, 10 one-two, 5 mid  │
│     ├─ Fake review detection                                │
│     └─ Complaint pattern extraction                         │
│                                                              │
│  5. AUDIT AGENT (services/audit_agent.js)                    │
│     ├─ Standard: Single DeepSeek pass                       │
│     └─ Dialectic: 3-persona adversarial (see below)         │
│                                                              │
│  6. DATABASE (PostgreSQL contractors_dev)                    │
│     ├─ contractor_raw_data: Cached scraper results          │
│     ├─ audit_records: Audit results (V4 = dialectic)        │
│     └─ contractors_contractor: Master data                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Audit Modes

### Standard Mode (default)

Single DeepSeek pass analyzing all collected data.

```bash
node bin/run_audit.js --id 123
```

- Cost: ~$0.003 per audit
- Speed: ~30 seconds
- Use for: Batch audits, initial screening

### Dialectic Mode (3-persona)

Three sequential DeepSeek passes with adversarial reasoning.

```bash
node bin/run_audit.js --id 123 --mode dialectic
```

| Persona | Role | Question |
|---------|------|----------|
| Consumer Advocate | Skeptical | "Why should we NOT trust this contractor?" |
| Fair Arbiter | Charitable | "Why might they be trustworthy despite flags?" |
| Synthesizer | Senior analyst | "Who made the stronger case and why?" |

- Cost: ~$0.009 per audit (3x standard)
- Speed: ~90 seconds
- Use for: Important audits, borderline cases
- Database: `audit_version = 4`, full trace in `reasoning_trace`

**Output structure:**
```javascript
{
  advocate: { trust_score, assessment_confidence, data_confidence, reasoning },
  arbiter: { trust_score, assessment_confidence, data_confidence, reasoning },
  synthesizer: {
    final_trust_score,
    agreements,
    disagreements,
    stronger_case,
    summary
  }
}
```

---

## Deep Investigation Framework (Planned)

Iterative investigation loop between collection and audit:

1. Rule-based checks identify fraud patterns (virtual addresses, timeline fabrication)
2. LLM cascade (DeepSeek → Gemini → Claude) generates follow-up queries
3. Serper API executes searches
4. Loop until max_iterations or no new queries
5. Enriched data passes to DialecticAuditAgent

**Status:** Planned, not yet implemented. See `docs/plans/2026-01-09-deep-investigation-framework.md`

---

## Review Strategic Sampling

To balance cost and fraud detection, review_analyzer.js samples:

| Category | Count | Rationale |
|----------|-------|-----------|
| Five-star reviews | 10 | Catch fake positive patterns |
| One-two star reviews | 10 | Surface real complaints |
| Mid-star reviews (3-4) | 5 | Balanced perspective |

This replaced the previous approach of truncating at 3000 chars (which missed fraud signals).

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| PostgreSQL over SQLite | Production scalability, concurrent access |
| DeepSeek over GPT-4 | Cost ($0.001/1K tokens vs $0.03), seed=42 for determinism |
| Playwright over APIs | Google Places API caused $300 overcharge |
| Pre-computed lien scores | 110KB raw data too large for LLM context |
| No score caps in dialectic | Trust LLM judgment with pre-analyzed data |
| temperature: 0 | Zero variance (was 29-point variance at 0.1) |

---

## Files by Function

| Function | File |
|----------|------|
| CLI entry | `bin/run_audit.js` |
| Batch orchestration | `bin/batch_audit_runner.js` |
| Collection only | `bin/batch_collect.js` |
| Core orchestration | `services/orchestrator.js` |
| Data collection | `services/collection_service.js` |
| Audit agents | `services/audit_agent.js` |
| Review analysis | `services/review_analyzer.js` |
| External APIs | `services/api_sources.js` |
| Score constraints | `services/scoring_constraints.js` |
| Database | `services/db_pg.js` |
| Python scrapers | `scrapers/*.py` |
| County liens | `scrapers/county_liens/*.py` |
```

**Step 2: Move old file to archive**

```bash
mv docs/SYSTEM_ARCHITECTURE.md docs/_archive/
```

**Step 3: Verify**

```bash
wc -l docs/ARCHITECTURE.md
```

Expected: ~180 lines

**Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md docs/_archive/SYSTEM_ARCHITECTURE.md
git commit -m "docs: create ARCHITECTURE.md system design reference"
```

---

## Task 4: Create SOURCES.md (Data Collection Reference)

**Files:**
- Create: `docs/SOURCES.md`
- Move: `docs/FORENSIC_SOURCES_MASTER.md` → `docs/_archive/`

**Step 1: Create SOURCES.md**

Create file `docs/SOURCES.md` with this content:

```markdown
# Contractor Auditor - Data Sources Reference

**Updated:** 2026-01-09

---

## API Keys

| API | Env Variable | Purpose | Status |
|-----|--------------|---------|--------|
| DeepSeek | `DEEPSEEK_API_KEY` | LLM audit analysis | Active |
| Serper | `SERPER_API_KEY` | Google search API | Active |
| SerpAPI | `SERPAPI_API_KEY` | Google Places (backup) | Active |
| Anthropic | `ANTHROPIC_API_KEY` | Claude Vision | Available |
| Google | `GOOGLE_API_KEY` | Gemini for browser-use | Available |
| Yelp | `YELP_API_KEY` | Yelp business data | Available |

**BANNED:** `GOOGLE_PLACES_API_KEY` - caused $300 overcharge. Use Playwright scraping instead.

---

## Tier 1: Reviews (24h cache)

| Source | Method | File | Status |
|--------|--------|------|--------|
| Google Maps (local) | Serper API | `collection_service.js` | Working |
| Google Maps (HQ) | Serper API | `collection_service.js` | Working |
| BBB | Python httpx | `scrapers/bbb.py` | Working |
| Yelp | Yahoo Search bypass | `scrapers/yelp.py` | Working |
| Trustpilot | Direct URL check | `scrapers/trustpilot.py` | Working |
| Angi | Serper rating extraction | `collection_service.js` | Working |
| Houzz | Serper rating extraction | `collection_service.js` | Working |

---

## Tier 2: News (12h cache)

| Source | Method | Status |
|--------|--------|--------|
| Google News | Serper search | Working |
| Local News | Serper search | Working |

---

## Tier 3: Social (24h cache)

| Source | Method | Status |
|--------|--------|--------|
| Reddit | Serper site:reddit.com | Working |
| YouTube | Serper site:youtube.com | Working |
| Nextdoor | Serper site:nextdoor.com | Working |

---

## Tier 4: Employee (7d cache)

| Source | Method | Status |
|--------|--------|--------|
| Indeed | Serper site:indeed.com | Working |
| Glassdoor | Serper site:glassdoor.com | Working |

---

## Tier 5: Government (7d cache)

| Source | Method | Status |
|--------|--------|--------|
| OSHA | Serper site:osha.gov | Working |
| EPA ECHO | Serper site:echo.epa.gov | Working |

---

## Tier 6: Texas-Specific (7d cache)

| Source | Method | Status |
|--------|--------|--------|
| TX Franchise Tax | API | Working |
| TX AG Complaints | Puppeteer | Unknown |
| TX SOS Search | Puppeteer | Unknown |
| TDLR | Removed | N/A - unreliable |

---

## Tier 7: Courts (7d cache)

| Source | Method | File | Status |
|--------|--------|------|--------|
| Tarrant County Liens | Playwright | `scrapers/county_liens/tarrant.py` | Working (48 records) |
| Collin County Liens | Playwright | `scrapers/county_liens/collin.py` | Working (50 records) |
| Dallas County Liens | Playwright | `scrapers/county_liens/dallas.py` | Working (942 records) |
| CourtListener | API | `services/api_sources.js` | Working (federal only) |

**Note:** County portals at `*.tx.publicsearch.us` (updated Dec 2025)

---

## Tier 8: Industry (24h cache)

| Source | Method | Status |
|--------|--------|--------|
| Porch | Serper | Working |
| BuildZoom | Serper | Working |
| HomeAdvisor | Serper | Working |

---

## Review Scraper Options

| Scraper | File | Method | Recommendation |
|---------|------|--------|----------------|
| google_reviews_serper.py | `scrapers/` | Serper /places + /reviews | **Recommended** - 100% success |
| google_reviews_tiered.py | `scrapers/` | Serper → SerpAPI fallback | Good backup |
| google_maps_browseruse.py | `scrapers/` | browser-use + Gemini | Slower, robust |
| google_maps_claude_vision.py | `scrapers/` | Playwright + Claude Vision | Most robust, expensive |
| outscraper_reviews.py | `scrapers/` | Outscraper API | $3/1000 reviews |
| google_maps.py | `scrapers/` | Playwright hardcoded | Breaks often |

---

## Cache TTLs

| Tier | TTL | Rationale |
|------|-----|-----------|
| Reviews (T1) | 24h | Ratings change slowly |
| News (T2) | 12h | News cycles faster |
| Social (T3) | 24h | Discussions slow |
| Employee (T4) | 7d | Job reviews rare |
| Government (T5) | 7d | Records stable |
| Texas (T6) | 7d | State data stable |
| Courts (T7) | 7d | Liens don't change |
| Industry (T8) | 24h | Platform updates |
```

**Step 2: Move old file to archive**

```bash
mv docs/FORENSIC_SOURCES_MASTER.md docs/_archive/
```

**Step 3: Verify**

```bash
wc -l docs/SOURCES.md
```

Expected: ~140 lines

**Step 4: Commit**

```bash
git add docs/SOURCES.md docs/_archive/FORENSIC_SOURCES_MASTER.md
git commit -m "docs: create SOURCES.md data collection reference"
```

---

## Task 5: Create DATABASE.md (Schema Reference)

**Files:**
- Create: `docs/DATABASE.md`
- Move: `docs/DATABASE_ANALYSIS.md` → `docs/_archive/`

**Step 1: Create DATABASE.md**

Create file `docs/DATABASE.md` with this content:

```markdown
# Contractor Auditor - Database Reference

**Updated:** 2026-01-09
**Database:** PostgreSQL `contractors_dev`

---

## Connection

```bash
export DATABASE_URL=postgresql://contractors_user:localdev123@localhost/contractors_dev
```

---

## Core Tables

### contractors_contractor

Master contractor data.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| business_name | VARCHAR | Company name |
| slug | VARCHAR | URL-friendly identifier |
| city, state, zip_code | VARCHAR | Location |
| phone, email, website | VARCHAR | Contact info |
| google_place_id | VARCHAR | Google Maps ID |
| google_rating | DECIMAL | 0-5 star rating |
| google_review_count | INTEGER | Number of reviews |
| trust_score | INTEGER | 0-100 audit score |
| last_audit_at | TIMESTAMP | Most recent audit |

### contractor_raw_data

Cached scraper results (TTL-based).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| contractor_id | INTEGER | FK to contractor |
| source_name | VARCHAR | 'bbb', 'yelp', 'google_maps', etc. |
| source_url | TEXT | URL scraped |
| raw_text | TEXT | Extracted content |
| structured_data | JSONB | Parsed data |
| fetch_status | VARCHAR | 'success', 'blocked', 'not_found', 'error' |
| fetched_at | TIMESTAMP | When scraped |
| expires_at | TIMESTAMP | Cache expiry |

### audit_records

Audit results with reasoning trace.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| contractor_id | INTEGER | FK to contractor |
| audit_version | INTEGER | 1=legacy, 4=dialectic |
| trust_score | INTEGER | 0-100 final score |
| risk_level | VARCHAR | CRITICAL/SEVERE/MODERATE/LOW/TRUSTED |
| recommendation | VARCHAR | AVOID/CAUTION/VERIFY/RECOMMENDED |
| reasoning_trace | TEXT | Full LLM reasoning (JSON for dialectic) |
| red_flags | JSONB | Array of issues found |
| positive_signals | JSONB | Array of good signals |
| collection_rounds | INTEGER | Data collection iterations |
| total_cost | DECIMAL | API costs |
| created_at | TIMESTAMP | Audit start |
| finalized_at | TIMESTAMP | Audit complete |

### county_lien_records

Lien search results from Texas counties.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| contractor_id | INTEGER | FK to contractor |
| county | VARCHAR | 'tarrant', 'collin', 'dallas' |
| liens_by_contractor | INTEGER | Liens filed BY contractor (positive) |
| liens_against_contractor | INTEGER | Liens filed AGAINST contractor (negative) |
| raw_results | JSONB | Full search results |
| searched_at | TIMESTAMP | When searched |

### collection_log

Scraping activity audit trail.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| contractor_id | INTEGER | FK to contractor |
| source_name | VARCHAR | Source scraped |
| requested_by | VARCHAR | 'initial', 'audit_agent', 'manual' |
| request_reason | TEXT | Why requested |
| status | VARCHAR | 'pending', 'success', 'failed' |
| started_at | TIMESTAMP | Start time |
| completed_at | TIMESTAMP | End time |
| error_message | TEXT | Error if failed |

---

## Audit Versions

| Version | Mode | Description |
|---------|------|-------------|
| 1 | Legacy | Old V1 agent with tools |
| 2 | Standard | V2 single-pass, no tools |
| 3 | (unused) | - |
| 4 | Dialectic | 3-persona adversarial |

Query dialectic audits:
```sql
SELECT * FROM audit_records WHERE audit_version = 4;
```

---

## Useful Queries

**Contractors needing audit:**
```sql
SELECT id, business_name, city
FROM contractors_contractor
WHERE trust_score IS NULL
   OR last_audit_at < NOW() - INTERVAL '30 days'
LIMIT 100;
```

**Audit success rate:**
```sql
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN trust_score >= 70 THEN 1 END) as recommended,
  ROUND(COUNT(CASE WHEN trust_score >= 70 THEN 1 END) * 100.0 / COUNT(*), 1) as pct
FROM audit_records
WHERE audit_version = 4;
```

**Stale cache (needs re-scrape):**
```sql
SELECT contractor_id, source_name, expires_at
FROM contractor_raw_data
WHERE expires_at < NOW()
ORDER BY expires_at;
```

---

## Django Models

Located in `contractors/models.py`:

| Model | Table |
|-------|-------|
| Vertical | contractors_vertical |
| Contractor | contractors_contractor |
| ContractorAudit | contractors_contractoraudit |
| RedFlag | contractors_redflag |
```

**Step 2: Move old file to archive**

```bash
mv docs/DATABASE_ANALYSIS.md docs/_archive/
```

**Step 3: Verify**

```bash
wc -l docs/DATABASE.md
```

Expected: ~150 lines

**Step 4: Commit**

```bash
git add docs/DATABASE.md docs/_archive/DATABASE_ANALYSIS.md
git commit -m "docs: create DATABASE.md schema reference"
```

---

## Task 6: Update Root Status Files

**Files:**
- Modify: `STATUS.md`
- Modify: `TODO.md`

**Step 1: Update STATUS.md header**

Update the date and add dialectic audit to "What's Working" section:

In `STATUS.md`, update line 2:
```markdown
**Updated:** 2026-01-09
```

Add to "What's Working" section (after AI Auditor table):

```markdown
### 5. Dialectic Audit System (NEW Jan 2026)
| Feature | Status |
|---------|--------|
| 3-persona mode | Working |
| Consumer Advocate persona | Working |
| Fair Arbiter persona | Working |
| Synthesizer persona | Working |
| audit_version=4 storage | Working |
| Full reasoning trace | Working |
```

**Step 2: Update TODO.md**

Ensure TODO.md reflects current priorities. If stale, update the P0/P1 items.

**Step 3: Commit**

```bash
git add STATUS.md TODO.md
git commit -m "docs: update STATUS.md and TODO.md to current state"
```

---

## Task 7: Update CLAUDE.md Documentation Index

**Files:**
- Modify: `CLAUDE.md:85-115` (Documentation Index section)

**Step 1: Update Documentation Index in CLAUDE.md**

Replace the "Documentation Index" and "Reference Documentation" sections with:

```markdown
### Status Files (Root)
| Need | File |
|------|------|
| Current priorities | `TODO.md` |
| System state | `STATUS.md` |
| Known bugs | `ERRORS.md` |

### Core Documentation (`docs/`)
| Need | File |
|------|------|
| **Session start** | `docs/QUICKREF.md` |
| System design | `docs/ARCHITECTURE.md` |
| Data sources | `docs/SOURCES.md` |
| Database schema | `docs/DATABASE.md` |
| Experiment log | `docs/EXPERIMENTS.md` |

### Implementation History (`docs/plans/`)
Recent plans (check for context on past work):
```bash
ls -lt docs/plans/ | head -5
```

### Archived Documentation (`docs/_archive/`)
Historical docs preserved for reference. Not needed for current work.
```

**Step 2: Verify CLAUDE.md still renders correctly**

```bash
head -120 CLAUDE.md
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md documentation index"
```

---

## Task 8: Final Verification

**Step 1: Check docs/ structure**

```bash
ls -la docs/*.md
```

Expected files:
- QUICKREF.md
- ARCHITECTURE.md
- SOURCES.md
- DATABASE.md
- EXPERIMENTS.md

**Step 2: Check _archive/ has old files**

```bash
ls docs/_archive/ | wc -l
```

Expected: 20+ archived files

**Step 3: Verify no broken references in CLAUDE.md**

```bash
grep -E "\`docs/[A-Z]" CLAUDE.md
```

All referenced files should exist.

**Step 4: Run git status to confirm all changes committed**

```bash
git status
```

Expected: Clean working tree or only unrelated changes.

---

## Summary

| Task | Files Changed | Commit Message |
|------|---------------|----------------|
| 1 | 15+ files moved | `docs: archive obsolete documentation files` |
| 2 | QUICKREF.md created | `docs: create QUICKREF.md session start guide` |
| 3 | ARCHITECTURE.md created | `docs: create ARCHITECTURE.md system design reference` |
| 4 | SOURCES.md created | `docs: create SOURCES.md data collection reference` |
| 5 | DATABASE.md created | `docs: create DATABASE.md schema reference` |
| 6 | STATUS.md, TODO.md updated | `docs: update STATUS.md and TODO.md to current state` |
| 7 | CLAUDE.md updated | `docs: update CLAUDE.md documentation index` |
| 8 | Verification | (no commit) |
