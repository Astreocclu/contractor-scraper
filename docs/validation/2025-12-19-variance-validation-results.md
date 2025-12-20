# Variance Validation Results - 2025-12-19

## Executive Summary

**Status: NOT READY FOR SCALE-UP**

The variance testing revealed a **critical bug** in lien direction interpretation. While the temperature=0 fix reduced variance for known-good and known-bad contractors, the agent **inconsistently interprets liens filed BY contractors** (to collect payment), sometimes treating them as CRITICAL red flags when they should be neutral.

---

## Test Results

| Test | Result | Spread | Notes |
|------|--------|--------|-------|
| Known-good (ID 288) | FAIL | 8 pts | Scores 90-98, all RECOMMENDED |
| Known-bad (ID 1524) | PASS | 2 pts | Scores 10-12, all AVOID/CRITICAL |
| Liens-present (ID 101) | **FAIL** | **60 pts** | Scores 15-75 - lien interpretation unstable |

---

## Detailed Results

### Test 1: Known-Good Contractor (ID 288 - Dimensional Pro)

| Run | Score | Recommendation |
|-----|-------|----------------|
| 1 | 95 | RECOMMENDED |
| 2 | 98 | RECOMMENDED |
| 3 | 90 | RECOMMENDED |
| 4 | 95 | RECOMMENDED |
| 5 | 90 | RECOMMENDED |

**Spread: 8 points (FAIL - target ≤5)**

All runs correctly identified as RECOMMENDED, but score variance exceeds target. The agent takes different investigation paths leading to different conclusions.

### Test 2: Known-Bad Contractor (ID 1524 - Orange Elephant)

| Run | Score | Recommendation |
|-----|-------|----------------|
| 1 | 10 | AVOID |
| 2 | 12 | AVOID |
| 3 | 12 | AVOID |
| 4 | 12 | AVOID |
| 5 | 10 | AVOID |

**Spread: 2 points (PASS)**

Known fraud correctly identified every time. The CRITICAL score cap (≤15) is working as expected.

### Test 3: Liens-Present Contractor (ID 101 - Beautiful Backyard)

| Run | Score | Recommendation | Lien Interpretation |
|-----|-------|----------------|---------------------|
| 1 | 64 | NOT_RECOMMENDED | "Payment collection" - minor |
| 2 | 60 | NOT_RECOMMENDED | "Payment collection disputes" - minor |
| 3 | 75 | NOT_RECOMMENDED | "Filed BY contractor" - neutral |
| 4 | 55 | NOT_RECOMMENDED | "Communication issues" - concerning |
| 5 | 15 | AVOID | "Filed against customers" - CRITICAL (WRONG!) |

**Spread: 60 points (CRITICAL FAIL)**

The contractor has 4 mechanics liens filed BY them (GRANTEE = contractor) to collect payment from homeowners who didn't pay. This should be treated as neutral or minor - the contractor is protecting themselves.

**The Bug:** In run 5, the agent misinterpreted the data as "liens filed against customers" and treated it as CRITICAL, when the liens are actually filed BY the contractor against customers to collect payment owed.

---

## Root Cause Analysis

### What's Working

1. **Temperature=0**: Reduced variance for straightforward cases (known-good/known-bad)
2. **Score caps**: CRITICAL flags correctly cap at ≤15
3. **Lien data collection**: Direction fields (`liens_by_contractor`, `liens_against_contractor`) are present and correct

### What's Broken

1. **Lien interpretation is inconsistent**: The agent doesn't reliably distinguish between:
   - Liens filed BY contractor (GRANTEE = contractor) = neutral/minor (collecting payment owed)
   - Liens filed AGAINST contractor (GRANTOR = contractor) = red flag (supplier/subcontractor not paid)

2. **Agent reasoning varies**: Despite temperature=0, the agentic loop takes different paths:
   - Different collection requests each run
   - Different emphasis on the same data
   - Different severity assessment for liens

3. **Prompt ambiguity**: The prompt doesn't enforce consistent lien interpretation rules

---

## Recommendations

### Must Fix Before Scale-Up

1. **Pre-process lien interpretation** in code, not LLM:
   ```python
   # In scrapers/county_liens/orchestrator.py
   # Add explicit human-readable summary
   if liens_by_contractor > 0:
       summary = f"{liens_by_contractor} lien(s) filed BY THIS CONTRACTOR to collect payment from customers (contractor is CREDITOR - this is neutral/normal business practice)"
   if liens_against_contractor > 0:
       summary = f"{liens_against_contractor} lien(s) filed AGAINST THIS CONTRACTOR by suppliers/subcontractors (contractor is DEBTOR - RED FLAG)"
   ```

2. **Add lien score enforcement in code** similar to CRITICAL flag caps:
   ```javascript
   // In services/audit_agent.js or scoring_constraints.js
   if (liensAgainstContractor > 0) {
     maxScore = Math.min(maxScore, 60);  // Cap at MODERATE
   }
   if (liensAgainstContractor >= 3) {
     maxScore = Math.min(maxScore, 35);  // Cap at SEVERE
   }
   // liens BY contractor = no penalty
   ```

3. **Update LLM prompt** to be explicit:
   ```
   LIEN INTERPRETATION RULES (MANDATORY):
   - GRANTEE = creditor (filed the lien to collect payment)
   - GRANTOR = debtor (owes money)
   - If contractor is GRANTEE: They filed to collect payment from customer - NEUTRAL
   - If contractor is GRANTOR: Supplier/subcontractor filed against them - RED FLAG
   ```

### Optional Improvements

1. **Single-shot scoring**: Remove agentic loop, use one LLM call with all data
2. **Structured scoring**: Replace LLM judgment with formula-based scoring
3. **Ensemble scoring**: Run 3 times, take median

---

## Conclusion

**DO NOT PROCEED TO SCALE-UP** until the lien interpretation issue is fixed.

The system correctly identifies:
- ✅ Known fraud (Orange Elephant) → CRITICAL/AVOID
- ❌ Liens BY contractor → Inconsistent (should be neutral)

Next steps:
1. Fix lien interpretation (code-level, not LLM)
2. Re-run variance test on ID 101
3. Verify spread ≤5 points
4. Then proceed to scale-up

---

## Files Referenced

- `scripts/variance_test.js` - Variance testing script
- `scrapers/county_liens/orchestrator.py` - Lien data with direction fields
- `services/audit_agent.js` - Main audit agent (temperature=0)
- `services/scoring_constraints.js` - Score enforcement caps
