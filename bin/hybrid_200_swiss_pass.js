#!/usr/bin/env node
/**
 * Swiss-style comparisons for combined 200-contractor pool.
 *
 * - Imports existing comparison history from Group A and B
 * - Seeds from holistic scores
 * - Runs additional rounds to reach minimum comparisons target
 *
 * Usage:
 *   node bin/hybrid_200_swiss_pass.js [--rounds=10] [--min=20] [--fresh]
 */

const fs = require('fs');
const path = require('path');
const { buildPairwisePrompt } = require('../services/experiment_prompts');
const { callDeepSeek } = require('../services/council_callers');

const BASE_DIR = path.join(__dirname, '..', 'experiments', 'hybrid_200');
const SNAPSHOT_DIR = path.join(BASE_DIR, 'data', 'snapshots');
const RESULTS_DIR = path.join(BASE_DIR, 'results');
const SWISS_DIR = path.join(RESULTS_DIR, 'swiss');
const PAIRWISE_DIR = path.join(SWISS_DIR, 'pairwise');
const ANALYSIS_DIR = path.join(SWISS_DIR, 'analysis');

// Source directories for importing history
const GROUP_A_COMPARISONS = path.join(__dirname, '..', 'experiments', 'hybrid_100', 'results', 'swiss', 'pairwise', 'comparisons.jsonl');
const GROUP_B_COMPARISONS = path.join(__dirname, '..', 'experiments', 'hybrid_100_B', 'results', 'swiss', 'pairwise', 'comparisons.jsonl');

const DEFAULT_ROUNDS = 10;
const DEFAULT_MIN = 20;
const DEFAULT_K_FACTOR = 32;
const DEFAULT_SEED = 42;
const MODE = 'combined_200';

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

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
  console.log(`Loaded ${map.size} snapshots`);
  return map;
}

function loadFirstPass() {
  return JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'first_pass.json'), 'utf-8'));
}

function pairKey(a, b) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return `${min}_${max}`;
}

function importHistory(comparisonsPath, winStats, pairSet, pairCounts) {
  if (!fs.existsSync(comparisonsPath)) return 0;

  const lines = fs.readFileSync(comparisonsPath, 'utf-8').trim().split('\n');
  let imported = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (!rec.pair || rec.error) continue;

      const [aId, bId] = rec.pair;
      const key = pairKey(aId, bId);
      pairSet.add(key);

      // Track comparison counts per contractor
      pairCounts.set(aId, (pairCounts.get(aId) || 0) + 1);
      pairCounts.set(bId, (pairCounts.get(bId) || 0) + 1);

      // Update win stats
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
      imported++;
    } catch (err) {
      continue;
    }
  }

  return imported;
}

function swissPairing(ids, scores, pairSet, pairCounts, minTarget, rand) {
  // Sort by score (seeded), then by comparison count (prioritize under-compared)
  const sorted = [...ids].sort((a, b) => {
    const countA = pairCounts.get(a) || 0;
    const countB = pairCounts.get(b) || 0;

    // Prioritize those who need more comparisons
    const needsA = countA < minTarget;
    const needsB = countB < minTarget;
    if (needsA !== needsB) return needsA ? -1 : 1;

    // Then by score
    const sa = scores.get(a) || 0;
    const sb = scores.get(b) || 0;
    if (sb !== sa) return sb - sa;

    return rand() - 0.5;
  });

  const used = new Set();
  const pairs = [];
  const byes = [];

  for (let i = 0; i < sorted.length; i++) {
    const aId = sorted[i];
    if (used.has(aId)) continue;

    // Skip if already has enough comparisons
    const aCount = pairCounts.get(aId) || 0;
    if (aCount >= minTarget) {
      continue;
    }

    let partnerIndex = -1;
    for (let j = i + 1; j < sorted.length; j++) {
      const bId = sorted[j];
      if (used.has(bId)) continue;

      const bCount = pairCounts.get(bId) || 0;
      if (bCount >= minTarget) continue;

      const key = pairKey(aId, bId);
      if (pairSet.has(key)) continue;

      partnerIndex = j;
      break;
    }

    // Allow repeats if no fresh pairs available
    if (partnerIndex === -1) {
      for (let j = i + 1; j < sorted.length; j++) {
        const bId = sorted[j];
        if (used.has(bId)) continue;
        const bCount = pairCounts.get(bId) || 0;
        if (bCount >= minTarget) continue;
        partnerIndex = j;
        break;
      }
    }

    if (partnerIndex === -1) {
      byes.push(aId);
      used.add(aId);
      continue;
    }

    const bId = sorted[partnerIndex];
    used.add(aId);
    used.add(bId);
    pairs.push([aId, bId]);
  }

  return { pairs, byes };
}

