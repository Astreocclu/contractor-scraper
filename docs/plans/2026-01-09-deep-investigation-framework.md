# Deep Investigation Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an iterative investigation loop that catches fraud patterns by following leads across multiple searches, running between initial collection and dialectic audit.

**Architecture:** Rule-based checks identify known fraud patterns (virtual addresses, timeline fabrication, permit gaps). If issues found, LLM cascade (DeepSeek → Gemini → Claude) generates targeted follow-up queries. Serper API executes searches. Loop repeats until max_iterations/max_time/no new queries. Enriched data + flags pass to existing DialecticAuditAgent.

**Tech Stack:** Node.js, DeepSeek API, Gemini API, Claude API, Serper API, PostgreSQL

---

## Task 1: Create Constants and Configuration

**Files:**
- Create: `services/deep_investigation/constants.js`

**Step 1: Create the constants file**

```javascript
/**
 * Deep Investigation Framework - Configuration
 *
 * Modes:
 * - "full": Rules → DeepSeek → Gemini → Claude (all tiers)
 * - "standard": Rules → DeepSeek → Gemini (skip Claude)
 * - "minimal": Rules → DeepSeek only (fastest/cheapest)
 */

const INVESTIGATION_MODE = process.env.INVESTIGATION_MODE || 'standard';

const MAX_ITERATIONS = 5;
const MAX_TIME_MS = 180000; // 3 minutes
const MAX_QUERIES_PER_ITERATION = 5;

// Confidence thresholds for LLM cascade escalation
const THRESHOLDS = {
  ESCALATE_TO_GEMINI: 0.6,   // If DeepSeek confidence < 60%, escalate
  ESCALATE_TO_CLAUDE: 0.4,  // If Gemini confidence < 40%, escalate (rare)
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
    max_tokens: 2000,
    temperature: 0.1
  },
  claude: {
    base_url: 'https://api.anthropic.com/v1',
    model: 'claude-3-haiku-20240307',  // Use Haiku for cost efficiency
    max_tokens: 2000,
    temperature: 0.1
  }
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
```

**Step 2: Verify syntax**

Run: `node -c services/deep_investigation/constants.js`

Expected: No output (no syntax errors)

**Step 3: Commit**

```bash
git add services/deep_investigation/constants.js
git commit -m "feat: add deep investigation constants and configuration"
```

---

## Task 2: Create Rule-Based Checks

**Files:**
- Create: `services/deep_investigation/rule_checks.js`

**Step 1: Create the rule checks module**

