/**
 * Audit Agent
 *
 * DeepSeek-powered agent with function calling for forensic contractor audits.
 * Can request more data, search the web, and finalize trust scores.
 */

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

// Tool definitions for DeepSeek function calling
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_stored_data',
      description: 'Get all collected data for this contractor from the database. Call this first to see what data is available.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_collection',
      description: 'Request additional data collection for a specific source. Use this when you notice gaps or need to verify claims.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: ['bbb', 'yelp', 'yelp_yahoo', 'google_maps', 'angi', 'trustpilot', 'houzz', 'court_records', 'google_news', 'reddit', 'glassdoor', 'indeed', 'osha', 'epa_echo', 'tx_franchise', 'porch', 'buildzoom', 'homeadvisor'],
            description: 'Which source to collect from'
          },
          reason: {
            type: 'string',
            description: 'Why you need this data (e.g., "Claims 500 projects but no permit history")'
          }
        },
        required: ['source', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Run an ad-hoc web search for specific information about the contractor.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (e.g., "Company Name Dallas lawsuit 2024")'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finalize_score',
      description: 'Commit the final Trust Score and audit results. Call this when you have enough data to make a decision.',
      parameters: {
        type: 'object',
        properties: {
          trust_score: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
            description: 'Overall trust score from 0-100'
          },
          risk_level: {
            type: 'string',
            enum: ['CRITICAL', 'SEVERE', 'MODERATE', 'LOW', 'TRUSTED'],
            description: 'Risk level categorization'
          },
          recommendation: {
            type: 'string',
            enum: ['AVOID', 'CAUTION', 'VERIFY', 'RECOMMENDED'],
            description: 'Action recommendation for homeowners'
          },
          reasoning: {
            type: 'string',
            description: 'Your full analysis and reasoning'
          },
          red_flags: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
                category: { type: 'string' },
                description: { type: 'string' },
                evidence: { type: 'string' }
              }
            },
            description: 'List of identified red flags'
          },
          positive_signals: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of positive indicators'
          },
          gaps_remaining: {
            type: 'array',
            items: { type: 'string' },
            description: 'Data gaps that could not be filled'
          }
        },
        required: ['trust_score', 'risk_level', 'recommendation', 'reasoning']
      }
    }
  }
];

const SYSTEM_PROMPT = `You are a forensic contractor auditor. Your job is to:
1. Analyze available data about a contractor
2. Identify gaps that could change your assessment
3. Request additional data collection when needed
4. Produce a final Trust Score with detailed reasoning

WORKFLOW:
1. First, call get_stored_data() to see what data we have
2. Analyze the data for red flags and positive signals
3. If you notice gaps (e.g., "claims 15 years but no permit history"), call request_collection()
4. If you need to verify specific claims, call search_web()
5. When you have enough data OR hit collection limits, call finalize_score()

SCORING METHODOLOGY (base 60 points, normalize to 100):
- Reputation (25 pts): Cross-platform ratings, review authenticity, complaint patterns
- Credibility (15 pts): Years in business, business registration, professional affiliations
- Financial (10 pts): Liens, bankruptcy signals, payment complaint patterns
- Red Flag Absence (10 pts): No critical issues found

BASELINE SCORING:
- Start at 70 for any established business with reviews
- Strong reviews (4.5+ on Google with 20+ reviews) → base 80
- Excellent reviews (4.8+ with 50+ reviews, consistent across platforms) → base 90
- Deduct from baseline for red flags, don't penalize for missing data

REVIEW COUNT RULES:
- AGGREGATE reviews across all locations (Dallas 63 + Fort Myers 16 = 79 total)
- Multi-location businesses should sum their review counts
- 50+ total reviews qualifies for "excellent" tier regardless of per-location distribution

GOOGLE MAPS LOCATION PRIORITY:
- ALWAYS prioritize LOCAL/DFW market scores over HQ or out-of-state scores
- If you see both "Google Maps DFW" and "Google Maps HQ/Listed", use the DFW score for scoring
- Local scores represent the actual customer experience in the service area
- HQ scores may be from a different market with different crews/management
- Example: If DFW shows 4.5★ (387 reviews) but Listed/HQ shows 3.0★ (48 reviews), use 4.5★

MULTIPLIERS:
- CRITICAL red flag (fraud, active lawsuit, BBB F rating) → ×0.15 (score 0-15)
- SEVERE red flag (major complaint pattern, rating manipulation) → ×0.4 (score 15-40)
- MODERATE red flags only (some inconsistencies) → ×0.7 (score 45-65)
- MINOR red flags only (small issues) → ×0.85 (score 65-80)
- No red flags → ×1.0 (score 80-100)

RED FLAGS (only flag these with EVIDENCE):
- complaint_pattern: Multiple similar complaints indicating systemic issues
- rating_conflict: Major discrepancy between CUSTOMER review platforms (e.g., 4.8 Google vs 1.5 Trustpilot)
- deposit_abandonment: Pattern of taking deposits then ghosting or abandoning work
- lawsuit_history: Active or recent lawsuits
- fake_reviews: Signs of review manipulation (suspiciously perfect ratings, generic text)
- financial_distress: Liens, bankruptcy, collection actions

NORMAL PATTERNS (treat as neutral or positive):
- Glassdoor 3.4 with Google 5.0: Employee reviews are always lower than customer reviews. This is expected.
- Missing Trustpilot/Yelp/BBB: Absence of a profile means no data, treat as neutral.
- Business registration unverified: Assume legitimate unless evidence suggests otherwise.
- One location has fewer reviews: Aggregate total reviews across all locations.

SCORING MINDSET:
- Reward what you CAN verify: great reviews, clean court records, longevity, responsiveness.
- Require EVIDENCE to deduct points. Speculation and gaps stay neutral.
- 79 reviews at 4.9-5.0 with zero complaints = 90+ baseline.
- Only actual negative signals (BBB F, Trustpilot 1.5, lawsuits) reduce the score.

RULES:
- Maximum 3 collection rounds (cost control)
- Always explain WHY you're requesting more data
- If a source already failed or returned no data, don't re-request
- Log your reasoning - humans will review this
- Be specific about evidence for each red flag
- Consider context - a 2-year-old company won't have 15 years of history

Start by calling get_stored_data() to see what we have.`;

