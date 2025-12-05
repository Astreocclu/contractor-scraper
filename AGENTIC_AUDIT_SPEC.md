# Agentic Audit System Specification
## For Claude Code Implementation

*Created: December 2025*
*Status: Ready for Implementation*

---

## Overview

Transform the monolithic `forensic_audit_puppeteer.js` into an agentic system where:
1. **Collection Service** gathers data and stores to SQLite
2. **Audit Agent** (DeepSeek with tools) analyzes data and can request more collection
3. **Orchestrator** coordinates the loop with cost controls

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                         ORCHESTRATOR                                   │
│                      (run_audit.js)                                    │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   ┌─────────────────┐         ┌─────────────────┐                     │
│   │   COLLECTION    │◄───────►│   AUDIT AGENT   │                     │
│   │    SERVICE      │         │   (DeepSeek)    │                     │
│   │                 │         │                 │                     │
│   │ • Puppeteer     │         │ Tools:          │                     │
│   │ • TDLR scraper  │         │ • get_data()    │                     │
│   │ • Court scraper │         │ • request()     │                     │
│   │ • API sources   │         │ • search_web()  │                     │
│   │                 │         │ • finalize()    │                     │
│   └────────┬────────┘         └────────┬────────┘                     │
│            │                           │                               │
│            ▼                           ▼                               │
│   ┌─────────────────────────────────────────────────────────┐         │
│   │                     SQLite DATABASE                      │         │
│   │                                                          │         │
│   │  contractor_raw_data    │  collection_log  │  audits    │         │
│   └─────────────────────────────────────────────────────────┘         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

Create these files in `/contractors/`:

```
contractors/
├── run_audit.js                    # Entry point (replaces forensic_audit_puppeteer.js)
├── services/
│   ├── collection_service.js       # Puppeteer scraping, stores to DB
│   ├── audit_agent.js              # DeepSeek with function calling
│   └── orchestrator.js             # Controls the collect→audit loop
├── tools/                          # Agent tools
│   ├── get_stored_data.js          # Read from DB
│   ├── request_collection.js       # Trigger targeted scrape
│   ├── search_web.js               # Perplexity/Puppeteer ad-hoc search
│   └── finalize_score.js           # Commit final audit
├── lib/                            # Keep existing
│   ├── tdlr_scraper.js             # (existing)
│   ├── court_scraper.js            # (existing)
│   └── api_sources.js              # (existing)
├── db/
│   ├── schema.sql                  # New tables
│   └── migrations/                 # Future migrations
└── utils/
    ├── cost_tracker.js             # Track API costs
    └── logger.js                   # Structured logging
```

---

## Database Schema

Add these tables to existing `db.sqlite3`:

