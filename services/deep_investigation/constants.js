/**
 * Deep Investigation Framework - Configuration
 *
 * Modes:
 * - "full": Rules → DeepSeek → Gemini → Gemini Evaluator (compares both)
 * - "standard": Rules → DeepSeek → Gemini (skip evaluator)
 * - "minimal": Rules → DeepSeek only (fastest/cheapest)
 */

const INVESTIGATION_MODE = process.env.INVESTIGATION_MODE || 'standard';

const MAX_ITERATIONS = 5;
const MAX_TIME_MS = 180000; // 3 minutes
const MAX_QUERIES_PER_ITERATION = 5;

// Confidence thresholds for LLM cascade escalation
const THRESHOLDS = {
  ESCALATE_TO_GEMINI: 0.6,     // If DeepSeek confidence < 60%, escalate
  ESCALATE_TO_EVALUATOR: 0.4, // If Gemini confidence < 40%, escalate to evaluator
  CRITICAL_FLAG_AUTO_ESCALATE: true  // Always escalate CRITICAL flags to next tier
};

// Known fraud pattern keywords
const VIRTUAL_ADDRESS_KEYWORDS = [
  'ups store', 'postal', 'mailbox', 'mail center', 'pack & ship',
  'post office box', 'po box', 'pmb', 'private mailbox',
  'regus', 'wework', 'virtual office'
];

const TIMELINE_CLAIM_PATTERNS = [
  /since\s+(\d{4})/i,
  /established\s+(\d{4})/i,
  /founded\s+(\d{4})/i,
  /(\d+)\+?\s+years?\s+(in\s+business|of\s+experience|serving)/i,
  /serving\s+.*\s+since\s+(\d{4})/i
];

// Serper API configuration
const SERPER_CONFIG = {
  BASE_URL: 'https://google.serper.dev',
  MAX_RESULTS: 10,
  RATE_LIMIT_MS: 1000  // 1 second between requests
};

// LLM API configurations
const LLM_CONFIG = {
  deepseek: {
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    max_tokens: 2000,
    temperature: 0.1
  },
  gemini: {
    base_url: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-3-pro-preview',  // BANNED: gemini-2.5-flash
    max_tokens: 8192,
    temperature: 0.1
  }
  // Note: Claude config removed - using Gemini Evaluator as third tier
};

// Multi-LLM Council Configuration
// Each model plays a specific persona in the dialectic
const COUNCIL_CONFIG = {
  // Consumer Advocate - skeptical, finds reasons NOT to trust
  // GPT-5-nano with chain-of-thought prompting
  consumer_advocate: {
    enabled: true,
    provider: 'azure',
    model: 'gpt-5-nano',
    deployment: 'gpt-5-nano',
    use_cot: true,  // Chain of thought prompting
    max_tokens: 4000
  },
  // Fair Arbiter - charitable, finds reasons TO trust
  // Gemini 3 Pro with thinking enabled
  fair_arbiter: {
    enabled: true,
    provider: 'gemini',
    model: 'gemini-3-pro-preview',  // BANNED: gemini-2.5-flash
    temperature: 0.7,
    max_tokens: 4000,
    thinking: true
  },
  // Independent Scorer - objective methodology scorer
  // DeepSeek R1 (reasoner) - NO CoT prompting, NO system prompt
  independent_scorer: {
    enabled: true,
    provider: 'deepseek',
    model: 'deepseek-reasoner',  // R1 with built-in reasoning
    max_tokens: 4000
    // Note: R1 ignores temperature, uses internal reasoning
  },
  // Judge - synthesizes all perspectives
  // Claude Haiku 4.5 with extended thinking
  judge: {
    enabled: true,
    provider: 'claude',
    model: 'claude-haiku-4-5-20251001',  // Correct model ID
    max_tokens: 8000,
    thinking: {
      type: 'enabled',
      budget_tokens: 4000
    }
  },
  // Placeholders for future models
  llama: { enabled: false, provider: 'together', model: 'llama-3.1-70b' },
  mistral: { enabled: false, provider: 'mistral', model: 'mistral-large' }
};

// Flag severity levels
const SEVERITY = {
  CRITICAL: 'CRITICAL',  // Confirmed fraud indicators
  SEVERE: 'SEVERE',      // Strong red flags
  MODERATE: 'MODERATE',  // Concerns worth noting
  LOW: 'LOW'            // Minor data gaps
};

module.exports = {
  INVESTIGATION_MODE,
  MAX_ITERATIONS,
  MAX_TIME_MS,
  MAX_QUERIES_PER_ITERATION,
  THRESHOLDS,
  VIRTUAL_ADDRESS_KEYWORDS,
  TIMELINE_CLAIM_PATTERNS,
  SERPER_CONFIG,
  LLM_CONFIG,
  COUNCIL_CONFIG,
  SEVERITY
};
