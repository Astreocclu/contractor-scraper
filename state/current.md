<system_meta>
  <id>auditor-state-001</id>
  <tags>
    <agent>auditor</agent>
    <type>state</type>
    <status>active</status>
    <project>auditor</project>
    <time>2026-02-27</time>
  </tags>
  <tldr>Active workflow state and priorities for auditor: DataForSEO remediation pilot, source demotion, LESSONS sync.</tldr>
</system_meta>

# Auditor State
Tags: [STATE] [AUDITOR] [OPERATIONS]
Tag-Stamped: 2026-02-19 09:34 CT by auditor (new)
Last-Updated: 2026-02-19 09:34 CT
Updated-By: auditor
Update-Summary: Medium priority/tag hygiene pass snapshot

Last updated: 2026-02-19 09:34 CT (America/Chicago) [OBSERVED]

## CURRENT PHASE: PAUSED

**Paused 2026-02-21.** User decision: not worth the time investment right now. Only 3-4 sources actually work (tx_franchise, county_liens, google_maps_local, BBB sometimes). Everything else returns garbage (court searches → random PDFs, tx_sos → search pages, facebook/thumbtack/porch/buildzoom → login walls). Resume when AI can handle API signups and source wiring autonomously.

## STARTUP MUST-READ
- `docs/analysis/2026-02-18-pipeline-forensic-brief.md` (forensic baseline for reusable vs non-reusable evidence, hard review-text requirements, DataForSEO-first remediation process)
- `docs/tag-system-requirements.md` ([DECIDED] canonical tagging policy for claim-bearing docs/state/session updates)

## Priority Pass (2026-02-19 CT)
### Current (Working Now)
- [C1 93/100] Prove DataForSEO remediation batches can deliver ≥10 real reviews per contractor so roof_A Swiss can resume | Why: Swiss signal stays noisy until fresh review text replaces placeholder payloads, so we need a clean pilot batch with instrumentation before burning DeepSeek spend | Next: run `node bin/apify_review_remediation.js --scope scored --batch-size 10 --limit 25 --provider dataforseo --dry-run` with logging, then prep the non-dry batch once pass rate hits 100% | Truth Basis: OBSERVED | Confidence: 94% (2 sigma)
- [C2 88/100] Demote placeholder "success" sources and align the court-record rule to the 20/80 standard | Why: login walls and partial dockets keep leaking noise into the critical-source gate, so the taxonomy has to recognize success quality, not just HTTP status | Next: draft and apply rule update in `docs/analysis/2026-02-18-pipeline-forensic-brief.md` + manifest config so `facebook/thumbtack/porch/buildzoom` default to `not_useful` and county-court checks track payload depth | Truth Basis: OBSERVED | Confidence: 90% (2 sigma)
- [C3 76/100] Close cross-agent clarity handoffs (signal-theory edits + social spotlight follow-ups) so downstream content lanes stop blocking on auditor context | Why: unresolved doc edits and asset confirmations keep attention tied up in other workspaces and dilute signal here | Next: push updated status notes into `Handoff Execution`, ping orchestrator with remaining asks, and confirm whether Social needs assets beyond the Dolce Pools brief | Truth Basis: INFERRED | Confidence: 78% (~1.2 sigma)

### Not Current (Backburner)
- [B1 70/100] Resume `hybrid_100_roof_A` Swiss after remediation batches demonstrate 100% pass behavior.
- [B2 60/100] Permit-score correlation weighting experiments once review quality is stable.
- [B3 55/100] New-vertical expansion planning (foundation repair, outdoor living, turf) post-remediation.

### Blockers Needing Orchestrator
- Need confirmation that `/home/astre/command-center/LESSONS.md` writes are stable across all workspaces so pending cross-agent entries can be cleared. [PROPOSED]
- Signal-Theory doc edits require their agent or orchestrator routing; cannot execute from Auditor lane. [PROPOSED]

### Handoffs Required
- To `signal-theory`: apply clarity edits from `docs/cross-domain-tag-intuition-review-signal-theory-2026-02-18.md` (alias AGENTS pointer, add tag-policy file refs, expand slot examples). [PROPOSED]
- To `social`: confirm whether Dolce Pools spotlight needs creative assets or if the evidence packet already closes their request. [PROPOSED]
- To `orchestrator`: route pending LESSONS entries for other workspaces until global write access is verified. [PROPOSED]