async function comparePair(aSnap, bSnap) {
  const prompt = buildPairwisePrompt(aSnap, bSnap);
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

function mapTier(score) {
  if (score >= 85) return 'TRUSTED';
  if (score >= 70) return 'LOW';
  if (score >= 55) return 'MODERATE';
  if (score >= 35) return 'HIGH';
  return 'CRITICAL';
}

async function main() {
  const args = process.argv.slice(2);
  const roundsIndex = args.indexOf('--rounds');
  const minIndex = args.indexOf('--min');
  const seedIndex = args.indexOf('--seed');
  const fresh = args.includes('--fresh');

  const rounds = roundsIndex !== -1 ? parseInt(args[roundsIndex + 1], 10) : DEFAULT_ROUNDS;
  const minComparisons = minIndex !== -1 ? parseInt(args[minIndex + 1], 10) : DEFAULT_MIN;
  const seed = seedIndex !== -1 ? parseInt(args[seedIndex + 1], 10) : DEFAULT_SEED;

  if (!fs.existsSync(PAIRWISE_DIR)) fs.mkdirSync(PAIRWISE_DIR, { recursive: true });
  if (!fs.existsSync(ANALYSIS_DIR)) fs.mkdirSync(ANALYSIS_DIR, { recursive: true });

  const firstPass = loadFirstPass();
  const snapshots = loadSnapshots();
  const ids = firstPass.map(row => row.contractor_id);

  console.log(`Running Swiss pass for ${ids.length} contractors, target ${minComparisons} comparisons each`);

  const winStats = new Map();
  const scoreMap = new Map();
  const pairCounts = new Map();
  const pairSet = new Set();

  // Build holistic score lookup and initialize
  for (const row of firstPass) {
    scoreMap.set(row.contractor_id, row.score || 50);
    winStats.set(row.contractor_id, { wins: 0, losses: 0, ties: 0, total: 0 });
    pairCounts.set(row.contractor_id, 0);
  }

  // Import existing history unless --fresh
  if (!fresh) {
    const importedA = importHistory(GROUP_A_COMPARISONS, winStats, pairSet, pairCounts);
    const importedB = importHistory(GROUP_B_COMPARISONS, winStats, pairSet, pairCounts);
    console.log(`Imported history: ${importedA} from Group A, ${importedB} from Group B`);
    console.log(`Total existing pairs: ${pairSet.size}`);

    // Show comparison count distribution
    const counts = [...pairCounts.values()];
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    const avgCount = (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1);
    console.log(`Comparison counts: min=${minCount}, max=${maxCount}, avg=${avgCount}`);

    const needMore = counts.filter(c => c < minComparisons).length;
    console.log(`Contractors needing more comparisons: ${needMore}/${ids.length}`);
  }

  const comparisonsPath = path.join(PAIRWISE_DIR, 'comparisons.jsonl');
  if (fresh && fs.existsSync(comparisonsPath)) {
    fs.unlinkSync(comparisonsPath);
  }
  const comparisonsStream = fs.createWriteStream(comparisonsPath, { flags: 'a' });

  let newComparisons = 0;
  let failedComparisons = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costTotal = 0;

  const rand = mulberry32(seed);

  for (let round = 1; round <= rounds; round++) {
    const { pairs, byes } = swissPairing(ids, scoreMap, pairSet, pairCounts, minComparisons, rand);

    if (pairs.length === 0) {
      console.log(`Round ${round}: No pairs needed (all contractors have ${minComparisons}+ comparisons)`);
      break;
    }

    console.log(`Round ${round}: ${pairs.length} pairs, ${byes.length} byes`);

    for (const [aId, bId] of pairs) {
      const key = pairKey(aId, bId);
      pairSet.add(key);
      pairCounts.set(aId, (pairCounts.get(aId) || 0) + 1);
      pairCounts.set(bId, (pairCounts.get(bId) || 0) + 1);

      const aSnap = snapshots.get(aId);
      const bSnap = snapshots.get(bId);
      if (!aSnap || !bSnap) continue;

      try {
        const result = await comparePair(aSnap, bSnap);
        newComparisons++;

        const winner = result.result.winner;
        const aStats = winStats.get(aId);
        const bStats = winStats.get(bId);

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

        if (result.usage) {
          inputTokens += result.usage.prompt_tokens || 0;
          outputTokens += result.usage.completion_tokens || 0;
        }
        if (result.cost && typeof result.cost.total_cost_usd === 'number') {
          costTotal += result.cost.total_cost_usd;
        }

        comparisonsStream.write(JSON.stringify({
          mode: MODE,
          round,
          pair: [aId, bId],
          winner,
          confidence: result.result.confidence,
          reasoning: result.result.reasoning,
          usage: result.usage,
          cost_usd: result.cost?.total_cost_usd ?? null
        }) + '\n');
      } catch (err) {
        failedComparisons++;
        comparisonsStream.write(JSON.stringify({
          mode: MODE,
          round,
          pair: [aId, bId],
          error: err.message
        }) + '\n');
      }
    }
  }

  comparisonsStream.end();

  // Build final rankings
  const finalRanked = firstPass.map(row => {
    const stats = winStats.get(row.contractor_id) || { wins: 0, losses: 0, ties: 0, total: 0 };
    const total = stats.total || 0;
    const hasCoverage = total >= minComparisons;
    const winRate = total > 0 ? (stats.wins + 0.5 * stats.ties) / total : null;
    const comparisonScore = hasCoverage ? Math.round(winRate * 100) : null;
    return {
      ...row,
      comparisons: stats,
      comparison_count: total,
      win_rate: winRate,
      comparison_score: comparisonScore,
      tier: mapTier(row.score)
    };
  });

  const tierOrder = { TRUSTED: 1, LOW: 2, MODERATE: 3, HIGH: 4, CRITICAL: 5 };
  finalRanked.sort((a, b) => {
    const ta = tierOrder[a.tier] || 6;
    const tb = tierOrder[b.tier] || 6;
    if (ta !== tb) return ta - tb;

    const ca = a.comparison_score ?? -1;
    const cb = b.comparison_score ?? -1;
    if (ca !== cb) return cb - ca;

    return (b.score ?? 0) - (a.score ?? 0);
  });

  fs.writeFileSync(path.join(SWISS_DIR, 'final_ranked.json'), JSON.stringify(finalRanked, null, 2));

  // Summary stats
  const counts = [...pairCounts.values()];
  const atTarget = counts.filter(c => c >= minComparisons).length;

  fs.writeFileSync(path.join(ANALYSIS_DIR, 'summary.json'), JSON.stringify({
    mode: MODE,
    rounds,
    min_comparisons: minComparisons,
    new_comparisons: newComparisons,
    failed_comparisons: failedComparisons,
    total_contractors: ids.length,
    at_target: atTarget,
    tokens: { input: inputTokens, output: outputTokens },
    cost_usd: costTotal
  }, null, 2));

  console.log(`\nSwiss pass complete:`);
  console.log(`  New comparisons: ${newComparisons}`);
  console.log(`  Failed: ${failedComparisons}`);
  console.log(`  Cost: $${costTotal.toFixed(2)}`);
  console.log(`  Contractors at ${minComparisons}+ comparisons: ${atTarget}/${ids.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
