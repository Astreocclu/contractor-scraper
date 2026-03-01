#!/usr/bin/env node
/**
 * Swiss-style second pass comparisons for hybrid_100.
 *
 * - Runs round-based pairings.
 * - Avoids repeat pairs when possible.
 * - Logs usage + cost per comparison.
 * - Seeds from holistic scores by default (use --no-seed to disable).
 * - Writes results to experiments/hybrid_100[_B]/results/swiss/.
 *
 * Usage:
 *   node bin/hybrid_100_swiss_pass.js [--group=A|B] [--rounds=10] [--no-seed] [--fresh]
 */

const fs = require('fs');
const path = require('path');
const { buildPairwisePrompt } = require('../services/experiment_prompts');
const { callDeepSeek, callClaude } = require('../services/council_callers');

// Model selection: --model=opus|sonnet|deepseek (default: deepseek)
const modelArg = process.argv.find(a => a.startsWith('--model='));
const MODEL_CHOICE = modelArg ? modelArg.split('=')[1] : 'deepseek';
const CLAUDE_MODELS = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001',
};

// Support Group A, B, or C
const groupArg = process.argv.find(a => a.startsWith('--group='));
const group = groupArg ? groupArg.split('=')[1] : 'A';
const experimentDir = group === 'A' ? 'hybrid_100' : `hybrid_100_${group}`;

const BASE_DIR = path.join(__dirname, '..', 'experiments', experimentDir);
const SNAPSHOT_DIR = path.join(BASE_DIR, 'data', 'snapshots');
const RESULTS_DIR = path.join(BASE_DIR, 'results');
const SWISS_DIR = path.join(RESULTS_DIR, 'swiss');
const PAIRWISE_DIR = path.join(SWISS_DIR, 'pairwise');
const ANALYSIS_DIR = path.join(SWISS_DIR, 'analysis');

console.log(`Running Swiss pass for Group ${group} (${experimentDir}) [model: ${MODEL_CHOICE}]`);

const DEFAULT_ROUNDS = 10;
const DEFAULT_K_FACTOR = 32;
const DEFAULT_SEED = 42;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_COMPARE_RETRIES = 2;
const DEFAULT_RESUME = true;
const MODE = 'vertical';
const MAX_SNAPSHOT_CHARS = parseInt(process.env.SWISS_SNAPSHOT_MAX_CHARS || '45000', 10);
const MAX_TEXT_CHARS = 500;
const MAX_ARRAY_ITEMS = 5;
const MAX_OBJECT_KEYS = 12;
const SOURCE_PRIORITY = [
  'google_maps_local',
  'google_maps_hq',
  'google_maps_listed',
  'review_analysis',
  'bbb',
  'court_records',
  'county_liens',
  'tx_ag_complaints',
  'tx_sos_search',
  'tx_franchise',
  'open_corporates',
  'yelp',
  'homeadvisor',
  'angi',
  'houzz',
  'trustpilot',
  'buildzoom'
];

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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

function primaryVerticalFromRow(row, snapshots, cohortVertical = null) {
  const rowVerticals = Array.isArray(row?.verticals) ? row.verticals : [];
  if (cohortVertical && rowVerticals.includes(cohortVertical)) return cohortVertical;
  if (rowVerticals.length > 0) return rowVerticals[0];

  const snap = snapshots?.get(row.contractor_id);
  const snapVerticals = Array.isArray(snap?.verticals) ? snap.verticals : [];
  if (cohortVertical && snapVerticals.includes(cohortVertical)) return cohortVertical;
  if (snapVerticals.length > 0) return snapVerticals[0];

  return cohortVertical || 'unknown';
}

