# Cross-Domain Tag Intuition Review - `signal-theory` (2026-02-18)

## Target
- Target agent: `signal-theory`. [OBSERVED]
- Target workspace: `/home/astre/command-center/src/personal/signal-theory`. [OBSERVED]
- Reviewer workspace: `/home/astre/command-center/src/greenlit/auditor`. [OBSERVED]

## Scope Reviewed
- Reviewed: `CLAUDE.md`, `README.md`, `TAG_SYSTEM_REQUIREMENTS.md`, `TAG_SYSTEM_PROPOSAL.md`, `DUAL_TAG_SYSTEM_PROPOSAL.md`. [OBSERVED]
- Missing from target path: `AGENTS.md`, `docs/README.md`, `docs/tag-system-requirements.md`, `docs/tag-system-proposal.md`, `docs/dual-tag-system-proposal.md`. [OBSERVED]

## Score
- Intuitiveness score: **86/100**. [INTERPRETIVE]

## Compliance Checks
- Bracket-only compliance check: **PASS** (all observed tag tokens in reviewed policy docs were bracketed). [OBSERVED]
- Filename slot process clarity check (`YYYY-MM-DD__[ARTIFACT]__[DOMAIN]__[ENTITY-OR-NO-SOURCE]__[WORKFLOW]__short-title.md`): **PASS** (process is explicit with required-slot rules). [OBSERVED]

## Top 5 Confusion Points
1. The target lacks `AGENTS.md`, while cross-domain prompts often instruct reviewers to check it first; this creates entry-point ambiguity. [OBSERVED]
2. Equivalent docs-path policy files are missing (`docs/tag-system-*.md`), so non-domain readers have to infer root-level files are canonical. [OBSERVED]
3. Proposal files are marked "historical" but still include "Adopt Balanced as the active policy," which can look like unresolved governance to new readers. [OBSERVED]
4. `DUAL_TAG_SYSTEM_PROPOSAL.md` example claim lines do not consistently demonstrate all four taxonomy slots from the declared in-body template, which weakens intuitiveness for first-time taggers. [OBSERVED]
5. There is no compact selector rule for `[ARTIFACT]` vs `[ENTITY-OR-NO-SOURCE]`, so assignment can feel subjective for cross-domain contributors. [INTERPRETIVE]

## Top 5 Intuitive Strengths
1. Lock metadata (ID/timestamp/path) is explicit and easy to verify across core tag docs. [OBSERVED]
2. The frozen six claim-status tags are repeated verbatim in all reviewed policy docs. [OBSERVED]
3. Canonical `[PREMISE-6]` vs non-canonical `[PREMISE6]` is consistently and clearly stated. [OBSERVED]
4. Filename slot ordering and `[NO-SOURCE]` fallback behavior are directly documented. [OBSERVED]
5. `TAG_SYSTEM_REQUIREMENTS.md` includes a practical `/end` checklist that turns policy into an executable QA step. [OBSERVED]

## Five Plain-to-Tagged Mappings
1. Plain: `Casanova 2024 reports archaic introgression enrichment in autistic probands.`
   Tagged: `Casanova 2024 reports archaic introgression enrichment in autistic probands [VERIFIED] [GENETICS] [PREMISE-3] [CASANOVA-2024] [VERIFICATION]`. [OBSERVED]
2. Plain: `Premise 6 framing needs tighter controls in Book 1 draft notes.`
   Tagged: `Premise 6 framing needs tighter controls in Book 1 draft notes [PROPOSED] [BOOK-ARCHITECTURE] [PREMISE-6] [NO-SOURCE] [DRAFTING]`. [OBSERVED]
3. Plain: `W001 and W002 are mostly medial in the Wells corpus sample.`
   Tagged: `W001 and W002 are mostly medial in the Wells corpus sample [OBSERVED] [INDUS] [PREMISE-1] [WELLS-CORPUS] [ANALYSIS]`. [OBSERVED]
4. Plain: `The translation claim is still pending source-quality confirmation.`
   Tagged: `The translation claim is still pending source-quality confirmation [UNVERIFIED] [TRANSLATION] [PREMISE-6] [NO-SOURCE] [VERIFICATION]`. [OBSERVED]
5. Plain: `Signal Theory docs now enforce the locked taxonomy naming pattern.`
   Tagged: `Signal Theory docs now enforce the locked taxonomy naming pattern [DECIDED] [TAXONOMY] [PREMISE-6] [NO-SOURCE] [STATE-UPDATE]`. [OBSERVED]

## Final Recommendation
- **accept-with-edits**. [INTERPRETIVE]
- Suggested edits: add/alias `AGENTS.md`, add lightweight `docs/` pointers to canonical root policy docs, and normalize dual-tag examples to the full in-body slot template. [PROPOSED]
