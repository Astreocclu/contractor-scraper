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
