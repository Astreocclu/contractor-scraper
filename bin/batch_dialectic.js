#!/usr/bin/env node
/**
 * Batch Dialectic Audit Runner
 *
 * Runs dialectic audits on multiple contractors with batched concurrency.
 *
 * Usage:
 *   node bin/batch_dialectic.js --benchmark data/benchmark_contractors.json
 *   node bin/batch_dialectic.js --ids 141,656,665,682
 *   node bin/batch_dialectic.js --benchmark data/benchmark_contractors.json --batch-size 3
 */

const fs = require('fs');
const path = require('path');
const { runForensicAudit } = require('../services/orchestrator');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1];
};

const benchmarkFile = getArg('benchmark');
const idsArg = getArg('ids');
const batchSize = parseInt(getArg('batch-size') || '3');
const outputFile = getArg('output');

async function runBatch(contractors, batchSize) {
  const results = [];

  for (let i = 0; i < contractors.length; i += batchSize) {
    const batch = contractors.slice(i, i + batchSize);
    console.error(`\n=== Running batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(contractors.length/batchSize)} (${batch.length} contractors) ===\n`);

    const batchPromises = batch.map(async (contractor) => {
      try {
        console.error(`Starting audit for ${contractor.name || contractor.id}...`);
        const result = await runForensicAudit(
          { id: contractor.id },
          {
            skipCollection: true,
            mode: 'dialectic',
            batchMode: true  // Prevents DB pool from closing
          }
        );

        return {
          id: contractor.id,
          name: contractor.name,
          expected: contractor.expected,
          tolerance: contractor.tolerance,
          actual: result?.trust_score ?? null,
          advocate_score: result?.advocate?.trust_score ?? result?.advocate?.score ?? null,
          arbiter_score: result?.arbiter?.trust_score ?? result?.arbiter?.score ?? null,
          verdict: result?.verdict ?? null,
          hit: result?.trust_score !== null &&
               Math.abs(result.trust_score - contractor.expected) <= (contractor.tolerance || 10),
          delta: result?.trust_score !== null ? result.trust_score - contractor.expected : null,
          reasoning_summary: result?.synthesis?.summary ?? null,
          error: null
        };
      } catch (err) {
        console.error(`Error auditing ${contractor.id}: ${err.message}`);
        return {
          id: contractor.id,
          name: contractor.name,
          expected: contractor.expected,
          tolerance: contractor.tolerance,
          actual: null,
          hit: false,
          delta: null,
          error: err.message
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Small delay between batches to avoid rate limits
    if (i + batchSize < contractors.length) {
      console.error('Waiting 2s before next batch...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return results;
}

async function main() {
  let contractors = [];

  if (benchmarkFile) {
    const benchmark = JSON.parse(fs.readFileSync(benchmarkFile, 'utf-8'));
    contractors = benchmark.contractors;
    console.error(`Loaded ${contractors.length} contractors from ${benchmarkFile}`);
  } else if (idsArg) {
    const ids = idsArg.split(',').map(id => parseInt(id.trim()));
    contractors = ids.map(id => ({ id, expected: 50, tolerance: 15 }));
    console.error(`Running on ${contractors.length} contractor IDs: ${ids.join(', ')}`);
  } else {
    console.error('Usage: node bin/batch_dialectic.js --benchmark <file> OR --ids 1,2,3');
    process.exit(1);
  }

  console.error(`Batch size: ${batchSize}`);
  console.error(`Starting batch audit...\n`);

  const results = await runBatch(contractors, batchSize);

  // Calculate summary stats
  const hits = results.filter(r => r.hit).length;
  const misses = results.filter(r => !r.hit && r.actual !== null).length;
  const errors = results.filter(r => r.error).length;

  const summary = {
    total: results.length,
    hits,
    misses,
    errors,
    hit_rate: ((hits / (results.length - errors)) * 100).toFixed(1) + '%',
    results
  };

  // Output JSON to stdout (logs go to stderr)
  const output = JSON.stringify(summary, null, 2);

  if (outputFile) {
    fs.writeFileSync(outputFile, output);
    console.error(`\nResults written to ${outputFile}`);
  } else {
    console.log(output);
  }

  console.error(`\n=== SUMMARY ===`);
  console.error(`Total: ${results.length} | Hits: ${hits} | Misses: ${misses} | Errors: ${errors}`);
  console.error(`Hit rate: ${summary.hit_rate}`);

  // Close DB pool
  const db = require('../services/db_pg');
  await db.close();

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
