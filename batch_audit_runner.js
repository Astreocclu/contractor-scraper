#!/usr/bin/env node
/**
 * Batch Audit Runner
 *
 * Runs forensic audits on multiple contractors in parallel with:
 * - Concurrency control (5 simultaneous audits)
 * - State persistence for resumability
 * - Graceful shutdown handling
 * - Cost tracking
 */

const pLimit = require('p-limit');
const fs = require('fs');
const path = require('path');
const { runForensicAudit } = require('./services/orchestrator');
const db = require('./services/db_pg');
const { getSessionCosts, resetSessionCosts } = require('./services/cost_tracker');

// Configuration
const CONCURRENCY = 5;
const STATE_FILE = path.join(__dirname, 'batch_progress.json');

// Graceful shutdown handling
let isShuttingDown = false;
const activeAudits = new Set();

function setupShutdownHandlers() {
  const handler = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n\nReceived ${signal}. Finishing ${activeAudits.size} active audits...`);

    // Wait for active audits (with 60s timeout)
    const timeout = setTimeout(() => {
      console.log('Shutdown timeout - forcing exit');
      process.exit(1);
    }, 60000);

    await Promise.allSettled(activeAudits);
    clearTimeout(timeout);

    saveState();
    console.log('Graceful shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}

// State management
let state = {
  completed: [],
  failed: [],
  pending: [],
  startedAt: null,
  lastUpdated: null
};

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      console.log(`Loaded state: ${state.completed.length} completed, ${state.failed.length} failed`);
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

function markCompleted(id, result) {
  state.completed.push({ id, score: result.trust_score, timestamp: new Date().toISOString() });
  state.pending = state.pending.filter(pid => pid !== id);
  saveState();
}

function markFailed(id, error) {
  state.failed.push({ id, error: error.message, timestamp: new Date().toISOString() });
  state.pending = state.pending.filter(pid => pid !== id);
  saveState();
}

// Main batch function
async function runBatch(contractorIds) {
  setupShutdownHandlers();
  resetSessionCosts();

  state.startedAt = state.startedAt || new Date().toISOString();

  // Filter out already completed/failed
  const completedSet = new Set(state.completed.map(c => c.id));
  const failedSet = new Set(state.failed.map(f => f.id));
  const toProcess = contractorIds.filter(id => !completedSet.has(id) && !failedSet.has(id));

  state.pending = toProcess;
  saveState();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`BATCH AUDIT - ${toProcess.length} contractors`);
  console.log(`Already completed: ${state.completed.length}, failed: ${state.failed.length}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`${'='.repeat(60)}\n`);

  if (toProcess.length === 0) {
    console.log('No contractors to process.');
    return [];
  }

  const limit = pLimit(CONCURRENCY);
  let processed = 0;

  const tasks = toProcess.map(id => limit(async () => {
    if (isShuttingDown) return { id, success: false, error: 'Shutdown requested' };

    const auditPromise = (async () => {
      try {
        console.log(`[${++processed}/${toProcess.length}] Auditing contractor ${id}...`);
        const result = await runForensicAudit({ id }, { dryRun: false, batchMode: true });

        if (!result) {
          throw new Error('Audit returned null result');
        }

        markCompleted(id, result);
        console.log(`  -> Score: ${result.trust_score}/100 (${result.recommendation})`);
        return { id, success: true, result };
      } catch (err) {
        markFailed(id, err);
        console.error(`  -> FAILED: ${err.message}`);
        return { id, success: false, error: err.message };
      }
    })();

    activeAudits.add(auditPromise);
    const result = await auditPromise;
    activeAudits.delete(auditPromise);
    return result;
  }));

  const results = await Promise.all(tasks);

  // Summary
  const costs = getSessionCosts();
  console.log(`\n${'='.repeat(60)}`);
  console.log('BATCH COMPLETE');
  console.log(`${'='.repeat(60)}`);
  console.log(`Completed: ${state.completed.length}`);
  console.log(`Failed: ${state.failed.length}`);
  console.log(`Total API cost: $${costs.total.toFixed(4)}`);
  console.log(`State saved to: ${STATE_FILE}`);

  // Close database pool at end of batch
  await db.close();

  return results;
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
  --resume        Resume from saved state
  --reset         Clear state and start fresh
  --help          Show this help

Examples:
  node batch_audit_runner.js --limit 10
  node batch_audit_runner.js --ids 1,2,3
  node batch_audit_runner.js --resume --limit 50
  node batch_audit_runner.js --reset --limit 100
`);
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

  let contractorIds;

  if (args.includes('--ids')) {
    const idsArg = args[args.indexOf('--ids') + 1];
    contractorIds = idsArg.split(',').map(id => parseInt(id.trim()));
  } else {
    // Get unaudited contractors from DB
    const limit = args.includes('--limit')
      ? parseInt(args[args.indexOf('--limit') + 1])
      : null;

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

  await runBatch(contractorIds);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
