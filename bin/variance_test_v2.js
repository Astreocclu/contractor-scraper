#!/usr/bin/env node

/**
 * Comprehensive Variance Test v2
 *
 * Tests multiple dimensions:
 * - Seeds: 42, 123, none
 * - Temperatures: 0, 0.1
 *
 * 10 contractors × 6 configs = 60 audits
 * Full response logging and statistical analysis.
 *
 * Usage: node bin/variance_test_v2.js
 */

const path = require('path');
const fs = require('fs');
const db = require('../services/db_pg');

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

// Test matrix
const CONFIGS = [
  { name: 'seed42_temp0', seed: 42, temperature: 0 },
  { name: 'seed123_temp0', seed: 123, temperature: 0 },
  { name: 'noseed_temp0', seed: null, temperature: 0 },
  { name: 'seed42_temp01', seed: 42, temperature: 0.1 },
  { name: 'seed123_temp01', seed: 123, temperature: 0.1 },
  { name: 'noseed_temp01', seed: null, temperature: 0.1 }
];

const TEST_CONTRACTORS = [
  { id: 14, name: 'The Complete Backyard, Inc.' },
  { id: 314, name: 'John Wade Roofing' },
  { id: 115, name: 'Claffey Pools Retail' },
  { id: 3699, name: 'Texas Slab Leaks' },
  { id: 266, name: 'The Roofing Pro' },
  { id: 1142, name: 'Advocate Construction' },
  { id: 304, name: 'Texas Roof Masters & Construction Co.' },
  { id: 590, name: 'H&A Luna\'s Fencing' },
  { id: 290, name: 'PROCO Roofing' },
  { id: 11455, name: 'Clearview Window Cleaning - Keller' }
];

// Results
const results = {
  metadata: {
    started_at: new Date().toISOString(),
    configs: CONFIGS,
    contractors: TEST_CONTRACTORS,
    total_runs: TEST_CONTRACTORS.length * CONFIGS.length
  },
  runs: [],  // All individual run data
  by_contractor: {},  // { contractor_id: { config_name: { score, reasoning_preview, red_flags_count, ... } } }
  by_config: {},  // { config_name: { scores: [], avg, stddev, ... } }
  analysis: {}
};

// Logging
const log = (msg) => {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
};

const SYSTEM_PROMPT = `You are a forensic investigator. Analyze this contractor data and provide a trust assessment.

SCORING ANCHORS:
- 90-100: Exceptional. Zero HIGH/CRITICAL flags. Verified excellence.
- 80-89: Recommended. Minor gaps only (MEDIUM/LOW flags).
- 65-79: Mixed. Has HIGH flag OR multiple MEDIUM flags.
- 50-64: Concerning. Multiple HIGH flags.
- Below 50: Avoid. CRITICAL flags or pattern of problems.

SEVERITY LEVELS:
- CRITICAL: Confirmed fraud, fake reviews, scam allegations
- HIGH: Active lawsuits, liens AGAINST contractor, BBB F rating
- MEDIUM: Unverified registration, license not found, mixed reviews
- LOW: No BBB profile, low review volume, missing social media

OUTPUT FORMAT - Respond with ONLY this JSON:
{
  "trust_score": <0-100>,
  "reasoning": "<Your analysis - be specific about evidence>",
  "red_flags": [
    {"severity": "<CRITICAL|HIGH|MEDIUM|LOW>", "category": "<category>", "description": "<finding>"}
  ],
  "verified_items": ["<positive findings>"],
  "unverified_items": ["<gaps>"]
}`;

async function getContractor(id) {
  const rows = await db.exec(`
    SELECT id, business_name, city, state, website
    FROM contractors_contractor WHERE id = ?
  `, [id]);
  if (rows.length === 0) throw new Error(`Contractor ${id} not found`);
  return rows[0];
}

async function getCollectedData(contractorId) {
  return await db.exec(`
    SELECT source_name, raw_text, structured_data, fetch_status
    FROM contractor_raw_data
    WHERE contractor_id = ?
    ORDER BY source_name
  `, [contractorId]);
}

