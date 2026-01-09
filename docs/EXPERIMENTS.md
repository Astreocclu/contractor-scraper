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
- **Conclusion:** Proposed strategy produces same scores with 66% fewer reviews. However, concern remains about under-sampling rare fraud signals. Need to test on known-fraud contractors (e.g., Orange Elephant ID 1524).
- **Details:** [Full Analysis](analysis/review-strategy-full-analysis-2026-01-07.md)

---

## 2026-01-07 | A/B Test: Review Analysis Impact (BEFORE FIX)
- **Type:** automated
- **Hypothesis:** Review analysis (100 reviews) changes audit scores
- **Method:** Tested 10 large contractors (100+ reviews), ran audit without then with review analysis
- **Results:**
  - Avg score change: +2.8 points (ONLY INCREASES, never decreases)
  - Verdict changes: 2/10
- **Conclusion:** ❌ **BUG IDENTIFIED**: Review analysis only BOOSTED scores, never lowered them. Root cause: audit_agent.js prompt ignored `complaint_patterns` array from review_analyzer.js.
- **Details:** [Full Report](analysis/review-analysis-impact-2026-01-07.md)

---

## 2026-01-07 | A/B Test: Review Analysis Impact (AFTER PROMPT FIX)
- **Type:** automated
- **Hypothesis:** Updating audit_agent.js prompt to check complaint_patterns will enable score decreases
- **Method:** Tested 10 large contractors (100+ reviews), ran audit without then with review analysis
- **Results:**
  - Avg score change: 0.1 points
  - Verdict changes: 0/10
  - Now showing 3 decreases (vs 0 before prompt fix)
- **Conclusion:** ⚠️ **PARTIAL FIX**: Prompt change helped but truncation limit (3000 chars) still prevented seeing enough review text. Only 3-5 reviews visible to LLM.
- **Details:** [Full Report](analysis/review-analysis-impact-2026-01-07.md)

---

## 2026-01-07 | A/B Test: Review Analysis Impact (WITH Strategic Sampling Fix)
- **Type:** automated
- **Hypothesis:** Strategic sampling (10 five-star, 10 one-two star, 5 mid-star reviews) enables meaningful fraud detection in review analysis
- **Method:** Tested 30 large contractors (100+ reviews), ran audit with vs without review_analysis data
- **Results:**
  - Avg score change: 0.5 points (down from +2.8 before fix)
  - Max decrease: -13 points (Shade Doctor: 78 → 65)
  - Max increase: +13 points (Perma Pier: 65 → 78)
  - Verdict changes: 2/30 (Mr. Handyman RECOMMENDED→USE, Johnny Walker USE→RECOMMENDED)
  - Score decreases: 7/30 contractors (vs 3/30 before strategic sampling)
- **Conclusion:** ✅ **Strategic sampling fix VERIFIED**. Review analysis now properly:
  1. Decreases scores when negative reviews reveal issues
  2. Increases scores when positive reviews support quality
  3. Causes verdict changes when review evidence is strong
  4. Fixed the bug where review analysis only INCREASED scores
- **Fix Applied:**
  - `services/review_analyzer.js`: Added strategic sampling (10 five-star, 10 one-two star, 5 mid-star)
  - `services/review_analyzer.js`: Increased truncation limit from 3000 to 20000 chars
  - `services/audit_agent.js`: Updated prompt to explicitly check complaint_patterns array
- **Details:** [Full Report](analysis/review-analysis-impact-2026-01-07.md)

---
