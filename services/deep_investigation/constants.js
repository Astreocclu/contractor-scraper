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
    model: 'gemini-2.5-flash',
    max_tokens: 4000,  // Increased from 2000 - Gemini was truncating JSON
    temperature: 0.1
  }
  // Note: Claude config removed - using Gemini Evaluator as third tier
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
  SEVERITY
};
