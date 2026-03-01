#!/usr/bin/env node
/**
 * Swiss-style second pass comparisons for hybrid_300.
 *
 * - Runs round-based pairings.
 * - Avoids repeat pairs when possible.
 * - Logs usage + cost per comparison.
 * - Writes results to experiments/hybrid_300/results/swiss/.
 */

const fs = require('fs');
const path = require('path');
const { buildPairwisePrompt } = require('../services/experiment_prompts');
const { callDeepSeek } = require('../services/council_callers');

const BASE_DIR = path.join(__dirname, '..', 'experiments', 'hybrid_300');
const SNAPSHOT_DIR = path.join(BASE_DIR, 'data', 'snapshots');
const RESULTS_DIR = path.join(BASE_DIR, 'results');
const SWISS_DIR = path.join(RESULTS_DIR, 'swiss');
const PAIRWISE_DIR = path.join(SWISS_DIR, 'pairwise');
const ANALYSIS_DIR = path.join(SWISS_DIR, 'analysis');

const DEFAULT_ROUNDS = 10;
const DEFAULT_K_FACTOR = 32;
const DEFAULT_SEED = 42;
const DEFAULT_RESUME = true;
const DEFAULT_MAX_FAILURES = 5;
const MODE = 'vertical';

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
  return map;
}

function loadFirstPass() {
  return JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'first_pass.json'), 'utf-8'));
}

function primaryVerticalFromRow(row, snapshots) {
  const rowVerticals = Array.isArray(row?.verticals) ? row.verticals : [];
  if (rowVerticals.length > 0) return rowVerticals[0];

  const snap = snapshots?.get(row.contractor_id);
  const snapVerticals = Array.isArray(snap?.verticals) ? snap.verticals : [];
  if (snapVerticals.length > 0) return snapVerticals[0];

  return 'unknown';
}

function buildVerticalGroups(firstPass, snapshots) {
  const groups = new Map();
  const idToVertical = new Map();

  for (const row of firstPass) {
    const vertical = primaryVerticalFromRow(row, snapshots);
    idToVertical.set(row.contractor_id, vertical);
    if (!groups.has(vertical)) groups.set(vertical, []);
    groups.get(vertical).push(row.contractor_id);
  }

  return { groups, idToVertical };
}

function detectComparisonsMode(comparisonsPath) {
  if (!fs.existsSync(comparisonsPath)) return null;
  const raw = fs.readFileSync(comparisonsPath, 'utf-8').trim();
  if (!raw) return null;
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec?.mode) return rec.mode;
    } catch (err) {
      continue;
    }
  }
  return 'legacy';
}

function pairKey(a, b) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return `${min}_${max}`;
}

