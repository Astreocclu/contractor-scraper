# Auditor Evidence Quality Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent low-evidence/placeholder review data from entering scoring, remediate existing weak Google review evidence, and hard-fail progressive scoring when evidence quality is below policy.

**Architecture:** Introduce a shared source-quality policy module, enforce it at ingestion (`collection_service`), enforce it again at source-gate/pipeline preflight, and run controlled Apify remediation batches until all candidates satisfy hard review-text invariants. This is defense-in-depth: one policy, multiple enforcement points.

**Tech Stack:** Node.js, PostgreSQL (`contractor_raw_data`), Mocha, existing auditor scripts (`bin/source_missing_from_manifest.js`, `bin/hybrid_100_progressive_pipeline.js`, `bin/apify_review_remediation.js`).

---

## Option Scoring (choose before implementation)

1. **Patch-only in existing files** — `78/100`
- Fastest, but logic drift will return (same rules duplicated in multiple places).

2. **Shared policy module + gated pipeline + staged remediation (RECOMMENDED)** — `95/100`
- One source of truth for evidence quality.
- Enforced at ingestion, gate, and pipeline.
- Minimal schema risk; maximum operational safety.

3. **Full collector rewrite + queue architecture** — `62/100`
- High upside eventually, but too much surface area and risk for immediate remediation.

This plan implements Option 2.

---

## Prerequisites

1. Work in auditor repo:
```bash
cd /home/astre/command-center/src/greenlit/auditor
```

2. Load env (needed for live scripts):
```bash
source venv/bin/activate
set -a
. ./.env
set +a
```

3. Skills to apply during execution:
- `@test-driven-development`
- `@testing-anti-patterns`
- `@verification-before-completion`

---

### Task 1: Create Shared Source-Quality Policy Module

**Files:**
- Create: `services/source_quality_policy.js`
- Create: `tests/unit/test_source_quality_policy.js`

**Step 1: Write the failing test**

```js
// tests/unit/test_source_quality_policy.js
const assert = require('assert');
const {
  detectPlaceholderSourceContent,
  countNonEmptyReviewTexts,
  summarizeGoogleReviewCoverage,
  normalizeApifyDatasetItems
} = require('../../services/source_quality_policy');

describe('source_quality_policy', () => {
  it('flags placeholder pages for placeholder-prone sources', () => {
    const out = detectPlaceholderSourceContent({
      source: 'facebook',
      rawText: 'Sorry, this page is not available right now.'
    });
    assert.equal(out.is_placeholder, true);
  });

  it('counts non-empty review text correctly', () => {
    const count = countNonEmptyReviewTexts([
      { text: 'Great work' },
      { text: '   ' },
      { review_text: 'Done on time' }
    ]);
    assert.equal(count, 2);
  });

  it('marks high-review-count low-text as remediation-needed', () => {
    const coverage = summarizeGoogleReviewCoverage(
      { found: true, review_count: 71, reviews: [{ text: '' }, { text: '  ' }] },
      { maxReviews: 200, minNonEmpty: 10, criticalReviewCount: 50, criticalTextFloor: 5 }
    );
    assert.equal(coverage.needs_remediation, true);
    assert(coverage.remediation_reasons.includes('high_reported_count_low_text'));
  });

  it('drops Apify error rows like no_search_results', () => {
    const { usable, dropped } = normalizeApifyDatasetItems([
      { error: 'no_search_results' },
      { text: 'Solid work', stars: 5, name: 'Alice' }
    ]);
    assert.equal(usable.length, 1);
    assert.equal(dropped.length, 1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/test_source_quality_policy.js`
Expected: FAIL with `Cannot find module '../../services/source_quality_policy'`

**Step 3: Write minimal implementation**

