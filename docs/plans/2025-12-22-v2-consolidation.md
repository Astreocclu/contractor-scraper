# V2 Audit Agent Consolidation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate to V2 audit agent only, remove V1, preserve lien/review analysis systems, update all documentation.

**Architecture:** V2 receives ALL collected data upfront in prompt (no tools/web access), uses `deepseek-chat` with `seed: 42` for deterministic scoring. Collection (lien scraping, review analysis) remains unchanged.

**Tech Stack:** Node.js, DeepSeek API, PostgreSQL, Python scrapers (Playwright)

---

## Context from variancefinally.txt

The variance testing session revealed:
- V1 agent (with tools/web access) had 12-point variance
- V2 agent was broken - passed `[object Object]` to LLM instead of data (70-point variance)
- Fixed V2: proper JSON serialization + lien summary extraction + `deepseek-chat` + `seed: 42`
- Result: **ZERO variance** (35, 35, 35, 35, 35 across 5 runs)
- Score caps removed - trust LLM with standardized pre-analyzed data

**Key V2 wins:**
- No web access = deterministic data
- Pre-computed lien scores passed as summary (not 110KB of records)
- Review analysis passed as-is (already analyzed)
- Fixed seed = reproducible results

---

## Task 1: Rename V2 Agent to Primary

**Files:**
- Rename: `services/audit_agent_v2.js` → `services/audit_agent.js`
- Delete: `services/audit_agent.js` (current V1)

**Step 1: Backup V1 to archive (for reference only)**

```bash
mkdir -p archive/deprecated
mv services/audit_agent.js archive/deprecated/audit_agent_v1.js
```

**Step 2: Rename V2 to primary**

```bash
mv services/audit_agent_v2.js services/audit_agent.js
```

**Step 3: Update class name in file**

In `services/audit_agent.js`, change:
```javascript
// OLD
class AuditAgentV2 {
// ...
module.exports = { AuditAgentV2 };

// NEW
class AuditAgent {
// ...
module.exports = { AuditAgent };
```

**Step 4: Update header comment**

```javascript
// OLD
/**
 * Audit Agent V2 - Pure Analysis Engine
 *
 * Key changes from V1:
 * - Receives ALL collected data upfront in the prompt
 * - NO tools at all - pure analysis, no web access
 * - Returns structured JSON directly
 *
 * NOTE: Web search capability removed - agent works only with pre-collected data.
 */

// NEW
/**
 * Audit Agent - Pure Analysis Engine
 *
 * Receives ALL collected data upfront in the prompt.
 * NO tools - pure analysis, no web access.
 * Returns structured JSON directly.
 * Uses deepseek-chat with seed:42 for deterministic scoring.
 */
```

**Step 5: Verify no syntax errors**

```bash
node -c services/audit_agent.js
```

Expected: No output (silent success)

**Step 6: Commit**

```bash
git add services/audit_agent.js archive/deprecated/audit_agent_v1.js
git commit -m "refactor: consolidate to V2 audit agent as primary

- Archived V1 agent (had tool calls, web access, variance issues)
- V2 becomes primary audit_agent.js
- Pure analysis engine with no web access
- Uses deepseek-chat + seed:42 for determinism"
```

---

## Task 2: Update Orchestrator to Use New Agent

**Files:**
- Modify: `services/orchestrator.js:10` (import)
- Modify: `services/orchestrator.js:191` (instantiation)

**Step 1: Update import**

```javascript
// OLD (line 10)
const { AuditAgent } = require('./audit_agent');

// NEW (no change needed - same name now)
const { AuditAgent } = require('./audit_agent');
```

**Step 2: Update instantiation to match V2 signature**

The V2 agent doesn't take collectionService in constructor. Change line ~191:

```javascript
// OLD
const agent = new AuditAgent(db, contractorId, contractor);
const result = await agent.run(collectionService);

// NEW (V2 signature - no collectionService parameter)
const agent = new AuditAgent(db, contractorId, contractor);
const result = await agent.run();  // No parameter needed
```

**Step 3: Verify syntax**

```bash
node -c services/orchestrator.js
```