function inferCohortVertical(firstPass, snapshots) {
  const counts = new Map();

  for (const row of firstPass) {
    const verticals = [];
    if (Array.isArray(row?.verticals)) verticals.push(...row.verticals);
    const snap = snapshots?.get(row.contractor_id);
    if (Array.isArray(snap?.verticals)) verticals.push(...snap.verticals);

    for (const v of verticals) {
      const key = String(v || '').trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.length ? sorted[0][0] : null;
}

function buildVerticalGroups(firstPass, snapshots, cohortVertical = null) {
  const groups = new Map();
  const idToVertical = new Map();

  for (const row of firstPass) {
    const vertical = primaryVerticalFromRow(row, snapshots, cohortVertical);
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

function truncateText(value, maxChars = MAX_TEXT_CHARS) {
  if (typeof value !== 'string') return value;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...[truncated ${value.length - maxChars} chars]`;
}

function compactValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncateText(value);
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map(item => compactValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push({ _truncated_items: value.length - MAX_ARRAY_ITEMS });
    }
    return items;
  }

  const keys = Object.keys(value);
  const limit = depth === 0 ? MAX_OBJECT_KEYS : Math.max(6, MAX_OBJECT_KEYS - 2);
  const out = {};
  for (const key of keys.slice(0, limit)) {
    out[key] = compactValue(value[key], depth + 1);
  }
  if (keys.length > limit) {
    out._truncated_keys = keys.length - limit;
  }
  return out;
}

function compactSourceEntry(entry) {
  if (!entry || typeof entry !== 'object') return compactValue(entry);

  const out = {};
  if (entry.status !== undefined) out.status = entry.status;
  if (entry.error !== undefined) out.error = truncateText(String(entry.error), 200);
  if (entry.source_url) out.source_url = truncateText(entry.source_url, 180);
  if (entry.updated_at) out.updated_at = entry.updated_at;

  const sourceData = entry.data !== undefined ? entry.data : entry;
  out.data = compactValue(sourceData);
  return out;
}

function compactSnapshotForPairwise(snapshot) {
  const base = {
    contractor_id: snapshot.contractor_id,
    business_name: snapshot.business_name,
    city: snapshot.city,
    state: snapshot.state,
    verticals: snapshot.verticals,
    archetype: snapshot.archetype,
    expected_score: snapshot.expected_score,
    snapshot_at: snapshot.snapshot_at,
    sources: {}
  };

  const sources = snapshot?.sources || {};
  const availableSources = Object.keys(sources);
  const omitted = [];
  for (const sourceName of SOURCE_PRIORITY) {
    if (!sources[sourceName]) continue;
    base.sources[sourceName] = compactSourceEntry(sources[sourceName]);
    if (JSON.stringify(base).length > MAX_SNAPSHOT_CHARS) {
      delete base.sources[sourceName];
      omitted.push(sourceName);
    }
  }

  base.source_count_available = availableSources.length;
  base.source_count_included = Object.keys(base.sources).length;
  if (omitted.length) {
    base.omitted_sources_due_to_size = omitted;
  }

  return base;
}

async function comparePair(aSnap, bSnap) {
  const prompt = buildPairwisePrompt(aSnap, bSnap);

  let response;
  if (MODEL_CHOICE === 'deepseek') {
    response = await callDeepSeek(prompt.system, prompt.user, { temperature: 0, seed: 42, returnUsage: true });
  } else {
    const claudeModel = CLAUDE_MODELS[MODEL_CHOICE] || CLAUDE_MODELS.opus;
    response = await callClaude(prompt.system, prompt.user, { model: claudeModel, temperature: 0, returnUsage: true });
  }

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function comparePairWithRetry(aSnap, bSnap, retries) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await comparePair(aSnap, bSnap);
    } catch (err) {
      if (attempt >= retries) throw err;
      const backoffMs = Math.min(15000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 500);
      console.log(`    retry ${attempt + 1}/${retries} after error: ${err.message.substring(0, 120)}`);
      await sleep(backoffMs);
    }
  }
  throw new Error('Unexpected retry loop exit');
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

function getArgValue(args, name) {
  const eqArg = args.find(arg => arg.startsWith(`${name}=`));
  if (eqArg) return eqArg.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const roundsValue = getArgValue(args, '--rounds');
  const minValue = getArgValue(args, '--min');
  const seedValue = getArgValue(args, '--seed');
  const kValue = getArgValue(args, '--k');
  const concurrencyValue = getArgValue(args, '--concurrency');
  const retriesValue = getArgValue(args, '--retries');
  let fresh = args.includes('--fresh');

  const rounds = roundsValue ? parseInt(roundsValue, 10) : DEFAULT_ROUNDS;
  const minComparisons = minValue ? parseInt(minValue, 10) : rounds;
  const seed = seedValue ? parseInt(seedValue, 10) : DEFAULT_SEED;
  const kFactor = kValue ? parseFloat(kValue) : DEFAULT_K_FACTOR;
  const concurrency = Math.max(1, parseInt(concurrencyValue || `${DEFAULT_CONCURRENCY}`, 10));
  const retries = Math.max(0, parseInt(retriesValue || `${DEFAULT_COMPARE_RETRIES}`, 10));

  if (!fs.existsSync(PAIRWISE_DIR)) fs.mkdirSync(PAIRWISE_DIR, { recursive: true });
  if (!fs.existsSync(ANALYSIS_DIR)) fs.mkdirSync(ANALYSIS_DIR, { recursive: true });

  const firstPass = loadFirstPass();
  const snapshots = loadSnapshots();
  const comparisonSnapshots = new Map();
  let largestSnapshotChars = 0;
  for (const [id, snapshot] of snapshots.entries()) {
    const compacted = compactSnapshotForPairwise(snapshot);
    comparisonSnapshots.set(id, compacted);
    const chars = JSON.stringify(compacted).length;
    if (chars > largestSnapshotChars) largestSnapshotChars = chars;
  }
  const inferredCohortVertical = inferCohortVertical(firstPass, snapshots);
  const strictVertical = process.env.SWISS_STRICT_VERTICAL !== 'false';

  if (strictVertical && inferredCohortVertical) {
    const mismatched = firstPass
      .filter((row) => {
        const rowVerticals = Array.isArray(row?.verticals) ? row.verticals : [];
        const snapVerticals = Array.isArray(snapshots.get(row.contractor_id)?.verticals)
          ? snapshots.get(row.contractor_id).verticals
          : [];
        return !rowVerticals.includes(inferredCohortVertical) && !snapVerticals.includes(inferredCohortVertical);
      })
      .map((row) => row.contractor_id);

    if (mismatched.length > 0) {
      throw new Error(`Strict vertical guard failed for ${mismatched.length} contractors (cohort vertical=${inferredCohortVertical}). Sample IDs: ${mismatched.slice(0, 10).join(', ')}`);
    }
  }

  const { groups: verticalGroups, idToVertical } = buildVerticalGroups(firstPass, snapshots, inferredCohortVertical);
  const ids = firstPass.map(row => row.contractor_id);
  console.log(`Compacted snapshots prepared: ${comparisonSnapshots.size} (max ${largestSnapshotChars} chars)`);
  if (inferredCohortVertical) {
    console.log(`Vertical enforcement: cohort=${inferredCohortVertical} strict=${strictVertical ? 'on' : 'off'}`);
  }

  const winStats = new Map();
  const scoreMap = new Map();

  // Build a lookup from firstPass for holistic scores
  const holisticScores = new Map();
  for (const row of firstPass) {
    holisticScores.set(row.contractor_id, row.score || 50);
  }

  // Seed from holistic scores (NOT zero!) so early rounds pair similar contractors
  const seedFromHolistic = !args.includes('--no-seed');
  ids.forEach(id => {
    winStats.set(id, { wins: 0, losses: 0, ties: 0, total: 0 });
    scoreMap.set(id, seedFromHolistic ? (holisticScores.get(id) || 50) : 0);
  });

  if (seedFromHolistic) {
    console.log('Seeding Swiss ratings from holistic scores (use --no-seed to disable)');
  } else {
    console.log('Starting all ratings at 0 (--no-seed mode)');
  }

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

  if (!fresh && DEFAULT_RESUME && fs.existsSync(comparisonsPath)) {
    const lines = fs.readFileSync(comparisonsPath, 'utf-8').trim().split('\n');
    let maxSuccessfulRound = 0;
    let maxSeenRound = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line);
      if (!rec.mode || rec.mode !== MODE) continue;
      if (rec.round && rec.round > maxSeenRound) maxSeenRound = rec.round;

      if (rec.usage) {
        inputTokens += rec.usage.prompt_tokens || 0;
        outputTokens += rec.usage.completion_tokens || 0;
      }
      if (typeof rec.cost_usd === 'number') {
        costTotal += rec.cost_usd;
      } else if (rec.cost && typeof rec.cost.total_cost_usd === 'number') {
        costTotal += rec.cost.total_cost_usd;
      }

      if (rec.error) {
        failedComparisons++;
        continue;
      }
      if (!rec.pair) continue;
      if (rec.round && rec.round > maxSuccessfulRound) maxSuccessfulRound = rec.round;
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
    startRound = maxSuccessfulRound + 1;
    if (maxSeenRound > maxSuccessfulRound) {
      console.log(`Detected failed/incomplete rounds up to ${maxSeenRound}; resuming from last successful round ${maxSuccessfulRound}.`);
    }
  }

  const rand = mulberry32(seed);

  for (let round = startRound; round <= rounds; round++) {
    const roundStartComparisons = totalComparisons;
    const roundStartFailures = failedComparisons;
    for (const [vertical, groupIds] of verticalGroups.entries()) {
      if (groupIds.length < 2) continue;
      const { pairs, byes } = swissPairing(groupIds, scoreMap, pairSet, rand);

      for (let i = 0; i < pairs.length; i += concurrency) {
        const batch = pairs.slice(i, i + concurrency);
        const batchNum = Math.floor(i / concurrency) + 1;
        const totalBatches = Math.ceil(pairs.length / concurrency);
        console.log(`Round ${round}/${rounds} | ${vertical} | batch ${batchNum}/${totalBatches} (${batch.length} pairs)`);

        const outcomes = await Promise.all(batch.map(async ([aId, bId]) => {
          const verticalA = idToVertical.get(aId) || 'unknown';
          const verticalB = idToVertical.get(bId) || 'unknown';
          if (verticalA !== verticalB) {
            throw new Error(`Cross-vertical pairing blocked: ${aId}(${verticalA}) vs ${bId}(${verticalB})`);
          }

          pairSet.add(pairKey(aId, bId));
          const aSnap = comparisonSnapshots.get(aId);
          const bSnap = comparisonSnapshots.get(bId);
          if (!aSnap || !bSnap) {
            return { aId, bId, error: 'Missing snapshot data' };
          }

          try {
            const result = await comparePairWithRetry(aSnap, bSnap, retries);
            return { aId, bId, result };
          } catch (err) {
            return { aId, bId, error: err.message };
          }
        }));

        for (const outcome of outcomes) {
          if (outcome.error) {
            failedComparisons++;
            comparisonsStream.write(JSON.stringify({
              mode: MODE,
              vertical,
              round,
              pair: [outcome.aId, outcome.bId],
              error: outcome.error
            }) + '\n');
            continue;
          }

          const { aId, bId, result } = outcome;
          totalComparisons++;

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
        }
      }

      if (byes.length) {
        byes.forEach(id => {
          comparisonsStream.write(JSON.stringify({ mode: MODE, vertical, round, bye: id }) + '\n');
        });
      }
    }
    console.log(`Round ${round} complete: +${totalComparisons - roundStartComparisons} comparisons, +${failedComparisons - roundStartFailures} failed`);
  }

  comparisonsStream.end();

  const secondPass = firstPass.map(row => {
    const primaryVertical = idToVertical.get(row.contractor_id) || primaryVerticalFromRow(row, snapshots, inferredCohortVertical);
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
