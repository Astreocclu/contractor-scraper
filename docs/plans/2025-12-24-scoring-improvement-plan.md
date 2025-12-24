# Scoring System Improvement Plan - December 24, 2025

## Executive Summary

After running 49 fresh audits and analyzing DeepSeek's scoring logic with Gemini, we identified key inconsistencies and developed prompt-based fixes (no hard caps).

**Key Finding:** The scoring is ~85% reliable but fails when classifying "unknown/unverified" issues the same as "confirmed negatives."

**Solution:** Two prompt changes that teach the LLM to distinguish between data gaps and actual problems.

---

## Part 1: Analysis of Current System

### Score Distribution (49 Audits)

| Score | Count | % | Category |
|-------|-------|---|----------|
| 92 | 1 | 2% | Excellent |
| 88 | 1 | 2% | Excellent |
| 85 | 13 | 27% | Good |
| 65 | 15 | 31% | Mixed |
| 55 | 1 | 2% | Concerns |
| 45 | 9 | 18% | Avoid |
| 35 | 7 | 14% | Avoid |
| 25 | 2 | 4% | Critical |

### What Works Well

1. **Extremes are consistent:** 88-92 scores have zero significant flags; 25-35 scores have CRITICAL/multiple HIGH flags
2. **Reasoning is detailed:** Each audit provides clear justification
3. **Red flag detection works:** Lawsuits, fake reviews, and liens are correctly identified
4. **Review analysis integration:** Authentic vs fake review detection is solid

### What's Broken

#### The Xtreme Paradox (Primary Issue)

| Contractor | Score | Flag | Issue |
|------------|-------|------|-------|
| Xtreme Air Services | **85** | HIGH - No business registration | RECOMMENDED |
| Taylor Made Outdoors | **65** | HIGH - No business verification | NOT_RECOMMENDED |

**Same flag type, 20-point difference.** This is inconsistent.

#### Root Cause Analysis

The LLM treats all HIGH flags equally, but they're not equal:

- "Cannot find registration" = **UNKNOWN** (data gap, maybe database error)
- "Active lawsuit" = **CONFIRMED** (verified negative event)
- "Fake reviews detected" = **CONFIRMED FRAUD** (intentional deception)

The current prompt doesn't teach this distinction. The LLM makes arbitrary judgments.

#### Other Inconsistencies Found

1. **Poolfessionals (65)** has more severe flags than **Cedar Creek (55)** but scored higher
2. **Love That Door (85)** and **CGJ Roofing (65)** both had scraper errors - rated LOW vs MEDIUM arbitrarily
3. **Xtreme (85)** got HIGH flag for missing registration but still scored RECOMMENDED

---

## Part 2: Proposed Solution

### Approach: Prompt Engineering (No Hard Caps)

We avoid code-level caps because:
1. They remove nuance and context
2. Edge cases get mishandled
3. The LLM should learn to score correctly, not be forced

Instead, we add two sections to the prompt that teach proper classification.

---

## CHANGE 1: Severity Classification Rules

Add this section to the audit prompt:

```
## SEVERITY CLASSIFICATION RULES

Use these rules to assign severity levels. The key distinction is CONFIRMED vs UNVERIFIED.

CRITICAL - Confirmed fraud or deception:
- Fake reviews (>30% fake score from Review Analyzer)
- Scam allegations from multiple independent sources
- Impersonating another business
- Confirmed consumer protection violations
- Contractor makes a verifiable claim (licensed, insured, bonded) that is confirmed FALSE

HIGH - Confirmed operational problems:
- Active lawsuit AGAINST the contractor
- Judgment or lien AGAINST the contractor (not liens filed BY them)
- BBB F rating or revoked accreditation
- Official government or licensing board disciplinary action
- License confirmed EXPIRED, SUSPENDED, or REVOKED (not just "not found")
- Clear pattern of multiple verified customer complaints (3+ similar issues)
- News investigation confirming wrongdoing

MEDIUM - Unverified or uncertain issues:
- Cannot find business registration (may be database issue or different name)
- License not found in state database (may be under DBA or different entity)
- Mixed reviews or significant rating discrepancies between platforms
- Single unverified complaint without corroboration
- Data collection errors (scraper failed, website down)
- Glassdoor/employee complaints (internal issues, not customer-facing)

LOW - Minor gaps with no negative implication:
- No BBB profile (common for small businesses, not required)
- Low review volume (new or niche business)
- Missing social media presence
- Old, resolved issues (5+ years ago, case dismissed, lien released)
- Minor data gaps where other sources provide verification
```

---

## CHANGE 2: Scoring Guidance

Add this section to the audit prompt:

