#!/usr/bin/env node
/**
 * Hybrid Experiment Runner
 *
 * Runs hybrid variations in an isolated directory to avoid conflicts.
 *
 * Usage:
 *   node bin/hybrid_experiment_runner.js run-all
 *   node bin/hybrid_experiment_runner.js run --variation H1 --runs 5
 *   node bin/hybrid_experiment_runner.js report
 *   node bin/hybrid_experiment_runner.js status
 */

const fs = require('fs');
const path = require('path');
const { runVariation } = require('../services/hybrid_experiment_agent');

// Paths
const BASE_DIR = path.join(__dirname, '..', 'experiments', 'hybrid');
const CONFIG_PATH = path.join(BASE_DIR, 'config', 'hybrid_matrix.json');
const STATE_PATH = path.join(BASE_DIR, 'state.json');
const RESULTS_RAW_DIR = path.join(BASE_DIR, 'results', 'raw');
const RESULTS_AGG_DIR = path.join(BASE_DIR, 'results', 'aggregated');
const REPORTS_DIR = path.join(BASE_DIR, 'reports');

// State management
let state = {
  started_at: null,
  completed_runs: [],
  failed_runs: [],
  current_variation: null
};

function loadState() {
  if (fs.existsSync(STATE_PATH)) {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  }
}