```javascript
/**
 * Rule-Based Fraud Pattern Detection
 *
 * Identifies known fraud patterns WITHOUT calling any LLM.
 * Fast, free, deterministic.
 */

const {
  VIRTUAL_ADDRESS_KEYWORDS,
  TIMELINE_CLAIM_PATTERNS,
  SEVERITY
} = require('./constants');

/**
 * Extract years claimed from text
 */
function extractYearsClaimed(text) {
  if (!text) return null;

  const claims = [];
  const currentYear = new Date().getFullYear();

  for (const pattern of TIMELINE_CLAIM_PATTERNS) {
    const matches = text.matchAll(new RegExp(pattern, 'gi'));
    for (const match of matches) {
      const value = parseInt(match[1]);
      if (value > 1900 && value <= currentYear) {
        // It's a year
        claims.push({
          type: 'established_year',
          year: value,
          years_claimed: currentYear - value,
          raw: match[0]
        });
      } else if (value >= 1 && value <= 100) {
        // It's years of experience
        claims.push({
          type: 'years_experience',
          year: currentYear - value,
          years_claimed: value,
          raw: match[0]
        });
      }
    }
  }

  return claims.length > 0 ? claims : null;
}

/**
 * Check for virtual address indicators
 */
function checkVirtualAddress(address, rawData) {
  if (!address) return { isVirtual: false, confidence: 0, evidence: [] };

  const addressLower = address.toLowerCase();
  const evidence = [];
  let confidence = 0;

  // Check for suite in strip mall pattern
  if (/suite\s*#?\d+/i.test(address) || /ste\s*#?\d+/i.test(address)) {
    evidence.push('Address contains suite number');
    confidence += 0.2;
  }

  // Check for known virtual office keywords
  for (const keyword of VIRTUAL_ADDRESS_KEYWORDS) {
    if (addressLower.includes(keyword)) {
      evidence.push(`Contains virtual office keyword: "${keyword}"`);
      confidence += 0.4;
    }
  }

  // Check if raw data mentions mailbox at same address
  if (rawData) {
    const allText = JSON.stringify(rawData).toLowerCase();
    if (allText.includes('mailbox') || allText.includes('ups store') || allText.includes('postal')) {
      if (allText.includes(address.toLowerCase().split(',')[0])) {
        evidence.push('Search results mention mailbox service at this address');
        confidence += 0.5;
      }
    }
  }

  return {
    isVirtual: confidence >= 0.4,
    confidence: Math.min(confidence, 1.0),
    evidence
  };
}

/**
 * Check for timeline fabrication
 */
function checkTimelineFabrication(contractor, rawData) {
  const flags = [];

  // Extract BBB start date (authoritative anchor)
  let bbbStartYear = null;
  const bbbData = rawData?.find(r => r.source_name === 'bbb');
  if (bbbData?.structured_data) {
    const data = typeof bbbData.structured_data === 'string'
      ? JSON.parse(bbbData.structured_data)
      : bbbData.structured_data;
    if (data.years_in_business) {
      bbbStartYear = new Date().getFullYear() - parseInt(data.years_in_business);
    } else if (data.start_date) {
      bbbStartYear = parseInt(data.start_date.substring(0, 4));
    }
  }

  // Extract claims from website/Google
  let websiteClaims = [];
  const websiteData = rawData?.find(r => r.source_name === 'website' || r.source_name?.startsWith('google_maps'));
  if (websiteData?.raw_text) {
    const claims = extractYearsClaimed(websiteData.raw_text);
    if (claims) websiteClaims = claims;
  }

  // Compare claims vs BBB (if we have both)
  if (bbbStartYear && websiteClaims.length > 0) {
    const maxClaimedYears = Math.max(...websiteClaims.map(c => c.years_claimed));
    const claimedStartYear = new Date().getFullYear() - maxClaimedYears;
    const discrepancy = bbbStartYear - claimedStartYear;

    if (discrepancy > 10) {
      flags.push({
        severity: SEVERITY.CRITICAL,
        category: 'timeline_fabrication',
        description: `Claims ${maxClaimedYears} years in business (since ${claimedStartYear}), but BBB shows started ${bbbStartYear} (${discrepancy} year discrepancy)`,
        evidence: {
          bbb_start_year: bbbStartYear,
          claimed_start_year: claimedStartYear,
          discrepancy_years: discrepancy,
          raw_claims: websiteClaims
        }
      });
    } else if (discrepancy > 5) {
      flags.push({
        severity: SEVERITY.SEVERE,
        category: 'timeline_discrepancy',
        description: `Claims ${maxClaimedYears} years but BBB shows ${new Date().getFullYear() - bbbStartYear} years (${discrepancy} year gap)`,
        evidence: {
          bbb_start_year: bbbStartYear,
          claimed_start_year: claimedStartYear,
          discrepancy_years: discrepancy
        }
      });
    } else if (discrepancy > 2) {
      flags.push({
        severity: SEVERITY.MODERATE,
        category: 'timeline_minor_discrepancy',
        description: `Minor timeline discrepancy: claims ${maxClaimedYears} years, BBB shows ${new Date().getFullYear() - bbbStartYear} years`,
        evidence: {
          bbb_start_year: bbbStartYear,
          claimed_start_year: claimedStartYear,
          discrepancy_years: discrepancy
        }
      });
    }
  }

  return flags;
}

/**
 * Check for permit ground truth
 */
function checkPermitGroundTruth(contractor, rawData) {
  const flags = [];

  // Check if they claim high volume but have zero permits
  const buildzoomData = rawData?.find(r => r.source_name === 'buildzoom');
  const websiteData = rawData?.find(r => r.source_name === 'website');

  // Look for volume claims
  let claimsHighVolume = false;
  if (websiteData?.raw_text) {
    const text = websiteData.raw_text.toLowerCase();
    if (text.includes('hundreds of') || text.includes('thousands of') ||
        /\d{3,}\s*(projects?|homes?|customers?)/i.test(text)) {
      claimsHighVolume = true;
    }
  }

  // Check BuildZoom for permits
  let permitCount = 0;
  if (buildzoomData?.structured_data) {
    const data = typeof buildzoomData.structured_data === 'string'
      ? JSON.parse(buildzoomData.structured_data)
      : buildzoomData.structured_data;
    permitCount = data.permit_count || 0;
  }

  if (claimsHighVolume && permitCount === 0) {
    flags.push({
      severity: SEVERITY.SEVERE,
      category: 'permit_mismatch',
      description: 'Claims high project volume but zero permits found on BuildZoom',
      evidence: {
        claims_high_volume: true,
        permit_count: 0
      },
      suggested_queries: [
        `"${contractor.name}" site:buildzoom.com permits`,
        `"${contractor.name}" permits ${contractor.city}`,
        `"${contractor.name}" permits Texas`
      ]
    });
  }

  return flags;
}

/**
 * Check for zero independent reviews
 */
function checkReviewPresence(contractor, rawData) {
  const flags = [];

  const reviewSources = ['yelp', 'bbb', 'angi', 'houzz', 'trustpilot'];
  const sourcesWithReviews = [];
  const sourcesMissing = [];

  for (const sourceName of reviewSources) {
    const data = rawData?.find(r => r.source_name === sourceName || r.source_name?.includes(sourceName));
    if (data?.structured_data) {
      const parsed = typeof data.structured_data === 'string'
        ? JSON.parse(data.structured_data)
        : data.structured_data;
      if (parsed.found && (parsed.review_count > 0 || parsed.rating)) {
        sourcesWithReviews.push(sourceName);
      } else {
        sourcesMissing.push(sourceName);
      }
    } else {
      sourcesMissing.push(sourceName);
    }
  }

  if (sourcesWithReviews.length === 0 && sourcesMissing.length >= 3) {
    flags.push({
      severity: SEVERITY.SEVERE,
      category: 'zero_independent_reviews',
      description: `No independent reviews found on any platform (checked: ${reviewSources.join(', ')})`,
      evidence: {
        sources_checked: reviewSources,
        sources_with_reviews: sourcesWithReviews,
        sources_missing: sourcesMissing
      },
      suggested_queries: [
        `"${contractor.name}" reviews`,
        `"${contractor.name}" yelp`,
        `"${contractor.name}" site:reddit.com`
      ]
    });
  }

  return flags;
}

/**
 * Main rule check function
 */
async function runRuleChecks(contractor, rawData) {
  const results = {
    flags: [],
    suggested_queries: [],
    llm_trigger: false,
    summary: {}
  };

  // 1. Virtual address check
  const virtualCheck = checkVirtualAddress(contractor.address, rawData);
  results.summary.virtual_address = virtualCheck;
  if (virtualCheck.isVirtual) {
    results.flags.push({
      severity: virtualCheck.confidence >= 0.7 ? SEVERITY.CRITICAL : SEVERITY.SEVERE,
      category: 'virtual_address',
      description: `Address appears to be a virtual/mailbox location`,
      evidence: virtualCheck.evidence
    });
    results.suggested_queries.push(
      `"${contractor.address?.split(',')[0]}" "ups store" OR "mailbox" OR "postal"`,
      `"${contractor.address?.split(',')[0]}" site:yelp.com`
    );
  }

  // 2. Timeline fabrication check
  const timelineFlags = checkTimelineFabrication(contractor, rawData);
  results.flags.push(...timelineFlags);
  results.summary.timeline = { flags: timelineFlags.length, details: timelineFlags };

  // Add suggested queries for timeline issues
  if (timelineFlags.some(f => f.severity === SEVERITY.CRITICAL || f.severity === SEVERITY.SEVERE)) {
    results.suggested_queries.push(
      `"${contractor.name}" Texas Secretary of State`,
      `"${contractor.name}" formation date`,
      `"${contractor.name}" ${contractor.city} history`
    );
  }

  // 3. Permit ground truth check
  const permitFlags = checkPermitGroundTruth(contractor, rawData);
  results.flags.push(...permitFlags);
  results.summary.permits = { flags: permitFlags.length, details: permitFlags };

  // Add permit suggested queries
  for (const flag of permitFlags) {
    if (flag.suggested_queries) {
      results.suggested_queries.push(...flag.suggested_queries);
    }
  }

  // 4. Review presence check
  const reviewFlags = checkReviewPresence(contractor, rawData);
  results.flags.push(...reviewFlags);
  results.summary.reviews = { flags: reviewFlags.length, details: reviewFlags };

  // Add review suggested queries
  for (const flag of reviewFlags) {
    if (flag.suggested_queries) {
      results.suggested_queries.push(...flag.suggested_queries);
    }
  }

  // Deduplicate suggested queries
  results.suggested_queries = [...new Set(results.suggested_queries)];

  // Determine if LLM should be triggered
  const criticalCount = results.flags.filter(f => f.severity === SEVERITY.CRITICAL).length;
  const severeCount = results.flags.filter(f => f.severity === SEVERITY.SEVERE).length;

  results.llm_trigger = criticalCount > 0 || severeCount >= 2 || results.flags.length >= 3;

  return results;
}

module.exports = {
  runRuleChecks,
  checkVirtualAddress,
  checkTimelineFabrication,
  checkPermitGroundTruth,
  checkReviewPresence,
  extractYearsClaimed
};
```

