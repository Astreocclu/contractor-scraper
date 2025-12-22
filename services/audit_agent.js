/**
 * Audit Agent - Pure Analysis Engine
 *
 * Receives ALL collected data upfront in the prompt.
 * NO tools - pure analysis, no web access.
 * Returns structured JSON directly.
 * Uses deepseek-chat with seed:42 for deterministic scoring.
 */

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';
const scoringConstraints = require('./scoring_constraints');

// No tools - pure analysis engine with no web access
const TOOLS = [];

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
  - Common for busy contractors - some customers don't pay
  - 1-4 liens filed BY contractor = normal business practice, NOT a red flag
  - Only concerning if 10+ liens (may indicate pricing/contract disputes)

**If GRANTOR = contractor name**: Someone filed a lien AGAINST the contractor
  - This is a RED FLAG - contractor owes money to subcontractors/suppliers
  - 1-2 liens against contractor = FINANCIAL STRESS (max score 60)
  - 3+ liens against contractor = PATTERN OF NON-PAYMENT (max score 35)

### DOCUMENT TYPES:
- MECH_LIEN = Mechanic's lien (unpaid work) - CHECK DIRECTION
- REL_LIEN = Lien release (dispute resolved) - GOOD sign
- ABS_JUDG = Abstract of judgment (lost lawsuit) - If against contractor, SEVERE
- FED_TAX_LIEN = Federal tax lien - CRITICAL if against contractor
- STATE_TAX_LIEN = State tax lien - SEVERE if against contractor

### CRITICAL RED FLAGS (only if AGAINST contractor):
- 3+ active liens AGAINST contractor = AVOID (max 35)
- Judgment > $50,000 AGAINST contractor = AVOID (max 15)
- Tax lien > $50,000 AGAINST contractor = AVOID (max 15)

### NOT RED FLAGS:
- Liens filed BY the contractor = normal collections activity
- Resolved liens with releases = disputes handled properly


## REVIEWS - CRITICAL GUIDANCE (READ CAREFULLY)
The Review Analyzer has already evaluated reviews for authenticity. TRUST ITS VERDICT.
- If Review Analysis says "TRUST_REVIEWS" → the reviews are legitimate, DO NOT question them
- If Review Analysis says "DISTRUST_REVIEWS" → flag as concern
- If Review Analysis says "VERIFY_REVIEWS" → note as data gap, not red flag

IMPORTANT: High review volume with high ratings is a POSITIVE signal.
- 5.0 stars with 500+ reviews = excellent contractor who consistently delivers quality work
- This is ACHIEVABLE - many contractors maintain perfect ratings through genuine excellence
- Screen/awning/pool contractors often have passionate customers who leave detailed glowing reviews
- DO NOT flag "statistically rare" or "statistically improbable" as a red flag for review volume
- Only flag reviews if Review Analyzer found ACTUAL manipulation evidence (fake accounts, identical text)

## SCORING - Trust your judgment
Score 0-100 based on what you find:

0-30 (AVOID): Known fraudster, serious red flags, BBB F rating, pattern of complaints, active lawsuits
30-49 (AVOID): Multiple concerns, unverified business, suspicious reviews, significant gaps
50-79 (NOT_RECOMMENDED): Mixed signals, some concerns, insufficient positive data to recommend
80-89 (RECOMMENDED): Good track record, verified business, minor gaps acceptable
90-100 (RECOMMENDED): Excellent reputation, everything verified, years of positive history

## ENTITY NAME MATCHING
Company names vary in records. These are the SAME company:
- "Orange Elephant" = "Orange Elephant Roofing LLC" = "Orange Elephant LLC"
- "Smith Pools" = "Smith Pools Inc" = "Smith's Pool Service"
Look for the business, not exact string matches.

## DATA COMPLETENESS
All relevant data has been pre-collected. Work with what you have.
If critical data is missing, note it in the "gaps" field but DO NOT reduce score for missing data alone.

## OUTPUT FORMAT
After your investigation, respond with ONLY this JSON:
{
  "trust_score": <0-100>,
  "risk_level": "<HIGH|MODERATE|TRUSTED>",
  "recommendation": "<AVOID|NOT_RECOMMENDED|RECOMMENDED>",
  "reasoning": "<Your investigative findings. What's the story? What did you find? Be specific.>",
  "red_flags": [
    {"severity": "<CRITICAL|HIGH|MEDIUM|LOW>", "category": "<category>", "description": "<what you found>", "evidence": "<which source showed this>"}
  ],
  "positive_signals": ["<verified positive finding>"],
  "gaps": ["<what couldn't you verify?>"]
}

What's your assessment?`;

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);

