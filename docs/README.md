# Auditor Docs Map

Updated: 2026-02-18

## Canonical Read Order

1. `AGENTS.md` + `CLAUDE.md` (same file): runtime constraints, locks, execution boundaries, and process rules.
2. `docs/tag-system-requirements.md`: canonical tagging policy for claim-bearing docs/state/session updates.
3. `state/current.md`: live priorities, blockers, and active phase.
4. `/home/astre/command-center/LESSONS.md`: cookies + bad robots, shared memory.
5. `state/profile.md`: communication/process preferences.
6. `STATUS.md` / `TODO.md` / `ERRORS.md`: current operating state, prioritized actions, known issues.
7. `docs/QUICKREF.md`: operational command and checklist quick reference.

## Locked Tag Policy Snapshot [DECIDED]

- Claim-status set is frozen: `[VERIFIED]`, `[UNVERIFIED]`, `[DECIDED]`, `[OBSERVED]`, `[PROPOSED]`, `[INTERPRETIVE]`.
- Canonical token is `[PREMISE-6]`; `[PREMISE6]` is non-canonical.
- Claim-status tags never go in file names.
- Taxonomy tags in file names use this exact slot order:
  `YYYY-MM-DD__[ARTIFACT]__[DOMAIN]__[ENTITY-OR-NO-SOURCE]__[WORKFLOW]__short-title.md`.

## Documentation by Purpose

| Doc | Purpose | When to use |
|-----|---------|------------|
| `docs/QUICKREF.md` | Startup + commands | Daily work or runbook lookup |
| `docs/tag-system-requirements.md` | Mandatory tag rules for factual/decision/proposal claims | Any documentation/state/session update |
| `docs/ARCHITECTURE.md` | Pipeline architecture | Changing execution flow |
| `docs/SOURCES.md` | Source inventory, TTLs, and status | Debugging collection quality |
| `docs/DATABASE.md` | Schema and query map | DB work |
| `docs/plans/` | Past/active implementation plans | Recovering decisions or handoff context |
| `docs/analysis/` | Source ranking and failure analyses | Deep dives into quality trends |
| `experiments/` | Cohort runs and calibration artifacts | Batch pipeline tracking |
| `docs/new-verticals-research-handoff.md` | Expansion priorities from Researcher | Vertical onboarding planning |
| `SESSION-NOTES.md` | Historical session logbook | Forensics/context only |
| `state/lessons.md` | Deprecated pointer only | Do not write |

## What's Deprecated / Removed

- `docs/EXPERIMENTS.md` does not exist and is no longer used.
- `state/lessons.md` is a deprecated pointer to `/home/astre/command-center/LESSONS.md`; do not treat it as an active log.
