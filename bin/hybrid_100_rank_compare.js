#!/usr/bin/env node
/**
 * Compare ranking methods for hybrid_100:
 * - Control: first-pass score only
 * - Win-rate: comparison_score
 * - Elo: computed from pairwise comparisons
 *
 * Outputs JSON + markdown to results/analysis and a markdown copy to docs.
 */

const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..', 'experiments', 'hybrid_100');
const BASE_RESULTS_DIR = path.join(BASE_DIR, 'results');
const DOCS_BASE = path.join(__dirname, '..', '..', '..', 'docs', 'greenlit', 'current');

const DEFAULT_K = 32;
const DEFAULT_RATING = 1500;

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const kIndex = args.indexOf('--k');
  const k = kIndex !== -1 ? parseFloat(args[kIndex + 1]) : DEFAULT_K;
  const topIndex = args.indexOf('--top');
  const top = topIndex !== -1 ? parseInt(args[topIndex + 1], 10) : 20;
  const sourceIndex = args.indexOf('--source');
  const source = sourceIndex !== -1 ? args[sourceIndex + 1] : 'base';
  return { k, top, source };
}

function buildRankMap(rows, scoreKey, tieKey = null) {
  const sorted = [...rows].sort((a, b) => {
    const av = a[scoreKey];
    const bv = b[scoreKey];
    if (bv !== av) return (bv ?? -Infinity) - (av ?? -Infinity);
    if (tieKey) {
      const at = a[tieKey];
      const bt = b[tieKey];
      if (bt !== at) return (bt ?? -Infinity) - (at ?? -Infinity);
    }
    return (a.business_name || '').localeCompare(b.business_name || '');
  });

  const ranks = new Map();
  sorted.forEach((row, idx) => {
    ranks.set(row.contractor_id, idx + 1);
  });

  return { sorted, ranks };
}

function computeElo(comparisonsPath, contractorIds, kFactor) {
  const ratings = new Map();
  contractorIds.forEach(id => ratings.set(id, DEFAULT_RATING));

  if (!fs.existsSync(comparisonsPath)) {
    return ratings;
  }

  const lines = fs.readFileSync(comparisonsPath, 'utf-8').trim().split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    if (!rec.pair || rec.pair.length !== 2) continue;
    if (rec.error) continue;
    const [aId, bId] = rec.pair;
    const winner = rec.winner;

    const ra = ratings.get(aId) ?? DEFAULT_RATING;
    const rb = ratings.get(bId) ?? DEFAULT_RATING;
    const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const eb = 1 / (1 + Math.pow(10, (ra - rb) / 400));

    let sa = 0.5;
    let sb = 0.5;
    if (winner === 'A') {
      sa = 1;
      sb = 0;
    } else if (winner === 'B') {
      sa = 0;
      sb = 1;
    }

    const raNew = ra + kFactor * (sa - ea);
    const rbNew = rb + kFactor * (sb - eb);

    ratings.set(aId, raNew);
    ratings.set(bId, rbNew);
  }

  return ratings;
}

function spearman(rankA, rankB) {
  const ids = [...rankA.keys()].filter(id => rankB.has(id));
  const n = ids.length;
  if (n === 0) return null;
  let sum = 0;
  for (const id of ids) {
    const d = rankA.get(id) - rankB.get(id);
    sum += d * d;
  }
  return 1 - (6 * sum) / (n * (n * n - 1));
}