**Step 4: Run quick test**

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
node bin/run_audit.js --id 39 --dry-run
```

Expected: Audit completes with score output

**Step 5: Commit**

```bash
git add services/orchestrator.js
git commit -m "refactor: update orchestrator for V2 agent signature"
```

---

## Task 3: Update Batch Audit Runner

**Files:**
- Modify: `bin/batch_audit_runner.js` (no changes needed - uses orchestrator)

**Step 1: Verify batch runner still works**

The batch runner calls `runForensicAudit()` from orchestrator, which we updated. Test it:

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
node bin/batch_audit_runner.js --ids 39 --reset
```

Expected: Audit runs and completes

**Step 2: Commit (if any changes needed)**

```bash
git status  # Should show no changes to batch_audit_runner.js
```

---

## Task 4: Remove Deprecated audit_only.js

**Files:**
- Delete: `bin/audit_only.js`

**Step 1: Check if anything references it**

```bash
grep -r "audit_only" /home/reid/testhome/contractor-auditor --include="*.js" --include="*.md" | grep -v node_modules
```

Expected: Only the file itself and maybe docs

**Step 2: Delete the file**

```bash
rm bin/audit_only.js
```

**Step 3: Commit**

```bash
git add -u
git commit -m "chore: remove deprecated audit_only.js (V2 is now primary)"
```

---

## Task 5: Remove audit_version Column Logic

**Files:**
- Modify: `services/audit_agent.js:356-358` (hardcoded version)

**Step 1: Change audit_version to always be 2 (or remove distinction)**

In `services/audit_agent.js`, the INSERT has:
```javascript
2,  // audit_version: 2 = agentic audit v2
```

This is already correct. Just update the comment:

```javascript
// OLD
2,  // audit_version: 2 = agentic audit v2

// NEW
2,  // audit_version (V1 deprecated, V2 is now the only pipeline)
```

**Step 2: Commit**

```bash
git add services/audit_agent.js
git commit -m "docs: update audit_version comment (V1 deprecated)"
```

---

## Task 6: Update CLAUDE.md Pipeline Documentation

**Files:**
- Modify: `/home/reid/testhome/contractor-auditor/CLAUDE.md:138-155`

**Step 1: Replace V1/V2 section with single pipeline description**

Find the "Pipeline Architecture (V1 vs V2)" section and replace with:

```markdown
## Pipeline Architecture

The system uses a single audit pipeline:

### Entry Points
- **Single audit:** `bin/run_audit.js --id 123`
- **Batch audit:** `bin/batch_audit_runner.js --limit 100`

### Flow
1. `run_audit.js` → `orchestrator.js` → `collection_service.js` → `audit_agent.js`
2. Collection gathers data from all sources (Google, BBB, Yelp, county liens, etc.)
3. Review analyzer pre-processes reviews for authenticity
4. Lien scraper pre-computes lien scores with direction analysis
5. Audit agent receives ALL data in prompt (no web access)
6. Agent returns JSON with score, risk level, reasoning

### Key Design Decisions
- **No score caps:** LLM receives pre-analyzed data, trust its judgment
- **Deterministic:** Uses `deepseek-chat` + `seed: 42` for reproducible results
- **Pre-computed summaries:** Lien scores and review analysis passed as summaries, not raw data
- **Zero variance:** Tested at 0-point variance across 5 runs with complex contractors
```

**Step 2: Remove references to V1/V2 distinction throughout file**

Search and replace:
- "V1 Pipeline" → remove section
- "V2 Pipeline" → remove section
- "audit_agent_v2.js" → "audit_agent.js"
- "bin/batch_full_pipeline.js" → remove reference (if exists)

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for single V2 pipeline"
```

---

## Task 7: Update STATUS.md

**Files:**
- Modify: `STATUS.md`

**Step 1: Add section about V2 consolidation**

Add to "Recent Fixes" section:

```markdown
**V2 Consolidation (Dec 22):**
- Removed V1 agent (had tools, web access, 12-point variance)
- V2 is now the only pipeline (`services/audit_agent.js`)
- Zero variance achieved with `deepseek-chat` + `seed: 42`
- Score caps removed - trust pre-analyzed data
- Lien summaries extracted (not 110KB raw records)
```

**Step 2: Commit**

```bash
git add STATUS.md
git commit -m "docs: update STATUS.md with V2 consolidation"
```

---

## Task 8: Update TODO.md

**Files:**
- Modify: `TODO.md`

**Step 1: Mark V2 consolidation as done**

Add to "Done" section:

```markdown
- [x] **V2 Consolidation** (Dec 22, 2025)
  - Removed V1 agent (archived to `archive/deprecated/`)
  - V2 is now the only audit pipeline
  - Zero variance with `deepseek-chat` + `seed: 42`
  - Score caps removed
  - Lien/review pre-analysis preserved
