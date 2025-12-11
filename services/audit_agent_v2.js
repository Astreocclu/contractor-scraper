/**
 * Audit Agent V2 - Simplified
 *
 * Key changes from V1:
 * - Receives ALL collected data upfront in the prompt
 * - No discovery tools (get_stored_data, request_collection removed)
 * - Only ONE tool: investigate() for suspicious cases
 * - Returns structured JSON directly
 */

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

// Single tool - investigate suspicious findings
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'investigate',
      description: 'Run an ad-hoc web search to investigate suspicious claims or verify specific information. Use sparingly - only when you see something that needs deeper investigation.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (e.g., "Company Name lawsuit 2024" or "Owner Name fraud")'
          },
          reason: {
            type: 'string',
            description: 'Why you need to investigate this'
          }
        },
        required: ['query', 'reason']
      }
    }
  }
];

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

## LIEN ANALYSIS (CRITICAL FOR FINANCIAL HEALTH)
County lien records reveal a contractor's financial reliability:

### CRITICAL RED FLAGS (auto-fail, score ≤15):
- 3+ active mechanic's liens = PATTERN OF NON-PAYMENT (stiffing subcontractors/suppliers)
- Abstract of Judgment > $50,000 = LOST MAJOR LAWSUIT
- Federal Tax Lien > $50,000 = IRS IS PURSUING THEM

### SEVERE RED FLAGS (score max 35):
- 1-2 active mechanic's liens = FINANCIAL STRESS
- State Tax Lien = TEXAS COMPTROLLER PURSUING UNPAID TAXES
- Pattern of slow releases (liens taking >90 days to resolve)

### MODERATE CONCERNS (score max 60):
- Resolved mechanic's liens (lien + matching release) = HAD DISPUTES but resolved
- Quick resolution disputes (<30 days) = May be paperwork issues not bad faith

### WHAT LIENS MEAN:
- MECH_LIEN = A subcontractor/supplier filed because they weren't paid
- REL_LIEN = A lien was resolved (check if it pairs with active liens)
- ABS_JUDG = Lost a lawsuit and owes money
- FED_TAX_LIEN = Federal taxes unpaid
- STATE_TAX_LIEN = State taxes unpaid

Always check if liens have corresponding releases. Active unreleased liens are MUCH worse than resolved ones.


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

0-15 (CRITICAL/AVOID): Known fraudster, news investigation, pattern of victims, active lawsuits for fraud
15-35 (SEVERE/AVOID): Serious red flags, multiple complaints of same issue, BBB F rating
40-60 (MODERATE/CAUTION): Mixed signals, some concerns, needs verification
60-75 (LOW/VERIFY): Solid contractor with minor issues, mostly positive
75-90 (TRUSTED/RECOMMENDED): Good track record, verified, minor gaps
90-100 (TRUSTED/RECOMMENDED): Squeaky clean, everything verified, years of positive history

## ENTITY NAME MATCHING
Company names vary in records. These are the SAME company:
- "Orange Elephant" = "Orange Elephant Roofing LLC" = "Orange Elephant LLC"
- "Smith Pools" = "Smith Pools Inc" = "Smith's Pool Service"
Look for the business, not exact string matches.

## WHEN TO USE investigate()
Only when you see something suspicious that needs deeper digging:
- News article mentions lawsuit but no details
- Claims "15 years experience" but BBB shows formed 2022
- Name appears in complaint database
- Review Analyzer flagged DISTRUST_REVIEWS and you want to verify specific claims

## OUTPUT FORMAT
After your investigation, respond with ONLY this JSON:
{
  "trust_score": <0-100>,
  "risk_level": "<CRITICAL|SEVERE|MODERATE|LOW|TRUSTED>",
  "recommendation": "<AVOID|CAUTION|VERIFY|RECOMMENDED>",
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
  else if (enforcedScore <= 60) auditResult.risk_level = 'MODERATE';
  else if (enforcedScore <= 75) auditResult.risk_level = 'LOW';
  else auditResult.risk_level = 'TRUSTED';

  // Enforce recommendation
  auditResult.recommendation = enforcedScore <= 40 ? 'AVOID' :
    enforcedScore <= 60 ? 'CAUTION' :
      enforcedScore <= 80 ? 'VERIFY' : 'RECOMMENDED';

  return auditResult;
}

class AuditAgentV2 {
  constructor(db, contractorId, contractor) {
    this.db = db;
    this.contractorId = contractorId;
    this.contractor = contractor;
    this.investigationCount = 0;
    this.maxInvestigations = 2;
    this.totalCost = 0;
    this.searchFn = null; // Set by orchestrator
  }

  /**
   * Build the data prompt with all collected data
   */
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
        try {
          const parsed = JSON.parse(structured_data);
          content = JSON.stringify(parsed, null, 2);
        } catch {
          content = structured_data;
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
  async run(searchFn) {
    this.searchFn = searchFn;

    log('\n🤖 Audit Agent V2 analyzing data...');

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

      // Check for tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        messages.push(message);

        for (const toolCall of message.tool_calls) {
          if (toolCall.function.name === 'investigate') {
            const result = await this.executeInvestigate(toolCall);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result)
            });
          }
        }
      } else {
        // No tool calls - try to parse JSON response
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
    }

    // Fallback
    return await this.fallbackResult('Max iterations reached without valid response');
  }

  /**
   * Execute investigate tool
   */
  async executeInvestigate(toolCall) {
    let args;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return { error: 'Invalid arguments' };
    }

    if (this.investigationCount >= this.maxInvestigations) {
      return {
        error: 'Investigation limit reached',
        limit: this.maxInvestigations
      };
    }

    this.investigationCount++;
    log(`  🔍 Investigating: ${args.query}`);
    log(`     Reason: ${args.reason}`);

    if (!this.searchFn) {
      return { error: 'Search function not available' };
    }

    try {
      const result = await this.searchFn(args.query);
      return {
        query: args.query,
        results: result.results || result.text || 'No results',
        status: result.status || 'success'
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Finalize and save result
   */
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

    // Enforce score multipliers based on red flag severity
    result = enforceScoreMultipliers(result);

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
      this.investigationCount,
      this.totalCost,
      now,
      now
    ]);

    // Update contractor
    await this.db.run(`
      UPDATE contractors_contractor SET trust_score = ? WHERE id = ?
    `, [result.trust_score, this.contractorId]);

    success(`✓ Audit complete: ${result.trust_score}/100 (${result.recommendation})`);

    return {
      ...result,
      investigations: this.investigationCount,
      total_cost: this.totalCost
    };
  }

  async fallbackResult(reason) {
    return await this.finalizeResult({
      trust_score: 50,
      risk_level: 'MODERATE',
      recommendation: 'VERIFY',
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
        model: 'deepseek-reasoner',
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens: 4000
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

module.exports = { AuditAgentV2 };
