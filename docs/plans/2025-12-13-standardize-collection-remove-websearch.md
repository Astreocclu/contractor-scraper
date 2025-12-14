# Plan: Standardize Collection Sources & Remove DeepSeek Web Search

**Date:** 2025-12-13
**Confidence:** Claude 90%
**Status:** Ready for review

---

## Problem Statement

The current audit system has two issues:

1. **Non-standardized data collection** - DeepSeek can request arbitrary sources via `request_collection()`, leading to inconsistent audits
2. **Ad-hoc web search capability** - Both V1 (`search_web`) and V2 (`investigate`) agents can run arbitrary Google searches, causing:
   - Scoring variance between runs
   - Non-reproducible audits
   - Potential cost issues (browser automation for each search)
   - Agent may search for irrelevant or biased information

---

## Current Architecture

### V1 Agent (`services/audit_agent.js`) - 4 Tools

| Tool | Description | Problem |
|------|-------------|---------|
| `get_stored_data()` | Get pre-collected data | OK |
| `request_collection(source)` | Request from 18 predefined sources | Non-standard - agent decides what to collect |
| `search_web(query)` | Arbitrary Google search | **REMOVE** - agent can search anything |
| `finalize_score()` | Commit score | OK |

### V2 Agent (`services/audit_agent_v2.js`) - 1 Tool

| Tool | Description | Problem |
|------|-------------|---------|
| `investigate(query, reason)` | Arbitrary Google search | **REMOVE** - agent can search anything |

### Collection Sources Available

```javascript
// From audit_agent.js request_collection enum
['bbb', 'yelp', 'yelp_yahoo', 'google_maps', 'angi', 'trustpilot',
 'houzz', 'court_records', 'google_news', 'reddit', 'glassdoor',
 'indeed', 'osha', 'epa_echo', 'tx_franchise', 'porch',
 'buildzoom', 'homeadvisor']
```

---

## Proposed Solution

### Goal 1: Standardize Collection Sources

Create a **Standard Collection Profile** that defines exactly what gets collected for every audit. No agent discretion.

```javascript
// services/collection_profile.js
const STANDARD_COLLECTION_PROFILE = {
  // ALWAYS collect these (required for scoring)
  required: [
    'google_maps',      // Primary review source
    'bbb',              // Business credibility + complaints
    'yelp_yahoo',       // Secondary reviews (via Yahoo workaround)
    'angi',             // Home services reviews
    'tx_franchise',     // Texas business registration
  ],

  // Collect if contractor has website
  withWebsite: [
    'trustpilot',       // Domain-based lookup
    'houzz',            // Home services portfolio
  ],

  // Always collect for red flag detection
  investigation: [
    'court_records',    // Lawsuits, judgments
    'county_liens',     // Financial distress signals
    'google_news',      // News investigations
  ],

  // Optional (collect if time/cost allows)
  optional: [
    'glassdoor',        // Employee reviews
    'reddit',           // Community complaints
  ]
};
```

### Goal 2: Remove Web Search from DeepSeek

Make DeepSeek a **pure analysis engine** - it receives all data upfront and produces a score. No web access.

**V1 Changes:**
- Remove `search_web` tool from TOOLS array
- Remove `toolSearchWeb()` method
- Update system prompt to remove search_web references
- Keep `request_collection` BUT only allow sources in standard profile

**V2 Changes:**
- Remove `investigate` tool entirely
- Set `TOOLS = []` (no tools at all)
- Update system prompt to remove investigate references
- Agent becomes purely analytical

---

## Implementation Plan

### Phase 1: Create Collection Profile Module

**File:** `services/collection_profile.js` (NEW)

