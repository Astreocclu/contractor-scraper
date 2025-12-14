# Codebase Cleanup & Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical untracked code in `lib/`, consolidate cache directories, and clean up empty folders.

**Architecture:** Move gitignored production code to tracked locations, update imports, consolidate scattered cache to single `data/cache/` directory.

**Tech Stack:** Node.js (services), Python (scrapers), Django (admin), PostgreSQL (database)

---

## Phase 1: Fix Critical Git Issue (lib/ folder)

### Task 1: Move court_scraper.js to scrapers/

**Files:**
- Move: `lib/court_scraper.js` → `scrapers/court_scraper.js`
- Modify: `services/collection_service.js:11`

**Step 1: Copy the file to new location**

```bash
cp lib/court_scraper.js scrapers/court_scraper.js
```

**Step 2: Verify the copy succeeded**

Run: `diff lib/court_scraper.js scrapers/court_scraper.js`
Expected: No output (files identical)

**Step 3: Update import in collection_service.js**

Change line 11 from:
```javascript
const { searchCourtRecords } = require('../lib/court_scraper');
```

To:
```javascript
const { searchCourtRecords } = require('../scrapers/court_scraper');
```

**Step 4: Verify the import works**

Run: `cd /home/reid/testhome/contractor-auditor && node -e "require('./services/collection_service.js'); console.log('Import OK')"`
Expected: "Import OK" (no module not found errors)

**Step 5: Commit the move**

```bash
git add scrapers/court_scraper.js services/collection_service.js
git commit -m "refactor: move court_scraper.js from lib/ to scrapers/

- lib/ folder is gitignored, this code was untracked
- Update import path in collection_service.js"
```

---

### Task 2: Move tdlr_scraper.js to scrapers/

**Files:**
- Move: `lib/tdlr_scraper.js` → `scrapers/tdlr_scraper_legacy.js`

**Step 1: Check if tdlr_scraper already exists in scrapers**

Run: `ls scrapers/tdlr*.js scrapers/tdlr*.py 2>/dev/null || echo "No existing tdlr files"`
Expected: List any existing tdlr files to avoid naming conflicts

**Step 2: Copy with appropriate name**

```bash
cp lib/tdlr_scraper.js scrapers/tdlr_scraper_legacy.js
```

**Step 3: Check if this file is imported anywhere**

Run: `grep -r "lib/tdlr_scraper" --include="*.js" .`
Expected: If results found, those imports need updating

**Step 4: Commit**

```bash
git add scrapers/tdlr_scraper_legacy.js
git commit -m "refactor: move tdlr_scraper.js from untracked lib/ to scrapers/"
```

---

### Task 3: Move api_sources.js to services/

**Files:**
- Move: `lib/api_sources.js` → `services/api_sources.js`

**Step 1: Copy the file**

```bash
cp lib/api_sources.js services/api_sources.js
```

**Step 2: Check for imports**

Run: `grep -r "lib/api_sources" --include="*.js" .`
Expected: List any files that import this

**Step 3: Update any imports found (if any)**

If imports exist, change from:
```javascript
require('../lib/api_sources')
```
To:
```javascript
require('./api_sources')  // or '../services/api_sources' depending on location
```

**Step 4: Commit**

```bash
git add services/api_sources.js
git commit -m "refactor: move api_sources.js from untracked lib/ to services/"
```

---

### Task 4: Move db_schema.sql to db/

**Files:**
- Move: `lib/db_schema.sql` → `db/lib_schema.sql`

**Step 1: Copy the file**

```bash
cp lib/db_schema.sql db/lib_schema.sql
```

**Step 2: Commit**

```bash
git add db/lib_schema.sql
git commit -m "refactor: move db_schema.sql from untracked lib/ to db/"
```

---

### Task 5: Update .gitignore and clean up lib/

**Files:**
- Modify: `.gitignore:17`
- Delete: `lib/` folder

**Step 1: Comment out lib/ in .gitignore**

Change line 17 from:
```
lib/
```
To:
```
# lib/ - removed, was hiding production code
```

**Step 2: Verify lib/ is now empty or all files moved**

Run: `ls lib/`
Expected: Should show the original files still there (we copied, not moved)

**Step 3: Delete the lib/ folder**

```bash
rm -rf lib/
```

**Step 4: Commit the gitignore change**

```bash
git add .gitignore
git commit -m "refactor: remove lib/ from gitignore

CRITICAL FIX: lib/ was gitignored but contained production code:
- court_scraper.js (used by collection_service.js)
- tdlr_scraper.js
- api_sources.js
- db_schema.sql

All files have been moved to tracked locations."
```

---

## Phase 2: Cache Consolidation

### Task 6: Create centralized cache directory

**Files:**
- Create: `data/cache/.gitkeep`
- Modify: `.gitignore`

**Step 1: Create the directory structure**

```bash
mkdir -p data/cache
touch data/cache/.gitkeep
```

**Step 2: Add data/cache/ to .gitignore**

Add to end of `.gitignore`:
```
# Scraper cache (centralized)
data/cache/
!data/cache/.gitkeep
```

