/**
 * Council API Callers
 *
 * Calls different LLM providers for the multi-model council.
 * Each council member has a specific persona/role.
 */

const { COUNCIL_CONFIG } = require('./deep_investigation/constants');

const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);

/**
 * Call Azure GPT-5-nano (Consumer Advocate)
 * Uses Azure OpenAI API format with chain-of-thought prompting
 */
async function callAzureGPT(prompt) {
  const config = COUNCIL_CONFIG.consumer_advocate;
  if (!config.enabled) {
    return { result: null, skipped: true, reason: 'Consumer Advocate disabled' };
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_GPT5_DEPLOYMENT || config.deployment;

  if (!endpoint || !apiKey) {
    throw new Error('Missing AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_API_KEY');
  }

  // Wrap with chain-of-thought prompting for deeper reasoning
  const cotPrompt = config.use_cot
    ? `Think through this step by step before giving your final assessment.\n\n${prompt}\n\nFirst reason through the evidence, then provide your JSON response.`
    : prompt;

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-15-preview`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: cotPrompt }],
      max_completion_tokens: config.max_tokens
      // Note: GPT-5-nano only supports temperature=1 (default)
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Azure GPT error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  let content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  // Strip markdown code blocks if present
  content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in Azure GPT response: ${content.substring(0, 100)}`);

  return {
    result: JSON.parse(jsonMatch[0]),
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      cost: ((usage.prompt_tokens || 0) * 0.00000015) + ((usage.completion_tokens || 0) * 0.0000006)
    }
  };
}

/**
 * Call Gemini 3 Pro (Fair Arbiter)
 * With thinking enabled for deeper reasoning
 */
async function callGeminiFairArbiter(prompt) {
  const config = COUNCIL_CONFIG.fair_arbiter;
  if (!config.enabled) {
    return { result: null, skipped: true, reason: 'Fair Arbiter disabled' };
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('No GOOGLE_API_KEY');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${apiKey}`;

  // Build request with optional thinking config
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: config.temperature,
      maxOutputTokens: config.max_tokens
    }
  };

  // Enable thinking if configured (Gemini 3 Pro supports this)
  if (config.thinking) {
    requestBody.generationConfig.thinkingConfig = {
      thinkingBudget: 2048
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  let content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata || {};

  // Strip markdown code blocks if present
  content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in Gemini response: ${content.substring(0, 100)}`);

  return {
    result: JSON.parse(jsonMatch[0]),
    usage: {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
      cost: ((usage.promptTokenCount || 0) * 0.000000075) + ((usage.candidatesTokenCount || 0) * 0.0000003)
    }
  };
}

/**
 * Call DeepSeek R1 Reasoner (Independent Scorer)
 *
 * R1 PROMPTING BEST PRACTICES:
 * - NO chain-of-thought prompting (built-in reasoning)
 * - NO system prompt (all instructions in user role)
 * - Zero-shot prompts work best
 * - Ignores temperature (uses internal reasoning)
 * - Returns reasoning_content separately
 */
async function callDeepSeekScorer(prompt) {
  const config = COUNCIL_CONFIG.independent_scorer;
  if (!config.enabled) {
    return { result: null, skipped: true, reason: 'Independent Scorer disabled' };
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('No DEEPSEEK_API_KEY');

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: config.model,  // deepseek-reasoner (R1)
      messages: [{ role: 'user', content: prompt }],  // NO system prompt for R1
      max_tokens: config.max_tokens
      // Note: R1 ignores temperature, top_p, and other sampling params
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek R1 error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  // R1 returns reasoning in reasoning_content, final answer in content
  let content = data.choices?.[0]?.message?.content || '';
  const reasoning = data.choices?.[0]?.message?.reasoning_content || '';
  const usage = data.usage || {};

  // Strip markdown code blocks if present
  content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in DeepSeek R1 response: ${content.substring(0, 100)}`);

  // R1 pricing: $0.55/M input, $2.19/M output
  return {
    result: JSON.parse(jsonMatch[0]),
    reasoning: reasoning,  // Internal chain of thought
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      cost: ((usage.prompt_tokens || 0) * 0.00000055) + ((usage.completion_tokens || 0) * 0.00000219)
    }
  };
}

/**
 * Call Claude Haiku 4.5 Judge
 * Synthesizes all council perspectives with extended thinking
 */
async function callClaudeJudge(prompt) {
  const config = COUNCIL_CONFIG.judge;

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('No CLAUDE_API_KEY');

  // Build request body
  const requestBody = {
    model: config.model,
    max_tokens: config.max_tokens,
    messages: [{ role: 'user', content: prompt }]
  };

  // Enable extended thinking if configured
  if (config.thinking) {
    requestBody.thinking = config.thinking;
    // Extended thinking requires no temperature param
  } else {
    requestBody.temperature = 0.1;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();

  // Extended thinking returns thinking blocks + text blocks
  // Find the text content (not the thinking summary)
  let content = '';
  for (const block of data.content || []) {
    if (block.type === 'text') {
      content = block.text;
      break;
    }
  }
  if (!content) content = data.content?.[0]?.text || '';

  const usage = data.usage || {};

  // Strip markdown code blocks if present
  content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in Claude response: ${content.substring(0, 100)}`);

  // Haiku 4.5 pricing: $0.80/1M input, $4/1M output, $5/1M thinking
  return {
    result: JSON.parse(jsonMatch[0]),
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cost: ((usage.input_tokens || 0) * 0.0000008) + ((usage.output_tokens || 0) * 0.000004)
    }
  };
}

