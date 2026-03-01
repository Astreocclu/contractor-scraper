/**
 * Experiment Agent
 *
 * Flexible agent that can run any variation from the experiment matrix.
 */

const { buildPrompt, buildPairwisePrompt } = require('./experiment_prompts');
const { callDeepSeek, callClaude, callGemini } = require('./council_callers');
const { runForensicAudit } = require('./orchestrator');

const MODEL_CALLERS = {
  deepseek: callDeepSeek,
  claude: callClaude,
  gemini: callGemini
};

/**
 * Run a single audit with specified variation parameters
 */
async function runVariation(variation, contractorData, options = {}) {
  const startTime = Date.now();

  try {
    let result;

    switch (variation.mode) {
      case 'single':
        result = await runSingleAgent(variation, contractorData);
        break;

      case 'council_median':
        result = await runCouncilMedian(variation, contractorData);
        break;

      case 'council_average':
        result = await runCouncilAverage(variation, contractorData);
        break;

      case 'dialectic':
        result = await runDialectic(contractorData, options);
        break;

      case 'cascade':
        result = await runCascade(variation, contractorData);
        break;

      case 'mixed_council':
        result = await runMixedCouncil(contractorData);
        break;

      case 'head_to_head':
        result = await runHeadToHead(contractorData, options.allContractors);
        break;

      default:
        throw new Error(`Unknown mode: ${variation.mode}`);
    }

    const duration = Date.now() - startTime;

    return {
      success: true,
      variation: variation.id,
      ...result,
      duration_ms: duration
    };

  } catch (err) {
    return {
      success: false,
      variation: variation.id,
      error: err.message,
      duration_ms: Date.now() - startTime
    };
  }
}

/**
 * Single agent scoring
 */
async function runSingleAgent(variation, contractorData) {
  const prompt = buildPrompt(variation.style, contractorData);
  const caller = MODEL_CALLERS[variation.model];

  if (!caller) {
    throw new Error(`Unknown model: ${variation.model}`);
  }

  const response = await caller(prompt.system, prompt.user, {
    temperature: 0,
    seed: 42
  });

  const parsed = JSON.parse(response);

  return {
    trust_score: parsed.trust_score,
    risk_level: parsed.risk_level,
    reasoning: parsed.reasoning,
    red_flags: parsed.red_flags || [],
    raw_response: parsed,
    cost_usd: estimateCost(variation.model, prompt.user.length, response.length)
  };
}

/**
 * Council with median score (3 parallel runs)
 */
async function runCouncilMedian(variation, contractorData) {
  const singleVariation = { ...variation, mode: 'single' };

  const results = await Promise.all([
    runSingleAgent(singleVariation, contractorData),
    runSingleAgent(singleVariation, contractorData),
    runSingleAgent(singleVariation, contractorData)
  ]);

  const scores = results.map(r => r.trust_score).sort((a, b) => a - b);
  const medianScore = scores[1]; // Middle value

  return {
    trust_score: medianScore,
    risk_level: scoreToRiskLevel(medianScore),
    reasoning: `Council median of [${scores.join(', ')}]`,
    individual_scores: scores,
    red_flags: mergeRedFlags(results),
    cost_usd: results.reduce((sum, r) => sum + r.cost_usd, 0)
  };
}

/**
 * Council with average score (3 parallel runs)
 */
async function runCouncilAverage(variation, contractorData) {
  const singleVariation = { ...variation, mode: 'single' };

  const results = await Promise.all([
    runSingleAgent(singleVariation, contractorData),
    runSingleAgent(singleVariation, contractorData),
    runSingleAgent(singleVariation, contractorData)
  ]);

  const scores = results.map(r => r.trust_score);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  return {
    trust_score: avgScore,
    risk_level: scoreToRiskLevel(avgScore),
    reasoning: `Council average of [${scores.join(', ')}]`,
    individual_scores: scores,
    red_flags: mergeRedFlags(results),
    cost_usd: results.reduce((sum, r) => sum + r.cost_usd, 0)
  };
}

/**
 * Existing dialectic mode (Advocate/Arbiter/Synthesizer)
 */
async function runDialectic(contractorData, options) {
  // Use existing orchestrator with dialectic mode
  const result = await runForensicAudit(
    { id: contractorData.contractor_id },
    { mode: 'dialectic', skipCollection: true, batchMode: true }
  );

  return {
    trust_score: result.trust_score,
    risk_level: result.risk_level,
    reasoning: result.reasoning_trace,
    red_flags: result.red_flags || [],
    cost_usd: result.total_cost || 0.007
  };
}

/**
 * Cascade: DeepSeek scores, Gemini reviews
 */