**Step 2: Verify syntax**

Run: `node -c services/deep_investigation/rule_checks.js`

Expected: No output (no syntax errors)

**Step 3: Commit**

```bash
git add services/deep_investigation/rule_checks.js
git commit -m "feat: add rule-based fraud pattern detection"
```

---

## Task 3: Create Query Executor

**Files:**
- Create: `services/deep_investigation/query_executor.js`

**Step 1: Create the query executor module**

```javascript
/**
 * Query Executor
 *
 * Executes Serper API searches and stores results in contractor_raw_data.
 */

const { SERPER_CONFIG } = require('./constants');

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);

/**
 * Execute a single Serper search
 */
async function executeSerperQuery(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'No SERPER_API_KEY', query };
  }

  try {
    const response = await fetch(`${SERPER_CONFIG.BASE_URL}/search`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: query,
        num: SERPER_CONFIG.MAX_RESULTS
      })
    });

    if (!response.ok) {
      throw new Error(`Serper API error: ${response.status}`);
    }

    const data = await response.json();
    const results = data.organic || [];

    return {
      success: true,
      query,
      result_count: results.length,
      results: results.slice(0, 5).map(r => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet?.substring(0, 300)
      })),
      knowledge_graph: data.knowledgeGraph || null,
      answer_box: data.answerBox || null
    };
  } catch (err) {
    return { success: false, error: err.message, query };
  }
}

/**
 * Execute multiple queries with rate limiting
 */
async function executeQueries(queries, contractorId, db, iterationNumber) {
  const results = [];

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    log(`  [${i + 1}/${queries.length}] Searching: ${query.substring(0, 60)}...`);

    const result = await executeSerperQuery(query);
    results.push(result);

    // Store in database
    if (db && contractorId) {
      await storeQueryResult(db, contractorId, query, result, iterationNumber);
    }

    // Rate limiting
    if (i < queries.length - 1) {
      await new Promise(r => setTimeout(r, SERPER_CONFIG.RATE_LIMIT_MS));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const totalResults = results.reduce((sum, r) => sum + (r.result_count || 0), 0);

  success(`  Executed ${queries.length} queries: ${successCount} successful, ${totalResults} total results`);

  return results;
}

/**
 * Store query result in contractor_raw_data
 */
async function storeQueryResult(db, contractorId, query, result, iterationNumber) {
  const now = new Date().toISOString();
  const sourceName = `deep_investigation_${iterationNumber}`;
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  // Build raw text from results
  let rawText = `Query: ${query}\n\n`;
  if (result.results) {
    for (const r of result.results) {
      rawText += `Title: ${r.title}\nURL: ${r.link}\nSnippet: ${r.snippet}\n\n`;
    }
  }

  try {
    await db.run(`
      INSERT INTO contractor_raw_data
      (contractor_id, source_name, source_url, raw_text, structured_data, fetch_status, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (contractor_id, source_name)
      DO UPDATE SET
        source_url = EXCLUDED.source_url,
        raw_text = contractor_raw_data.raw_text || '\n---\n' || EXCLUDED.raw_text,
        structured_data = EXCLUDED.structured_data,
        fetch_status = EXCLUDED.fetch_status,
        fetched_at = EXCLUDED.fetched_at,
        expires_at = EXCLUDED.expires_at
    `, [
      contractorId,
      sourceName,
      `serper:${query.substring(0, 100)}`,
      rawText,
      JSON.stringify(result),
      result.success ? 'success' : 'error',
      now,
      expires
    ]);
  } catch (err) {
    warn(`  Failed to store query result: ${err.message}`);
  }
}

/**
 * Extract key findings from query results
 */
function extractFindings(queryResults) {
  const findings = {
    virtual_address_evidence: [],
    timeline_evidence: [],
    permit_evidence: [],
    review_evidence: [],
    news_mentions: [],
    other: []
  };

  for (const result of queryResults) {
    if (!result.success || !result.results) continue;

    for (const r of result.results) {
      const snippet = (r.snippet || '').toLowerCase();
      const title = (r.title || '').toLowerCase();

      // Categorize findings
      if (snippet.includes('mailbox') || snippet.includes('ups store') || snippet.includes('postal')) {
        findings.virtual_address_evidence.push({
          title: r.title,
          snippet: r.snippet,
          url: r.link
        });
      }

      if (snippet.includes('established') || snippet.includes('founded') || snippet.includes('since')) {
        findings.timeline_evidence.push({
          title: r.title,
          snippet: r.snippet,
          url: r.link
        });
      }

      if (snippet.includes('permit') || title.includes('buildzoom')) {
        findings.permit_evidence.push({
          title: r.title,
          snippet: r.snippet,
          url: r.link
        });
      }

      if (title.includes('review') || snippet.includes('rating') || snippet.includes('stars')) {
        findings.review_evidence.push({
          title: r.title,
          snippet: r.snippet,
          url: r.link
        });
      }

      if (snippet.includes('lawsuit') || snippet.includes('scam') || snippet.includes('complaint') ||
          snippet.includes('investigation') || snippet.includes('fraud')) {
        findings.news_mentions.push({
          title: r.title,
          snippet: r.snippet,
          url: r.link
        });
      }
    }
  }

  return findings;
}

module.exports = {
  executeSerperQuery,
  executeQueries,
  storeQueryResult,
  extractFindings
};
```

**Step 2: Verify syntax**

Run: `node -c services/deep_investigation/query_executor.js`

Expected: No output (no syntax errors)

**Step 3: Commit**

```bash
git add services/deep_investigation/query_executor.js
git commit -m "feat: add query executor for Serper API searches"
```

---

## Task 4: Create LLM Cascade

**Files:**
- Create: `services/deep_investigation/llm_cascade.js`

**Step 1: Create the LLM cascade module**

```javascript
/**
 * LLM Cascade
 *
 * Orchestrates multi-LLM analysis:
 * - DeepSeek: Initial gap analysis (cheap, good reasoning)
 * - Gemini: Structured output refinement (cheap, good at formatting)
 * - Claude: Nuanced judgment (expensive, only when needed)
 */

const { INVESTIGATION_MODE, LLM_CONFIG, THRESHOLDS, SEVERITY } = require('./constants');

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);

// ============ PROMPTS ============

const DEEPSEEK_GAP_ANALYSIS_PROMPT = `You are a forensic investigator analyzing contractor data for fraud indicators.

TASK: Identify knowledge gaps and generate targeted search queries.

CONTRACTOR: {{contractor_name}}
LOCATION: {{contractor_city}}, {{contractor_state}}

RULE-BASED FLAGS FOUND:
{{rule_flags}}

RAW DATA SUMMARY:
{{raw_data_summary}}

ANALYZE:
1. What discrepancies exist between claimed and verified information?
2. What critical information is missing?
3. What specific searches would help verify or disprove the flags?

OUTPUT JSON ONLY:
{
  "analysis": {
    "key_discrepancies": ["..."],
    "missing_information": ["..."],
    "suspicion_level": "high|medium|low"
  },
  "suggested_queries": [
    {"query": "search string", "rationale": "why this search helps"}
  ],
  "confidence": 0.0-1.0
}`;

const GEMINI_STRUCTURE_PROMPT = `You are a data analyst structuring investigation findings.

CONTRACTOR: {{contractor_name}}

DEEPSEEK ANALYSIS:
{{deepseek_output}}

QUERY RESULTS:
{{query_results}}

TASK: Structure the findings into actionable intelligence.

OUTPUT JSON ONLY:
{
  "confirmed_flags": [
    {"severity": "CRITICAL|SEVERE|MODERATE|LOW", "category": "...", "description": "...", "evidence": "..."}
  ],
  "unconfirmed_flags": [
    {"category": "...", "description": "...", "needs": "what would confirm this"}
  ],
  "verified_positives": ["..."],
  "additional_queries": [
    {"query": "...", "rationale": "...", "priority": "high|medium|low"}
  ],
  "confidence": 0.0-1.0,
  "recommendation": "continue_investigation|sufficient_data|escalate_to_human"
}`;

const CLAUDE_JUDGMENT_PROMPT = `You are a senior fraud analyst making final determinations.

CONTRACTOR: {{contractor_name}}
LOCATION: {{contractor_city}}, {{contractor_state}}

INVESTIGATION SUMMARY:
{{investigation_summary}}

TASK: Provide final judgment on fraud indicators.

Consider:
- Are the flags genuine red flags or explainable?
- Is there a pattern suggesting intentional deception?
- What is the risk level for a homeowner hiring this contractor?

OUTPUT JSON ONLY:
{
  "final_assessment": {
    "fraud_likelihood": "high|medium|low|negligible",
    "confidence": 0.0-1.0,
    "reasoning": "detailed explanation"
  },
  "critical_flags": [
    {"category": "...", "description": "...", "evidence": "...", "severity": "CRITICAL|SEVERE"}
  ],
  "mitigating_factors": ["..."],
  "recommendation": "avoid|caution|acceptable|recommended",
  "suggested_human_review_points": ["..."]
}`;

// ============ API CALLS ============

async function callDeepSeek(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('No DEEPSEEK_API_KEY');

  const response = await fetch(`${LLM_CONFIG.deepseek.base_url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: LLM_CONFIG.deepseek.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: LLM_CONFIG.deepseek.temperature,
      max_tokens: LLM_CONFIG.deepseek.max_tokens
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in DeepSeek response');

  return {
    result: JSON.parse(jsonMatch[0]),
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      cost: ((usage.prompt_tokens || 0) * 0.00000014) + ((usage.completion_tokens || 0) * 0.00000028)
    }
  };
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('No GEMINI_API_KEY');

  const response = await fetch(
    `${LLM_CONFIG.gemini.base_url}/${LLM_CONFIG.gemini.model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: LLM_CONFIG.gemini.temperature,
          maxOutputTokens: LLM_CONFIG.gemini.max_tokens
        }
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Estimate tokens (Gemini doesn't return usage in same format)
  const inputTokens = Math.ceil(prompt.length / 4);
  const outputTokens = Math.ceil(content.length / 4);

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Gemini response');

  return {
    result: JSON.parse(jsonMatch[0]),
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost: (inputTokens * 0.000000075) + (outputTokens * 0.0000003)  // Gemini Flash pricing
    }
  };
}

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No ANTHROPIC_API_KEY');

  const response = await fetch(`${LLM_CONFIG.claude.base_url}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: LLM_CONFIG.claude.model,
      max_tokens: LLM_CONFIG.claude.max_tokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude error: ${response.status} - ${text.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || '';
  const usage = data.usage || {};

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  return {
    result: JSON.parse(jsonMatch[0]),
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cost: ((usage.input_tokens || 0) * 0.00000025) + ((usage.output_tokens || 0) * 0.00000125)  // Haiku pricing
    }
  };
}

// ============ CASCADE ORCHESTRATION ============

/**
 * Run the LLM cascade based on investigation mode
 */
async function runLLMCascade(contractor, ruleCheckResults, rawData, queryResults, mode = INVESTIGATION_MODE) {
  const trace = {
    mode,
    steps: [],
    total_cost: 0,
    final_result: null
  };

  log(`\n  Running LLM cascade (mode: ${mode})...`);

  // Build data summaries for prompts
  const rawDataSummary = summarizeRawData(rawData);
  const ruleFlagsSummary = JSON.stringify(ruleCheckResults.flags, null, 2);
  const queryResultsSummary = summarizeQueryResults(queryResults);

  // ============ TIER 1: DeepSeek ============
  try {
    log('    Tier 1: DeepSeek gap analysis...');

    const deepseekPrompt = DEEPSEEK_GAP_ANALYSIS_PROMPT
      .replace('{{contractor_name}}', contractor.name)
      .replace('{{contractor_city}}', contractor.city)
      .replace('{{contractor_state}}', contractor.state)
      .replace('{{rule_flags}}', ruleFlagsSummary)
      .replace('{{raw_data_summary}}', rawDataSummary);

    const deepseekResponse = await callDeepSeek(deepseekPrompt);
    trace.steps.push({
      tier: 'deepseek',
      result: deepseekResponse.result,
      usage: deepseekResponse.usage
    });
    trace.total_cost += deepseekResponse.usage.cost;

    success(`      DeepSeek complete (confidence: ${deepseekResponse.result.confidence}, cost: $${deepseekResponse.usage.cost.toFixed(4)})`);

    // Check if we should stop here (minimal mode)
    if (mode === 'minimal') {
      trace.final_result = {
        source: 'deepseek',
        ...deepseekResponse.result
      };
      return trace;
    }

    // Check if we need to escalate
    const deepseekConfidence = deepseekResponse.result.confidence || 0;
    if (deepseekConfidence >= THRESHOLDS.ESCALATE_TO_GEMINI &&
        !ruleCheckResults.flags.some(f => f.severity === SEVERITY.CRITICAL)) {
      log('      DeepSeek confidence high, skipping Gemini...');
      trace.final_result = {
        source: 'deepseek',
        ...deepseekResponse.result
      };
      return trace;
    }

    // ============ TIER 2: Gemini ============
    log('    Tier 2: Gemini structuring...');

    const geminiPrompt = GEMINI_STRUCTURE_PROMPT
      .replace('{{contractor_name}}', contractor.name)
      .replace('{{deepseek_output}}', JSON.stringify(deepseekResponse.result, null, 2))
      .replace('{{query_results}}', queryResultsSummary);

    const geminiResponse = await callGemini(geminiPrompt);
    trace.steps.push({
      tier: 'gemini',
      result: geminiResponse.result,
      usage: geminiResponse.usage
    });
    trace.total_cost += geminiResponse.usage.cost;

    success(`      Gemini complete (confidence: ${geminiResponse.result.confidence}, cost: $${geminiResponse.usage.cost.toFixed(4)})`);

    // Check if we should stop here (standard mode)
    if (mode === 'standard') {
      trace.final_result = {
        source: 'gemini',
        deepseek_analysis: deepseekResponse.result,
        ...geminiResponse.result
      };
      return trace;
    }

    // Check if we need to escalate to Claude
    const geminiConfidence = geminiResponse.result.confidence || 0;
    const hasCriticalFlags = (geminiResponse.result.confirmed_flags || [])
      .some(f => f.severity === SEVERITY.CRITICAL);

    if (geminiConfidence >= THRESHOLDS.ESCALATE_TO_CLAUDE && !hasCriticalFlags) {
      log('      Gemini confidence sufficient, skipping Claude...');
      trace.final_result = {
        source: 'gemini',
        deepseek_analysis: deepseekResponse.result,
        ...geminiResponse.result
      };
      return trace;
    }

    // ============ TIER 3: Claude (full mode only) ============
    log('    Tier 3: Claude final judgment...');

    const investigationSummary = {
      rule_flags: ruleCheckResults.flags,
      deepseek_analysis: deepseekResponse.result,
      gemini_structure: geminiResponse.result,
      query_results_summary: queryResultsSummary
    };

    const claudePrompt = CLAUDE_JUDGMENT_PROMPT
      .replace('{{contractor_name}}', contractor.name)
      .replace('{{contractor_city}}', contractor.city)
      .replace('{{contractor_state}}', contractor.state)
      .replace('{{investigation_summary}}', JSON.stringify(investigationSummary, null, 2));

    const claudeResponse = await callClaude(claudePrompt);
    trace.steps.push({
      tier: 'claude',
      result: claudeResponse.result,
      usage: claudeResponse.usage
    });
    trace.total_cost += claudeResponse.usage.cost;

    success(`      Claude complete (cost: $${claudeResponse.usage.cost.toFixed(4)})`);

    trace.final_result = {
      source: 'claude',
      deepseek_analysis: deepseekResponse.result,
      gemini_structure: geminiResponse.result,
      ...claudeResponse.result
    };

    return trace;

  } catch (err) {
    warn(`    LLM cascade error: ${err.message}`);
    trace.error = err.message;
    return trace;
  }
}

// ============ HELPERS ============

function summarizeRawData(rawData) {
  if (!rawData || rawData.length === 0) return 'No raw data available';

  const summary = [];
  for (const row of rawData.slice(0, 10)) {
    const sourceName = row.source_name;
    let content = '';

    if (row.structured_data) {
      const data = typeof row.structured_data === 'string'
        ? JSON.parse(row.structured_data)
        : row.structured_data;
      content = JSON.stringify(data).substring(0, 500);
    } else if (row.raw_text) {
      content = row.raw_text.substring(0, 500);
    }

    summary.push(`[${sourceName}]: ${content}`);
  }

  return summary.join('\n\n');
}

function summarizeQueryResults(queryResults) {
  if (!queryResults || queryResults.length === 0) return 'No query results';

  const summary = [];
  for (const result of queryResults) {
    if (!result.success) continue;
    summary.push(`Query: ${result.query}`);
    for (const r of (result.results || [])) {
      summary.push(`  - ${r.title}: ${r.snippet?.substring(0, 150)}`);
    }
  }

  return summary.join('\n');
}

module.exports = {
  runLLMCascade,
  callDeepSeek,
  callGemini,
  callClaude
};
```

**Step 2: Verify syntax**

Run: `node -c services/deep_investigation/llm_cascade.js`

Expected: No output (no syntax errors)

**Step 3: Commit**

```bash
git add services/deep_investigation/llm_cascade.js
git commit -m "feat: add multi-LLM cascade (DeepSeek → Gemini → Claude)"
```

---

## Task 5: Create Main Index (Orchestrator)

**Files:**
- Create: `services/deep_investigation/index.js`

**Step 1: Create the main entry point**

```javascript
/**
 * Deep Investigation Framework - Main Entry Point
 *
 * Iterative investigation loop that catches fraud patterns by following leads.
 *
 * Usage:
 *   const { runDeepInvestigation } = require('./services/deep_investigation');
 *   const results = await runDeepInvestigation(contractorId, contractor, db, options);
 */

const { runRuleChecks } = require('./rule_checks');
const { executeQueries, extractFindings } = require('./query_executor');
const { runLLMCascade } = require('./llm_cascade');
const {
  INVESTIGATION_MODE,
  MAX_ITERATIONS,
  MAX_TIME_MS,
  MAX_QUERIES_PER_ITERATION,
  SEVERITY
} = require('./constants');

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

/**
 * Load raw data from database
 */
async function loadRawData(db, contractorId) {
  const rows = await db.exec(`
    SELECT source_name, raw_text, structured_data, fetch_status
    FROM contractor_raw_data
    WHERE contractor_id = ?
    ORDER BY source_name
  `, [contractorId]);

  return rows;
}

/**
 * Main deep investigation function
 */
async function runDeepInvestigation(contractorId, contractor, db, options = {}) {
  const mode = options.mode || INVESTIGATION_MODE;
  const maxIterations = options.maxIterations || MAX_ITERATIONS;
  const maxTimeMs = options.maxTimeMs || MAX_TIME_MS;

  const startTime = Date.now();

  console.log('\n' + '═'.repeat(60));
  console.log('  🔍 DEEP INVESTIGATION FRAMEWORK');
  console.log('═'.repeat(60));
  log(`  Contractor: ${contractor.name}`);
  log(`  Mode: ${mode}`);
  log(`  Max iterations: ${maxIterations}`);

  // Track investigation state
  const state = {
    iteration: 0,
    total_queries_executed: 0,
    total_cost: 0,
    all_flags: [],
    all_query_results: [],
    executed_queries: new Set(),
    llm_trace: null
  };

  // Load initial raw data
  let rawData = await loadRawData(db, contractorId);
  log(`  Initial data sources: ${rawData.length}`);

  // ============ ITERATION LOOP ============
  while (state.iteration < maxIterations) {
    state.iteration++;
    const elapsed = Date.now() - startTime;

    // Check time limit
    if (elapsed >= maxTimeMs) {
      warn(`  Time limit reached (${Math.round(elapsed / 1000)}s)`);
      break;
    }

    log(`\n--- Iteration ${state.iteration}/${maxIterations} ---`);

    // 1. Run rule-based checks
    log('  Running rule-based checks...');
    const ruleResults = await runRuleChecks(contractor, rawData);

    const newFlags = ruleResults.flags.filter(f =>
      !state.all_flags.some(existing =>
        existing.category === f.category && existing.description === f.description
      )
    );

    if (newFlags.length > 0) {
      state.all_flags.push(...newFlags);
      log(`    Found ${newFlags.length} new flags (total: ${state.all_flags.length})`);
      for (const flag of newFlags) {
        const color = flag.severity === SEVERITY.CRITICAL ? '\x1b[31m' :
                      flag.severity === SEVERITY.SEVERE ? '\x1b[33m' : '\x1b[0m';
        log(`    ${color}[${flag.severity}] ${flag.category}: ${flag.description}\x1b[0m`);
      }
    } else {
      log('    No new flags');
    }

    // 2. Collect suggested queries (dedup against already executed)
    const pendingQueries = ruleResults.suggested_queries
      .filter(q => !state.executed_queries.has(q))
      .slice(0, MAX_QUERIES_PER_ITERATION);

    // 3. Run LLM cascade if triggered
    if (ruleResults.llm_trigger || state.iteration === 1) {
      log('  LLM analysis triggered...');
      const llmTrace = await runLLMCascade(
        contractor,
        ruleResults,
        rawData,
        state.all_query_results,
        mode
      );
      state.llm_trace = llmTrace;
      state.total_cost += llmTrace.total_cost;

      // Add LLM-suggested queries
      if (llmTrace.final_result?.suggested_queries) {
        for (const sq of llmTrace.final_result.suggested_queries) {
          const query = sq.query || sq;
          if (!state.executed_queries.has(query) && pendingQueries.length < MAX_QUERIES_PER_ITERATION) {
            pendingQueries.push(query);
          }
        }
      }

      // Add additional queries from Gemini if available
      if (llmTrace.final_result?.additional_queries) {
        for (const aq of llmTrace.final_result.additional_queries) {
          const query = aq.query;
          if (query && !state.executed_queries.has(query) && pendingQueries.length < MAX_QUERIES_PER_ITERATION) {
            pendingQueries.push(query);
          }
        }
      }
    }

    // 4. Execute queries if any pending
    if (pendingQueries.length === 0) {
      log('  No new queries to execute - investigation complete');
      break;
    }

    log(`  Executing ${pendingQueries.length} queries...`);
    const queryResults = await executeQueries(pendingQueries, contractorId, db, state.iteration);

    // Track executed queries
    for (const q of pendingQueries) {
      state.executed_queries.add(q);
    }
    state.all_query_results.push(...queryResults);
    state.total_queries_executed += pendingQueries.length;

    // 5. Extract findings from query results
    const findings = extractFindings(queryResults);

    // Check if we found virtual address evidence
    if (findings.virtual_address_evidence.length > 0) {
      const existingVirtualFlag = state.all_flags.find(f => f.category === 'virtual_address');
      if (existingVirtualFlag) {
        existingVirtualFlag.evidence.search_results = findings.virtual_address_evidence;
        existingVirtualFlag.severity = SEVERITY.CRITICAL;
        log(`    Upgraded virtual_address flag to CRITICAL (found confirmation)`);
      }
    }

    // Check if we found news mentions (lawsuits, scams)
    if (findings.news_mentions.length > 0) {
      state.all_flags.push({
        severity: SEVERITY.SEVERE,
        category: 'negative_news',
        description: `Found ${findings.news_mentions.length} concerning news mentions`,
        evidence: findings.news_mentions
      });
    }

    // 6. Reload raw data for next iteration
    rawData = await loadRawData(db, contractorId);
  }

  // ============ FINAL REPORT ============
  const elapsed = Date.now() - startTime;

  console.log('\n' + '═'.repeat(60));
  console.log('  DEEP INVESTIGATION COMPLETE');
  console.log('═'.repeat(60));
  log(`  Iterations: ${state.iteration}`);
  log(`  Queries executed: ${state.total_queries_executed}`);
  log(`  Total flags: ${state.all_flags.length}`);
  log(`  LLM cost: $${state.total_cost.toFixed(4)}`);
  log(`  Time: ${Math.round(elapsed / 1000)}s`);

  // Categorize flags by severity
  const critical = state.all_flags.filter(f => f.severity === SEVERITY.CRITICAL);
  const severe = state.all_flags.filter(f => f.severity === SEVERITY.SEVERE);
  const moderate = state.all_flags.filter(f => f.severity === SEVERITY.MODERATE);

  if (critical.length > 0) {
    error(`\n  CRITICAL FLAGS (${critical.length}):`);
    for (const f of critical) {
      error(`    - ${f.category}: ${f.description}`);
    }
  }

  if (severe.length > 0) {
    warn(`\n  SEVERE FLAGS (${severe.length}):`);
    for (const f of severe) {
      warn(`    - ${f.category}: ${f.description}`);
    }
  }

  // Build final result
  const result = {
    contractor_id: contractorId,
    contractor_name: contractor.name,
    mode,
    iterations: state.iteration,
    queries_executed: state.total_queries_executed,
    elapsed_ms: elapsed,
    total_cost: state.total_cost,
    flags: state.all_flags,
    flags_by_severity: {
      critical: critical.length,
      severe: severe.length,
      moderate: moderate.length
    },
    llm_trace: state.llm_trace,
    recommendation: getRecommendation(state.all_flags)
  };

  // Store investigation results
  await storeInvestigationResults(db, contractorId, result);

  return result;
}

/**
 * Get recommendation based on flags
 */
function getRecommendation(flags) {
  const critical = flags.filter(f => f.severity === SEVERITY.CRITICAL).length;
  const severe = flags.filter(f => f.severity === SEVERITY.SEVERE).length;

  if (critical >= 1) return 'AVOID';
  if (severe >= 3) return 'AVOID';
  if (severe >= 1) return 'CAUTION';
  return 'PROCEED_TO_AUDIT';
}

/**
 * Store investigation results in database
 */
async function storeInvestigationResults(db, contractorId, result) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  try {
    await db.run(`
      INSERT INTO contractor_raw_data
      (contractor_id, source_name, source_url, raw_text, structured_data, fetch_status, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (contractor_id, source_name)
      DO UPDATE SET
        raw_text = EXCLUDED.raw_text,
        structured_data = EXCLUDED.structured_data,
        fetch_status = EXCLUDED.fetch_status,
        fetched_at = EXCLUDED.fetched_at,
        expires_at = EXCLUDED.expires_at
    `, [
      contractorId,
      'deep_investigation_summary',
      'internal',
      `Deep investigation completed in ${result.iterations} iterations. Found ${result.flags.length} flags. Recommendation: ${result.recommendation}`,
      JSON.stringify(result),
      'success',
      now,
      expires
    ]);

    success('  Investigation results stored');
  } catch (err) {
    warn(`  Failed to store investigation results: ${err.message}`);
  }
}

