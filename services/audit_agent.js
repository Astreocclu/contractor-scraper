/**
 * Audit Agent - Pure Analysis Engine (V3)
 *
 * Receives ALL collected data upfront in the prompt.
 * NO tools - pure analysis, no web access.
 * Returns structured JSON with verdict/confidence (score is internal only).
 * Uses deepseek-chat with seed:42 for deterministic scoring.
 */

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

const {
  callAzureGPT,
  callGeminiFairArbiter,
  callDeepSeekScorer,
  callClaudeJudge,
  callDeepSeekR1Judge
} = require('./council_callers');
const { COUNCIL_CONFIG } = require('./deep_investigation/constants');

const SYSTEM_PROMPT = `You are a forensic investigator with deep reasoning capabilities. Your job: protect homeowners from fraud.

INVESTIGATE this contractor. Look at ALL the data collected.

Ask yourself:
1. What do they CLAIM? (years in business, reviews, quality, licensing)
2. What does the EVIDENCE show? (BBB records, court cases, news, actual reviews)
3. Do claims match evidence?
4. What's the STORY here?

## CHECK FOR
- Lawsuits, judgments, liens (check all court data AND county_liens data)
- News investigations (local news, CBS, ABC investigations are CRITICAL)
- BBB complaints and rating (pattern of complaints = problem)
- Victim reports (Reddit, Nextdoor, consumer forums)
- Business registration issues (franchise tax problems, SOS status)

## LIEN ANALYSIS (CRITICAL - READ CAREFULLY)
County lien records show financial disputes. You MUST check WHO FILED the lien:

### HOW TO READ LIEN DATA:
- GRANTEE = The CREDITOR (who is owed money, filed the lien)
- GRANTOR = The PROPERTY OWNER (whose property the lien is against)

### LIEN DIRECTION MATTERS:
**If GRANTEE = contractor name**: The contractor filed the lien to get paid
  - This is NEUTRAL - contractor is protecting themselves from non-paying customers
  - 1-4 liens filed BY contractor = normal business practice, NOT a red flag

**If GRANTOR = contractor name**: Someone filed a lien AGAINST the contractor
  - This is a RED FLAG - contractor owes money to subcontractors/suppliers
  - 1-2 liens against contractor = FINANCIAL STRESS
  - 3+ liens against contractor = PATTERN OF NON-PAYMENT

### NOT RED FLAGS:
- Liens filed BY the contractor = normal collections activity
- Resolved liens with releases = disputes handled properly

## SEVERITY CLASSIFICATION RULES

Use these rules to assign severity levels. The key distinction is CONFIRMED vs UNVERIFIED.

**CRITICAL - Confirmed fraud or deception:**
- Fake reviews (>30% fake score from Review Analyzer)
- Scam allegations from multiple independent sources
- Impersonating another business
- Confirmed consumer protection violations
- Contractor makes a verifiable claim (licensed, insured) that is confirmed FALSE

**HIGH - Confirmed operational problems:**
- Active lawsuit AGAINST the contractor
- Judgment or lien AGAINST the contractor (not liens filed BY them)
- BBB F rating or revoked accreditation
- Official government or licensing board disciplinary action
- License confirmed EXPIRED, SUSPENDED, or REVOKED (not just "not found")
- Clear pattern of multiple verified customer complaints (3+ similar issues)
- News investigation confirming wrongdoing

**MEDIUM - Unverified or uncertain issues:**
- Cannot find business registration (may be database issue or different name)
- License not found in state database (may be under DBA or different entity)
- Mixed reviews or significant rating discrepancies between platforms
- Single unverified complaint without corroboration
- Data collection errors (scraper failed, website down)
- Glassdoor/employee complaints (internal issues, not customer-facing)

**LOW - Minor gaps with no negative implication:**
- No BBB profile (common for small businesses, not required)
- Low review volume (new or niche business)
- Missing social media presence
- Old, resolved issues (5+ years ago, case dismissed, lien released)
- Minor data gaps where other sources provide verification

## SCORING GUIDANCE

Your score should reflect CONFIRMED evidence, not speculation about unknowns.

CORE PRINCIPLES:
1. UNKNOWN ≠ BAD: Missing data indicates uncertainty, NOT evidence of wrongdoing
2. WEIGHT CONFIRMED OVER UNCONFIRMED: 500 authentic reviews outweighs "cannot find registration"
3. RECENCY MATTERS: Issues from 5+ years ago matter less than recent issues
4. PATTERNS > ISOLATED: One complaint is noise; five similar complaints is a pattern
5. CONTEXT MATTERS: A sole proprietor may not have LLC registration - that's legal

SCORE ANCHORS:
- 90-100: Exceptional. Zero HIGH/CRITICAL flags. Verified excellence across all dimensions.
- 80-89: Recommended. Minor gaps only (MEDIUM/LOW flags). Strong positive signals dominate.
- 65-79: Mixed. Has at least one HIGH flag OR multiple MEDIUM flags. Positives exist but concerns remain.
- 50-64: Concerning. Multiple HIGH flags OR unresolved serious operational issues.
- Below 50: Avoid. CRITICAL flags present OR clear pattern of confirmed problems.

CRITICAL RULE:
A contractor with a MEDIUM-severity "cannot verify registration" flag BUT 500+ authentic 5-star reviews and no other issues should score 80-85, NOT 65. The verified positive evidence outweighs the unverified data gap.

## REVIEWS - CRITICAL GUIDANCE
The Review Analyzer has evaluated reviews for authenticity AND complaint patterns.

1. CHECK THE VERDICT:
- If Review Analysis says "TRUST_REVIEWS" -> reviews appear authentic
- If Review Analysis says "DISTRUST_REVIEWS" -> flag as concern
- If Review Analysis says "VERIFY_REVIEWS" -> note as data gap

2. CHECK complaint_patterns ARRAY - THIS IS CRITICAL:
- The complaint_patterns field lists specific issues found in real reviews
- These are RED FLAGS even if the verdict is "TRUST_REVIEWS"
- Patterns like "unresponsive after deposit", "billing disputes", "damage to property" indicate real problems
- Weight these patterns heavily - they come from actual customer experiences

3. High review volume is positive, BUT complaint_patterns override volume.
A contractor with 500 reviews but patterns showing "took deposit and disappeared" or "threatened legal action" should score LOWER, not higher.

## OUTPUT FORMAT
After your investigation, respond with ONLY this JSON:
{
  "trust_score": <0-100>,
  "reasoning": "<Your investigative findings. What's the story? What did you find? Be specific.>",
  "red_flags": [
    {"severity": "<CRITICAL|HIGH|MEDIUM|LOW>", "category": "<category>", "description": "<what you found>", "evidence": "<which source showed this>"}
  ],
  "verified_items": ["<verified positive finding with specifics>"],
  "unverified_items": ["<what couldn't you verify and why>"]
}

What's your assessment?`;

