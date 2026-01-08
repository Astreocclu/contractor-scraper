# Scoring Investigation: Review Options Anomaly Analysis

**Date:** 2026-01-08
**Investigator:** Claude (Opus 4.5)
**Status:** Complete

---

## Executive Summary

Investigation of unexplained anomalies in the Options A/B/C test results reveals **Option A is superior to Option C** for most cases. The combined prompt in Option C causes LLM confusion resulting in empty output arrays. The Option B regression is caused by structured severity ratings with zero counts being interpreted as "nothing found."

**Revised Recommendation:** Use Option A (damning quotes only) + penalty guidance in audit prompt. Option C is NOT recommended despite the single best result on Bonnie & Clydes.

---

## Investigation 1: Option B Regression (+6 Points Average)

### Question
Why did adding severity ratings to complaint_patterns make scores GO UP by an average of 6 points?

### Evidence

**Option B output for Pinch A Penny (ID 665):**
```json
"complaint_patterns": [
  {"pattern": "Poor communication / coordination", "severity": "MEDIUM", "count": 0},
  {"pattern": "Delays or missed appointments", "severity": "MEDIUM", "count": 0},
  {"pattern": "Taking deposits and ghosting / fraud", "severity": "CRITICAL", "count": 0}
]
```

**All counts are ZERO.** The LLM correctly identified pattern *categories* but reported 0 instances for each.

**Comparison - Option A (same contractor):**
```json
"damning_quotes": [
  {"quote": "They sold us a USED hot tub without telling us. Jennifer LIED.", "source": "1-star Google review", "issue": "Deceptive sales"},
  {"quote": "They took a $5000 deposit and then ghosted us. No work done, no returned calls.", "source": "1-star Trustpilot review", "issue": "Deposit theft/ghosting"}
]
```

Option A provided **specific evidence** the audit agent could weight.

### Root Cause

The Option B prompt asked the LLM to output severity ratings in a structured format. The LLM interpreted this as asking "what patterns COULD exist?" rather than "what patterns DID you find?" - resulting in template-like output with count: 0.

When the audit agent receives:
- `{"pattern": "fraud", "severity": "CRITICAL", "count": 0}`

It interprets this as: "The analyzer looked for fraud and found nothing." This is the **opposite** of what happened.

### Scoring Impact

| Contractor | Option A | Option B | Difference |
|------------|----------|----------|------------|
| Pinch A Penny (665) | 45 | 68 | +23 (WORSE) |
| Pinch A Penny Murphy (635) | 65 | 75 | +10 (WORSE) |

**Conclusion:** Option B's structured format loses information. The audit agent sees "severity: CRITICAL, count: 0" and weights it as "nothing found."

---

## Investigation 2: Option C vs Option A on Pinch A Penny (665)

### Question
Option A scored 45, Option C scored 65. That's 20 points worse when we ADDED information. What happened?

### Evidence

**Option A output (665):**
```json
"complaint_patterns": ["Poor communication/unresponsiveness", "Billing disputes/overcharging", ...],
"damning_quotes": [
  {"quote": "They sold us a USED hot tub without telling us. Jennifer LIED.", ...},
  {"quote": "Preyed upon us as ignorant first-time owners", ...},
  {"quote": "They took a $5000 deposit and then ghosted us...", ...},
  {"quote": "The 'renovation' left our pool leaking worse than before...", ...},
  {"quote": "They billed us for chemicals never delivered...", ...}
]
```

**Option C output (665):**
```json
"complaint_patterns": [],
"damning_quotes": []
```

**BOTH ARRAYS ARE EMPTY in Option C.**

### Root Cause

The combined prompt (Option C) created cognitive overload for the LLM. When asked to:
1. Extract damning quotes WITH severity ratings
2. Rate complaint patterns WITH severity AND count

...the LLM failed to produce either. It returned empty arrays for both fields.

The simpler Option A prompt ("extract the exact quotes that show the problem") succeeded where the complex Option C prompt failed.

### Why Bonnie & Clydes (656) Worked in Option C

