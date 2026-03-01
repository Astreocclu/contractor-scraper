#!/usr/bin/env node
/**
 * Pick 10 contractors spread across score range for Claude vs DeepSeek benchmark
 */
const fp = require('../experiments/hybrid_100_C/results/first_pass.json');

const scored = fp
  .filter(c => c.score != null)
  .sort((a, b) => b.score - a.score);

console.log(`Score range: ${scored[0].score} to ${scored[scored.length - 1].score} (n=${scored.length})`);

const n = scored.length;
const indices = [0, 1, Math.floor(n * 0.25), Math.floor(n * 0.35), Math.floor(n * 0.5),
                 Math.floor(n * 0.55), Math.floor(n * 0.7), Math.floor(n * 0.8), n - 2, n - 1];

const seen = new Set();
const sample = [];
for (const i of indices) {
  if (!seen.has(i)) {
    seen.add(i);
    sample.push(scored[i]);
  }
}

console.log(`\nSample (${sample.length} contractors):`);
sample.forEach(c => console.log(`  ${c.contractor_id} ${c.business_name} score=${c.score} tier=${c.tier || 'none'}`));
console.log(`\nIDs: ${JSON.stringify(sample.map(c => c.contractor_id))}`);