async function runCascade(variation, contractorData) {
  // Step 1: DeepSeek with rubric
  const deepseekPrompt = buildPrompt('rubric', contractorData);
  const deepseekResponse = await callDeepSeek(
    deepseekPrompt.system,
    deepseekPrompt.user,
    { temperature: 0, seed: 42 }
  );
  const deepseekResult = JSON.parse(deepseekResponse);

  // Step 2: Gemini reviews and potentially adjusts
  const reviewPrompt = {
    system: `You are a senior auditor reviewing a junior auditor's work.
Review this contractor audit and either confirm the score or adjust it with justification.
Be conservative - only change the score if you see a clear error in reasoning.`,
    user: `CONTRACTOR DATA:
${JSON.stringify(contractorData, null, 2)}

JUNIOR AUDITOR'S ASSESSMENT:
${JSON.stringify(deepseekResult, null, 2)}

Review this assessment. Output JSON:
{
  "original_score": ${deepseekResult.trust_score},
  "adjusted_score": <your score 0-100>,
  "adjustment_reason": "<why you changed it, or 'Confirmed - no adjustment needed'>",
  "final_trust_score": <the score to use>,
  "risk_level": "<CRITICAL|HIGH|MEDIUM|LOW>"
}`
  };

  const geminiResponse = await callGemini(reviewPrompt.system, reviewPrompt.user);
  const geminiResult = JSON.parse(geminiResponse);

  return {
    trust_score: geminiResult.final_trust_score || geminiResult.adjusted_score,
    risk_level: geminiResult.risk_level,
    reasoning: `DeepSeek: ${deepseekResult.trust_score}, Gemini adjusted to: ${geminiResult.adjusted_score}. ${geminiResult.adjustment_reason}`,
    red_flags: deepseekResult.red_flags || [],
    cascade_trace: { deepseek: deepseekResult, gemini: geminiResult },
    cost_usd: estimateCost('deepseek', deepseekPrompt.user.length, deepseekResponse.length) +
              estimateCost('gemini', reviewPrompt.user.length, geminiResponse.length)
  };
}

/**
 * Mixed council: DeepSeek + Claude + Gemini
 */
async function runMixedCouncil(contractorData) {
  const prompt = buildPrompt('holistic', contractorData);

  const [deepseekRes, claudeRes, geminiRes] = await Promise.all([
    callDeepSeek(prompt.system, prompt.user, { temperature: 0, seed: 42 }),
    callClaude(prompt.system, prompt.user),
    callGemini(prompt.system, prompt.user)
  ]);

  const results = [
    { model: 'deepseek', ...JSON.parse(deepseekRes) },
    { model: 'claude', ...JSON.parse(claudeRes) },
    { model: 'gemini', ...JSON.parse(geminiRes) }
  ];

  const scores = results.map(r => r.trust_score);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  return {
    trust_score: avgScore,
    risk_level: scoreToRiskLevel(avgScore),
    reasoning: `Mixed council: DeepSeek=${scores[0]}, Claude=${scores[1]}, Gemini=${scores[2]}, Avg=${avgScore}`,
    individual_results: results,
    red_flags: mergeRedFlags(results),
    cost_usd: estimateCost('deepseek', prompt.user.length, deepseekRes.length) +
              estimateCost('claude', prompt.user.length, claudeRes.length) +
              estimateCost('gemini', prompt.user.length, geminiRes.length)
  };
}

/**
 * Head-to-head pairwise comparisons
 */
async function runHeadToHead(contractorData, allContractors) {
  if (!allContractors || allContractors.length < 2) {
    throw new Error('Head-to-head requires all contractors for comparison');
  }

  // Compare this contractor against all others
  const comparisons = [];
  let wins = 0;
  let losses = 0;

  for (const other of allContractors) {
    if (other.contractor_id === contractorData.contractor_id) continue;

    const prompt = buildPairwisePrompt(contractorData, other);
    const response = await callDeepSeek(prompt.system, prompt.user, { temperature: 0, seed: 42 });
    const result = JSON.parse(response);

    comparisons.push({
      vs: other.business_name,
      winner: result.winner,
      reasoning: result.reasoning
    });

    if (result.winner === 'A') wins++;
    else if (result.winner === 'B') losses++;
  }

  // Convert win/loss to score (0-100 scale)
  const totalComparisons = wins + losses + comparisons.filter(c => c.winner === 'TIE').length;
  const winRate = totalComparisons > 0 ? wins / totalComparisons : 0.5;
  const derivedScore = Math.round(winRate * 100);

  return {
    trust_score: derivedScore,
    risk_level: scoreToRiskLevel(derivedScore),
    reasoning: `Won ${wins}/${totalComparisons} comparisons`,
    comparisons,
    red_flags: [],
    cost_usd: comparisons.length * 0.002
  };
}

// Helpers
function scoreToRiskLevel(score) {
  if (score >= 70) return 'LOW';
  if (score >= 50) return 'MEDIUM';
  if (score >= 25) return 'HIGH';
  return 'CRITICAL';
}

function mergeRedFlags(results) {
  const flags = new Set();
  for (const r of results) {
    if (r.red_flags) r.red_flags.forEach(f => flags.add(f));
  }
  return Array.from(flags);
}

function estimateCost(model, inputLen, outputLen) {
  // Rough estimates per 1K tokens
  const rates = {
    deepseek: { input: 0.00014, output: 0.00028 },
    claude: { input: 0.003, output: 0.015 },
    gemini: { input: 0.000125, output: 0.000375 }
  };
  const rate = rates[model] || rates.deepseek;
  const inputTokens = inputLen / 4;
  const outputTokens = outputLen / 4;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1000;
}

module.exports = {
  runVariation,
  MODEL_CALLERS
};