/**
 * Fallback: Call DeepSeek R1 as interim judge
 */
async function callDeepSeekR1Judge(prompt) {
  // Use DeepSeek R1 when Claude unavailable
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('No DEEPSEEK_API_KEY');

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-reasoner',  // R1 model
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 4000
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek R1 error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  let content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  // Strip markdown code blocks if present
  content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in DeepSeek R1 response: ${content.substring(0, 100)}`);

  return {
    result: JSON.parse(jsonMatch[0]),
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      cost: ((usage.prompt_tokens || 0) * 0.00000055) + ((usage.completion_tokens || 0) * 0.00000219)
    }
  };
}

/**
 * Generic DeepSeek caller for experiments
 */
async function callDeepSeek(systemPrompt, userPrompt, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('No DEEPSEEK_API_KEY');

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: options.temperature ?? 0,
      seed: options.seed ?? 42,
      max_tokens: 2000
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

  if (options.returnUsage) {
    const cost = estimateDeepSeekChatCost(usage);
    return { content, usage, cost };
  }

  return content;
}

function estimateDeepSeekChatCost(usage) {
  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;
  const inputPer1M = parseFloat(process.env.DEEPSEEK_CHAT_INPUT_COST_PER_1M || '0.28');
  const outputPer1M = parseFloat(process.env.DEEPSEEK_CHAT_OUTPUT_COST_PER_1M || '0.42');

  const inputCost = (inputTokens * inputPer1M) / 1_000_000;
  const outputCost = (outputTokens * outputPer1M) / 1_000_000;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    input_cost_usd: inputCost,
    output_cost_usd: outputCost,
    total_cost_usd: inputCost + outputCost,
    pricing: {
      input_per_1m: inputPer1M,
      output_per_1m: outputPer1M,
      cache: 'miss'
    }
  };
}

/**
 * Generic Claude caller for experiments
 */
async function callClaude(systemPrompt, userPrompt, options = {}) {
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No CLAUDE_API_KEY or ANTHROPIC_API_KEY');

  const model = options.model || 'claude-opus-4-6';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: options.max_tokens || 2000,
      temperature: options.temperature ?? 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  let content = data.content?.[0]?.text || '';
  const usage = data.usage || {};

  // Strip markdown code blocks if present
  content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  if (options.returnUsage) {
    const cost = estimateClaudeCost(usage, model);
    return { content, usage, cost };
  }

  return content;
}

function estimateClaudeCost(usage, model) {
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;

  const pricing = {
    'claude-opus-4-6': { input: 15, output: 75 },
    'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
    'claude-haiku-4-5-20251001': { input: 0.80, output: 4 },
  };
  const p = pricing[model] || pricing['claude-opus-4-6'];

  const inputCost = (inputTokens * p.input) / 1_000_000;
  const outputCost = (outputTokens * p.output) / 1_000_000;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    input_cost_usd: inputCost,
    output_cost_usd: outputCost,
    total_cost_usd: inputCost + outputCost,
    model
  };
}

/**
 * Generic Gemini caller for experiments
 */
async function callGemini(systemPrompt, userPrompt, options = {}) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('No GOOGLE_API_KEY');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
      }],
      generationConfig: {
        temperature: options.temperature ?? 0,
        maxOutputTokens: 2000
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  let content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Strip markdown code blocks if present
  content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  return content;
}

module.exports = {
  callAzureGPT,
  callGeminiFairArbiter,
  callDeepSeekScorer,
  callClaudeJudge,
  callDeepSeekR1Judge,
  // Generic callers for experiments
  callDeepSeek,
  callClaude,
  callGemini,
  estimateClaudeCost
};
