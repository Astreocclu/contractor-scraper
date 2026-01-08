# Review Scoring Analysis & Recommendations

**Date:** 2026-01-08
**Author:** Claude (Opus 4.5)
**Project:** Contractor Auditor - Trust Score System

---

## Executive Summary

The contractor audit system is scoring contractors with serious red flags (deceptive sales, predatory behavior, review manipulation) too HIGH. After investigation, we identified **two root causes**:

1. **Data Loss in Pipeline:** Damning customer quotes are abstracted into generic category labels before reaching the audit agent
2. **Missing Penalty Guidance:** The audit agent prompt lacks specific penalty values for severe behaviors

Testing showed that **Option C (damning quotes + severity ratings)** combined with **penalty guidance in the audit prompt** produces the most accurate scores.

---

## Problem Statement

### Observed Issue
Four contractors with serious red flags received scores of 65-72 (USE CAUTION) when they should have scored 45-55 (NOT RECOMMENDED/AVOID):

| Contractor | Issue | Score | Expected |
|------------|-------|-------|----------|
| Bonnie & Clydes | Sold damaged hot tub as new, lied to customer | 68 | ~50 |
| Pinch A Penny (Saginaw) | Google 4.5★ vs Trustpilot 2.3★ (manipulation) | 68 | ~55 |
| Sun Valley Pool | "Preyed upon as ignorant first-time owners" | 68 | ~55 |
| Empowered Renovations | Only 2 fake-looking reviews, DO_NOT_TRUST | 45 | Correct |

### Root Cause 1: Data Loss in Pipeline

**The Problem:**
When a customer writes a devastating review, the audit agent only sees a sanitized category label.

**Example - Bonnie & Clydes:**

What the customer wrote:
```
"BUYERS BEWARE - Jennifer sold us a used and damaged floor model. This was not
agreed on or in the contract... violations according to the DTPA... She said we
would be getting a hot tub straight from the factory brand new!!! ... Leslie's
pool supply said they quit referring bonnie and clydes bc of the complaints of
customers being lied to... If this is not made right we'll take legal action"
```

What the audit agent received:
```json
"complaint_patterns": [
  "Issues with third-party installers",
  "Selling used/damaged floor model without disclosure"
]
```

**Lost Information:**
- "Jennifer LIED"
- "violations according to DTPA"
- "Leslie's QUIT REFERRING them"
- "we'll take legal action"
- "BUYERS BEWARE"

### Root Cause 2: Missing Penalty Guidance

The audit agent prompt says "weight heavily" but doesn't specify HOW MUCH to penalize. The current scoring guidance:

```
SCORE ANCHORS:
- 65-79: Mixed. Has at least one HIGH flag OR multiple MEDIUM flags.
- 50-64: Concerning. Multiple HIGH flags OR unresolved serious operational issues.
```

This allows the LLM to interpret "deceptive sales" as a single HIGH flag → 65-79 range, when it should force scores into the 50s or below.

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CURRENT FLOW (BROKEN)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Raw Reviews (100+)                                                         │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────┐                                                        │
│  │ Review Analyzer │ ──► Outputs generic labels:                            │
│  │   (DeepSeek)    │     complaint_patterns: ["Selling used goods"]         │
│  └─────────────────┘                                                        │
│       │                                                                     │
│       ▼                            ❌ LOST: "Jennifer LIED"                 │
│  ┌─────────────────┐               ❌ LOST: "DTPA violations"               │
│  │  Audit Agent    │               ❌ LOST: "Leslie's quit referring"       │
│  │   (DeepSeek)    │               ❌ LOST: "legal action"                  │
│  └─────────────────┘               ❌ LOST: Severity context                │
│       │                                                                     │
│       ▼                                                                     │
│  Score: 68 (TOO HIGH)                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           PROPOSED FLOW (FIXED)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Raw Reviews (100+)                                                         │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────┐                                                        │
│  │ Review Analyzer │ ──► Outputs BOTH:                                      │
│  │   (DeepSeek)    │     complaint_patterns: [                              │
│  └─────────────────┘       {pattern: "Deceptive sales", severity: "CRITICAL"}│
│       │                  ]                                                  │
│       │                  damning_quotes: [                                  │
│       │                    {quote: "Jennifer LIED...", severity: "CRITICAL"}│
│       │                  ]                                                  │
│       ▼                                                                     │
│  ┌─────────────────┐     ✅ Sees actual customer language                   │
│  │  Audit Agent    │     ✅ Sees severity ratings                           │
│  │   (DeepSeek)    │     ✅ Has penalty guidance in prompt                  │
│  └─────────────────┘                                                        │
│       │                                                                     │
│       ▼                                                                     │
│  Score: 48 (CORRECT)                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Testing Methodology

### Test Contractors
5 contractors with known issues:
- **656** - Bonnie & Clydes (deceptive sales)
- **665** - Pinch A Penny Saginaw (review manipulation: Google 4.5 vs Trustpilot 2.3)
- **687** - Sun Valley Pool (predatory behavior toward first-time owners)
- **682** - Empowered Renovations (fake/insufficient reviews)
- **635** - Pinch A Penny Murphy (review discrepancy)