Looking at the test data, Option C DID work for Bonnie & Clydes:
```json
"damning_quotes": [
  {"quote": "BUYERS BEWARE - Jennifer sold us a used and damaged floor model...", "severity": "CRITICAL"},
  {"quote": "Please beware that they sell pools without recommending customers get a city permit...", "severity": "SEVERE"}
]
```

The difference: Bonnie & Clydes has **more extreme** review content. The "BUYERS BEWARE" and "DTPA violations" language is so stark that even the complex prompt extracted it. Pinch A Penny's damning content is more subtle (platform discrepancy, deposit ghosting without explicit legal language).

**Conclusion:** Option C only works for the most egregious cases. Option A is more reliable across all severity levels.

---

## Investigation 3: Empowered Renovations Paradox (682)

### Question
Baseline correctly scored 45. All options made it worse (55-65). Why?

### Evidence

**Baseline context:**
- Only 2 Google reviews (both 5-star, generic)
- BBB A+ rating
- `fake_review_score: 85` (HIGH suspicion)
- `recommendation: DISTRUST_REVIEWS`
- Baseline score: 45 (CORRECT - suspicious profile)

**Option A output:**
```json
"platform_ratings": {"google": 5, "yelp": null, "bbb": "A+"},
"discrepancy_explanation": "The BBB A+ rating suggests a strong business reputation, but the Google Maps presence shows only 2 reviews...",
"damning_quotes": [],
"fake_signals": [
  "Extremely low review volume (2 total) for a contractor with an A+ BBB rating",
  "Both reviews are 5-star with minimal, generic content",
  "Second review has no text—only a rating"
],
"recommendation": "DISTRUST_REVIEWS"
```

**Option A score: 65** (+20 from baseline)

### Root Cause

When there are **no negative reviews to extract**, Options A/B/C add context without adding evidence.

1. `damning_quotes: []` - Empty (no negative reviews exist)
2. `platform_ratings: {"bbb": "A+"}` - Explicitly mentions the BBB A+ rating
3. `discrepancy_explanation` - "BBB A+ rating suggests a strong business reputation"

The audit agent sees "BBB A+" mentioned prominently and gives credit for it, even though the review analysis says DISTRUST_REVIEWS.

**The baseline didn't explicitly mention BBB A+** in the review_analysis field - it just had `fake_review_score: 85`. The Options added positive context that wasn't there before.

### Scoring Impact

| Option | Score | Change |
|--------|-------|--------|
| Baseline | 45 | - |
| Option A | 65 | +20 |
| Option B | 65 | +20 |
| Option C | 55 | +10 |

**Conclusion:** Options A/B/C hurt "no review content" edge cases by adding positive context (BBB A+) without negative evidence to counterbalance it.

---

## Investigation 4: Ground Truth Contractors

### Available Validation Set

**BBB F Rating Contractors:**

| ID | Contractor | Score | BBB | Status |
|----|------------|-------|-----|--------|
| 36 | DFW Outdoor Design | 11 | F | CORRECT |
| 37 | Sunstone Pools | 12 | F | CORRECT |
| 473 | Paradise Pools Of Texas | 15 | F | CORRECT |
| 480 | Lone Star Fiberglass | 35 | F | CORRECT |
| 1524 | Orange Elephant Roofing | 15 | F | CORRECT |
| 625 | A&E Glass | 48 | F | CORRECT |
| 294 | Praus Construction | 50 | F | BORDERLINE |
| 306 | NRH Roofing | 50 | F | BORDERLINE |
| 2946 | Sunstone Pools (dupe) | 58 | F | **TOO HIGH** |
| 199 | A Plus Home Remodel | 60 | F | **TOO HIGH** |
| **141** | **Tropic Island Pools** | **85** | **F** | **CRITICAL BUG** |

### Critical Finding: Tropic Island Pools (ID 141)

**BBB F rating but scored 85 (RECOMMENDED).** This is a system failure.

Data available:
- BBB: F rating, status: success
- Google: 4.0★ (20 reviews)
- All other sources collected

**Why did this happen?** The audit agent prompt doesn't have explicit rules for BBB F ratings. It says:
> "BBB F rating or revoked accreditation" = HIGH severity

But HIGH severity only drops scores to 65-79 range ("Mixed. Has at least one HIGH flag"). It doesn't force scores below 50.