const ADVOCATE_PROMPT = `You are the Consumer Advocate - a skeptical investigator who protects homeowners.

YOUR JOB: Find reasons NOT to trust this contractor.

YOUR MINDSET:
- Bad actors game reviews. Look for patterns that indicate manipulation.
- BBB F ratings are damning - businesses can respond to complaints but chose not to.
- When you see a pattern of complaints, assume the pattern is real.
- Focus on verifiable data: BBB complaints, court records, liens, review authenticity patterns.
- Note: Texas does not require contractor licenses for most trades. Insurance records are rarely available. Only flag licensing/insurance if the contractor CLAIMS credentials that evidence contradicts.
- Your job is to surface every legitimate concern a homeowner should know about.

ANALYZE THE DATA:
1. What claims does this contractor make? (years in business, licensing, quality)
2. What does the evidence actually show?
3. Where are the gaps, inconsistencies, or warning signs?
4. What's the worst reasonable interpretation of this evidence?

YOUR OUTPUT must be JSON:
{
  "trust_score": <0-100, reflecting your skeptical assessment>,
  "assessment_confidence": <0-100, how certain you are about your score>,
  "data_confidence": <0-100, how reliable is the underlying evidence>,
  "reasoning": "<Your detailed analysis. Be specific. Cite evidence. Another analyst should be able to challenge your reasoning.>",
  "key_concerns": ["<Specific concern 1>", "<Specific concern 2>"],
  "acknowledged_positives": ["<Strongest positive signal you see, and why it doesn't override concerns>"],
  "data_gaps": ["<What couldn't you verify>"]
}`;

const ARBITER_PROMPT = `You are the Fair Arbiter - a balanced investigator who gives benefit of the doubt.

YOUR JOB: Find reasons this contractor might be trustworthy despite red flags.

YOUR MINDSET:
- Unhappy customers review more than happy ones. Consider selection bias.
- Every business gets some bad reviews. Look for resolution patterns.
- BBB ratings reflect complaint handling, not necessarily quality. Ask what complaints were about.
- Missing data might be a database issue, not deception. A sole proprietor may not have LLC registration - that's legal.
- Context matters. A 2-year-old business can't have 10 years of reviews.
- Your job is to find the reasonable interpretation that favors the contractor.

ANALYZE THE DATA:
1. What positive signals exist? (review volume, resolution of issues, longevity)
2. For each red flag, what's the charitable interpretation?
3. What context might explain apparent problems?
4. What's the best reasonable interpretation of this evidence?

YOUR OUTPUT must be JSON:
{
  "trust_score": <0-100, reflecting your charitable assessment>,
  "assessment_confidence": <0-100, how certain you are about your score>,
  "data_confidence": <0-100, how reliable is the underlying evidence>,
  "reasoning": "<Your detailed analysis. Be specific. Cite evidence. Another analyst should be able to challenge your reasoning.>",
  "key_positives": ["<Specific positive 1>", "<Specific positive 2>"],
  "acknowledged_concerns": ["<Legitimate concern you see, and why it might not be disqualifying>"],
  "data_gaps": ["<What couldn't you verify>"]
}`;

const SYNTHESIZER_PROMPT = `You are the Synthesizer - a senior analyst who produces the final assessment.

You have read two perspectives:
- The Consumer Advocate (skeptical, protective of homeowners)
- The Fair Arbiter (charitable, gives benefit of the doubt)

YOUR JOB: Weigh both perspectives against the raw data and produce the final verdict.

YOUR PROCESS:
1. AGREEMENTS: Where do both analysts agree? These are high-confidence findings.
2. DISAGREEMENTS: Where do they differ? Identify the specific evidence they weighted differently.
3. YOUR JUDGMENT: Who made the stronger case and why? What did one analyst see that the other missed or dismissed?
4. FINAL SCORE: Your score emerges from your reasoning. Don't average the two scores - make your own judgment.

CRITICAL RULES:
- If both analysts agree, your confidence should be HIGH.
- If they significantly disagree, you MUST explain which specific evidence each weighted differently.
- Your reasoning must be detailed enough that a third analyst could challenge it.

DOUBLE-CHECK YOUR JUDGMENT:
Before finalizing, ask yourself: "Will this score enable a homeowner to make an intelligent decision?"

YOUR OUTPUT must be JSON:
{
  "final_trust_score": <0-100>,
  "final_assessment_confidence": <0-100>,
  "final_data_confidence": <0-100>,
  "agreements": ["<Point both analysts agreed on>"],
  "disagreements": [
    {
      "point": "<The disputed issue>",
      "advocate_view": "<What the Advocate said>",
      "arbiter_view": "<What the Arbiter said>",
      "your_judgment": "<Who was right and why>"
    }
  ],
  "stronger_case": "<advocate|arbiter|balanced>",
  "stronger_case_reasoning": "<Why one perspective was more compelling, or why they balanced out>",
  "summary": "<Final assessment in 2-3 sentences>",
  "red_flags": [
    {"severity": "<HIGH|MEDIUM|LOW>", "description": "<what you found>", "source": "<evidence source>"}
  ],
  "verified_positives": ["<Verified positive finding>"],
  "unverified_items": ["<What remains uncertain>"]
}`;

// ============ COUNCIL PROMPTS ============

const CONSUMER_ADVOCATE_PROMPT = `You are evaluating a contractor for TrustHome. Your role is Consumer Advocate: be skeptical and find reasons NOT to trust this contractor. Your assessment impacts homeowner safety.

TEXAS LICENSING NOTE: Texas does NOT require contractor licenses for most trades including pools, patios, fencing, roofing, and general remodeling. Only electricians, plumbers, and HVAC require state licenses. Do NOT penalize contractors for missing licenses in unlicensed trades.

SCORE CALIBRATION:
- 0-30: CONFIRMED FRAUD (fake reviews, active lawsuits against them, criminal charges, identity theft)
- 31-50: SERIOUS RED FLAGS (complaints with damages, license violations, BBB F rating)
- 51-70: CONCERNS (limited track record, minor complaints, inconsistencies)
- 71-85: ACCEPTABLE (minor gaps but no real concerns)
- 86-100: EXCELLENT (verified, established, clean record)

Missing data is NOT the same as negative data. Court searches may return unrelated results - only count results that EXACTLY match the contractor name.

CONTRACTOR DATA:
{{enriched_data}}

FLAGS FROM DEEP INVESTIGATION:
{{flags}}

Find holes in their story. Question their claims. Look for what's missing or inconsistent.

Respond with json only:
{
  "score": <0-100>,
  "confidence": <0.0-1.0>,
  "concerns": ["<specific concerns>"],
  "reasoning": "<2-3 sentences from skeptical perspective>"
}`;

