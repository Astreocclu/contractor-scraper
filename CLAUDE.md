# Contractor Intelligence System

## What This Is
Forensic contractor auditing. Puppeteer scrapes → DeepSeek analyzes → Trust Score.

## Isolation
- Port: 8002 | Database: db.sqlite3 | Venv: `./venv`
- Always keep completely separate from Boss (8000) and Pools (8001)

---

## LLM Startup Checklist

**Read these files IN ORDER before doing any work:**

1. `TODO.md` — Current priorities (what to work on)
2. `STATUS.md` — System state (what's working/broken)
3. `ERRORS.md` — Known issues (avoid repeating mistakes)
4. `docs/AGENTIC_QUICKREF.md` — Audit system overview (how it works)
5. Run `git status` — Confirm branch and uncommitted changes

---

## Documentation Index

All documentation is in `docs/` except the top-level status files.

| Need | File |
|------|------|
| Current priorities | `TODO.md` |
| System state | `STATUS.md` |
| Known bugs | `ERRORS.md` |
| **Audit quick reference** | `docs/AGENTIC_QUICKREF.md` |
| Audit full spec | `docs/AGENTIC_AUDIT_SPEC.md` |
| Codebase overview | `docs/CODEBASE_DOCUMENTATION.md` |
| Permit portals (CORRECTED) | `docs/dfw-contractor-audit-v3-corrected.md` |
| **MGO Scraper Status** | `docs/MGO_SCRAPER_STATUS.md` |
| Database stats | `docs/DATABASE_ANALYSIS.md` |
| Archived session logs | `docs/_archive/` |

---

## File Map

| Need | File |
|------|------|
| CLI entry | `run_audit.js` |
| Scraping | `services/collection_service.js` |
| DeepSeek agent | `services/audit_agent.js` |
| Score enforcement | `services/audit_agent_v2.js` |
| Review analysis | `services/review_analyzer.js` |

---

## Permit Scrapers

**Major updates Dec 6, 2025** - See `scrapers/README.md` and `docs/MGO_SCRAPER_STATUS.md`

---

## Commands

```bash
source venv/bin/activate && set -a && . ./.env && set +a

node run_audit.js --id 123
node run_audit.js --name "Company" --city "Dallas" --state "TX"
node batch_collect.js --id 123 --force
python manage.py runserver 8002
```

---

## Always Do These

### Terminology
- Always say `contractors` (the term `homescreen` is contaminated)
- Always say `pool` or `swimming pool` (the term `pool enclosure` means Florida screen rooms)
- Always say `clients` for homeowner leads from permits (formerly `leads` app)
- Always use DeepSeek + Puppeteer (Perplexity API is banned)
- Always use Puppeteer scraping (Google Places API caused $300 overcharge)

### Prompts
- Always use positive framing: "Remove ONLY these items: X, Y, Z"
- Always specify what to preserve: "Preserve all structural elements exactly"

### Scoring
- Always enforce score caps in code via `enforceScoreMultipliers()`
- Always parse structured data before sending to LLM

### Task Breakdown
- Always break work into phases (2-4 per project)
- Always break phases into tasks (3-5 per phase)
- Always break tasks into subtasks (2-3 per task)
- Each subtask should complete in one focused session

### Workflow
- Always read relevant docs before starting (see index above)
- Always analyze problems first, wait for confirmation before changes
- Always show `git status` before any git operations
- Always suggest commits, wait for approval before running

---

## Score Caps (Enforced in Code)

```
CRITICAL flag → max 15
SEVERE/HIGH  → max 35
MODERATE     → max 60
```

---

## Test Contractor
Orange Elephant Roofing (ID: 1524) - Known fraud, expect score ~15, CRITICAL