function swissPairing(ids, scores, pairSet, rand) {
  const sorted = [...ids].sort((a, b) => {
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

    let partnerIndex = -1;
    for (let j = i + 1; j < sorted.length; j++) {
      const bId = sorted[j];
      if (used.has(bId)) continue;
      const key = pairKey(aId, bId);
      if (pairSet.has(key)) continue;
      partnerIndex = j;
      break;
    }

    if (partnerIndex === -1) {
      for (let j = i + 1; j < sorted.length; j++) {
        const bId = sorted[j];
        if (used.has(bId)) continue;
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

function updateScore(scoreMap, id, delta) {
  scoreMap.set(id, (scoreMap.get(id) || 0) + delta);
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
  const kIndex = args.indexOf('--k');
  const maxFailIndex = args.indexOf('--max-failures');
  let fresh = args.includes('--fresh');

  const rounds = roundsIndex !== -1 ? parseInt(args[roundsIndex + 1], 10) : DEFAULT_ROUNDS;
  const minComparisons = minIndex !== -1 ? parseInt(args[minIndex + 1], 10) : rounds;
  const seed = seedIndex !== -1 ? parseInt(args[seedIndex + 1], 10) : DEFAULT_SEED;
  const kFactor = kIndex !== -1 ? parseFloat(args[kIndex + 1]) : DEFAULT_K_FACTOR;
  const maxFailures = maxFailIndex !== -1 ? parseInt(args[maxFailIndex + 1], 10) : DEFAULT_MAX_FAILURES;

  if (!fs.existsSync(PAIRWISE_DIR)) fs.mkdirSync(PAIRWISE_DIR, { recursive: true });
  if (!fs.existsSync(ANALYSIS_DIR)) fs.mkdirSync(ANALYSIS_DIR, { recursive: true });

  const firstPass = loadFirstPass();
  const snapshots = loadSnapshots();
  const { groups: verticalGroups, idToVertical } = buildVerticalGroups(firstPass, snapshots);
  const ids = firstPass.map(row => row.contractor_id);

  const winStats = new Map();
  const scoreMap = new Map();
  ids.forEach(id => {
    winStats.set(id, { wins: 0, losses: 0, ties: 0, total: 0 });
    scoreMap.set(id, 0);
  });

  const pairSet = new Set();
  const comparisonsPath = path.join(PAIRWISE_DIR, 'comparisons.jsonl');
  const detectedMode = detectComparisonsMode(comparisonsPath);
  if (!fresh && detectedMode && detectedMode !== MODE) {
    console.log(`Existing comparisons mode=${detectedMode}; forcing fresh run for mode=${MODE}.`);
    fresh = true;
  }
  if (fresh && fs.existsSync(comparisonsPath)) {
    fs.unlinkSync(comparisonsPath);
  }
  const comparisonsStream = fs.createWriteStream(comparisonsPath, { flags: 'a' });

  let totalComparisons = 0;
  let failedComparisons = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costTotal = 0;
  let startRound = 1;
  let consecutiveFailures = 0;
  let stopEarly = false;

  if (!fresh && DEFAULT_RESUME && fs.existsSync(comparisonsPath)) {
    const lines = fs.readFileSync(comparisonsPath, 'utf-8').trim().split('\n');
    let maxRound = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      if (!rec.mode || rec.mode !== MODE) continue;
      if (rec.round && rec.round > maxRound) maxRound = rec.round;

      if (rec.usage) {
        inputTokens += rec.usage.prompt_tokens || 0;
        outputTokens += rec.usage.completion_tokens || 0;
      }
      if (typeof rec.cost_usd === 'number') {
        costTotal += rec.cost_usd;
      } else if (rec.cost && typeof rec.cost.total_cost_usd === 'number') {
        costTotal += rec.cost.total_cost_usd;
      }

      if (!rec.pair || rec.error) continue;
      const [aId, bId] = rec.pair;
      const key = pairKey(aId, bId);
      pairSet.add(key);

      const winner = rec.winner;
      const aStats = winStats.get(aId) || { wins: 0, losses: 0, ties: 0, total: 0 };
      const bStats = winStats.get(bId) || { wins: 0, losses: 0, ties: 0, total: 0 };

      if (winner === 'A') {
        aStats.wins++;
        bStats.losses++;
        updateScore(scoreMap, aId, 1);
      } else if (winner === 'B') {
        bStats.wins++;
        aStats.losses++;
        updateScore(scoreMap, bId, 1);
      } else {
        aStats.ties++;
        bStats.ties++;
        updateScore(scoreMap, aId, 0.5);
        updateScore(scoreMap, bId, 0.5);
      }

      aStats.total++;
      bStats.total++;
      winStats.set(aId, aStats);
      winStats.set(bId, bStats);
      totalComparisons++;
    }
    startRound = maxRound + 1;
  }

  const rand = mulberry32(seed);

  for (let round = startRound; round <= rounds; round++) {
    if (stopEarly) break;
    for (const [vertical, groupIds] of verticalGroups.entries()) {
      if (stopEarly) break;
      if (groupIds.length < 2) continue;

      const { pairs, byes } = swissPairing(groupIds, scoreMap, pairSet, rand);

      for (const [aId, bId] of pairs) {
        if (stopEarly) break;
        const key = pairKey(aId, bId);
        pairSet.add(key);

        const aSnap = snapshots.get(aId);
        const bSnap = snapshots.get(bId);
        if (!aSnap || !bSnap) continue;

        try {
          const result = await comparePair(aSnap, bSnap);
          totalComparisons++;
          consecutiveFailures = 0;

          const winner = result.result.winner;
          const aStats = winStats.get(aId);
          const bStats = winStats.get(bId);

          if (winner === 'A') {
            aStats.wins++;
            bStats.losses++;
            updateScore(scoreMap, aId, 1);
          } else if (winner === 'B') {
            bStats.wins++;
            aStats.losses++;
            updateScore(scoreMap, bId, 1);
          } else {
            aStats.ties++;
            bStats.ties++;
            updateScore(scoreMap, aId, 0.5);
            updateScore(scoreMap, bId, 0.5);
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
            vertical,
            round,
            pair: [aId, bId],
            winner,
            confidence: result.result.confidence,
            reasoning: result.result.reasoning,
            usage: result.usage,
            cost_usd: result.cost?.total_cost_usd ?? null,
            pricing: result.cost?.pricing ?? null
          }) + '\n');
        } catch (err) {
          failedComparisons++;
          consecutiveFailures++;
          comparisonsStream.write(JSON.stringify({
            mode: MODE,
            vertical,
            round,
            pair: [aId, bId],
            error: err.message
          }) + '\n');

          if (consecutiveFailures >= maxFailures) {
            stopEarly = true;
            break;
          }
        }
      }

      if (byes.length) {
        byes.forEach(id => {
          comparisonsStream.write(JSON.stringify({ mode: MODE, vertical, round, bye: id }) + '\n');
        });
      }
    }
  }

  comparisonsStream.end();

  const secondPass = firstPass.map(row => {
    const primaryVertical = idToVertical.get(row.contractor_id) || primaryVerticalFromRow(row, snapshots);
    const stats = winStats.get(row.contractor_id) || { wins: 0, losses: 0, ties: 0, total: 0 };
    const total = stats.total || 0;
    const hasCoverage = total >= minComparisons;
    const winRate = hasCoverage ? (stats.wins + 0.5 * stats.ties) / total : null;
    const comparisonScore = hasCoverage ? Math.round(winRate * 100) : null;
    return {
      ...row,
      primary_vertical: primaryVertical,
      comparisons: stats,
      win_rate: winRate,
      comparison_score: comparisonScore
    };
  });

  fs.writeFileSync(path.join(SWISS_DIR, 'second_pass.json'), JSON.stringify(secondPass, null, 2));

  const tierOrder = { TRUSTED: 1, LOW: 2, MODERATE: 3, HIGH: 4, CRITICAL: 5, UNKNOWN: 6 };
  const finalRanked = [...secondPass].sort((a, b) => {
    const ta = tierOrder[mapTier(a.score)] || 6;
    const tb = tierOrder[mapTier(b.score)] || 6;
    if (ta !== tb) return ta - tb;

    const ca = a.comparison_score ?? -1;
    const cb = b.comparison_score ?? -1;
    if (ca !== cb) return cb - ca;

    return (b.score ?? 0) - (a.score ?? 0);
  });

  fs.writeFileSync(path.join(SWISS_DIR, 'final_ranked.json'), JSON.stringify(finalRanked, null, 2));

  const pricing = {
    input_per_1m: parseFloat(process.env.DEEPSEEK_CHAT_INPUT_COST_PER_1M || '0.28'),
    output_per_1m: parseFloat(process.env.DEEPSEEK_CHAT_OUTPUT_COST_PER_1M || '0.42'),
    cache: 'miss'
  };

  fs.writeFileSync(path.join(ANALYSIS_DIR, 'summary.json'), JSON.stringify({
    mode: MODE,
    rounds,
    k_factor: kFactor,
    min_comparisons: minComparisons,
    total_comparisons: totalComparisons,
    failed_comparisons: failedComparisons,
    vertical_groups: Object.fromEntries([...verticalGroups.entries()].map(([vertical, groupIds]) => [vertical, groupIds.length])),
    tokens: {
      input: inputTokens,
      output: outputTokens
    },
    cost_usd: costTotal,
    pricing,
    resume_from_round: startRound
  }, null, 2));

  fs.writeFileSync(path.join(ANALYSIS_DIR, 'cost.json'), JSON.stringify({
    total_comparisons: totalComparisons,
    min_comparisons: minComparisons,
    tokens: {
      input: inputTokens,
      output: outputTokens
    },
    cost_usd: costTotal,
    pricing
  }, null, 2));

  console.log(`Swiss pass complete: rounds=${rounds}, comparisons=${totalComparisons}, failed=${failedComparisons}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
