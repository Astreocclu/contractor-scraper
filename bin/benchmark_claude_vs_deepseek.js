#!/usr/bin/env node
/**
 * Benchmark: Claude vs DeepSeek on Holistic Scoring
 *
 * Takes 10 contractors already scored by DeepSeek, runs them through
 * Claude Haiku and Claude Sonnet with the exact same prompt, compares results.
 */
const fs = require('fs');
const path = require('path');

const SNAPSHOT_DIR = path.join(__dirname, '..', 'experiments', 'hybrid_100_C', 'data', 'snapshots', '2026-02-07');
const FIRST_PASS = require('../experiments/hybrid_100_C/results/first_pass.json');
const PROMPT_CONFIG = require('../experiments/holistic/config/prompt.json');

const SAMPLE_IDS = [25, 443, 476, 112, 29, 3018, 3022, 478, 156, 470];

// Claude models to test
const CLAUDE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', cost_input: 0.80, cost_output: 4.00 },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', cost_input: 3.00, cost_output: 15.00 },
];

// Cost per million tokens
const DEEPSEEK_COST = { input: 0.14, output: 0.28 };

async function callClaude(systemPrompt, userPrompt, model) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No ANTHROPIC_API_KEY');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model.id,
      max_tokens: 2000,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude error: ${response.status} - ${text.substring(0, 300)}`);
  }

  const data = await response.json();
  let content = data.content?.[0]?.text || '';
  const usage = data.usage || {};

  // Strip markdown blocks
  content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in Claude response: ${content.substring(0, 200)}`);

  const inputCost = (usage.input_tokens || 0) * model.cost_input / 1_000_000;
  const outputCost = (usage.output_tokens || 0) * model.cost_output / 1_000_000;

  return {
    result: JSON.parse(jsonMatch[0]),
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cost_usd: inputCost + outputCost
    }
  };
}

function loadSnapshot(contractorId) {
  const files = fs.readdirSync(SNAPSHOT_DIR);
  const file = files.find(f => f.startsWith(contractorId + '_'));
  if (!file) throw new Error(`No snapshot for contractor ${contractorId}`);
  return JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, file), 'utf-8'));
}

function buildUserPrompt(snapshot) {
  return `CONTRACTOR DATA:\n${JSON.stringify(snapshot, null, 2)}\n\nRespond with JSON matching this format:\n${JSON.stringify(PROMPT_CONFIG.output_format, null, 2)}`;
}