```sql
-- Raw scraped data (one row per source per contractor)
CREATE TABLE IF NOT EXISTS contractor_raw_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contractor_id INTEGER,
    source_name TEXT NOT NULL,           -- 'bbb', 'yelp', 'tdlr', etc.
    source_url TEXT,
    raw_text TEXT,                       -- Extracted text content
    structured_data TEXT,                -- JSON if API source
    fetch_status TEXT DEFAULT 'pending', -- 'success', 'blocked', 'not_found', 'error'
    error_message TEXT,
    fetched_at TEXT,                     -- ISO timestamp
    expires_at TEXT,                     -- When to re-fetch
    FOREIGN KEY (contractor_id) REFERENCES contractors_contractor(id)
);

-- Collection log (audit trail)
CREATE TABLE IF NOT EXISTS collection_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contractor_id INTEGER,
    source_name TEXT NOT NULL,
    requested_by TEXT NOT NULL,          -- 'initial', 'audit_agent', 'manual'
    request_reason TEXT,                 -- Why agent requested this
    status TEXT DEFAULT 'pending',
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT
);

-- Audit records with reasoning trace
CREATE TABLE IF NOT EXISTS audit_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contractor_id INTEGER,
    audit_version INTEGER DEFAULT 1,
    
    -- Scores
    trust_score INTEGER,
    risk_level TEXT,                     -- 'CRITICAL', 'SEVERE', 'MODERATE', 'LOW', 'TRUSTED'
    recommendation TEXT,                 -- 'AVOID', 'CAUTION', 'VERIFY', 'RECOMMENDED'
    
    -- Component scores
    verification_score INTEGER,
    reputation_score REAL,
    credibility_score INTEGER,
    financial_score INTEGER,
    red_flag_score INTEGER,
    
    -- Agent reasoning (THE GOLD)
    reasoning_trace TEXT,                -- Full chain of thought
    red_flags TEXT,                      -- JSON array
    positive_signals TEXT,               -- JSON array
    gaps_identified TEXT,                -- JSON array
    
    -- Metadata
    sources_used TEXT,                   -- JSON array
    sources_missing TEXT,                -- JSON array
    collection_rounds INTEGER DEFAULT 1,
    total_cost REAL DEFAULT 0,           -- API costs
    
    created_at TEXT,
    finalized_at TEXT,
    
    FOREIGN KEY (contractor_id) REFERENCES contractors_contractor(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_raw_data_contractor ON contractor_raw_data(contractor_id);
CREATE INDEX IF NOT EXISTS idx_raw_data_source ON contractor_raw_data(source_name);
CREATE INDEX IF NOT EXISTS idx_raw_data_expires ON contractor_raw_data(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_contractor ON audit_records(contractor_id);
```

---

## Collection Service

Refactor existing scraping into modular service:

```javascript
// services/collection_service.js

const puppeteer = require('puppeteer');
const { searchTDLR } = require('../lib/tdlr_scraper');
const { searchCourtRecords } = require('../lib/court_scraper');
const { fetchAPISources } = require('../lib/api_sources');

// Source definitions with cache TTL
const SOURCES = {
  // Tier 1: Reviews (cache 24h)
  bbb:       { ttl: 86400, tier: 1 },
  yelp:      { ttl: 86400, tier: 1 },
  google:    { ttl: 86400, tier: 1 },
  angi:      { ttl: 86400, tier: 1 },
  houzz:     { ttl: 86400, tier: 1 },
  thumbtack: { ttl: 86400, tier: 1 },
  facebook:  { ttl: 86400, tier: 1 },
  
  // Tier 2: News (cache 12h - changes faster)
  google_news: { ttl: 43200, tier: 2 },
  local_news:  { ttl: 43200, tier: 2 },
  
  // Tier 3: Social (cache 24h)
  reddit:   { ttl: 86400, tier: 3 },
  youtube:  { ttl: 86400, tier: 3 },
  nextdoor: { ttl: 86400, tier: 3 },
  
  // Tier 4: Employee (cache 7d - changes slowly)
  indeed:    { ttl: 604800, tier: 4 },
  glassdoor: { ttl: 604800, tier: 4 },
  
  // Tier 5: Government (cache 7d)
  osha:     { ttl: 604800, tier: 5 },
  epa_echo: { ttl: 604800, tier: 5 },
  
  // Tier 6: TX-Specific (cache 7d)
  tdlr:            { ttl: 604800, tier: 6 },
  tx_sos:          { ttl: 604800, tier: 6 },
  tx_ag:           { ttl: 604800, tier: 6 },
  tx_franchise:    { ttl: 604800, tier: 6 },
  
  // Tier 7: Courts (cache 7d)
  court_records:       { ttl: 604800, tier: 7 },
  court_listener:      { ttl: 604800, tier: 7 },
  
  // Tier 8: Industry (cache 24h)
  porch:       { ttl: 86400, tier: 8 },
  buildzoom:   { ttl: 86400, tier: 8 },
  homeadvisor: { ttl: 86400, tier: 8 },
};

class CollectionService {
  constructor(db) {
    this.db = db;
    this.browser = null;
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  async close() {
    if (this.browser) await this.browser.close();
  }

  /**
   * Run initial collection for all sources
   */
  async runInitialCollection(contractorId, contractor) {
    const results = [];
    
    // Tier 1-3: URL-based sources (parallel batches)
    const urlSources = this.buildUrls(contractor);
    for (const [source, url] of Object.entries(urlSources)) {
      const result = await this.fetchAndStore(contractorId, source, url);
      results.push(result);
    }
    
    // Tier 6: TDLR (form submission)
    if (contractor.state === 'TX') {
      const tdlrResult = await this.fetchTDLR(contractorId, contractor.name);
      results.push(tdlrResult);
    }
    
    // Tier 7: Court records
    const courtResult = await this.fetchCourtRecords(contractorId, contractor.name);
    results.push(courtResult);
    
    // API sources
    const apiResults = await this.fetchAPIs(contractorId, contractor);
    results.push(...apiResults);
    
    return results;
  }

  /**
   * Fetch a specific source (for agent requests)
   */
  async fetchSpecificSource(contractorId, sourceName, reason) {
    // Log the request
    this.logCollectionRequest(contractorId, sourceName, 'audit_agent', reason);
    
    // Check cache first
    const cached = this.getCachedData(contractorId, sourceName);
    if (cached && !this.isExpired(cached)) {
      return { source: sourceName, status: 'cached', data: cached };
    }
    
    // Fetch fresh
    // ... (dispatch to appropriate fetcher based on sourceName)
  }

  /**
   * Store raw data to DB
   */
  async storeRawData(contractorId, source, data) {
    const now = new Date().toISOString();
    const ttl = SOURCES[source]?.ttl || 86400;
    const expires = new Date(Date.now() + ttl * 1000).toISOString();
    
    this.db.run(`
      INSERT OR REPLACE INTO contractor_raw_data 
      (contractor_id, source_name, source_url, raw_text, structured_data, 
       fetch_status, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      contractorId,
      source,
      data.url,
      data.text,
      data.structured ? JSON.stringify(data.structured) : null,
      data.status,
      now,
      expires
    ]);
  }

  // ... buildUrls, fetchPage, etc. (extract from existing code)
}