## Handoff Execution (2026-02-19 CT)
- Completed:
  - Social-Greenlit spotlight: delivered Dolce Pools (Mansfield, TX) as a 92/100 Trust Score pool contractor with evidence references logged in `sessions/2026-02-18.md`, closing their 90+ request. [OBSERVED]
  - Applied cross-domain clarity edits from `/home/astre/command-center/src/personal/book-writing/docs/cross-domain-tag-intuition-review-auditor-2026-02-18.md`: replaced "conditional mandatory" with "required when applicable," surfaced a top-level tagging quick-start in `CLAUDE.md`, and added explicit `[ARTIFACT]` vs `[WORKFLOW]` slot disambiguation in `docs/tag-system-requirements.md`. [OBSERVED]
- Deferred:
  - Signal-Theory clarity edits (agent-locked) still pending their workspace availability. [PROPOSED]
- Blockers:
  - Pending LESSONS backlog until orchestrator reconfirms global write path. [PROPOSED]
- Next handoff(s):
  - Await Social confirmation on whether they want additional candidates or creative assets after the Dolce Pools brief. [PROPOSED]

### Freshness
- This section supersedes prior priority-pass notes.

### Batch Status
| Batch | Contractors | Status | Notes |
|-------|-------------|--------|-------|
| A (`hybrid_100`) | 100 | Complete | Baseline run |
| B (`hybrid_100_B`) | 100 | Complete | Baseline run |
| C (`hybrid_100_C`) | 100 | Complete | Swiss incomplete (no DeepSeek Swiss done) |
| D (`hybrid_100_D`) | 100 | Complete | Swiss incomplete (only 50 comparisons) |
| E (`hybrid_100_E`) | 100 | Complete | DeepSeek full run, 1500 comparisons |
| F (`hybrid_100_F`) | 69 | Complete | Source gate recovered, DeepSeek Swiss complete, 1477 comparisons |
| G (`hybrid_100_G`) | 100 | Complete | Source gate 0, first pass 100/100, Swiss 30 rounds, 1500 comparisons |
| H (`hybrid_100_H`) | 100 | Complete | Source gate recovered (county liens fixed), 1496 comparisons, $4.73 DeepSeek |
| I (`hybrid_100_I`) | 100 | Abandoned | Mixed verticals - scrapped, replaced by vertical-focused batches |
| roof_A (`hybrid_100_roof_A`) | 100 | Blocked | Sourced + snapshot + first pass done. Swiss Phase A: 417/~1000 comparisons. Paused until data-quality remediation passes gate. |

### Scale
- **Total pool contractors:** 4,196
- **Completed (A-H):** 769
- **Remaining:** 3,427 (~34 more batches)
- **DeepSeek cost per batch:** ~$4.73

### Locked Decisions
- **Holistic seeding:** LOCKED (2026-02-08). Swiss always seeds from first-pass scores.
- **Pool-only vertical:** LOCKED. Elo comparisons within same vertical only.
- **No reruns without explicit user command:** LOCKED (2026-02-10).
- **Calibration target:** LOCKED (2026-02-10). Both new cohorts target **30 comparisons per contractor**.
- **Source-first invariant:** LOCKED (2026-02-10). Always source unsourced contractors in a cohort before snapshot/first-pass/Swiss.
- **Model-lane boundary:** LOCKED (2026-02-12). If the runtime is Codex, run only Codex tools/processes.
- **Tier cell size:** LOCKED (2026-02-12). 100-contractor cells (80-120 allowed).
- **Comparison schedule:** LOCKED (2026-02-12). Progressive DeepSeek: 10 for all, then 20 for top/boundary, then 30 for top/boundary.
- **Critical-source gate:** LOCKED (2026-02-12). Must have: google_presence, bbb, court_records, county_liens, tx_franchise.
- **Strict sourcing:** LOCKED (2026-02-14). Sourcing failures = immediate pipeline failure. No bypasses.
- **Run-100 Policy Lock:** LOCKED. Use only `node bin/hybrid_100_progressive_pipeline.js`, never piecemeal commands.

### Budget + Model Constraints
- **Claude Max:** $200/month subscription (flat plan; not per-call API billing).
- **Codex Pro:** $200/month subscription (flat plan; not per-call API billing).
- **DeepSeek:** Pay-as-you-go credits available; use for scalable automated comparisons.
- **Never** write direct Anthropic API scripts for this workflow; use in-product agents/subscriptions.

