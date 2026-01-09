# Implementation Plan: Experiment Logging System

**Date:** 2026-01-07
**Status:** Ready for implementation
**Estimated Tasks:** 4

---

## Problem

Between sessions, Claude has no memory of previous experiments, tests, or investigations. When user references "last time was damning" there's no context. Session exports exist but aren't structured for quick retrieval.

## Solution

Single `docs/EXPERIMENTS.md` file with:
- Auto-append from test scripts on completion
- Manual entries prompted by Claude after significant investigations
- Structured format for consistency

---

## Task 1: Create EXPERIMENTS.md with Header + Seed Entry

**File:** `docs/EXPERIMENTS.md`

**Action:** Create new file

**Content:**
```markdown
# Experiment Log

Tracks all experiments conducted in this project - automated tests and manual investigations.
Claude should read this file at session start for context on previous work.

---

## 2026-01-06 | A/B Test: Review Collection Strategy (10% vs Current)
- **Type:** automated
- **Hypothesis:** 10% sample (or 10 minimum) is sufficient for accurate trust scoring
- **Method:** Tested 30 contractors (10 small/10 medium/10 large), compared current strategy (Serper + SerpAPI if >50 reviews) vs proposed (10% or 10 min)
- **Results:**
  - 3,212 total reviews available
  - Current collected 1,319 (41%), Proposed collected 450 (14%)
  - Score match: 28/30 contractors (93%)
  - Score variance: 0.2 avg, 3 max
  - Cost: $3.03 → $1.71 (43% savings)
- **Conclusion:** Proposed strategy produces same scores with 66% fewer reviews. However, concern remains about under-sampling rare fraud signals. Need to test on known-fraud contractors.
- **Details:** [Full Analysis](analysis/review-strategy-full-analysis-2026-01-07.md)

---
```

**Verification:**
```bash
cat docs/EXPERIMENTS.md | head -30
```

---

## Task 2: Modify ab_test_reviews.js to Auto-Append

**File:** `bin/ab_test_reviews.js`

**Action:** Add function and call after report generation

**Find this section (end of main function, after writing reports):**
```javascript
console.log(`✅ JSON saved: ${jsonPath}`);
console.log(`✅ Markdown saved: ${mdPath}`);
```

**Add after it:**
```javascript
// Append summary to experiment log
appendToExperimentLog(testResults, jsonPath.replace(/.*docs\//, 'docs/'));
```

**Add this function (before main or at end of file):**
```javascript
function appendToExperimentLog(results, reportPath) {
  const experimentsPath = path.join(__dirname, '..', 'docs', 'EXPERIMENTS.md');

  // Calculate summary stats
  const totalReviews = results.reduce((sum, r) => sum + r.total_reviews, 0);
  const currentCollected = results.reduce((sum, r) => sum + (r.current?.actual_reviews || 0), 0);
  const proposedCollected = results.reduce((sum, r) => sum + (r.proposed?.actual_reviews || 0), 0);
  const currentCost = results.reduce((sum, r) => sum + (r.current?.collection_cost || 0), 0);
  const proposedCost = results.reduce((sum, r) => sum + (r.proposed?.collection_cost || 0), 0);

  const scoreDiffs = results.map(r => {
    const curr = r.current?.trust_score || 0;
    const prop = r.proposed?.trust_score || 0;
    return Math.abs(curr - prop);
  });
  const avgDiff = (scoreDiffs.reduce((a, b) => a + b, 0) / scoreDiffs.length).toFixed(1);
  const maxDiff = Math.max(...scoreDiffs);
  const matchCount = scoreDiffs.filter(d => d === 0).length;

  const date = new Date().toISOString().split('T')[0];
  const costSavings = ((1 - proposedCost / currentCost) * 100).toFixed(1);

  const entry = `
