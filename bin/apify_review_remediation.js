#!/usr/bin/env node
/**
 * Google review remediation runner (DataForSEO lane).
 *
 * Policy:
 * - If review_count <= max_reviews, all reviews must be stored in full.
 * - If review_count > max_reviews, store the most recent max_reviews in full.
 * - Minimum non-empty review text gate is enforced.
 *
 * Usage:
 *   node bin/apify_review_remediation.js
 *   node bin/apify_review_remediation.js --scope open --batch-size 10 --limit 10
 *   node bin/apify_review_remediation.js --scope open --batch-size 10 --limit 10 --sort high-review
 *   node bin/apify_review_remediation.js --scope scored --batch-size 10 --limit 50
 *   node bin/apify_review_remediation.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db_pg');
const { CollectionService } = require('../services/collection_service');

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const direct = args.find((a) => a.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function extractReviewText(review) {
  if (!review || typeof review !== 'object') return '';
  return String(review.text ?? review.review_text ?? review.content ?? '').trim();
}

function countNonEmptyReviewTexts(reviews) {
  if (!Array.isArray(reviews)) return 0;
  let count = 0;
  for (const review of reviews) {
    if (extractReviewText(review)) count += 1;
  }
  return count;
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function summarizeCoverage(result, maxReviews, minNonEmpty) {
  const reviews = Array.isArray(result?.reviews) ? result.reviews : [];
  const fetchedReviews = reviews.length;
  const nonemptyReviews = countNonEmptyReviewTexts(reviews);
  const reviewCount = Math.max(0, toFiniteNumber(result?.review_count, fetchedReviews));
  const reviewCountForRule = reviewCount > 0 ? reviewCount : fetchedReviews;

  const reasons = [];
  if (!result?.found) reasons.push('not_found');
  if (nonemptyReviews < minNonEmpty) reasons.push(`nonempty_below_${minNonEmpty}`);
  if (reviewCountForRule > 0 && reviewCountForRule <= maxReviews && fetchedReviews < reviewCountForRule) {
    reasons.push('incomplete_full_capture_for_small_listing');
  }
  if (reviewCountForRule >= 50 && nonemptyReviews < 5) {
    reasons.push('high_reported_count_low_text');
  }

  return {
    review_count: reviewCountForRule,
    fetched_reviews: fetchedReviews,
    nonempty_reviews: nonemptyReviews,
    full_capture_required: reviewCountForRule > 0 && reviewCountForRule <= maxReviews,
    full_capture_satisfied: !(reviewCountForRule > 0 && reviewCountForRule <= maxReviews && fetchedReviews < reviewCountForRule),
    needs_remediation: reasons.length > 0,
    reasons
  };
}

function loadCompletedBatchIds() {
  const configFiles = [
    'experiments/hybrid_100/config/sample_100.json',
    'experiments/hybrid_100_B/config/sample_100_group_B.json',
    'experiments/hybrid_100_C/config/sample_100_group_C.json',
    'experiments/hybrid_100_D/config/sample_100_group_D.json',
    'experiments/hybrid_100_E/config/sample_100_group_E.json',
    'experiments/hybrid_100_F/config/sample_100_group_F.json',
    'experiments/hybrid_100_G/config/sample_100_group_G.json',
    'experiments/hybrid_100_H/config/sample_100_group_H.json'
  ];

  const ids = new Set();
  for (const relPath of configFiles) {
    const filePath = path.join(process.cwd(), relPath);
    if (!fs.existsSync(filePath)) continue;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    for (const contractor of parsed.contractors || []) {
      const id = Number(contractor.id || contractor.contractor_id);
      if (Number.isFinite(id)) ids.add(id);
    }
  }
  return ids;
}

async function loadCandidates({ category, scope, limit, maxReviews, minNonEmpty, contractorId, sortMode }) {
  const rows = await db.exec(`
    SELECT
      c.id,
      c.business_name,
      c.city,
      c.state,
      c.trust_score,
      c.category,
      crd.fetch_status,
      crd.fetched_at,
      crd.structured_data
    FROM contractors_contractor c
    LEFT JOIN contractor_raw_data crd
      ON crd.contractor_id = c.id
     AND crd.source_name = 'google_maps_local'
    WHERE c.category = $1
    ORDER BY crd.fetched_at DESC NULLS LAST, c.id ASC
  `, [category]);

  const completedIds = loadCompletedBatchIds();
  const filtered = [];

  for (const row of rows) {
    if (contractorId && row.id !== contractorId) continue;
    if (scope === 'open' && completedIds.has(row.id)) continue;
    if (scope === 'scored' && !(row.trust_score > 0)) continue;
    if (scope === 'unscored' && !(row.trust_score === 0)) continue;

    let structured = null;
    try {
      structured = row.structured_data
        ? (typeof row.structured_data === 'string' ? JSON.parse(row.structured_data) : row.structured_data)
        : null;
    } catch (_) {
      structured = null;
    }

    const baseline = row.fetch_status === 'success'
      ? (structured || { found: false, reviews: [], review_count: 0 })
      : { found: false, reviews: [], review_count: 0 };

    const coverage = summarizeCoverage(baseline, maxReviews, minNonEmpty);
    if (!coverage.needs_remediation) continue;

    filtered.push({
      ...row,
      baseline,
      coverage
    });
  }

  if (sortMode === 'high-review') {
    filtered.sort((a, b) => {
      const reviewDiff = (b.coverage?.review_count || 0) - (a.coverage?.review_count || 0);
      if (reviewDiff !== 0) return reviewDiff;

      const nonemptyDiff = (a.coverage?.nonempty_reviews || 0) - (b.coverage?.nonempty_reviews || 0);
      if (nonemptyDiff !== 0) return nonemptyDiff;

      return a.id - b.id;
    });
  }

  return filtered.slice(0, limit);
}

function printBatchHeader(batchNumber, batchSize, total) {
  console.log(`\n=== Batch ${batchNumber} (${batchSize} remediation(s), total target=${total}) ===`);
}

function printResult(candidate, remediation) {
  const before = remediation.before || {};
  const after = remediation.after || {};
  const status = remediation.updated ? 'UPDATED' : (remediation.skipped ? 'SKIPPED' : 'FAILED');
  console.log(
    `[${status}] ID ${candidate.id} ${candidate.business_name} | before nonempty=${before.nonempty_reviews || 0}/${before.fetched_reviews || 0} (count=${before.review_count || 0}) | after nonempty=${after.nonempty_reviews || 0}/${after.fetched_reviews || 0} (count=${after.review_count || 0})`
  );
  if (!remediation.updated && (remediation.reason || remediation.error)) {
    console.log(`  reason: ${remediation.reason || remediation.error}`);
  }
}

async function main() {
  const scope = String(getArg('--scope', 'open')).toLowerCase();
  const category = getArg('--category', 'Pool');
  const batchSize = Math.max(1, parseInt(getArg('--batch-size', '10'), 10));
  const limit = Math.max(1, parseInt(getArg('--limit', String(batchSize)), 10));
  const maxReviews = Math.max(1, parseInt(getArg('--max-reviews', '200'), 10));
  const minNonEmpty = Math.max(1, parseInt(getArg('--min-nonempty', '10'), 10));
  const contractorId = getArg('--id', null) ? parseInt(getArg('--id', null), 10) : null;
  const sortMode = String(getArg('--sort', 'recent')).toLowerCase();
  const dryRun = hasFlag('--dry-run');
  const force = hasFlag('--force');
  const rerunReviewAnalysis = !hasFlag('--skip-review-analysis');

  if (!['open', 'scored', 'unscored', 'all'].includes(scope)) {
    throw new Error(`Invalid --scope "${scope}". Use: open|scored|unscored|all`);
  }
  if (!['recent', 'high-review'].includes(sortMode)) {
    throw new Error(`Invalid --sort "${sortMode}". Use: recent|high-review`);
  }

  console.log('Google review remediation policy (provider=DataForSEO)');
  console.log(`  scope=${scope} category=${category} batch_size=${batchSize} limit=${limit} sort=${sortMode}`);
  console.log(`  max_reviews=${maxReviews} min_nonempty=${minNonEmpty} dry_run=${dryRun} force=${force}`);

  const candidates = await loadCandidates({
    category,
    scope,
    limit,
    maxReviews,
    minNonEmpty,
    contractorId,
    sortMode
  });

  if (candidates.length === 0) {
    console.log('No remediation candidates found for current filter.');
    return;
  }

  console.log(`Candidates selected: ${candidates.length}`);

  if (dryRun) {
    for (const candidate of candidates) {
      console.log(
        `[DRY] ID ${candidate.id} ${candidate.business_name} | nonempty=${candidate.coverage.nonempty_reviews}/${candidate.coverage.fetched_reviews} count=${candidate.coverage.review_count} reasons=${candidate.coverage.reasons.join(',')}`
      );
    }
    return;
  }

  const service = new CollectionService(db);
  let totalUpdated = 0;
  let totalFailures = 0;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    printBatchHeader(batchNumber, batch.length, candidates.length);

    let batchFailures = 0;
    let batchUpdated = 0;

    for (const candidate of batch) {
      const contractor = {
        id: candidate.id,
        name: candidate.business_name,
        business_name: candidate.business_name,
        city: candidate.city,
        state: candidate.state
      };

      let remediation = null;
      try {
        remediation = await service.remediateGoogleMapsLocalSource(candidate.id, contractor, {
          maxReviews,
          minNonEmpty,
          force,
          rerunReviewAnalysis
        });
      } catch (err) {
        remediation = {
          updated: false,
          skipped: false,
          reason: 'exception',
          error: err.message,
          before: candidate.coverage,
          after: candidate.coverage
        };
      }

      printResult(candidate, remediation);

      const after = remediation.after || {};
      const invariantPass = remediation.updated &&
        !after.needs_remediation &&
        (!after.full_capture_required || after.full_capture_satisfied);

      if (!invariantPass) {
        batchFailures += 1;
      } else {
        batchUpdated += 1;
      }
    }

    totalUpdated += batchUpdated;
    totalFailures += batchFailures;

    const batchPassRate = ((batchUpdated / batch.length) * 100).toFixed(1);
    console.log(`Batch ${batchNumber} result: ${batchUpdated}/${batch.length} passed (${batchPassRate}%)`);

    if (batchFailures > 0) {
      console.error(`Batch ${batchNumber} failed invariant checks. Stopping immediately.`);
      process.exitCode = 1;
      break;
    }
  }

  console.log('\n=== Remediation Summary ===');
  console.log(`Updated/Passed: ${totalUpdated}`);
  console.log(`Failures: ${totalFailures}`);
  if (totalFailures === 0) {
    console.log('All processed batches passed at 100%.');
  }
}

main()
  .catch((err) => {
    console.error(`Fatal error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