## Known Issues
- **Collin County liens slow:** Timeouts common with multiple name variations. Fix: run single-county targeted searches, update DB status manually for timeout cases where no liens found.
- **Batch F only 69 contractors:** Sample was undersized. Don't repeat.
- **Data quality gate failure (2026-02-17):** `google_maps_local` success rows include large zero-text segment; among trust_score>0 cohort, 862 success rows but 283 zero-text and only 213 with >=10 non-empty reviews.
- **Phantom source successes (2026-02-17):** `facebook`, `thumbtack`, `porch`, `buildzoom` are effectively placeholder/login/not-found pages marked as success.
- **DataForSEO backlog still open (2026-02-18):** scoped dry-run on scored pool cohort selected 740 contractors still failing remediation invariants (`nonempty_below_10`, `incomplete_full_capture_for_small_listing`, or `high_reported_count_low_text`). Backlog execution is intentionally deferred until source-readiness 20/80 is complete. [OBSERVED]
- **Apify remains fallback only (2026-02-18):** Apify payload-shape guard is still required for fallback runs, but primary review remediation lane is now DataForSEO. [DECIDED]

## Permit-Score Correlation Analysis (2026-02-14) [OBSERVED]
- Script: `bin/analyze_permit_score_correlation.js`
- Results: `experiments/permit_score_analysis.json`
- Verdict: WEAK - 0/6 hypotheses significant
- Core problem: 94% of permits lack contractor_name field
- Only 13 clean matches from 1,127 scored contractors (1.2%)
- Matching requires strict name cleaning to avoid false positives

## Open Threads
- Consider adding penalties for closed Google Maps status and low BBB grades.
- Evaluate weighting of cross-platform review volume (Angi/Yelp/Houzz).
- New verticals research handoff pending (Foundation Repair highest priority).

## Blockers
- **Source-integrity blocker:** Placeholder-heavy sources (`facebook`, `thumbtack`, `porch`, `buildzoom`) still appear as success and pollute evidence context until demoted/filtered. [OBSERVED]
- **Critical-rule blocker:** Current critical rule set still treats `court_records` presence as sufficient even when county-court signal quality is uneven; 20/80 rule alignment is still pending. [INTERPRETIVE]
- **Comparison quality blocker:** Current scored cohort includes substantial low-text Google review coverage (not fit for high-confidence pairwise at scale without review-text remediation).
- **Swiss continuation gate:** roof_A and follow-on Swiss runs remain paused until remediation batches pass quality gate.
- Vertical focus: LOCKED on Roofing (541 total, 100 in roof_A, ~441 remaining = ~5 more batches)
- Batch I (mixed verticals): ABANDONED. Not counted toward any vertical.

