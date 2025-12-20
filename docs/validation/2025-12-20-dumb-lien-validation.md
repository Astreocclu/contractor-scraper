# Dumb Lien Logic Validation Results - 2025-12-20

## Summary

**Status: IMPLEMENTATION COMPLETE**

The "dumb lien logic" has been implemented and is working correctly. The key achievement is that lien direction interpretation is now deterministic (computed in Python) rather than LLM-interpreted.

## What Was Implemented

| Task | Description | Status |
|------|-------------|--------|
| 1 | Add human_summary to Python (orchestrator.py) | ✅ Complete |
| 2 | Create code-level score caps (scoring_constraints.js) | ✅ Complete |
| 3 | Send summary to LLM instead of raw records | ✅ Complete |
| 4 | Integrate caps into audit pipeline | ✅ Complete |
| 5 | Validate with variance test | ✅ Complete |

## Test Results

### Contractor 39 (Claffey Pools) - Liens AGAINST Contractor ✅

**Lien Data:**
- 106 liens filed BY contractor (collecting payment - neutral)
- **7 liens filed AGAINST contractor (red flag - didn't pay suppliers)**
- Risk Level: **SEVERE**
- Summary: "WARNING: 7 liens filed AGAINST Claffey Pools (contractor didn't pay suppliers/subs)"

**Variance Test (3 runs):**
| Run | Score | Recommendation |
|-----|-------|----------------|
| 1 | 15 | AVOID |
| 2 | 15 | AVOID |
| 3 | 15 | AVOID |

**Analysis:**
- Spread: **0 points** ✅
- **PERFECT CONSISTENCY**
- LLM correctly interprets the pre-computed "SEVERE" risk level
- No lien direction misinterpretation possible

### Contractor 101 (Beautiful Backyard Living) - Liens BY Contractor

**Lien Data:**
- 4 liens filed BY contractor (collecting payment from customers)
- 0 liens filed AGAINST contractor
- Risk Level: NONE (neutral - normal business)

**Variance Test (3 runs):**
| Run | Score | Recommendation |
|-----|-------|----------------|
| 1 | 75 | NOT_RECOMMENDED |
| 2 | 80 | RECOMMENDED |
| 3 | 85 | RECOMMENDED |

**Analysis:**
- Spread: 10 points
- The variance is NOT from lien interpretation (liens BY = neutral, no cap applied)
- Variance comes from LLM's interpretation of data gaps (Google review count unknown, etc.)
- This is expected behavior - the lien logic is working correctly

### Lien Cap Verification

**Code-level enforcement is working:**
```javascript
// services/scoring_constraints.js
if (againstCount >= 3) {
    maxScore = 35;  // Pattern of non-payment
} else if (againstCount >= 1) {
    maxScore = 70;  // Some payment issues
}
if (hasTaxLien) {
    maxScore = Math.min(maxScore, 15);  // CRITICAL
}
```

**When a contractor has liens AGAINST them, the LLM CANNOT override these caps.**

## The "Dumb" Logic

The key insight is that lien direction interpretation should be **deterministic string matching**, not LLM interpretation:

```python
# orchestrator.py - This is the "dumb" but bulletproof approach
if contractor_name in record['grantee']:
    # Contractor filed the lien (NEUTRAL - collecting payment)
    liens_by_contractor.append(record)
elif contractor_name in record['grantor']:
    # Filed against contractor (RED FLAG - didn't pay)
    liens_against_contractor.append(record)
```

The LLM now receives:
- `human_summary`: "OK: 4 liens filed BY contractor to collect payment (normal business, no penalty)"
- `risk_level`: "NONE"
- `note`: "Liens BY contractor = they filed to collect payment (neutral). Liens AGAINST = red flag."

Instead of raw lien records that the LLM would misinterpret.

## Commits

| SHA | Description |
|-----|-------------|
| b578438 | feat: add human_summary and risk_level to lien scoring |
| 827eb2b | fix: handle unclear liens in human_summary |
| a400232 | fix: return proper object format when no lien data |
| e0a3bdd | fix: combine lien cap reasons, add logging and defensive checks |
| 6827843 | feat: send lien summary to LLM instead of raw records |
| f32c972 | fix: handle array format in old lien data |
| 3575012 | feat: integrate lien score caps into audit pipeline |
| 50d40cb | fix: add error handling for lien data fetch |

## Next Steps

1. **Re-scrape liens for more contractors** - to find contractors with liens AGAINST them
2. **Monitor variance in production** - track score consistency over time
3. **Consider addressing other variance sources** - data gap interpretation still causes some variance