module.exports = { CollectionService, SOURCES };
```

---

## Audit Agent with Tools

DeepSeek with function calling:

```javascript
// services/audit_agent.js

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_stored_data',
      description: 'Get all collected data for this contractor from the database',
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
      description: 'Request additional data collection for a specific source',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: ['permits', 'insurance', 'bbb', 'yelp', 'google', 'tdlr', 
                   'court_records', 'news', 'social', 'employee_reviews'],
            description: 'Which source to collect'
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
      description: 'Run an ad-hoc web search for specific information',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (e.g., "Shade Doctor Dallas lawsuit 2024")'
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
      description: 'Commit the final Trust Score. Call this when you have enough data.',
      parameters: {
        type: 'object',
        properties: {
          trust_score: { type: 'integer', minimum: 0, maximum: 100 },
          risk_level: { 
            type: 'string', 
            enum: ['CRITICAL', 'SEVERE', 'MODERATE', 'LOW', 'TRUSTED'] 
          },
          recommendation: { 
            type: 'string', 
            enum: ['AVOID', 'CAUTION', 'VERIFY', 'RECOMMENDED'] 
          },
          reasoning: { type: 'string', description: 'Your analysis reasoning' },
          red_flags: { 
            type: 'array', 
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string' },
                category: { type: 'string' },
                description: { type: 'string' },
                evidence: { type: 'string' }
              }
            }
          },
          positive_signals: { type: 'array', items: { type: 'string' } },
          gaps_remaining: { type: 'array', items: { type: 'string' } }
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
4. Produce a final Trust Score with reasoning

WORKFLOW:
1. First, call get_stored_data() to see what data we have
2. Analyze the data for red flags and positive signals
3. If you notice gaps (e.g., "claims 15 years but no permit history"), call request_collection()
4. If you need to verify specific claims, call search_web()
5. When you have enough data, call finalize_score()

