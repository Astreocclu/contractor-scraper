# Leaderboard System

Confidence-weighted Elo ranking system for contractors within a single vertical.

## Current Direction (2026-02-10)

Primary objective is now **full-run expansion with calibration**, not just one-off batch completion.

We are running two parallel 100-contractor cohorts to answer:
1. What is the ideal number of pairings per contractor?
2. Which model lane should be the default for pairwise comparisons?

Batch C and Batch D are complete. New work starts from this point.

## Two-Lane Calibration Plan

### Lane 1: DeepSeek Cohort (E)
- 100 new full contractor runs
- 30 comparisons per contractor target
- Automated pairwise decisions using DeepSeek
- Full per-comparison logging and run summaries

### Lane 2: Manual Prompt-Parity Cohort (F)
- 100 new full contractor runs
- 30 comparisons per contractor target
- Manual/agent-executed comparisons using the **same prompt format** as DeepSeek lane
- Full per-comparison logging and run summaries

### Why this design
- Isolates model-lane differences while holding prompt structure constant
- Produces enough data to evaluate ranking stability vs comparison count
- Lets us choose default lane on quality/time/cost evidence

## Budget + Model Policy

- **Claude Max:** $200/month subscription (flat usage model).
- **Codex Pro:** $200/month subscription (flat usage model).
- **DeepSeek:** pay-as-you-go credits available for high-volume automated comparisons.
- Subscription lanes should be used for manual parity runs; DeepSeek credits cover automated bulk runs.
- Do not add direct Anthropic API scripts for this workflow.

## Decisions (Locked)

| Decision | Status | Date | Notes |
|----------|--------|------|-------|
| Holistic seeding | **LOCKED** | 2026-02-08 | Swiss always seeds from first-pass holistic scores. No `--no-seed`. |
| Pool-only vertical | **LOCKED** | 2026-02-06 | Elo comparisons only within same vertical. |
| No reruns without explicit user command | **LOCKED** | 2026-02-10 | Never rerun jobs unless user asks for that exact rerun. |
| Calibration target = 30 comparisons/contractor | **LOCKED** | 2026-02-10 | Applies to both DeepSeek and manual cohorts. |
| Prompt parity across lanes | **LOCKED** | 2026-02-10 | Manual lane mirrors DeepSeek comparison prompt structure. |
| Source-first invariant | **LOCKED** | 2026-02-10 | Always source unsourced contractors before snapshot/first-pass/Swiss. |

## Source-First Gate (Required)

Before any cohort run:
1. Check manifest for contractors missing raw data.
2. Run collection on missing IDs.
3. Only then run snapshot, first pass, and Swiss.

Canonical command:
```bash
source venv/bin/activate && set -a && . ./.env && set +a
node bin/source_missing_from_manifest.js --config experiments/hybrid_100_E/config/sample_100_group_E.json
```

## Progress Snapshot

| Cohort | Contractors | Status | Notes |
|--------|-------------|--------|-------|
| A (`hybrid_100`) | 100 | Complete | Historical baseline |
| B (`hybrid_100_B`) | 100 | Complete | Historical baseline |
| C (`hybrid_100_C`) | 100 | Complete | Completed |
| D (`hybrid_100_D`) | 100 | Complete | Completed |
| E (`hybrid_100_E`) | 100 | Planned | New DeepSeek calibration run |
| F (`hybrid_100_F`) | 100 target | Planned | 69 raw-ready + 31 needing collection top-up |

## Data Requirements

Every run in both lanes must capture:
- comparison-level records (contractor A/B IDs, winner, confidence, round, timestamp)
- lane label (`deepseek` or `manual_parity`)
- prompt version/hash
- run-level summary (coverage, total comparisons, retries/failures, elapsed time, cost estimate)

## Comparison Math (for planning)

At 30 comparisons per contractor:
- 100 contractors require roughly **1,500 pairwise decisions** in that cohort.
- Two cohorts (E + F) require roughly **3,000 total pairwise decisions**.

## Existing Data Locations

```txt
experiments/
+-- hybrid_100/            # Cohort A
+-- hybrid_100_B/          # Cohort B
+-- hybrid_100_C/          # Cohort C (complete)
+-- hybrid_100_D/          # Cohort D (complete)
+-- hybrid_100_E/          # Cohort E (planned)
+-- hybrid_100_F/          # Cohort F (planned)
```

## Commands (Existing Baseline)

### 1. Sample a New Batch
```bash
source venv/bin/activate && set -a && . ./.env && set +a
node bin/hybrid_100_sample.js --group=E --vertical=pool
```

### 2. Run Holistic First Pass
```bash
node bin/hybrid_100_first_pass.js --group=E
```

### 3. Run Swiss Comparisons
```bash
node bin/hybrid_100_swiss_pass.js --group=E --rounds 30
```

> Note: lane-specific execution commands and logging wrappers should enforce the data requirements above before running large cohorts.