const FAIR_ARBITER_PROMPT = `You are evaluating a contractor for TrustHome. Your role is Fair Arbiter: be charitable and find reasons TO trust this contractor. Your assessment impacts contractor livelihood.

TEXAS LICENSING NOTE: Texas does NOT require contractor licenses for most trades including pools, patios, fencing, roofing, and general remodeling. Only electricians, plumbers, and HVAC require state licenses. Do NOT penalize contractors for missing licenses in unlicensed trades.

CONTRACTOR DATA:
{{enriched_data}}

FLAGS FROM DEEP INVESTIGATION:
{{flags}}

Consider context. Give benefit of doubt where reasonable. Acknowledge what they've done right.

Respond with json only:
{
  "score": <0-100>,
  "confidence": <0.0-1.0>,
  "positives": ["<evidence of trustworthiness>"],
  "reasoning": "<2-3 sentences from charitable perspective>"
}`;

const INDEPENDENT_SCORER_PROMPT = `Evaluate this contractor for TrustHome Trust Score. Apply the scoring methodology objectively.

TEXAS LICENSING NOTE: Texas does NOT require contractor licenses for most trades including pools, patios, fencing, roofing, and general remodeling. Only electricians, plumbers, and HVAC require state licenses. Do NOT penalize contractors for missing licenses in unlicensed trades.

SCORE CALIBRATION:
- 0-30: CONFIRMED FRAUD (fake reviews, active lawsuits, criminal charges)
- 31-50: SERIOUS RED FLAGS (real complaints, BBB F rating, license violations for licensed trades)
- 51-70: CONCERNS (limited track record, minor complaints)
- 71-85: ACCEPTABLE (mostly clean, minor gaps)
- 86-100: EXCELLENT (verified, established, clean)

IMPORTANT: Missing data is uncertainty, NOT negative evidence. A score of 0 means CONFIRMED FRAUD with proof. Most small legitimate businesses score 50-75.

CONTRACTOR DATA:
{{enriched_data}}

FLAGS FROM DEEP INVESTIGATION:
{{flags}}

Consider the full picture: reputation, online presence, red flags, and verification. Use your judgment.

Respond with json only:
{
  "score": <0-100>,
  "confidence": <0.0-1.0>,
  "key_factors": ["<what drove your score>"],
  "reasoning": "<brief holistic assessment>"
}`;

const JUDGE_PROMPT = `You are the final judge for contractor Trust Scores. Three models evaluated this contractor from different perspectives:

- Consumer Advocate (skeptical): {{gpt_response}}
- Fair Arbiter (charitable): {{gemini_response}}
- Independent Scorer (objective): {{deepseek_response}}

Deep Investigation also found these flags: {{flags}}

Synthesize their perspectives. Where they agree, that's strong signal. Where they diverge, read their reasoning and decide what's true.

Respond with json only:
{
  "final_score": <0-100>,
  "confidence": "HIGH/MEDIUM/LOW",
  "council_agreed_on": "<what all three saw>",
  "council_diverged_on": "<disagreements and how you resolved>",
  "reasoning": "<your synthesis>",
  "human_review_needed": <true/false>,
  "review_reason": "<if true, why>"
}`;

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

/**
 * Map numeric score to verdict
 */
function getVerdict(score) {
  if (score >= 80) return 'RECOMMENDED';
  if (score >= 65) return 'USE CAUTION';
  if (score >= 50) return 'NOT RECOMMENDED';
  return 'AVOID';
}

/**
 * Calculate confidence based on data completeness
 */
function getConfidence(result) {
  const unverifiedCount = (result.unverified_items || []).length;
  const verifiedCount = (result.verified_items || []).length;
  const total = unverifiedCount + verifiedCount;

  if (total === 0) return 'MEDIUM';

  const ratio = verifiedCount / total;
  if (ratio >= 0.9) return 'HIGH';
  if (ratio >= 0.7) return 'MEDIUM';
  return 'LOW';
}

/**
 * Format result for display
 */
function formatDisplayOutput(result) {
  const verdict = getVerdict(result.trust_score);
  const confidence = getConfidence(result);

  let output = `
════════════════════════════════════════════════════════════
  AUDIT RESULTS
════════════════════════════════════════════════════════════

  VERDICT:    ${verdict}
  CONFIDENCE: ${confidence}

--- WHAT WE VERIFIED ---`;

  if (result.verified_items && result.verified_items.length > 0) {
    for (const item of result.verified_items) {
      output += `\n  ✓ ${item}`;
    }
  } else {
    output += '\n  (No items verified)';
  }

  output += '\n\n--- WHAT WE COULDN\'T VERIFY ---';
  if (result.unverified_items && result.unverified_items.length > 0) {
    for (const item of result.unverified_items) {
      output += `\n  - ${item}`;
    }
  } else {
    output += '\n  (All items verified)';
  }

  output += '\n\n--- RED FLAGS ---';
  if (result.red_flags && result.red_flags.length > 0) {
    for (const flag of result.red_flags) {
      const color = flag.severity === 'CRITICAL' || flag.severity === 'HIGH' ? '\x1b[31m' : '\x1b[33m';
      output += `\n${color}  [${flag.severity}] ${flag.category}: ${flag.description}\x1b[0m`;
      if (flag.evidence) {
        output += `\n    Evidence: ${flag.evidence}`;
      }
    }
  } else {
    output += '\n  None found';
  }

  output += '\n\n--- REASONING ---';
  output += `\n${result.reasoning || 'No reasoning provided'}`;

  output += `\n
--- METADATA ---
  Internal Score: ${result.trust_score}/100
  API cost: $${result.total_cost?.toFixed(4) || '0.0000'}`;

  return output;
}

class AuditAgent {
  constructor(db, contractorId, contractor) {
    this.db = db;
    this.contractorId = contractorId;
    this.contractor = contractor;
    this.totalCost = 0;
  }

