# Dual-Tag System Proposal (Historical Record)

Updated: 2026-02-18
Status: superseded by locked policy [DECIDED]

## Lock-Aligned Outcome [DECIDED]

- This workspace uses a dual-tag model: claim-status tags plus taxonomy tags.
- Claim-status set is frozen and unchanged:
  `[VERIFIED]`, `[UNVERIFIED]`, `[DECIDED]`, `[OBSERVED]`, `[PROPOSED]`, `[INTERPRETIVE]`.
- Canonical token is `[PREMISE-6]`; `[PREMISE6]` is non-canonical.
- Claim-status tags never go in file names.
- Taxonomy tags in file names use this exact slot order:
  `YYYY-MM-DD__[ARTIFACT]__[DOMAIN]__[ENTITY-OR-NO-SOURCE]__[WORKFLOW]__short-title.md`.

## Taxonomy Format [DECIDED]

- Taxonomy tokens are bracketed and normalized to uppercase letters, numbers, and hyphens only.
- Examples: `[POOL]`, `[ROOF-A]`, `[GOOGLE-MAPS]`, `[SOURCING]`, `[NO-SOURCE]`.

## In-Body Combination Pattern [DECIDED]

`Claim text [CLAIM-STATUS] [DOMAIN] [ARTIFACT] [ENTITY-OR-NO-SOURCE] [WORKFLOW]`

Examples:
1. `Roofing cohort roof_A is blocked on DeepSeek 402 insufficient balance [OBSERVED] [ROOFING] [ROOF-A] [NO-SOURCE] [SWISS]`
2. `Re-run sourcing for contractors with zero review text before the next scoring pass [PROPOSED] [POOL] [SOURCE-QUALITY-REMEDIATION] [NO-SOURCE] [SOURCING]`
3. `A subset of "success" rows contains zero review text despite non-zero review counts [VERIFIED] [ROOFING] [SOURCE-QUALITY-REMEDIATION] [GOOGLE-MAPS] [SOURCING]`

## Archived Proposal Scoring [OBSERVED]

- `Lean`: `76/100`
- `Balanced`: `93/100`
- `Strict`: `86/100`

## Canonical Source [DECIDED]

- Effective requirements are in `docs/tag-system-requirements.md`.
- Policy lock is in `/home/astre/command-center/TAG_TAXONOMY_POLICY_LOCKED.md`.
