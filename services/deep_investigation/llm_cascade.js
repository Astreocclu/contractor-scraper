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

const DEEPSEEK_GAP_ANALYSIS_PROMPT = `You are a forensic investigator analyzing contractor data for fraud indicators.

TASK: Identify knowledge gaps and generate targeted search queries.

CONTRACTOR: {{contractor_name}}
LOCATION: {{contractor_city}}, {{contractor_state}}

RULE-BASED FLAGS FOUND:
{{rule_flags}}

RAW DATA SUMMARY:
{{raw_data_summary}}

ANALYZE:
1. What discrepancies exist between claimed and verified information?
2. What critical information is missing?
3. What specific searches would help verify or disprove the flags?

OUTPUT JSON ONLY:
{
  "analysis": {
    "key_discrepancies": ["..."],
    "missing_information": ["..."],
    "suspicion_level": "high|medium|low"
  },
  "suggested_queries": [
    {"query": "search string", "rationale": "why this search helps"}
  ],
  "confidence": 0.0-1.0
}`;

const GEMINI_STRUCTURE_PROMPT = `You are a data analyst structuring investigation findings.

CONTRACTOR: {{contractor_name}}

DEEPSEEK ANALYSIS:
{{deepseek_output}}

QUERY RESULTS:
{{query_results}}

TASK: Structure the findings into actionable intelligence.

OUTPUT JSON ONLY:
{
  "confirmed_flags": [
    {"severity": "CRITICAL|SEVERE|MODERATE|LOW", "category": "...", "description": "...", "evidence": "..."}
  ],
  "unconfirmed_flags": [
    {"category": "...", "description": "...", "needs": "what would confirm this"}
  ],
  "verified_positives": ["..."],
  "additional_queries": [
    {"query": "...", "rationale": "...", "priority": "high|medium|low"}
  ],
  "confidence": 0.0-1.0,
  "recommendation": "continue_investigation|sufficient_data|escalate_to_human"
}`;

const GEMINI_EVALUATOR_PROMPT = `You are a senior fraud analyst evaluating TWO independent analyses of the same contractor.

CONTRACTOR: {{contractor_name}}
LOCATION: {{contractor_city}}, {{contractor_state}}

=== ANALYSIS 1: DeepSeek Gap Analysis ===
{{deepseek_output}}

=== ANALYSIS 2: Gemini Structured Findings ===
{{gemini_output}}

TASK: Compare both analyses and provide final judgment.

Consider:
- Where do both analyses AGREE? (high confidence findings)
- Where do they DISAGREE? (needs more investigation or human review)
- Are the flags genuine red flags or explainable?
- Is there a pattern suggesting intentional deception?
- What is the risk level for a homeowner hiring this contractor?

OUTPUT JSON ONLY:
{
  "final_assessment": {
    "fraud_likelihood": "high|medium|low|negligible",
    "confidence": 0.0-1.0,
    "reasoning": "detailed explanation"
  },
  "analysis_comparison": {
    "agreements": ["findings both analyses confirmed"],
    "disagreements": ["findings where analyses differed"],
    "stronger_analysis": "deepseek|gemini|equal"
  },
  "critical_flags": [
    {"category": "...", "description": "...", "evidence": "...", "severity": "CRITICAL|SEVERE"}
  ],
  "mitigating_factors": ["..."],
  "recommendation": "avoid|caution|acceptable|recommended",
  "suggested_human_review_points": ["..."]
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

  // Method 1: Look for markdown code block
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Method 2: Look for raw JSON object
  if (!jsonStr) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
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

  // ============ TIER 1: DeepSeek ============
  try {
    log('    Tier 1: DeepSeek gap analysis...');

    const deepseekPrompt = DEEPSEEK_GAP_ANALYSIS_PROMPT
      .replace('{{contractor_name}}', contractor.name)
      .replace('{{contractor_city}}', contractor.city)
      .replace('{{contractor_state}}', contractor.state)
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

module.exports = {
  runLLMCascade,
  callDeepSeek,
  callGemini,
  summarizeRawData,
  summarizeQueryResults,
  // Export prompts for testing
  DEEPSEEK_GAP_ANALYSIS_PROMPT,
  GEMINI_STRUCTURE_PROMPT,
  GEMINI_EVALUATOR_PROMPT
};
