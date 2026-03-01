#!/usr/bin/env node
/**
 * A/B Test: Review Analysis Impact on Audit Scores
 *
 * Tests whether review analysis changes audit outcomes.
 * For each contractor:
 *   1. Run audit WITHOUT review_analysis data
 *   2. Run audit WITH review_analysis (100 reviews)
 * Compare scores to measure impact.
 *
 * Usage:
 *   node bin/ab_test_review_analysis.js [--limit N] [--dry-run]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Costs
const DEEPSEEK_AUDIT_COST = 0.003;
const REVIEW_ANALYSIS_COST = 0.0006;

/**
 * Query large contractors (100+ reviews) from database
 */
async function queryLargeContractors(limit = 10) {
  return new Promise((resolve, reject) => {
    const script = `
import django, os, json, random
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from contractors.models import Contractor

contractors = list(Contractor.objects.filter(
    google_review_count__gte=100,
    is_active=True
).values('id', 'business_name', 'city', 'state', 'google_review_count'))

# Shuffle and limit
random.shuffle(contractors)
result = contractors[:${limit}]
print(json.dumps(result))
`;
    const proc = spawn('python3', ['-c', script], { cwd: process.cwd() });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code !== 0) {
        console.error('Query stderr:', stderr);
        reject(new Error(`Query failed: ${code}`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(new Error(`Failed to parse: ${stdout}`));
        }
      }
    });
  });
}

/**
 * Delete review_analysis from raw_data for a contractor
 */
async function deleteReviewAnalysis(contractorId) {
  return new Promise((resolve, reject) => {
    const script = `
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from django.db import connection

with connection.cursor() as cursor:
    cursor.execute(
        "DELETE FROM contractor_raw_data WHERE contractor_id = %s AND source_name = 'review_analysis'",
        [${contractorId}]
    )
    print(f"Deleted {cursor.rowcount} review_analysis rows")
`;
    const proc = spawn('python3', ['-c', script], { cwd: process.cwd() });
    let stdout = '';
    proc.stdout.on('data', d => stdout += d);
    proc.on('close', code => {
      resolve({ deleted: code === 0, output: stdout.trim() });
    });
  });
}

/**
 * Run collection with 100 reviews
 */
async function runCollection(contractor) {
  return new Promise((resolve, reject) => {
    const args = ['bin/batch_collect.js', '--id', String(contractor.id), '--force'];

    const start = Date.now();
    const proc = spawn('node', args, {
      cwd: process.cwd(),
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => {
      stdout += d;
      process.stdout.write('.');
    });
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      const elapsed = Date.now() - start;
      process.stdout.write('\n');
      resolve({
        success: code === 0,
        collection_time_ms: elapsed,
        exit_code: code
      });
    });
  });
}

/**
 * Run audit on contractor
 */
async function runAudit(contractorId) {
  return new Promise((resolve, reject) => {
    const args = ['bin/run_audit.js', '--id', String(contractorId), '--skip-collection'];

    const start = Date.now();
    const proc = spawn('node', args, {
      cwd: process.cwd(),
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => {
      stdout += d;
      process.stdout.write('.');
    });
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      const elapsed = Date.now() - start;
      process.stdout.write('\n');

      // Parse trust score from output
      const scoreMatch = stdout.match(/Trust Score[:\s]+(\d+)/i) ||
                         stdout.match(/Internal Score[:\s]+(\d+)/i) ||
                         stdout.match(/"trust_score"[:\s]+(\d+)/i);
      const verdictMatch = stdout.match(/Verdict[:\s]+(\w+)/i) ||
                           stdout.match(/"verdict"[:\s]+"([^"]+)"/i);
      const reviewAnalysisMatch = stdout.match(/Review Analysis.*Score[:\s]+(\d+)\/100/i);

      resolve({
        trust_score: scoreMatch ? parseInt(scoreMatch[1]) : null,
        verdict: verdictMatch ? verdictMatch[1] : null,
        review_analysis_score: reviewAnalysisMatch ? parseInt(reviewAnalysisMatch[1]) : null,
        audit_time_ms: elapsed,
        audit_cost: DEEPSEEK_AUDIT_COST,
        exit_code: code,
        error: code !== 0 ? `Exit code ${code}` : null
      });
    });
  });
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate markdown report
 */