  /**
   * Build the data prompt with all collected data
   */
  async buildDataPrompt() {
    const rows = await this.db.exec(`
      SELECT source_name, raw_text, structured_data, fetch_status
      FROM contractor_raw_data
      WHERE contractor_id = ?
      ORDER BY source_name
    `, [this.contractorId]);

    if (rows.length === 0) {
      return 'NO DATA COLLECTED - cannot audit without data.';
    }

    let prompt = `## CONTRACTOR INFO
Name: ${this.contractor.name}
Location: ${this.contractor.city}, ${this.contractor.state}
Website: ${this.contractor.website || 'Not provided'}

## COLLECTED DATA\n`;

    let totalChars = 0;
    const MAX_CHARS = 60000;

    for (const row of rows) {
      const { source_name, raw_text, structured_data, fetch_status } = row;

      if (fetch_status !== 'success' && fetch_status !== 'not_found') continue;

      let content = '';
      if (structured_data) {
        let data = structured_data;
        if (typeof structured_data === 'string') {
          try {
            data = JSON.parse(structured_data);
          } catch {
            data = structured_data;
          }
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
            if (full.length > 5000) {
              content = full.substring(0, 5000) + '\n...[truncated]';
            } else {
              content = full;
            }
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
   * Run the audit
   */
  async run() {
    log('\n🤖 Audit Agent analyzing data...');

    const dataPrompt = await this.buildDataPrompt();

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: dataPrompt }
    ];

    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      iterations++;

      const response = await this.callDeepSeek(messages);
      this.totalCost += this.estimateCost(response);

      const message = response.choices?.[0]?.message;
      if (!message) {
        throw new Error('No response from DeepSeek');
      }

      const content = message.content || '';

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const result = JSON.parse(jsonMatch[0]);
          return await this.finalizeResult(result);
        } catch (e) {
          warn(`Failed to parse JSON: ${e.message}`);
          messages.push(message);
          messages.push({
            role: 'user',
            content: 'Please respond with valid JSON only, no other text.'
          });
        }
      } else {
        messages.push(message);
        messages.push({
          role: 'user',
          content: 'Please provide your final assessment as JSON.'
        });
      }
    }

    return await this.fallbackResult('Max iterations reached without valid response');
  }

  /**
   * Finalize and save result
   */
  async finalizeResult(result) {
    const now = new Date().toISOString();

    // Validate score
    if (typeof result.trust_score !== 'number') {
      result.trust_score = 50;
    }
    result.trust_score = Math.max(0, Math.min(100, result.trust_score));

    // Derive verdict and confidence
    const verdict = getVerdict(result.trust_score);
    const confidence = getConfidence(result);

    // Add legal disclaimers for trust score
    const disclaimer = "AI-generated trust assessment based on publicly available data. " +
      "This score is an estimate and should not be the sole factor in hiring decisions. " +
      "We recommend verifying credentials directly with the contractor.";
    const disclaimer_short = "AI-generated estimate based on public data";

    // Map to recommendation for DB compatibility
    let recommendation;
    if (result.trust_score >= 80) recommendation = 'RECOMMENDED';
    else if (result.trust_score >= 50) recommendation = 'NOT_RECOMMENDED';
    else recommendation = 'AVOID';

    // Map to risk level for DB compatibility
    let riskLevel;
    if (result.trust_score >= 80) riskLevel = 'TRUSTED';
    else if (result.trust_score >= 50) riskLevel = 'MODERATE';
    else riskLevel = 'HIGH';

    // Save to audit_records
    await this.db.run(`
      INSERT INTO audit_records (
        contractor_id, audit_version, trust_score, risk_level, recommendation,
        reasoning_trace, red_flags, positive_signals, gaps_identified,
        sources_used, collection_rounds, total_cost, created_at, finalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      this.contractorId,
      3,  // audit_version V3 with new output format
      result.trust_score,
      riskLevel,
      recommendation,
      result.reasoning || '',
      JSON.stringify(result.red_flags || []),
      JSON.stringify(result.verified_items || []),
      JSON.stringify(result.unverified_items || []),
      JSON.stringify([]),
      0,
      this.totalCost,
      now,
      now
    ]);

    // Update contractor
    const passesThreshold = result.trust_score >= 80;
    await this.db.run(`
      UPDATE contractors_contractor SET trust_score = ?, passes_threshold = ? WHERE id = ?
    `, [result.trust_score, passesThreshold, this.contractorId]);

    // Add derived fields to result
    result.verdict = verdict;
    result.confidence = confidence;
    result.total_cost = this.totalCost;
    result.disclaimer = disclaimer;
    result.disclaimer_short = disclaimer_short;

    // Display formatted output
    console.log(formatDisplayOutput(result));
    success('\n✅ Audit saved to database');

    return result;
  }

  async fallbackResult(reason) {
    return await this.finalizeResult({
      trust_score: 50,
      reasoning: `Audit incomplete: ${reason}. Manual review recommended.`,
      red_flags: [],
      verified_items: [],
      unverified_items: ['Automated audit incomplete']
    });
  }

  async callDeepSeek(messages) {
    const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0,
        max_tokens: 4000
        // seed: 42  // Removed to test variance
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek error: ${response.status}`);
    }

    return response.json();
  }

  estimateCost(response) {
    const usage = response.usage || {};
    return ((usage.prompt_tokens || 0) * 0.00000014) + ((usage.completion_tokens || 0) * 0.00000028);
  }
}

/**
 * Dialectic Audit Agent - Three-persona analysis (V4)
 *
 * Uses three personas for balanced assessment:
 * 1. Consumer Advocate - skeptical, finds reasons NOT to trust
 * 2. Fair Arbiter - charitable, finds reasons TO trust
 * 3. Synthesizer - weighs both, produces final verdict
 */
class DialecticAuditAgent {
  constructor(db, contractorId, contractor) {
    this.db = db;
    this.contractorId = contractorId;
    this.contractor = contractor;
    this.totalCost = 0;
  }