```js
// services/source_quality_policy.js
const PLACEHOLDER_PATTERNS = [
  /page not found/i,
  /not available/i,
  /content isn't available/i,
  /sign in/i,
  /log in/i,
  /login/i,
  /we couldn't find/i,
  /this page does not exist/i
];

const PLACEHOLDER_SOURCES = new Set(['facebook', 'thumbtack', 'porch', 'buildzoom', 'homeadvisor']);

function detectPlaceholderSourceContent({ source, rawText = '' }) {
  const text = String(rawText || '').slice(0, 4000);
  if (!PLACEHOLDER_SOURCES.has(String(source || '').toLowerCase())) {
    return { is_placeholder: false, reason: null };
  }
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) {
      return { is_placeholder: true, reason: `matched:${pattern}` };
    }
  }
  return { is_placeholder: false, reason: null };
}

function reviewTextOf(review) {
  return String(review?.text ?? review?.review_text ?? review?.content ?? review?.comment ?? '').trim();
}

function countNonEmptyReviewTexts(reviews = []) {
  if (!Array.isArray(reviews)) return 0;
  return reviews.reduce((n, r) => n + (reviewTextOf(r) ? 1 : 0), 0);
}

function summarizeGoogleReviewCoverage(result = {}, opts = {}) {
  const maxReviews = Number(opts.maxReviews ?? 200);
  const minNonEmpty = Number(opts.minNonEmpty ?? 10);
  const criticalReviewCount = Number(opts.criticalReviewCount ?? 50);
  const criticalTextFloor = Number(opts.criticalTextFloor ?? 5);

  const reviews = Array.isArray(result.reviews) ? result.reviews : [];
  const fetchedReviews = reviews.length;
  const reviewCount = Number.isFinite(Number(result.review_count)) ? Number(result.review_count) : fetchedReviews;
  const nonemptyReviews = countNonEmptyReviewTexts(reviews);

  const reasons = [];
  if (!result.found) reasons.push('not_found');
  if (nonemptyReviews < minNonEmpty) reasons.push(`nonempty_below_${minNonEmpty}`);
  if (reviewCount > 0 && reviewCount <= maxReviews && fetchedReviews < reviewCount) {
    reasons.push('incomplete_full_capture_for_small_listing');
  }
  if (reviewCount >= criticalReviewCount && nonemptyReviews < criticalTextFloor) {
    reasons.push('high_reported_count_low_text');
  }

  return {
    review_count: reviewCount,
    fetched_reviews: fetchedReviews,
    nonempty_reviews: nonemptyReviews,
    full_capture_required: reviewCount > 0 && reviewCount <= maxReviews,
    full_capture_satisfied: !(reviewCount > 0 && reviewCount <= maxReviews && fetchedReviews < reviewCount),
    needs_remediation: reasons.length > 0,
    remediation_reasons: reasons
  };
}

function normalizeApifyDatasetItems(items = []) {
  const usable = [];
  const dropped = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    const hasErrorFlag = !!item?.error;
    const hasReviewShape = !!(item?.text || item?.reviewText || item?.stars || item?.rating || item?.reviewUrl);
    if (hasErrorFlag && !hasReviewShape) {
      dropped.push({ reason: 'error_row', row: item });
      continue;
    }
    usable.push(item);
  }
  return { usable, dropped };
}

module.exports = {
  detectPlaceholderSourceContent,
  countNonEmptyReviewTexts,
  summarizeGoogleReviewCoverage,
  normalizeApifyDatasetItems
};
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/test_source_quality_policy.js`
Expected: PASS

**Step 5: Commit**

```bash
git add services/source_quality_policy.js tests/unit/test_source_quality_policy.js
git commit -m "feat: add shared source quality policy module"
```

---

### Task 2: Harden Apify Payload Validation

**Files:**
- Modify: `services/apify_service.js`
- Create: `tests/unit/test_apify_payload_guard.js`

**Step 1: Write the failing test**

