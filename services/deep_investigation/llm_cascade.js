/**
 * LLM Cascade
 *
 * Orchestrates multi-LLM analysis:
 * - DeepSeek: Initial gap analysis (cheap, good reasoning)
 * - Gemini: Structured output refinement (cheap, good at formatting)
 * - Gemini Evaluator: Final judgment comparing both analyses (free tier)
 */

const { INVESTIGATION_MODE, LLM_CONFIG, THRESHOLDS, SEVERITY } = require('./constants');

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);

// ============ PROMPTS ============

const DEEPSEEK_GAP_ANALYSIS_PROMPT = `You are a forensic investigator analyzing contractor data for ACTUAL fraud indicators.

## MANDATORY FIRST STEP: TIMELINE RECONSTRUCTION

BEFORE analyzing anything else, you MUST reconstruct the complete business timeline from ALL available sources:

TIMELINE DATA FROM SOURCES:
{{timeline_summary}}

Your FIRST task is to:
1. List every timeline claim from every source (website, Google, BBB, HomeAdvisor, Angi, etc.)
2. Identify the most AUTHORITATIVE source (BBB founding_date is gold standard - it's from official records)
3. Calculate discrepancies between claims and authoritative records
4. A 25+ year discrepancy is FRAUD - the contractor is lying about their history

## CONTEXT FOR NON-ISSUES

What is NOT a red flag:
- Missing license: Texas doesn't require licenses for pools, roofing, fencing, patios
- New company: Being new is fine. LYING about being old is fraud.
- Missing insurance verification: Normal - we can't verify most
- Failed searches/scrapers: Technical failures, not evidence

## ACTUAL RED FLAGS

- Timeline fabrication: Claims "30 years experience" but BBB shows founded 2024 → CRITICAL FRAUD
- Virtual mailbox address: UPS Store, Regus, "Suite" at strip mall
- Review manipulation: 4.8 Google rating but 1.9 Yelp
- Active lawsuits: Court cases for fraud, breach of contract
- BBB F rating with actual complaints

CONTRACTOR: {{contractor_name}}
LOCATION: {{contractor_city}}, {{contractor_state}}

RULE-BASED FLAGS:
{{rule_flags}}

RAW DATA:
{{raw_data_summary}}

## YOUR ANALYSIS

1. TIMELINE ANALYSIS (REQUIRED FIRST):
   - What does each source claim about business age/founding?
   - What is the BBB founding_date (most authoritative)?
   - Is there a discrepancy? How many years?
   - If discrepancy > 5 years, this is intentional deception

2. OTHER DISCREPANCIES:
   - Address conflicts
   - Review pattern issues
   - Legal/complaint issues

3. FRAUD INDICATORS:
   - List specific evidence of intentional deception

OUTPUT JSON ONLY:
{
  "timeline_analysis": {
    "bbb_founding_date": "date or null",
    "bbb_years_in_business": number,
    "claims_from_sources": [
      {"source": "...", "claim": "...", "years_claimed": number}
    ],
    "max_discrepancy_years": number,
    "timeline_verdict": "consistent|minor_discrepancy|major_discrepancy|FRAUD"
  },
  "analysis": {
    "key_discrepancies": ["only ACTUAL conflicts with evidence"],
    "fraud_indicators": ["specific evidence of deception"],
    "suspicion_level": "high|medium|low"
  },
  "suggested_queries": [
    {"query": "search string", "rationale": "what fraud evidence this would find"}
  ],
  "confidence": 0.0-1.0
}`;