**Step 3: Commit**

```bash
git add data/cache/.gitkeep .gitignore
git commit -m "refactor: create centralized cache directory at data/cache/"
```

---

### Task 7: Update Python scraper cache path

**Files:**
- Modify: `scrapers/utils.py` (ScraperCache class `__init__` method)

**Step 1: Find the current cache path definition**

Run: `grep -n "scraper_cache\|cache_dir" scrapers/utils.py | head -20`
Expected: Shows line numbers where cache path is defined

**Step 2: Read the ScraperCache class**

Read `scrapers/utils.py` around the `__init__` method of `ScraperCache` class to understand current implementation.

**Step 3: Update the default cache path**

Change the `__init__` method from something like:
```python
def __init__(self, cache_dir: Optional[str] = None):
    self.cache_dir = Path(cache_dir) if cache_dir else Path('.scraper_cache')
    self.cache_dir.mkdir(parents=True, exist_ok=True)
```

To:
```python
def __init__(self, cache_dir: Optional[str] = None):
    if cache_dir:
        self.cache_dir = Path(cache_dir)
    else:
        # Default to data/cache in project root
        # utils.py is in scrapers/, so project root is parent
        root_dir = Path(__file__).parent.parent
        self.cache_dir = root_dir / "data" / "cache"
    self.cache_dir.mkdir(parents=True, exist_ok=True)
```

**Step 4: Verify Python syntax is valid**

Run: `cd /home/reid/testhome/contractor-auditor && python3 -c "from scrapers.utils import ScraperCache; print('Import OK')"`
Expected: "Import OK"

**Step 5: Commit**

```bash
git add scrapers/utils.py
git commit -m "refactor: update ScraperCache default path to data/cache/

Centralizes cache from scattered .scraper_cache/ folders to single location"
```

---

## Phase 3: Directory Cleanup

### Task 8: Delete empty utils/ folder

**Files:**
- Delete: `utils/` folder

**Step 1: Verify utils/ is empty**

Run: `ls -la utils/`
Expected: Only `.` and `..` entries (empty directory)

**Step 2: Delete the folder**

```bash
rmdir utils/
```

**Step 3: Verify deletion**

Run: `ls utils/ 2>&1`
Expected: "No such file or directory"

**Step 4: Commit (if utils was tracked)**

```bash
git status
# If utils/ shows as deleted, commit it
# If not tracked, no commit needed
```

---

### Task 9: Update CLAUDE.md with V1/V2 pipeline documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add pipeline documentation section**

Add after the "## File Map" section:
```markdown
---

## Pipeline Architecture (V1 vs V2)

The system has two execution pipelines. **Do not merge them** - they serve different purposes.

### V1 Pipeline (Production - Sequential)
- **Entry points:** `run_audit.js`, `batch_audit_runner.js`
- **Orchestrator:** `services/orchestrator.js`
- **Agent:** `services/audit_agent.js`
- **Features:** State persistence (batch_progress.json), resume capability, interactive mode
- **Use for:** Production audits, batch processing with resume

### V2 Pipeline (Experimental - Concurrent)
- **Entry point:** `batch_full_pipeline.js`
- **Agent:** `services/audit_agent_v2.js`
- **Features:** Stateless, concurrent execution, simplified flow
- **Use for:** Testing, experimentation

---
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add V1/V2 pipeline architecture documentation"
```

---

## Verification

### Task 10: Final verification

**Step 1: Verify no more untracked production code**

Run: `git status`
Expected: No critical files in untracked section

**Step 2: Verify lib/ is gone**

Run: `ls lib/ 2>&1`
Expected: "No such file or directory"

**Step 3: Verify imports still work**

Run: `cd /home/reid/testhome/contractor-auditor && node -e "require('./services/collection_service.js'); console.log('All imports OK')"`
Expected: "All imports OK"

**Step 4: Run a quick audit to verify system works**

Run: `cd /home/reid/testhome/contractor-auditor && source venv/bin/activate && set -a && . ./.env && set +a && node run_audit.js --id 1524 --skip-collection 2>&1 | head -20`
Expected: Audit starts without import errors

---

## Summary of Changes

| Original Location | New Location | Reason |
|-------------------|--------------|--------|
| `lib/court_scraper.js` | `scrapers/court_scraper.js` | Was gitignored, production code |
| `lib/tdlr_scraper.js` | `scrapers/tdlr_scraper_legacy.js` | Was gitignored |
| `lib/api_sources.js` | `services/api_sources.js` | Was gitignored |
| `lib/db_schema.sql` | `db/lib_schema.sql` | Was gitignored |
| `.scraper_cache/` (multiple) | `data/cache/` | Consolidate scattered caches |
| `utils/` | (deleted) | Empty folder |

## Deferred Work (Future Phases)

- [ ] Logging standardization (1000+ console.logs → winston/pino)
- [ ] Move root scripts to `scripts/` folder
- [ ] Pipeline merge (evaluate if V2 should replace V1)
- [ ] Clean up old `.scraper_cache/` directories after migration proven stable