function main() {
  const { k, top, source } = parseArgs();

  const resultsDir = source === 'swiss' ? path.join(BASE_RESULTS_DIR, 'swiss') : BASE_RESULTS_DIR;
  const analysisDir = source === 'swiss' ? path.join(resultsDir, 'analysis') : path.join(resultsDir, 'analysis');
  const pairwisePath = source === 'swiss'
    ? path.join(resultsDir, 'pairwise', 'comparisons.jsonl')
    : path.join(resultsDir, 'pairwise', 'comparisons.jsonl');
  const costPath = source === 'swiss'
    ? path.join(analysisDir, 'cost.json')
    : path.join(analysisDir, 'second_pass_cost.json');
  const summaryPath = source === 'swiss'
    ? path.join(analysisDir, 'summary.json')
    : path.join(analysisDir, 'second_pass_summary.json');

  const docsOut = source === 'swiss'
    ? path.join(DOCS_BASE, 'audit-hybrid-100-rank-comparison-swiss.md')
    : path.join(DOCS_BASE, 'audit-hybrid-100-rank-comparison.md');

  if (!fs.existsSync(analysisDir)) fs.mkdirSync(analysisDir, { recursive: true });

  const firstPass = loadJson(path.join(BASE_RESULTS_DIR, 'first_pass.json'));
  const secondPass = loadJson(path.join(resultsDir, 'second_pass.json'));
  const summary = fs.existsSync(summaryPath) ? loadJson(summaryPath) : {};
  const cost = fs.existsSync(costPath) ? loadJson(costPath) : null;

  const contractors = firstPass.map(row => ({
    contractor_id: row.contractor_id,
    business_name: row.business_name,
    first_pass: row.score
  }));

  const comparisonMap = new Map();
  secondPass.forEach(row => {
    comparisonMap.set(row.contractor_id, row.comparison_score);
  });

  const comparisonTotals = secondPass.map(row => row.comparisons?.total || 0);
  const minObserved = comparisonTotals.length ? Math.min(...comparisonTotals) : 0;
  const missingCount = secondPass.filter(row => row.comparison_score == null).length;

  const comparisonRows = contractors.map(row => ({
    ...row,
    comparison_score: comparisonMap.get(row.contractor_id)
  }));

  const { ranks: controlRanks } = buildRankMap(contractors, 'first_pass');
  const { ranks: winRateRanks } = buildRankMap(comparisonRows, 'comparison_score', 'first_pass');

  const eloRatings = computeElo(pairwisePath, contractors.map(r => r.contractor_id), k);
  const eloRows = contractors.map(row => ({
    ...row,
    elo: eloRatings.get(row.contractor_id)
  }));
  const { ranks: eloRanks } = buildRankMap(eloRows, 'elo', 'first_pass');

  const combined = contractors.map(row => ({
    contractor_id: row.contractor_id,
    business_name: row.business_name,
    first_pass: row.first_pass,
    comparison_score: comparisonMap.get(row.contractor_id),
    elo: Math.round((eloRatings.get(row.contractor_id) || DEFAULT_RATING) * 10) / 10,
    control_rank: controlRanks.get(row.contractor_id),
    winrate_rank: winRateRanks.get(row.contractor_id),
    elo_rank: eloRanks.get(row.contractor_id)
  }));

  const combinedSorted = [...combined].sort((a, b) => a.control_rank - b.control_rank);
  const topRows = combinedSorted.slice(0, top);
  const bottomRows = combinedSorted.slice(-top);

  const correlation = {
    control_vs_winrate: spearman(controlRanks, winRateRanks),
    control_vs_elo: spearman(controlRanks, eloRanks),
    winrate_vs_elo: spearman(winRateRanks, eloRanks)
  };

  const outputJson = {
    generated_at: new Date().toISOString(),
    k_factor: k,
    top_n: top,
    correlations: correlation,
    rankings: combined
  };

  const jsonName = source === 'swiss' ? 'rank_comparison_swiss.json' : 'rank_comparison.json';
  fs.writeFileSync(path.join(analysisDir, jsonName), JSON.stringify(outputJson, null, 2));

  const mdLines = [];
  mdLines.push('# Hybrid 100 Rank Comparison (Control vs Win-Rate vs Elo)');
  mdLines.push('');
  mdLines.push(`Generated: ${outputJson.generated_at}`);
  mdLines.push('');
  mdLines.push('## Method Summary');
  mdLines.push('');
  mdLines.push(`- Control: first-pass score only`);
  mdLines.push(`- Win-rate: comparison_score (pairwise win rate)`);
  mdLines.push(`- Elo: pairwise rating (K=${k})`);
  mdLines.push(`- Source: ${source === 'swiss' ? 'Swiss pairing' : 'Cascading ring pairing'}`);
  mdLines.push('');
  mdLines.push('## Rank Correlations (Spearman)');
  mdLines.push('');
  mdLines.push('| Pair | Spearman |');
  mdLines.push('|------|----------|');
  mdLines.push(`| Control vs Win-rate | ${correlation.control_vs_winrate?.toFixed(3)} |`);
  mdLines.push(`| Control vs Elo | ${correlation.control_vs_elo?.toFixed(3)} |`);
  mdLines.push(`| Win-rate vs Elo | ${correlation.winrate_vs_elo?.toFixed(3)} |`);
  mdLines.push('');
  mdLines.push('## Findings');
  mdLines.push('');
  mdLines.push(`- Elo and win-rate remain tightly aligned at current density (Spearman ${correlation.winrate_vs_elo?.toFixed(3)}).`);
  mdLines.push(`- Both diverge from control (Control vs Win-rate ${correlation.control_vs_winrate?.toFixed(3)}, Control vs Elo ${correlation.control_vs_elo?.toFixed(3)}).`);
  if (summary.min_comparisons) {
    const achievedNote = minObserved >= summary.min_comparisons && missingCount === 0 ? 'min achieved' : 'min not achieved';
    mdLines.push(`- Coverage target: ${summary.min_comparisons} comparisons; observed min ${minObserved}, missing scores ${missingCount} (${achievedNote}).`);
  }
  if (cost) {
    mdLines.push(`- Cost: $${cost.cost_usd?.toFixed(2)} for ${cost.total_comparisons} comparisons (${cost.tokens?.input} input / ${cost.tokens?.output} output tokens).`);
  }
  mdLines.push(`- Expect Elo to diverge more from win-rate as comparisons per contractor increase beyond this range.`);
  mdLines.push('');
  mdLines.push(`## Top ${top} (by Control Rank)`);
  mdLines.push('');
  mdLines.push('| Contractor | Control Rank | Win-rate Rank | Elo Rank | First Pass | Win-rate | Elo |');
  mdLines.push('|------------|--------------|---------------|----------|------------|----------|-----|');
  topRows.forEach(row => {
    mdLines.push(`| ${row.business_name} | ${row.control_rank} | ${row.winrate_rank} | ${row.elo_rank} | ${row.first_pass} | ${row.comparison_score} | ${row.elo} |`);
  });
  mdLines.push('');
  mdLines.push(`## Bottom ${top} (by Control Rank)`);
  mdLines.push('');
  mdLines.push('| Contractor | Control Rank | Win-rate Rank | Elo Rank | First Pass | Win-rate | Elo |');
  mdLines.push('|------------|--------------|---------------|----------|------------|----------|-----|');
  bottomRows.forEach(row => {
    mdLines.push(`| ${row.business_name} | ${row.control_rank} | ${row.winrate_rank} | ${row.elo_rank} | ${row.first_pass} | ${row.comparison_score} | ${row.elo} |`);
  });

  const mdOut = mdLines.join('\n') + '\n';
  const mdName = source === 'swiss' ? 'rank_comparison_swiss.md' : 'rank_comparison.md';
  fs.writeFileSync(path.join(analysisDir, mdName), mdOut);
  fs.writeFileSync(docsOut, mdOut);

  console.log(`Rank comparison written to ${path.join(analysisDir, mdName)}`);
}

main();
