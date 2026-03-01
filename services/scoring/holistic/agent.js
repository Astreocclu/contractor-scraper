/**
 * Holistic Scoring Agent
 *
 * LLM-first scoring without rubric constraints.
 * Validated by experiment A2 (100% rank consistency, 0 variance, 77pt separation).
 *
 * Philosophy: Let the LLM assess the totality of evidence. Determinism achieved
 * via model parameters (temp=0, seed=42), not mathematical constraints.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = path.join(__dirname, '..', '..', '..', 'experiments', 'holistic', 'config');
const RESULTS_DIR = path.join(__dirname, '..', '..', '..', 'experiments', 'holistic', 'results');

/**
 * Load prompt configuration
 */
function loadPrompt() {
  const promptPath = path.join(CONFIG_DIR, 'prompt.json');
  return JSON.parse(fs.readFileSync(promptPath, 'utf-8'));
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

  const timeoutMs = parseInt(process.env.HOLISTIC_TIMEOUT_MS || '90000', 10);
  const maxRetries = parseInt(process.env.HOLISTIC_MAX_RETRIES || '1', 10);

  async function requestOnce() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
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
        }),
        signal: controller.signal
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
    } finally {
      clearTimeout(timeout);
    }
  }

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestOnce();
    } catch (err) {
      lastError = err;
      const isAbort = err?.name === 'AbortError';
      const isLast = attempt === maxRetries;
      if (isLast) break;
      const waitMs = isAbort ? 1500 : 1000;
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  if (lastError?.name === 'AbortError') {
    throw new Error(`DeepSeek timeout after ${timeoutMs}ms`);
  }
  throw lastError;
}

/**
 * Run holistic scoring on a contractor
 *
 * @param {Object} contractorData - Evidence snapshot for the contractor
 * @param {Object} meta - Contractor metadata (id, name, archetype, expected)
 * @returns {Object} Standardized result object
 */
async function score(contractorData, meta) {
  const startTime = Date.now();
  const prompt = loadPrompt();
  const settings = loadSettings();

  // Build user prompt
  const userPrompt = `CONTRACTOR DATA:
${JSON.stringify(contractorData, null, 2)}

Respond with JSON matching this format:
${JSON.stringify(prompt.output_format, null, 2)}`;

  // Hash the prompt for versioning
  const promptHash = crypto.createHash('sha256')
    .update(prompt.system + userPrompt)
    .digest('hex')
    .substring(0, 16);

  try {
    const { result, usage } = await callDeepSeek(prompt.system, userPrompt, settings);
    const duration = Date.now() - startTime;

    // Build standardized output
    const output = {
      meta: {
        approach: 'holistic',
        version: prompt.version,
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
        confidence: result.confidence || 80,
        reasoning: result.reasoning,
        red_flags: result.red_flags || [],
        positives: result.positives || result.key_factors || [],
        improvement_actions: result.improvement_actions || []
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
        approach: 'holistic',
        version: prompt.version,
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

module.exports = { score, saveResult, loadPrompt, loadSettings };
