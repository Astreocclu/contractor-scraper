#!/usr/bin/env node
/**
 * Summarize hybrid_100 results into a markdown report.
 */

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..', 'experiments', 'hybrid_100');
const RESULTS_DIR = path.join(BASE_DIR, 'results');
const ANALYSIS_DIR = path.join(RESULTS_DIR, 'analysis');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function main() {
  const firstPass = loadJson(path.join(RESULTS_DIR, 'first_pass_sorted.json'));
  const finalRanked = loadJson(path.join(RESULTS_DIR, 'final_ranked.json'));
  const summary = loadJson(path.join(ANALYSIS_DIR, 'second_pass_summary.json'));

  const tiers = {};
  for (const row of firstPass) {
    tiers[row.tier] = (tiers[row.tier] || 0) + 1;
  }

  const top10 = finalRanked.slice(0, 10);
  const bottom10 = finalRanked.slice(-10).reverse();

  let md = `# Hybrid 100 Summary\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;

  md += `## First Pass Tier Distribution\n\n`;
  md += `| Tier | Count |\n|------|-------|\n`;
  for (const [tier, count] of Object.entries(tiers)) {
    md += `| ${tier} | ${count} |\n`;
  }

  md += `\n## Second Pass Summary\n\n`;
  md += `- Comparisons: ${summary.total_comparisons}\n`;
  md += `- Failed comparisons: ${summary.failed_comparisons}\n`;
  md += `- Cohorts: ${Object.keys(summary.cohorts).length}\n`;

  md += `\n## Top 10 (Final Ranked)\n\n`;
  md += `| Rank | Contractor | Tier | First Pass | Comparison |\n`;
  md += `|------|------------|------|------------|------------|\n`;
  top10.forEach((row, idx) => {
    md += `| ${idx + 1} | ${row.business_name} | ${row.tier} | ${row.score} | ${row.comparison_score ?? 'NA'} |\n`;
  });

  md += `\n## Bottom 10 (Final Ranked)\n\n`;
  md += `| Rank | Contractor | Tier | First Pass | Comparison |\n`;
  md += `|------|------------|------|------------|------------|\n`;
  bottom10.forEach((row, idx) => {
    md += `| ${idx + 1} | ${row.business_name} | ${row.tier} | ${row.score} | ${row.comparison_score ?? 'NA'} |\n`;
  });

  const outPath = path.join(ANALYSIS_DIR, 'summary.md');
  fs.writeFileSync(outPath, md);
  console.log(`Summary written to ${outPath}`);
}

main();