  /**
   * Build the data prompt with all collected data
   * (Same logic as AuditAgent.buildDataPrompt)
   */
  async buildDataPrompt() {
    const rows = await this.db.exec(`
      SELECT source_name, raw_text, structured_data, fetch_status
      FROM contractor_raw_data
      WHERE contractor_id = ?
      ORDER BY source_name
    `, [this.contractorId]);

    if (rows.length === 0) {
      return 'NO DATA COLLECTED - cannot audit without data.';
    }

    let prompt = `## CONTRACTOR INFO
Name: ${this.contractor.name}
Location: ${this.contractor.city}, ${this.contractor.state}
Website: ${this.contractor.website || 'Not provided'}

## COLLECTED DATA\n`;

    let totalChars = 0;
    const MAX_CHARS = 60000;

    for (const row of rows) {
      const { source_name, raw_text, structured_data, fetch_status } = row;

      if (fetch_status !== 'success' && fetch_status !== 'not_found') continue;

      let content = '';
      if (structured_data) {
        let data = structured_data;
        if (typeof structured_data === 'string') {
          try {
            data = JSON.parse(structured_data);
          } catch {
            data = structured_data;
          }
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
            if (full.length > 5000) {
              content = full.substring(0, 5000) + '\n...[truncated]';
            } else {
              content = full;
            }
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
   * Run a single persona analysis
   */
  async runPersona(personaName, systemPrompt, dataPrompt) {
    log(`\nRunning ${personaName}...`);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: dataPrompt }
    ];

    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;

      const response = await this.callDeepSeek(messages);
      this.totalCost += this.estimateCost(response);

      const message = response.choices?.[0]?.message;
      if (!message) {
        throw new Error(`No response from DeepSeek for ${personaName}`);
      }

      const content = message.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try {
          const result = JSON.parse(jsonMatch[0]);
          success(`  ${personaName} complete (score: ${result.trust_score || result.final_trust_score})`);
          return result;
        } catch (e) {
          warn(`  ${personaName} JSON parse error: ${e.message}`);
          if (attempts < maxAttempts) {
            if (message) {
              messages.push(message);
            }
            messages.push({
              role: 'user',
              content: 'Please respond with valid JSON only, no other text.'
            });
          }
        }
      } else {
        warn(`  ${personaName} no JSON found in response`);
        if (attempts < maxAttempts) {
          if (message) {
            messages.push(message);
          }
          messages.push({
            role: 'user',
            content: 'Please provide your assessment as JSON.'
          });
        }
      }
    }

    // Return a fallback result if all attempts fail
    warn(`  ${personaName} failed after ${maxAttempts} attempts`);
    return {
      trust_score: 50,
      assessment_confidence: 0,
      data_confidence: 50,
      reasoning: `${personaName} analysis incomplete`,
      key_concerns: [],
      key_positives: [],
      acknowledged_positives: [],
      acknowledged_concerns: [],
      data_gaps: ['Analysis failed']
    };
  }

