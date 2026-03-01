#!/usr/bin/env node
/**
 * Holistic vs Deterministic Comparison Runner
 *
 * Compare two scoring approaches head-to-head on benchmark contractors.
 * Neither approach writes to database - pure file-based experimentation.
 *
 * Usage:
 *   node bin/compare.js --id 8958           # Compare one contractor
 *   node bin/compare.js --all               # Compare all benchmarks
 *   node bin/compare.js --only holistic     # Run one approach only
 *   node bin/compare.js --cached            # Use cached results
 *   node bin/compare.js --format json       # Output as JSON
 */

const fs = require('fs');
const path = require('path');

// Paths
const BASE_DIR = path.join(__dirname, '..');
const EXPERIMENTS_DIR = path.join(BASE_DIR, 'experiments');
const BENCHMARK_PATH = path.join(BASE_DIR, 'data', 'benchmark_contractors.json');
const SNAPSHOTS_DIR = path.join(EXPERIMENTS_DIR, 'data', 'snapshots');
const COMPARISON_DIR = path.join(EXPERIMENTS_DIR, 'comparison');

// Agents
const holisticAgent = require('../services/scoring/holistic/agent');
const deterministicAgent = require('../services/scoring/deterministic/agent');

// Parse CLI args
const args = process.argv.slice(2);
const flags = {
  id: null,
  all: args.includes('--all'),
  only: null,
  cached: args.includes('--cached'),
  format: 'table'
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--id' && args[i + 1]) flags.id = parseInt(args[i + 1]);
  if (args[i] === '--only' && args[i + 1]) flags.only = args[i + 1];
  if (args[i] === '--format' && args[i + 1]) flags.format = args[i + 1];
}

/**
 * Load benchmark contractors
 */
function loadBenchmarks() {
  const data = JSON.parse(fs.readFileSync(BENCHMARK_PATH, 'utf-8'));
  return data.contractors;
}

/**
 * Load snapshot for a contractor
 */
