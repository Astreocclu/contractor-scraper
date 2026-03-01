#!/usr/bin/env node
/**
 * Batch Audit Runner
 *
 * Runs forensic audits on multiple contractors sequentially with:
 * - Blocking execution (one at a time)
 * - State persistence for resumability
 * - Graceful shutdown handling
 * - Cost tracking
 * - Separate bucket for review analysis failures
 */

const fs = require('fs');
const path = require('path');
const { runForensicAudit } = require('../services/orchestrator');
const db = require('../services/db_pg');
const { getSessionCosts, resetSessionCosts } = require('../services/cost_tracker');

// Configuration
const STATE_FILE = path.join(__dirname, '..', 'batch_progress.json');

// Graceful shutdown handling
let isShuttingDown = false;

function setupShutdownHandlers() {
  const handler = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n\nReceived ${signal}. Stopping after current audit...`);
    saveState();
  };

  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}

// State management
let state = {
  completed: [],
  failed: [],
  needsReviewAnalysis: [],  // Contractors where review analysis failed
  pending: [],
  startedAt: null,
  lastUpdated: null
};

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      // Ensure needsReviewAnalysis exists for backwards compatibility
      state = {
        ...state,
        ...loaded,
        needsReviewAnalysis: loaded.needsReviewAnalysis || []
      };
      console.log(`Loaded state: ${state.completed.length} completed, ${state.failed.length} failed, ${state.needsReviewAnalysis.length} need review analysis`);
    } catch (e) {
      console.warn('Could not load state file, starting fresh');
    }
  }
}

function saveState() {
  state.lastUpdated = new Date().toISOString();
  // Atomic write: temp file then rename
  const tempFile = STATE_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2));
  fs.renameSync(tempFile, STATE_FILE);
}

function markCompleted(id, result, hasReviewAnalysis) {
  state.completed.push({
    id,
    score: result.trust_score,
    recommendation: result.recommendation,
    hasReviewAnalysis,
    timestamp: new Date().toISOString()
  });
  state.pending = state.pending.filter(pid => pid !== id);
  saveState();
}

function markNeedsReviewAnalysis(id, result) {
  state.needsReviewAnalysis.push({
    id,
    score: result.trust_score,
    recommendation: result.recommendation,
    timestamp: new Date().toISOString()
  });
  state.pending = state.pending.filter(pid => pid !== id);
  saveState();
}

function markFailed(id, error) {
  state.failed.push({ id, error: error.message || String(error), timestamp: new Date().toISOString() });
  state.pending = state.pending.filter(pid => pid !== id);
  saveState();
}

/**
 * Check if review analysis was successful for a contractor
 */
async function hasReviewAnalysisData(contractorId) {
  const rows = await db.exec(`
    SELECT COUNT(*) as count
    FROM contractor_raw_data
    WHERE contractor_id = ? AND source_name = 'review_analysis' AND fetch_status = 'success'
  `, [contractorId]);
  return parseInt(rows[0]?.count || 0) > 0;
}

// Main batch function
async function runBatch(contractorIds, options = {}) {
  const { skipLiens = false } = options;
  setupShutdownHandlers();
  resetSessionCosts();

  state.startedAt = state.startedAt || new Date().toISOString();

  // Filter out already processed contractors
  const completedSet = new Set(state.completed.map(c => c.id));
  const failedSet = new Set(state.failed.map(f => f.id));
  const needsReviewSet = new Set(state.needsReviewAnalysis.map(n => n.id));
  const toProcess = contractorIds.filter(id =>
    !completedSet.has(id) && !failedSet.has(id) && !needsReviewSet.has(id)
  );

  state.pending = toProcess;
  saveState();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`BATCH AUDIT - ${toProcess.length} contractors (sequential)`);
  console.log(`Already: ${state.completed.length} completed, ${state.failed.length} failed, ${state.needsReviewAnalysis.length} need review analysis`);
  console.log(`${'='.repeat(60)}\n`);

  if (toProcess.length === 0) {
    console.log('No contractors to process.');
    return [];
  }

  const results = [];

  for (let i = 0; i < toProcess.length; i++) {
    if (isShuttingDown) {
      console.log('Shutdown requested, stopping batch.');
      break;
    }

    const id = toProcess[i];
    console.log(`\n[${i + 1}/${toProcess.length}] Auditing contractor ${id}...`);

    try {
      const result = await runForensicAudit({ id }, { dryRun: false, batchMode: true, skipLiens });

      if (!result) {
        throw new Error('Audit returned null result');
      }

      // Check if review analysis succeeded
      const hasReview = await hasReviewAnalysisData(id);

      if (hasReview) {
        markCompleted(id, result, true);
        console.log(`  -> Score: ${result.trust_score}/100 (${result.recommendation}) ✓ Review analysis OK`);
      } else {
        markNeedsReviewAnalysis(id, result);
        console.log(`  -> Score: ${result.trust_score}/100 (${result.recommendation}) ⚠ NEEDS REVIEW ANALYSIS`);
      }

      results.push({ id, success: true, result, hasReviewAnalysis: hasReview });

    } catch (err) {
      markFailed(id, err);
      console.error(`  -> FAILED: ${err.message}`);
      results.push({ id, success: false, error: err.message });
    }
  }

  // Summary
  const costs = getSessionCosts();
  console.log(`\n${'='.repeat(60)}`);
  console.log('BATCH COMPLETE');
  console.log(`${'='.repeat(60)}`);
  console.log(`Completed (with review analysis): ${state.completed.length}`);
  console.log(`Needs review analysis retry:      ${state.needsReviewAnalysis.length}`);
  console.log(`Failed:                           ${state.failed.length}`);
  console.log(`Total API cost: $${costs.total.toFixed(4)}`);
  console.log(`State saved to: ${STATE_FILE}`);

  // Close database pool at end of batch
  await db.close();

  return results;
}

/**
 * Retry review analysis only for contractors in needsReviewAnalysis bucket
 */
async function retryReviewAnalysis() {
  loadState();

  if (state.needsReviewAnalysis.length === 0) {
    console.log('No contractors need review analysis retry.');
    return;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RETRY REVIEW ANALYSIS - ${state.needsReviewAnalysis.length} contractors`);
  console.log(`${'='.repeat(60)}\n`);

  const { analyzeReviews } = require('../services/review_analyzer');
  const toRetry = [...state.needsReviewAnalysis];
  let successCount = 0;

  for (let i = 0; i < toRetry.length; i++) {
    const item = toRetry[i];
    console.log(`[${i + 1}/${toRetry.length}] Retrying review analysis for contractor ${item.id}...`);

    try {
      // Get contractor info
      const rows = await db.exec(`
        SELECT id, business_name as name FROM contractors_contractor WHERE id = ?
      `, [item.id]);

      if (rows.length === 0) {
        console.log(`  -> Contractor not found, skipping`);
        continue;
      }

      const contractor = rows[0];

      // Get review data from stored sources
      const reviewSources = await db.exec(`
        SELECT source_name, structured_data
        FROM contractor_raw_data
        WHERE contractor_id = ?
        AND source_name IN ('google_maps_local', 'google_maps_hq', 'yelp', 'bbb', 'trustpilot', 'angi', 'houzz')
        AND fetch_status = 'success'
      `, [item.id]);

      const reviewData = {};
      for (const source of reviewSources) {
        if (source.structured_data) {
          try {
            const data = JSON.parse(source.structured_data);
            if (data.rating || data.reviews) {
              reviewData[source.source_name] = data;
            }
          } catch (e) {}
        }
      }

      if (Object.keys(reviewData).length < 2) {
        console.log(`  -> Insufficient review data (${Object.keys(reviewData).length} sources), skipping`);
        continue;
      }

      // Run analysis
      const analysis = await analyzeReviews(contractor.name, reviewData);

      if (analysis && !analysis.error && !analysis.skipped) {
        // Store the analysis
        await db.exec(`
          INSERT INTO contractor_raw_data (contractor_id, source_name, fetch_status, structured_data, fetched_at, expires_at)
          VALUES (?, 'review_analysis', 'success', ?, NOW(), NOW() + INTERVAL '7 days')
          ON CONFLICT (contractor_id, source_name)
          DO UPDATE SET fetch_status = 'success', structured_data = ?, fetched_at = NOW(), expires_at = NOW() + INTERVAL '7 days'
        `, [item.id, JSON.stringify(analysis), JSON.stringify(analysis)]);

        // Move from needsReviewAnalysis to completed
        state.needsReviewAnalysis = state.needsReviewAnalysis.filter(n => n.id !== item.id);
        state.completed.push({
          ...item,
          hasReviewAnalysis: true,
          retried: true,
          timestamp: new Date().toISOString()
        });
        saveState();

        console.log(`  -> Success! Fake review score: ${analysis.fake_review_score}/100`);
        successCount++;
      } else {
        console.log(`  -> Analysis failed: ${analysis?.error || 'Unknown error'}`);
      }

    } catch (err) {
      console.error(`  -> Error: ${err.message}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RETRY COMPLETE: ${successCount}/${toRetry.length} succeeded`);
  console.log(`${'='.repeat(60)}`);

  await db.close();
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(`
Usage: node batch_audit_runner.js [options]

Options:
  --limit N       Process only N contractors (default: all unaudited)
  --ids 1,2,3     Process specific contractor IDs
  --vertical pool Process contractors in a vertical (ordered by city)
  --resume        Resume from saved state
  --reset         Clear state and start fresh
  --retry-review  Retry review analysis for failed contractors
  --status        Show current batch status
  --skip-liens    Skip county lien scraping (faster, ~2x throughput)
  --max N         Alias for --limit (max contractors to process)
  --help          Show this help

Examples:
  node batch_audit_runner.js --limit 10
  node batch_audit_runner.js --ids 1,2,3
  node batch_audit_runner.js --vertical pool --limit 100
  node batch_audit_runner.js --resume --limit 50
  node batch_audit_runner.js --reset --limit 100
  node batch_audit_runner.js --retry-review
  node batch_audit_runner.js --status
`);
    process.exit(0);
  }

  if (args.includes('--status')) {
    loadState();
    console.log(`\nBatch Status:`);
    console.log(`  Started: ${state.startedAt || 'Never'}`);
    console.log(`  Last updated: ${state.lastUpdated || 'Never'}`);
    console.log(`  Completed: ${state.completed.length}`);
    console.log(`  Needs review analysis: ${state.needsReviewAnalysis.length}`);
    console.log(`  Failed: ${state.failed.length}`);
    console.log(`  Pending: ${state.pending.length}`);

    if (state.needsReviewAnalysis.length > 0) {
      console.log(`\n  IDs needing review analysis: ${state.needsReviewAnalysis.map(n => n.id).join(', ')}`);
    }
    if (state.failed.length > 0) {
      console.log(`\n  Failed IDs: ${state.failed.map(f => f.id).join(', ')}`);
    }
    process.exit(0);
  }

  if (args.includes('--retry-review')) {
    await retryReviewAnalysis();
    process.exit(0);
  }

  if (args.includes('--reset')) {
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
      console.log('State cleared.');
    }
  }

  // Load state if resuming
  if (args.includes('--resume') || !args.includes('--reset')) {
    loadState();
  }

  // Parse skipLiens flag (before contractor selection)
  const skipLiens = args.includes('--skip-liens');
  const vertical = args.includes('--vertical') ? args[args.indexOf('--vertical') + 1] : null;

  let contractorIds;

  if (args.includes('--ids')) {
    const idsArg = args[args.indexOf('--ids') + 1];
    contractorIds = idsArg.split(',').map(id => parseInt(id.trim()));
  } else if (vertical) {
    let limit = null;
    if (args.includes('--limit')) {
      limit = parseInt(args[args.indexOf('--limit') + 1]);
    } else if (args.includes('--max')) {
      limit = parseInt(args[args.indexOf('--max') + 1]);
    }

    const query = `
      SELECT DISTINCT c.id
      FROM contractors_contractor c
      JOIN contractors_contractor_verticals cv ON cv.contractor_id = c.id
      JOIN contractors_vertical v ON v.id = cv.vertical_id
      WHERE v.slug = ?
        AND c.is_active = true
        AND (c.trust_score = 0 OR c.trust_score IS NULL)
      ORDER BY c.city, c.business_name, c.id
      ${limit ? `LIMIT ${limit}` : ''}
    `;
    const result = await db.exec(query, [vertical]);
    contractorIds = result.map(r => r.id);
  } else {
    // Get unaudited contractors from DB
    // Parse limit (support both --limit and --max as aliases)
    let limit = null;
    if (args.includes('--limit')) {
      limit = parseInt(args[args.indexOf('--limit') + 1]);
    } else if (args.includes('--max')) {
      limit = parseInt(args[args.indexOf('--max') + 1]);
    }

    const query = `
      SELECT id FROM contractors_contractor
      WHERE trust_score = 0 OR trust_score IS NULL
      ORDER BY id
      ${limit ? `LIMIT ${limit}` : ''}
    `;
    const result = await db.exec(query);
    contractorIds = result.map(r => r.id);
  }

  if (contractorIds.length === 0) {
    console.log('No contractors to process.');
    process.exit(0);
  }

  await runBatch(contractorIds, { skipLiens });
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