## ${date} | A/B Test: Review Collection Strategy
- **Type:** automated
- **Hypothesis:** 10% sample sufficient for accurate trust scoring
- **Method:** Tested ${results.length} contractors across size buckets
- **Results:**
  - Reviews: ${totalReviews} available, Current got ${currentCollected}, Proposed got ${proposedCollected}
  - Score match: ${matchCount}/${results.length} (${((matchCount/results.length)*100).toFixed(0)}%)
  - Score variance: ${avgDiff} avg, ${maxDiff} max
  - Cost: $${currentCost.toFixed(2)} → $${proposedCost.toFixed(2)} (${costSavings}% savings)
- **Conclusion:** [FILL IN MANUALLY]
- **Details:** [Full Report](${reportPath.replace('docs/', '')})

---
`;

  fs.appendFileSync(experimentsPath, entry);
  console.log(`✅ Experiment logged: ${experimentsPath}`);
}
```

**Verification:**
```bash
# Run a small test (or check that function exists)
grep -n "appendToExperimentLog" bin/ab_test_reviews.js
```

---

## Task 3: Update CLAUDE.md Startup Protocol

**File:** `CLAUDE.md`

**Action:** Add EXPERIMENTS.md to mandatory reads

**Find this section:**
```markdown
## LLM Startup Checklist

**Read these files IN ORDER before doing any work:**

1. `TODO.md` — Current priorities (what to work on)
2. `STATUS.md` — System state (what's working/broken)
3. `ERRORS.md` — Known issues (avoid repeating mistakes)
4. `docs/AGENTIC_QUICKREF.md` — Audit system overview (how it works)
5. Run `git status` — Confirm branch and uncommitted changes
```

**Replace with:**
```markdown
## LLM Startup Checklist

**Read these files IN ORDER before doing any work:**

1. `TODO.md` — Current priorities (what to work on)
2. `STATUS.md` — System state (what's working/broken)
3. `ERRORS.md` — Known issues (avoid repeating mistakes)
4. `docs/EXPERIMENTS.md` — Previous tests/investigations (what was tried, what we learned)
5. `docs/AGENTIC_QUICKREF.md` — Audit system overview (how it works)
6. Run `git status` — Confirm branch and uncommitted changes
```

**Verification:**
```bash
grep -A 10 "LLM Startup Checklist" CLAUDE.md
```

---

## Task 4: Add Manual Logging Rule to CLAUDE.md

**File:** `CLAUDE.md`

**Action:** Add new section for experiment logging behavior

**Find the end of the "Always Do These" section and add:**

```markdown
### Experiment Logging
- After completing any test/investigation with **measurable outcomes** (metrics, scores, pass/fail), ask: "Should this be logged to EXPERIMENTS.md?"
- "Significant" means: measurable outcome + method is repeatable + results influence decisions + took >15 min
- If yes, append structured entry: Date, Type, Hypothesis, Method, Results, Conclusion, Details link
- For automated scripts: they append automatically, no prompt needed
```

**Verification:**
```bash
grep -A 5 "Experiment Logging" CLAUDE.md
```

---

## Verification: Full System Test

After all tasks complete:

```bash
# 1. Check EXPERIMENTS.md exists with seed entry
head -30 docs/EXPERIMENTS.md

# 2. Check ab_test_reviews.js has append function
grep -c "appendToExperimentLog" bin/ab_test_reviews.js

# 3. Check CLAUDE.md has EXPERIMENTS.md in startup list
grep "EXPERIMENTS.md" CLAUDE.md

# 4. Check CLAUDE.md has manual logging rule
grep "Should this be logged" CLAUDE.md
```

**Expected output:**
- Task 1: Seed entry visible
- Task 2: Returns "2" (function def + call)
- Task 3: Returns line with EXPERIMENTS.md in startup list
- Task 4: Returns line with prompt rule

---

## Future Enhancements (Out of Scope)

- [ ] Add logging to other experiment scripts as they're created
- [ ] CLI tool to query experiments: `node bin/experiments.js search "review"`
- [ ] Auto-link experiments to git commits
