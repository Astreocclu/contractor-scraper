/**
 * Deterministic Scoring Agent
 *
 * Codex's scorecard-first approach with bounded LLM adjustment.
 *
 * Philosophy: Compute base score from rubric, LLM can only adjust +/- 5 points.
 * This is the CONTROL approach being compared against holistic.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = path.join(__dirname, '..', '..', '..', 'experiments', 'deterministic', 'config');
const RESULTS_DIR = path.join(__dirname, '..', '..', '..', 'experiments', 'deterministic', 'results');

/**
 * Load scorecard configuration
 */
function loadScorecard() {
  const scorecardPath = path.join(CONFIG_DIR, 'scorecard.json');
  return JSON.parse(fs.readFileSync(scorecardPath, 'utf-8'));
}

/**
 * Load model settings
 */
function loadSettings() {
  const settingsPath = path.join(CONFIG_DIR, 'settings.json');
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
}

/**
 * Call DeepSeek API
 */
async function callDeepSeek(systemPrompt, userPrompt, settings) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('No DEEPSEEK_API_KEY');

  const response = await fetch(`${settings.api_base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: settings.temperature,
      seed: settings.seed,
      max_tokens: settings.max_tokens
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  let content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  // Strip markdown code blocks if present
  content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  // Extract JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${content.substring(0, 100)}`);

  return {
    result: JSON.parse(jsonMatch[0]),
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      cost_usd: ((usage.prompt_tokens || 0) * 0.00000014) + ((usage.completion_tokens || 0) * 0.00000028)
    }
  };
}

/**
 * Run deterministic scoring on a contractor
 *
 * @param {Object} contractorData - Evidence snapshot for the contractor
 * @param {Object} meta - Contractor metadata (id, name, archetype, expected)
 * @returns {Object} Standardized result object
 */
async function score(contractorData, meta) {
  const startTime = Date.now();
  const scorecard = loadScorecard();
  const settings = loadSettings();

  // Build user prompt with rubric output format
  const outputFormat = {
    trust_score: "<0-100>",
    risk_level: "<CRITICAL|HIGH|MEDIUM|LOW>",
    category_scores: {
      license: "<0-20>",
      reputation: "<0-25>",
      legal: "<0-25>",
      stability: "<0-15>",
      red_flag_deduction: "<0-15>"
    },
    reasoning: "<2-3 sentence summary>",
    red_flags: []
  };

  const userPrompt = `CONTRACTOR DATA:
${JSON.stringify(contractorData, null, 2)}

Respond with JSON matching this format:
${JSON.stringify(outputFormat, null, 2)}`;

  // Hash the prompt for versioning
  const promptHash = crypto.createHash('sha256')
    .update(scorecard.system_prompt + userPrompt)
    .digest('hex')
    .substring(0, 16);

  try {
    const { result, usage } = await callDeepSeek(scorecard.system_prompt, userPrompt, settings);
    const duration = Date.now() - startTime;

    // Build standardized output
    const output = {
      meta: {
        approach: 'deterministic',
        version: scorecard.version,
        prompt_hash: `sha256:${promptHash}`,
        model: settings.model,
        model_params: { temperature: settings.temperature, seed: settings.seed },
        run_at: new Date().toISOString(),
        duration_ms: duration,
        cost_usd: usage.cost_usd
      },
      contractor: {
        id: meta.id,
        name: meta.name,
        city: meta.city || '',
        archetype: meta.archetype || '',
        expected_score: meta.expected || meta.expected_score || 0
      },
      result: {
        trust_score: result.trust_score,
        risk_level: result.risk_level || scoreToRiskLevel(result.trust_score),
        confidence: 80, // Deterministic approach assumes high confidence
        reasoning: result.reasoning,
        red_flags: result.red_flags || [],
        positives: [],
        improvement_actions: []
      },
      comparison_helpers: {
        delta_from_expected: result.trust_score - (meta.expected || meta.expected_score || 0),
        category_scores: result.category_scores || {}
      }
    };

    return output;

  } catch (err) {
    return {
      meta: {
        approach: 'deterministic',
        version: scorecard.version,
        prompt_hash: `sha256:${promptHash}`,
        model: settings.model,
        model_params: { temperature: settings.temperature, seed: settings.seed },
        run_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        cost_usd: 0,
        error: err.message
      },
      contractor: {
        id: meta.id,
        name: meta.name,
        city: meta.city || '',
        archetype: meta.archetype || '',
        expected_score: meta.expected || meta.expected_score || 0
      },
      result: null,
      comparison_helpers: null
    };
  }
}

/**
 * Save result to file
 */
function saveResult(output) {
  const safeName = output.contractor.name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${output.contractor.id}_${safeName}_${timestamp}.json`;
  const filepath = path.join(RESULTS_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
  return filepath;
}

function scoreToRiskLevel(score) {
  if (score >= 70) return 'LOW';
  if (score >= 50) return 'MEDIUM';
  if (score >= 25) return 'HIGH';
  return 'CRITICAL';
}

module.exports = { score, saveResult, loadScorecard, loadSettings };
