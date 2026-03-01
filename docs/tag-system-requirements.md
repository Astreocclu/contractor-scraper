# Auditor Tag System Requirements

Updated: 2026-02-18
Status: implemented from locked policy [DECIDED]
Agent classification: `hybrid`

## Policy Lock Reference [DECIDED]

- Lock ID: `TAG-TAXONOMY-V1-2026-02-18T02:00:04Z`
- Lock Timestamp (UTC): `2026-02-18T02:00:04Z`
- Locked Policy Path: `/home/astre/command-center/TAG_TAXONOMY_POLICY_LOCKED.md`

## Non-Negotiables [DECIDED]

- Every tag token is bracketed: `[VERIFIED]`, `[GENETICS]`, `[PREMISE-6]`.
- Claim-status set is frozen and unchanged: `[VERIFIED]`, `[UNVERIFIED]`, `[DECIDED]`, `[OBSERVED]`, `[PROPOSED]`, `[INTERPRETIVE]`.
- Claim-status tags and taxonomy tags are separate systems.
- Canonical naming is `[PREMISE-6]`; `[PREMISE6]` is non-canonical.
- Claim-status tags never go in file names.

## File Name Taxonomy Slots [DECIDED]

- Taxonomy tags in file names use this exact slot order:
  `YYYY-MM-DD__[ARTIFACT]__[DOMAIN]__[ENTITY-OR-NO-SOURCE]__[WORKFLOW]__short-title.md`
- Slot disambiguator: `[ARTIFACT]` = object being worked on; `[WORKFLOW]` = action phase being performed.
- `[ARTIFACT]` is required.
- `[DOMAIN]` is required.
- `[ENTITY-OR-NO-SOURCE]` is required; use `[NO-SOURCE]` when no source/entity applies.
- `[WORKFLOW]` is required.
- Taxonomy tag tokens use uppercase letters, numbers, and hyphens only inside brackets.

## In-Body Claim Line Process [DECIDED]

Use both systems on claim lines:

`Claim text [CLAIM-STATUS] [DOMAIN] [ARTIFACT] [ENTITY-OR-NO-SOURCE] [WORKFLOW]`

Examples:
- `Casanova 2024 reports archaic introgression enrichment [VERIFIED] [GENETICS] [PREMISE-6] [CASANOVA-2024] [VERIFICATION]`
- `Premise 6 framing needs tighter controls [PROPOSED] [GENETICS] [PREMISE-6] [NO-SOURCE] [ANALYSIS]`

## Mandatory Claim-Status Tags and Where

| Tag | Mandatory for this agent | Where it must appear |
|-----|--------------------------|----------------------|
| `[OBSERVED]` | Yes | Directly measured facts in `state/current.md`, `sessions/*.md`, and `docs/analysis/*.md` |
| `[DECIDED]` | Yes | Locked policies, command-lane rules, and explicit decisions in `state/current.md`, `docs/` runbooks, and session summaries |
| `[PROPOSED]` | Yes | Planned actions, follow-ups, and handoff asks in `state/current.md`, `TODO.md`, and `sessions/*.md` |
| `[VERIFIED]` | Required when applicable | Any external/source-backed claim that has been checked |
| `[UNVERIFIED]` | Required when applicable | Any external/source-backed claim pending confirmation |
| `[INTERPRETIVE]` | Required when applicable | Analyst judgment beyond raw measured facts |

Rules:
- For external evidence claims, use one of `[VERIFIED]` or `[UNVERIFIED]`.
- Use `[INTERPRETIVE]` only when a conclusion is inferred, not directly measured.
- Do not introduce additional claim-status tags.

## Not Required

- Tags are not required in source code, tests, scripts, or runtime output artifacts (`.json`, `.csv`, raw logs).
- Tags are not required for pure command snippets or file-path lists with no factual claim.
- Legacy historical entries do not need retro-tagging.

## Enforcement Checklist (Before `/end`)

- [ ] Every new factual claim in `state/current.md`, `sessions/*.md`, and edited `docs/*.md` has a tag.
- [ ] External evidence claims use `[VERIFIED]` or `[UNVERIFIED]`.
- [ ] Policy/lock statements use `[DECIDED]`; future work uses `[PROPOSED]`.
- [ ] Inferences are separated from facts and marked `[INTERPRETIVE]`.
- [ ] `state/lessons.md` was not modified.
