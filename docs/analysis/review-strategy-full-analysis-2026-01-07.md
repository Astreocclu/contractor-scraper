# A/B Test Full Analysis: Review Collection Strategy
**Date:** 2026-01-07
**Test Date:** 2026-01-06
**Contractors Tested:** 30

---

## Executive Summary

| Metric | Current Strategy | Proposed Strategy | Difference |
|--------|------------------|-------------------|------------|
| Total Reviews Available | 3,212 | 3,212 | - |
| Reviews Collected | 1,319 | 450 | -66% |
| Coverage Rate | 41% | 14% | -27 points |
| Total Collection Cost | $3.03 | $1.71 | -43.6% |
| Score Differences | - | - | 2 contractors |
| Avg Score Variance | - | - | 0.2 points |
| Max Score Variance | - | - | 3 points |

---

## Concern: Are We Missing Red Flags?

With 14% coverage vs 41%, we're analyzing significantly less data. The question is whether fraud signals get lost.

### Contractors With Score Variance

| Contractor | Reviews | Current Got | Proposed Got | Current Score | Proposed Score | Variance |
|------------|---------|-------------|--------------|---------------|----------------|----------|
| NX Electric LLC | 10 | 8 | 10 | 75 | 72 | -3 |
| Best Buy Windows and Siding | 363 | 100 | 36 | 68 | 65 | -3 |

**NX Electric:** Proposed got MORE data (10 vs 8) and score went DOWN. The extra reviews revealed issues current missed. This supports proposed strategy.

**Best Buy Windows:** Proposed got LESS data (36 vs 100) and score went DOWN. This could mean:
- Negative signal more concentrated in smaller sample (random)
- OR we're missing context that would explain/mitigate the negatives

---

## Full Contractor Breakdown

### SMALL CONTRACTORS (0-20 reviews)

| ID | Contractor | Total Revs | Current Got | Proposed Got | Current Score | Proposed Score | Diff | Notes |
|----|------------|------------|-------------|--------------|---------------|----------------|------|-------|
| 3190 | Texan Outdoor Concepts | 1 | 1 | 1 | 65 | 65 | 0 | Only 1 review exists |
| 1460 | Hawkins Landscape & Lawn Maintenance | 20 | 8 | 10 | 85 | 85 | 0 | Proposed got 25% more |
| 11600 | Crimson Building Company, LLC | 17 | 8 | 10 | 68 | 68 | 0 | Proposed got 25% more |
| 9824 | Richmond & Associates Landscaping | 3 | 8 | 10 | 72 | 72 | 0 | API returned more than exists? |
| 1076 | Suburban Roofing, Inc. | 6 | 6 | 6 | 58 | 58 | 0 | RED FLAG DETECTED - fraud signals triggered escalation in current |
| 2030 | NX Electric LLC | 10 | 8 | 10 | 75 | 72 | **-3** | VARIANCE: Extra reviews lowered score |
| 5908 | Aire Serv of Grand Prairie | 8 | 8 | 8 | 78 | 78 | 0 | All reviews captured |
| 1449 | Blinds by Rebecca | 8 | 8 | 8 | 78 | 78 | 0 | All reviews captured |
| 410 | Sunrise Blinds of Texas Inc. | 4 | 4 | 4 | 65 | 65 | 0 | All reviews captured |
| 5862 | Polar Refrigeration Heating and Air LLC. | 2 | 2 | 2 | 75 | 75 | 0 | All reviews captured |

**Small Bucket Totals:**
- Reviews Available: 79
- Current Collected: 61 (77%)
- Proposed Collected: 69 (87%)
- Score Matches: 9/10 (90%)
- Proposed actually collects MORE for small contractors

### MEDIUM CONTRACTORS (21-100 reviews)

| ID | Contractor | Total Revs | Current Got | Proposed Got | Current Score | Proposed Score | Diff | Notes |
|----|------------|------------|-------------|--------------|---------------|----------------|------|-------|
| 6866 | Strength & Shield Roofing | 45 | 8 | 10 | 88 | 88 | 0 | Current didn't escalate (<50) |
| 52 | Cox Pool Company | 32 | 8 | 10 | 82 | 82 | 0 | Current didn't escalate (<50) |
| 1140 | Lancaster Roofing & Construction | 22 | 8 | 10 | 82 | 82 | 0 | Current didn't escalate (<50) |
| 6960 | M & D Roofing and Construction, LLC. | 70 | 70 | 10 | 85 | 85 | 0 | Current got ALL 70, proposed got 10 - SAME SCORE |
| 544 | Epic Pavers | 46 | 8 | 10 | 82 | 82 | 0 | Current didn't escalate (<50) |
| 2946 | Sunstone Pools & Outdoor Living | 86 | 85 | 10 | 58 | 58 | 0 | RED FLAG - Current got 85, proposed got 10 - SAME LOW SCORE |
| 10893 | FoGlass Window Replacement | 69 | 69 | 37 | 65 | 65 | 0 | Proposed got 53% (37/69) |
| 549 | Pool Logistics | 48 | 8 | 10 | 85 | 85 | 0 | Current didn't escalate (<50) |
| 809 | Community General Contractors | 26 | 26 | 10 | 48 | 48 | 0 | RED FLAG - Current got all 26, proposed got 10 - SAME LOW SCORE |
| 277 | Next Generation Roofing and Gutters L.L.C. | 55 | 55 | 10 | 78 | 78 | 0 | Current escalated (>50) |

