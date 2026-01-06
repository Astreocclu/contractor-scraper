#!/usr/bin/env node

/**
 * Seed Variance Test
 *
 * Runs 10 contractors × 3 seed configs × 2 agent versions = 60 audits
 * Produces comprehensive variance analysis.
 *
 * Usage: node bin/seed_variance_test.js
 */

const path = require('path');
const fs = require('fs');

// Database
const db = require('../services/db_pg');

// Test configurations
const SEED_CONFIGS = [
  { name: 'seed_42', seed: 42 },
  { name: 'seed_123', seed: 123 },
  { name: 'no_seed', seed: null }
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

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

// Results storage
const results = {
  v3: {},  // { contractor_id: { seed_42: score, seed_123: score, no_seed: score } }
  v1: {},
  raw_responses: [],
  metadata: {
    started_at: new Date().toISOString(),
    contractors: TEST_CONTRACTORS,
    seed_configs: SEED_CONFIGS
  }
};

// Logging
const log = (msg) => {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] ${msg}`);
};
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

/**
 * Get contractor info
 */
async function getContractor(id) {
  const rows = await db.exec(`
    SELECT id, business_name, city, state, website
    FROM contractors_contractor WHERE id = ?
  `, [id]);
  if (rows.length === 0) throw new Error(`Contractor ${id} not found`);
  return rows[0];
}

/**
 * Get collected data for contractor
 */
async function getCollectedData(contractorId) {
  const rows = await db.exec(`
    SELECT source_name, raw_text, structured_data, fetch_status
    FROM contractor_raw_data
    WHERE contractor_id = ?
    ORDER BY source_name
  `, [contractorId]);
  return rows;
}

/**
 * Build data prompt (same as V3 agent)
 */
function buildDataPrompt(contractor, dataRows) {
  let prompt = `## CONTRACTOR INFO
Name: ${contractor.business_name}
Location: ${contractor.city}, ${contractor.state}
Website: ${contractor.website || 'Not provided'}

## COLLECTED DATA\n`;

  let totalChars = 0;
  const MAX_CHARS = 60000;

  for (const row of dataRows) {
    const { source_name, raw_text, structured_data, fetch_status } = row;
    if (fetch_status !== 'success' && fetch_status !== 'not_found') continue;

    let content = '';
    if (structured_data) {
      let data = structured_data;
      if (typeof structured_data === 'string') {
        try { data = JSON.parse(structured_data); } catch { data = structured_data; }
      }

      if (typeof data === 'object' && data !== null) {
        if (source_name === 'county_liens' && data.lien_score) {
          content = JSON.stringify({
            lien_score: data.lien_score,
            summary: data.summary,
            total_records: data.total_records,
            search_term: data.search_term
          }, null, 2);
        } else if (source_name === 'review_analysis' && data.summary) {
          content = JSON.stringify(data, null, 2);
        } else {
          const full = JSON.stringify(data, null, 2);
          content = full.length > 5000 ? full.substring(0, 5000) + '\n...[truncated]' : full;
        }
      } else {
        content = String(data);
      }
    } else if (raw_text) {
      content = raw_text.length > 3000 ? raw_text.substring(0, 3000) + '...[truncated]' : raw_text;
    } else {
      content = `[${fetch_status}]`;
    }

    const section = `\n### ${source_name.toUpperCase()}\n${content}\n`;

    if (totalChars + section.length > MAX_CHARS) {
      prompt += `\n### ${source_name.toUpperCase()}\n[Content truncated - ${raw_text?.length || 0} chars]\n`;
    } else {
      prompt += section;
      totalChars += section.length;
    }
  }

  return prompt;
}

/**
 * V3 System Prompt
 */
const V3_SYSTEM_PROMPT = `You are a forensic investigator with deep reasoning capabilities. Your job: protect homeowners from fraud.

INVESTIGATE this contractor. Look at ALL the data collected.

Ask yourself:
1. What do they CLAIM? (years in business, reviews, quality, licensing)
2. What does the EVIDENCE show? (BBB records, court cases, news, actual reviews)
3. Do claims match evidence?
4. What's the STORY here?

## SEVERITY CLASSIFICATION RULES

**CRITICAL - Confirmed fraud or deception:**
- Fake reviews (>30% fake score from Review Analyzer)
- Scam allegations from multiple independent sources
- Confirmed consumer protection violations

**HIGH - Confirmed operational problems:**
- Active lawsuit AGAINST the contractor
- Judgment or lien AGAINST the contractor
- BBB F rating or revoked accreditation

**MEDIUM - Unverified or uncertain issues:**
- Cannot find business registration
- License not found in state database
- Mixed reviews or significant rating discrepancies

**LOW - Minor gaps:**
- No BBB profile (common for small businesses)
- Low review volume
- Missing social media presence

## SCORING GUIDANCE

SCORE ANCHORS:
- 90-100: Exceptional. Zero HIGH/CRITICAL flags.
- 80-89: Recommended. Minor gaps only.
- 65-79: Mixed. Has at least one HIGH flag.
- 50-64: Concerning. Multiple HIGH flags.
- Below 50: Avoid. CRITICAL flags present.

## OUTPUT FORMAT
After your investigation, respond with ONLY this JSON:
{
  "trust_score": <0-100>,
  "reasoning": "<Your investigative findings>",
  "red_flags": [
    {"severity": "<CRITICAL|HIGH|MEDIUM|LOW>", "category": "<category>", "description": "<what you found>"}
  ],
  "verified_items": ["<verified positive finding>"],
  "unverified_items": ["<what couldn't you verify>"]
}`;

