#!/usr/bin/env node
/**
 * Variance Test Script
 *
 * Runs the same contractor through audit N times (default 5)
 * to verify score consistency at temperature 0.
 *
 * Usage: node scripts/variance_test.js --id 288 --runs 5
 */

const { runForensicAudit } = require('../services/orchestrator');
const db = require('../services/db_pg');

async function runVarianceTest(contractorId, runs = 5) {
  console.log(`\n=== Variance Test: Contractor ${contractorId} ===`);
  console.log(`Running ${runs} audits with --skip-collection (cached data only)\n`);

  const results = [];

  try {
    for (let i = 1; i <= runs; i++) {
      console.log(`Run ${i}/${runs}...`);
      try {
        const result = await runForensicAudit(
          { id: contractorId },
          {
            skipCollection: true,  // Use cached data for consistency
            dryRun: true,          // Don't save to DB
            batchMode: true        // Keep DB pool open
          }
        );

        results.push({
          run: i,
          score: result.trust_score,
          recommendation: result.recommendation,
          riskLevel: result.risk_level,
          iterations: result.collection_rounds || 'N/A'
        });

        console.log(`  Score: ${result.trust_score}, ${result.recommendation}`);
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        results.push({ run: i, error: err.message });
      }
    }

    // Calculate variance
    const scores = results.filter(r => r.score).map(r => r.score);
    if (scores.length < 2) {
      console.log('\nInsufficient successful runs for variance calculation');
      return { results, pass: false };
    }

    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const spread = max - min;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    console.log(`\n=== Results ===`);
    console.log(`Scores: ${scores.join(', ')}`);
    console.log(`Range: ${min}-${max} (spread: ${spread} points)`);
    console.log(`Average: ${avg.toFixed(1)}`);
    console.log(`Variance: ${spread <= 5 ? 'PASS' : 'FAIL'} (target: ≤5 points)`);

    return { results, min, max, spread, avg, pass: spread <= 5 };
  } finally {
    // Always close DB pool at the end
    await db.close();
  }
}

// CLI
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
};

const contractorId = parseInt(getArg('id') || '288');
const runs = parseInt(getArg('runs') || '5');

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY not set. Run: source venv/bin/activate && set -a && . ./.env && set +a');
  process.exit(1);
}

runVarianceTest(contractorId, runs)
  .then(result => {
    process.exit(result.pass ? 0 : 1);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