function buildDataPrompt(contractor, dataRows) {
  let prompt = `## CONTRACTOR\nName: ${contractor.business_name}\nLocation: ${contractor.city}, ${contractor.state}\nWebsite: ${contractor.website || 'N/A'}\n\n## DATA\n`;

  let chars = 0;
  const MAX = 50000;

  for (const row of dataRows) {
    if (row.fetch_status !== 'success' && row.fetch_status !== 'not_found') continue;

    let content = '';
    if (row.structured_data) {
      let data = row.structured_data;
      if (typeof data === 'string') try { data = JSON.parse(data); } catch {}

      if (row.source_name === 'county_liens' && data?.lien_score) {
        content = JSON.stringify({ lien_score: data.lien_score, summary: data.summary }, null, 2);
      } else if (typeof data === 'object') {
        const full = JSON.stringify(data, null, 2);
        content = full.length > 4000 ? full.slice(0, 4000) + '...' : full;
      } else {
        content = String(data);
      }
    } else if (row.raw_text) {
      content = row.raw_text.length > 2500 ? row.raw_text.slice(0, 2500) + '...' : row.raw_text;
    } else {
      content = `[${row.fetch_status}]`;
    }

    const section = `\n### ${row.source_name.toUpperCase()}\n${content}\n`;
    if (chars + section.length > MAX) {
      prompt += `\n### ${row.source_name.toUpperCase()}\n[truncated]\n`;
    } else {
      prompt += section;
      chars += section.length;
    }
  }

  return prompt;
}

async function callDeepSeek(userPrompt, config) {
  const body = {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    temperature: config.temperature,
    max_tokens: 4000
  };

  if (config.seed !== null) {
    body.seed = config.seed;
  }

  const start = Date.now();
  const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    usage: data.usage || {},
    duration_ms: Date.now() - start
  };
}

function parseResponse(content) {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        score: parsed.trust_score,
        reasoning: parsed.reasoning,
        red_flags: parsed.red_flags || [],
        verified: parsed.verified_items || [],
        unverified: parsed.unverified_items || [],
        raw: parsed
      };
    }
  } catch (e) {}
  return { score: null, reasoning: null, red_flags: [], verified: [], unverified: [], raw: null };
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sqDiffs = arr.map(x => Math.pow(x - mean, 2));
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

async function runTest(contractor, dataRows, config, runIndex, totalRuns) {
  const pct = ((runIndex / totalRuns) * 100).toFixed(0);
  process.stdout.write(`  [${pct.padStart(3)}%] ${contractor.business_name.slice(0, 28).padEnd(28)} | ${config.name.padEnd(14)} `);

  const userPrompt = buildDataPrompt(contractor, dataRows);

  try {
    const response = await callDeepSeek(userPrompt, config);
    const parsed = parseResponse(response.content);

    const run = {
      contractor_id: contractor.id,
      contractor_name: contractor.business_name,
      config_name: config.name,
      seed: config.seed,
      temperature: config.temperature,
      score: parsed.score,
      reasoning_preview: (parsed.reasoning || '').slice(0, 200),
      red_flags_count: parsed.red_flags.length,
      red_flags_critical: parsed.red_flags.filter(f => f.severity === 'CRITICAL').length,
      red_flags_high: parsed.red_flags.filter(f => f.severity === 'HIGH').length,
      verified_count: parsed.verified.length,
      unverified_count: parsed.unverified.length,
      duration_ms: response.duration_ms,
      prompt_tokens: response.usage.prompt_tokens,
      completion_tokens: response.usage.completion_tokens,
      full_response: parsed.raw,
      raw_content: response.content
    };

    results.runs.push(run);

    // Index by contractor
    if (!results.by_contractor[contractor.id]) {
      results.by_contractor[contractor.id] = { name: contractor.business_name, configs: {} };
    }
    results.by_contractor[contractor.id].configs[config.name] = {
      score: parsed.score,
      red_flags_count: parsed.red_flags.length,
      reasoning_preview: (parsed.reasoning || '').slice(0, 100)
    };

    // Index by config
    if (!results.by_config[config.name]) {
      results.by_config[config.name] = { scores: [], runs: [] };
    }
    if (parsed.score !== null) {
      results.by_config[config.name].scores.push(parsed.score);
    }
    results.by_config[config.name].runs.push(run);

    console.log(`→ ${parsed.score !== null ? parsed.score.toString().padStart(3) : 'ERR'} (${parsed.red_flags.length} flags)`);

    return parsed.score;
  } catch (err) {
    console.log(`→ FAILED: ${err.message}`);
    return null;
  }
}

