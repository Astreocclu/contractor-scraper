# Dumb Lien Logic Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove LLM interpretation of lien direction. Use deterministic string matching (which column has the name?) and send only pre-computed summaries to the LLM.

**Architecture:** Python already computes direction correctly via `liens_by_contractor` / `liens_against_contractor`. We just need to: (1) add human-readable summary, (2) stop sending raw records to LLM, (3) add code-level score caps.

**Tech Stack:** Python (orchestrator.py), JavaScript (audit_agent.js, scoring_constraints.js)

---

## Task 1: Add Human-Readable Summary to Python

**Files:**
- Modify: `scrapers/county_liens/orchestrator.py:266-320` (calculate_lien_score function)

**Step 1: Read the current calculate_lien_score function**

Run: `grep -n "def calculate_lien_score" -A 60 scrapers/county_liens/orchestrator.py`

**Step 2: Add human_summary field to return dict**

After the existing `liens_by_contractor` / `liens_against_contractor` computation, add:

```python
# Build human-readable summary (line ~310, before the return statement)
by_count = len(liens_by_contractor)
against_count = len(liens_against_contractor)
unclear_count = len(liens_unclear)

if against_count > 0:
    if against_count >= 3:
        risk_level = 'SEVERE'
        summary = f"WARNING: {against_count} liens filed AGAINST {search_term} (contractor didn't pay suppliers/subs)"
    else:
        risk_level = 'MODERATE'
        summary = f"CAUTION: {against_count} lien(s) filed AGAINST {search_term} (potential payment issues)"
elif by_count > 0:
    risk_level = 'NONE'
    summary = f"OK: {by_count} liens filed BY {search_term} to collect payment (normal business, no penalty)"
else:
    risk_level = 'NONE'
    summary = f"CLEAN: No liens found for {search_term}"

# Add to return dict
```

**Step 3: Update the return statement**

Add these fields to the return dict:

```python
return {
    # ...existing fields...
    'human_summary': summary,
    'risk_level': risk_level,  # NONE, MODERATE, SEVERE
    'liens_by_count': by_count,
    'liens_against_count': against_count,
}
```

**Step 4: Test the change**

Run:
```bash
cd /home/reid/testhome/contractor-auditor && source venv/bin/activate && set -a && . ./.env && set +a
python3 -m scrapers.county_liens.orchestrator --name "Beautiful Backyard Living" --city "Dallas" --state "TX" 2>&1 | grep -A5 "human_summary\|risk_level"
```

Expected: See `human_summary` and `risk_level` in output.

**Step 5: Commit**

```bash
git add scrapers/county_liens/orchestrator.py
git commit -m "feat: add human_summary and risk_level to lien scoring"
```

---

## Task 2: Add Code-Level Score Caps in JavaScript

**Files:**
- Create: `services/scoring_constraints.js`
- Modify: `services/audit_agent.js` (import and use the new function)

**Step 1: Create scoring_constraints.js**

```javascript
// services/scoring_constraints.js
// Code-level enforcement of score caps based on lien data
// The LLM CANNOT override these caps

function enforceLienCaps(baseScore, lienData) {
    if (!lienData || !lienData.lien_score) return baseScore;

    const lienScore = lienData.lien_score;
    const againstCount = lienScore.liens_against_count || lienScore.liens_against_contractor?.length || 0;
    const notes = lienScore.notes || [];
    const hasTaxLien = notes.some(n => n.toLowerCase().includes('tax lien'));

    let maxScore = 100;
    let reason = null;

    // Liens AGAINST contractor = they didn't pay someone
    if (againstCount >= 3) {
        maxScore = 35;
        reason = `${againstCount} liens filed AGAINST contractor (pattern of non-payment)`;
    } else if (againstCount >= 1) {
        maxScore = 70;
        reason = `${againstCount} lien(s) filed AGAINST contractor (payment issues)`;
    }

    // Tax liens are critical
    if (hasTaxLien) {
        maxScore = Math.min(maxScore, 15);
        reason = 'Tax lien against contractor (CRITICAL)';
    }

    // Liens BY contractor = no penalty (they filed to collect, normal business)

    const cappedScore = Math.min(baseScore, maxScore);

    return {
        score: cappedScore,
        wasCapped: cappedScore < baseScore,
        maxAllowed: maxScore,
        reason: reason
    };
}

module.exports = { enforceLienCaps };
```