function loadSnapshot(contractorId) {
  // Find latest snapshot directory
  const snapshotDirs = fs.readdirSync(SNAPSHOTS_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();

  for (const dir of snapshotDirs) {
    const dirPath = path.join(SNAPSHOTS_DIR, dir);
    const files = fs.readdirSync(dirPath).filter(f => f.startsWith(`${contractorId}_`));
    if (files.length > 0) {
      return JSON.parse(fs.readFileSync(path.join(dirPath, files[0]), 'utf-8'));
    }
  }

  throw new Error(`No snapshot found for contractor ${contractorId}`);
}

/**
 * Run comparison for one contractor
 */
async function compareOne(contractor) {
  const snapshot = loadSnapshot(contractor.id);
  const meta = {
    id: contractor.id,
    name: contractor.name,
    city: snapshot.city || '',
    archetype: contractor.category,
    expected: contractor.expected
  };

  const results = { contractor: meta, holistic: null, deterministic: null };

  // Run holistic (unless --only deterministic)
  if (flags.only !== 'deterministic') {
    console.log(`  [holistic] Running...`);
    results.holistic = await holisticAgent.score(snapshot.sources, meta);
    holisticAgent.saveResult(results.holistic);
  }

  // Run deterministic (unless --only holistic)
  if (flags.only !== 'holistic') {
    console.log(`  [deterministic] Running...`);
    results.deterministic = await deterministicAgent.score(snapshot.sources, meta);
    deterministicAgent.saveResult(results.deterministic);
  }

  return results;
}

/**
 * Calculate winner for a comparison
 */
function getWinner(holistic, deterministic, expected) {
  if (!holistic || !deterministic) return 'N/A';

  const holisticDelta = Math.abs(holistic.result.trust_score - expected);
  const deterministicDelta = Math.abs(deterministic.result.trust_score - expected);

  if (holisticDelta < deterministicDelta) return 'HOLISTIC';
  if (deterministicDelta < holisticDelta) return 'DETERMINISTIC';
  return 'TIE';
}

/**
 * Print table output
 */
function printTable(comparisons) {
  const divider = '═'.repeat(85);
  const thinDivider = '─'.repeat(85);

  console.log(`\n╔${divider}╗`);
  console.log(`║${'HOLISTIC vs DETERMINISTIC COMPARISON'.padStart(52).padEnd(85)}║`);
  console.log(`║${'Run: ' + new Date().toISOString().padStart(47).padEnd(85)}║`);
  console.log(`╠${divider}╣`);
  console.log(`║ ${'Contractor'.padEnd(28)} │ ${'Exp'.padStart(4)} │ ${'Hol'.padStart(4)} │ ${'Det'.padStart(4)} │ ${'Winner'.padEnd(18)} ║`);
  console.log(`╠${thinDivider}╣`);

  let holisticWins = 0;
  let deterministicWins = 0;
  let totalHolisticDelta = 0;
  let totalDeterministicDelta = 0;

  for (const c of comparisons) {
    const name = `${c.contractor.name.substring(0, 24)} (${c.contractor.archetype.substring(0, 3)})`;
    const expected = c.contractor.expected;
    const holScore = c.holistic?.result?.trust_score ?? '-';
    const detScore = c.deterministic?.result?.trust_score ?? '-';
    const winner = getWinner(c.holistic, c.deterministic, expected);

    let winnerDisplay = winner;
    if (winner === 'HOLISTIC' && ['bad', 'sketchy', 'established_sketchy', 'known_bad'].includes(c.contractor.archetype)) {
      winnerDisplay = 'HOLISTIC ✓✓';
      holisticWins += 2; // Double weight for catching bad actors
    } else if (winner === 'HOLISTIC') {
      holisticWins++;
    } else if (winner === 'DETERMINISTIC') {
      deterministicWins++;
    }

    if (c.holistic?.result) totalHolisticDelta += Math.abs(c.holistic.result.trust_score - expected);
    if (c.deterministic?.result) totalDeterministicDelta += Math.abs(c.deterministic.result.trust_score - expected);

    console.log(`║ ${name.padEnd(28)} │ ${String(expected).padStart(4)} │ ${String(holScore).padStart(4)} │ ${String(detScore).padStart(4)} │ ${winnerDisplay.padEnd(18)} ║`);
  }

  console.log(`╠${thinDivider}╣`);
  console.log(`║ SUMMARY${' '.repeat(77)}║`);
  console.log(`║ • Holistic wins: ${holisticWins}/${comparisons.length} (closer to expected)${' '.repeat(40)}║`);
  console.log(`║ • Avg delta: Holistic=${(totalHolisticDelta / comparisons.length).toFixed(1)}, Deterministic=${(totalDeterministicDelta / comparisons.length).toFixed(1)}${' '.repeat(20)}║`);
  console.log(`╚${divider}╝\n`);
}

/**
 * Save comparison results
 */
function saveComparison(comparisons) {
  const output = {
    run_at: new Date().toISOString(),
    comparisons: comparisons,
    summary: {
      holistic_wins: comparisons.filter(c => getWinner(c.holistic, c.deterministic, c.contractor.expected) === 'HOLISTIC').length,
      deterministic_wins: comparisons.filter(c => getWinner(c.holistic, c.deterministic, c.contractor.expected) === 'DETERMINISTIC').length,
      ties: comparisons.filter(c => getWinner(c.holistic, c.deterministic, c.contractor.expected) === 'TIE').length
    }
  };

  // Save to comparison directory
  fs.writeFileSync(path.join(COMPARISON_DIR, 'head_to_head.json'), JSON.stringify(output, null, 2));

  // Also save to history
  const historyFile = path.join(COMPARISON_DIR, 'history', `comparison_${Date.now()}.json`);
  fs.writeFileSync(historyFile, JSON.stringify(output, null, 2));
}

/**
 * Main
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  HOLISTIC vs DETERMINISTIC COMPARISON');
  console.log('='.repeat(60));

  // Load benchmarks
  const benchmarks = loadBenchmarks();

  // Filter to specific ID if provided
  let contractors = benchmarks;
  if (flags.id) {
    contractors = benchmarks.filter(c => c.id === flags.id);
    if (contractors.length === 0) {
      console.error(`Contractor ${flags.id} not found in benchmarks`);
      process.exit(1);
    }
  }

  if (!flags.all && !flags.id) {
    console.log('\nUsage:');
    console.log('  node bin/compare.js --id 8958     # Compare one contractor');
    console.log('  node bin/compare.js --all         # Compare all benchmarks');
    console.log('  node bin/compare.js --only holistic');
    console.log('  node bin/compare.js --format json');
    process.exit(0);
  }

  console.log(`\nComparing ${contractors.length} contractor(s)...`);
  if (flags.only) console.log(`Running only: ${flags.only}`);

  // Run comparisons
  const comparisons = [];
  for (const contractor of contractors) {
    console.log(`\n[${contractor.id}] ${contractor.name}`);
    try {
      const result = await compareOne(contractor);
      comparisons.push(result);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
  }

  // Output results
  if (flags.format === 'json') {
    console.log(JSON.stringify(comparisons, null, 2));
  } else {
    printTable(comparisons);
  }

  // Save results
  saveComparison(comparisons);
  console.log(`Results saved to: ${path.join(COMPARISON_DIR, 'head_to_head.json')}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