/**
 * V1 System Prompt (simplified - no tool calls for this test)
 */
const V1_SYSTEM_PROMPT = `You are a forensic contractor auditor. Analyze the data and produce a Trust Score.

SCORING METHODOLOGY (base 60 points, normalize to 100):
- Reputation (25 pts): Cross-platform ratings, review authenticity
- Credibility (15 pts): Years in business, registrations
- Financial (10 pts): Liens, bankruptcy signals
- Red Flag Absence (10 pts): No critical issues found

BASELINE SCORING:
- Start at 70 for established business with reviews
- Strong reviews (4.5+ on Google with 20+ reviews) → base 80
- Excellent reviews (4.8+ with 50+ reviews) → base 90
- Deduct for red flags, don't penalize missing data

MULTIPLIERS:
- CRITICAL red flag → ×0.15 (score 0-15)
- SEVERE red flag → ×0.4 (score 15-40)
- MODERATE red flags only → ×0.7 (score 45-65)
- MINOR red flags only → ×0.85 (score 65-80)
- No red flags → ×1.0 (score 80-100)

Respond with ONLY this JSON:
{
  "trust_score": <0-100>,
  "risk_level": "<CRITICAL|SEVERE|MODERATE|LOW|TRUSTED>",
  "recommendation": "<AVOID|NOT_RECOMMENDED|RECOMMENDED>",
  "reasoning": "<your analysis>",
  "red_flags": [{"severity": "<CRITICAL|HIGH|MEDIUM|LOW>", "category": "<cat>", "description": "<desc>"}],
  "positive_signals": ["<positive finding>"],
  "gaps_remaining": ["<data gap>"]
}`;

/**
 * Call DeepSeek with specific seed config
 */
async function callDeepSeek(systemPrompt, userPrompt, seedConfig) {
  const body = {
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0,
    max_tokens: 4000
  };

  // Add seed if specified
  if (seedConfig.seed !== null) {
    body.seed = seedConfig.seed;
  }

  const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`DeepSeek error: ${response.status}`);
  }

  return response.json();
}

/**
 * Extract score from response
 */
function extractScore(responseContent) {
  try {
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.trust_score;
    }
  } catch (e) {
    warn(`  Failed to parse JSON: ${e.message}`);
  }
  return null;
}

/**
 * Run single audit
 */
async function runAudit(contractor, dataRows, version, seedConfig) {
  const systemPrompt = version === 'v3' ? V3_SYSTEM_PROMPT : V1_SYSTEM_PROMPT;
  const userPrompt = buildDataPrompt(contractor, dataRows);

  const startTime = Date.now();
  const response = await callDeepSeek(systemPrompt, userPrompt, seedConfig);
  const duration = Date.now() - startTime;

  const content = response.choices?.[0]?.message?.content || '';
  const score = extractScore(content);
  const usage = response.usage || {};

  results.raw_responses.push({
    contractor_id: contractor.id,
    contractor_name: contractor.business_name,
    version,
    seed_config: seedConfig.name,
    score,
    duration_ms: duration,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    response_preview: content.substring(0, 500)
  });

  return score;
}

/**
 * Calculate variance stats
 */
function calculateVariance(scores) {
  const validScores = scores.filter(s => s !== null);
  if (validScores.length === 0) return { min: null, max: null, range: null, mean: null };

  const min = Math.min(...validScores);
  const max = Math.max(...validScores);
  const range = max - min;
  const mean = validScores.reduce((a, b) => a + b, 0) / validScores.length;

  return { min, max, range, mean: mean.toFixed(1) };
}

/**
 * Generate report
 */