```

**Step 2: Commit**

```bash
git add TODO.md
git commit -m "docs: mark V2 consolidation complete in TODO.md"
```

---

## Task 9: Update docs/AGENTIC_QUICKREF.md

**Files:**
- Modify: `docs/AGENTIC_QUICKREF.md`

**Step 1: Remove tool references (V2 has no tools)**

Replace the "Agent Tools" section:

```markdown
## Agent Design

The agent is a **pure analysis engine**:
- Receives ALL data upfront in prompt
- NO tools (no web access, no additional collection)
- Returns structured JSON directly
- Uses `deepseek-chat` + `seed: 42` for determinism

Pre-computed inputs:
- Review analysis (fake detection, discrepancy check)
- Lien scores (direction-aware: BY vs AGAINST)
- Platform ratings (Google, BBB, Yelp, Trustpilot, etc.)
```

**Step 2: Update "Example Agent Flow" to reflect no tools**

```markdown
## Agent Flow

```
1. Orchestrator runs collection_service.js
   → Scrapes all sources (Google, BBB, Yelp, liens, etc.)
   → Runs review_analyzer.js (fake detection)
   → Computes lien scores with direction

2. Orchestrator calls audit_agent.js
   → Agent receives: contractor info + all collected data
   → Agent analyzes and returns JSON

3. Result saved to audit_records
   → trust_score, risk_level, recommendation, reasoning
```
```

**Step 3: Commit**

```bash
git add docs/AGENTIC_QUICKREF.md
git commit -m "docs: update AGENTIC_QUICKREF for tool-less V2 agent"
```

---

## Task 10: Clean Up Unused Files

**Files:**
- Delete: `bin/batch_full_pipeline.js` (experimental V2 entry, no longer needed)
- Keep: `services/scoring_constraints.js` (may still be useful for future)

**Step 1: Check batch_full_pipeline.js usage**

```bash
grep -r "batch_full_pipeline" /home/reid/testhome/contractor-auditor --include="*.js" --include="*.md" | grep -v node_modules
```

**Step 2: Delete if no dependencies**

```bash
rm bin/batch_full_pipeline.js
```

**Step 3: Commit**

```bash
git add -u
git commit -m "chore: remove batch_full_pipeline.js (V2 consolidated into main pipeline)"
```

---

## Task 11: Final Verification

**Step 1: Run full audit test**

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
node bin/run_audit.js --id 39
```

Expected: Audit completes with score ~35 (AVOID)

**Step 2: Run variance test (5 sequential runs)**

```bash
for i in 1 2 3 4 5; do
  echo "Run $i:"
  node bin/run_audit.js --id 39 2>/dev/null | grep "Trust Score"
done
```

Expected: All 5 runs show same score (0-point variance)

**Step 3: Run batch test**

```bash
node bin/batch_audit_runner.js --ids 39,466 --reset
```

Expected: Both contractors audited successfully

**Step 4: Final commit with verification results**

```bash
git add .
git commit -m "test: verify V2 consolidation complete

Variance test: 0-point spread across 5 runs
Single audit: working
Batch audit: working"
```

---

## Summary

| Task | What Changes | Risk |
|------|--------------|------|
| 1 | Rename audit_agent_v2.js → audit_agent.js | LOW |
| 2 | Update orchestrator import/call | LOW |
| 3 | Verify batch runner | LOW |
| 4 | Delete audit_only.js | LOW |
| 5 | Update audit_version comment | TRIVIAL |
| 6 | Update CLAUDE.md | TRIVIAL |
| 7 | Update STATUS.md | TRIVIAL |
| 8 | Update TODO.md | TRIVIAL |
| 9 | Update AGENTIC_QUICKREF.md | TRIVIAL |
| 10 | Delete batch_full_pipeline.js | LOW |
| 11 | Final verification | N/A |

**Total estimated tasks:** 11
**Risk level:** LOW (mostly renames and doc updates)