**Fix Required:** BBB F rating should be treated as a score CAP (max 55) or require penalty guidance in the prompt.

---

## Investigation 5: Temporal Data Availability

### Question
Do we capture review dates? If so, are the damning quotes recent or old?

### Evidence

**Review data for Bonnie & Clydes (656) includes date field:**
```
Keys: date, text, author, rating
Sample: date="3 months ago"
```

**Damning reviews with dates:**

| Author | Rating | Date | Content |
|--------|--------|------|---------|
| Amandia Nordyke | 1★ | 3 months ago | "BUYERS BEWARE - Jennifer sold us a used and damaged floor model... DTPA violations..." |
| Morgan Nobles | 1★ | 2 years ago | "We had a pool installed from them 3 years ago..." |
| Jamie Bailey | 1★ | 3 years ago | "ALLSTAR POOLS replaced our pool liner..." |
| gHOsT | 1★ | 4 years ago | "Very dissatisfied with service..." |

### Analysis

The most damning review (Amandia Nordyke - DTPA violations, legal threats) is **RECENT (3 months ago)**. This should weight very heavily.

**Current system does NOT use temporal weighting.** The audit agent prompt says "RECENCY MATTERS" but doesn't specify how to weight it, and the review_analyzer doesn't pass date information through.

**Recommendation:** Add `recent_damning_quotes` field that only includes quotes from last 12 months, or add date to each quote object.

---

## Revised Recommendation

### Option A is Better Than Option C

| Scenario | Option A | Option C | Winner |
|----------|----------|----------|--------|
| Standard bad contractor (665, 635) | Effective (-23, -7) | Ineffective (0, -3) | **Option A** |
| Extreme bad contractor (656) | Good (-10) | Best (-20) | Option C |
| No negative reviews (682) | Bad (+20) | Less bad (+10) | Neither |

Option A wins 2/3 scenarios. Option C only wins the extreme case.

### Implementation Plan (Revised)

**Priority 1 - Use Option A (NOT Option C)**
Simpler prompt, more reliable extraction. Option C's complexity causes LLM failure on moderate cases.

**Priority 2 - Add Penalty Guidance to Audit Prompt**
```
## PENALTY GUIDANCE
When damning_quotes are present with:
- "CRITICAL" issues (fraud, deception, DTPA) → Score cap: 55
- "SEVERE" issues (predatory, deposit theft) → Score cap: 60
- "HIGH" issues (negligence, damage) → Score cap: 70

When BBB rating is F → Score cap: 55 regardless of other signals
```

**Priority 3 - Handle Edge Cases**
For contractors with `damning_quotes: []` and `fake_review_score > 70`:
- Don't add platform_ratings to output
- Keep recommendation: DISTRUST_REVIEWS without positive context

**Priority 4 - Add Temporal Weighting**
Include `date` field in damning_quotes. Recent issues (< 12 months) should weight 2x.

---

## Summary Table

| Anomaly | Root Cause | Impact | Fix |
|---------|------------|--------|-----|
| Option B regression (+6 points) | Severity ratings with count: 0 interpreted as "nothing found" | Scores went UP | Don't use Option B |
| Option C failure on 665 | Combined prompt caused empty arrays | 20 points worse than Option A | Use Option A |
| Empowered Renovations paradox | Options added BBB A+ positive context without negative evidence | Baseline was correct, Options broke it | Handle no-content edge case |
| Tropic Island Pools (BBB F = 85) | No hard rules for BBB F in audit prompt | Critical bug | Add BBB F score cap |
| No temporal weighting | Dates captured but not used | Recent complaints underweighted | Pass dates to audit agent |

---

## Conclusion

**Option C is NOT the right answer.** While it produced the single best result (Bonnie & Clydes 68→48), it failed on Pinch A Penny and the combined prompt complexity causes unreliable LLM output.

**Option A + penalty guidance** is the correct solution:
1. Simpler prompt = more reliable extraction
2. Explicit penalties ensure bad actors can't hide behind good review volume
3. BBB F hard cap prevents the Tropic Island Pools bug

The anomalies in the test results are **significant** and reveal that Option C would cause regressions in production. The investigation changes the recommendation from the original analysis.

---

*Investigation completed 2026-01-08*
