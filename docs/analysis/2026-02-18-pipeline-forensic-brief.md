Recap: you’re right, the current pipeline is passing “coverage” without enough usable evidence.

Update (2026-02-18 16:48 CT): DataForSEO remediation is active in the main Google review path (`services/collection_service.js`) [OBSERVED].
Update (2026-02-18 16:48 CT): scoped scored-cohort dry-run still selected 740 remediation candidates under the hard gate (`node bin/apify_review_remediation.js --scope scored --batch-size 10 --limit 10000 --dry-run`) [OBSERVED].
Update (2026-02-18 16:48 CT): Apify is fallback-only for review remediation while DataForSEO is the primary lane [DECIDED].

1. What is reusable now (measured on Feb 17-18, 2026)
- Scored cohort (`trust_score > 0`): 879 contractors.
- `google_maps_local` success rows: 862.
- High-quality review text now: 213/879 have `>=10` non-empty Google review texts (182 have `>=20`).
- Medium quality: 497/879 have `>=5` non-empty texts.
- Not reusable for high-confidence comparison: 365/879 have `<5` texts, including 283 with zero text.
- Critical mismatch: 71 contractors show `review_count >= 50` but zero review text.
- Fully junk “success” sources (placeholder/login/not-found content): `facebook` (867/867), `thumbtack` (866/866), `porch` (864/864), `buildzoom` (863/863).

2. Absolutely needed for super high-quality comparisons
- Hard review-text gate before scoring:
  - Minimum `>=10` non-empty Google review texts per contractor.
  - Target `>=20` for top/boundary comparisons.
  - Auto-fail if `review_count >= 50` and review text `<5`.
- Source hygiene:
  - Exclude placeholder-heavy sources from scoring context.
  - Keep legal/business signals (`bbb`, `county_liens`, `tx_franchise`/`tx_sos_search`, county courts).
- Gate logic fix:
  - Current source gate accepts `not_found` as pass (`bin/source_missing_from_manifest.js:310`), which lets low-evidence rows through.
  - `fetchPage()` marks generic pages as success (`services/collection_service.js:1536`, `services/collection_service.js:1573`).

3. DataForSEO-first remediation process + fallback cost
- Current state:
  - Primary remediation lane is DataForSEO (`GOOGLE_REVIEW_REMEDIATION_PROVIDER` defaults to `dataforseo`) and runs inside `services/collection_service.js` [OBSERVED].
  - Batch runner `bin/apify_review_remediation.js` is legacy-named but currently executes DataForSEO policy logic [OBSERVED].
  - Apify is retained as fallback-only and should not be treated as the primary lane [DECIDED].
- Recommended process:
  1. Build candidate set from live gate output (`node bin/apify_review_remediation.js --scope scored --batch-size 10 --limit 10000 --dry-run`) and track total candidates [OBSERVED].
  2. Execute strict batch-10 remediation runs without `--dry-run`, stopping immediately on the first non-100% batch [DECIDED].
  3. Verify post-batch gate status; keep remediation looping until `needs_remediation` materially drops and blocker threshold is cleared [PROPOSED].
  4. Resume progressive scoring only after gate pass conditions are met [DECIDED].
- Apify fallback pricing (if fallback is forced):
  - Account tier: BRONZE [OBSERVED].
  - Actor pricing: `PRICE_PER_DATASET_ITEM`, `$0.0005` per review [OBSERVED].

Next steps:
1. Run live scored remediation in strict batches (first 10 now), then capture pass/fail and residual-candidate count [PROPOSED].
2. Keep placeholder-source cleanup in parallel (`facebook`, `thumbtack`, `porch`, `buildzoom`) so non-review noise does not leak into scoring context [PROPOSED].
3. Re-snapshot and rerun progressive scoring only after both review-text and source-hygiene gates pass [DECIDED].
