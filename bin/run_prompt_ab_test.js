#!/usr/bin/env node

/**
 * Parallel Prompt A/B Test Runner
 *
 * Usage: node bin/run_prompt_ab_test.js --ids 141,656,665 --runs 3
 */

const fs = require('fs');
const path = require('path');
const { ABCouncilRunner } = require('../services/ab_council_runner');
const prompts = require('../services/prompts');
const db = require('../services/db_pg');

// Parse args
const args = process.argv.slice(2);
let contractorIds = [];
let runsPerSystem = 3;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ids' && args[i + 1]) {
    contractorIds = args[i + 1].split(',').map(id => parseInt(id.trim()));
    i++;
  } else if (args[i] === '--runs' && args[i + 1]) {
    runsPerSystem = parseInt(args[i + 1]);
    i++;
  }
}

if (contractorIds.length === 0) {
  console.error('Usage: node bin/run_prompt_ab_test.js --ids 141,656,665 [--runs 3]');
  process.exit(1);
}

async function loadContractorData(contractorId) {
  const rows = await db.exec(
    'SELECT id, business_name, city, state FROM contractors_contractor WHERE id = $1',
    [contractorId]
  );
  const contractor = rows[0];

  if (!contractor) throw new Error(`Contractor ${contractorId} not found`);

  const rawData = await db.exec(
    `SELECT source_name, structured_data, fetch_status
     FROM contractor_raw_data
     WHERE contractor_id = $1 AND fetch_status = 'success'`,
    [contractorId]
  );

  // Build enriched data string
  let enriched = `CONTRACTOR: ${contractor.business_name}\n`;
  enriched += `LOCATION: ${contractor.city}, ${contractor.state || 'TX'}\n\n`;

  for (const row of rawData) {
    if (row.structured_data) {
      let data = row.structured_data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { continue; }
      }
      const dataStr = JSON.stringify(data, null, 2);
      enriched += `${row.source_name.toUpperCase()}:\n${dataStr}\n\n`;
    }
  }

  return { contractor, enrichedData: enriched };
}

function calculateVariance(scores) {
  if (scores.length === 0) return 0;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const squaredDiffs = scores.map(s => Math.pow(s - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / scores.length);
}

async function runTest() {
  const results = [];
  const outputPath = path.join(__dirname, '../data/parallel_test_results.json');

  console.log(`\n=== PARALLEL PROMPT A/B TEST ===`);
  console.log(`Contractors: ${contractorIds.join(', ')}`);
  console.log(`Runs per system: ${runsPerSystem}\n`);

  for (const contractorId of contractorIds) {
    console.log(`\n--- Contractor ${contractorId} ---`);

    const { contractor, enrichedData } = await loadContractorData(contractorId);
    console.log(`Name: ${contractor.business_name}`);

    const result = {
      contractor_id: contractorId,
      contractor_name: contractor.business_name,
      timestamp: new Date().toISOString(),
      system_a_runs: [],
      system_b_runs: []
    };

    // System A (Control)
    console.log(`\nSystem A (Control):`);
    for (let i = 0; i < runsPerSystem; i++) {
      const runner = new ABCouncilRunner(prompts.control);
      const runResult = await runner.run(enrichedData, []);
      result.system_a_runs.push(runResult);
      console.log(`  Run ${i + 1}: score=${runResult.score}, confidence=${runResult.confidence}`);
    }

    // System B (Qualitative)
    console.log(`\nSystem B (Qualitative):`);
    for (let i = 0; i < runsPerSystem; i++) {
      const runner = new ABCouncilRunner(prompts.qualitative);
      const runResult = await runner.run(enrichedData, []);
      result.system_b_runs.push(runResult);
      console.log(`  Run ${i + 1}: score=${runResult.score}, confidence=${runResult.confidence}`);
    }

    // Calculate stats
    const aScores = result.system_a_runs.map(r => r.score).filter(s => s != null);
    const bScores = result.system_b_runs.map(r => r.score).filter(s => s != null);

    result.system_a_variance = calculateVariance(aScores);
    result.system_a_average = aScores.length ? aScores.reduce((a, b) => a + b, 0) / aScores.length : null;
    result.system_b_variance = calculateVariance(bScores);
    result.system_b_average = bScores.length ? bScores.reduce((a, b) => a + b, 0) / bScores.length : null;

    result.comparison = {
      tighter_variance: result.system_a_variance < result.system_b_variance ? 'A' :
                        result.system_b_variance < result.system_a_variance ? 'B' : 'TIE',
      score_delta: Math.abs((result.system_a_average || 0) - (result.system_b_average || 0)).toFixed(1),
      a_total_cost: result.system_a_runs.reduce((sum, r) => sum + (r.cost || 0), 0).toFixed(4),
      b_total_cost: result.system_b_runs.reduce((sum, r) => sum + (r.cost || 0), 0).toFixed(4)
    };

    console.log(`\nComparison:`);
    console.log(`  A avg: ${result.system_a_average?.toFixed(1)}, variance: ${result.system_a_variance.toFixed(2)}`);
    console.log(`  B avg: ${result.system_b_average?.toFixed(1)}, variance: ${result.system_b_variance.toFixed(2)}`);
    console.log(`  Tighter: System ${result.comparison.tighter_variance}`);

    results.push(result);
  }

  // Save results
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n=== Results saved to ${outputPath} ===`);
}

runTest().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
