#!/usr/bin/env node
/**
 * Second pass pairwise comparisons within cohorts (tier + vertical).
 */

const fs = require('fs');
const path = require('path');
const { buildPairwisePrompt } = require('../services/experiment_prompts');
const { callDeepSeek } = require('../services/council_callers');

const BASE_DIR = path.join(__dirname, '..', 'experiments', 'hybrid_100');
const SNAPSHOT_DIR = path.join(BASE_DIR, 'data', 'snapshots');
const RESULTS_DIR = path.join(BASE_DIR, 'results');
const PAIRWISE_DIR = path.join(RESULTS_DIR, 'pairwise');
const ANALYSIS_DIR = path.join(RESULTS_DIR, 'analysis');

const DEFAULT_K = 10;
const DEFAULT_LIMIT = 0;
const DEFAULT_MIN_COMPARISONS = 3;

const COHORT_PASSES = [
  {
    name: 'tier_vertical',
    keyFn: row => `${tierKey(row.tier)}::${primaryVertical(row)}`
  },
  {
    name: 'tier',
    keyFn: row => tierKey(row.tier)
  },
  {
    name: 'global',
    keyFn: () => 'ALL'
  }
];

function loadSnapshots() {
  const snapshotDir = fs.readdirSync(SNAPSHOT_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .pop();

  if (!snapshotDir) throw new Error('No snapshots found');

  const snapshotPath = path.join(SNAPSHOT_DIR, snapshotDir);
  const files = fs.readdirSync(snapshotPath)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  const map = new Map();
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(snapshotPath, f), 'utf-8'));
    map.set(data.contractor_id, data);
  }
  return map;
}

function loadFirstPass() {
  const firstPassPath = path.join(RESULTS_DIR, 'first_pass.json');
  return JSON.parse(fs.readFileSync(firstPassPath, 'utf-8'));
}

function primaryVertical(row) {
  const verticals = row.verticals || [];
  return verticals.length > 0 ? verticals[0] : 'unknown';
}

function tierKey(tier) {
  return tier || 'UNKNOWN';
}

function buildCohorts(rows, keyFn) {
  const cohorts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(row.contractor_id);
  }
  return cohorts;
}

function getTotalComparisons(winStats, contractorId) {
  return winStats.get(contractorId)?.total || 0;
}

function initBelowTarget(rows, winStats, minComparisons) {
  const below = new Set();
  for (const row of rows) {
    if (getTotalComparisons(winStats, row.contractor_id) < minComparisons) {
      below.add(row.contractor_id);
    }
  }
  return below;
}

function updateBelowTarget(belowTarget, winStats, contractorId, minComparisons) {
  if (getTotalComparisons(winStats, contractorId) >= minComparisons) {
    belowTarget.delete(contractorId);
  }
}

async function comparePair(a, b) {
  const prompt = buildPairwisePrompt(a, b);
  const response = await callDeepSeek(prompt.system, prompt.user, { temperature: 0, seed: 42, returnUsage: true });
  const content = typeof response === 'string' ? response : response.content;
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`No JSON in response: ${content.substring(0, 100)}`);
  }
  return {
    result: JSON.parse(match[0]),
    usage: response?.usage || {},
    cost: response?.cost || null
  };
}