function generateMarkdownReport(results, timestamp) {
  let totalWithScore = 0, totalWithoutScore = 0;
  let scoreDiffs = [];
  let verdictChanges = 0;

  results.forEach(r => {
    if (r.without_review.trust_score != null) totalWithoutScore += r.without_review.trust_score;
    if (r.with_review.trust_score != null) totalWithScore += r.with_review.trust_score;
    if (r.without_review.trust_score != null && r.with_review.trust_score != null) {
      scoreDiffs.push(r.with_review.trust_score - r.without_review.trust_score);
    }
    if (r.without_review.verdict !== r.with_review.verdict) verdictChanges++;
  });

  const avgDiff = scoreDiffs.length
    ? (scoreDiffs.reduce((a, b) => a + b, 0) / scoreDiffs.length).toFixed(1)
    : 'N/A';
  const maxIncrease = scoreDiffs.length ? Math.max(...scoreDiffs) : 'N/A';
  const maxDecrease = scoreDiffs.length ? Math.min(...scoreDiffs) : 'N/A';

  const formatRow = (r) => {
    const name = (r.contractor_name || 'Unknown').substring(0, 30);
    const wout = r.without_review.trust_score ?? 'ERR';
    const with_ = r.with_review.trust_score ?? 'ERR';
    const diff = (wout !== 'ERR' && with_ !== 'ERR') ? (with_ - wout) : '-';
    const diffStr = typeof diff === 'number' ? (diff >= 0 ? `+${diff}` : String(diff)) : diff;
    const raScore = r.with_review.review_analysis_score ?? '-';
    const verdictChange = r.without_review.verdict !== r.with_review.verdict ? '⚠️' : '';
    return `| ${name.padEnd(30)} | ${r.total_reviews} | ${wout} | ${with_} | ${diffStr} | ${raScore} | ${verdictChange} |`;
  };

  return `# A/B Test Results: Review Analysis Impact

**Date:** ${timestamp}
**Contractors Tested:** ${results.length}
**All contractors:** 100+ Google reviews

## Summary

| Metric | Value |
|--------|-------|
| Contractors Tested | ${results.length} |
| Avg Score Change (with review analysis) | ${avgDiff} points |
| Max Score Increase | ${maxIncrease} points |
| Max Score Decrease | ${maxDecrease} points |
| Verdict Changes | ${verdictChanges} |

## Interpretation

${Math.abs(parseFloat(avgDiff)) <= 3 ? '✅ **Review analysis has minimal impact** on scores (≤3 points avg)' : '⚠️ **Review analysis significantly impacts scores** (>3 points avg)'}

${verdictChanges > 0 ? `⚠️ **${verdictChanges} verdict changes** - review analysis affects recommendations` : '✅ **No verdict changes** - review analysis doesn\'t change recommendations'}

## Results

| Contractor | Reviews | Without RA | With RA | Diff | RA Score | Changed? |
|------------|---------|------------|---------|------|----------|----------|
${results.map(formatRow).join('\n')}

## Analysis

### Score Distribution
- Without Review Analysis: Avg ${(totalWithoutScore / results.length).toFixed(1)}
- With Review Analysis: Avg ${(totalWithScore / results.length).toFixed(1)}

### What This Means
- **Positive diff**: Review analysis INCREASED trust (reviews support the contractor)
- **Negative diff**: Review analysis DECREASED trust (reviews reveal issues)
- **RA Score**: The fake review score from review analyzer (higher = more suspicious)

---
*Generated by ab_test_review_analysis.js on ${new Date().toISOString()}*
`;
}

/**
 * Append to experiment log
 */
function appendToExperimentLog(results, reportPath) {
  const experimentsPath = path.join(__dirname, '..', 'docs', 'EXPERIMENTS.md');

  const scoreDiffs = results.map(r => {
    const wout = r.without_review?.trust_score || 0;
    const with_ = r.with_review?.trust_score || 0;
    return with_ - wout;
  }).filter(d => d !== null);

  const avgDiff = scoreDiffs.length
    ? (scoreDiffs.reduce((a, b) => a + b, 0) / scoreDiffs.length).toFixed(1)
    : 'N/A';
  const verdictChanges = results.filter(r =>
    r.without_review?.verdict !== r.with_review?.verdict
  ).length;

  const date = new Date().toISOString().split('T')[0];

  const entry = `
## ${date} | A/B Test: Review Analysis Impact
- **Type:** automated
- **Hypothesis:** Review analysis (100 reviews) changes audit scores
- **Method:** Tested ${results.length} large contractors (100+ reviews), ran audit without then with review analysis
- **Results:**
  - Avg score change: ${avgDiff} points
  - Verdict changes: ${verdictChanges}/${results.length}
- **Conclusion:** [FILL IN MANUALLY]
- **Details:** [Full Report](${reportPath})

---
`;

  fs.appendFileSync(experimentsPath, entry);
  console.log(`✅ Experiment logged: ${experimentsPath}`);
}

/**
 * Main test runner
 */
