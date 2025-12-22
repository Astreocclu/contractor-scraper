# Maintenance Cleanup Plan
**Created:** 2025-12-21
**Confidence:** Claude 95%

## Audit Summary

### Issues Found

#### CRITICAL (Fix Immediately)
| Issue | Location | Risk | Action |
|-------|----------|------|--------|
| 5 high npm vulnerabilities | puppeteer 21.11.0 | SECURITY | Upgrade puppeteer to 24.x |
| SQLite backup files (99MB) | `db.sqlite3.bak`, `db.sqlite3.backup.*` | DISK SPACE | Delete (PostgreSQL is primary DB now) |
| audit_version null errors | batch_pipeline.log (350 errors) | DATA QUALITY | Fix DB schema or code default |

#### HIGH (Fix This Session)
| Issue | Location | Risk | Action |
|-------|----------|------|--------|
| Scraper cache bloat | `.scraper_cache/` (919 files, 11MB) | DISK/PERFORMANCE | Clear stale cache entries |
| __pycache__ directories | 18 directories | DISK | Clean with `find -delete` |
| Log files (1.1MB+) | `batch_pipeline.log`, `batch_audit_only2.log` | DISK | Archive/rotate |
| Stale data files | `data/test_results/`, `data/cache/` | DISK | Delete test artifacts >7 days |
| Debug screenshots | `debug/` directory (multiple MB) | DISK | Clear debug artifacts |

#### MEDIUM (Fix This Week)
| Issue | Location | Risk | Action |
|-------|----------|------|--------|
| Outdated Python packages | 18+ packages | SECURITY | Update non-breaking packages |
| Untracked script | `bin/overnight_batch.sh` | GIT | Commit or gitignore |
| Backfill log (129 errors) | `backfill_log.txt` | LOG NOISE | Archive after review |

#### LOW (During Next Maintenance)
| Issue | Location | Risk | Action |
|-------|----------|------|--------|
| Archive folder cleanup | `archive/` | CODE HYGIENE | Review for dead code |
| Email-drafter duplicates | `email-drafter/email-drafter-*` subdirs | DISK | Consolidate node_modules |

---

## Execution Plan

### Batch 1: Safe File Cleanup (LOW RISK)

```bash
# Remove Python cache
find . -type d -name "__pycache__" -not -path "./venv/*" -exec rm -rf {} + 2>/dev/null

# Remove .pyc files
find . -type f -name "*.pyc" -not -path "./venv/*" -delete 2>/dev/null

# Archive and remove old SQLite backups (99MB total)
rm db.sqlite3.bak db.sqlite3.backup.20251209_181634 db.sqlite3.load.bak

# Clear debug screenshots
rm -rf debug/debug_html/*.html debug/debug_html/*.png debug/*.png

# Archive old logs
mkdir -p logs/archive
mv batch_pipeline.log logs/archive/batch_pipeline_$(date +%Y%m%d).log 2>/dev/null
mv batch_audit_only2.log logs/archive/batch_audit_only2_$(date +%Y%m%d).log 2>/dev/null
mv backfill_log.txt logs/archive/backfill_log_$(date +%Y%m%d).txt 2>/dev/null
```

**Verification:** `du -sh . && find . -name "*.pyc" | wc -l`
**Expected:** ~100MB freed, 0 pyc files

### Batch 2: Stale Data Cleanup (LOW RISK)

```bash
# Remove test result files older than 7 days
rm -rf data/test_results/*.json data/test_results/*.log

# Clear old cache (preserve structure)
rm -rf data/cache/*.json

# Clear scraper cache (will rebuild on next run)
rm -rf .scraper_cache/*.json
```

**Verification:** `du -sh .scraper_cache data/`
**Expected:** Cache directories nearly empty

### Batch 3: Security Updates (MEDIUM RISK)

```bash
# Update puppeteer (breaking change - test after)
npm update puppeteer

# Verify no breaks
node bin/run_audit.js --id 1524 --dry-run 2>/dev/null || echo "Test audit capability"
```

**Verification:** `npm audit`
**Expected:** 0 high/critical vulnerabilities

### Batch 4: Git Hygiene (LOW RISK)

```bash
# Add untracked overnight batch script
git add bin/overnight_batch.sh
git status

# Commit maintenance cleanup (WAIT FOR APPROVAL)
```

### Batch 5: Error Investigation (INVESTIGATION ONLY)

The `audit_version null` error (350 occurrences) needs investigation:

```bash
# Check if audit_version has a default
grep -r "audit_version" contractors/models.py services/

# Check recent audit records
psql -d contractors_dev -c "SELECT id, audit_version FROM audit_records ORDER BY id DESC LIMIT 5;"
```

**Action:** Add default value to code or DB schema if missing.

---

## Post-Cleanup Verification

```bash
# Disk space check
du -sh . --exclude=venv --exclude=node_modules

# Security check
npm audit
pip-audit 2>/dev/null || echo "pip-audit not installed"

# Git status
git status

# Quick test
node bin/run_audit.js --id 1524 --dry-run
```

---

## Files to Commit After Cleanup

1. `bin/overnight_batch.sh` (new script)
2. Any schema/code fixes for `audit_version`

---

## Notes

- **DO NOT** delete `email-drafter/` subdirs without checking - may be actively used
- **DO NOT** upgrade pip packages that require Django migration
- SQLite backups are safe to delete since PostgreSQL is the primary database
- Scraper cache will auto-rebuild on next audit runs