SCORING METHODOLOGY:
- Verification: License status OR permit history vs claims (15 pts)
- Reputation: Cross-platform ratings, fake detection (15 pts)
- Credibility: Years, portfolio, consistency (10 pts)  
- Financial: Liens, bankruptcy, distress signals (10 pts)
- Red Flag Absence: No critical issues (10 pts)
- Base = 60 pts, normalized to 100

MULTIPLIERS:
- CRITICAL red flag → ×0 (auto-fail)
- SEVERE red flag → ×0.3
- MODERATE only → ×0.7
- MINOR only → ×0.9
- No flags → ×1.0

RULES:
- Maximum 3 collection rounds (cost control)
- Always explain WHY you're requesting more data
- If a source already failed, don't re-request
- Log your reasoning - humans will review

Start by calling get_stored_data().`;

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
  }

  async run(collectionService) {
    this.collectionService = collectionService;
    
    // Initialize conversation
    this.messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Audit contractor: ${this.contractor.name} in ${this.contractor.city}, ${this.contractor.state}` }
    ];

    let complete = false;
    let iterations = 0;
    const maxIterations = 10; // Safety limit

    while (!complete && iterations < maxIterations) {
      iterations++;
      
      const response = await this.callDeepSeek();
      this.totalCost += this.estimateCost(response);
      
      // Check for tool calls
      const toolCalls = response.choices?.[0]?.message?.tool_calls;
      
      if (toolCalls && toolCalls.length > 0) {
        // Add assistant message with tool calls
        this.messages.push(response.choices[0].message);
        
        // Process each tool call
        for (const toolCall of toolCalls) {
          const result = await this.executeTool(toolCall);
          
          // Add tool result to messages
          this.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
          
          // Check if finalize was called
          if (toolCall.function.name === 'finalize_score') {
            complete = true;
            return result;
          }
        }
      } else {
        // No tool calls, add response and continue
        this.messages.push(response.choices[0].message);
        this.reasoningTrace.push(response.choices[0].message.content);
      }
    }

    // Force finalization if we hit limits
    return this.forceFinalize('Max iterations reached');
  }

  async callDeepSeek() {
    const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
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
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    return response.json();
  }

  async executeTool(toolCall) {
    const name = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments || '{}');
    
    this.reasoningTrace.push(`Tool call: ${name}(${JSON.stringify(args)})`);

    switch (name) {
      case 'get_stored_data':
        return this.toolGetStoredData();
        
      case 'request_collection':
        if (this.collectionRounds >= this.maxRounds) {
          return { error: 'Max collection rounds reached', rounds_used: this.collectionRounds };
        }
        this.collectionRounds++;
        return this.toolRequestCollection(args.source, args.reason);
        
      case 'search_web':
        return this.toolSearchWeb(args.query);
        
      case 'finalize_score':
        return this.toolFinalizeScore(args);
        
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  toolGetStoredData() {
    const rows = this.db.exec(`
      SELECT source_name, raw_text, structured_data, fetch_status
      FROM contractor_raw_data
      WHERE contractor_id = ?
      ORDER BY source_name
    `, [this.contractorId]);

    if (!rows.length || !rows[0].values.length) {
      return { data: {}, message: 'No data collected yet' };
    }

    const data = {};
    for (const row of rows[0].values) {
      data[row[0]] = {
        text: row[1]?.substring(0, 5000), // Truncate for context
        structured: row[2] ? JSON.parse(row[2]) : null,
        status: row[3]
      };
    }

    return { 
      data,
      sources_collected: Object.keys(data).length,
      contractor: this.contractor
    };
  }

  async toolRequestCollection(source, reason) {
    this.reasoningTrace.push(`Requesting ${source}: ${reason}`);
    
    const result = await this.collectionService.fetchSpecificSource(
      this.contractorId, 
      source, 
      reason
    );
    
    return {
      source,
      reason,
      result: result.status,
      data_preview: result.data?.text?.substring(0, 2000)
    };
  }

  async toolSearchWeb(query) {
    // Use Puppeteer for ad-hoc Google search
    const page = await this.collectionService.browser.newPage();
    try {
      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
      await page.waitForSelector('#search', { timeout: 10000 });
      
      const text = await page.evaluate(() => {
        const results = document.querySelectorAll('#search .g');
        return Array.from(results).slice(0, 5).map(r => r.innerText).join('\n\n');
      });
      
      return { query, results: text.substring(0, 3000) };
    } finally {
      await page.close();
    }
  }

  toolFinalizeScore(args) {
    const now = new Date().toISOString();
    
    // Save to audit_records
    this.db.run(`
      INSERT INTO audit_records (
        contractor_id, trust_score, risk_level, recommendation,
        reasoning_trace, red_flags, positive_signals, gaps_identified,
        collection_rounds, total_cost, created_at, finalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      this.contractorId,
      args.trust_score,
      args.risk_level,
      args.recommendation,
      this.reasoningTrace.join('\n\n'),
      JSON.stringify(args.red_flags || []),
      JSON.stringify(args.positive_signals || []),
      JSON.stringify(args.gaps_remaining || []),
      this.collectionRounds,
      this.totalCost,
      now,
      now
    ]);

    // Update contractor trust_score
    this.db.run(`
      UPDATE contractors_contractor 
      SET trust_score = ?, last_audit_at = ?
      WHERE id = ?
    `, [args.trust_score, now, this.contractorId]);

    return {
      finalized: true,
      trust_score: args.trust_score,
      risk_level: args.risk_level,
      recommendation: args.recommendation,
      reasoning: args.reasoning,
      red_flags: args.red_flags,
      gaps_remaining: args.gaps_remaining,
      collection_rounds: this.collectionRounds,
      total_cost: this.totalCost
    };
  }

  forceFinalize(reason) {
    return this.toolFinalizeScore({
      trust_score: 50,
      risk_level: 'MODERATE',
      recommendation: 'CAUTION',
      reasoning: `Forced finalization: ${reason}. Insufficient data for confident assessment.`,
      gaps_remaining: ['Manual review required']
    });
  }

  estimateCost(response) {
    // Rough estimate: $0.001 per 1K tokens
    const usage = response.usage || {};
    return ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)) / 1000 * 0.001;
  }
}

module.exports = { AuditAgent };
```

---

## Orchestrator

```javascript
// services/orchestrator.js

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { CollectionService } = require('./collection_service');
const { AuditAgent } = require('./audit_agent');

const DB_PATH = path.join(__dirname, '..', 'db.sqlite3');

async function runForensicAudit(contractorInput) {
  console.log('\n🔍 AGENTIC FORENSIC AUDIT\n');
  
  // Open database
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);
  
  // Find contractor
  let contractor;
  if (contractorInput.id) {
    const result = db.exec(`
      SELECT id, business_name, city, state, website, zip_code
      FROM contractors_contractor WHERE id = ?
    `, [contractorInput.id]);
    
    if (!result.length) throw new Error(`Contractor ID ${contractorInput.id} not found`);
    const row = result[0].values[0];
    contractor = {
      id: row[0], name: row[1], city: row[2], 
      state: row[3], website: row[4], zip: row[5]
    };
  } else {
    contractor = { 
      id: null, 
      name: contractorInput.name, 
      city: contractorInput.city,
      state: contractorInput.state 
    };
  }
  
  console.log(`📋 Contractor: ${contractor.name}`);
  console.log(`📍 Location: ${contractor.city}, ${contractor.state}`);
  
  // Initialize collection service
  const collectionService = new CollectionService(db);
  await collectionService.init();
  
  try {
    // Check for recent data
    const recentData = db.exec(`
      SELECT COUNT(*) FROM contractor_raw_data 
      WHERE contractor_id = ? 
        AND datetime(expires_at) > datetime('now')
    `, [contractor.id]);
    
    const cachedSources = recentData[0]?.values[0][0] || 0;
    
    if (cachedSources === 0) {
      console.log('\n📥 Running initial collection...');
      await collectionService.runInitialCollection(contractor.id, contractor);
    } else {
      console.log(`\n📦 Using ${cachedSources} cached sources`);
    }
    
    // Run agentic audit
    console.log('\n🤖 Starting audit agent...');
    const agent = new AuditAgent(db, contractor.id, contractor);
    const result = await agent.run(collectionService);
    
    // Output
    console.log('\n' + '═'.repeat(60));
    console.log(`  TRUST SCORE: ${result.trust_score}/100`);
    console.log(`  RISK LEVEL:  ${result.risk_level}`);
    console.log(`  RECOMMEND:   ${result.recommendation}`);
    console.log('═'.repeat(60));
    
    console.log('\n📝 REASONING:');
    console.log(result.reasoning);
    
    if (result.red_flags?.length) {
      console.log('\n🚩 RED FLAGS:');
      result.red_flags.forEach(f => 
        console.log(`  [${f.severity}] ${f.category}: ${f.description}`)
      );
    }
    
    if (result.gaps_remaining?.length) {
      console.log('\n⚠️  GAPS (manual verification needed):');
      result.gaps_remaining.forEach(g => console.log(`  - ${g}`));
    }
    
    console.log(`\n💰 Total cost: $${result.total_cost.toFixed(4)}`);
    console.log(`🔄 Collection rounds: ${result.collection_rounds}`);
    
    // Save DB
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    console.log('\n✅ Audit saved to database');
    
    return result;
    
  } finally {
    await collectionService.close();
    db.close();
  }
}

module.exports = { runForensicAudit };
```

---

## Entry Point

```javascript
// run_audit.js

const { runForensicAudit } = require('./services/orchestrator');

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
};

async function main() {
  const input = {
    id: getArg('id') ? parseInt(getArg('id')) : null,
    name: getArg('name'),
    city: getArg('city'),
    state: getArg('state') || 'TX'
  };

  if (!input.id && !input.name) {
    console.log('Usage:');
    console.log('  node run_audit.js --id 123');
    console.log('  node run_audit.js --name "Company" --city "Dallas" --state "TX"');
    process.exit(1);
  }

  try {
    const result = await runForensicAudit(input);
    process.exit(result.trust_score >= 60 ? 0 : 1);
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
}

main();
```

---

## Implementation Order

1. **Day 1: Database + Collection Service**
   - Add new tables (schema.sql)
   - Refactor existing scraping into CollectionService
   - Test: Can store and retrieve raw data

2. **Day 2: Audit Agent**
   - Implement DeepSeek function calling
   - Implement tools (get_stored_data, finalize_score)
   - Test: Agent can read data and score

3. **Day 3: Agentic Loop**
   - Implement request_collection tool
   - Implement search_web tool
   - Test: Agent can request more data

4. **Day 4: Orchestrator + Polish**
   - Wire up orchestrator
   - Add cost tracking
   - Test end-to-end with real contractors

---

## Testing Plan

```bash
# Test 1: Known fraud (should detect)
node run_audit.js --name "Orange Elephant Roofing" --city "Dallas" --state "TX"
# Expected: Score <20, CRITICAL, AVOID

# Test 2: Good contractor
node run_audit.js --id 123  # Your known good contractor
# Expected: Score >70, LOW/TRUSTED, VERIFY/RECOMMENDED

# Test 3: Unknown contractor (should request more data)
node run_audit.js --name "Random New Company" --city "Fort Worth" --state "TX"
# Expected: Agent requests permits, news, etc.
```

---

## Cost Estimates

| Operation | Cost |
|-----------|------|
| Initial collection (26 sources) | ~$0 (Puppeteer) |
| DeepSeek get_stored_data | ~$0.002 |
| DeepSeek reasoning turn | ~$0.003 |
| DeepSeek finalize | ~$0.002 |
| Per collection request | ~$0.001 + scrape time |
| **Typical audit (2 rounds)** | **~$0.015-0.025** |

---

*Give this to Claude Code. It has everything needed to implement.*