const GEMINI_STRUCTURE_PROMPT = `You are a data analyst structuring investigation findings for a Texas contractor.

## TIMELINE VERIFICATION (HIGHEST PRIORITY)

You MUST verify the timeline analysis from DeepSeek:

TIMELINE DATA:
{{timeline_summary}}

DEEPSEEK'S TIMELINE ANALYSIS:
(See deepseek_output below)

Your job:
1. Verify DeepSeek correctly identified all timeline claims
2. Confirm or dispute the discrepancy calculation
3. If BBB shows founded in 2024 but contractor claims 30 years → CRITICAL FRAUD
4. Timeline fraud is grounds for AVOID recommendation regardless of other factors

## DO NOT FLAG THESE:
- Missing license (Texas doesn't require for pools, roofing, fencing, patios)
- Being a new company (new is fine, lying about age is fraud)
- Failed scrapers or missing data
- Can't verify insurance

## FLAG THESE WITH EVIDENCE:
- CRITICAL: Timeline fraud (claiming years they don't have), active lawsuits, BBB F rating
- SEVERE: Virtual mailbox, review manipulation, 5+ year timeline discrepancy
- MODERATE: 2-5 year timeline discrepancy, patterns of deception
- LOW: Minor concerns

CONTRACTOR: {{contractor_name}}

DEEPSEEK ANALYSIS:
{{deepseek_output}}

QUERY RESULTS:
{{query_results}}

OUTPUT JSON ONLY:
{
  "timeline_verification": {
    "deepseek_timeline_correct": true|false,
    "verified_bbb_founding": "date or null",
    "verified_max_discrepancy": number,
    "timeline_fraud_confirmed": true|false,
    "timeline_notes": "explanation"
  },
  "confirmed_flags": [
    {"severity": "CRITICAL|SEVERE|MODERATE|LOW", "category": "...", "description": "...", "evidence": "specific evidence"}
  ],
  "verified_positives": ["good things confirmed"],
  "data_gaps": ["things we couldn't verify - informational only"],
  "additional_queries": [
    {"query": "...", "rationale": "...", "priority": "high|medium|low"}
  ],
  "confidence": 0.0-1.0,
  "recommendation": "continue_investigation|sufficient_data|escalate_to_human"
}`;

const GEMINI_EVALUATOR_PROMPT = `You are a senior fraud analyst making the FINAL determination on a Texas contractor.

## CRITICAL: TIMELINE FRAUD IS AN AUTOMATIC AVOID

TIMELINE DATA FROM ALL SOURCES:
{{timeline_summary}}

If the contractor claims significantly more years in business than authoritative records show (BBB founding_date), this is FRAUD and warrants an AVOID recommendation regardless of other factors.

Example: If BBB shows founding_date "09/25/2024" but contractor claims "30 years experience" → This is TIMELINE FRAUD → AVOID

## WHAT IS NOT A RED FLAG:
- Missing license (Texas doesn't require for most contractors)
- Being a new company (new is fine, LYING about being old is fraud)
- Missing insurance verification (normal)
- Failed scrapers/searches (technical issues)

## WHAT IS A RED FLAG (requires evidence):
- Timeline fabrication: Claiming 30 years but founded in 2024 → CRITICAL
- BBB F rating with complaints → CRITICAL
- Active lawsuits → CRITICAL
- Virtual mailbox (UPS Store, Regus) → SEVERE
- Review manipulation → SEVERE

CONTRACTOR: {{contractor_name}}
LOCATION: {{contractor_city}}, {{contractor_state}}

=== ANALYSIS 1: DeepSeek ===
{{deepseek_output}}

=== ANALYSIS 2: Gemini ===
{{gemini_output}}

## YOUR FINAL DETERMINATION

1. TIMELINE VERDICT:
   - What is the BBB founding_date?
   - What is the maximum years claimed anywhere?
   - Is there a discrepancy? How many years?
   - If discrepancy > 10 years → TIMELINE FRAUD → AVOID

2. OTHER FRAUD INDICATORS:
   - List any with ACTUAL evidence

3. RECOMMENDATION:
   - If TIMELINE FRAUD confirmed → "avoid" (non-negotiable)
   - If other CRITICAL flags → "avoid"
   - If SEVERE flags only → "caution"
   - If clean → "recommended" or "acceptable"

OUTPUT JSON ONLY:
{
  "timeline_verdict": {
    "bbb_founding_date": "date from records",
    "bbb_years_in_business": number,
    "max_years_claimed": number,
    "claim_source": "where the claim came from",
    "discrepancy_years": number,
    "is_timeline_fraud": true|false,
    "explanation": "detailed reasoning"
  },
  "final_assessment": {
    "fraud_likelihood": "high|medium|low|negligible",
    "confidence": 0.0-1.0,
    "reasoning": "based on timeline and other evidence"
  },
  "confirmed_fraud_indicators": [
    {"category": "timeline_fraud|virtual_address|review_manipulation|legal_issues", "description": "...", "evidence": "specific evidence", "severity": "CRITICAL|SEVERE"}
  ],
  "verified_positives": ["good things confirmed"],
  "data_gaps_noted": ["informational only - NOT reasons to penalize"],
  "recommendation": "avoid|caution|acceptable|recommended"
}`;