module.exports = {
  runDeepInvestigation,
  loadRawData
};
```

**Step 2: Verify syntax**

Run: `node -c services/deep_investigation/index.js`

Expected: No output (no syntax errors)

**Step 3: Commit**

```bash
git add services/deep_investigation/index.js
git commit -m "feat: add deep investigation main orchestrator"
```

---

## Task 6: Integrate into Orchestrator

**Files:**
- Modify: `services/orchestrator.js`

**Step 1: Add deep investigation import and option**

Find the imports section (around line 1-10) and add:

```javascript
const { runDeepInvestigation } = require('./deep_investigation');
```

**Step 2: Add --deep flag to runForensicAudit**

Find the options destructuring (around line 22) and update:

```javascript
const { dryRun = false, skipCollection = false, collectOnly = false, batchMode = false, skipLiens = false, mode = 'standard', deep = false, investigationMode = 'standard' } = options;
```

**Step 3: Add deep investigation before audit**

Find the section after collection (around line 155-190) where it creates the audit agent, and add BEFORE the agent creation:

```javascript
    // Run deep investigation if enabled
    let investigationResult = null;
    if (deep) {
      log('\n🔬 Running deep investigation...');
      investigationResult = await runDeepInvestigation(contractorId, contractor, db, {
        mode: investigationMode,
        maxIterations: 5,
        maxTimeMs: 180000
      });

      // Check if investigation recommends avoiding audit
      if (investigationResult.recommendation === 'AVOID') {
        warn('\n⚠️  Deep investigation found critical issues - flagging for review');
      }
    }
