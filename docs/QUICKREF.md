# Contractor Auditor - Quick Reference

**Purpose:** Daily operating reference for commands, files, and session start.

---

## Session Start Checklist (in order)

1. `AGENTS.md` / `CLAUDE.md`
2. `docs/tag-system-requirements.md`
3. `state/current.md`
4. `/home/astre/command-center/LESSONS.md`
5. `state/profile.md`
6. `sessions/YYYY-MM-DD.md` (tail if resuming)
7. `STATUS.md` + `TODO.md` + `ERRORS.md`

## Environment setup

```bash
source venv/bin/activate && set -a && . ./.env && set +a
```

---

## Commands

### Audit CLI

| Task | Command |
|------|---------|
| Single collection + audit | `node bin/run_audit.js --id <contractor_id>` |
| Single collection only | `node bin/run_audit.js --id <contractor_id> --collect-only` |
| Audit cached data only | `node bin/run_audit.js --id <contractor_id> --skip-collection` |
| Dialectic audit | `node bin/run_audit.js --id <contractor_id> --mode dialectic` |
| Council + full deep mode | `node bin/run_audit.js --id <contractor_id> --mode council --deep --investigation-mode full` |
| List recent audits | `node bin/run_audit.js --list` |
| Batch collection | `node bin/batch_collect.js --id <contractor_id> --force` |
| Batch audit | `node bin/batch_audit_runner.js --limit 100` |
| Run-100 lane (NON-NEGOTIABLE) | `node bin/hybrid_100_progressive_pipeline.js --group=<GROUP> --config=<manifest.json> --model=deepseek --fresh` |
| Run-100 manifest diagnostic (does not replace integrated lane command) | `node bin/source_missing_from_manifest.js --config=<config> --required=google_presence,bbb,court_records,county_liens,tx_franchise --verify-only` |
| Django API server | `python3 manage.py runserver 8002` |

## File Landmarks

| Purpose | File |
|---------|------|
| CLI entry | `bin/run_audit.js` |
| Batch orchestrator | `bin/batch_audit_runner.js` |
| Source orchestrator | `services/orchestrator.js` |
| Data collection service | `services/collection_service.js` |
| Audit scoring/logic | `services/audit_agent.js` |
| Review processing | `services/review_analyzer.js` |
| API/source wrapper | `services/api_sources.js` |
| DB access | `services/db_pg.js` |