  /**
   * Run the Synthesizer with both persona outputs
   */
  async runSynthesizer(dataPrompt, advocateResult, arbiterResult) {
    log('\nRunning Synthesizer...');

    const combinedPrompt = `${dataPrompt}

## CONSUMER ADVOCATE ANALYSIS
${JSON.stringify(advocateResult, null, 2)}

## FAIR ARBITER ANALYSIS
${JSON.stringify(arbiterResult, null, 2)}

Now synthesize these two perspectives and produce your final assessment.`;

    const messages = [
      { role: 'system', content: SYNTHESIZER_PROMPT },
      { role: 'user', content: combinedPrompt }
    ];

    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;

      const response = await this.callDeepSeek(messages);
      this.totalCost += this.estimateCost(response);

      const message = response.choices?.[0]?.message;
      if (!message) {
        throw new Error('No response from DeepSeek for Synthesizer');
      }

      const content = message.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        try {
          const result = JSON.parse(jsonMatch[0]);
          success(`  Synthesizer complete (final score: ${result.final_trust_score})`);
          return result;
        } catch (e) {
          warn(`  Synthesizer JSON parse error: ${e.message}`);
          if (attempts < maxAttempts) {
            if (message) {
              messages.push(message);
            }
            messages.push({
              role: 'user',
              content: 'Please respond with valid JSON only, no other text.'
            });
          }
        }
      } else {
        warn('  Synthesizer no JSON found in response');
        if (attempts < maxAttempts) {
          if (message) {
            messages.push(message);
          }
          messages.push({
            role: 'user',
            content: 'Please provide your final assessment as JSON.'
          });
        }
      }
    }

    // Fallback: average the two scores
    warn('  Synthesizer failed, using average of persona scores');
    const avgScore = Math.round((advocateResult.trust_score + arbiterResult.trust_score) / 2);
    return {
      final_trust_score: avgScore,
      final_assessment_confidence: 30,
      final_data_confidence: 50,
      agreements: [],
      disagreements: [],
      stronger_case: 'balanced',
      stronger_case_reasoning: 'Synthesis failed, using average',
      summary: 'Automated synthesis failed. Score is average of advocate and arbiter assessments.',
      red_flags: [],
      verified_positives: [],
      unverified_items: ['Synthesis incomplete']
    };
  }

  /**
   * Run the full dialectic audit
   */
  async run() {
    log('\n=== DIALECTIC AUDIT (V4) ===');
    log(`Contractor: ${this.contractor.name}`);

    // Build data prompt
    const dataPrompt = await this.buildDataPrompt();

    // Run Consumer Advocate (skeptical)
    const advocateResult = await this.runPersona('Consumer Advocate', ADVOCATE_PROMPT, dataPrompt);

    // Run Fair Arbiter (charitable)
    const arbiterResult = await this.runPersona('Fair Arbiter', ARBITER_PROMPT, dataPrompt);

    // Run Synthesizer to produce final verdict
    const synthesisResult = await this.runSynthesizer(dataPrompt, advocateResult, arbiterResult);

    // Finalize and save
    return await this.finalizeResult(synthesisResult, advocateResult, arbiterResult);
  }

  /**
   * Finalize and save result
   */
  async finalizeResult(synthesis, advocate, arbiter) {
    const now = new Date().toISOString();

    // Extract final score with null coalescing
    let finalScore = synthesis?.final_trust_score ?? 50;
    const trustScore = Math.max(0, Math.min(100, finalScore));

    // Derive verdict and confidence
    const verdict = getVerdict(trustScore);
    const assessmentConf = synthesis?.final_assessment_confidence ?? 50;
    const confidence = assessmentConf >= 70 ? 'HIGH' : assessmentConf >= 40 ? 'MEDIUM' : 'LOW';

    // Add legal disclaimers for trust score
    const disclaimer = "AI-generated trust assessment based on publicly available data. " +
      "This score is an estimate and should not be the sole factor in hiring decisions. " +
      "We recommend verifying credentials directly with the contractor.";
    const disclaimer_short = "AI-generated estimate based on public data";

    // Map to recommendation for DB compatibility
    let recommendation;
    if (trustScore >= 80) recommendation = 'RECOMMENDED';
    else if (trustScore >= 50) recommendation = 'NOT_RECOMMENDED';
    else recommendation = 'AVOID';

    // Map to risk level for DB compatibility
    let riskLevel;
    if (trustScore >= 80) riskLevel = 'TRUSTED';
    else if (trustScore >= 50) riskLevel = 'MODERATE';
    else riskLevel = 'HIGH';

    // Build reasoning trace with all three perspectives
    const reasoningTrace = JSON.stringify({
      advocate: {
        score: advocate.trust_score,
        reasoning: advocate.reasoning,
        key_concerns: advocate.key_concerns,
        acknowledged_positives: advocate.acknowledged_positives
      },
      arbiter: {
        score: arbiter.trust_score,
        reasoning: arbiter.reasoning,
        key_positives: arbiter.key_positives,
        acknowledged_concerns: arbiter.acknowledged_concerns
      },
      synthesis: {
        final_score: synthesis.final_trust_score,
        stronger_case: synthesis.stronger_case,
        stronger_case_reasoning: synthesis.stronger_case_reasoning,
        agreements: synthesis.agreements,
        disagreements: synthesis.disagreements,
        summary: synthesis.summary
      }
    }, null, 2);

    // Save to audit_records
    await this.db.run(`
      INSERT INTO audit_records (
        contractor_id, audit_version, trust_score, risk_level, recommendation,
        reasoning_trace, red_flags, positive_signals, gaps_identified,
        sources_used, collection_rounds, total_cost, created_at, finalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      this.contractorId,
      4,  // audit_version V4 dialectic
      trustScore,
      riskLevel,
      recommendation,
      reasoningTrace,
      JSON.stringify(synthesis.red_flags || []),
      JSON.stringify(synthesis.verified_positives || []),
      JSON.stringify(synthesis.unverified_items || []),
      JSON.stringify([]),
      0,
      this.totalCost,
      now,
      now
    ]);

    // Update contractor
    const passesThreshold = trustScore >= 80;
    await this.db.run(`
      UPDATE contractors_contractor SET trust_score = ?, passes_threshold = ? WHERE id = ?
    `, [trustScore, passesThreshold, this.contractorId]);

    // Build final result object
    const result = {
      trust_score: trustScore,
      verdict,
      confidence,
      reasoning: synthesis.summary,
      red_flags: synthesis.red_flags || [],
      verified_items: synthesis.verified_positives || [],
      unverified_items: synthesis.unverified_items || [],
      total_cost: this.totalCost,
      disclaimer,
      disclaimer_short,
      dialectic: {
        advocate_score: advocate.trust_score,
        arbiter_score: arbiter.trust_score,
        score_spread: Math.abs(advocate.trust_score - arbiter.trust_score),
        stronger_case: synthesis.stronger_case,
        agreements: synthesis.agreements,
        disagreements: synthesis.disagreements
      }
    };

    // Display formatted output
    console.log(this.formatOutput(result, advocate, arbiter, synthesis));
    success('\n Audit saved to database (V4 dialectic)');

    return result;
  }

  /**
   * Format output for display
   */
  formatOutput(result, advocate, arbiter, synthesis) {
    const spread = result.dialectic.score_spread;
    const agreementLevel = spread <= 15 ? 'HIGH AGREEMENT' :
                          spread <= 30 ? 'MODERATE DISAGREEMENT' : 'SIGNIFICANT DISAGREEMENT';

    let output = `
================================================================================
  DIALECTIC AUDIT RESULTS (V4)
================================================================================

  FINAL VERDICT:    ${result.verdict}
  CONFIDENCE:       ${result.confidence}
  TRUST SCORE:      ${result.trust_score}/100

--- PERSONA ANALYSIS ---
  Consumer Advocate (skeptical): ${advocate?.trust_score ?? 'N/A'}/100
  Fair Arbiter (charitable):     ${arbiter?.trust_score ?? 'N/A'}/100
  Score Spread:                  ${spread} points (${agreementLevel})
  Stronger Case:                 ${(synthesis?.stronger_case ?? 'unknown').toUpperCase()}

--- SYNTHESIS ---
${synthesis?.summary || 'No summary provided'}

--- AGREEMENTS ---`;

    if (synthesis.agreements && synthesis.agreements.length > 0) {
      for (const agreement of synthesis.agreements) {
        output += `\n  * ${agreement}`;
      }
    } else {
      output += '\n  (No explicit agreements recorded)';
    }

    output += '\n\n--- DISAGREEMENTS ---';
    if (synthesis.disagreements && synthesis.disagreements.length > 0) {
      for (const d of synthesis.disagreements) {
        output += `\n  ISSUE: ${d.point}`;
        output += `\n    Advocate: ${d.advocate_view}`;
        output += `\n    Arbiter:  ${d.arbiter_view}`;
        output += `\n    Judgment: ${d.your_judgment}`;
        output += '\n';
      }
    } else {
      output += '\n  (No explicit disagreements recorded)';
    }

    output += '\n--- RED FLAGS ---';
    if (result.red_flags && result.red_flags.length > 0) {
      for (const flag of result.red_flags) {
        const color = flag.severity === 'HIGH' ? '\x1b[31m' : '\x1b[33m';
        output += `\n${color}  [${flag.severity}] ${flag.description}\x1b[0m`;
        if (flag.source) {
          output += `\n    Source: ${flag.source}`;
        }
      }
    } else {
      output += '\n  None found';
    }

    output += '\n\n--- VERIFIED POSITIVES ---';
    if (result.verified_items && result.verified_items.length > 0) {
      for (const item of result.verified_items) {
        output += `\n  + ${item}`;
      }
    } else {
      output += '\n  (None verified)';
    }

    output += `\n
--- METADATA ---
  Internal Score: ${result.trust_score}/100
  API cost: $${result.total_cost?.toFixed(4) || '0.0000'}
  Audit Version: V4 (Dialectic)`;

    return output;
  }

  async callDeepSeek(messages) {
    const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeepSeek error: ${response.status} - ${text.substring(0, 200)}`);
    }

    try {
      return await response.json();
    } catch (e) {
      throw new Error(`DeepSeek returned invalid JSON: ${e.message}`);
    }
  }

  estimateCost(response) {
    const usage = response.usage || {};
    return ((usage.prompt_tokens || 0) * 0.00000014) + ((usage.completion_tokens || 0) * 0.00000028);
  }
}

/**
 * Council Audit Agent (V5)
 *
 * Runs real multi-LLM council with different personas:
 * - GPT-5-mini: Consumer Advocate (skeptical)
 * - Gemini: Fair Arbiter (charitable)
 * - DeepSeek V3: Independent Scorer (objective)
 * - Claude: Judge (synthesizer)
 */