**Step 2: Run basic syntax check**

Run: `node -c services/scoring_constraints.js`
Expected: No syntax errors

**Step 3: Commit**

```bash
git add services/scoring_constraints.js
git commit -m "feat: add code-level lien score caps"
```

---

## Task 3: Simplify LLM Prompt - Send Summary, Not Raw Records

**Files:**
- Modify: `services/audit_agent.js` (formatDataForAgent or similar function)

**Step 1: Find where lien data is formatted for the LLM**

Run: `grep -n "county_liens\|lien" services/audit_agent.js | head -20`

**Step 2: Replace raw lien records with pre-computed summary**

Find the section that formats county_liens data. Replace sending raw records with:

```javascript
// Instead of raw lien records, send the pre-computed assessment
if (data.county_liens?.lien_score) {
    const ls = data.county_liens.lien_score;
    formattedData.lien_assessment = {
        summary: ls.human_summary || 'No lien data available',
        risk_level: ls.risk_level || 'UNKNOWN',
        liens_by_contractor: ls.liens_by_count || 0,
        liens_against_contractor: ls.liens_against_count || 0,
        score: ls.score,
        note: 'Liens BY contractor = they filed to collect payment (neutral). Liens AGAINST = red flag.'
    };
    // DO NOT include raw lien records - LLM should not re-interpret
}
```

**Step 3: Update the system prompt to use pre-computed assessment**

Find the lien interpretation instructions in the prompt and simplify to:

```
LIEN DATA: Use the pre-computed lien_assessment. Do NOT re-interpret raw lien records.
- liens_by_contractor: Contractor filed these to collect payment (NEUTRAL - no penalty)
- liens_against_contractor: Filed against contractor (RED FLAG)
- Accept the risk_level and human_summary as given.
```

**Step 4: Test with variance test**

Run:
```bash
node scripts/variance_test.js --id 101 --runs 3
```

Expected: All 3 runs should have scores within 5 points of each other.

**Step 5: Commit**

```bash
git add services/audit_agent.js
git commit -m "feat: send lien summary to LLM instead of raw records"
```

---

## Task 4: Integrate Score Caps into Audit Pipeline

**Files:**
- Modify: `services/audit_agent.js` (final score calculation)

**Step 1: Import the scoring constraints**

Add at top of file:
```javascript
const { enforceLienCaps } = require('./scoring_constraints');
```

**Step 2: Apply caps after LLM returns score**

Find where the final trust_score is set. Add:

```javascript
// After LLM returns its score
const lienCapResult = enforceLienCaps(llmScore, storedData.county_liens);
const finalScore = lienCapResult.score;

if (lienCapResult.wasCapped) {
    console.log(`⚠️ Score capped from ${llmScore} to ${finalScore}: ${lienCapResult.reason}`);
}
```

**Step 3: Test with known contractor**

Run:
```bash
node bin/run_audit.js --id 101 --skip-collection
```

Expected: If contractor has liens against them, score should be capped appropriately.

**Step 4: Commit**

```bash
git add services/audit_agent.js
git commit -m "feat: integrate lien score caps into audit pipeline"
```

---

## Task 5: Validate with Variance Test

**Step 1: Run variance test on contractor 101 (has liens BY contractor)**

Run:
```bash
node scripts/variance_test.js --id 101 --runs 5
```

Expected: Spread <= 5 points (was 60 points before)

**Step 2: Run variance test on contractor 39 (has liens AGAINST contractor)**

Run:
```bash
node scripts/variance_test.js --id 39 --runs 5
```

Expected: Score should be capped, spread <= 5 points

**Step 3: Document results**

Add results to `docs/validation/2025-12-20-dumb-lien-validation.md`

**Step 4: Final commit**

```bash
git add docs/validation/
git commit -m "docs: add dumb lien logic validation results"
git push
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add human_summary to Python | orchestrator.py |
| 2 | Create code-level score caps | scoring_constraints.js (new) |
| 3 | Send summary to LLM, not raw records | audit_agent.js |
| 4 | Integrate caps into pipeline | audit_agent.js |
| 5 | Validate with variance test | variance_test.js |

**Success Criteria:** Variance test on contractor 101 shows spread <= 5 points.