## Recent Context
- 2026-02-18: [DECIDED] User-directed strategy shift: complete source-readiness (20/80 high-signal sources) before bulk historical review remediation.
- 2026-02-18: [OBSERVED] Patched `bin/source_missing_from_manifest.js` to evaluate latest row per contractor/source and enforce `google_presence` as success-only (not `not_found`).
- 2026-02-18: [OBSERVED] Verification rerun passed after patch: `node bin/source_missing_from_manifest.js --config=experiments/hybrid_100_roof_A/config/sample_100_group_roof_A.json --required=google_presence,bbb,court_records,county_liens,tx_franchise --verify-only`.
- 2026-02-18: [OBSERVED] Verified `/home/astre/command-center/LESSONS.md` writes succeed in this session; prior permission blocker is currently resolved.
- 2026-02-18: [OBSERVED] Dry-run ranking command (`bin/apify_review_remediation.js --scope open --batch-size 10 --limit 25 --sort high-review --dry-run`) produced an actionable remediation queue led by IDs `1746`, `6133`, `5977`, `348`, `353` with `review_count` 669-1200 and `nonempty_below_10`/`high_reported_count_low_text` reasons.
- 2026-02-18: [OBSERVED] Resume check validated DataForSEO service health (`node tests/test_dataforseo.js` passes transform + credential checks), and `services/collection_service.js` now runs DataForSEO remediation in active Google review paths (`remediateGoogleReviewsWithDataForSEO`). 
- 2026-02-18: [INTERPRETIVE] Highest-signal execution path is strict DataForSEO batch remediation plus gate verification, not additional source-lane expansion.
- 2026-02-18: [OBSERVED] Completed `/begin` ritual for this task by reading `state/current.md`, `state/profile.md`, `/home/astre/command-center/LESSONS.md`, `docs/tag-system-requirements.md`, sibling `state/current.md` handoffs, and session status in `sessions/2026-02-18.md`.
- 2026-02-18: [OBSERVED] Completed required cross-domain intuitiveness review for target `signal-theory` (`/home/astre/command-center/src/personal/signal-theory`) and wrote `docs/cross-domain-tag-intuition-review-signal-theory-2026-02-18.md` with score **86/100**, bracket-check **PASS**, filename-slot check **PASS**, and recommendation `accept-with-edits`.
- 2026-02-18: [OBSERVED] `/end` LESSONS append attempt for this run failed with `Permission denied` on `/home/astre/command-center/LESSONS.md`; follow-up handoff added with exact entry text.
- 2026-02-18: [OBSERVED] Open-cohort review remediation analysis completed; open population confirmed at 3,427 with `usable_ge10_nonempty=155` and large remediation demand remaining.
- 2026-02-18: [OBSERVED] Implemented review remediation hardening (`services/apify_service.js`, `services/collection_service.js`, `services/review_analyzer.js`) plus batch runner `bin/apify_review_remediation.js` and forensic write-up `docs/analysis/2026-02-18-apify-remediation-failure-and-solution.md`.
- 2026-02-18: [OBSERVED] Scored-cohort dry-run (`node bin/apify_review_remediation.js --scope scored --batch-size 10 --limit 10000 --dry-run`) selected 740 remediation candidates under DataForSEO policy gates.
- 2026-02-18: [OBSERVED] Logged reusable failure lesson in `/home/astre/command-center/LESSONS.md` for missing fallback payload-shape validation guard.
- 2026-02-18: [DECIDED] Implemented locked taxonomy policy across core docs (`CLAUDE.md`, `docs/README.md`, `docs/tag-system-requirements.md`, `docs/tag-system-proposal.md`, `docs/dual-tag-system-proposal.md`).
Dual-tag policy status: implemented from locked policy [DECIDED]
- 2026-02-18: [OBSERVED] Completed proposal-only tag-system pass and wrote `docs/tag-system-proposal.md` with Lean/Balanced/Strict options and approval questions.
- Tag policy status: implemented from locked policy [DECIDED]
- 2026-02-18: [OBSERVED] `/end` LESSONS update attempt to `/home/astre/command-center/LESSONS.md` failed with `Permission denied` under current workspace sandbox.
- 2026-02-18: [DECIDED] Agent classification for tag governance is `hybrid`; canonical requirements file created at `docs/tag-system-requirements.md`.
- 2026-02-18: [OBSERVED] Documentation maintenance pass removed stale onboarding references to `bin/check_status.js` and nonexistent `docs/validation`, `docs/archive`, `docs/_archive` directories.
- 2026-02-18: [OBSERVED] Fulfilled the social spotlight request by packaging Dolce Pools (Trust Score 92, Mansfield TX) as the 90+ pool candidate with supporting evidence references.
- 2026-02-17: Maintenance dispatch write test rerun completed; recreated `/tmp/codex_dispatch_write_test.txt` as an empty file (0 bytes), reran `/begin` ritual reads, confirmed no `sessions/2026-02-18.md` yet, and found an open cross-agent handoff in `social/state/current.md` (identify a 90+ Trust Score pool contractor for a spotlight post).
- 2026-02-17: Temporary maintenance dispatch test completed; created `/tmp/codex_dispatch_write_test.txt` as an empty file (0 bytes), verified `/begin` + `/end` memory rituals, and logged a sandbox blocker preventing writes to `/home/astre/command-center/LESSONS.md`.
- 2026-02-17: Forensic quality audit confirmed `google_maps_local` gap in scored cohort (862 success rows; 283 zero-text; 71 rows with `review_count >= 50` but zero review text).
- 2026-02-17: Placeholder-success scan confirmed non-informative sources at scale (`facebook`, `thumbtack`, `porch`, `buildzoom`).
- 2026-02-17: Apify actor pricing validated from live account/API (`$0.0005` per review, BRONZE tier); live tests returned 20 reviews in ~11.8s and 50 reviews in ~32.2s.
- 2026-02-14: Batch H completed with 1496 comparisons, $4.73 DeepSeek cost
- 2026-02-14: County liens timeout resolved for 15 contractors using targeted single-county searches
- 2026-02-14: Permit-score correlation analysis: WEAK, no predictive power with current data
- 2026-02-14: Batch I initiated, 86/100 contractors need full source collection