class CouncilAuditAgent {
  constructor(db, contractorId, contractor) {
    this.db = db;
    this.contractorId = contractorId;
    this.contractor = contractor;
    this.councilResponses = {};
    this.rawData = null;
    this.investigationFlags = [];
    this.totalCost = 0;
  }

  async loadRawData() {
    this.rawData = await this.db.exec(`
      SELECT source_name, raw_text, structured_data, fetch_status
      FROM contractor_raw_data
      WHERE contractor_id = ?
      ORDER BY source_name
    `, [this.contractorId]);

    // Load investigation flags if available
    const flagsRow = this.rawData.find(r => r.source_name === 'deep_investigation_flags');
    if (flagsRow?.structured_data) {
      try {
        this.investigationFlags = typeof flagsRow.structured_data === 'string'
          ? JSON.parse(flagsRow.structured_data)
          : flagsRow.structured_data;
      } catch {
        this.investigationFlags = [];
      }
    }
  }

  buildEnrichedData() {
    let summary = `CONTRACTOR: ${this.contractor.name}\n`;
    summary += `LOCATION: ${this.contractor.city}, ${this.contractor.state || 'TX'}\n\n`;

    const MAX_TOTAL_CHARS = 8000;  // Keep prompt small for council

    for (const row of this.rawData || []) {
      if (summary.length >= MAX_TOTAL_CHARS) break;

      if (row.structured_data && row.fetch_status === 'success') {
        let data;
        try {
          data = typeof row.structured_data === 'string'
            ? JSON.parse(row.structured_data)
            : row.structured_data;
        } catch {
          continue;
        }
        const dataStr = JSON.stringify(data, null, 2);
        const remainingChars = MAX_TOTAL_CHARS - summary.length - 100;
        const truncatedData = dataStr.substring(0, Math.min(500, remainingChars));
        summary += `${row.source_name.toUpperCase()}:\n${truncatedData}\n\n`;
      }
    }

    return summary;
  }

  async runCouncil() {
    const enrichedData = this.buildEnrichedData();
    const flagsJson = JSON.stringify(this.investigationFlags || [], null, 2);

    // Debug: show what data council receives
    if (process.env.DEBUG_COUNCIL) {
      console.log('\n=== ENRICHED DATA ===\n' + enrichedData);
      console.log('\n=== FLAGS ===\n' + flagsJson);
    }

    log('\n  Running Multi-LLM Council...');

    // Build prompts for each council member
    const advocatePrompt = CONSUMER_ADVOCATE_PROMPT
      .replace('{{enriched_data}}', enrichedData)
      .replace('{{flags}}', flagsJson);

    const arbiterPrompt = FAIR_ARBITER_PROMPT
      .replace('{{enriched_data}}', enrichedData)
      .replace('{{flags}}', flagsJson);

    const scorerPrompt = INDEPENDENT_SCORER_PROMPT
      .replace('{{enriched_data}}', enrichedData)
      .replace('{{flags}}', flagsJson);

    // Run all three in parallel
    const startTime = Date.now();
    const [advocateResult, arbiterResult, scorerResult] = await Promise.allSettled([
      callAzureGPT(advocatePrompt),
      callGeminiFairArbiter(arbiterPrompt),
      callDeepSeekScorer(scorerPrompt)
    ]);

    const elapsed = Date.now() - startTime;
    let successCount = 0;
    let totalCost = 0;

    // Process Consumer Advocate (GPT-5-mini)
    if (advocateResult.status === 'fulfilled' && !advocateResult.value.skipped) {
      this.councilResponses.consumer_advocate = advocateResult.value.result;
      totalCost += advocateResult.value.usage.cost;
      successCount++;
      success(`    Consumer Advocate: Score ${advocateResult.value.result.score}, Cost $${advocateResult.value.usage.cost.toFixed(4)}`);
    } else {
      const reason = advocateResult.status === 'rejected' ? advocateResult.reason?.message : 'Skipped';
      warn(`    Consumer Advocate: Failed - ${reason}`);
      this.councilResponses.consumer_advocate = { error: reason };
    }

    // Process Fair Arbiter (Gemini)
    if (arbiterResult.status === 'fulfilled' && !arbiterResult.value.skipped) {
      this.councilResponses.fair_arbiter = arbiterResult.value.result;
      totalCost += arbiterResult.value.usage.cost;
      successCount++;
      success(`    Fair Arbiter: Score ${arbiterResult.value.result.score}, Cost $${arbiterResult.value.usage.cost.toFixed(4)}`);
    } else {
      const reason = arbiterResult.status === 'rejected' ? arbiterResult.reason?.message : 'Skipped';
      warn(`    Fair Arbiter: Failed - ${reason}`);
      this.councilResponses.fair_arbiter = { error: reason };
    }

    // Process Independent Scorer (DeepSeek)
    if (scorerResult.status === 'fulfilled' && !scorerResult.value.skipped) {
      this.councilResponses.independent_scorer = scorerResult.value.result;
      totalCost += scorerResult.value.usage.cost;
      successCount++;
      success(`    Independent Scorer: Score ${scorerResult.value.result.score}, Cost $${scorerResult.value.usage.cost.toFixed(4)}`);
    } else {
      const reason = scorerResult.status === 'rejected' ? scorerResult.reason?.message : 'Skipped';
      warn(`    Independent Scorer: Failed - ${reason}`);
      this.councilResponses.independent_scorer = { error: reason };
    }

    log(`  Council completed in ${elapsed}ms (${successCount}/3 successful)`);
    this.totalCost += totalCost;

    return { successCount, totalCost };
  }

  async runJudge() {
    log('\n  Running Judge...');

    const flagsJson = JSON.stringify(this.investigationFlags || [], null, 2);

    const judgePrompt = JUDGE_PROMPT
      .replace('{{gpt_response}}', JSON.stringify(this.councilResponses.consumer_advocate || {}, null, 2))
      .replace('{{gemini_response}}', JSON.stringify(this.councilResponses.fair_arbiter || {}, null, 2))
      .replace('{{deepseek_response}}', JSON.stringify(this.councilResponses.independent_scorer || {}, null, 2))
      .replace('{{flags}}', flagsJson);

    try {
      // Try Claude first
      const response = await callClaudeJudge(judgePrompt);
      this.totalCost += response.usage.cost;
      success(`    Claude Judge: Final Score ${response.result.final_score}, Cost $${response.usage.cost.toFixed(4)}`);
      return { result: response.result, cost: response.usage.cost, model: 'claude' };
    } catch (claudeError) {
      warn(`    Claude failed: ${claudeError.message}, trying DeepSeek R1...`);
      try {
        // Fallback to DeepSeek R1
        const response = await callDeepSeekR1Judge(judgePrompt);
        this.totalCost += response.usage.cost;
        success(`    DeepSeek R1 Judge: Final Score ${response.result.final_score}, Cost $${response.usage.cost.toFixed(4)}`);
        return { result: response.result, cost: response.usage.cost, model: 'deepseek-r1' };
      } catch (r1Error) {
        error(`    DeepSeek R1 also failed: ${r1Error.message}`);
        throw new Error('All judges failed');
      }
    }
  }