```js
// tests/unit/test_apify_payload_guard.js
const assert = require('assert');
const { buildApifyResultFromItems } = require('../../services/apify_service');

describe('apify payload guard', () => {
  it('returns found=false when dataset has only error rows', () => {
    const result = buildApifyResultFromItems(
      [{ error: 'no_search_results' }],
      'https://www.google.com/maps?cid=123',
      200
    );
    assert.equal(result.found, false);
    assert.match(result.error, /No usable reviews/i);
  });

  it('keeps usable review rows and reports dropped count', () => {
    const result = buildApifyResultFromItems(
      [{ error: 'no_search_results' }, { text: 'Great', stars: 5, name: 'A' }],
      'https://www.google.com/maps?cid=123',
      200
    );
    assert.equal(result.found, true);
    assert.equal(result.reviews.length, 1);
    assert.equal(result.apify_dropped_rows, 1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/test_apify_payload_guard.js`
Expected: FAIL with `buildApifyResultFromItems is not a function`

**Step 3: Write minimal implementation**

```js
// services/apify_service.js (key additions)
const {
  normalizeApifyDatasetItems,
  countNonEmptyReviewTexts
} = require('./source_quality_policy');

function buildApifyResultFromItems(rawItems, googleMapsUrl, maxReviews) {
  const { usable, dropped } = normalizeApifyDatasetItems(rawItems);
  if (!usable.length) {
    return {
      found: false,
      error: 'No usable reviews returned from Apify dataset',
      apify_dropped_rows: dropped.length,
      apify_drop_reasons: dropped.map(d => d.reason)
    };
  }

  const reviews = usable.map((review) => ({ ...transformReview(review), raw: review }));
  const ratedReviews = reviews.filter(r => Number.isFinite(r.rating));
  const totalStars = ratedReviews.reduce((sum, r) => sum + r.rating, 0);

  return {
    found: true,
    business_name: usable[0]?.title || '',
    rating: ratedReviews.length ? Number((totalStars / ratedReviews.length).toFixed(1)) : null,
    review_count: usable.length,
    fetched_review_count: usable.length,
    nonempty_review_count: countNonEmptyReviewTexts(reviews),
    reviews,
    maps_url: googleMapsUrl,
    review_source: 'apify',
    requested_max_reviews: maxReviews,
    apify_dropped_rows: dropped.length,
    apify_drop_reasons: dropped.map(d => d.reason)
  };
}

// inside scrapeGoogleReviewsApify()
const rawReviews = await fetchReviewsApify([googleMapsUrl], maxReviews);
return buildApifyResultFromItems(rawReviews, googleMapsUrl, maxReviews);

module.exports = {
  // existing exports...
  buildApifyResultFromItems
};
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/test_apify_payload_guard.js`
Expected: PASS

**Step 5: Commit**

```bash
git add services/apify_service.js tests/unit/test_apify_payload_guard.js
git commit -m "fix: reject apify error rows and expose payload guard"
```

---

### Task 3: Enforce Placeholder/Low-Evidence Policy at Persistence Layer

**Files:**
- Modify: `services/collection_service.js`
- Create: `tests/unit/test_collection_store_raw_data_policy.js`

**Step 1: Write the failing test**

```js
// tests/unit/test_collection_store_raw_data_policy.js
const assert = require('assert');
const { CollectionService } = require('../../services/collection_service');

describe('collection storeRawData quality policy', () => {
  it('downgrades placeholder facebook success row to not_found', async () => {
    let capturedParams = null;
    const fakeDb = { run: async (_sql, params) => { capturedParams = params; } };

    const svc = new CollectionService(fakeDb);
    await svc.storeRawData(101, 'facebook', {
      url: 'https://facebook.com/search',
      status: 'success',
      text: 'This page is not available right now',
      structured: {}
    });

    // params[5] = fetch_status, params[6] = error_message
    assert.equal(capturedParams[5], 'not_found');
    assert.match(String(capturedParams[6] || ''), /placeholder/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/test_collection_store_raw_data_policy.js`
Expected: FAIL because status remains `success`

**Step 3: Write minimal implementation**