function loadExistingComparisons(comparisonsPath, pairSet, winStats) {
  if (!fs.existsSync(comparisonsPath)) {
    return { count: 0, input_tokens: 0, output_tokens: 0, total_cost_usd: 0 };
  }

  const lines = fs.readFileSync(comparisonsPath, 'utf-8').trim().split('\n');
  let count = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCost = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    if (!rec.pair || rec.pair.length !== 2) continue;

    const aId = rec.pair[0];
    const bId = rec.pair[1];
    const min = Math.min(aId, bId);
    const max = Math.max(aId, bId);
    pairSet.add(`${min}_${max}`);

    if (!rec.winner) continue;

    const aStats = winStats.get(aId) || { wins: 0, losses: 0, ties: 0, total: 0 };
    const bStats = winStats.get(bId) || { wins: 0, losses: 0, ties: 0, total: 0 };

    if (rec.winner === 'A') {
      aStats.wins++;
      bStats.losses++;
    } else if (rec.winner === 'B') {
      bStats.wins++;
      aStats.losses++;
    } else {
      aStats.ties++;
      bStats.ties++;
    }

    aStats.total++;
    bStats.total++;
    winStats.set(aId, aStats);
    winStats.set(bId, bStats);
    count++;

    if (rec.usage) {
      inputTokens += rec.usage.prompt_tokens || 0;
      outputTokens += rec.usage.completion_tokens || 0;
    }
    if (typeof rec.cost_usd === 'number') {
      totalCost += rec.cost_usd;
    } else if (rec.cost && typeof rec.cost.total_cost_usd === 'number') {
      totalCost += rec.cost.total_cost_usd;
    }
  }
  return { count, input_tokens: inputTokens, output_tokens: outputTokens, total_cost_usd: totalCost };
}

