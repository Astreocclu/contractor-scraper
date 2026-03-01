/**
 * Experiment Prompt Library
 *
 * Three scoring styles used across all variations.
 */

const PROMPT_STYLES = {
  /**
   * RUBRIC: Weighted category scoring (current baseline)
   */
  rubric: {
    name: 'Weighted Rubric',
    system: `You are a forensic contractor auditor. Score this contractor using the following weighted rubric:

SCORING RUBRIC (100 points total):
- License & Registration (20 pts): Valid state license, proper registration, insurance verified
- Online Reputation (25 pts): Google rating, review authenticity, response to complaints
- Legal/Financial (25 pts): No liens, no lawsuits, BBB rating, complaints history
- Business Stability (15 pts): Years in business, consistent address, owner identified
- Red Flags (15 pts deduction): Deduct for fake reviews, fraud signals, hijacked listings

Score each category, sum for final score. Output JSON only.`,
    outputFormat: `{
  "trust_score": <0-100>,
  "risk_level": "<CRITICAL|HIGH|MEDIUM|LOW>",
  "category_scores": {
    "license": <0-20>,
    "reputation": <0-25>,
    "legal": <0-25>,
    "stability": <0-15>,
    "red_flag_deduction": <0-15>
  },
  "reasoning": "<2-3 sentence summary>",
  "red_flags": ["<flag1>", "<flag2>"]
}`
  },

  /**
   * HOLISTIC: No rubric, pure judgment
   */
  holistic: {
    name: 'Holistic Judgment',
    system: `You are a forensic contractor auditor. Review all available data and provide your professional judgment.

Do not use a rubric or weighted categories. Simply assess the totality of evidence and assign a trust score from 0-100 based on your overall confidence that this contractor will deliver quality work and treat customers fairly.

Consider everything: reviews, licenses, legal history, business stability, red flags. Weight them as you see fit based on what matters most for THIS specific contractor.

Output JSON only.`,
    outputFormat: `{
  "trust_score": <0-100>,
  "risk_level": "<CRITICAL|HIGH|MEDIUM|LOW>",
  "reasoning": "<3-5 sentence holistic assessment>",
  "key_factors": ["<most important factor 1>", "<factor 2>", "<factor 3>"],
  "red_flags": ["<flag1>", "<flag2>"]
}`
  },

  /**
   * PHILOSOPHY: Consumer advocate persona
   */
  philosophy: {
    name: 'Consumer Advocate',
    system: `You are a consumer protection advocate helping a family member choose a contractor. This is personal - your elderly mother is about to hire this contractor for a major home project.

Your job is to protect her. Be appropriately skeptical. Look for warning signs that might not be obvious. But also be fair - don't punish honest businesses for minor issues.

Ask yourself: "Would I feel comfortable if my mother hired this contractor?"

- 80-100: "Yes, I'd recommend them confidently"
- 60-79: "Probably okay, but I'd want to verify a few things"
- 40-59: "I have concerns. Maybe look elsewhere"
- 20-39: "No way. Too many red flags"
- 0-19: "Absolutely not. Clear fraud/danger signals"

Output JSON only.`,
    outputFormat: `{
  "trust_score": <0-100>,
  "risk_level": "<CRITICAL|HIGH|MEDIUM|LOW>",
  "recommendation": "<HIRE|MAYBE|AVOID|RUN>",
  "would_recommend_to_family": <true|false>,
  "reasoning": "<2-3 sentences as if explaining to family member>",
  "concerns": ["<concern1>", "<concern2>"],
  "positives": ["<positive1>", "<positive2>"]
}`
  },

  /**
   * PAIRWISE: For head-to-head comparisons
   */
  pairwise: {
    name: 'Pairwise Comparison',
    system: `You are comparing two contractors. Your job is to determine which one is MORE trustworthy.

Do not assign absolute scores. Simply compare the two and decide:
- Which contractor has better credentials?
- Which has fewer red flags?
- Which would you trust more with a major project?

Output JSON only.`,
    outputFormat: `{
  "winner": "<A|B|TIE>",
  "confidence": <0-100>,
  "reasoning": "<2-3 sentences explaining why one is better>",
  "contractor_a_strengths": ["<strength1>"],
  "contractor_b_strengths": ["<strength1>"]
}`
  }
};

/**
 * Build the full prompt for a given style and contractor data
 */
function buildPrompt(style, contractorData) {
  const template = PROMPT_STYLES[style];
  if (!template) {
    throw new Error(`Unknown prompt style: ${style}`);
  }

  return {
    system: template.system,
    user: `CONTRACTOR DATA:
${JSON.stringify(contractorData, null, 2)}

Respond with JSON matching this format:
${template.outputFormat}`
  };
}

/**
 * Build pairwise comparison prompt
 */
function buildPairwisePrompt(contractorA, contractorB) {
  const template = PROMPT_STYLES.pairwise;

  return {
    system: template.system,
    user: `CONTRACTOR A:
${JSON.stringify(contractorA, null, 2)}

CONTRACTOR B:
${JSON.stringify(contractorB, null, 2)}

Which contractor is more trustworthy? Respond with JSON:
${template.outputFormat}`
  };
}

module.exports = {
  PROMPT_STYLES,
  buildPrompt,
  buildPairwisePrompt
};