```javascript
/**
 * Standard Collection Profile
 *
 * Defines exactly what data sources are collected for every audit.
 * Removes agent discretion - ensures consistent, reproducible audits.
 */

const STANDARD_PROFILE = {
  required: ['google_maps', 'bbb', 'yelp_yahoo', 'angi', 'tx_franchise'],
  withWebsite: ['trustpilot', 'houzz'],
  investigation: ['court_records', 'county_liens', 'google_news'],
  optional: ['glassdoor', 'reddit']
};

/**
 * Get sources to collect for a contractor
 * @param {Object} contractor - Contractor object with website field
 * @param {Object} options - { includeOptional: boolean }
 */
function getSourcesForContractor(contractor, options = {}) {
  const sources = [...STANDARD_PROFILE.required, ...STANDARD_PROFILE.investigation];

  if (contractor.website) {
    sources.push(...STANDARD_PROFILE.withWebsite);
  }

  if (options.includeOptional) {
    sources.push(...STANDARD_PROFILE.optional);
  }

  return [...new Set(sources)]; // Dedupe
}

/**
 * Check if a source is allowed
 */
function isSourceAllowed(source) {
  const allSources = [
    ...STANDARD_PROFILE.required,
    ...STANDARD_PROFILE.withWebsite,
    ...STANDARD_PROFILE.investigation,
    ...STANDARD_PROFILE.optional
  ];
  return allSources.includes(source);
}

module.exports = {
  STANDARD_PROFILE,
  getSourcesForContractor,
  isSourceAllowed
};
```

**Verification:**
```bash
cd /home/reid/testhome/contractor-auditor
node -e "const p = require('./services/collection_profile'); console.log(p.getSourcesForContractor({website: 'http://example.com'}))"
# Expected: ['google_maps', 'bbb', 'yelp_yahoo', 'angi', 'tx_franchise', 'court_records', 'county_liens', 'google_news', 'trustpilot', 'houzz']
```

---

### Phase 2: Remove search_web from V1 Agent

**File:** `services/audit_agent.js`

**Step 2.1: Remove search_web from TOOLS array (lines 46-62)**

```javascript
// REMOVE this entire tool definition:
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
```

**Step 2.2: Remove toolSearchWeb method (lines 458-473)**

```javascript
// REMOVE this entire method:
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
```

**Step 2.3: Remove search_web case from executeTool switch (lines 357-358)**

```javascript
// REMOVE this case:
case 'search_web':
  return await this.toolSearchWeb(args.query);
```

**Step 2.4: Update SYSTEM_PROMPT (line 132)**

Change:
```
4. If you need to verify specific claims, call search_web()
```

To:
```
4. Work with the data you have - all relevant sources have been pre-collected
```

**Step 2.5: Restrict request_collection to allowed sources**

In `toolRequestCollection` method, add validation:

```javascript
async toolRequestCollection(source, reason) {
  const collectionProfile = require('./collection_profile');

  // Validate source is in standard profile
  if (!collectionProfile.isSourceAllowed(source)) {
    return {
      error: `Source '${source}' is not in standard collection profile`,
      allowed_sources: Object.values(collectionProfile.STANDARD_PROFILE).flat()
    };
  }

  // ... rest of existing code
}
```

**Verification:**
```bash
cd /home/reid/testhome/contractor-auditor
grep -n "search_web" services/audit_agent.js
# Expected: No matches

node -e "const {AuditAgent} = require('./services/audit_agent'); const tools = require('./services/audit_agent').TOOLS || []; console.log(tools.map(t => t.function.name))"
# Expected: ['get_stored_data', 'request_collection', 'finalize_score']
```

---

### Phase 3: Remove investigate from V2 Agent

**File:** `services/audit_agent_v2.js`

**Step 3.1: Remove TOOLS array entirely (lines 14-37)**

Replace:
```javascript
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'investigate',
      // ...
    }
  }
];
```

With:
```javascript
// No tools - V2 is a pure analysis engine
const TOOLS = [];
```

**Step 3.2: Remove executeInvestigate method (lines 342-375)**

```javascript
// REMOVE this entire method:
async executeInvestigate(toolCall) {
  // ...
}
```

**Step 3.3: Remove investigate handling from run() loop (lines 293-305)**

Remove or simplify:
```javascript
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
}
```

Since no tools exist, this block can be removed entirely.

**Step 3.4: Update SYSTEM_PROMPT - Remove investigate section (lines 111-117)**

Remove:
```
## WHEN TO USE investigate()
Only when you see something suspicious that needs deeper digging:
- News article mentions lawsuit but no details
- Claims "15 years experience" but BBB shows formed 2022
- Name appears in complaint database
- Review Analyzer flagged DISTRUST_REVIEWS and you want to verify specific claims
```