// ============ API CALLS ============

/**
 * Call DeepSeek API for gap analysis
 * @param {string} prompt - The prompt to send
 * @returns {Promise<{result: object, usage: {input_tokens: number, output_tokens: number, cost: number}}>}
 */
async function callDeepSeek(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('No DEEPSEEK_API_KEY');

  const response = await fetch(`${LLM_CONFIG.deepseek.base_url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: LLM_CONFIG.deepseek.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: LLM_CONFIG.deepseek.temperature,
      max_tokens: LLM_CONFIG.deepseek.max_tokens
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in DeepSeek response');

  return {
    result: JSON.parse(jsonMatch[0]),
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      cost: ((usage.prompt_tokens || 0) * 0.00000014) + ((usage.completion_tokens || 0) * 0.00000028)
    }
  };
}

/**
 * Call Gemini API for structured output
 * @param {string} prompt - The prompt to send
 * @returns {Promise<{result: object, usage: {input_tokens: number, output_tokens: number, cost: number}}>}
 */
async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('No GEMINI_API_KEY');

  const response = await fetch(
    `${LLM_CONFIG.gemini.base_url}/${LLM_CONFIG.gemini.model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: LLM_CONFIG.gemini.temperature,
          maxOutputTokens: LLM_CONFIG.gemini.max_tokens
        }
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Estimate tokens (Gemini doesn't return usage in same format)
  const inputTokens = Math.ceil(prompt.length / 4);
  const outputTokens = Math.ceil(content.length / 4);

  // Extract JSON from response - try multiple methods
  let jsonStr = null;

  // Method 1: Look for complete markdown code block
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Method 2: Look for incomplete markdown block (no closing ```)
  if (!jsonStr) {
    const incompleteBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*)/);
    if (incompleteBlockMatch) {
      jsonStr = incompleteBlockMatch[1].trim();
    }
  }

  // Method 3: Look for raw JSON object
  if (!jsonStr) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
  }

  // Method 4: Look for JSON that starts but might be truncated
  if (!jsonStr) {
    const partialMatch = content.match(/\{[\s\S]*/);
    if (partialMatch) {
      jsonStr = partialMatch[0];
    }
  }

  if (!jsonStr) {
    warn(`      Gemini response (no JSON found): ${content.substring(0, 500)}`);
    throw new Error('No JSON in Gemini response');
  }

  // Clean up common JSON issues
  jsonStr = jsonStr
    .replace(/,\s*}/g, '}')   // Remove trailing commas before }
    .replace(/,\s*]/g, ']')   // Remove trailing commas before ]
    .replace(/[\x00-\x1F]/g, ' '); // Remove control characters

  try {
    return {
      result: JSON.parse(jsonStr),
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost: (inputTokens * 0.000000075) + (outputTokens * 0.0000003)  // Gemini Flash pricing
      }
    };
  } catch (parseErr) {
    warn(`      Gemini JSON parse error: ${parseErr.message}`);
    warn(`      JSON string (first 500 chars): ${jsonStr.substring(0, 500)}`);
    throw parseErr;
  }
}

// Note: callClaude removed - using Gemini Evaluator as third tier instead

// ============ CASCADE ORCHESTRATION ============

/**
 * Run the LLM cascade based on investigation mode
 *
 * @param {object} contractor - Contractor object with name, city, state
 * @param {object} ruleCheckResults - Results from runRuleChecks()
 * @param {array} rawData - Raw data from contractor_raw_data table
 * @param {array} queryResults - Results from Serper queries
 * @param {string} mode - 'minimal' | 'standard' | 'full'
 * @returns {Promise<object>} Trace object with steps, total_cost, final_result
 */
async function runLLMCascade(contractor, ruleCheckResults, rawData, queryResults, mode = INVESTIGATION_MODE) {
  const trace = {
    mode,
    steps: [],
    total_cost: 0,
    final_result: null
  };

  log(`\n  Running LLM cascade (mode: ${mode})...`);

  // Build data summaries for prompts
  const rawDataSummary = summarizeRawData(rawData);
  const ruleFlagsSummary = JSON.stringify(ruleCheckResults.flags, null, 2);
  const queryResultsSummary = summarizeQueryResults(queryResults);

  // CRITICAL: Extract comprehensive timeline data for fraud detection
  const timelineSummary = extractTimelineSummary(rawData);
  log('    Timeline summary generated');

  // ============ TIER 1: DeepSeek ============
  try {
    log('    Tier 1: DeepSeek gap analysis...');

    const deepseekPrompt = DEEPSEEK_GAP_ANALYSIS_PROMPT
      .replace('{{contractor_name}}', contractor.name)
      .replace('{{contractor_city}}', contractor.city)
      .replace('{{contractor_state}}', contractor.state)
      .replace('{{timeline_summary}}', timelineSummary)
      .replace('{{rule_flags}}', ruleFlagsSummary)
      .replace('{{raw_data_summary}}', rawDataSummary);

    const deepseekResponse = await callDeepSeek(deepseekPrompt);
    trace.steps.push({
      tier: 'deepseek',
      result: deepseekResponse.result,
      usage: deepseekResponse.usage
    });
    trace.total_cost += deepseekResponse.usage.cost;

    success(`      DeepSeek complete (confidence: ${deepseekResponse.result.confidence}, cost: $${deepseekResponse.usage.cost.toFixed(4)})`);

    // Check if we should stop here (minimal mode)
    if (mode === 'minimal') {
      trace.final_result = {
        source: 'deepseek',
        ...deepseekResponse.result
      };
      return trace;
    }

    // In standard mode, check if we can skip Gemini (cost optimization)
    // In full mode, ALWAYS run all tiers
    const deepseekConfidence = deepseekResponse.result.confidence || 0;
    if (mode === 'standard' &&
        deepseekConfidence >= THRESHOLDS.ESCALATE_TO_GEMINI &&
        !ruleCheckResults.flags.some(f => f.severity === SEVERITY.CRITICAL)) {
      log('      DeepSeek confidence high, skipping Gemini (standard mode)...');
      trace.final_result = {
        source: 'deepseek',
        ...deepseekResponse.result
      };
      return trace;
    }

    // ============ TIER 2: Gemini ============
    log('    Tier 2: Gemini structuring...');

    const geminiPrompt = GEMINI_STRUCTURE_PROMPT
      .replace('{{contractor_name}}', contractor.name)
      .replace('{{timeline_summary}}', timelineSummary)
      .replace('{{deepseek_output}}', JSON.stringify(deepseekResponse.result, null, 2))
      .replace('{{query_results}}', queryResultsSummary);

    const geminiResponse = await callGemini(geminiPrompt);
    trace.steps.push({
      tier: 'gemini',
      result: geminiResponse.result,
      usage: geminiResponse.usage
    });
    trace.total_cost += geminiResponse.usage.cost;

    success(`      Gemini complete (confidence: ${geminiResponse.result.confidence}, cost: $${geminiResponse.usage.cost.toFixed(4)})`);

    // Check if we should stop here (standard mode)
    if (mode === 'standard') {
      trace.final_result = {
        source: 'gemini',
        deepseek_analysis: deepseekResponse.result,
        ...geminiResponse.result
      };
      return trace;
    }

    // Full mode: ALWAYS run evaluator (no early exit)
    // The evaluator compares DeepSeek and Gemini analyses for final judgment

    // ============ TIER 3: Gemini Evaluator (full mode only) ============
    log('    Tier 3: Gemini evaluator (comparing both analyses)...');

    const evaluatorPrompt = GEMINI_EVALUATOR_PROMPT
      .replace('{{contractor_name}}', contractor.name)
      .replace('{{contractor_city}}', contractor.city)
      .replace('{{contractor_state}}', contractor.state)
      .replace('{{timeline_summary}}', timelineSummary)
      .replace('{{deepseek_output}}', JSON.stringify(deepseekResponse.result, null, 2))
      .replace('{{gemini_output}}', JSON.stringify(geminiResponse.result, null, 2));

    const evaluatorResponse = await callGemini(evaluatorPrompt);
    trace.steps.push({
      tier: 'gemini_evaluator',
      result: evaluatorResponse.result,
      usage: evaluatorResponse.usage
    });
    trace.total_cost += evaluatorResponse.usage.cost;

    success(`      Gemini evaluator complete (cost: $${evaluatorResponse.usage.cost.toFixed(4)})`);

    trace.final_result = {
      source: 'gemini_evaluator',
      deepseek_analysis: deepseekResponse.result,
      gemini_structure: geminiResponse.result,
      ...evaluatorResponse.result
    };

    return trace;

  } catch (err) {
    warn(`    LLM cascade error: ${err.message}`);
    trace.error = err.message;
    return trace;
  }
}

// ============ HELPERS ============

/**
 * Extract comprehensive timeline data from all sources
 * This is the MOST IMPORTANT data for fraud detection
 * @param {array} rawData - Array of raw data rows
 * @returns {string} Formatted timeline summary for LLM prompts
 */
function extractTimelineSummary(rawData) {
  if (!rawData || rawData.length === 0) return 'No timeline data available';

  const currentYear = new Date().getFullYear();
  const timelineData = {
    bbb: null,
    claims: [],
    authoritative_founding: null
  };

  // Patterns to extract years claimed from text
  const yearPatterns = [
    /since\s+(\d{4})/gi,
    /established\s+(\d{4})/gi,
    /founded\s+(\d{4})/gi,
    /(\d+)\+?\s*years?\s+(in\s+business|of\s+experience|serving)/gi,
    /serving\s+.*\s+since\s+(\d{4})/gi,
    /over\s+(\d+)\s+years/gi,
    /more\s+than\s+(\d+)\s+years/gi
  ];

  for (const row of rawData) {
    const sourceName = row.source_name;
    let data = null;

    // Parse structured data
    if (row.structured_data) {
      try {
        data = typeof row.structured_data === 'string'
          ? JSON.parse(row.structured_data)
          : row.structured_data;
      } catch (e) {
        data = null;
      }
    }

    // BBB is the gold standard for founding date
    if (sourceName === 'bbb' && data) {
      timelineData.bbb = {
        founding_date: data.founding_date || null,
        accredited_since: data.accredited_since || null,
        years_in_business: data.years_in_business || null
      };

      // Calculate founding year from BBB data
      if (data.founding_date) {
        const parts = data.founding_date.split('/');
        if (parts.length === 3) {
          const year = parseInt(parts[2]);
          timelineData.authoritative_founding = year;
          timelineData.bbb.founding_year = year;
          timelineData.bbb.calculated_years = currentYear - year;
        }
      } else if (data.years_in_business) {
        timelineData.authoritative_founding = currentYear - data.years_in_business;
        timelineData.bbb.founding_year = currentYear - data.years_in_business;
      }
    }

    // Extract years claimed from structured data
    if (data && data.years_in_business && sourceName !== 'bbb') {
      timelineData.claims.push({
        source: sourceName,
        type: 'structured_data',
        years_claimed: data.years_in_business,
        raw: `${data.years_in_business} years in business`
      });
    }

    // Extract years claimed from raw text
    if (row.raw_text) {
      const text = row.raw_text;
      for (const pattern of yearPatterns) {
        const matches = text.matchAll(new RegExp(pattern));
        for (const match of matches) {
          const value = parseInt(match[1]);
          if (value > 1900 && value <= currentYear) {
            // It's a year (e.g., "since 1995")
            timelineData.claims.push({
              source: sourceName,
              type: 'year_mention',
              year: value,
              years_claimed: currentYear - value,
              raw: match[0]
            });
          } else if (value >= 1 && value <= 100) {
            // It's years of experience (e.g., "30 years")
            timelineData.claims.push({
              source: sourceName,
              type: 'years_experience',
              years_claimed: value,
              raw: match[0]
            });
          }
        }
      }
    }
  }

  // Build the summary
  const lines = ['=== TIMELINE DATA ===', ''];

  // BBB (authoritative source)
  lines.push('AUTHORITATIVE SOURCE (BBB):');
  if (timelineData.bbb) {
    if (timelineData.bbb.founding_date) {
      lines.push(`  - Founding Date: ${timelineData.bbb.founding_date}`);
      lines.push(`  - Founding Year: ${timelineData.bbb.founding_year}`);
      lines.push(`  - Calculated Years in Business: ${timelineData.bbb.calculated_years}`);
    } else if (timelineData.bbb.years_in_business) {
      lines.push(`  - Years in Business: ${timelineData.bbb.years_in_business}`);
      lines.push(`  - Estimated Founding Year: ${timelineData.bbb.founding_year}`);
    } else {
      lines.push('  - No founding date available from BBB');
    }
    if (timelineData.bbb.accredited_since) {
      lines.push(`  - BBB Accredited Since: ${timelineData.bbb.accredited_since}`);
    }
  } else {
    lines.push('  - BBB data not available');
  }

  // Claims from other sources
  lines.push('');
  lines.push('CLAIMS FROM OTHER SOURCES:');
  if (timelineData.claims.length > 0) {
    // Deduplicate and sort by years claimed (descending)
    const uniqueClaims = [];
    const seen = new Set();
    for (const claim of timelineData.claims) {
      const key = `${claim.source}-${claim.years_claimed}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueClaims.push(claim);
      }
    }
    uniqueClaims.sort((a, b) => b.years_claimed - a.years_claimed);

    for (const claim of uniqueClaims) {
      lines.push(`  - [${claim.source}]: Claims ${claim.years_claimed} years ("${claim.raw}")`);
    }
  } else {
    lines.push('  - No years-in-business claims found in other sources');
  }

  // Discrepancy analysis
  lines.push('');
  lines.push('DISCREPANCY ANALYSIS:');
  if (timelineData.authoritative_founding && timelineData.claims.length > 0) {
    const maxClaim = Math.max(...timelineData.claims.map(c => c.years_claimed));
    const actualYears = currentYear - timelineData.authoritative_founding;
    const discrepancy = maxClaim - actualYears;

    lines.push(`  - BBB shows: ${actualYears} years (founded ${timelineData.authoritative_founding})`);
    lines.push(`  - Max claim: ${maxClaim} years`);
    lines.push(`  - Discrepancy: ${discrepancy} years`);

    if (discrepancy > 10) {
      lines.push('');
      lines.push('  ⚠️  CRITICAL: This is likely TIMELINE FRAUD');
      lines.push(`      Contractor claims ${maxClaim} years but BBB shows founded ${timelineData.authoritative_founding}`);
      lines.push('      This level of discrepancy (>10 years) indicates intentional deception');
    } else if (discrepancy > 5) {
      lines.push('');
      lines.push('  ⚠️  WARNING: Significant timeline discrepancy (>5 years)');
    } else if (discrepancy > 2) {
      lines.push('');
      lines.push('  ℹ️  NOTE: Minor timeline discrepancy (2-5 years) - may be rounding or interpretation');
    } else {
      lines.push('');
      lines.push('  ✓ Timeline claims appear consistent with BBB records');
    }
  } else if (!timelineData.authoritative_founding) {
    lines.push('  - Cannot verify: No authoritative founding date from BBB');
  } else {
    lines.push('  - Cannot verify: No years-in-business claims found to compare');
  }

  return lines.join('\n');
}