**Medium Bucket Totals:**
- Reviews Available: 499
- Current Collected: 345 (69%)
- Proposed Collected: 127 (25%)
- Score Matches: 10/10 (100%)

**Critical Observation:**
- Sunstone Pools: 85 reviews vs 10 reviews = SAME score of 58
- Community General: 26 reviews vs 10 reviews = SAME score of 48
- Red flags detected equally regardless of sample size

### LARGE CONTRACTORS (100+ reviews)

| ID | Contractor | Total Revs | Current Got | Proposed Got | Current Score | Proposed Score | Diff | Notes |
|----|------------|------------|-------------|--------------|---------------|----------------|------|-------|
| 10816 | Best Buy Windows and Siding | 363 | 100 | 36 | 68 | 65 | **-3** | VARIANCE: Fewer reviews, lower score |
| 1874 | ElectricMan | 567 | 100 | 56 | 85 | 85 | 0 | Largest contractor, 10% sample matched |
| 2513 | Simplicity Roofing | 166 | 13 | 10 | 85 | 85 | 0 | Current only got 13 despite targeting 100 |
| 1033 | Capitol Roofing & Construction LLC | 109 | 100 | 10 | 85 | 85 | 0 | 100 vs 10 - same score |
| 1271 | Integrity Foundation Repair | 401 | 100 | 40 | 65 | 65 | 0 | RED FLAG detected equally |
| 2250 | Arlington AC & Heating | 137 | 100 | 13 | 85 | 85 | 0 | 100 vs 13 - same score |
| 4254 | HR Phoenix Electrical & Plumbing | 280 | 100 | 28 | 82 | 82 | 0 | 100 vs 28 - same score |
| 1007 | All Star Roofing Of Garland | 200 | 100 | 20 | 85 | 85 | 0 | 100 vs 20 - same score |
| 3663 | Bewley Plumbing, LLC | 249 | 100 | 25 | 85 | 85 | 0 | 100 vs 25 - same score |
| 450 | Pacific Pool Plastering | 162 | 100 | 16 | 78 | 78 | 0 | 100 vs 16 - same score |

**Large Bucket Totals:**
- Reviews Available: 2,634
- Current Collected: 913 (35%)
- Proposed Collected: 254 (10%)
- Score Matches: 9/10 (90%)

---

## Cost Breakdown

### Per-Contractor Costs

| Contractor | Total Revs | Current Cost | Proposed Cost | Savings |
|------------|------------|--------------|---------------|---------|
| Texan Outdoor Concepts | 1 | $0.005 | $0.050 | -$0.045 |
| Hawkins Landscape | 20 | $0.005 | $0.050 | -$0.045 |
| Crimson Building | 17 | $0.005 | $0.050 | -$0.045 |
| Richmond & Associates | 3 | $0.005 | $0.050 | -$0.045 |
| Suburban Roofing | 6 | $0.185 | $0.050 | $0.135 |
| NX Electric | 10 | $0.005 | $0.050 | -$0.045 |
| Aire Serv | 8 | $0.005 | $0.050 | -$0.045 |
| Blinds by Rebecca | 8 | $0.005 | $0.050 | -$0.045 |
| Sunrise Blinds | 4 | $0.005 | $0.050 | -$0.045 |
| Polar Refrigeration | 2 | $0.005 | $0.050 | -$0.045 |
| Strength & Shield | 45 | $0.005 | $0.050 | -$0.045 |
| Cox Pool | 32 | $0.005 | $0.050 | -$0.045 |
| Lancaster Roofing | 22 | $0.005 | $0.050 | -$0.045 |
| M & D Roofing | 70 | $0.185 | $0.050 | $0.135 |
| Epic Pavers | 46 | $0.005 | $0.050 | -$0.045 |
| Sunstone Pools | 86 | $0.185 | $0.050 | $0.135 |
| FoGlass Window | 69 | $0.185 | $0.080 | $0.105 |
| Pool Logistics | 48 | $0.005 | $0.050 | -$0.045 |
| Community General | 26 | $0.185 | $0.050 | $0.135 |
| Next Generation Roofing | 55 | $0.185 | $0.050 | $0.135 |
| Best Buy Windows | 363 | $0.185 | $0.080 | $0.105 |
| ElectricMan | 567 | $0.185 | $0.110 | $0.075 |
| Simplicity Roofing | 166 | $0.185 | $0.050 | $0.135 |
| Capitol Roofing | 109 | $0.185 | $0.050 | $0.135 |
| Integrity Foundation | 401 | $0.185 | $0.095 | $0.090 |
| Arlington AC & Heating | 137 | $0.185 | $0.050 | $0.135 |
| HR Phoenix | 280 | $0.185 | $0.065 | $0.120 |
| All Star Roofing | 200 | $0.185 | $0.065 | $0.120 |
| Bewley Plumbing | 249 | $0.185 | $0.065 | $0.120 |
| Pacific Pool | 162 | $0.185 | $0.050 | $0.135 |

