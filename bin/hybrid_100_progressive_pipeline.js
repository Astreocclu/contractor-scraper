#!/usr/bin/env node
/**
 * Hybrid 100 progressive DeepSeek pipeline.
 *
 * One-command flow for a 100-contractor cell:
 * 1) strict source gate
 * 2) snapshot
 * 3) first pass
 * 4) progressive pairwise phases with movement + boundary tracking
 *
 * Defaults implement the locked scaling policy:
 * - Phase A: everyone to 10 comparisons
 * - Phase B: top 60% + boundary buffer to 20
 * - Phase C: top 20% + boundary buffer to 30
 * - Re-tier cadence every 5 rounds
 * - Promotion/demotion each cycle: top/bottom 15%
 * - DeepSeek chat lane only
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const { PROMPT_STYLES, buildPairwisePrompt } = require('../services/experiment_prompts');
const { callDeepSeek } = require('../services/council_callers');

const args = process.argv.slice(2);

function getArgValue(name, fallback = null) {
  const eq = args.find(a => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const group = getArgValue('--group', 'A');
const model = getArgValue('--model', 'deepseek');
const concurrency = Math.max(1, parseInt(getArgValue('--concurrency', '8'), 10));
const retries = Math.max(0, parseInt(getArgValue('--retries', '2'), 10));
const seed = parseInt(getArgValue('--seed', '42'), 10);
const strictVertical = process.env.SWISS_STRICT_VERTICAL !== 'false';

const phaseATarget = Math.max(1, parseInt(getArgValue('--phase-a', '10'), 10));
const phaseBTarget = Math.max(phaseATarget, parseInt(getArgValue('--phase-b', '20'), 10));
const phaseCTarget = Math.max(phaseBTarget, parseInt(getArgValue('--phase-c', '30'), 10));

const phaseBTopPct = Math.min(100, Math.max(1, parseFloat(getArgValue('--phase-b-top-pct', '60'))));
const phaseCTopPct = Math.min(100, Math.max(1, parseFloat(getArgValue('--phase-c-top-pct', '20'))));
const movementPct = Math.min(49, Math.max(1, parseFloat(getArgValue('--movement-pct', '15'))));
const boundaryBuffer = Math.max(1, parseInt(getArgValue('--boundary-buffer', '5'), 10));
const retierEveryRounds = Math.max(1, parseInt(getArgValue('--retier-every-rounds', '5'), 10));
const confidenceThreshold = Math.max(0, Math.min(100, parseInt(getArgValue('--confidence-threshold', '70'), 10)));
const maxRounds = Math.max(1, parseInt(getArgValue('--max-rounds', '120'), 10));
const dryRun = hasFlag('--dry-run');

const fresh = hasFlag('--fresh');
const skipSource = hasFlag('--skip-source');
const skipSnapshot = hasFlag('--skip-snapshot');
const skipFirstPass = hasFlag('--skip-first-pass');
const skipPrep = hasFlag('--skip-prep');

if (model !== 'deepseek') {
  console.error('This runner is DeepSeek-lane only. Use --model=deepseek');
  process.exit(1);
}

const experimentDir = group === 'A' ? 'hybrid_100' : `hybrid_100_${group}`;
const BASE_DIR = path.join(__dirname, '..', 'experiments', experimentDir);
const RESULTS_DIR = path.join(BASE_DIR, 'results');
const SNAPSHOT_DIR = path.join(BASE_DIR, 'data', 'snapshots');
const PROGRESSIVE_DIR = path.join(RESULTS_DIR, 'progressive');
const PAIRWISE_DIR = path.join(PROGRESSIVE_DIR, 'pairwise');
const ANALYSIS_DIR = path.join(PROGRESSIVE_DIR, 'analysis');

const defaultConfig = group === 'A'
  ? path.join(BASE_DIR, 'config', 'sample_100.json')
  : path.join(BASE_DIR, 'config', `sample_100_group_${group}.json`);
const configPath = getArgValue('--config', defaultConfig);

const requiredSources = getArgValue('--required', 'google_presence,bbb,court_records,county_liens,tx_franchise');

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

const promptVersion = 'pairwise_v1';
const promptHash = `sha256:${crypto
  .createHash('sha256')
  .update(`${PROMPT_STYLES.pairwise.system}\n${PROMPT_STYLES.pairwise.outputFormat}`)
  .digest('hex')}`;

function mulberry32(initSeed) {
  let t = initSeed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pairKey(a, b) {
  return `${Math.min(a, b)}_${Math.max(a, b)}`;
}

function tierLabel(index) {
  return `T${index}`;
}

function mapLegacyTier(score) {
  if (score >= 85) return 'TRUSTED';
  if (score >= 70) return 'LOW';
  if (score >= 55) return 'MODERATE';
  if (score >= 35) return 'HIGH';
  return 'CRITICAL';
}

function runNodeScript(scriptPath, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...scriptArgs], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env }
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

async function runPrepPipeline() {
  if (!skipPrep && !skipSource) {
    await runNodeScript('bin/source_missing_from_manifest.js', [
      `--config=${configPath}`,
      `--required=${requiredSources}`
    ]);
  }

  if (!skipPrep && !skipSnapshot) {
    await runNodeScript('bin/hybrid_100_snapshot.js', [
      `--group=${group}`,
      `--config=${configPath}`
    ]);
  }

  if (!skipPrep && !skipFirstPass) {
    await runNodeScript('bin/hybrid_100_first_pass.js', [`--group=${group}`]);
  }
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
  const firstPassPath = path.join(RESULTS_DIR, 'first_pass.json');
  if (!fs.existsSync(firstPassPath)) {
    throw new Error(`first_pass.json not found: ${firstPassPath}`);
  }
  return JSON.parse(fs.readFileSync(firstPassPath, 'utf-8'));
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

function buildVerticalIndex(firstPass, snapshots, cohortVertical = null) {
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
  if (omitted.length) base.omitted_sources_due_to_size = omitted;

  return base;
}

async function comparePair(aSnap, bSnap) {
  if (dryRun) {
    const aId = Number(aSnap.contractor_id) || 0;
    const winner = aId % 2 === 0 ? 'A' : 'B';
    return {
      result: {
        winner,
        confidence: 80,
        reasoning: 'dry_run simulation'
      },
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0
      },
      cost: {
        total_cost_usd: 0,
        pricing: { mode: 'dry_run' }
      }
    };
  }

  const prompt = buildPairwisePrompt(aSnap, bSnap);
  const response = await callDeepSeek(prompt.system, prompt.user, {
    temperature: 0,
    seed: 42,
    returnUsage: true
  });

  const content = typeof response === 'string' ? response : response.content;
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${content.substring(0, 100)}`);

  return {
    result: JSON.parse(match[0]),
    usage: response?.usage || {},
    cost: response?.cost || null
  };
}

async function comparePairWithRetry(aSnap, bSnap, maxRetries) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await comparePair(aSnap, bSnap);
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      const backoffMs = Math.min(15000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 500);
      console.log(`    retry ${attempt + 1}/${maxRetries} after error: ${err.message.substring(0, 120)}`);
      await sleep(backoffMs);
    }
  }
  throw new Error('Unexpected retry loop exit');
}

function buildRankedIds(ids, scoreMap, baseScoreMap, winStats) {
  return [...ids].sort((a, b) => {
    const sa = scoreMap.get(a) ?? baseScoreMap.get(a) ?? 50;
    const sb = scoreMap.get(b) ?? baseScoreMap.get(b) ?? 50;
    if (sb !== sa) return sb - sa;

    const aStats = winStats.get(a) || { wins: 0, ties: 0, total: 0 };
    const bStats = winStats.get(b) || { wins: 0, ties: 0, total: 0 };
    const aw = aStats.total > 0 ? (aStats.wins + 0.5 * aStats.ties) / aStats.total : 0;
    const bw = bStats.total > 0 ? (bStats.wins + 0.5 * bStats.ties) / bStats.total : 0;
    if (bw !== aw) return bw - aw;

    return a - b;
  });
}

function makeRankMap(rankedIds) {
  const rankMap = new Map();
  rankedIds.forEach((id, idx) => rankMap.set(id, idx + 1));
  return rankMap;
}

function assignQuantileTiers(rankedIds, tierCount = 6) {
  const tierById = new Map();
  const n = rankedIds.length;
  if (n === 0) return tierById;

  for (let i = 0; i < n; i++) {
    const tier = Math.min(tierCount, Math.floor((i * tierCount) / n) + 1);
    tierById.set(rankedIds[i], tier);
  }
  return tierById;
}

function swissPairing(ids, scoreMap, pairSet, rand) {
  const sorted = [...ids].sort((a, b) => {
    const sa = scoreMap.get(a) || 0;
    const sb = scoreMap.get(b) || 0;
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
      if (pairSet.has(pairKey(aId, bId))) continue;
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

function getTopPercentWithBoundary(rankedIds, topPercent, buffer) {
  const n = rankedIds.length;
  const topCount = Math.max(1, Math.ceil((n * topPercent) / 100));
  const topSet = new Set(rankedIds.slice(0, topCount));

  const boundarySet = new Set();
  const start = Math.max(0, topCount - buffer);
  const endExclusive = Math.min(n, topCount + buffer);

  for (let i = start; i < endExclusive; i++) {
    boundarySet.add(rankedIds[i]);
  }

  return {
    topSet,
    boundarySet,
    cutoffRank: topCount
  };
}

function computeTierBoundaries(idsInTier, buffer, movementPercent) {
  const n = idsInTier.length;
  if (n < 3) return { promoteIds: [], demoteIds: [], boundaryIds: [] };

  let moveCount = Math.round((n * movementPercent) / 100);
  const maxMove = Math.floor((n - 1) / 2);
  moveCount = Math.max(0, Math.min(moveCount, maxMove));

  if (moveCount === 0) return { promoteIds: [], demoteIds: [], boundaryIds: [] };

  const promoteIds = idsInTier.slice(0, moveCount);
  const demoteIds = idsInTier.slice(n - moveCount);

  const boundaryIdx = new Set();

  const promoLineStart = Math.max(0, moveCount - buffer);
  const promoLineEnd = Math.min(n, moveCount + buffer);
  for (let i = promoLineStart; i < promoLineEnd; i++) boundaryIdx.add(i);

  const demoteLineStart = Math.max(0, n - moveCount - buffer);
  const demoteLineEnd = Math.min(n, n - moveCount + buffer);
  for (let i = demoteLineStart; i < demoteLineEnd; i++) boundaryIdx.add(i);

  const boundaryIds = [...boundaryIdx].map(i => idsInTier[i]);

  return { promoteIds, demoteIds, boundaryIds };
}

function applyTierMovement({ ids, tierById, scoreMap, baseScoreMap, winStats, boundaryBufferSize, movementPercent }) {
  const rankedIds = buildRankedIds(ids, scoreMap, baseScoreMap, winStats);
  const byTier = new Map();

  for (const id of rankedIds) {
    const t = tierById.get(id) || 6;
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t).push(id);
  }

  const promoteTo = new Map();
  const demoteTo = new Map();
  const boundarySet = new Set();
  const movementDetails = [];

  for (let tier = 1; tier <= 6; tier++) {
    const members = byTier.get(tier) || [];
    if (members.length === 0) continue;

    const { promoteIds, demoteIds, boundaryIds } = computeTierBoundaries(members, boundaryBufferSize, movementPercent);

    for (const id of boundaryIds) boundarySet.add(id);

    const promoteApplied = [];
    const demoteApplied = [];

    if (tier > 1) {
      for (const id of promoteIds) {
        promoteTo.set(id, tier - 1);
        promoteApplied.push(id);
      }
    }

    if (tier < 6) {
      for (const id of demoteIds) {
        demoteTo.set(id, tier + 1);
        demoteApplied.push(id);
      }
    }

    movementDetails.push({
      tier: tierLabel(tier),
      size: members.length,
      promote_count: promoteApplied.length,
      demote_count: demoteApplied.length,
      promote_ids: promoteApplied,
      demote_ids: demoteApplied,
      boundary_ids: boundaryIds
    });
  }

  let promotions = 0;
  let demotions = 0;

  for (const id of ids) {
    const oldTier = tierById.get(id) || 6;
    const up = promoteTo.get(id);
    const down = demoteTo.get(id);

    if (up && down) continue;

    if (up) {
      if (up < oldTier) promotions++;
      tierById.set(id, up);
      continue;
    }

    if (down) {
      if (down > oldTier) demotions++;
      tierById.set(id, down);
    }
  }

  const tierCounts = {};
  for (const id of ids) {
    const t = tierById.get(id) || 6;
    const key = tierLabel(t);
    tierCounts[key] = (tierCounts[key] || 0) + 1;
  }

  return {
    promotions,
    demotions,
    boundarySet,
    movementDetails,
    tierCounts
  };
}

function buildTierVerticalGroups(ids, tierById, idToVertical) {
  const groups = new Map();

  for (const id of ids) {
    const tier = tierById.get(id) || 6;
    const vertical = idToVertical.get(id) || 'unknown';
    const key = `${tierLabel(tier)}::${vertical}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }

  return groups;
}

function toIntId(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function loadExistingComparisons(comparisonsPath, state) {
  if (!fs.existsSync(comparisonsPath)) return;

  const raw = fs.readFileSync(comparisonsPath, 'utf-8').trim();
  if (!raw) return;

  const lines = raw.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    let rec;
    try {
      rec = JSON.parse(line);
    } catch (_) {
      continue;
    }

    if (rec.round_global && rec.round_global > state.roundGlobal) {
      state.roundGlobal = rec.round_global;
    }

    if (rec.usage) {
      state.inputTokens += rec.usage.prompt_tokens || 0;
      state.outputTokens += rec.usage.completion_tokens || 0;
    }

    if (typeof rec.cost_usd === 'number') {
      state.costTotal += rec.cost_usd;
    } else if (rec.cost && typeof rec.cost.total_cost_usd === 'number') {
      state.costTotal += rec.cost.total_cost_usd;
    }

    if (rec.error) {
      state.failedComparisons++;
      continue;
    }

    if (!rec.pair || rec.pair.length !== 2 || !rec.winner) continue;

    const aId = toIntId(rec.pair[0]);
    const bId = toIntId(rec.pair[1]);
    const key = pairKey(aId, bId);

    state.pairSet.add(key);
    state.totalComparisons++;

    const aStats = state.winStats.get(aId) || { wins: 0, losses: 0, ties: 0, total: 0 };
    const bStats = state.winStats.get(bId) || { wins: 0, losses: 0, ties: 0, total: 0 };

    if (rec.winner === 'A') {
      aStats.wins++;
      bStats.losses++;
      state.scoreMap.set(aId, (state.scoreMap.get(aId) || 0) + 1);
    } else if (rec.winner === 'B') {
      bStats.wins++;
      aStats.losses++;
      state.scoreMap.set(bId, (state.scoreMap.get(bId) || 0) + 1);
    } else {
      aStats.ties++;
      bStats.ties++;
      state.scoreMap.set(aId, (state.scoreMap.get(aId) || 0) + 0.5);
      state.scoreMap.set(bId, (state.scoreMap.get(bId) || 0) + 0.5);
    }

    aStats.total++;
    bStats.total++;
    state.winStats.set(aId, aStats);
    state.winStats.set(bId, bStats);

    if (rec.phase && rec.phase !== 'A') {
      const list = state.phaseStarts.get(rec.phase) || [];
      list.push(state.totalComparisons);
      state.phaseStarts.set(rec.phase, list);
    }

    if (rec.escalation_reasons && rec.escalation_reasons.length > 0) {
      state.escalationQueue.push({
        timestamp: rec.timestamp,
        phase: rec.phase,
        round_global: rec.round_global,
        pair: [aId, bId],
        winner: rec.winner,
        confidence: rec.confidence,
        reasons: rec.escalation_reasons
      });
    }

    const winnerHistory = state.pairHistory.get(key) || [];
    winnerHistory.push(rec.winner);
    state.pairHistory.set(key, winnerHistory);
  }
}

function readJsonSafe(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

async function main() {
  console.log('=== Hybrid 100 Progressive Pipeline ===');
  console.log(`group=${group} experiment=${experimentDir} model=${model}`);
  console.log(`config=${configPath}`);
  console.log(`targets: A=${phaseATarget} B=${phaseBTarget} C=${phaseCTarget}`);
  console.log(`phase-top: B=${phaseBTopPct}% C=${phaseCTopPct}%`);
  console.log(`movement=${movementPct}% boundary=${boundaryBuffer} retier_every=${retierEveryRounds}`);
  console.log(`concurrency=${concurrency} retries=${retries} fresh=${fresh}`);

  if (!fs.existsSync(BASE_DIR)) throw new Error(`Experiment directory not found: ${BASE_DIR}`);
  if (!fs.existsSync(configPath)) throw new Error(`Config not found: ${configPath}`);

  ensureDir(PROGRESSIVE_DIR);
  ensureDir(PAIRWISE_DIR);
  ensureDir(ANALYSIS_DIR);

  const comparisonsPath = path.join(PAIRWISE_DIR, 'comparisons.jsonl');
  const movementPath = path.join(ANALYSIS_DIR, 'movement_log.json');
  const phasePath = path.join(ANALYSIS_DIR, 'phase_report.json');
  const escalationPath = path.join(ANALYSIS_DIR, 'escalation_queue.json');

  if (fresh && fs.existsSync(comparisonsPath)) fs.unlinkSync(comparisonsPath);
  if (fresh && fs.existsSync(movementPath)) fs.unlinkSync(movementPath);
  if (fresh && fs.existsSync(phasePath)) fs.unlinkSync(phasePath);
  if (fresh && fs.existsSync(escalationPath)) fs.unlinkSync(escalationPath);

  await runPrepPipeline();

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
      throw new Error(`Strict vertical guard failed for ${mismatched.length} contractors (cohort vertical=${inferredCohortVertical}). IDs: ${mismatched.slice(0, 10).join(', ')}`);
    }
  }

  const { idToVertical } = buildVerticalIndex(firstPass, snapshots, inferredCohortVertical);

  const ids = firstPass.map(row => row.contractor_id);
  const idToRow = new Map(firstPass.map(row => [row.contractor_id, row]));

  const baseScoreMap = new Map();
  const winStats = new Map();
  const scoreMap = new Map();

  for (const id of ids) {
    const row = idToRow.get(id) || {};
    const score = Number(row.score);
    const base = Number.isFinite(score) ? score : 50;
    baseScoreMap.set(id, base);
    scoreMap.set(id, base);
    winStats.set(id, { wins: 0, losses: 0, ties: 0, total: 0 });
  }

  let rankedIds = buildRankedIds(ids, scoreMap, baseScoreMap, winStats);
  let tierById = assignQuantileTiers(rankedIds, 6);

  let boundarySet = new Set();
  const movementLog = readJsonSafe(movementPath, []);
  if (movementLog.length > 0) {
    const last = movementLog[movementLog.length - 1];
    if (last?.tier_snapshot) {
      const restored = new Map();
      for (const [id, tier] of Object.entries(last.tier_snapshot)) {
        restored.set(Number(id), Number(tier));
      }
      if (restored.size > 0) tierById = restored;
    }
    if (Array.isArray(last?.boundary_ids)) {
      boundarySet = new Set(last.boundary_ids.map(Number));
    }
  }

  const state = {
    roundGlobal: 0,
    totalComparisons: 0,
    failedComparisons: 0,
    inputTokens: 0,
    outputTokens: 0,
    costTotal: 0,
    pairSet: new Set(),
    winStats,
    scoreMap,
    phaseStarts: new Map(),
    escalationQueue: readJsonSafe(escalationPath, []),
    pairHistory: new Map()
  };

  loadExistingComparisons(comparisonsPath, state);

  rankedIds = buildRankedIds(ids, scoreMap, baseScoreMap, winStats);

  console.log(`Loaded ${ids.length} contractors (max compact snapshot size=${largestSnapshotChars})`);
  if (inferredCohortVertical) {
    console.log(`Vertical enforcement: cohort=${inferredCohortVertical} strict=${strictVertical ? 'on' : 'off'}`);
  }
  if (!fresh && state.totalComparisons > 0) {
    console.log(`Resume detected: ${state.totalComparisons} comparisons, round_global=${state.roundGlobal}`);
  }

  const rand = mulberry32(seed + state.roundGlobal);
  const comparisonsStream = fs.createWriteStream(comparisonsPath, { flags: 'a' });

  const phaseReport = readJsonSafe(phasePath, []);
  const runStartedAt = new Date().toISOString();

  const phases = [
    { name: 'A', target: phaseATarget, topPct: 100 },
    { name: 'B', target: phaseBTarget, topPct: phaseBTopPct },
    { name: 'C', target: phaseCTarget, topPct: phaseCTopPct }
  ];

  for (const phase of phases) {
    const phaseStartRank = makeRankMap(rankedIds);
    const phaseStartedAtComparisons = state.totalComparisons;

    let roundsInPhase = 0;
    let phaseBoundaryRankLine = null;

    while (true) {
      rankedIds = buildRankedIds(ids, scoreMap, baseScoreMap, winStats);
      const rankMap = makeRankMap(rankedIds);

      let activeSet = new Set(ids);
      let phaseTopBoundary = null;

      if (phase.name !== 'A') {
        const { topSet, boundarySet: topBoundary, cutoffRank } = getTopPercentWithBoundary(rankedIds, phase.topPct, boundaryBuffer);
        phaseTopBoundary = topBoundary;
        phaseBoundaryRankLine = cutoffRank;
        activeSet = new Set([...topSet, ...topBoundary, ...boundarySet]);
      }

      const needsWork = ids.filter(id => {
        if (!activeSet.has(id)) return false;
        const total = state.winStats.get(id)?.total || 0;
        return total < phase.target;
      });

      if (needsWork.length === 0) {
        break;
      }

      if (state.roundGlobal >= maxRounds) {
        console.log(`Reached max rounds (${maxRounds}); stopping phase ${phase.name} early.`);
        break;
      }

      state.roundGlobal++;
      roundsInPhase++;
      const roundPhase = roundsInPhase;

      const tierGroups = buildTierVerticalGroups(needsWork, tierById, idToVertical);
      const workGroups = new Map();
      const fallbackByVertical = new Map();

      for (const [cohortKey, cohortIds] of tierGroups.entries()) {
        if (cohortIds.length >= 2) {
          workGroups.set(cohortKey, cohortIds);
          continue;
        }

        for (const id of cohortIds) {
          const vertical = idToVertical.get(id) || 'unknown';
          if (!fallbackByVertical.has(vertical)) fallbackByVertical.set(vertical, []);
          fallbackByVertical.get(vertical).push(id);
        }
      }

      for (const [vertical, idsInVertical] of fallbackByVertical.entries()) {
        if (idsInVertical.length >= 2) {
          workGroups.set(`FALLBACK::${vertical}`, idsInVertical);
        }
      }

      let roundComparisons = 0;
      let roundFailed = 0;

      for (const [cohortKey, cohortIds] of workGroups.entries()) {
        const { pairs, byes } = swissPairing(cohortIds, scoreMap, state.pairSet, rand);

        if (pairs.length === 0 && byes.length > 0) {
          continue;
        }

        for (let i = 0; i < pairs.length; i += concurrency) {
          const batch = pairs.slice(i, i + concurrency);
          const batchNum = Math.floor(i / concurrency) + 1;
          const totalBatches = Math.ceil(pairs.length / concurrency);
          console.log(`phase=${phase.name} round=${roundPhase} global=${state.roundGlobal} cohort=${cohortKey} batch=${batchNum}/${totalBatches}`);

          const outcomes = await Promise.all(batch.map(async ([aId, bId]) => {
            const verticalA = idToVertical.get(aId) || 'unknown';
            const verticalB = idToVertical.get(bId) || 'unknown';
            if (verticalA !== verticalB) {
              return { aId, bId, error: `Cross-vertical pairing blocked: ${aId}(${verticalA}) vs ${bId}(${verticalB})` };
            }

            const key = pairKey(aId, bId);
            state.pairSet.add(key);

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
            const timestamp = new Date().toISOString();

            if (outcome.error) {
              state.failedComparisons++;
              roundFailed++;

              comparisonsStream.write(JSON.stringify({
                timestamp,
                mode: 'progressive',
                lane: 'deepseek_chat',
                group,
                phase: phase.name,
                round_phase: roundPhase,
                round_global: state.roundGlobal,
                pair: [outcome.aId, outcome.bId],
                error: outcome.error,
                prompt_version: promptVersion,
                prompt_hash: promptHash
              }) + '\n');
              continue;
            }

            const { aId, bId, result } = outcome;
            const key = pairKey(aId, bId);
            const winner = result.result.winner;
            const confidence = Number(result.result.confidence);

            state.totalComparisons++;
            roundComparisons++;

            const aStats = state.winStats.get(aId) || { wins: 0, losses: 0, ties: 0, total: 0 };
            const bStats = state.winStats.get(bId) || { wins: 0, losses: 0, ties: 0, total: 0 };

            if (winner === 'A') {
              aStats.wins++;
              bStats.losses++;
              scoreMap.set(aId, (scoreMap.get(aId) || 0) + 1);
            } else if (winner === 'B') {
              bStats.wins++;
              aStats.losses++;
              scoreMap.set(bId, (scoreMap.get(bId) || 0) + 1);
            } else {
              aStats.ties++;
              bStats.ties++;
              scoreMap.set(aId, (scoreMap.get(aId) || 0) + 0.5);
              scoreMap.set(bId, (scoreMap.get(bId) || 0) + 0.5);
            }

            aStats.total++;
            bStats.total++;
            state.winStats.set(aId, aStats);
            state.winStats.set(bId, bStats);

            if (result.usage) {
              state.inputTokens += result.usage.prompt_tokens || 0;
              state.outputTokens += result.usage.completion_tokens || 0;
            }
            if (result.cost && typeof result.cost.total_cost_usd === 'number') {
              state.costTotal += result.cost.total_cost_usd;
            }

            const escalationReasons = [];
            const isBoundaryCandidate = boundarySet.has(aId) || boundarySet.has(bId) || (phaseTopBoundary ? (phaseTopBoundary.has(aId) || phaseTopBoundary.has(bId)) : false);
            if (winner === 'TIE') escalationReasons.push('tie');
            if (Number.isFinite(confidence) && confidence <= confidenceThreshold) escalationReasons.push('low_confidence');
            if (isBoundaryCandidate) escalationReasons.push('boundary_candidate');

            const history = state.pairHistory.get(key) || [];
            if (history.length > 0) {
              const lastWinner = history[history.length - 1];
              if (winner !== lastWinner && winner !== 'TIE' && lastWinner !== 'TIE') {
                escalationReasons.push('disagreement_cluster');
              }
            }
            history.push(winner);
            state.pairHistory.set(key, history);

            if (escalationReasons.length > 0) {
              state.escalationQueue.push({
                timestamp,
                phase: phase.name,
                round_phase: roundPhase,
                round_global: state.roundGlobal,
                pair: [aId, bId],
                winner,
                confidence: Number.isFinite(confidence) ? confidence : null,
                reasons: escalationReasons,
                tier_a: tierLabel(tierById.get(aId) || 6),
                tier_b: tierLabel(tierById.get(bId) || 6),
                vertical: idToVertical.get(aId) || 'unknown'
              });
            }

            comparisonsStream.write(JSON.stringify({
              timestamp,
              mode: 'progressive',
              lane: 'deepseek_chat',
              group,
              phase: phase.name,
              round_phase: roundPhase,
              round_global: state.roundGlobal,
              cycle: Math.ceil(state.roundGlobal / retierEveryRounds),
              cohort: cohortKey,
              pair: [aId, bId],
              winner,
              confidence: Number.isFinite(confidence) ? confidence : null,
              reasoning: result.result.reasoning,
              usage: result.usage,
              cost_usd: result.cost?.total_cost_usd ?? null,
              pricing: result.cost?.pricing ?? null,
              prompt_version: promptVersion,
              prompt_hash: promptHash,
              tier_a: tierLabel(tierById.get(aId) || 6),
              tier_b: tierLabel(tierById.get(bId) || 6),
              vertical: idToVertical.get(aId) || 'unknown',
              boundary_candidate: isBoundaryCandidate,
              escalation_reasons: escalationReasons
            }) + '\n');
          }
        }
      }

      if (roundComparisons === 0 && roundFailed === 0) {
        console.log(`No pairings available for phase ${phase.name}; stopping phase early.`);
        break;
      }

      console.log(`phase=${phase.name} round=${roundPhase} done: +${roundComparisons} comparisons, +${roundFailed} failed`);

      if (state.roundGlobal % retierEveryRounds === 0) {
        const move = applyTierMovement({
          ids,
          tierById,
          scoreMap,
          baseScoreMap,
          winStats,
          boundaryBufferSize: boundaryBuffer,
          movementPercent: movementPct
        });

        boundarySet = move.boundarySet;

        const rankedNow = buildRankedIds(ids, scoreMap, baseScoreMap, winStats);
        const tierSnapshot = {};
        for (const id of rankedNow) tierSnapshot[id] = tierById.get(id) || 6;

        const movementEntry = {
          timestamp: new Date().toISOString(),
          round_global: state.roundGlobal,
          cycle: Math.ceil(state.roundGlobal / retierEveryRounds),
          promotions: move.promotions,
          demotions: move.demotions,
          boundary_ids: [...boundarySet],
          tier_counts: move.tierCounts,
          movement_details: move.movementDetails,
          tier_snapshot: tierSnapshot
        };

        movementLog.push(movementEntry);
        writeJson(movementPath, movementLog);

        console.log(`re-tier cycle ${movementEntry.cycle}: promotions=${move.promotions}, demotions=${move.demotions}, boundary=${boundarySet.size}`);
      }
    }

    rankedIds = buildRankedIds(ids, scoreMap, baseScoreMap, winStats);
    const phaseEndRank = makeRankMap(rankedIds);

    const boundaryIdsForDrift = [...boundarySet];
    let boundaryRankDriftAvg = null;
    if (boundaryIdsForDrift.length > 0) {
      const drifts = boundaryIdsForDrift
        .map(id => {
          const startRank = phaseStartRank.get(id);
          const endRank = phaseEndRank.get(id);
          if (!startRank || !endRank) return null;
          return Math.abs(endRank - startRank);
        })
        .filter(v => Number.isFinite(v));

      if (drifts.length > 0) {
        boundaryRankDriftAvg = drifts.reduce((a, b) => a + b, 0) / drifts.length;
      }
    }

    const activeSetFinal = (() => {
      if (phase.name === 'A') return new Set(ids);
      const { topSet, boundarySet: topBoundary, cutoffRank } = getTopPercentWithBoundary(rankedIds, phase.topPct, boundaryBuffer);
      phaseBoundaryRankLine = cutoffRank;
      return new Set([...topSet, ...topBoundary, ...boundarySet]);
    })();

    const remainingBelowTarget = ids
      .filter(id => activeSetFinal.has(id))
      .filter(id => (state.winStats.get(id)?.total || 0) < phase.target)
      .length;

    const phaseSummary = {
      phase: phase.name,
      target_comparisons: phase.target,
      top_percent: phase.topPct,
      boundary_cutoff_rank: phaseBoundaryRankLine,
      rounds_executed: roundsInPhase,
      new_comparisons: state.totalComparisons - phaseStartedAtComparisons,
      remaining_below_target: remainingBelowTarget,
      boundary_rank_drift_avg: boundaryRankDriftAvg,
      completed_at: new Date().toISOString()
    };

    phaseReport.push(phaseSummary);
    writeJson(phasePath, phaseReport);

    console.log(`phase ${phase.name} summary: +${phaseSummary.new_comparisons} comparisons, remaining_below_target=${phaseSummary.remaining_below_target}`);
  }

  comparisonsStream.end();

  rankedIds = buildRankedIds(ids, scoreMap, baseScoreMap, winStats);
  const finalRankMap = makeRankMap(rankedIds);

  const finalRows = rankedIds.map((id) => {
    const row = idToRow.get(id) || {};
    const stats = state.winStats.get(id) || { wins: 0, losses: 0, ties: 0, total: 0 };
    const winRate = stats.total > 0 ? (stats.wins + 0.5 * stats.ties) / stats.total : null;
    const comparisonScore = winRate === null ? null : Math.round(winRate * 100);

    return {
      contractor_id: id,
      business_name: row.business_name || comparisonSnapshots.get(id)?.business_name || `ID:${id}`,
      city: row.city || comparisonSnapshots.get(id)?.city || null,
      state: row.state || comparisonSnapshots.get(id)?.state || null,
      primary_vertical: idToVertical.get(id) || 'unknown',
      rank: finalRankMap.get(id),
      dynamic_points: scoreMap.get(id) || baseScoreMap.get(id) || 0,
      first_pass_score: Number.isFinite(Number(row.score)) ? Number(row.score) : null,
      first_pass_tier: row.tier || mapLegacyTier(Number(row.score) || 0),
      progressive_tier: tierLabel(tierById.get(id) || 6),
      comparisons: stats,
      win_rate: winRate,
      comparison_score: comparisonScore
    };
  });

  const secondPassPath = path.join(PROGRESSIVE_DIR, 'second_pass.json');
  const finalRankedPath = path.join(PROGRESSIVE_DIR, 'final_ranked.json');

  writeJson(secondPassPath, finalRows);
  writeJson(finalRankedPath, finalRows);
  writeJson(escalationPath, state.escalationQueue);

  const pricing = {
    input_per_1m: parseFloat(process.env.DEEPSEEK_CHAT_INPUT_COST_PER_1M || '0.28'),
    output_per_1m: parseFloat(process.env.DEEPSEEK_CHAT_OUTPUT_COST_PER_1M || '0.42'),
    cache: 'miss'
  };

  const perContractor = {};
  for (const id of ids) {
    const stats = state.winStats.get(id) || { wins: 0, losses: 0, ties: 0, total: 0 };
    perContractor[id] = {
      comparisons: stats.total,
      wins: stats.wins,
      losses: stats.losses,
      ties: stats.ties,
      tier: tierLabel(tierById.get(id) || 6),
      rank: finalRankMap.get(id)
    };
  }

  const summary = {
    mode: 'progressive',
    lane: 'deepseek_chat',
    group,
    config: configPath,
    strict_vertical: strictVertical,
    cohort_vertical: inferredCohortVertical,
    seed,
    prompt_version: promptVersion,
    prompt_hash: promptHash,
    run_started_at: runStartedAt,
    run_finished_at: new Date().toISOString(),
    phase_targets: {
      A: phaseATarget,
      B: phaseBTarget,
      C: phaseCTarget
    },
    phase_top_percent: {
      B: phaseBTopPct,
      C: phaseCTopPct
    },
    policy: {
      retier_every_rounds: retierEveryRounds,
      movement_pct: movementPct,
      boundary_buffer: boundaryBuffer,
      confidence_threshold: confidenceThreshold
    },
    totals: {
      comparisons: state.totalComparisons,
      failed_comparisons: state.failedComparisons,
      escalations: state.escalationQueue.length,
      rounds_executed: state.roundGlobal
    },
    tokens: {
      input: state.inputTokens,
      output: state.outputTokens
    },
    cost_usd: state.costTotal,
    pricing,
    outputs: {
      second_pass: secondPassPath,
      final_ranked: finalRankedPath,
      comparisons_jsonl: comparisonsPath,
      movement_log: movementPath,
      phase_report: phasePath,
      escalation_queue: escalationPath
    }
  };

  const costSummary = {
    total_comparisons: state.totalComparisons,
    failed_comparisons: state.failedComparisons,
    tokens: {
      input: state.inputTokens,
      output: state.outputTokens
    },
    cost_usd: state.costTotal,
    pricing,
    avg_cost_per_comparison: state.totalComparisons > 0 ? state.costTotal / state.totalComparisons : 0
  };

  const boundaryReport = {
    boundary_count: boundarySet.size,
    boundary_ids: [...boundarySet],
    latest_movement_cycle: movementLog.length > 0 ? movementLog[movementLog.length - 1].cycle : 0
  };

  writeJson(path.join(ANALYSIS_DIR, 'summary.json'), summary);
  writeJson(path.join(ANALYSIS_DIR, 'cost.json'), costSummary);
  writeJson(path.join(ANALYSIS_DIR, 'per_contractor_coverage.json'), perContractor);
  writeJson(path.join(ANALYSIS_DIR, 'boundary_report.json'), boundaryReport);

  console.log('=== Progressive Pipeline Complete ===');
  console.log(`comparisons=${state.totalComparisons} failed=${state.failedComparisons} escalations=${state.escalationQueue.length}`);
  console.log(`cost_usd=${state.costTotal.toFixed(6)}`);
  console.log(`summary=${path.join(ANALYSIS_DIR, 'summary.json')}`);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