/**
 * Summarize raw data for LLM prompts (truncate to fit context)
 * @param {array} rawData - Array of raw data rows
 * @returns {string} Formatted summary
 */
function summarizeRawData(rawData) {
  if (!rawData || rawData.length === 0) return 'No raw data available';

  const summary = [];
  for (const row of rawData.slice(0, 10)) {
    const sourceName = row.source_name;
    let content = '';

    if (row.structured_data) {
      try {
        const data = typeof row.structured_data === 'string'
          ? JSON.parse(row.structured_data)
          : row.structured_data;
        content = JSON.stringify(data).substring(0, 500);
      } catch (e) {
        content = String(row.structured_data).substring(0, 500);
      }
    } else if (row.raw_text) {
      content = row.raw_text.substring(0, 500);
    }

    summary.push(`[${sourceName}]: ${content}`);
  }

  return summary.join('\n\n');
}

/**
 * Summarize query results for LLM prompts
 * @param {array} queryResults - Array of query result objects
 * @returns {string} Formatted summary
 */
function summarizeQueryResults(queryResults) {
  if (!queryResults || queryResults.length === 0) return 'No query results';

  const summary = [];
  for (const result of queryResults) {
    if (!result.success) continue;
    summary.push(`Query: ${result.query}`);
    for (const r of (result.results || [])) {
      summary.push(`  - ${r.title}: ${r.snippet?.substring(0, 150)}`);
    }
  }

  return summary.join('\n');
}