**Note:** Proposed costs MORE for small contractors that don't trigger escalation under current strategy.

---

## Anomalies and Concerns

### 1. Richmond & Associates (ID 9824)
- Total reviews listed: 3
- Current collected: 8
- Proposed collected: 10
- **How did we get more reviews than exist?** Possible Serper caching or alternate data sources.

### 2. Simplicity Roofing (ID 2513)
- Total reviews: 166
- Current targeted: 100
- Current actually got: 13
- **Why only 13?** SerpAPI pagination issue or data availability problem.

### 3. Suburban Roofing (ID 1076)
- Total reviews: 6
- Current escalated to SerpAPI (cost $0.185) for only 6 reviews
- **Why?** Fraud check triggered escalation despite low review count.

### 4. FoGlass Window (ID 10893)
- Total reviews: 69
- Proposed got: 37 (53%)
- **Why 37 instead of 10?** 10% of 69 = 6.9, minimum is 10... but 37 suggests different calculation.

---

## Statistical Summary

### Score Distribution

| Score Range | Current Count | Proposed Count | Match? |
|-------------|---------------|----------------|--------|
| 85-88 | 14 | 14 | Yes |
| 78-82 | 7 | 7 | Yes |
| 72-75 | 4 | 4 | Yes |
| 65-68 | 4 | 5 | No (Best Buy: 68→65) |
| 48-58 | 3 | 3 | Yes |

### Escalation Behavior

**Current Strategy Escalations (>50 reviews OR fraud signals):**
- Suburban Roofing (6 reviews) - fraud signals
- M & D Roofing (70 reviews)
- Sunstone Pools (86 reviews)
- FoGlass Window (69 reviews)
- Community General (26 reviews) - fraud signals?
- Next Generation Roofing (55 reviews)
- All 10 large contractors

**Total current escalations:** 16/30 (53%)

**Proposed Strategy Escalations (when 10% > Serper's ~10):**
- Only for contractors where 10% of reviews > 10 (so >100 reviews)
- Total proposed escalations: ~10/30 (33%)

---

## The Core Question: Is 14% Coverage Enough?

### Evidence FOR (10% is sufficient):
1. 28/30 contractors had identical scores (93%)
2. All red-flag contractors (scores <70) were caught by both strategies
3. Sunstone Pools: 85 vs 10 reviews = same score of 58
4. Community General: 26 vs 10 reviews = same score of 48

### Evidence AGAINST (concerns):
1. Two contractors had 3-point variance
2. 14% coverage could miss rare fraud patterns
3. Best Buy Windows scored LOWER with fewer reviews - we don't know which is "correct"
4. Sample size (30) too small to catch rare false negatives

### Unknown:
1. What would happen with known fraud contractors (Orange Elephant)?
2. Are the sampled reviews representative or biased (recent vs old)?
3. Would variance increase with larger test sample?

---

## Raw Data

### Review Counts by Size

| Size Bucket | Contractors | Min Reviews | Max Reviews | Avg Reviews | Total Reviews |
|-------------|-------------|-------------|-------------|-------------|---------------|
| Small (0-20) | 10 | 1 | 20 | 7.9 | 79 |
| Medium (21-100) | 10 | 22 | 86 | 49.9 | 499 |
| Large (100+) | 10 | 109 | 567 | 263.4 | 2,634 |
| **ALL** | **30** | **1** | **567** | **107.1** | **3,212** |

### Collection Efficiency

| Bucket | Available | Current Got | Current % | Proposed Got | Proposed % |
|--------|-----------|-------------|-----------|--------------|------------|
| Small | 79 | 61 | 77% | 69 | 87% |
| Medium | 499 | 345 | 69% | 127 | 25% |
| Large | 2,634 | 913 | 35% | 254 | 10% |
| **TOTAL** | **3,212** | **1,319** | **41%** | **450** | **14%** |

---

## Appendix: Full JSON Data Reference

See: `docs/analysis/review-strategy-ab-test-2026-01-06.json`

---

*Generated: 2026-01-07*
*Test executed: 2026-01-06 (116.1 minutes runtime)*