// Logging helpers
const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

class AuditAgent {
  constructor(db, contractorId, contractor) {
    this.db = db;
    this.contractorId = contractorId;
    this.contractor = contractor;
    this.collectionRounds = 0;
    this.maxRounds = 3;
    this.reasoningTrace = [];
    this.totalCost = 0;
    this.messages = [];
    this.collectionService = null;
  }

  /**
   * Run the agentic audit loop
   */
  async run(collectionService) {
    this.collectionService = collectionService;

    log('\n🤖 Starting audit agent...');

    // Initialize conversation
    this.messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Audit this contractor:\n` +
          `Name: ${this.contractor.name}\n` +
          `Location: ${this.contractor.city}, ${this.contractor.state}\n` +
          `Website: ${this.contractor.website || 'Not provided'}\n\n` +
          `Analyze all available data and produce a Trust Score.`
      }
    ];

    let complete = false;
    let iterations = 0;
    const maxIterations = 10;

    while (!complete && iterations < maxIterations) {
      iterations++;
      log(`\n--- Agent iteration ${iterations} ---`);

      const response = await this.callDeepSeek();
      this.totalCost += this.estimateCost(response);

      const message = response.choices?.[0]?.message;
      if (!message) {
        error('No message in response');
        break;
      }

      // Check for tool calls
      const toolCalls = message.tool_calls;

      if (toolCalls && toolCalls.length > 0) {
        // Add assistant message with tool calls
        this.messages.push(message);

        // Process each tool call
        for (const toolCall of toolCalls) {
          log(`  Tool: ${toolCall.function.name}`);

          const result = await this.executeTool(toolCall);

          // Add tool result to messages
          this.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: typeof result === 'string' ? result : JSON.stringify(result)
          });

          // Check if finalize was called
          if (toolCall.function.name === 'finalize_score') {
            complete = true;
            return result;
          }
        }
      } else {
        // No tool calls - agent is thinking/reasoning
        if (message.content) {
          log(`  Agent thinking: ${message.content.substring(0, 100)}...`);
          this.reasoningTrace.push(message.content);
        }
        this.messages.push(message);
      }
    }

    // Force finalization if we hit limits
    warn(`\nMax iterations (${maxIterations}) reached, forcing finalization...`);
    return this.forceFinalize('Max iterations reached');
  }

  /**
   * Call DeepSeek API
   */
  async callDeepSeek() {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY not set');
    }

    const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: this.messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} - ${text}`);
    }

    return response.json();
  }

  /**
   * Execute a tool call
   */
  async executeTool(toolCall) {
    const name = toolCall.function.name;
    let args = {};

    try {
      args = JSON.parse(toolCall.function.arguments || '{}');
    } catch (e) {
      return { error: `Failed to parse arguments: ${e.message}` };
    }

    this.reasoningTrace.push(`Tool: ${name}(${JSON.stringify(args)})`);

    switch (name) {
      case 'get_stored_data':
        return await this.toolGetStoredData();

      case 'request_collection':
        if (this.collectionRounds >= this.maxRounds) {
          return {
            error: 'Max collection rounds reached',
            rounds_used: this.collectionRounds,
            max_rounds: this.maxRounds
          };
        }
        this.collectionRounds++;
        return await this.toolRequestCollection(args.source, args.reason);

      case 'search_web':
        return await this.toolSearchWeb(args.query);

      case 'finalize_score':
        return await this.toolFinalizeScore(args);

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  /**
   * Tool: Get all stored data for this contractor
   */
  /**
   * Tool: Get all stored data for this contractor
   */
  async toolGetStoredData() {
    const rows = await this.db.exec(`
      SELECT source_name, raw_text, structured_data, fetch_status, fetched_at
      FROM contractor_raw_data
      WHERE contractor_id = ?
      ORDER BY source_name
    `, [this.contractorId]);

    if (rows.length === 0) {
      return {
        message: 'No data collected yet for this contractor',
        contractor: this.contractor,
        data: {}
      };
    }

    const data = {};

    for (const row of rows) {
      const sourceName = row.source_name;
      const rawText = row.raw_text;
      const structuredData = row.structured_data;
      const status = row.fetch_status;

      // Truncate long text for context window
      const truncatedText = rawText ? rawText.substring(0, 4000) : null;

      // PostgreSQL jsonb returns object directly, no parsing needed
      const parsed = structuredData
        ? (typeof structuredData === 'string' ? JSON.parse(structuredData) : structuredData)
        : null;

      data[sourceName] = {
        status,
        text: truncatedText,
        structured: parsed,
        truncated: rawText && rawText.length > 4000
      };
    }

    return {
      contractor: this.contractor,
      sources_collected: Object.keys(data).length,
      sources_successful: Object.values(data).filter(d => d.status === 'success').length,
      data
    };
  }

  /**
   * Tool: Request additional collection
   */
  async toolRequestCollection(source, reason) {
    log(`  Requesting collection: ${source} - ${reason}`);
    this.reasoningTrace.push(`Requested ${source}: ${reason}`);

    try {
      const result = await this.collectionService.fetchSpecificSource(
        this.contractorId,
        this.contractor,
        source,
        reason
      );

      return {
        source,
        reason,
        status: result.status,
        data_preview: result.text ? result.text.substring(0, 2000) : null,
        structured: result.structured || null,
        collection_round: this.collectionRounds,
        rounds_remaining: this.maxRounds - this.collectionRounds
      };
    } catch (err) {
      return {
        source,
        reason,
        status: 'error',
        error: err.message
      };
    }
  }

  /**
   * Tool: Ad-hoc web search
   */
  async toolSearchWeb(query) {
    log(`  Web search: ${query}`);
    this.reasoningTrace.push(`Web search: ${query}`);

    try {
      const result = await this.collectionService.searchWeb(query);
      return result;
    } catch (err) {
      return {
        query,
        status: 'error',
        error: err.message
      };
    }
  }

  /**
   * Tool: Finalize the audit score
   */
  /**
   * Tool: Finalize the audit score
   */
  async toolFinalizeScore(args) {
    const now = new Date().toISOString();

    // Validate required fields
    if (typeof args.trust_score !== 'number' || args.trust_score < 0 || args.trust_score > 100) {
      return { error: 'Invalid trust_score - must be 0-100' };
    }

    // Save to audit_records
    await this.db.run(`
      INSERT INTO audit_records (
        contractor_id, audit_version, trust_score, risk_level, recommendation,
        reasoning_trace, red_flags, positive_signals, gaps_identified,
        sources_used, collection_rounds, total_cost, created_at, finalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      this.contractorId,
      1,  // audit_version: 1 = agentic audit v1
      args.trust_score,
      args.risk_level,
      args.recommendation,
      this.reasoningTrace.join('\n\n---\n\n'),
      JSON.stringify(args.red_flags || []),
      JSON.stringify(args.positive_signals || []),
      JSON.stringify(args.gaps_remaining || []),
      JSON.stringify(await this.getSourcesUsed()),
      this.collectionRounds,
      this.totalCost,
      now,
      now
    ]);

    // Update contractor's trust_score
    await this.db.run(`
      UPDATE contractors_contractor
      SET trust_score = ?
      WHERE id = ?
    `, [args.trust_score, this.contractorId]);

    success(`\n✓ Audit finalized: ${args.trust_score}/100 (${args.recommendation})`);

    return {
      finalized: true,
      trust_score: args.trust_score,
      risk_level: args.risk_level,
      recommendation: args.recommendation,
      reasoning: args.reasoning,
      red_flags: args.red_flags || [],
      positive_signals: args.positive_signals || [],
      gaps_remaining: args.gaps_remaining || [],
      collection_rounds: this.collectionRounds,
      total_cost: this.totalCost
    };
  }

  /**
   * Get list of sources used
   */
  async getSourcesUsed() {
    const rows = await this.db.exec(`
      SELECT source_name FROM contractor_raw_data
      WHERE contractor_id = ? AND fetch_status = 'success'
    `, [this.contractorId]);

    if (rows.length === 0) return [];
    return rows.map(row => row.source_name);
  }

  /**
   * Force finalization when limits hit
   */
  async forceFinalize(reason) {
    warn(`Forced finalization: ${reason}`);
    return await this.toolFinalizeScore({
      trust_score: 50,
      risk_level: 'MODERATE',
      recommendation: 'VERIFY',
      reasoning: `Forced finalization due to: ${reason}. Insufficient data or iterations for a confident assessment. Manual review recommended.`,
      red_flags: [],
      positive_signals: [],
      gaps_remaining: ['Manual review required', `Reason: ${reason}`]
    });
  }

  /**
   * Estimate cost of API call
   */
  estimateCost(response) {
    const usage = response.usage || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    // DeepSeek pricing: ~$0.14/1M input, ~$0.28/1M output (approximate)
    return (inputTokens * 0.00000014) + (outputTokens * 0.00000028);
  }
}

module.exports = { AuditAgent };