// Enforce score multipliers based on red flag severity
function enforceScoreMultipliers(auditResult) {
  const flags = auditResult.red_flags || [];

  const hasCritical = flags.some(f => f.severity === 'CRITICAL');
  const hasSevere = flags.some(f => f.severity === 'SEVERE' || f.severity === 'HIGH');
  const hasModerate = flags.some(f => f.severity === 'MODERATE' || f.severity === 'MEDIUM');

  let maxScore, minScore;

  if (hasCritical) {
    maxScore = 15;
    minScore = 0;
  } else if (hasSevere) {
    maxScore = 35;
    minScore = 15;
  } else if (hasModerate) {
    maxScore = 60;
    minScore = 40;
  } else {
    maxScore = 100;
    minScore = 60;
  }

  const originalScore = auditResult.trust_score;
  const enforcedScore = Math.min(maxScore, Math.max(minScore, originalScore));

  // Log if we had to override
  if (enforcedScore !== originalScore) {
    console.log(`⚠️ Score override: ${originalScore} → ${enforcedScore} (${hasCritical ? 'CRITICAL' : hasSevere ? 'SEVERE' : 'MODERATE'} flag ceiling)`);
    auditResult.score_override = {
      original: originalScore,
      enforced: enforcedScore,
      reason: `Capped by ${hasCritical ? 'CRITICAL' : hasSevere ? 'SEVERE' : 'MODERATE'} red flag`
    };
  }

  auditResult.trust_score = enforcedScore;

  // Also enforce risk_level consistency
  if (enforcedScore <= 15) auditResult.risk_level = 'CRITICAL';
  else if (enforcedScore <= 35) auditResult.risk_level = 'SEVERE';
  else if (enforcedScore < 80) auditResult.risk_level = 'MODERATE';
  else auditResult.risk_level = 'TRUSTED';

  // Enforce recommendation (simplified tiers)
  // 80+ = RECOMMENDED, 50-79 = NOT_RECOMMENDED, <50 = AVOID
  auditResult.recommendation = enforcedScore < 50 ? 'AVOID' :
    enforcedScore < 80 ? 'NOT_RECOMMENDED' : 'RECOMMENDED';

  return auditResult;
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
    const MAX_CHARS = 60000; // Leave room for system prompt

    for (const row of rows) {
      const { source_name, raw_text, structured_data, fetch_status } = row;

      if (fetch_status !== 'success' && fetch_status !== 'not_found') continue;

      let content = '';
      if (structured_data) {
        // PostgreSQL JSONB returns already-parsed objects, not strings
        let data = structured_data;
        if (typeof structured_data === 'string') {
          try {
            data = JSON.parse(structured_data);
          } catch {
            data = structured_data;
          }
        }

        // Smart extraction for large sources - extract summaries instead of full records
        if (typeof data === 'object' && data !== null) {
          if (source_name === 'county_liens' && data.lien_score) {
            // For liens: pass the pre-computed summary, not all 100+ records
            content = JSON.stringify({
              lien_score: data.lien_score,
              summary: data.summary,
              total_records: data.total_records,
              search_term: data.search_term
            }, null, 2);
          } else if (source_name === 'review_analysis' && data.summary) {
            // For review analysis: pass the summary
            content = JSON.stringify(data, null, 2);
          } else {
            // Default: stringify the whole thing
            const full = JSON.stringify(data, null, 2);
            // Cap individual sources at 5000 chars to leave room for all sources
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
        // Truncate long text per source
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

      // Parse JSON response (no tool calls - pure analysis)
      const content = message.content || '';

      // Extract JSON from response
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
        // Ask for JSON
        messages.push(message);
        messages.push({
          role: 'user',
          content: 'Please provide your final assessment as JSON.'
        });
      }
    }

    // Fallback
    return await this.fallbackResult('Max iterations reached without valid response');
  }

  /**
   * Finalize and save result
   */
  async finalizeResult(result) {
    const now = new Date().toISOString();

    // Validate
    if (typeof result.trust_score !== 'number') {
      result.trust_score = 50;
    }
    result.trust_score = Math.max(0, Math.min(100, result.trust_score));

    // No score caps - trust the LLM's assessment with standardized data
    // The LLM receives pre-analyzed lien scores, review analysis, etc.
    // Caps were causing information loss and hiding actual variance

    // Save to audit_records
    await this.db.run(`
      INSERT INTO audit_records (
        contractor_id, audit_version, trust_score, risk_level, recommendation,
        reasoning_trace, red_flags, positive_signals, gaps_identified,
        sources_used, collection_rounds, total_cost, created_at, finalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      this.contractorId,
      2,  // audit_version: 2 = agentic audit v2
      result.trust_score,
      result.risk_level || 'MODERATE',
      result.recommendation || 'VERIFY',
      result.reasoning || '',
      JSON.stringify(result.red_flags || []),
      JSON.stringify(result.positive_signals || []),
      JSON.stringify(result.gaps || []),
      JSON.stringify([]),  // sources_used - empty for v2 (data already collected)
      0,  // collection_rounds - none for v2 (no web access)
      this.totalCost,
      now,
      now
    ]);

    // Update contractor (trust_score and passes_threshold)
    const passesThreshold = result.trust_score >= 80;
    await this.db.run(`
      UPDATE contractors_contractor SET trust_score = ?, passes_threshold = ? WHERE id = ?
    `, [result.trust_score, passesThreshold, this.contractorId]);

    success(`✓ Audit complete: ${result.trust_score}/100 (${result.recommendation})`);

    return {
      ...result,
      total_cost: this.totalCost
    };
  }

  async fallbackResult(reason) {
    return await this.finalizeResult({
      trust_score: 50,
      risk_level: 'MODERATE',
      recommendation: 'NOT_RECOMMENDED',
      reasoning: `Audit incomplete: ${reason}. Manual review recommended.`,
      red_flags: [],
      positive_signals: [],
      gaps: ['Automated audit incomplete']
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
        model: 'deepseek-chat',  // chat is more deterministic than reasoner
        messages,
        temperature: 0,
        max_tokens: 4000,
        seed: 42  // fixed seed for reproducibility
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

module.exports = { AuditAgent };