```

**Step 4: Pass investigation flags to audit agent**

Update the audit agent section to pass investigation results (modify the existing agent creation code around line 192-198):

```javascript
    // Run agentic audit
    let agent;
    if (mode === 'dialectic') {
      log('\n🎭 Using DIALECTIC mode (three-persona analysis)');
      agent = new DialecticAuditAgent(db, contractorId, contractor);
    } else {
      agent = new AuditAgent(db, contractorId, contractor);
    }

    // Attach investigation results if available
    if (investigationResult) {
      agent.investigationFlags = investigationResult.flags;
      agent.investigationRecommendation = investigationResult.recommendation;
    }

    const result = await agent.run();
```

**Step 5: Verify syntax**

Run: `node -c services/orchestrator.js`

Expected: No output (no syntax errors)

**Step 6: Commit**

```bash
git add services/orchestrator.js
git commit -m "feat: integrate deep investigation into audit orchestrator"
```

---

## Task 7: Update CLI to Support --deep Flag

**Files:**
- Modify: `bin/run_audit.js`

**Step 1: Add --deep flag parsing**

Find the argument parsing section and add:

```javascript
// Add after existing arg parsing (around line 15-30)
const deepMode = args.includes('--deep');
const investigationMode = args.includes('--investigation-mode')
  ? args[args.indexOf('--investigation-mode') + 1]
  : 'standard';