/**
 * Verify if news mentions are actually negative news about this specific contractor
 * Filters out: BBB boilerplate, positive mentions, different companies with similar names
 *
 * @param {string} contractorName - Full contractor name
 * @param {string} contractorCity - Contractor's city
 * @param {Array} newsMentions - Array of {title, snippet, url} objects
 * @returns {Promise<{verified: Array, cost: number}>} - Verified negative news and cost
 */
async function verifyNewsMentions(contractorName, contractorCity, newsMentions) {
  if (!newsMentions || newsMentions.length === 0) {
    return { verified: [], cost: 0 };
  }

  const prompt = `You are verifying if search results contain ACTUAL negative news about a specific contractor.

CONTRACTOR: ${contractorName}
LOCATION: ${contractorCity}

SEARCH RESULTS TO VERIFY:
${newsMentions.map((m, i) => `
[${i + 1}] Title: ${m.title}
    URL: ${m.url}
    Snippet: ${m.snippet}
`).join('\n')}

FILTER OUT (these are NOT negative news):
- BBB boilerplate text like "When considering complaint information, please take into account..."
- BBB navigation text like "File a Complaint" (just a menu link)
- Positive statements like "No complaints" or "great reviews"
- News about DIFFERENT companies with similar names (check city/location carefully)
- Generic review site descriptions

KEEP ONLY:
- Actual lawsuits against THIS contractor
- Real complaints/scam reports about THIS contractor
- News investigations about THIS contractor
- BBB complaints with actual content (not just boilerplate)

Respond with JSON only:
{
  "verified_negative_news": [
    {
      "index": 1,
      "reason": "Why this is actual negative news about this contractor"
    }
  ],
  "filtered_out": [
    {
      "index": 2,
      "reason": "Why this was filtered (e.g., 'BBB boilerplate', 'different company in Austin')"
    }
  ]
}`;

  try {
    const response = await callDeepSeek(prompt);
    const result = response.result;

    // Extract verified mentions
    const verifiedIndices = (result.verified_negative_news || []).map(v => v.index - 1);
    const verified = verifiedIndices
      .filter(i => i >= 0 && i < newsMentions.length)
      .map(i => ({
        ...newsMentions[i],
        verification_reason: result.verified_negative_news.find(v => v.index === i + 1)?.reason
      }));

    return {
      verified,
      cost: response.usage.cost,
      filtered_count: newsMentions.length - verified.length
    };
  } catch (error) {
    warn(`    News verification failed: ${error.message}`);
    // On error, return empty (fail safe - don't flag without verification)
    return { verified: [], cost: 0, error: error.message };
  }
}

module.exports = {
  runLLMCascade,
  callDeepSeek,
  callGemini,
  verifyNewsMentions,
  extractTimelineSummary,
  summarizeRawData,
  summarizeQueryResults,
  // Export prompts for testing
  DEEPSEEK_GAP_ANALYSIS_PROMPT,
  GEMINI_STRUCTURE_PROMPT,
  GEMINI_EVALUATOR_PROMPT
};
