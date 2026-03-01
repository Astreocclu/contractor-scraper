# Apify Remediation Failure + Solution (2026-02-18)

## Recap
Pipeline review coverage was reporting success even when Google review text was too sparse for high-confidence fraud/authenticity analysis.

## Failure Modes
1. `google_maps_local` rows could be `success` with very low usable text.
2. Apify only executed on hard fetch failure (`null` result), not on low-text/incomplete payloads.
3. Serper-to-Apify URL handoff expected `maps_url`, but Serper often returns `cid` without `maps_url`.
4. Review analyzer used strategic sampling/truncation for Google reviews, so full corpus patterns were not always considered.
5. For listings with `review_count <= 200`, the system did not enforce full-capture (`stored_reviews == review_count`).

## Root Cause
Coverage logic was binary (`found/not_found`) rather than evidence-quality aware (`nonempty_texts`, full-capture completeness, and critical mismatch checks).

## Locked Remediation Policy
1. Target fetch size: `200` reviews (most recent from Apify actor path).
2. If `review_count <= 200`: all reviews must be stored in full.
3. If `review_count > 200`: store the most recent `200` reviews in full.
4. Full text + raw review payload must be preserved in `structured_data`.
5. Review authenticity analysis must consume the full stored corpus (not strategic sample only).

## Code Changes Implemented
1. `services/apify_service.js`
- Default Apify fetch size raised to `200`.
- Added `reviewsSort` actor input (`newest` default via env).
- Preserved full raw Apify review payload per review (`raw` field).
- Removed text-only filter that dropped reviews with empty text.
- Added `fetched_review_count`, `nonempty_review_count`, `requested_max_reviews`.

2. `services/collection_service.js`
- Added coverage/invariant helpers:
  - non-empty review text counting
  - Google coverage summary
  - full-capture checks for `review_count <= maxReviews`
- Fixed Apify URL derivation:
  - accepts `maps_url` directly
  - falls back to `cid -> https://www.google.com/maps?cid=<cid>`
  - supports query fallback.
- Apify fallback fetch size raised from `50` to `200`.
- Added active Apify remediation path for low-text/incomplete Google rows even when initial fetch succeeded.
- Added `remediateGoogleMapsLocalSource()` for targeted remediation + optional review-analysis rerun.
- Review analysis trigger relaxed from `>=2` sources to `>=1` review-bearing source.

3. `services/review_analyzer.js`
- `REVIEW_QUALITY_ENABLED` now defaults to enabled unless explicitly `false`.
- Full-corpus defaults:
  - `REVIEW_QUALITY_MAX_REVIEWS=200`
  - no per-review text clipping unless configured (`*_TEXT_MAX_CHARS=0`).
- Replaced Google strategic sample context with full stored corpus context (bounded by `REVIEW_CONTEXT_MAX_REVIEWS`, default 200).
- Added full-corpus quality summary block into analysis context.
- Added dedupe pass for repeated review entries across mirrored sources.

4. `bin/apify_review_remediation.js` (new)
- Batch remediation runner with hard invariant checks.
- Default batch size `10`.
- Stops immediately on first batch that is not `100%` pass.
- Supports `--scope open|scored|unscored|all`, `--limit`, `--batch-size`, `--max-reviews`, `--min-nonempty`, `--dry-run`.

## Batch Execution Standard
Run in strict batches of 10:

```bash
source venv/bin/activate && set -a && . ./.env && set +a && \
node bin/apify_review_remediation.js --scope open --batch-size 10 --limit 10 --max-reviews 200 --min-nonempty 10
```

Pass criteria per contractor:
1. `after.needs_remediation == false`
2. If `after.full_capture_required == true`, then `after.full_capture_satisfied == true`

Pass criteria per batch:
1. `10/10` invariant pass required (100%)
2. Any miss halts the run for investigation

## Operational Notes
1. This does not relax source quality requirements; it tightens them.
2. DeepSeek comparison/scoring should only run after remediated data passes these invariants.
3. If Apify credits fail mid-run, batch halts to avoid false-success states.