function generateReport() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                          SEED VARIANCE TEST REPORT');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // V3 Results
  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                              V3 RESULTS                                     │');
  console.log('├─────────────────────────────────────────────────────────────────────────────┤');
  console.log('│ Contractor                              │ seed_42 │ seed_123 │ no_seed │ Δ  │');
  console.log('├─────────────────────────────────────────┼─────────┼──────────┼─────────┼────┤');

  let v3TotalRange = 0;
  let v3Count = 0;

  for (const c of TEST_CONTRACTORS) {
    const scores = results.v3[c.id] || {};
    const s42 = scores.seed_42 ?? '-';
    const s123 = scores.seed_123 ?? '-';
    const noSeed = scores.no_seed ?? '-';

    const variance = calculateVariance([scores.seed_42, scores.seed_123, scores.no_seed]);
    const range = variance.range !== null ? variance.range : '-';

    if (variance.range !== null) {
      v3TotalRange += variance.range;
      v3Count++;
    }

    const nameShort = c.name.substring(0, 39).padEnd(39);
    console.log(`│ ${nameShort} │   ${String(s42).padStart(3)}   │    ${String(s123).padStart(3)}   │   ${String(noSeed).padStart(3)}   │ ${String(range).padStart(2)} │`);
  }

  console.log('└─────────────────────────────────────────────────────────────────────────────┘');
  console.log(`  Average V3 variance: ${v3Count > 0 ? (v3TotalRange / v3Count).toFixed(1) : 'N/A'} points\n`);

  // V1 Results
  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                              V1 RESULTS                                     │');
  console.log('├─────────────────────────────────────────────────────────────────────────────┤');
  console.log('│ Contractor                              │ seed_42 │ seed_123 │ no_seed │ Δ  │');
  console.log('├─────────────────────────────────────────┼─────────┼──────────┼─────────┼────┤');

  let v1TotalRange = 0;
  let v1Count = 0;

  for (const c of TEST_CONTRACTORS) {
    const scores = results.v1[c.id] || {};
    const s42 = scores.seed_42 ?? '-';
    const s123 = scores.seed_123 ?? '-';
    const noSeed = scores.no_seed ?? '-';

    const variance = calculateVariance([scores.seed_42, scores.seed_123, scores.no_seed]);
    const range = variance.range !== null ? variance.range : '-';

    if (variance.range !== null) {
      v1TotalRange += variance.range;
      v1Count++;
    }

    const nameShort = c.name.substring(0, 39).padEnd(39);
    console.log(`│ ${nameShort} │   ${String(s42).padStart(3)}   │    ${String(s123).padStart(3)}   │   ${String(noSeed).padStart(3)}   │ ${String(range).padStart(2)} │`);
  }

  console.log('└─────────────────────────────────────────────────────────────────────────────┘');
  console.log(`  Average V1 variance: ${v1Count > 0 ? (v1TotalRange / v1Count).toFixed(1) : 'N/A'} points\n`);

  // Summary
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                                 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`  Total audits run:    ${results.raw_responses.length}`);
  console.log(`  V3 avg variance:     ${v3Count > 0 ? (v3TotalRange / v3Count).toFixed(1) : 'N/A'} points`);
  console.log(`  V1 avg variance:     ${v1Count > 0 ? (v1TotalRange / v1Count).toFixed(1) : 'N/A'} points`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
}

/**
 * Main
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                        SEED VARIANCE TEST');
  console.log('                   10 contractors × 3 seeds × 2 versions');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const totalRuns = TEST_CONTRACTORS.length * SEED_CONFIGS.length * 2;
  let completed = 0;

  // Run V3 tests
  console.log('\n📊 Running V3 audits...\n');
  for (const c of TEST_CONTRACTORS) {
    results.v3[c.id] = {};
    const contractor = await getContractor(c.id);
    const dataRows = await getCollectedData(c.id);

    for (const seedConfig of SEED_CONFIGS) {
      completed++;
      const pct = ((completed / totalRuns) * 100).toFixed(0);
      process.stdout.write(`  [${pct}%] V3 | ${c.name.substring(0, 30).padEnd(30)} | ${seedConfig.name.padEnd(10)} `);

      try {
        const score = await runAudit(contractor, dataRows, 'v3', seedConfig);
        results.v3[c.id][seedConfig.name] = score;
        console.log(`→ ${score !== null ? score : 'ERROR'}`);
      } catch (err) {
        error(`→ FAILED: ${err.message}`);
        results.v3[c.id][seedConfig.name] = null;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Run V1 tests
  console.log('\n📊 Running V1 audits...\n');
  for (const c of TEST_CONTRACTORS) {
    results.v1[c.id] = {};
    const contractor = await getContractor(c.id);
    const dataRows = await getCollectedData(c.id);

    for (const seedConfig of SEED_CONFIGS) {
      completed++;
      const pct = ((completed / totalRuns) * 100).toFixed(0);
      process.stdout.write(`  [${pct}%] V1 | ${c.name.substring(0, 30).padEnd(30)} | ${seedConfig.name.padEnd(10)} `);

      try {
        const score = await runAudit(contractor, dataRows, 'v1', seedConfig);
        results.v1[c.id][seedConfig.name] = score;
        console.log(`→ ${score !== null ? score : 'ERROR'}`);
      } catch (err) {
        error(`→ FAILED: ${err.message}`);
        results.v1[c.id][seedConfig.name] = null;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Save raw results
  results.metadata.completed_at = new Date().toISOString();
  const outputPath = path.join(__dirname, '..', 'seed_variance_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  log(`\nRaw results saved to: ${outputPath}`);

  // Generate report
  generateReport();
}

main().catch(err => {
  error(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