async function runTest(options = {}) {
  const { dryRun = false, limit = 10 } = options;

  console.log('═'.repeat(60));
  console.log('  A/B Test: Review Analysis Impact on Audit Scores');
  console.log('═'.repeat(60));
  console.log(`\nOptions: limit=${limit}, dryRun=${dryRun}\n`);

  // Sample contractors
  console.log('Sampling large contractors (100+ reviews) from database...\n');
  let contractors;
  try {
    contractors = await queryLargeContractors(limit);
  } catch (e) {
    console.error('Failed to query contractors:', e.message);
    process.exit(1);
  }

  console.log(`Selected ${contractors.length} contractors:\n`);
  contractors.forEach(c => {
    console.log(`  ID ${c.id}: ${c.business_name} (${c.google_review_count} reviews)`);
  });

  if (dryRun) {
    console.log('\nDRY RUN - would test these contractors');
    return;
  }

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < contractors.length; i++) {
    const c = contractors[i];

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[${i + 1}/${contractors.length}] ${c.business_name}`);
    console.log(`  ID: ${c.id} | Reviews: ${c.google_review_count}`);
    console.log('─'.repeat(60));

    // Step 1: Run collection (gets 100 reviews + review analysis)
    console.log('\n  📥 Running collection (100 reviews)...');
    const collection = await runCollection(c);
    console.log(`     Collection: ${collection.success ? 'Success' : 'Failed'}`);

    if (!collection.success) {
      console.log('     Skipping - collection failed');
      continue;
    }

    // Step 2: Run audit WITH review analysis
    console.log('\n  📊 Audit WITH review analysis...');
    const withReview = await runAudit(c.id);
    console.log(`     Score: ${withReview.trust_score || 'ERR'} | Verdict: ${withReview.verdict || 'ERR'}`);
    if (withReview.review_analysis_score != null) {
      console.log(`     Review Analysis Score: ${withReview.review_analysis_score}/100`);
    }

    await sleep(2000);

    // Step 3: Delete review_analysis data
    console.log('\n  🗑️  Removing review_analysis...');
    const deleted = await deleteReviewAnalysis(c.id);
    console.log(`     ${deleted.output}`);

    // Step 4: Run audit WITHOUT review analysis
    console.log('\n  📊 Audit WITHOUT review analysis...');
    const withoutReview = await runAudit(c.id);
    console.log(`     Score: ${withoutReview.trust_score || 'ERR'} | Verdict: ${withoutReview.verdict || 'ERR'}`);

    // Calculate difference
    const diff = (withReview.trust_score != null && withoutReview.trust_score != null)
      ? withReview.trust_score - withoutReview.trust_score
      : null;
    const diffStr = diff != null ? (diff >= 0 ? `+${diff}` : String(diff)) : '?';

    console.log(`\n  📈 Impact: ${diffStr} points`);
    if (withReview.verdict !== withoutReview.verdict) {
      console.log(`  ⚠️  Verdict changed: ${withoutReview.verdict} → ${withReview.verdict}`);
    }

    results.push({
      contractor_id: c.id,
      contractor_name: c.business_name,
      total_reviews: c.google_review_count,
      without_review: withoutReview,
      with_review: withReview,
      score_diff: diff
    });

    // Wait between contractors
    await sleep(3000);
  }

  // Generate reports
  const timestamp = new Date().toISOString().split('T')[0];
  const jsonPath = `docs/analysis/review-analysis-impact-${timestamp}.json`;
  const mdPath = `docs/analysis/review-analysis-impact-${timestamp}.md`;

  // Save JSON
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`\n✅ JSON saved: ${jsonPath}`);

  // Save markdown
  const mdContent = generateMarkdownReport(results, timestamp);
  fs.writeFileSync(mdPath, mdContent);
  console.log(`✅ Markdown saved: ${mdPath}`);

  // Append to experiment log
  appendToExperimentLog(results, `analysis/review-analysis-impact-${timestamp}.md`);

  // Print summary
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  TEST COMPLETE');
  console.log('═'.repeat(60));
  console.log(`  Duration: ${totalTime} minutes`);
  console.log(`  Results:  ${jsonPath}`);
  console.log(`  Report:   ${mdPath}`);
  console.log('═'.repeat(60));
}

// CLI
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 10;

if (args.includes('--help')) {
  console.log(`
A/B Test: Review Analysis Impact on Audit Scores

Tests whether having review analysis (100 reviews analyzed) changes audit outcomes.

Usage:
  node bin/ab_test_review_analysis.js [options]

Options:
  --dry-run     Show selected contractors without running tests
  --limit N     Number of contractors to test (default: 10)
  --help        Show this help

Process for each contractor:
  1. Run full collection (100 reviews + review analysis)
  2. Run audit WITH review_analysis data → Score A
  3. Delete review_analysis from database
  4. Run audit WITHOUT review_analysis data → Score B
  5. Compare Score A vs Score B

Examples:
  node bin/ab_test_review_analysis.js --dry-run     # Preview contractors
  node bin/ab_test_review_analysis.js --limit 5     # Quick test (5 contractors)
  node bin/ab_test_review_analysis.js --limit 10    # Full test (10 contractors)
`);
  process.exit(0);
}

runTest({ dryRun, limit }).catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