## Handoff Needed
- **To:** `signal-theory`
  - **Task:** Apply cross-domain clarity edits from `docs/cross-domain-tag-intuition-review-signal-theory-2026-02-18.md`: add/alias `AGENTS.md`, add `docs/` pointer files for tag policy docs, and normalize dual-tag examples to the full in-body slot template. [PROPOSED]
  - **Context:** Review recommendation is `accept-with-edits` with five concrete confusion points focused on non-domain intuitiveness. [OBSERVED]

## Priority Pass (2026-02-20 CT)

### Current (Working Now)
- [C1 95/100] Execute DataForSEO remediation pilot batch (10-25 contractors) and validate 100% pass rate before scaling to full scored cohort | Why: Swiss scoring remains blocked until we prove review-text remediation delivers ≥10 real reviews consistently; pilot run with instrumentation prevents burning DeepSeek spend on noisy data | Next: `node bin/apify_review_remediation.js --scope scored --batch-size 10 --limit 25 --provider dataforseo` (non-dry), monitor logs for pass rate, then update `state/current.md` with results and green-light decision | Truth Basis: OBSERVED | Confidence: 96% (2 sigma)

- [C2 91/100] Demote placeholder sources (facebook/thumbtack/porch/buildzoom) to `not_useful` status and align court-record rule to payload-depth standard | Why: current critical-source gate treats HTTP success as signal quality, allowing login walls and partial dockets to pollute evidence context and inflate Swiss confidence incorrectly | Next: update `docs/analysis/2026-02-18-pipeline-forensic-brief.md` with 20/80 rule amendments, then apply demotion logic in manifest config and `source_missing_from_manifest.js` validation | Truth Basis: OBSERVED | Confidence: 93% (2 sigma)

- [C3 84/100] Resolve LESSONS.md write-path blocker and push pending cross-agent entries to global log | Why: Auditor has accumulated reusable failure lessons (Apify payload guard, review remediation) that are blocked from propagating to other agents until write permissions are confirmed | Next: confirm with Orchestrator that `/home/astre/command-center/LESSONS.md` is writable from Auditor workspace, then append pending BAD ROBOT entry from 2026-02-18 Apify remediation failure | Truth Basis: OBSERVED | Confidence: 88% (2 sigma)

### Not Current (Backburner)
- [B1 78/100] Resume `hybrid_100_roof_A` Swiss Phase B after remediation pilot proves stable and placeholder-source demotion is live
- [B2 72/100] Execute bulk review remediation (740 contractors) for scored cohort once pilot validates DataForSEO reliability at scale
- [B3 65/100] Close Signal-Theory and Social-Greenlit handoffs (clarity edits + spotlight asset confirmation)
- [B4 58/100] New vertical expansion planning (foundation repair, outdoor living) after roofing batch completion

### Blockers Needing Orchestrator
- LESSONS.md write-path confirmation required before pending cross-agent entries can propagate to global log [OBSERVED]
- Signal-Theory clarity edits are agent-locked and require Orchestrator routing or direct Signal-Theory agent dispatch [PROPOSED]

### Handoffs Required
- To `orchestrator`: Confirm `/home/astre/command-center/LESSONS.md` write access from Auditor workspace, then route pending BAD ROBOT entry (Apify payload guard failure) [PROPOSED]
- To `signal-theory`: Apply clarity edits from `docs/cross-domain-tag-intuition-review-signal-theory-2026-02-18.md` (AGENTS.md alias, tag-policy doc refs, slot examples) [PROPOSED]
- To `social-greenlit`: Confirm whether Dolce Pools spotlight (92/100 Trust Score, Mansfield TX) closes your request or if additional creative assets are needed [PROPOSED]

### Freshness
- This Priority Pass supersedes 2026-02-19 CT pass and reflects current state as of 2026-02-20 CT
- Based on: last session 2026-02-19 (medium priority/tag hygiene pass), current phase SOURCE-READINESS 20/80, Swiss scoring paused until remediation completes