```js
// services/collection_service.js (key additions)
const {
  detectPlaceholderSourceContent,
  summarizeGoogleReviewCoverage
} = require('./source_quality_policy');

function applySourceQualityPolicy(source, data) {
  const next = { ...data };

  // Placeholder detection for sources known to produce login/not-found shells
  const placeholder = detectPlaceholderSourceContent({ source, rawText: next.text || '' });
  if (next.status === 'success' && placeholder.is_placeholder) {
    next.status = 'not_found';
    next.error = `placeholder_content:${placeholder.reason}`;
  }

  // Google evidence annotation (does not overwrite success status here)
  if (source === 'google_maps_local' && next.structured && typeof next.structured === 'object') {
    next.structured.review_coverage = summarizeGoogleReviewCoverage(next.structured, {
      maxReviews: APIFY_REMEDIATION_MAX_REVIEWS,
      minNonEmpty: GOOGLE_REVIEW_TEXT_MIN_NONEMPTY,
      criticalReviewCount: GOOGLE_REVIEW_CRITICAL_REVIEW_COUNT,
      criticalTextFloor: GOOGLE_REVIEW_CRITICAL_TEXT_FLOOR
    });
  }

  return next;
}

async storeRawData(contractorId, source, data) {
  const policyData = applySourceQualityPolicy(source, data);
  // persist policyData instead of data
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/test_collection_store_raw_data_policy.js`
Expected: PASS

**Step 5: Commit**

```bash
git add services/collection_service.js tests/unit/test_collection_store_raw_data_policy.js
git commit -m "fix: enforce source quality policy during raw-data persistence"
```

---

### Task 4: Tighten Source-Gate Rule Semantics (Google Presence Requires Success)

**Files:**
- Create: `services/source_gate_rules.js`
- Modify: `bin/source_missing_from_manifest.js`
- Create: `tests/unit/test_source_gate_rules.js`

**Step 1: Write the failing test**

```js
// tests/unit/test_source_gate_rules.js
const assert = require('assert');
const { evaluateRulesForContractor, DEFAULT_ALLOWED_STATUSES_BY_RULE } = require('../../services/source_gate_rules');

describe('source gate rules', () => {
  it('does not accept not_found for google_presence', () => {
    const rules = [{ key: 'google_presence', anyOf: ['google_maps_local', 'google_maps_hq'] }];
    const sourceStatus = { google_maps_local: new Set(['not_found']) };

    const failures = evaluateRulesForContractor(sourceStatus, rules, DEFAULT_ALLOWED_STATUSES_BY_RULE);
    assert.equal(failures.length, 1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/test_source_gate_rules.js`
Expected: FAIL because rule engine currently allows `not_found`

**Step 3: Write minimal implementation**

```js
// services/source_gate_rules.js
const DEFAULT_ALLOWED_STATUSES_BY_RULE = {
  google_presence: new Set(['success']),
  bbb: new Set(['success', 'not_found']),
  court_records: new Set(['success', 'not_found']),
  county_liens: new Set(['success', 'not_found']),
  tx_franchise: new Set(['success', 'not_found'])
};

function sourceSatisfiesForRule(ruleKey, statusSet, allowedByRule) {
  if (!statusSet || statusSet.size === 0) return false;
  const allowed = allowedByRule[ruleKey] || new Set(['success']);
  for (const status of statusSet) {
    if (allowed.has(status)) return true;
  }
  return false;
}

function evaluateRulesForContractor(sourceStatus, rules, allowedByRule = DEFAULT_ALLOWED_STATUSES_BY_RULE) {
  const failures = [];
  for (const rule of rules) {
    if (rule.anyOf) {
      const satisfied = rule.anyOf.some((src) =>
        sourceSatisfiesForRule(rule.key, sourceStatus?.[src], allowedByRule)
      );
      if (!satisfied) failures.push({ rule: rule.key, type: 'anyOf', required_any_of: rule.anyOf });
      continue;
    }
    if (rule.allOf) {
      const missing = rule.allOf.filter((src) =>
        !sourceSatisfiesForRule(rule.key, sourceStatus?.[src], allowedByRule)
      );
      if (missing.length) failures.push({ rule: rule.key, type: 'allOf', missing });
    }
  }
  return failures;
}

module.exports = { DEFAULT_ALLOWED_STATUSES_BY_RULE, evaluateRulesForContractor };
```