function saveState() {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function loadSnapshots() {
  const snapshotDir = fs.readdirSync(path.join(BASE_DIR, 'data', 'snapshots'))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .pop();

  if (!snapshotDir) {
    throw new Error('No snapshots found in hybrid data directory');
  }

  const snapshotPath = path.join(BASE_DIR, 'data', 'snapshots', snapshotDir);
  const files = fs.readdirSync(snapshotPath)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  return files.map(f => JSON.parse(fs.readFileSync(path.join(snapshotPath, f), 'utf-8')));
}

async function runSingleVariation(variationId, numRuns = 5) {
  const config = loadConfig();
  const variation = config.variations.find(v => v.id === variationId);

  if (!variation) {
    throw new Error(`Unknown variation: ${variationId}`);
  }

  const snapshots = loadSnapshots();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  VARIATION ${variation.id}: ${variation.description}`);
  console.log(`  ${snapshots.length} contractors × ${numRuns} runs = ${snapshots.length * numRuns} audits`);
  console.log('='.repeat(60));

  state.current_variation = variationId;
  saveState();

  for (let run = 1; run <= numRuns; run++) {
    console.log(`\n--- Run ${run}/${numRuns} ---`);

    for (const snapshot of snapshots) {
      const runKey = `${variationId}_${snapshot.contractor_id}_run${run}`;

      if (state.completed_runs.includes(runKey)) {
        console.log(`  [${snapshot.contractor_id}] ${snapshot.business_name} - SKIPPED (already done)`);
        continue;
      }

      console.log(`  [${snapshot.contractor_id}] ${snapshot.business_name}...`);

      const result = await runVariation(variation, snapshot, {
        allContractors: snapshots
      });

      const resultFile = path.join(RESULTS_RAW_DIR, `${runKey}.json`);
      fs.writeFileSync(resultFile, JSON.stringify({
        variation: variationId,
        contractor_id: snapshot.contractor_id,
        contractor_name: snapshot.business_name,
        archetype: snapshot.archetype,
        expected_score: snapshot.expected_score,
        run: run,
        timestamp: new Date().toISOString(),
        ...result
      }, null, 2));

      if (result.success) {
        state.completed_runs.push(runKey);
        console.log(`    -> Score: ${result.trust_score} (expected: ${snapshot.expected_score}) [${result.duration_ms}ms]`);
      } else {
        state.failed_runs.push({ key: runKey, error: result.error });
        console.log(`    -> FAILED: ${result.error}`);
      }

      saveState();
    }
  }

  aggregateVariation(variationId);
}

async function runAll() {
  const config = loadConfig();
  state.started_at = new Date().toISOString();
  saveState();

  for (const variation of config.variations) {
    await runSingleVariation(variation.id, config.runs_per_variation);
  }

  console.log('\n' + '='.repeat(60));
  console.log('  ALL VARIATIONS COMPLETE');
  console.log('='.repeat(60));

  generateReport();
}

function aggregateVariation(variationId) {
  const rawFiles = fs.readdirSync(RESULTS_RAW_DIR)
    .filter(f => f.startsWith(`${variationId}_`) && f.endsWith('.json'));

  const results = rawFiles.map(f =>
    JSON.parse(fs.readFileSync(path.join(RESULTS_RAW_DIR, f), 'utf-8'))
  );

  const byContractor = {};
  for (const r of results) {
    if (!byContractor[r.contractor_id]) {
      byContractor[r.contractor_id] = {
        name: r.contractor_name,
        archetype: r.archetype,
        expected: r.expected_score,
        scores: [],
        durations: [],
        costs: []
      };
    }
    if (r.success) {
      byContractor[r.contractor_id].scores.push(r.trust_score);
      byContractor[r.contractor_id].durations.push(r.duration_ms);
      byContractor[r.contractor_id].costs.push(r.cost_usd || 0);
    }
  }

  const contractorResults = {};
  let totalVariance = 0;
  let contractorCount = 0;

  for (const [id, data] of Object.entries(byContractor)) {
    const scores = data.scores;
    if (scores.length === 0) continue;

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = Math.sqrt(
      scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length
    );

    contractorResults[id] = {
      name: data.name,
      archetype: data.archetype,
      expected: data.expected,
      scores: scores,
      avg: Math.round(avg * 10) / 10,
      variance: Math.round(variance * 10) / 10,
      avg_duration_ms: Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length),
      avg_cost: data.costs.reduce((a, b) => a + b, 0) / data.costs.length
    };

    totalVariance += variance;
    contractorCount++;
  }

  const goldStandard = Object.entries(contractorResults).find(([_, d]) => d.archetype === 'gold_standard');
  const knownBad = Object.entries(contractorResults).find(([_, d]) => d.archetype === 'known_bad');

  let rankConsistency = 0;
  if (goldStandard && knownBad) {
    const goldScores = goldStandard[1].scores;
    const badScores = knownBad[1].scores;
    const minRuns = Math.min(goldScores.length, badScores.length);

    for (let i = 0; i < minRuns; i++) {
      if (goldScores[i] > badScores[i]) rankConsistency++;
    }
    rankConsistency = rankConsistency / minRuns;
  }

  const avgScores = Object.values(contractorResults).map(r => r.avg);
  const separation = avgScores.length >= 2
    ? Math.max(...avgScores) - Math.min(...avgScores)
    : 0;

  const aggregated = {
    variation: variationId,
    generated_at: new Date().toISOString(),
    metrics: {
      rank_consistency: rankConsistency,
      avg_variance: contractorCount > 0 ? totalVariance / contractorCount : 0,
      separation: separation,
      avg_duration_ms: Object.values(contractorResults).reduce((sum, r) => sum + r.avg_duration_ms, 0) / contractorCount,
      avg_cost_usd: Object.values(contractorResults).reduce((sum, r) => sum + r.avg_cost, 0) / contractorCount
    },
    contractor_results: contractorResults,
    pass_fail: {
      rank_consistency: rankConsistency >= 1.0 ? 'PASS' : 'FAIL',
      variance: (totalVariance / contractorCount) < 5 ? 'PASS' : 'FAIL',
      separation: separation >= 15 ? 'PASS' : 'FAIL',
      speed: true,
      cost: true
    }
  };

  fs.writeFileSync(
    path.join(RESULTS_AGG_DIR, `${variationId}_summary.json`),
    JSON.stringify(aggregated, null, 2)
  );

  console.log(`\n  Aggregated: ${variationId}`);
  console.log(`    Rank Consistency: ${(rankConsistency * 100).toFixed(0)}%`);
  console.log(`    Avg Variance: ${(totalVariance / contractorCount).toFixed(1)}`);
  console.log(`    Separation: ${separation.toFixed(0)} points`);
}

function generateReport() {
  const aggFiles = fs.readdirSync(RESULTS_AGG_DIR)
    .filter(f => f.endsWith('_summary.json'));

  const summaries = aggFiles.map(f =>
    JSON.parse(fs.readFileSync(path.join(RESULTS_AGG_DIR, f), 'utf-8'))
  );

  summaries.sort((a, b) => {
    const scoreA = (a.metrics.rank_consistency * 40) +
                   (Math.max(0, 10 - a.metrics.avg_variance) * 3) +
                   (Math.min(a.metrics.separation, 50) * 0.6);
    const scoreB = (b.metrics.rank_consistency * 40) +
                   (Math.max(0, 10 - b.metrics.avg_variance) * 3) +
                   (Math.min(b.metrics.separation, 50) * 0.6);
    return scoreB - scoreA;
  });

  let md = `# Hybrid Experiment Results\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n\n`;
  md += `## Winner: ${summaries[0]?.variation || 'TBD'}\n\n`;
  md += `## Leaderboard\n\n`;
  md += `| Rank | Variation | Rank Consistency | Variance | Separation | Speed | Cost |\n`;
  md += `|------|-----------|------------------|----------|------------|-------|------|\n`;

  summaries.forEach((s, i) => {
    const rankPct = ((s.metrics.rank_consistency || 0) * 100).toFixed(0);
    const variance = (s.metrics.avg_variance || 0).toFixed(1);
    const separation = (s.metrics.separation || 0).toFixed(0);
    const speed = ((s.metrics.avg_duration_ms || 0) / 1000).toFixed(1);
    const cost = (s.metrics.avg_cost_usd || 0).toFixed(4);
    md += `| ${i + 1} | ${s.variation} | ${rankPct}% | ${variance} | ${separation} | ${speed}s | $${cost} |\n`;
  });

  md += `\n## Detailed Results\n\n`;

  for (const s of summaries) {
    md += `### ${s.variation}\n\n`;
    md += `| Contractor | Archetype | Expected | Scores | Avg | Variance |\n`;
    md += `|------------|-----------|----------|--------|-----|----------|\n`;

    for (const [id, r] of Object.entries(s.contractor_results)) {
      md += `| ${r.name} | ${r.archetype} | ${r.expected} | [${r.scores.join(', ')}] | ${r.avg} | ${r.variance} |\n`;
    }
    md += `\n`;
  }

  fs.writeFileSync(path.join(BASE_DIR, 'results', 'RESULTS.md'), md);

  console.log(`\nReports generated:`);
  console.log(`  - ${path.join(BASE_DIR, 'results', 'RESULTS.md')}`);
}

function showStatus() {
  loadState();
  const config = loadConfig();

  const totalRuns = config.variations.length * config.contractors.length * config.runs_per_variation;
  const completed = state.completed_runs.length;
  const failed = state.failed_runs.length;
  const remaining = totalRuns - completed - failed;

  console.log('\n' + '='.repeat(60));
  console.log('  HYBRID EXPERIMENT STATUS');
  console.log('='.repeat(60));
  console.log(`  Total runs:     ${totalRuns}`);
  console.log(`  Completed:      ${completed}`);
  console.log(`  Failed:         ${failed}`);
  console.log(`  Remaining:      ${remaining}`);
  console.log(`  Progress:       ${((completed / totalRuns) * 100).toFixed(1)}%`);
  if (state.current_variation) {
    console.log(`  Current:        ${state.current_variation}`);
  }
  console.log('='.repeat(60));
}

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  [RESULTS_RAW_DIR, RESULTS_AGG_DIR, REPORTS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  loadState();

  switch (command) {
    case 'run': {
      const variationArg = args.indexOf('--variation');
      const runsArg = args.indexOf('--runs');

      if (variationArg === -1) {
        console.error('Usage: node bin/hybrid_experiment_runner.js run --variation H1 [--runs 5]');
        process.exit(1);
      }

      const variation = args[variationArg + 1];
      const runs = runsArg !== -1 ? parseInt(args[runsArg + 1]) : 5;

      await runSingleVariation(variation, runs);
      break;
    }

    case 'run-all':
      await runAll();
      break;

    case 'report':
      generateReport();
      break;

    case 'status':
      showStatus();
      break;

    default:
      console.log(`\nHybrid Experiment Runner\n\nUsage:\n  node bin/hybrid_experiment_runner.js run-all\n  node bin/hybrid_experiment_runner.js run --variation H1 [--runs 5]\n  node bin/hybrid_experiment_runner.js report\n  node bin/hybrid_experiment_runner.js status\n`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
