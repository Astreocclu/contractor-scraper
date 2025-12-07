# Codebase Cleanup Plan

## Overview
19 markdown files, 13 JS scripts, 7MB debug HTML. Needs organization.

---

## Phase 1: Delete Redundant Files

| File | Reason |
|------|--------|
| `CLAUDE_contractors_final.md` | Replaced by new CLAUDE.md |

---

## Phase 2: Archive Session Logs

Move to `docs/_archive/` (historical reference, not active docs):

| File | Size | Type |
|------|------|------|
| `AGENTIC_IMPLEMENTATION_SESSION.md` | 7KB | Session log |
| `conversation_export_contractor_scraper.md` | 4KB | Old conversation |
| `CONVERSATION_LOG_2025-12-05.md` | 6KB | Session log |
| `DEEPSEEK_LOGIC_ANALYSIS.md` | 18KB | Analysis doc |
| `DEEPSEEK_SCRAPER_SESSION.md` | 3KB | Session log |
| `FORENSIC_AUDIT_BUILD_SESSION.md` | 8KB | Session log |
| `SESSION_SUMMARY_2025-12-05.md` | 10KB | Session log |
| `TX_SOS_SCRAPER_SESSION.md` | 5KB | Session log |
| `SYSTEM_BREAKDOWN.txt` | 43KB | System dump |

---

## Phase 3: Organize Test Files

Move to `tests/` directory:

| File | Purpose |
|------|---------|
| `test_all_portals.js` | Portal testing |
| `test_bbb.js` | BBB parser test |
| `test_insurance_confidence.js` | Insurance scoring test |
| `test_sort.js` | Sort test |
| `batch_audit_test.js` | Audit batch test |

---

## Phase 4: Clean Generated Files

### Option A: Delete (can regenerate)
```bash
rm -rf debug_html/
rm -rf logs/
```

### Option B: Gitignore (keep locally)
Add to `.gitignore`:
```
debug_html/
logs/
*.log
portal_test_results.json
portal_test_run.log
```

---

## Phase 5: Consolidate Audit Scripts

**Current state:**
- `run_audit.js` - Full flow (collection + audit)
- `run_audit_v2.js` - Audit only (assumes pre-collected data)
- `forensic_audit_puppeteer.js` - 43KB monolithic version (deprecated?)

**Decision needed:**
1. Keep both `run_audit.js` and `run_audit_v2.js`? (different use cases)
2. Delete `forensic_audit_puppeteer.js`? (replaced by modular services/)

---

## Phase 6: Final Structure

```
contractors/
├── CLAUDE.md              # Main instructions
├── TODO.md                # Current priorities
├── STATUS.md              # System state
├── ERRORS.md              # Known issues
├── docs/
│   ├── AGENTIC_AUDIT_SPEC.md
│   ├── AGENTIC_QUICKREF.md
│   ├── CODEBASE_DOCUMENTATION.md
│   ├── DATABASE_ANALYSIS.md
│   ├── dfw-contractor-audit.md
│   └── _archive/          # Session logs
├── services/              # Core modules
├── lib/                   # Utilities
├── tests/                 # Test files
├── contractors/           # Django app
├── leads/                 # Django app
├── config/                # Django config
└── frontend/              # React frontend
```

---

## Execution Order

1. Delete `CLAUDE_contractors_final.md`
2. Create `docs/` and `docs/_archive/`
3. Move session logs to `docs/_archive/`
4. Move active docs to `docs/`
5. Create `tests/` and move test files
6. Update `.gitignore`
7. Decide on `forensic_audit_puppeteer.js`
8. Commit: "chore: organize codebase structure"

---

## Questions Before Proceeding

1. **Keep debug_html/?** (7MB of scraped HTML for debugging)
2. **Delete forensic_audit_puppeteer.js?** (43KB, may be deprecated)
3. **Keep both run_audit.js AND run_audit_v2.js?** (different workflows)
