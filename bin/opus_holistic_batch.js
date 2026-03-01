#!/usr/bin/env node
/**
 * Batch holistic scoring using Claude Opus agents.
 *
 * Runs the same forensic auditor prompt as DeepSeek but through Claude Opus,
 * processing contractors in parallel batches of 5.
 *
 * Usage:
 *   node bin/opus_holistic_batch.js --group=D [--concurrency=5] [--model=claude-opus-4-6]
 */
const fs = require('fs');
const path = require('path');

const PROMPT_CONFIG = require('../experiments/holistic/config/prompt.json');

// Parse args
const groupArg = process.argv.find(a => a.startsWith('--group='));
const concurrencyArg = process.argv.find(a => a.startsWith('--concurrency='));
const modelArg = process.argv.find(a => a.startsWith('--model='));
const resumeArg = process.argv.includes('--resume');

const group = groupArg ? groupArg.split('=')[1] : 'D';
const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1]) : 5;
const model = modelArg ? modelArg.split('=')[1] : 'claude-opus-4-6';

const experimentDir = `hybrid_100_${group}`;
const BASE_DIR = path.join(__dirname, '..', 'experiments', experimentDir);
const SNAPSHOT_DIR = fs.readdirSync(path.join(BASE_DIR, 'data', 'snapshots'))
  .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
  .sort()
  .pop();
const SNAPSHOT_PATH = path.join(BASE_DIR, 'data', 'snapshots', SNAPSHOT_DIR);
const RESULTS_PATH = path.join(BASE_DIR, 'results', 'first_pass.json');

// Model pricing per million tokens
const PRICING = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4 },
};

function tierFromScore(score) {
  if (score >= 85) return 'TRUSTED';
  if (score >= 70) return 'LOW';
  if (score >= 55) return 'MODERATE';
  if (score >= 35) return 'HIGH';
  return 'CRITICAL';
}

async function callClaude(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No ANTHROPIC_API_KEY');

  const pricing = PRICING[model] || PRICING['claude-opus-4-6'];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude ${response.status}: ${text.substring(0, 300)}`);
  }

  const data = await response.json();
  let content = data.content?.[0]?.text || '';
  const usage = data.usage || {};

  content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${content.substring(0, 200)}`);

  const inputCost = (usage.input_tokens || 0) * pricing.input / 1_000_000;
  const outputCost = (usage.output_tokens || 0) * pricing.output / 1_000_000;

  return {
    result: JSON.parse(jsonMatch[0]),
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cost_usd: inputCost + outputCost
    },
    raw_reasoning: content
  };
}

async function scoreContractor(snapshotFile) {
  const snapshot = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_PATH, snapshotFile), 'utf-8'));

  const userPrompt = `CONTRACTOR DATA:\n${JSON.stringify(snapshot, null, 2)}\n\nRespond with JSON matching this format:\n${JSON.stringify(PROMPT_CONFIG.output_format, null, 2)}`;

  const start = Date.now();
  const { result, usage } = await callClaude(PROMPT_CONFIG.system, userPrompt);
  const duration = Date.now() - start;

  const score = parseInt(result.trust_score) || 0;

  return {
    contractor_id: snapshot.contractor_id,
    business_name: snapshot.business_name,
    city: snapshot.city,
    state: snapshot.state,
    verticals: snapshot.verticals || [],
    scoring_mode: `holistic_${model}`,
    score,
    risk_level: result.risk_level || tierFromScore(score),
    tier: tierFromScore(score),
    score_breakdown: result.category_scores || {},
    reasoning: result.reasoning || '',
    red_flags: result.red_flags || [],
    positives: result.positives || [],
    confidence: parseInt(result.confidence) || 80,
    cost_usd: usage.cost_usd,
    duration_ms: duration,
    tokens: { input: usage.input_tokens, output: usage.output_tokens }
  };
}

async function processBatch(files) {
  return Promise.all(files.map(async (f) => {
    try {
      return await scoreContractor(f);
    } catch (err) {
      const idMatch = f.match(/^(\d+)_/);
      console.error(`  ERROR ${f}: ${err.message}`);
      return {
        contractor_id: idMatch ? parseInt(idMatch[1]) : 0,
        business_name: f.replace(/\.json$/, ''),
        error: err.message,
        score: null
      };
    }
  }));
}

async function main() {
  console.log(`=== Opus Holistic Batch Scoring ===`);
  console.log(`Group: ${group} | Model: ${model} | Concurrency: ${concurrency}`);
  console.log(`Snapshots: ${SNAPSHOT_PATH}\n`);

  // Load existing results for resume
  let existingResults = [];
  const existingIds = new Set();
  if (resumeArg && fs.existsSync(RESULTS_PATH)) {
    existingResults = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));
    for (const r of existingResults) {
      if (r.score !== null && r.score !== undefined) {
        existingIds.add(r.contractor_id);
      }
    }
    console.log(`Resuming: ${existingIds.size} already scored\n`);
  }

  const snapshotFiles = fs.readdirSync(SNAPSHOT_PATH)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .filter(f => {
      if (!resumeArg) return true;
      const idMatch = f.match(/^(\d+)_/);
      return idMatch ? !existingIds.has(parseInt(idMatch[1])) : true;
    });

  console.log(`Contractors to score: ${snapshotFiles.length}\n`);

  const allResults = [...existingResults];
  let totalCost = existingResults.reduce((sum, r) => sum + (r.cost_usd || 0), 0);
  let scored = existingIds.size;
  const total = scored + snapshotFiles.length;

  // Process in batches
  for (let i = 0; i < snapshotFiles.length; i += concurrency) {
    const batch = snapshotFiles.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(snapshotFiles.length / concurrency);

    console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} contractors)...`);

    const results = await processBatch(batch);

    for (const r of results) {
      allResults.push(r);
      if (r.score !== null && r.score !== undefined) {
        scored++;
        totalCost += r.cost_usd || 0;
        console.log(`  ${r.business_name}: ${r.score} (${r.tier}) $${(r.cost_usd || 0).toFixed(4)}`);
      }
    }

    // Save progress after each batch
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(allResults, null, 2));
    console.log(`  Progress: ${scored}/${total} | Cost: $${totalCost.toFixed(2)}\n`);
  }

  // Final summary
  const validResults = allResults.filter(r => r.score !== null && r.score !== undefined);
  const tiers = {};
  for (const r of validResults) {
    tiers[r.tier] = (tiers[r.tier] || 0) + 1;
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Scored: ${validResults.length}/${total}`);
  console.log(`Total cost: $${totalCost.toFixed(2)}`);
  console.log(`Avg cost/contractor: $${(totalCost / validResults.length).toFixed(4)}`);
  console.log(`Tier distribution:`, tiers);
  console.log(`Results: ${RESULTS_PATH}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