```js
// bin/source_missing_from_manifest.js (key change)
const { DEFAULT_ALLOWED_STATUSES_BY_RULE, evaluateRulesForContractor } = require('../services/source_gate_rules');
// remove global allowed-status logic for rule evaluation
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/test_source_gate_rules.js`
Expected: PASS

**Step 5: Commit**

```bash
git add services/source_gate_rules.js bin/source_missing_from_manifest.js tests/unit/test_source_gate_rules.js
git commit -m "fix: require success for google_presence in source gate"
```

---

### Task 5: Add Hard Review-Text Gate CLI

**Files:**
- Create: `bin/verify_review_text_gate.js`
- Create: `tests/unit/test_review_text_gate_logic.js`
- Modify: `services/source_quality_policy.js`

**Step 1: Write the failing test**

```js
// tests/unit/test_review_text_gate_logic.js
const assert = require('assert');
const { evaluateReviewTextGate } = require('../../services/source_quality_policy');

describe('review text gate', () => {
  it('fails when review_count>=50 but non-empty text <5', () => {
    const out = evaluateReviewTextGate({ review_count: 80, nonempty_reviews: 0 }, {
      minNonEmpty: 10,
      criticalReviewCount: 50,
      criticalTextFloor: 5
    });
    assert.equal(out.pass, false);
    assert(out.reasons.includes('high_reported_count_low_text'));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/test_review_text_gate_logic.js`
Expected: FAIL (`evaluateReviewTextGate` missing)

**Step 3: Write minimal implementation**

```js
// services/source_quality_policy.js
function evaluateReviewTextGate(metrics, policy) {
  const reviewCount = Number(metrics.review_count || 0);
  const nonempty = Number(metrics.nonempty_reviews || 0);
  const minNonEmpty = Number(policy.minNonEmpty || 10);
  const criticalReviewCount = Number(policy.criticalReviewCount || 50);
  const criticalTextFloor = Number(policy.criticalTextFloor || 5);

  const reasons = [];
  if (nonempty < minNonEmpty) reasons.push(`nonempty_below_${minNonEmpty}`);
  if (reviewCount >= criticalReviewCount && nonempty < criticalTextFloor) {
    reasons.push('high_reported_count_low_text');
  }

  return { pass: reasons.length === 0, reasons };
}

module.exports = { /* existing exports */, evaluateReviewTextGate };
```

```js
// bin/verify_review_text_gate.js (new)
#!/usr/bin/env node
const db = require('../services/db_pg');
const { summarizeGoogleReviewCoverage, evaluateReviewTextGate } = require('../services/source_quality_policy');

// parse --config, --min-nonempty, --critical-review-count, --critical-text-floor
// load manifest IDs
// query contractor_raw_data for google_maps_local structured_data
// compute metrics via summarizeGoogleReviewCoverage
// evaluate gate via evaluateReviewTextGate
// emit logs/review_text_gate_<timestamp>.json
// exit 1 if strict mode and failures > 0
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/test_review_text_gate_logic.js`
Expected: PASS

**Step 5: Commit**

```bash
git add services/source_quality_policy.js bin/verify_review_text_gate.js tests/unit/test_review_text_gate_logic.js
git commit -m "feat: add hard review text gate and evaluation logic"
```

---

### Task 6: Integrate Review-Text Gate into Progressive Pipeline Preflight

**Files:**
- Modify: `bin/hybrid_100_progressive_pipeline.js`
- Create: `tests/unit/test_pipeline_preflight_order.js`
- Create: `services/pipeline_preflight.js`