async function runCohortPass({
  passName,
  cohorts,
  snapshots,
  pairSet,
  winStats,
  comparisonsStream,
  minComparisons,
  belowTarget,
  k,
  limit
}) {
  let newComparisons = 0;
  let failedComparisons = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costTotal = 0;
  let stopEarly = false;

  for (const [cohortKey, ids] of cohorts.entries()) {
    if (belowTarget.size === 0) break;
    if (ids.length < 2) continue;

    const sortedIds = [...ids].sort((a, b) => a - b);

    for (let i = 0; i < sortedIds.length; i++) {
      if (belowTarget.size === 0) break;
      const aId = sortedIds[i];

      for (let j = 1; j <= Math.min(k, sortedIds.length - 1); j++) {
        if (belowTarget.size === 0) break;
        const bId = sortedIds[(i + j) % sortedIds.length];
        const min = Math.min(aId, bId);
        const max = Math.max(aId, bId);
        const pairKey = `${min}_${max}`;

        if (pairSet.has(pairKey)) continue;
        if (!belowTarget.has(aId) && !belowTarget.has(bId)) continue;

        const aSnap = snapshots.get(aId);
        const bSnap = snapshots.get(bId);
        if (!aSnap || !bSnap) continue;

        pairSet.add(pairKey);

        try {
          const result = await comparePair(aSnap, bSnap);
          newComparisons++;

          const winner = result.result.winner;
          const aStats = winStats.get(aId) || { wins: 0, losses: 0, ties: 0, total: 0 };
          const bStats = winStats.get(bId) || { wins: 0, losses: 0, ties: 0, total: 0 };

          if (winner === 'A') {
            aStats.wins++;
            bStats.losses++;
          } else if (winner === 'B') {
            bStats.wins++;
            aStats.losses++;
          } else {
            aStats.ties++;
            bStats.ties++;
          }

          aStats.total++;
          bStats.total++;
          winStats.set(aId, aStats);
          winStats.set(bId, bStats);

          updateBelowTarget(belowTarget, winStats, aId, minComparisons);
          updateBelowTarget(belowTarget, winStats, bId, minComparisons);

          if (result.usage) {
            inputTokens += result.usage.prompt_tokens || 0;
            outputTokens += result.usage.completion_tokens || 0;
          }
          if (result.cost && typeof result.cost.total_cost_usd === 'number') {
            costTotal += result.cost.total_cost_usd;
          }

          comparisonsStream.write(JSON.stringify({
            cohort_mode: passName,
            cohort: cohortKey,
            pair: [aId, bId],
            winner: winner,
            confidence: result.result.confidence,
            reasoning: result.result.reasoning,
            usage: result.usage,
            cost_usd: result.cost?.total_cost_usd ?? null,
            pricing: result.cost?.pricing ?? null
          }) + '\n');
        } catch (err) {
          failedComparisons++;
          comparisonsStream.write(JSON.stringify({
            cohort_mode: passName,
            cohort: cohortKey,
            pair: [aId, bId],
            error: err.message
          }) + '\n');
        }

        if (limit > 0 && newComparisons >= limit) {
          stopEarly = true;
          break;
        }
      }

      if (stopEarly) break;
    }

    if (stopEarly) break;
  }

  return { newComparisons, failedComparisons, stopEarly, inputTokens, outputTokens, costTotal };
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.find(arg => !arg.startsWith('--'));
  const k = parseInt(positional || `${DEFAULT_K}`, 10);

  const limitArgIndex = args.indexOf('--limit');
  const limit = limitArgIndex !== -1 ? parseInt(args[limitArgIndex + 1], 10) : DEFAULT_LIMIT;

  const minArgIndex = args.indexOf('--min');
  const targetArgIndex = args.indexOf('--target');
  const minComparisons = minArgIndex !== -1
    ? parseInt(args[minArgIndex + 1], 10)
    : targetArgIndex !== -1
      ? parseInt(args[targetArgIndex + 1], 10)
      : DEFAULT_MIN_COMPARISONS;

  if (!fs.existsSync(PAIRWISE_DIR)) fs.mkdirSync(PAIRWISE_DIR, { recursive: true });
  if (!fs.existsSync(ANALYSIS_DIR)) fs.mkdirSync(ANALYSIS_DIR, { recursive: true });

  const firstPass = loadFirstPass();
  const snapshots = loadSnapshots();

  const winStats = new Map();
  const pairSet = new Set();
  const comparisonsPath = path.join(PAIRWISE_DIR, 'comparisons.jsonl');
  const comparisonsStream = fs.createWriteStream(comparisonsPath, { flags: 'a' });

  let totalComparisons = 0;
  let failedComparisons = 0;
  let newComparisons = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let stopEarly = false;

  const existing = loadExistingComparisons(comparisonsPath, pairSet, winStats);
  totalComparisons = existing.count;
  totalInputTokens += existing.input_tokens;
  totalOutputTokens += existing.output_tokens;
  totalCostUsd += existing.total_cost_usd;

  const belowTarget = initBelowTarget(firstPass, winStats, minComparisons);
  const passSummaries = [];

  for (const pass of COHORT_PASSES) {
    if (belowTarget.size === 0 || stopEarly) break;
    if (limit > 0 && newComparisons >= limit) {
      stopEarly = true;
      break;
    }

    const cohorts = buildCohorts(firstPass, pass.keyFn);
    const remainingLimit = limit > 0 ? (limit - newComparisons) : 0;
    const {
      newComparisons: passNew,
      failedComparisons: passFailed,
      stopEarly: passStop,
      inputTokens: passInputTokens,
      outputTokens: passOutputTokens,
      costTotal: passCost
    } = await runCohortPass({
      passName: pass.name,
      cohorts,
      snapshots,
      pairSet,
      winStats,
      comparisonsStream,
      minComparisons,
      belowTarget,
      k,
      limit: remainingLimit
    });

    newComparisons += passNew;
    totalComparisons += passNew;
    failedComparisons += passFailed;
    stopEarly = passStop;
    totalInputTokens += passInputTokens;
    totalOutputTokens += passOutputTokens;
    totalCostUsd += passCost;

    passSummaries.push({
      mode: pass.name,
      cohorts: cohorts.size,
      new_comparisons: passNew,
      input_tokens: passInputTokens,
      output_tokens: passOutputTokens,
      cost_usd: passCost
    });
  }

  comparisonsStream.end();

  if (stopEarly) {
    const cohortSummary = {};
    const tierVerticalCohorts = buildCohorts(firstPass, row => `${tierKey(row.tier)}::${primaryVertical(row)}`);
    for (const [cohortKey, ids] of tierVerticalCohorts.entries()) {
      cohortSummary[cohortKey] = { size: ids.length };
    }

    const pricing = {
      input_per_1m: parseFloat(process.env.DEEPSEEK_CHAT_INPUT_COST_PER_1M || '0.28'),
      output_per_1m: parseFloat(process.env.DEEPSEEK_CHAT_OUTPUT_COST_PER_1M || '0.42'),
      cache: 'miss'
    };

    fs.writeFileSync(path.join(ANALYSIS_DIR, 'second_pass_summary.json'), JSON.stringify({
      total_comparisons: totalComparisons,
      failed_comparisons: failedComparisons,
      min_comparisons: minComparisons,
      cohorts: cohortSummary,
      passes: passSummaries,
      remaining_below_target: belowTarget.size,
      tokens: {
        input: totalInputTokens,
        output: totalOutputTokens
      },
      cost_usd: totalCostUsd,
      pricing,
      note: `Stopped early after ${newComparisons} new comparisons`
    }, null, 2));

    console.log(`Second pass partial: new_comparisons=${newComparisons}, total=${totalComparisons}`);
    return;
  }

  const secondPass = firstPass.map(row => {
    const stats = winStats.get(row.contractor_id);
    const total = stats ? stats.total : 0;
    const hasCoverage = total >= minComparisons;
    const winRate = hasCoverage ? (stats.wins + 0.5 * stats.ties) / total : null;
    const comparisonScore = hasCoverage ? Math.round(winRate * 100) : null;
    return {
      ...row,
      comparisons: stats || { wins: 0, losses: 0, ties: 0, total: 0 },
      win_rate: winRate,
      comparison_score: comparisonScore
    };
  });

  fs.writeFileSync(path.join(RESULTS_DIR, 'second_pass.json'), JSON.stringify(secondPass, null, 2));

  const tierOrder = { TRUSTED: 1, LOW: 2, MODERATE: 3, HIGH: 4, CRITICAL: 5, UNKNOWN: 6 };
  const finalRanked = [...secondPass].sort((a, b) => {
    const ta = tierOrder[a.tier] || 6;
    const tb = tierOrder[b.tier] || 6;
    if (ta !== tb) return ta - tb;

    const ca = a.comparison_score ?? -1;
    const cb = b.comparison_score ?? -1;
    if (ca !== cb) return cb - ca;

    return (b.score ?? 0) - (a.score ?? 0);
  });

  fs.writeFileSync(path.join(RESULTS_DIR, 'final_ranked.json'), JSON.stringify(finalRanked, null, 2));

  const cohortSummary = {};
  const tierVerticalCohorts = buildCohorts(firstPass, row => `${tierKey(row.tier)}::${primaryVertical(row)}`);
  for (const [cohortKey, ids] of tierVerticalCohorts.entries()) {
    cohortSummary[cohortKey] = { size: ids.length };
  }

  const pricing = {
    input_per_1m: parseFloat(process.env.DEEPSEEK_CHAT_INPUT_COST_PER_1M || '0.28'),
    output_per_1m: parseFloat(process.env.DEEPSEEK_CHAT_OUTPUT_COST_PER_1M || '0.42'),
    cache: 'miss'
  };

  fs.writeFileSync(path.join(ANALYSIS_DIR, 'second_pass_summary.json'), JSON.stringify({
    total_comparisons: totalComparisons,
    failed_comparisons: failedComparisons,
    min_comparisons: minComparisons,
    cohorts: cohortSummary,
    passes: passSummaries,
    remaining_below_target: belowTarget.size,
    tokens: {
      input: totalInputTokens,
      output: totalOutputTokens
    },
    cost_usd: totalCostUsd,
    pricing
  }, null, 2));

  fs.writeFileSync(path.join(ANALYSIS_DIR, 'second_pass_cost.json'), JSON.stringify({
    total_comparisons: totalComparisons,
    min_comparisons: minComparisons,
    tokens: {
      input: totalInputTokens,
      output: totalOutputTokens
    },
    cost_usd: totalCostUsd,
    pricing,
    passes: passSummaries
  }, null, 2));

  console.log(`Second pass complete: comparisons=${totalComparisons}, failed=${failedComparisons}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
