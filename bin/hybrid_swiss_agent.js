#!/usr/bin/env node
/**
 * Swiss-style pairwise comparisons using CLI agents.
 *
 * Uses local CLI subscriptions (Claude or Codex) instead of direct API calls.
 * Runs comparisons in parallel batches within each round.
 *
 * Usage:
 *   node bin/hybrid_swiss_agent.js --group=C --rounds=30 [--concurrency=10] [--engine=claude|codex] [--model=sonnet|gpt-5] [--fresh]
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PROMPT_STYLES } = require('../services/experiment_prompts');

// CLI args
const args = process.argv.slice(2);
const groupArg = args.find(a => a.startsWith('--group='));
const roundsArg = args.find(a => a.startsWith('--rounds='));
const concurrencyArg = args.find(a => a.startsWith('--concurrency='));
const engineArg = args.find(a => a.startsWith('--engine='));
const modelArg = args.find(a => a.startsWith('--model='));
const fresh = args.includes('--fresh');

const group = groupArg ? groupArg.split('=')[1] : 'D';
const rounds = roundsArg ? parseInt(roundsArg.split('=')[1]) : 5;
const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1]) : 10;
const engine = engineArg ? engineArg.split('=')[1] : 'claude';
const model = modelArg ? modelArg.split('=')[1] : (engine === 'codex' ? 'gpt-5' : 'sonnet');

const experimentDir = group === 'A' ? 'hybrid_100' : `hybrid_100_${group}`;
const BASE_DIR = path.join(__dirname, '..', 'experiments', experimentDir);
const SNAPSHOT_DIR = path.join(BASE_DIR, 'data', 'snapshots');
const RESULTS_DIR = path.join(BASE_DIR, 'results');
const SWISS_DIR = path.join(RESULTS_DIR, 'swiss');
const PAIRWISE_DIR = path.join(SWISS_DIR, 'pairwise');
const ANALYSIS_DIR = path.join(SWISS_DIR, 'analysis');

const MODE = 'vertical';
const PAIRWISE_SYSTEM = PROMPT_STYLES.pairwise.system;
const PAIRWISE_FORMAT = PROMPT_STYLES.pairwise.outputFormat;
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

// --- Swiss algorithm (copied from hybrid_100_swiss_pass.js) ---

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pairKey(a, b) {
  return `${Math.min(a, b)}_${Math.max(a, b)}`;
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
      if (pairSet.has(pairKey(aId, bId))) continue;
      partnerIndex = j;
      break;
    }

    if (partnerIndex === -1) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (!used.has(sorted[j])) { partnerIndex = j; break; }
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

// --- CLI agent comparison ---

function buildPairPrompt(aSnap, bSnap) {
  return `CONTRACTOR A:\n${JSON.stringify(aSnap, null, 2)}\n\nCONTRACTOR B:\n${JSON.stringify(bSnap, null, 2)}\n\nWhich contractor is more trustworthy? Respond with JSON:\n${PAIRWISE_FORMAT}`;
}

function parsePairResultFromText(content) {
  const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON in response: ${content.substring(0, 200)}`);
  }
  return JSON.parse(jsonMatch[0]);
}

function comparePairWithClaude(userPrompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [
      '-p',
      '--model', model,
      '--no-session-persistence',
      '--tools', '',
      '--system-prompt', PAIRWISE_SYSTEM,
      '--output-format', 'json'
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Comparison timed out after 5 minutes'));
    }, 300000);

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        const cliError = (stderr && stderr.trim()) ? stderr : stdout;
        return reject(new Error(`claude exited ${code}: ${cliError.substring(0, 280)}`));
      }

      try {
        const envelope = JSON.parse(stdout);
        const result = parsePairResultFromText(envelope.result || '');
        resolve({
          result,
          usage: envelope.usage || {},
          duration_ms: envelope.duration_ms || 0,
          cost_usd: 0
        });
      } catch (err) {
        reject(new Error(`Parse error: ${err.message} | stdout: ${stdout.substring(0, 280)}`));
      }
    });

    child.on('error', err => {
      clearTimeout(timeout);
      reject(new Error(`spawn error: ${err.message}`));
    });

    child.stdin.write(userPrompt);
    child.stdin.end();
  });
}

function comparePairWithCodex(userPrompt) {
  return new Promise((resolve, reject) => {
    const codexPrompt = `${PAIRWISE_SYSTEM}\n\n${userPrompt}\n\nReturn ONLY valid JSON. No markdown.`;
    const child = spawn('codex', [
      'exec',
      '--model', model,
      '-c', 'model_reasoning_effort="high"',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--json'
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';
    let lastAgentMessage = '';
    let usage = {};
    let errorMessage = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Comparison timed out after 5 minutes'));
    }, 300000);

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('close', code => {
      clearTimeout(timeout);

      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('{')) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
            lastAgentMessage = event.item.text || lastAgentMessage;
          } else if (event.type === 'turn.completed' && event.usage) {
            usage = event.usage;
          } else if (event.type === 'error' && event.message) {
            errorMessage = event.message;
          }
        } catch {
          continue;
        }
      }

      if (code !== 0) {
        const cliError = errorMessage || stderr || stdout;
        return reject(new Error(`codex exited ${code}: ${cliError.substring(0, 280)}`));
      }

      if (!lastAgentMessage) {
        return reject(new Error(`codex missing agent message: ${stdout.substring(0, 280)}`));
      }

      try {
        const result = parsePairResultFromText(lastAgentMessage);
        resolve({
          result,
          usage,
          duration_ms: 0,
          cost_usd: 0
        });
      } catch (err) {
        reject(new Error(`Parse error: ${err.message} | codex: ${lastAgentMessage.substring(0, 280)}`));
      }
    });

    child.on('error', err => {
      clearTimeout(timeout);
      reject(new Error(`spawn error: ${err.message}`));
    });

    child.stdin.write(codexPrompt);
    child.stdin.end();
  });
}

function comparePairAgent(aSnap, bSnap) {
  const userPrompt = buildPairPrompt(aSnap, bSnap);
  if (engine === 'codex') return comparePairWithCodex(userPrompt);
  return comparePairWithClaude(userPrompt);
}

async function comparePairWithRetry(aSnap, bSnap, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await comparePairAgent(aSnap, bSnap);
    } catch (err) {
      if (attempt < retries && (err.message.includes('overloaded') || err.message.includes('rate') || err.message.includes('timed out'))) {
        const delay = Math.pow(2, attempt) * 5000 + Math.random() * 3000;
        console.log(`    Retry ${attempt + 1}/${retries} after ${Math.round(delay / 1000)}s: ${err.message.substring(0, 80)}`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// --- Main ---

async function main() {
  console.log(`=== Swiss Agent Runner ===`);
  console.log(`Group: ${group} | Rounds: ${rounds} | Concurrency: ${concurrency} | Engine: ${engine} | Model: ${model}`);
  console.log(`Mode: ${MODE} | Fresh: ${fresh}\n`);

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
  const { groups: verticalGroups, idToVertical } = buildVerticalGroups(firstPass, snapshots);
  const ids = firstPass.map(row => row.contractor_id);

  console.log(`Loaded ${ids.length} contractors, ${verticalGroups.size} verticals`);
  console.log(`Compacted snapshots prepared: ${comparisonSnapshots.size} (max ${largestSnapshotChars} chars)`);
  for (const [v, g] of verticalGroups) console.log(`  ${v}: ${g.length}`);
  console.log();

  // State
  const winStats = new Map();
  const scoreMap = new Map();
  const holisticScores = new Map();
  for (const row of firstPass) holisticScores.set(row.contractor_id, row.score || 50);

  const seedFromHolistic = !args.includes('--no-seed');
  ids.forEach(id => {
    winStats.set(id, { wins: 0, losses: 0, ties: 0, total: 0 });
    scoreMap.set(id, seedFromHolistic ? (holisticScores.get(id) || 50) : 0);
  });

  if (seedFromHolistic) console.log('Seeding from holistic scores');

  const pairSet = new Set();
  const comparisonsPath = path.join(PAIRWISE_DIR, 'comparisons.jsonl');

  // Fresh start?
  if (fresh && fs.existsSync(comparisonsPath)) {
    fs.unlinkSync(comparisonsPath);
    console.log('Cleared existing comparisons (--fresh)');
  }

  let totalComparisons = 0;
  let failedComparisons = 0;
  let startRound = 1;

  // Resume from existing comparisons
  if (!fresh && fs.existsSync(comparisonsPath)) {
    const raw = fs.readFileSync(comparisonsPath, 'utf-8').trim();
    if (raw) {
      let maxSuccessfulRound = 0;
      let maxSeenRound = 0;
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line);
          if (!rec.mode || rec.mode !== MODE) continue;
          if (rec.round > maxSeenRound) maxSeenRound = rec.round;
          if (!rec.pair || rec.error) continue;
          if (rec.round > maxSuccessfulRound) maxSuccessfulRound = rec.round;

          const [aId, bId] = rec.pair;
          pairSet.add(pairKey(aId, bId));

          const aStats = winStats.get(aId) || { wins: 0, losses: 0, ties: 0, total: 0 };
          const bStats = winStats.get(bId) || { wins: 0, losses: 0, ties: 0, total: 0 };

          if (rec.winner === 'A') {
            aStats.wins++; bStats.losses++;
            scoreMap.set(aId, (scoreMap.get(aId) || 0) + 1);
          } else if (rec.winner === 'B') {
            bStats.wins++; aStats.losses++;
            scoreMap.set(bId, (scoreMap.get(bId) || 0) + 1);
          } else {
            aStats.ties++; bStats.ties++;
            scoreMap.set(aId, (scoreMap.get(aId) || 0) + 0.5);
            scoreMap.set(bId, (scoreMap.get(bId) || 0) + 0.5);
          }

          aStats.total++; bStats.total++;
          winStats.set(aId, aStats);
          winStats.set(bId, bStats);
          totalComparisons++;
        } catch (e) { /* skip bad lines */ }
      }
      startRound = maxSuccessfulRound + 1;
      if (maxSeenRound > maxSuccessfulRound) {
        console.log(`Detected failed/incomplete rounds up to ${maxSeenRound}; resuming from last successful round ${maxSuccessfulRound}.`);
      }
      console.log(`Resuming: ${totalComparisons} comparisons, starting round ${startRound}`);
    }
  }

  const rand = mulberry32(42);
  const comparisonsStream = fs.createWriteStream(comparisonsPath, { flags: 'a' });

  const startTime = Date.now();

  for (let round = startRound; round <= rounds; round++) {
    const roundStart = Date.now();
    let roundComparisons = 0;
    let roundFailed = 0;

    for (const [vertical, groupIds] of verticalGroups.entries()) {
      if (groupIds.length < 2) continue;
      const { pairs, byes } = swissPairing(groupIds, scoreMap, pairSet, rand);

      // Process pairs in batches of `concurrency`
      for (let i = 0; i < pairs.length; i += concurrency) {
        const batch = pairs.slice(i, i + concurrency);
        const batchNum = Math.floor(i / concurrency) + 1;
        const totalBatches = Math.ceil(pairs.length / concurrency);

        console.log(`  Round ${round}/${rounds} | ${vertical} | Batch ${batchNum}/${totalBatches} (${batch.length} pairs)`);

        const results = await Promise.all(batch.map(async ([aId, bId]) => {
          const key = pairKey(aId, bId);
          pairSet.add(key);

          const aSnap = comparisonSnapshots.get(aId);
          const bSnap = comparisonSnapshots.get(bId);
          if (!aSnap || !bSnap) return null;

          try {
            const { result, usage, duration_ms } = await comparePairWithRetry(aSnap, bSnap);
            const winner = result.winner;

            // Update stats
            const aStats = winStats.get(aId);
            const bStats = winStats.get(bId);

            if (winner === 'A') {
              aStats.wins++; bStats.losses++;
              scoreMap.set(aId, (scoreMap.get(aId) || 0) + 1);
            } else if (winner === 'B') {
              bStats.wins++; aStats.losses++;
              scoreMap.set(bId, (scoreMap.get(bId) || 0) + 1);
            } else {
              aStats.ties++; bStats.ties++;
              scoreMap.set(aId, (scoreMap.get(aId) || 0) + 0.5);
              scoreMap.set(bId, (scoreMap.get(bId) || 0) + 0.5);
            }
            aStats.total++; bStats.total++;

            const aName = aSnap.business_name || `ID:${aId}`;
            const bName = bSnap.business_name || `ID:${bId}`;
            console.log(`    ${aName} vs ${bName} → ${winner} (conf: ${result.confidence}) [${Math.round(duration_ms / 1000)}s]`);

            return {
              mode: MODE, vertical, round,
              pair: [aId, bId],
              winner,
              confidence: result.confidence,
              reasoning: result.reasoning,
              usage,
              cost_usd: 0,
              pricing: { type: `${engine}_subscription`, engine, model },
              duration_ms
            };
          } catch (err) {
            console.log(`    ERROR ${aId} vs ${bId}: ${err.message.substring(0, 80)}`);
            return {
              mode: MODE, vertical, round,
              pair: [aId, bId],
              error: err.message
            };
          }
        }));

        // Write results
        for (const r of results) {
          if (!r) continue;
          comparisonsStream.write(JSON.stringify(r) + '\n');
          if (r.error) {
            roundFailed++;
            failedComparisons++;
          } else {
            roundComparisons++;
            totalComparisons++;
          }
        }
      }

      // Write byes
      for (const id of byes) {
        comparisonsStream.write(JSON.stringify({ mode: MODE, vertical, round, bye: id }) + '\n');
      }
    }

    const roundDuration = Math.round((Date.now() - roundStart) / 1000);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  Round ${round} done: ${roundComparisons} ok, ${roundFailed} failed, ${roundDuration}s (total: ${totalComparisons}, elapsed: ${elapsed}s)\n`);
  }

  comparisonsStream.end();

  // Write final outputs
  const secondPass = firstPass.map(row => {
    const stats = winStats.get(row.contractor_id) || { wins: 0, losses: 0, ties: 0, total: 0 };
    const total = stats.total || 0;
    const hasCoverage = total >= 1;
    const winRate = hasCoverage ? (stats.wins + 0.5 * stats.ties) / total : null;
    const comparisonScore = hasCoverage ? Math.round(winRate * 100) : null;
    return {
      ...row,
      primary_vertical: idToVertical.get(row.contractor_id) || 'unknown',
      comparisons: stats,
      win_rate: winRate,
      comparison_score: comparisonScore
    };
  });

  fs.writeFileSync(path.join(SWISS_DIR, 'second_pass.json'), JSON.stringify(secondPass, null, 2));

  function mapTier(score) {
    if (score >= 85) return 'TRUSTED';
    if (score >= 70) return 'LOW';
    if (score >= 55) return 'MODERATE';
    if (score >= 35) return 'HIGH';
    return 'CRITICAL';
  }

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

  fs.writeFileSync(path.join(ANALYSIS_DIR, 'summary.json'), JSON.stringify({
    mode: MODE,
    engine,
    model,
    rounds,
    concurrency,
    total_comparisons: totalComparisons,
    failed_comparisons: failedComparisons,
    vertical_groups: Object.fromEntries([...verticalGroups.entries()].map(([v, g]) => [v, g.length])),
    cost_usd: 0,
    pricing: { type: `${engine}_subscription`, engine, model },
    resume_from_round: startRound,
    elapsed_seconds: Math.round((Date.now() - startTime) / 1000)
  }, null, 2));

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`=== COMPLETE ===`);
  console.log(`Comparisons: ${totalComparisons} ok, ${failedComparisons} failed`);
  console.log(`Elapsed: ${elapsed}s (${Math.round(elapsed / 60)}min)`);
  console.log(`Results: ${SWISS_DIR}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
