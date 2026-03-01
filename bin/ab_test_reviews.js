#!/usr/bin/env node
/**
 * A/B Test: Review Collection Strategy Comparison
 *
 * Tests 30 contractors (10 small, 10 medium, 10 large review counts)
 * Runs both current and proposed strategies on each
 * Generates markdown report + JSON data
 *
 * Usage:
 *   node bin/ab_test_reviews.js [--dry-run] [--limit N] [--skip-audit]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Costs
const DEEPSEEK_AUDIT_COST = 0.003;

/**
 * Query contractors from database by size bucket
 */
async function queryContractors(size, limit = 10) {
  return new Promise((resolve, reject) => {
    const ranges = {
      small: [1, 20],
      medium: [21, 100],
      large: [101, 10000]
    };
    const [low, high] = ranges[size];

    const script = `
import django, os, json, random
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from contractors.models import Contractor

contractors = list(Contractor.objects.filter(
    google_review_count__gte=${low},
    google_review_count__lte=${high},
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
 * Run review collection with specified strategy
 */
async function runCollection(contractor, strategy) {
  return new Promise((resolve, reject) => {
    const location = `${contractor.city || 'Fort Worth'}, ${contractor.state || 'TX'}`;
    const args = [
      'scrapers/google_reviews_tiered.py',
      contractor.business_name,
      location,
      '--strategy', strategy
    ];

    const start = Date.now();
    const proc = spawn('python3', args, {
      cwd: process.cwd(),
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      const elapsed = Date.now() - start;
      try {
        // Find JSON in output
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: 'No JSON output', raw: stdout };
        result.collection_time_ms = elapsed;
        result.strategy = strategy;
        resolve(result);
      } catch (e) {
        resolve({
          error: e.message,
          strategy,
          collection_time_ms: elapsed,
          raw_stdout: stdout.substring(0, 500),
          raw_stderr: stderr.substring(0, 500)
        });
      }
    });

    proc.on('error', err => {
      resolve({ error: err.message, strategy, collection_time_ms: Date.now() - start });
    });
  });
}

/**
 * Run audit on contractor
 */
async function runAudit(contractorId, dryRun = false) {
  return new Promise((resolve, reject) => {
    const args = ['bin/run_audit.js', '--id', String(contractorId)];
    if (dryRun) args.push('--dry-run');

    const start = Date.now();
    const proc = spawn('node', args, {
      cwd: process.cwd(),
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => {
      stdout += d;
      // Print progress dots
      process.stdout.write('.');
    });
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      const elapsed = Date.now() - start;
      process.stdout.write('\n');

      // Parse trust score from output
      // NOTE: Must match "Internal Score" or "Trust Score", NOT "Review Analysis: Score"
      const scoreMatch = stdout.match(/Trust Score[:\s]+(\d+)/i) ||
                         stdout.match(/Internal Score[:\s]+(\d+)/i) ||
                         stdout.match(/"trust_score"[:\s]+(\d+)/i);
      const riskMatch = stdout.match(/Risk Level[:\s]+(\w+)/i) ||
                        stdout.match(/"risk_level"[:\s]+"(\w+)"/i);
      const verdictMatch = stdout.match(/Verdict[:\s]+(\w+)/i) ||
                           stdout.match(/"verdict"[:\s]+"([^"]+)"/i);

      resolve({
        trust_score: scoreMatch ? parseInt(scoreMatch[1]) : null,
        risk_level: riskMatch ? riskMatch[1] : null,
        verdict: verdictMatch ? verdictMatch[1] : null,
        audit_time_ms: elapsed,
        audit_cost: DEEPSEEK_AUDIT_COST,
        exit_code: code,
        error: code !== 0 ? `Exit code ${code}` : null
      });
    });

    proc.on('error', err => {
      resolve({
        error: err.message,
        audit_time_ms: Date.now() - start,
        audit_cost: 0
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
 * Append summary to experiment log
 */
function appendToExperimentLog(results, reportPath) {
  const experimentsPath = path.join(__dirname, '..', 'docs', 'EXPERIMENTS.md');

  // Calculate summary stats
  const totalReviews = results.reduce((sum, r) => sum + r.total_reviews, 0);
  const currentCollected = results.reduce((sum, r) => sum + (r.current?.actual_reviews || 0), 0);
  const proposedCollected = results.reduce((sum, r) => sum + (r.proposed?.actual_reviews || 0), 0);
  const currentCost = results.reduce((sum, r) => sum + (r.current?.collection_cost || 0) + (r.current?.audit_cost || 0), 0);
  const proposedCost = results.reduce((sum, r) => sum + (r.proposed?.collection_cost || 0) + (r.proposed?.audit_cost || 0), 0);

  const scoreDiffs = results.map(r => {
    const curr = r.current?.trust_score || 0;
    const prop = r.proposed?.trust_score || 0;
    return Math.abs(curr - prop);
  }).filter(d => d !== null);

  const avgDiff = scoreDiffs.length
    ? (scoreDiffs.reduce((a, b) => a + b, 0) / scoreDiffs.length).toFixed(1)
    : 'N/A';
  const maxDiff = scoreDiffs.length ? Math.max(...scoreDiffs) : 'N/A';
  const matchCount = scoreDiffs.filter(d => d === 0).length;

  const date = new Date().toISOString().split('T')[0];
  const costSavings = currentCost > 0 ? ((1 - proposedCost / currentCost) * 100).toFixed(1) : 'N/A';

  const entry = `
## ${date} | A/B Test: Review Collection Strategy
- **Type:** automated
- **Hypothesis:** 10% sample sufficient for accurate trust scoring
- **Method:** Tested ${results.length} contractors across size buckets
- **Results:**
  - Reviews: ${totalReviews} available, Current got ${currentCollected}, Proposed got ${proposedCollected}
  - Score match: ${matchCount}/${results.length} (${((matchCount / results.length) * 100).toFixed(0)}%)
  - Score variance: ${avgDiff} avg, ${maxDiff} max
  - Cost: $${currentCost.toFixed(2)} → $${proposedCost.toFixed(2)} (${costSavings}% savings)
- **Conclusion:** [FILL IN MANUALLY]
- **Details:** [Full Report](${reportPath})

---
`;

  fs.appendFileSync(experimentsPath, entry);
  console.log(`✅ Experiment logged: ${experimentsPath}`);
}

/**
 * Generate markdown report
 */
function generateMarkdownReport(results, timestamp) {
  // Calculate aggregates
  const bySize = { small: [], medium: [], large: [] };
  results.forEach(r => bySize[r.size_bucket].push(r));

  let totalCurrentCost = 0, totalProposedCost = 0;
  let scoreDiffs = [];
  let currentReviews = 0, proposedReviews = 0;

  results.forEach(r => {
    totalCurrentCost += (r.current.collection_cost || 0) + (r.current.audit_cost || 0);
    totalProposedCost += (r.proposed.collection_cost || 0) + (r.proposed.audit_cost || 0);
    currentReviews += r.current.actual_reviews || 0;
    proposedReviews += r.proposed.actual_reviews || 0;
    if (r.current.trust_score != null && r.proposed.trust_score != null) {
      scoreDiffs.push(Math.abs(r.current.trust_score - r.proposed.trust_score));
    }
  });

  const avgScoreDiff = scoreDiffs.length
    ? (scoreDiffs.reduce((a, b) => a + b, 0) / scoreDiffs.length).toFixed(1)
    : 'N/A';
  const maxScoreDiff = scoreDiffs.length ? Math.max(...scoreDiffs) : 'N/A';
  const costSavings = totalCurrentCost > 0
    ? ((1 - totalProposedCost / totalCurrentCost) * 100).toFixed(1)
    : 'N/A';

  const formatRow = (r) => {
    const name = (r.contractor_name || 'Unknown').substring(0, 25);
    const cScore = r.current.trust_score != null ? r.current.trust_score : 'ERR';
    const pScore = r.proposed.trust_score != null ? r.proposed.trust_score : 'ERR';
    const diff = (cScore !== 'ERR' && pScore !== 'ERR') ? Math.abs(cScore - pScore) : '-';
    const cCost = ((r.current.collection_cost || 0) + (r.current.audit_cost || 0)).toFixed(3);
    const pCost = ((r.proposed.collection_cost || 0) + (r.proposed.audit_cost || 0)).toFixed(3);
    const cRevs = r.current.actual_reviews || 0;
    const pRevs = r.proposed.actual_reviews || 0;
    return `| ${name.padEnd(25)} | ${r.total_reviews} | ${cRevs} | ${pRevs} | ${cScore} | ${pScore} | ${diff} | $${cCost} | $${pCost} |`;
  };

  return `# A/B Test Results: Review Collection Strategy

**Date:** ${timestamp}
**Contractors Tested:** ${results.length}

## Summary

| Metric | Current | Proposed | Diff |
|--------|---------|----------|------|
| Total Cost | $${totalCurrentCost.toFixed(2)} | $${totalProposedCost.toFixed(2)} | **-${costSavings}%** |
| Total Reviews Collected | ${currentReviews} | ${proposedReviews} | ${proposedReviews - currentReviews} |
| Avg Score Difference | - | - | ${avgScoreDiff} points |
| Max Score Difference | - | - | ${maxScoreDiff} points |

## Interpretation

${parseFloat(avgScoreDiff) <= 5 ? '✅ **Score variance is acceptable** (≤5 points average)' : '⚠️ **Score variance is high** (>5 points average) - review individual cases'}

${parseFloat(costSavings) >= 50 ? '✅ **Cost savings are significant** (≥50%)' : '⚠️ **Cost savings are modest** (<50%)'}

## Results by Size

### Small (0-20 reviews)
| Contractor | Total | Current Revs | Proposed Revs | Current Score | Proposed Score | Diff | Current Cost | Proposed Cost |
|------------|-------|--------------|---------------|---------------|----------------|------|--------------|---------------|
${bySize.small.map(formatRow).join('\n')}

### Medium (21-100 reviews)
| Contractor | Total | Current Revs | Proposed Revs | Current Score | Proposed Score | Diff | Current Cost | Proposed Cost |
|------------|-------|--------------|---------------|---------------|----------------|------|--------------|---------------|
${bySize.medium.map(formatRow).join('\n')}

### Large (100+ reviews)
| Contractor | Total | Current Revs | Proposed Revs | Current Score | Proposed Score | Diff | Current Cost | Proposed Cost |
|------------|-------|--------------|---------------|---------------|----------------|------|--------------|---------------|
${bySize.large.map(formatRow).join('\n')}

## Recommendation

${parseFloat(avgScoreDiff) <= 5 && parseFloat(costSavings) >= 50
  ? '**ADOPT PROPOSED STRATEGY** - Score quality maintained with significant cost reduction.'
  : parseFloat(avgScoreDiff) <= 5
  ? '**CONSIDER ADOPTION** - Score quality maintained but cost savings are modest.'
  : '**NEEDS REVIEW** - Score variance is higher than expected. Review individual cases before deciding.'}

---
*Generated by ab_test_reviews.js on ${new Date().toISOString()}*
`;
}

/**
 * Main test runner
 */
async function runTest(options = {}) {
  const { dryRun = false, limit = 10, skipAudit = false } = options;

  console.log('═'.repeat(60));
  console.log('  A/B Test: Review Collection Strategy Comparison');
  console.log('═'.repeat(60));
  console.log(`\nOptions: limit=${limit}, dryRun=${dryRun}, skipAudit=${skipAudit}\n`);

  // Sample contractors
  console.log('Sampling contractors from database...\n');
  let small, medium, large;
  try {
    small = await queryContractors('small', limit);
    medium = await queryContractors('medium', limit);
    large = await queryContractors('large', limit);
  } catch (e) {
    console.error('Failed to query contractors:', e.message);
    process.exit(1);
  }

  const contractors = [...small, ...medium, ...large];

  console.log(`Selected ${contractors.length} contractors:`);
  console.log(`  Small (0-20 reviews):   ${small.length}`);
  console.log(`  Medium (21-100 reviews): ${medium.length}`);
  console.log(`  Large (100+ reviews):    ${large.length}\n`);

  if (dryRun) {
    console.log('DRY RUN - would test these contractors:\n');
    contractors.forEach(c => {
      const size = c.google_review_count <= 20 ? 'small' : c.google_review_count <= 100 ? 'medium' : 'large';
      console.log(`  [${size.padEnd(6)}] ID ${c.id}: ${c.business_name} (${c.google_review_count} reviews)`);
    });
    return;
  }

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < contractors.length; i++) {
    const c = contractors[i];
    const size = c.google_review_count <= 20 ? 'small' : c.google_review_count <= 100 ? 'medium' : 'large';

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[${i + 1}/${contractors.length}] ${c.business_name}`);
    console.log(`  ID: ${c.id} | Reviews: ${c.google_review_count} | Size: ${size}`);
    console.log('─'.repeat(60));

    // Run CURRENT strategy
    console.log('\n  📊 CURRENT strategy (Serper + SerpAPI if >50)...');
    const currentCollection = await runCollection(c, 'current');
    console.log(`     Reviews: ${currentCollection.metrics?.actual_reviews || '?'} | Cost: $${currentCollection.collection_cost || '?'}`);

    let currentAudit = { trust_score: null, audit_cost: 0 };
    if (!skipAudit) {
      console.log('     Running audit');
      currentAudit = await runAudit(c.id, true); // dry-run to not save
      console.log(`     Score: ${currentAudit.trust_score || 'ERR'}`);
    }

    // Wait to avoid rate limiting
    await sleep(3000);

    // Run PROPOSED strategy
    console.log('\n  📊 PROPOSED strategy (10% or 10 min)...');
    const proposedCollection = await runCollection(c, 'proposed');
    console.log(`     Reviews: ${proposedCollection.metrics?.actual_reviews || '?'} | Cost: $${proposedCollection.collection_cost || '?'}`);

    let proposedAudit = { trust_score: null, audit_cost: 0 };
    if (!skipAudit) {
      console.log('     Running audit');
      proposedAudit = await runAudit(c.id, true); // dry-run to not save
      console.log(`     Score: ${proposedAudit.trust_score || 'ERR'}`);
    }

    // Store results
    results.push({
      contractor_id: c.id,
      contractor_name: c.business_name,
      total_reviews: c.google_review_count,
      size_bucket: size,
      current: {
        ...currentCollection.metrics,
        collection_cost: currentCollection.collection_cost || 0,
        collection_time_ms: currentCollection.collection_time_ms,
        trust_score: currentAudit.trust_score,
        audit_time_ms: currentAudit.audit_time_ms,
        audit_cost: currentAudit.audit_cost || 0,
        error: currentCollection.error || currentAudit.error
      },
      proposed: {
        ...proposedCollection.metrics,
        collection_cost: proposedCollection.collection_cost || 0,
        collection_time_ms: proposedCollection.collection_time_ms,
        trust_score: proposedAudit.trust_score,
        audit_time_ms: proposedAudit.audit_time_ms,
        audit_cost: proposedAudit.audit_cost || 0,
        error: proposedCollection.error || proposedAudit.error
      }
    });

    // Progress summary
    const cScore = currentAudit.trust_score;
    const pScore = proposedAudit.trust_score;
    const scoreDiff = (cScore != null && pScore != null) ? Math.abs(cScore - pScore) : '?';
    const costSavings = ((currentCollection.collection_cost || 0) - (proposedCollection.collection_cost || 0)).toFixed(3);

    console.log(`\n  Summary: Score diff=${scoreDiff}, Cost savings=$${costSavings}`);

    // Wait between contractors
    await sleep(2000);
  }

  // Generate reports
  const timestamp = new Date().toISOString().split('T')[0];
  const jsonPath = `docs/analysis/review-strategy-ab-test-${timestamp}.json`;
  const mdPath = `docs/analysis/review-strategy-ab-test-${timestamp}.md`;

  // Save JSON
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`\n✅ JSON saved: ${jsonPath}`);

  // Save markdown
  const mdContent = generateMarkdownReport(results, timestamp);
  fs.writeFileSync(mdPath, mdContent);
  console.log(`✅ Markdown saved: ${mdPath}`);

  // Append to experiment log
  appendToExperimentLog(results, `analysis/review-strategy-ab-test-${timestamp}.md`);

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
const skipAudit = args.includes('--skip-audit');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 10;

if (args.includes('--help')) {
  console.log(`
A/B Test: Review Collection Strategy Comparison

Usage:
  node bin/ab_test_reviews.js [options]

Options:
  --dry-run     Show selected contractors without running tests
  --limit N     Number of contractors per size bucket (default: 10)
  --skip-audit  Only test collection, skip audit step
  --help        Show this help

Examples:
  node bin/ab_test_reviews.js --dry-run           # Preview contractors
  node bin/ab_test_reviews.js --limit 3           # Pilot test (9 total)
  node bin/ab_test_reviews.js --limit 10          # Full test (30 total)
  node bin/ab_test_reviews.js --skip-audit        # Collection only
`);
  process.exit(0);
}

runTest({ dryRun, limit, skipAudit }).catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