Replace with:
```
## DATA COMPLETENESS
All relevant data has been pre-collected. Work with what you have.
If critical data is missing, note it in the "gaps" field but DO NOT reduce score for missing data.
```

**Step 3.5: Remove searchFn from constructor and run()**

The `searchFn` parameter and `this.searchFn` are no longer needed.

**Verification:**
```bash
cd /home/reid/testhome/contractor-auditor
grep -n "investigate" services/audit_agent_v2.js
# Expected: No matches (or only in comments)

grep -n "searchFn" services/audit_agent_v2.js
# Expected: No matches
```

---

### Phase 4: Update Orchestrator

**File:** `services/orchestrator.js`

The orchestrator needs to:
1. Use the new collection profile to determine what sources to collect
2. Stop passing `searchFn` to V2 agent

**Step 4.1: Import collection profile**

```javascript
const collectionProfile = require('./collection_profile');
```

**Step 4.2: Update collection logic**

Find where sources are collected and replace with:

```javascript
// Get standard sources for this contractor
const sourcesToCollect = collectionProfile.getSourcesForContractor(contractor, {
  includeOptional: options.includeOptional || false
});

// Collect all standard sources
for (const source of sourcesToCollect) {
  await collectionService.fetchSpecificSource(contractorId, contractor, source, 'standard profile');
}
```

**Step 4.3: Remove searchFn from V2 agent call**

Find where V2 agent is instantiated and remove the searchFn:

Before:
```javascript
const agent = new AuditAgentV2(db, contractorId, contractor);
const result = await agent.run(collectionService.searchWeb.bind(collectionService));
```

After:
```javascript
const agent = new AuditAgentV2(db, contractorId, contractor);
const result = await agent.run();
```

---

### Phase 5: Update CLI (run_audit.js)

Add `--include-optional` flag to include optional sources:

```javascript
if (['dry-run', 'skip-collection', 'collect-only', 'list', 'help', 'strict', 'include-optional'].includes(name)) return true;
```

And in help:
```
--include-optional  Include optional sources (glassdoor, reddit)
```

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Agent needs info not in standard profile | Medium | Low | Add to profile if recurring; standard profile covers 95%+ cases |
| Edge cases where search would help | Low | Medium | Log gaps in audit; manual review flag |
| Breaking existing workflows | Low | High | V1 still has request_collection (validated); V2 already minimal |
| Scoring variance persists | High | Medium | This change reduces one source of variance; agent LLM is still non-deterministic |

---

## Testing Plan

### Test 1: Standard Collection

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a

# Run audit with standard profile
node run_audit.js --id 26 2>&1 | tee /tmp/test_standard.log

# Verify no search_web or investigate calls in log
grep -i "search_web\|investigate\|Web search" /tmp/test_standard.log
# Expected: No matches
```

### Test 2: V1 Agent - request_collection validation

```bash
# This should fail - 'random_source' is not in profile
node -e "
const {AuditAgent} = require('./services/audit_agent');
// Simulate calling with invalid source
console.log('Test: Invalid source should be rejected');
"
```

### Test 3: V2 Agent - No tools

```bash
# Verify V2 has no tools
node -e "
const code = require('fs').readFileSync('./services/audit_agent_v2.js', 'utf8');
const match = code.match(/const TOOLS = \[([\s\S]*?)\];/);
console.log('TOOLS content:', match ? match[1].trim() : 'empty');
"
# Expected: "TOOLS content: empty" or "TOOLS content: "
```

### Test 4: Compare Before/After Variance

Run same contractor 3 times before and after changes, compare score variance.

---

## Rollback Plan

If issues arise:
1. Git revert the commits
2. Original files preserved in git history
3. No database schema changes - pure code changes

---

## Summary of Changes

| File | Changes |
|------|---------|
| `services/collection_profile.js` | NEW - Standard collection profile |
| `services/audit_agent.js` | Remove search_web tool, method, and prompt references |
| `services/audit_agent_v2.js` | Remove investigate tool, TOOLS=[], remove searchFn |
| `services/orchestrator.js` | Use collection profile, remove searchFn passing |
| `run_audit.js` | Add --include-optional flag |

**Lines of code changed:** ~150 removed, ~50 added
**Risk level:** Low-Medium
**Estimated implementation time:** 1-2 hours