**Step 1: Write the failing test**

```js
// tests/unit/test_pipeline_preflight_order.js
const assert = require('assert');
const { buildPrepSteps } = require('../../services/pipeline_preflight');

describe('pipeline preflight order', () => {
  it('runs source gate before review-text gate before snapshot', () => {
    const steps = buildPrepSteps({ skipPrep: false, skipSource: false, skipSnapshot: false, skipFirstPass: false });
    assert.deepEqual(steps.map(s => s.name), [
      'source_missing_from_manifest',
      'verify_review_text_gate',
      'hybrid_100_snapshot',
      'hybrid_100_first_pass'
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/test_pipeline_preflight_order.js`
Expected: FAIL (`buildPrepSteps` missing)

**Step 3: Write minimal implementation**

```js
// services/pipeline_preflight.js
function buildPrepSteps(opts) {
  const out = [];
  if (!opts.skipPrep && !opts.skipSource) {
    out.push({ name: 'source_missing_from_manifest', script: 'bin/source_missing_from_manifest.js' });
    out.push({ name: 'verify_review_text_gate', script: 'bin/verify_review_text_gate.js' });
  }
  if (!opts.skipPrep && !opts.skipSnapshot) out.push({ name: 'hybrid_100_snapshot', script: 'bin/hybrid_100_snapshot.js' });
  if (!opts.skipPrep && !opts.skipFirstPass) out.push({ name: 'hybrid_100_first_pass', script: 'bin/hybrid_100_first_pass.js' });
  return out;
}

module.exports = { buildPrepSteps };
```

```js
// bin/hybrid_100_progressive_pipeline.js (key change)
const { buildPrepSteps } = require('../services/pipeline_preflight');
// use buildPrepSteps() and execute scripts in returned order
// include args for verify_review_text_gate:
// --config, --min-nonempty, --critical-review-count, --critical-text-floor
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/test_pipeline_preflight_order.js`
Expected: PASS

**Step 5: Commit**

```bash
git add services/pipeline_preflight.js bin/hybrid_100_progressive_pipeline.js tests/unit/test_pipeline_preflight_order.js
git commit -m "feat: add review-text gate to progressive preflight sequence"
```

---

### Task 7: Add One-Command Evidence Repair Runbook Script

**Files:**
- Create: `bin/run_review_evidence_repair.sh`
- Modify: `docs/README.md`
- Modify: `docs/QUICKREF.md`

**Step 1: Write the failing check**

Run: `bash -n bin/run_review_evidence_repair.sh`
Expected: FAIL (`No such file or directory`)

**Step 2: Add script**

```bash
#!/usr/bin/env bash
set -euo pipefail

CONFIG="${1:-experiments/hybrid_100_roof_A/config/sample_100_group_roof_A.json}"
MIN_NONEMPTY="${MIN_NONEMPTY:-10}"
CRITICAL_REVIEW_COUNT="${CRITICAL_REVIEW_COUNT:-50}"
CRITICAL_TEXT_FLOOR="${CRITICAL_TEXT_FLOOR:-5}"

source venv/bin/activate
set -a
. ./.env
set +a

node bin/source_missing_from_manifest.js --config="$CONFIG" --required=google_presence,bbb,court_records,county_liens,tx_franchise
node bin/verify_review_text_gate.js --config="$CONFIG" --min-nonempty="$MIN_NONEMPTY" --critical-review-count="$CRITICAL_REVIEW_COUNT" --critical-text-floor="$CRITICAL_TEXT_FLOOR"
node bin/apify_review_remediation.js --scope open --batch-size 10 --limit 10 --max-reviews 200 --min-nonempty "$MIN_NONEMPTY"
node bin/verify_review_text_gate.js --config="$CONFIG" --min-nonempty="$MIN_NONEMPTY" --critical-review-count="$CRITICAL_REVIEW_COUNT" --critical-text-floor="$CRITICAL_TEXT_FLOOR"
```

