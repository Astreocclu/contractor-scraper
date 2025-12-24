/**
 * Audit Agent - Pure Analysis Engine (V3)
 *
 * Receives ALL collected data upfront in the prompt.
 * NO tools - pure analysis, no web access.
 * Returns structured JSON with verdict/confidence (score is internal only).
 * Uses deepseek-chat with seed:42 for deterministic scoring.
 */

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

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
The Review Analyzer has already evaluated reviews for authenticity. TRUST ITS VERDICT.
- If Review Analysis says "TRUST_REVIEWS" -> the reviews are legitimate
- If Review Analysis says "DISTRUST_REVIEWS" -> flag as concern
- If Review Analysis says "VERIFY_REVIEWS" -> note as data gap, not red flag

High review volume with high ratings is a POSITIVE signal - do not question it unless Review Analyzer found manipulation.

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
        max_tokens: 4000,
        seed: 42
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

module.exports = { AuditAgent, getVerdict, getConfidence, formatDisplayOutput };