function generateAnalysis() {
  const a = results.analysis;

  // Per-config stats
  a.config_stats = {};
  for (const [name, data] of Object.entries(results.by_config)) {
    const scores = data.scores;
    if (scores.length === 0) continue;
    a.config_stats[name] = {
      count: scores.length,
      min: Math.min(...scores),
      max: Math.max(...scores),
      range: Math.max(...scores) - Math.min(...scores),
      mean: (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1),
      stddev: stddev(scores).toFixed(2)
    };
  }

  // Per-contractor variance
  a.contractor_variance = {};
  for (const [id, data] of Object.entries(results.by_contractor)) {
    const scores = Object.values(data.configs).map(c => c.score).filter(s => s !== null);
    if (scores.length === 0) continue;
    a.contractor_variance[id] = {
      name: data.name,
      min: Math.min(...scores),
      max: Math.max(...scores),
      range: Math.max(...scores) - Math.min(...scores),
      mean: (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1),
      stddev: stddev(scores).toFixed(2)
    };
  }

  // Temperature comparison
  const temp0_scores = [];
  const temp01_scores = [];
  for (const run of results.runs) {
    if (run.score === null) continue;
    if (run.temperature === 0) temp0_scores.push(run.score);
    else temp01_scores.push(run.score);
  }

  a.temperature_comparison = {
    temp_0: {
      count: temp0_scores.length,
      mean: temp0_scores.length ? (temp0_scores.reduce((a, b) => a + b, 0) / temp0_scores.length).toFixed(1) : null,
      stddev: stddev(temp0_scores).toFixed(2)
    },
    temp_01: {
      count: temp01_scores.length,
      mean: temp01_scores.length ? (temp01_scores.reduce((a, b) => a + b, 0) / temp01_scores.length).toFixed(1) : null,
      stddev: stddev(temp01_scores).toFixed(2)
    }
  };

  // Seed comparison (at temp 0)
  const seed42 = results.runs.filter(r => r.seed === 42 && r.temperature === 0 && r.score !== null).map(r => r.score);
  const seed123 = results.runs.filter(r => r.seed === 123 && r.temperature === 0 && r.score !== null).map(r => r.score);
  const noSeed = results.runs.filter(r => r.seed === null && r.temperature === 0 && r.score !== null).map(r => r.score);

  a.seed_comparison_temp0 = {
    seed_42: { mean: seed42.length ? (seed42.reduce((a, b) => a + b, 0) / seed42.length).toFixed(1) : null, stddev: stddev(seed42).toFixed(2) },
    seed_123: { mean: seed123.length ? (seed123.reduce((a, b) => a + b, 0) / seed123.length).toFixed(1) : null, stddev: stddev(seed123).toFixed(2) },
    no_seed: { mean: noSeed.length ? (noSeed.reduce((a, b) => a + b, 0) / noSeed.length).toFixed(1) : null, stddev: stddev(noSeed).toFixed(2) }
  };

  // Overall variance
  const allScores = results.runs.filter(r => r.score !== null).map(r => r.score);
  a.overall = {
    total_runs: results.runs.length,
    successful_runs: allScores.length,
    min: Math.min(...allScores),
    max: Math.max(...allScores),
    mean: (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(1),
    stddev: stddev(allScores).toFixed(2)
  };
}

function generateReport() {
  const a = results.analysis;

  let report = `# Variance Test Report

Generated: ${new Date().toISOString()}

## Test Configuration

- **Contractors tested:** ${TEST_CONTRACTORS.length}
- **Configurations:** ${CONFIGS.length}
- **Total runs:** ${results.runs.length}
- **Successful runs:** ${a.overall.successful_runs}

### Configurations Tested

| Config | Seed | Temperature |
|--------|------|-------------|
`;

  for (const c of CONFIGS) {
    report += `| ${c.name} | ${c.seed ?? 'none'} | ${c.temperature} |\n`;
  }

  report += `
## Overall Results

| Metric | Value |
|--------|-------|
| Mean Score | ${a.overall.mean} |
| Std Dev | ${a.overall.stddev} |
| Min | ${a.overall.min} |
| Max | ${a.overall.max} |

## Temperature Impact

| Temperature | Mean | Std Dev |
|-------------|------|---------|
| 0 | ${a.temperature_comparison.temp_0.mean} | ${a.temperature_comparison.temp_0.stddev} |
| 0.1 | ${a.temperature_comparison.temp_01.mean} | ${a.temperature_comparison.temp_01.stddev} |

## Seed Impact (at temp=0)

| Seed | Mean | Std Dev |
|------|------|---------|
| 42 | ${a.seed_comparison_temp0.seed_42.mean} | ${a.seed_comparison_temp0.seed_42.stddev} |
| 123 | ${a.seed_comparison_temp0.seed_123.mean} | ${a.seed_comparison_temp0.seed_123.stddev} |
| none | ${a.seed_comparison_temp0.no_seed.mean} | ${a.seed_comparison_temp0.no_seed.stddev} |

## Per-Contractor Variance

| Contractor | Min | Max | Range | Mean | StdDev |
|------------|-----|-----|-------|------|--------|
`;

  for (const [id, v] of Object.entries(a.contractor_variance)) {
    report += `| ${v.name.slice(0, 35)} | ${v.min} | ${v.max} | ${v.range} | ${v.mean} | ${v.stddev} |\n`;
  }

  report += `
## Detailed Results Matrix

| Contractor | seed42_t0 | seed123_t0 | noseed_t0 | seed42_t01 | seed123_t01 | noseed_t01 |
|------------|-----------|------------|-----------|------------|-------------|------------|
`;

  for (const c of TEST_CONTRACTORS) {
    const configs = results.by_contractor[c.id]?.configs || {};
    const row = [
      c.name.slice(0, 30),
      configs.seed42_temp0?.score ?? '-',
      configs.seed123_temp0?.score ?? '-',
      configs.noseed_temp0?.score ?? '-',
      configs.seed42_temp01?.score ?? '-',
      configs.seed123_temp01?.score ?? '-',
      configs.noseed_temp01?.score ?? '-'
    ];
    report += `| ${row.join(' | ')} |\n`;
  }

  return report;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                    COMPREHENSIVE VARIANCE TEST v2');
  console.log('              10 contractors × 6 configs (seed × temperature)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const totalRuns = TEST_CONTRACTORS.length * CONFIGS.length;
  let runIndex = 0;

  for (const c of TEST_CONTRACTORS) {
    const contractor = await getContractor(c.id);
    const dataRows = await getCollectedData(c.id);

    for (const config of CONFIGS) {
      runIndex++;
      await runTest(contractor, dataRows, config, runIndex, totalRuns);
      await new Promise(r => setTimeout(r, 400));  // Rate limit
    }

    console.log('');  // Blank line between contractors
  }

  // Generate analysis
  generateAnalysis();
  results.metadata.completed_at = new Date().toISOString();

  // Save JSON results
  const jsonPath = path.join(__dirname, '..', 'variance_test_results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  log(`JSON results saved: ${jsonPath}`);

  // Save markdown report
  const report = generateReport();
  const mdPath = path.join(__dirname, '..', 'docs', 'variance_test_report.md');
  fs.writeFileSync(mdPath, report);
  log(`Markdown report saved: ${mdPath}`);

  // Print summary
  console.log('\n' + '═'.repeat(79));
  console.log('                              SUMMARY');
  console.log('═'.repeat(79) + '\n');

  const a = results.analysis;
  console.log(`Overall: mean=${a.overall.mean}, stddev=${a.overall.stddev}, range=${a.overall.min}-${a.overall.max}\n`);

  console.log('Temperature Impact:');
  console.log(`  temp=0:   mean=${a.temperature_comparison.temp_0.mean}, stddev=${a.temperature_comparison.temp_0.stddev}`);
  console.log(`  temp=0.1: mean=${a.temperature_comparison.temp_01.mean}, stddev=${a.temperature_comparison.temp_01.stddev}\n`);

  console.log('Seed Impact (temp=0):');
  console.log(`  seed=42:   mean=${a.seed_comparison_temp0.seed_42.mean}, stddev=${a.seed_comparison_temp0.seed_42.stddev}`);
  console.log(`  seed=123:  mean=${a.seed_comparison_temp0.seed_123.mean}, stddev=${a.seed_comparison_temp0.seed_123.stddev}`);
  console.log(`  no seed:   mean=${a.seed_comparison_temp0.no_seed.mean}, stddev=${a.seed_comparison_temp0.no_seed.stddev}\n`);

  console.log('Per-Contractor Variance (range):');
  for (const [id, v] of Object.entries(a.contractor_variance)) {
    const flag = v.range >= 10 ? ' ⚠️ HIGH' : v.range >= 5 ? ' ⚡' : '';
    console.log(`  ${v.name.slice(0, 35).padEnd(35)} Δ${v.range.toString().padStart(2)}${flag}`);
  }

  console.log('\n' + '═'.repeat(79));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
