# Definitive Scaling Plan (DeepSeek-First)

Date: 2026-02-12
Owner: Auditor
Status: Active default plan

## 1) Locked Architecture

- Primary lane: DeepSeek for bulk pairwise comparisons.
- Secondary lane: Codex only for selective adjudication (not bulk).
- Model purity rule: Codex sessions run Codex tools only; Claude sessions run Claude tools only.
- Source gate: run manifest starts with strict source verification and fails fast on missing critical sources.

## 2) Group/Tier Structure

- Vertical-first segmentation: never mix unrelated trades in Swiss pairings.
- Global tiers: 6 tiers (`T1`..`T6`) for operational routing.
- Cell size inside each tier: target 100 contractors (allow 80-120).
- Scaling rule: add more 100-contractor cells, do not inflate cell size.

Why 100-cell size:
- At 30 comparisons/contractor, 100-cell gives ~30% opponent coverage.
- At 200-cell, the same 30 comparisons gives ~15% coverage.
- At 500-cell, only ~6% coverage.

## 3) Movement Policy

- Re-tier cadence: every 5 rounds.
- Promotion/demotion per cycle: top 15% up, bottom 15% down.
- Boundary buffer: include +-5 rank band around movement cut lines for extra scrutiny.

## 4) Comparison Budget Policy

Default progressive schedule per cell:

1. Phase A: everyone to 10 comparisons.
2. Phase B: top 60% + boundary buffer to 20.
3. Phase C: top 20% + boundary buffer to 30.

Expected average comparisons per contractor: ~18.

## 5) Model Escalation Policy

DeepSeek only:
- All bulk pairings in all phases.

Codex escalation queue only:
- DeepSeek confidence <= 70
- Any tie
- Any candidate in boundary buffer
- Any large disagreement cluster across repeats

Codex adjudication rule:
- Run swapped-order double-check.
- Only hard-override when both Codex passes agree after order normalization.
- If Codex pass 1 and pass 2 disagree, keep unresolved flag for manual arbitration.

## 6) Empirical Inputs Used

From existing artifacts:

- DeepSeek Swiss cost (group E):
  - 1754 comparisons cost $7.2539
  - cost per comparison ~= $0.004136
  - source: `experiments/hybrid_100_E/results/swiss/analysis/cost.json`

- Codex disagreement stability (AB compact run):
  - Disagreements audited: 86
  - Codex pass-2 confirmed pass-1: 76 (88.37%)
  - Codex pass-2 flipped pass-1: 10 (11.63%)
  - source: `experiments/pairwise_ab_100x5_codex_doublecheck_v1.summary.json`

## 7) Funding Model (DeepSeek)

Formula:
- `comparisons = contractors * avg_comparisons_per_contractor / 2`
- `cost ~= comparisons * 0.004136`

DeepSeek-only projections:

- 100 contractors:
  - progressive (~18 avg): ~$3.72
  - flat 30: ~$6.20

- 1,000 contractors:
  - progressive (~18 avg): ~$37.22
  - flat 30: ~$62.04

- 5,000 contractors:
  - progressive (~18 avg): ~$186.12
  - flat 30: ~$310.20

Recommended funded balance (includes reruns/retries/overhead):

- Pilot (100 contractors): keep >= $15
- First scale pass (1,000 contractors): keep >= $120 (minimum $75)
- Mid scale (5,000 contractors): keep >= $400 (minimum $250)

## 8) Source Gate Requirements (Hard Stop)

Each manifest contractor must have critical source coverage before snapshot/scoring.
Accepted statuses for coverage: `success`, `not_found`.

Required critical rules:
- `google_presence` (any of: `google_maps_local`, `google_maps_hq`, `google_maps_listed`, `google_maps`)
- `bbb`
- `court_records`
- `county_liens`
- `tx_franchise`

Gate command:

```bash
node bin/source_missing_from_manifest.js \
  --config=<manifest.json> \
  --required=google_presence,bbb,court_records,county_liens,tx_franchise
```

If missing critical sources remain, process exits non-zero and logs a flagged report.

## 9) Learning Loop Per Run

Every run must emit:

- source gate failure counts by rule
- comparisons completed and failed
- cost per comparison
- disagreement rate vs adjudication queue
- codex pass-2 confirmation rate
- rank drift at boundaries after movement cycle

Adjustment rules:

- If source gate failures > 10% in a cell: rerun sourcing only; no snapshot/first-pass.
- If codex flip rate > 15% in escalation queue: widen manual arbitration band.
- If boundary drift stays high after phase C: increase boundary buffer width before adding more comparisons globally.