**Step 3: Update docs**

Document this script as the standard repair path before scoring.

**Step 4: Run checks**

Run:
```bash
bash -n bin/run_review_evidence_repair.sh
chmod +x bin/run_review_evidence_repair.sh
```

Expected: shell syntax OK and executable bit set.

**Step 5: Commit**

```bash
git add bin/run_review_evidence_repair.sh docs/README.md docs/QUICKREF.md
git commit -m "docs+ops: add one-command review evidence repair workflow"
```

---

### Task 8: End-to-End Verification and Safety Checks

**Files:**
- Modify: `docs/analysis/2026-02-18-pipeline-forensic-brief.md`
- Create: `docs/analysis/2026-02-17-evidence-quality-hardening-verification.md`

**Step 1: Write verification checklist (before running)**

```markdown
- Unit tests for new policy + gate modules pass.
- Source gate treats google_presence:not_found as fail.
- Review-text gate exits non-zero on weak evidence.
- Progressive pipeline invokes review-text gate before snapshot.
- Apify error-row payload returns found=false (no fake success).
```

**Step 2: Run verification commands**

```bash
npm test -- tests/unit/test_source_quality_policy.js
npm test -- tests/unit/test_apify_payload_guard.js
npm test -- tests/unit/test_collection_store_raw_data_policy.js
npm test -- tests/unit/test_source_gate_rules.js
npm test -- tests/unit/test_review_text_gate_logic.js
npm test -- tests/unit/test_pipeline_preflight_order.js

node bin/source_missing_from_manifest.js --config=experiments/hybrid_100_roof_A/config/sample_100_group_roof_A.json --verify-only
node bin/verify_review_text_gate.js --config=experiments/hybrid_100_roof_A/config/sample_100_group_roof_A.json --min-nonempty=10 --critical-review-count=50 --critical-text-floor=5
```

Expected:
- All unit tests PASS.
- Source gate summary clearly reports google_presence failures if only `not_found` rows exist.
- Review-text gate emits JSON report and fails appropriately when weak evidence remains.

**Step 3: Run dry pipeline preflight**

```bash
node bin/hybrid_100_progressive_pipeline.js --group=roof_A --config=experiments/hybrid_100_roof_A/config/sample_100_group_roof_A.json --dry-run --skip-first-pass
```

Expected: preflight logs show order: source gate -> review-text gate -> snapshot.

**Step 4: Write verification report**

Capture command outputs and pass/fail matrix in:
`docs/analysis/2026-02-17-evidence-quality-hardening-verification.md`

**Step 5: Commit**

```bash
git add docs/analysis/2026-02-18-pipeline-forensic-brief.md docs/analysis/2026-02-17-evidence-quality-hardening-verification.md
git commit -m "chore: verify evidence-quality hardening end-to-end"
```

---

## Rollout Sequence (Production)

1. Merge Tasks 1-6 first (policy + gates + pipeline preflight).
2. Run Task 7 script in controlled batches of 10.
3. Require review-text gate pass before any new snapshot/first-pass/swiss run.
4. Only then resume DeepSeek progressive comparisons.

---

## Success Criteria

1. No placeholder/login/not-found pages remain `fetch_status='success'` for placeholder-prone sources.
2. Apify error-only datasets never produce `found=true` rows.
3. `google_presence` rule cannot pass with `not_found`-only statuses.
4. Pipeline preflight fails fast when review-text gate fails.
5. For active scoring cohorts, review-text floor policy is enforced and measurable in gate reports.

---

## Risk Controls

1. Keep all new logic in shared policy modules to avoid drift.
2. Use strict fail-fast behavior (`exit 1`) for gate failures.
3. Preserve raw payloads in `structured_data` for forensics.
4. Do not rerun swiss scoring until gates pass.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-02-17-audit-evidence-quality-hardening.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