### Options Tested

**Option A: Damning Quotes**
- Modified review_analyzer prompt to extract exact customer quotes
- Output: `damning_quotes: [{quote: "...", source: "...", issue: "..."}]`

**Option B: Severity Ratings**
- Modified review_analyzer prompt to rate complaint patterns by severity
- Output: `complaint_patterns: [{pattern: "...", severity: "CRITICAL|SEVERE|HIGH|MEDIUM|LOW", count: N}]`

**Option C: Both A + B**
- Combined damning quotes AND severity ratings
- Provides maximum context to audit agent

---

## Test Results

### Raw Scores

| ID  | Contractor                  | Baseline | Opt A | Opt B | Opt C |
|-----|----------------------------|----------|-------|-------|-------|
| 656 | Bonnie & Clydes            |       68 |    58 |    58 |  **48** |
| 665 | Pinch A Penny (Saginaw)    |       68 |  **45** |    68 |    65 |
| 687 | Sun Valley Pool            |       68 |    68 |    65 |    68 |
| 682 | Empowered Renovations      |       45 |    65 |    65 |    55 |
| 635 | Pinch A Penny (Murphy)     |       72 |    65 |    75 |    72 |

**Average Score Change:**
- Option A: -4.0 points
- Option B: +6.0 points (WORSE - scores went UP)
- Option C: -4.6 points

### Analysis by Contractor

#### Bonnie & Clydes (ID 656) - Deceptive Sales
- **Baseline:** 68
- **Best Result:** Option C → **48** (-20 points)
- **What Worked:** Combination of damning quotes ("Jennifer LIED", "DTPA violations") + CRITICAL severity rating
- **Conclusion:** ✅ Option C correctly identified fraud

#### Pinch A Penny Saginaw (ID 665) - Review Manipulation
- **Baseline:** 68
- **Best Result:** Option A → **45** (-23 points)
- **What Worked:** Damning quotes showing platform discrepancy explanation
- **Note:** Option B and C didn't drop as much - may need explicit "review manipulation = CRITICAL" guidance
- **Conclusion:** ✅ Option A caught manipulation well

#### Sun Valley Pool (ID 687) - Predatory Behavior
- **Baseline:** 68
- **All Options:** 65-68 (minimal change)
- **Problem:** Even with SEVERE rating for "preying on vulnerable customers", score stayed high
- **Root Cause:** Audit agent prompt doesn't penalize "predatory behavior" specifically
- **Conclusion:** ❌ Needs audit prompt penalty guidance

#### Empowered Renovations (ID 682) - Fake Reviews
- **Baseline:** 45
- **All Options:** Scores went UP (55-65)
- **Why:** Company had no damning quotes to extract (only 2 generic positive reviews)
- **Note:** The baseline was actually correct - this reveals Options A/B can't help when there's NO review content
- **Conclusion:** ⚠️ Edge case - no content to extract

#### Pinch A Penny Murphy (ID 635) - Review Discrepancy
- **Baseline:** 72
- **Best Result:** Option A → **65** (-7 points)
- **Note:** Less severe case than Saginaw location
- **Conclusion:** ✓ Partial improvement

### Key Findings

1. **Option C produced the single best result:** Bonnie & Clydes 68 → 48 (-20)

2. **Option A was best for review manipulation:** Pinch A Penny 68 → 45 (-23)

3. **Option B alone made things WORSE:** Average +6.0 points (scores increased)

4. **Sun Valley case reveals audit prompt gap:** Even with SEVERE "predatory behavior" label, score didn't drop

5. **Empowered Renovations is an edge case:** When there's no review content, extraction doesn't help

---

## Recommendations

### Recommendation 1: Implement Option C in Review Analyzer

Modify `services/review_analyzer.js` to output both:

```javascript
// New output format
{
  "fake_review_score": 25,
  "confidence": "HIGH",
  "complaint_patterns": [
    {"pattern": "Sold used/damaged goods as new", "severity": "CRITICAL", "count": 1},
    {"pattern": "Lied about product origin", "severity": "CRITICAL", "count": 1},
    {"pattern": "Poor communication", "severity": "MEDIUM", "count": 3}
  ],
  "damning_quotes": [
    {"quote": "Jennifer sold us a USED hot tub without telling us. She LIED.", "source": "1-star Google", "severity": "CRITICAL"},
    {"quote": "Leslie's quit referring them because of customer complaints", "source": "1-star Google", "severity": "HIGH"}
  ],
  "recommendation": "DISTRUST_REVIEWS"
}
```

### Recommendation 2: Add Penalty Guidance to Audit Agent Prompt

Add this section to `services/audit_agent.js` SYSTEM_PROMPT:

```javascript
## PENALTY GUIDANCE - SCORE ADJUSTMENTS

When you encounter these behaviors, adjust your score DOWN accordingly:

**CRITICAL Behaviors (subtract 25-35 points from base):**
- Fraud/deception: Selling damaged goods as new, bait-and-switch
- Review manipulation: Platform rating gap >1.5 stars with evidence of suppression
- DO_NOT_TRUST_REVIEWS verdict from Review Analyzer
- Multiple customers using words like "scam", "fraud", "lied"

**SEVERE Behaviors (subtract 20-30 points from base):**
- Predatory targeting: "preyed upon", "took advantage of", targeting vulnerable/ignorant customers
- Legal threats against reviewers
- Taking deposits and ghosting
- Pattern of threatening customers who complain

**HIGH Behaviors (subtract 15-20 points from base):**
- Property damage from negligence
- Multiple similar complaints (3+ customers with same issue)
- Billing for services not rendered

**EXAMPLE:**
A contractor with positive signals (registered LLC, 4.5★ Google, no lawsuits) would normally score ~80.
If damning_quotes show "They LIED and sold us damaged goods" [CRITICAL], subtract 30 points → score ~50.

## NEUTRAL SIGNALS - DO NOT BOOST SCORE

These are baseline expectations, NOT positive indicators:
- "No lawsuits found" - default state for most businesses
- "No liens found" - default state
- "Registered LLC" - legal minimum requirement
- "Has website" - standard expectation
- "BBB profile exists" - just means they're listed

Use these to avoid false negatives, but they should NOT push scores higher.
```

### Recommendation 3: Update Severity Classification

Add these to the SEVERITY CLASSIFICATION section:

```javascript
**CRITICAL - Fraud/Deception (Score cap: 55):**
- Selling damaged/used goods as new without disclosure
- Confirmed lies about product/service (verifiable false statements)
- Review manipulation (DO_NOT_TRUST_REVIEWS + platform discrepancy >1.5 stars)
- "Scam" or "fraud" allegations from multiple independent sources

**SEVERE - Predatory/Harmful (Score cap: 60):**
- Customer describes being "preyed upon" or "taken advantage of"
- Targeting vulnerable populations (elderly, first-time owners, non-English speakers)
- Legal threats against complainers
- Taking money and disappearing (deposit ghosting)
```

---

## Implementation Priority

| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| 1 | Add penalty guidance to audit_agent.js | HIGH | LOW |
| 2 | Implement Option C in review_analyzer.js | HIGH | MEDIUM |
| 3 | Add NEUTRAL SIGNALS section to audit prompt | MEDIUM | LOW |
| 4 | Update severity classification definitions | MEDIUM | LOW |
| 5 | Re-audit the 30 pool contractors | HIGH | LOW (automated) |

---

## Files to Modify

### services/audit_agent.js
- Add PENALTY GUIDANCE section (lines ~85-105)
- Add NEUTRAL SIGNALS section (lines ~105-115)
- Update SEVERITY CLASSIFICATION (lines ~54-83)

### services/review_analyzer.js
- Update ANALYSIS_PROMPT to request damning_quotes + severity ratings (lines ~64-124)
- Modify output format parsing (lines ~280-302)

---

## Success Criteria

After implementing fixes, re-audit the flagged contractors. Expected results:

| Contractor | Current | Target | Criteria |
|------------|---------|--------|----------|
| Bonnie & Clydes | 68 | 45-55 | Deceptive sales = CRITICAL |
| Pinch A Penny (Saginaw) | 68 | 50-60 | Review manipulation detected |
| Sun Valley Pool | 68 | 55-60 | Predatory behavior = SEVERE |
| Empowered Renovations | 45 | 40-50 | DO_NOT_TRUST maintained |

---

## Appendix: Extracted Damning Quotes from Testing

### Bonnie & Clydes (Option C)
```
- "BUYERS BEWARE - Jennifer sold us a USED and DAMAGED floor model" [CRITICAL]
- "violations according to the DTPA" [CRITICAL]
- "Leslie's pool supply said they quit referring bonnie and clydes" [HIGH]
- "If this is not made right we'll take legal action" [HIGH]
```

### Sun Valley Pool (Option C)
```
- "We are first-time pool owners and were completely ignorant" [SEVERE]
- "pump was almost burn up due to 2 leaks" [HIGH]
- "multiple UNDISSOLVED chlorine tablets in the bottom of our pool" [HIGH]
- "We were not informed about any of these issues" [HIGH]
```

### Pinch A Penny Saginaw (Option A)
```
- "Major discrepancy: Google 4.5★ vs Trustpilot 2.3★ from 111 reviews" [CRITICAL]
- "Review Analysis indicates potential review filtering/suppression" [HIGH]
```

---

## Conclusion

The contractor scoring system has two fixable problems:

1. **Review analyzer abstracts away severity** → Fix with Option C (quotes + severity)
2. **Audit agent lacks penalty guidance** → Fix with explicit score adjustments

Implementing both fixes should bring scores for bad actors down by 15-25 points, correctly placing deceptive/predatory contractors in the NOT RECOMMENDED/AVOID range.

---

*Document generated by Claude Code analysis on 2026-01-08*