  async run() {
    log('\n🏛️ COUNCIL AUDIT (V5)');
    log(`Contractor: ${this.contractor.name}`);

    // Load data
    await this.loadRawData();

    // Run the council
    const { successCount } = await this.runCouncil();

    // Handle failures per spec
    if (successCount === 0) {
      error('    All council members failed - cannot produce score');
      return {
        mode: 'council',
        error: 'All council members failed',
        final_score: null,
        confidence: 'NONE'
      };
    }

    if (successCount < 2) {
      warn('    Only 1 council member succeeded - falling back to single-model LOW confidence');
      // Use the one that succeeded
      const workingResponse = this.councilResponses.consumer_advocate?.score
        || this.councilResponses.fair_arbiter?.score
        || this.councilResponses.independent_scorer?.score;

      // Add legal disclaimers for trust score
      const disclaimer = "AI-generated trust assessment based on publicly available data. " +
        "This score is an estimate and should not be the sole factor in hiring decisions. " +
        "We recommend verifying credentials directly with the contractor.";
      const disclaimer_short = "AI-generated estimate based on public data";

      const result = {
        mode: 'council',
        final_score: workingResponse || 50,
        confidence: 'LOW',
        warning: 'Only one council member responded',
        council_responses: this.councilResponses,
        total_cost: this.totalCost,
        disclaimer,
        disclaimer_short
      };

      await this.saveAudit(result);
      return result;
    }

    // Run judge with 2+ council responses
    const judgeResult = await this.runJudge();

    // Add legal disclaimers for trust score
    const disclaimer = "AI-generated trust assessment based on publicly available data. " +
      "This score is an estimate and should not be the sole factor in hiring decisions. " +
      "We recommend verifying credentials directly with the contractor.";
    const disclaimer_short = "AI-generated estimate based on public data";

    const result = {
      mode: 'council',
      council_scores: {
        consumer_advocate: this.councilResponses.consumer_advocate?.score,
        fair_arbiter: this.councilResponses.fair_arbiter?.score,
        independent_scorer: this.councilResponses.independent_scorer?.score
      },
      council_responses: this.councilResponses,
      judge_result: judgeResult.result,
      judge_model: judgeResult.model,
      final_score: judgeResult.result.final_score,
      confidence: judgeResult.result.confidence,
      council_agreed_on: judgeResult.result.council_agreed_on,
      council_diverged_on: judgeResult.result.council_diverged_on,
      reasoning: judgeResult.result.reasoning,
      human_review_needed: judgeResult.result.human_review_needed,
      review_reason: judgeResult.result.review_reason,
      total_cost: this.totalCost,
      disclaimer,
      disclaimer_short
    };

    await this.saveAudit(result);
    this.displayResult(result);
    return result;
  }

  displayResult(result) {
    const verdict = getVerdict(result.final_score);

    let output = `
════════════════════════════════════════════════════════════
  COUNCIL AUDIT RESULTS (V5)
════════════════════════════════════════════════════════════

  VERDICT:    ${verdict}
  CONFIDENCE: ${result.confidence}
  TRUST SCORE: ${result.final_score}/100
  JUDGE MODEL: ${result.judge_model}

--- COUNCIL SCORES ---
  Consumer Advocate (GPT-5): ${result.council_scores.consumer_advocate ?? 'FAILED'}
  Fair Arbiter (Gemini):     ${result.council_scores.fair_arbiter ?? 'FAILED'}
  Independent Scorer (DS):   ${result.council_scores.independent_scorer ?? 'FAILED'}

--- COUNCIL AGREED ON ---
${result.council_agreed_on || '(No agreement recorded)'}

--- COUNCIL DIVERGED ON ---
${result.council_diverged_on || '(No divergence recorded)'}

--- SYNTHESIS ---
${result.reasoning || 'No reasoning provided'}`;

    if (result.human_review_needed) {
      output += `\n
\x1b[33m⚠️ HUMAN REVIEW NEEDED: ${result.review_reason}\x1b[0m`;
    }

    output += `\n
--- METADATA ---
  Internal Score: ${result.final_score}/100
  API cost: $${result.total_cost?.toFixed(4) || '0.0000'}
  Audit Version: V5 (Council)`;

    console.log(output);
  }

  async saveAudit(result) {
    const now = new Date().toISOString();

    // Map to verdict/risk for DB compatibility
    const recommendation = result.final_score >= 70 ? 'RECOMMENDED' :
      result.final_score >= 50 ? 'CAUTION' : 'AVOID';
    const riskLevel = result.confidence === 'HIGH' ? 'LOW' :
      result.confidence === 'LOW' ? 'HIGH' : 'MEDIUM';

    await this.db.run(`
      INSERT INTO audit_records (
        contractor_id, audit_version, trust_score, risk_level, recommendation,
        reasoning_trace, red_flags, positive_signals, gaps_identified,
        sources_used, collection_rounds, total_cost, created_at, finalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      this.contractorId,
      5,  // Version 5 = council mode
      result.final_score,
      riskLevel,
      recommendation,
      result.reasoning || JSON.stringify(result),
      JSON.stringify([]),  // red_flags populated from council responses if needed
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify(['council']),
      0,
      result.total_cost,
      now,
      now
    ]);

    // Update contractor's trust_score
    if (result.final_score) {
      const passesThreshold = result.final_score >= 80;
      await this.db.run(`
        UPDATE contractors_contractor
        SET trust_score = ?, passes_threshold = ?
        WHERE id = ?
      `, [result.final_score, passesThreshold, this.contractorId]);
    }

    success('\n✅ Audit saved to database (V5 council)');
  }
}

module.exports = { AuditAgent, DialecticAuditAgent, CouncilAuditAgent, getVerdict, getConfidence, formatDisplayOutput };