```

**Step 2: Pass deep options to runForensicAudit**

Find where runForensicAudit is called and update the options:

```javascript
const result = await runForensicAudit(
  contractorInput,
  {
    dryRun,
    skipCollection,
    collectOnly,
    mode,
    deep: deepMode,
    investigationMode
  }
);
```

**Step 3: Update usage message**

Add to the usage/help section:

```javascript
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node bin/run_audit.js [options]

Options:
  --id <id>              Contractor ID to audit
  --name <name>          Contractor name (will search/create)
  --city <city>          City (default: Dallas)
  --state <state>        State (default: TX)
  --mode <mode>          Audit mode: standard|dialectic (default: standard)
  --deep                 Enable deep investigation (iterative fraud detection)
  --investigation-mode   Deep investigation mode: minimal|standard|full (default: standard)
  --skip-collection      Skip data collection (use cached)
  --collect-only         Only collect data, don't audit
  --dry-run              Don't save results

Examples:
  node bin/run_audit.js --id 1524
  node bin/run_audit.js --id 1524 --deep
  node bin/run_audit.js --id 1524 --deep --investigation-mode full
  node bin/run_audit.js --name "Hercules Roof Systems" --city "Frisco" --deep
`);
  process.exit(0);
}
```

**Step 4: Verify syntax**