async function runBenchmark() {
  console.log('=== Claude vs DeepSeek Holistic Scoring Benchmark ===\n');
  console.log(`Sample: ${SAMPLE_IDS.length} contractors`);
  console.log(`Models: DeepSeek (baseline), ${CLAUDE_MODELS.map(m => m.label).join(', ')}\n`);

  const results = [];
  let totalCost = { haiku: 0, sonnet: 0 };

  for (const cid of SAMPLE_IDS) {
    const deepseekResult = FIRST_PASS.find(c => c.contractor_id === cid);
    if (!deepseekResult) {
      console.log(`SKIP: No DeepSeek result for ${cid}`);
      continue;
    }

    const snapshot = loadSnapshot(cid);
    const userPrompt = buildUserPrompt(snapshot);

    console.log(`\n--- ${deepseekResult.business_name} (ID: ${cid}, DeepSeek: ${deepseekResult.score}) ---`);

    const entry = {
      contractor_id: cid,
      business_name: deepseekResult.business_name,
      deepseek: {
        score: deepseekResult.score,
        tier: deepseekResult.tier,
        reasoning: deepseekResult.reasoning,
        breakdown: deepseekResult.score_breakdown
      },
      claude: {}
    };

    for (const model of CLAUDE_MODELS) {
      try {
        const start = Date.now();
        const { result, usage } = await callClaude(PROMPT_CONFIG.system, userPrompt, model);
        const duration = Date.now() - start;

        const score = parseInt(result.trust_score) || 0;
        const delta = score - deepseekResult.score;

        entry.claude[model.label] = {
          score,
          risk_level: result.risk_level,
          reasoning: result.reasoning,
          breakdown: result.category_scores,
          red_flags: result.red_flags,
          positives: result.positives,
          tokens: usage,
          duration_ms: duration,
          delta_from_deepseek: delta
        };

        if (model.label === 'Haiku 4.5') totalCost.haiku += usage.cost_usd;
        if (model.label === 'Sonnet 4.5') totalCost.sonnet += usage.cost_usd;

        console.log(`  ${model.label}: ${score} (${delta >= 0 ? '+' : ''}${delta}) $${usage.cost_usd.toFixed(4)} ${duration}ms`);
        console.log(`    Reasoning: ${(result.reasoning || '').substring(0, 120)}...`);
      } catch (err) {
        console.log(`  ${model.label}: ERROR - ${err.message}`);
        entry.claude[model.label] = { error: err.message };
      }
    }

    results.push(entry);

    // Small delay between contractors
    await new Promise(r => setTimeout(r, 500));
  }

  // Summary analysis
  console.log('\n\n=== SUMMARY ===\n');

  const valid = results.filter(r => r.claude['Haiku 4.5']?.score != null && r.claude['Sonnet 4.5']?.score != null);

  console.log('Score Comparison Table:');
  console.log('Contractor'.padEnd(35) + 'DeepSeek'.padStart(10) + 'Haiku'.padStart(10) + 'Sonnet'.padStart(10) + 'H-Delta'.padStart(10) + 'S-Delta'.padStart(10));
  console.log('-'.repeat(85));

  for (const r of valid) {
    const h = r.claude['Haiku 4.5'];
    const s = r.claude['Sonnet 4.5'];
    console.log(
      r.business_name.substring(0, 34).padEnd(35) +
      String(r.deepseek.score).padStart(10) +
      String(h.score).padStart(10) +
      String(s.score).padStart(10) +
      ((h.delta_from_deepseek >= 0 ? '+' : '') + h.delta_from_deepseek).padStart(10) +
      ((s.delta_from_deepseek >= 0 ? '+' : '') + s.delta_from_deepseek).padStart(10)
    );
  }

  // Correlation stats
  const haikuDeltas = valid.map(r => r.claude['Haiku 4.5'].delta_from_deepseek);
  const sonnetDeltas = valid.map(r => r.claude['Sonnet 4.5'].delta_from_deepseek);

  const avgHaikuDelta = haikuDeltas.reduce((a, b) => a + b, 0) / haikuDeltas.length;
  const avgSonnetDelta = sonnetDeltas.reduce((a, b) => a + b, 0) / sonnetDeltas.length;
  const avgHaikuAbsDelta = haikuDeltas.map(Math.abs).reduce((a, b) => a + b, 0) / haikuDeltas.length;
  const avgSonnetAbsDelta = sonnetDeltas.map(Math.abs).reduce((a, b) => a + b, 0) / sonnetDeltas.length;

  // Rank agreement
  const dsRank = valid.map(r => r.deepseek.score).map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map(x => x.i);
  const hRank = valid.map(r => r.claude['Haiku 4.5'].score).map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map(x => x.i);
  const sRank = valid.map(r => r.claude['Sonnet 4.5'].score).map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map(x => x.i);

  // Tier agreement
  function tierFromScore(s) {
    if (s >= 85) return 'TRUSTED';
    if (s >= 70) return 'LOW';
    if (s >= 55) return 'MODERATE';
    if (s >= 35) return 'HIGH';
    return 'CRITICAL';
  }
  const haikuTierMatch = valid.filter(r => tierFromScore(r.claude['Haiku 4.5'].score) === tierFromScore(r.deepseek.score)).length;
  const sonnetTierMatch = valid.filter(r => tierFromScore(r.claude['Sonnet 4.5'].score) === tierFromScore(r.deepseek.score)).length;

  console.log('\n--- Statistics ---');
  console.log(`Haiku avg delta: ${avgHaikuDelta.toFixed(1)} (abs: ${avgHaikuAbsDelta.toFixed(1)})`);
  console.log(`Sonnet avg delta: ${avgSonnetDelta.toFixed(1)} (abs: ${avgSonnetAbsDelta.toFixed(1)})`);
  console.log(`Haiku tier agreement: ${haikuTierMatch}/${valid.length} (${(haikuTierMatch/valid.length*100).toFixed(0)}%)`);
  console.log(`Sonnet tier agreement: ${sonnetTierMatch}/${valid.length} (${(sonnetTierMatch/valid.length*100).toFixed(0)}%)`);

  console.log('\n--- Cost ---');
  console.log(`Haiku total (${valid.length} contractors): $${totalCost.haiku.toFixed(4)}`);
  console.log(`Sonnet total (${valid.length} contractors): $${totalCost.sonnet.toFixed(4)}`);
  console.log(`Haiku per contractor: $${(totalCost.haiku / valid.length).toFixed(4)}`);
  console.log(`Sonnet per contractor: $${(totalCost.sonnet / valid.length).toFixed(4)}`);

  // DeepSeek cost estimate (from existing data)
  const dsEstCost = 0.025; // ~$0.025 per contractor at DeepSeek rates
  console.log(`DeepSeek est per contractor: ~$${dsEstCost.toFixed(4)}`);
  console.log(`\nCost multiplier vs DeepSeek:`);
  console.log(`  Haiku: ${(totalCost.haiku / valid.length / dsEstCost).toFixed(1)}x`);
  console.log(`  Sonnet: ${(totalCost.sonnet / valid.length / dsEstCost).toFixed(1)}x`);

  // Save results
  const outputPath = path.join(__dirname, '..', 'experiments', 'benchmark_claude_vs_deepseek.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    run_at: new Date().toISOString(),
    sample_size: valid.length,
    models: ['deepseek-chat', ...CLAUDE_MODELS.map(m => m.id)],
    results,
    summary: {
      haiku: { avg_delta: avgHaikuDelta, avg_abs_delta: avgHaikuAbsDelta, tier_agreement: `${haikuTierMatch}/${valid.length}`, total_cost: totalCost.haiku },
      sonnet: { avg_delta: avgSonnetDelta, avg_abs_delta: avgSonnetAbsDelta, tier_agreement: `${sonnetTierMatch}/${valid.length}`, total_cost: totalCost.sonnet }
    }
  }, null, 2));
  console.log(`\nResults saved: ${outputPath}`);
}

runBenchmark().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