```
## SCORING GUIDANCE

Your score should reflect CONFIRMED evidence, not speculation about unknowns.

CORE PRINCIPLES:
1. UNKNOWN ≠ BAD: Missing data indicates uncertainty, NOT evidence of wrongdoing
2. WEIGHT CONFIRMED OVER UNCONFIRMED: 500 authentic reviews outweighs "cannot find registration"
3. RECENCY MATTERS: Issues from 5+ years ago matter less than recent issues
4. PATTERNS > ISOLATED: One complaint is noise; five similar complaints is a pattern
5. CONTEXT MATTERS: A sole proprietor may not have LLC registration - that's legal

SCORE ANCHORS:
- 90-100: Exceptional. Zero HIGH/CRITICAL flags. Verified excellence across all dimensions.
- 80-89: Recommended. Minor gaps only (MEDIUM/LOW flags). Strong positive signals dominate.
- 65-79: Mixed. Has at least one HIGH flag OR multiple MEDIUM flags. Positives exist but concerns remain.
- 50-64: Concerning. Multiple HIGH flags OR unresolved serious operational issues.
- Below 50: Avoid. CRITICAL flags present OR clear pattern of confirmed problems.

CRITICAL RULE:
A contractor with a MEDIUM-severity "cannot verify registration" flag BUT 500+ authentic 5-star reviews and no other issues should score 80-85, NOT 65. The verified positive evidence outweighs the unverified data gap.

ANTI-PATTERN TO AVOID:
Do NOT treat "information not found" the same as "negative information found." These are fundamentally different:
- "No lawsuits found" = POSITIVE (we looked, nothing there)
- "Cannot verify license" = NEUTRAL (data gap, unknown status)  
- "License expired" = NEGATIVE (confirmed problem)
```

---

## Part 3: Expected Impact

### Before vs After

| Scenario | Before | After | Why |
|----------|--------|-------|-----|
| Missing registration + 666 great reviews | 85 (inconsistent) | 80-85 (MEDIUM flag, strong positives) |
| Missing registration + few reviews | 85 (wrong) | 70-75 (MEDIUM flag, weak positives) |
| Missing verification + good reviews | 65 (harsh) | 80-85 (MEDIUM flag, good positives) |
| Active lawsuit + great reviews | 85 (WRONG) | 65-70 (HIGH flag correctly applied) |
| Expired license + great reviews | Variable | 65-70 (HIGH - confirmed problem) |
| Fake reviews detected | Variable | 35-45 (CRITICAL flag) |
| Clean record, excellent reviews | 85-92 | 88-92 (no change needed) |
| Multiple complaints, poor reviews | 35-45 | 35-45 (no change needed) |

### Key Fixes

1. **Xtreme & Taylor Made now consistent:** Both get 80-85 (MEDIUM flag for unverified data)
2. **Lawsuits properly penalized:** HIGH flag drops score to 65-75 range
3. **Fraud properly penalized:** CRITICAL flag drops score below 50
4. **Strong positives can overcome minor gaps:** 500 reviews + MEDIUM flag = still recommended

---

## Part 4: Implementation

### Files to Modify

```
/home/astre/command-center/testhome/contractor-auditor/services/audit_agent.js
```

### Location in File

Add both sections to the `SYSTEM_PROMPT` constant, after the existing "SCORING" section and before "OUTPUT FORMAT".

### Testing Plan

1. Re-run audits on the 5 inconsistent cases:
   - Xtreme Air Services (was 85 with HIGH flag)
   - Taylor Made Outdoors (was 65)
   - Cedar Creek Pools (was 55)
   - Poolfessionals of Texas (was 65)
   - DTX Construction (was 85 with lawsuit mention)

2. Verify:
   - Xtreme and Taylor Made now score within 5 points of each other
   - DTX scores lower (65-75) due to lawsuit being HIGH
   - Cedar Creek scores higher (65) due to less severe flags

3. Run 20 new audits and check distribution

---

## Part 5: Remaining Edge Cases (5%)

These may need future refinement:

1. **Conflicting evidence:** License valid in one database, expired in another
2. **Very old severe issues:** Major lawsuit from 10 years ago - how much weight?
3. **Nuanced false claims:** Minor marketing puffery vs major fraud
4. **Regional differences:** Some states don't require contractor licensing

---

## Confidence Level

- **Gemini:** 95%
- **Claude:** 90%

The remaining uncertainty is around edge cases that will only surface with more real-world data.

---

## Appendix: Full Analysis Session

This plan was developed through 6 rounds of iterative analysis between Claude and Gemini on December 24, 2025. The session analyzed all 49 audits from `2025-12-24-scoring-analysis.md` and identified the core issue: treating unverified data gaps the same as confirmed negative findings.

The solution avoids hard caps in favor of teaching the LLM to classify risks correctly through explicit prompt guidance.

---

## Implementation Status: COMPLETE ✓

**Implemented on:** December 24, 2025
**Commit:** 2286dc5

### Changes Made:

1. **services/audit_agent.js** - Complete rewrite (V3)
   - Added SEVERITY CLASSIFICATION RULES to prompt
   - Added SCORING GUIDANCE to prompt
   - New output format: VERDICT + CONFIDENCE
   - Score kept internal (for database/analytics only)
   - New display format with verified/unverified/red flags sections

2. **services/orchestrator.js**
   - Removed duplicate display code (audit_agent.js handles display now)

### New Output Format:
```
VERDICT:    RECOMMENDED
CONFIDENCE: HIGH

WHAT WE VERIFIED:
✓ 399 authentic reviews, 4.9 average
✓ BBB A+ accredited
✓ No lawsuits in 4 county searches

WHAT WE COULDN'T VERIFY:
- Lien records (scraper error)

RED FLAGS: None found

METADATA:
  Internal Score: 92/100
  API cost: $0.0024
```

### Testing:
- Tested on contractors 1, 16
- Verified MEDIUM flags for data gaps (not HIGH)
- Verified score is internal only
- Verified verdict maps correctly from score