Run: `node -c bin/run_audit.js`

Expected: No output (no syntax errors)

**Step 5: Commit**

```bash
git add bin/run_audit.js
git commit -m "feat: add --deep flag to CLI for deep investigation mode"
```

---

## Task 8: Integration Test

**Step 1: Test on known-fraud contractor (if Hercules exists)**

Run:
```bash
cd /home/astre/command-center/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
node bin/run_audit.js --id 1524 --deep --investigation-mode minimal
```

Expected:
- Deep investigation runs
- Rule checks identify timeline/address issues
- Serper queries executed
- Flags categorized by severity
- Results stored in contractor_raw_data

**Step 2: Test on known-good contractor**

Run:
```bash
node bin/run_audit.js --id 123 --deep --investigation-mode minimal
```

Expected:
- Deep investigation runs
- Fewer or no critical flags
- Recommendation: PROCEED_TO_AUDIT

**Step 3: Verify database storage**

Run:
```bash
psql contractors_dev -c "
SELECT source_name, fetch_status,
       LENGTH(raw_text) as text_len,
       structured_data->>'recommendation' as recommendation
FROM contractor_raw_data
WHERE contractor_id = 1524 AND source_name LIKE 'deep_investigation%'
ORDER BY source_name;
"
```

Expected: Rows showing deep_investigation_summary and iteration data

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete deep investigation framework implementation"
```

---

## Summary

| Task | Files | Purpose |
|------|-------|---------|
| 1 | `services/deep_investigation/constants.js` | Configuration and thresholds |
| 2 | `services/deep_investigation/rule_checks.js` | Known fraud pattern detection |
| 3 | `services/deep_investigation/query_executor.js` | Serper API execution |
| 4 | `services/deep_investigation/llm_cascade.js` | Multi-LLM orchestration |
| 5 | `services/deep_investigation/index.js` | Main entry point |
| 6 | `services/orchestrator.js` | Integration with audit flow |
| 7 | `bin/run_audit.js` | CLI --deep flag support |
| 8 | Integration test | Verify end-to-end |

**Usage:**
```bash
# Standard audit (no deep investigation)
node bin/run_audit.js --id 1524

# With deep investigation (minimal - DeepSeek only)
node bin/run_audit.js --id 1524 --deep --investigation-mode minimal

# With deep investigation (standard - DeepSeek + Gemini)
node bin/run_audit.js --id 1524 --deep --investigation-mode standard

# With deep investigation (full - all LLMs including Claude)
node bin/run_audit.js --id 1524 --deep --investigation-mode full
```

**Expected fraud patterns detected:**
- Timeline fabrication (BBB start date vs website claims)
- Virtual mailbox addresses
- Zero independent reviews
- Permit volume mismatches
