# DeepSeek Logic Analysis for Contractor Audit System

## Executive Summary

This document provides a comprehensive analysis of all DeepSeek API calls in the contractor audit system. **No reasoning mode is enabled anywhere** - all calls use `deepseek-chat` with `temperature: 0.1`.

---

## Quick Reference: Is Reasoning Enabled?

| File | Model Used | Reasoning Enabled? |
|------|------------|-------------------|
| `services/audit_agent_v2.js` | `deepseek-chat` | NO |
| `services/audit_agent.js` | `deepseek-chat` | NO |
| `services/review_analyzer.js` | `deepseek-chat` | NO |
| `forensic_audit_puppeteer.js` | `deepseek-chat` | NO |
| `scrape_emails_deepseek.js` | `deepseek-chat` | NO |

**Note:** The code uses `reasoning_trace` and `reasoning` as variable names, but these are for **storing the model's explanations**, not for enabling DeepSeek's reasoning mode (deepseek-reasoner/R1).

---

## 1. Fake Review Detection Logic

### Where It Lives
- **Primary**: `services/review_analyzer.js` (dedicated module)
- **Secondary**: Prompts in `services/audit_agent_v2.js` and `services/audit_agent.js`

### 1.1 AI-Based Analysis (`review_analyzer.js`)

#### API Call
```javascript
const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
  },
  body: JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: ANALYSIS_PROMPT },
      { role: 'user', content: context }
    ],
    temperature: 0.1,
    max_tokens: 1500
  })
});
```

#### System Prompt (ANALYSIS_PROMPT)
```
You are a review fraud analyst. Analyze these contractor reviews for signs of manipulation.

CHECK FOR:
1. **Fake Review Patterns**
   - Generic language ("Great service!", "Highly recommend!")
   - Timing clusters (many reviews in short period)
   - Similar writing style across reviews
   - Reviewer has only 1 review (shill accounts)
   - Overly detailed 5-star vs vague complaints

2. **Rating Manipulation**
   - Platform discrepancy (4.8 Google vs 2.1 Yelp = red flag)
   - Rating doesn't match review text sentiment
   - Sudden rating jumps after bad press

3. **Legitimate Complaint Patterns**
   - Same issue mentioned by multiple reviewers
   - Specific details (names, dates, amounts)
   - Company response patterns (defensive vs helpful)

4. **Red Flags**
   - Mentions of: deposits taken, work not completed, damage, ghosting
   - Legal threats in responses
   - Owner arguing with reviewers

OUTPUT FORMAT (JSON only):
{
  "fake_review_score": <0-100, higher = more likely fake>,
  "confidence": "<HIGH|MEDIUM|LOW>",
  "platform_ratings": {"google": 4.8, "yelp": null, "bbb": "F", "glassdoor": 3.2},
  "discrepancy_detected": <true|false>,
  "discrepancy_explanation": "<why ratings don't match>",
  "complaint_patterns": ["<pattern 1>", "<pattern 2>"],
  "fake_signals": ["<signal 1>", "<signal 2>"],
  "legitimate_signals": ["<signal 1>"],
  "summary": "<2-3 sentence summary for audit agent>",
  "recommendation": "<TRUST_REVIEWS|VERIFY_REVIEWS|DISTRUST_REVIEWS>"
}
```

### 1.2 Rule-Based Fallback (`quickDiscrepancyCheck`)

When API is unavailable, uses simple rules:

```javascript
function quickDiscrepancyCheck(reviewData) {
  const ratings = [];

  // Collect ratings from multiple platforms
  if (reviewData.google_maps?.rating) ratings.push({ source: 'google', rating: reviewData.google_maps.rating });
  if (reviewData.glassdoor?.rating) ratings.push({ source: 'glassdoor', rating: reviewData.glassdoor.rating });
  if (reviewData.bbb?.rating) {
    // Convert BBB letter to number
    const bbbScores = { 'A+': 5, 'A': 4.5, 'A-': 4, 'B+': 3.5, 'B': 3, 'B-': 2.5, 'C+': 2, 'C': 1.5, 'C-': 1, 'D': 0.5, 'F': 0 };
    const score = bbbScores[reviewData.bbb.rating];
    if (score !== undefined) ratings.push({ source: 'bbb', rating: score, original: reviewData.bbb.rating });
  }

  // Calculate max difference between platforms
  const values = ratings.map(r => r.rating);
  const maxDiff = Math.max(...values) - Math.min(...values);

  const result = {
    discrepancy: maxDiff > 1.5,  // Flag if >1.5 star difference
    max_difference: maxDiff,
    ratings: ratings,
    flags: []
  };

  // CRITICAL: BBB F + high Google = likely fake reviews
  if (reviewData.bbb?.rating === 'F' && reviewData.google_maps?.rating >= 4.5) {
    result.flags.push('CRITICAL: BBB F rating vs high Google rating - likely fake reviews or complaint suppression');
  }

  // Employee vs customer rating discrepancy
  if (reviewData.glassdoor?.rating && reviewData.google_maps?.rating) {
    const diff = reviewData.google_maps.rating - reviewData.glassdoor.rating;
    if (diff > 1.5) {
      result.flags.push(`Employee rating (${reviewData.glassdoor.rating}) much lower than customer rating (${reviewData.google_maps.rating}) - potential internal issues`);
    }
  }

  return result;
}
```

---

## 2. Audit Agent V2 (`services/audit_agent_v2.js`)

### Purpose
Simplified audit agent that receives all collected data upfront and can investigate suspicious findings.

### API Configuration
```javascript
const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

async callDeepSeek(messages) {
  const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',     // NOT deepseek-reasoner
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.1,            // Low temperature for consistency
      max_tokens: 4000
    })
  });
  return response.json();
}
```

### Tool Definition (Function Calling)
```javascript
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'investigate',
      description: 'Run an ad-hoc web search to investigate suspicious claims or verify specific information.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (e.g., "Company Name lawsuit 2024")'
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
```

### System Prompt (SYSTEM_PROMPT)
```
You are a forensic investigator. Your job: protect homeowners from fraud.

INVESTIGATE this contractor. Look at ALL the data collected.

Ask yourself:
1. What do they CLAIM? (years in business, reviews, quality, licensing)
2. What does the EVIDENCE show? (BBB records, court cases, news, actual reviews)
3. Do claims match evidence?
4. What's the STORY here?

## CHECK FOR
- Fake review patterns (timing clusters, generic language, platform conflicts like 4.8 Google vs 2.1 Yelp)
- Lawsuits, judgments, liens (check all court data)
- News investigations (local news, CBS, ABC investigations are CRITICAL)
- BBB complaints and rating (pattern of complaints = problem)
- Victim reports (Reddit, Nextdoor, consumer forums)
- Business registration issues (franchise tax problems, SOS status)

## TEXAS LICENSING - IMPORTANT
In Texas, these trades do NOT require state TDLR licensing:
- Pool builders, pool contractors
- Patio covers, pergolas, outdoor structures
- Fence installers
- Screen enclosures, sunrooms
- General construction

TDLR licenses ARE required for: HVAC, electricians, plumbers, irrigators.
Do NOT flag "no TDLR license" as a red flag for pool/patio/fence contractors.

## SCORING - Trust your judgment
Score 0-100 based on what you find:

0-15 (CRITICAL/AVOID): Known fraudster, news investigation, pattern of victims, active lawsuits for fraud
15-35 (SEVERE/AVOID): Serious red flags, multiple complaints of same issue, license problems
40-60 (MODERATE/CAUTION): Mixed signals, some concerns, needs verification
60-75 (LOW/VERIFY): Solid contractor with minor issues, mostly positive
75-90 (TRUSTED/RECOMMENDED): Good track record, verified, minor gaps
90-100 (TRUSTED/RECOMMENDED): Squeaky clean, everything verified, years of positive history

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
```

### Score Enforcement Logic (Post-Processing)
The agent's score is constrained based on red flag severity:

```javascript
function enforceScoreMultipliers(auditResult) {
  const flags = auditResult.red_flags || [];

  const hasCritical = flags.some(f => f.severity === 'CRITICAL');
  const hasSevere = flags.some(f => f.severity === 'SEVERE' || f.severity === 'HIGH');
  const hasModerate = flags.some(f => f.severity === 'MODERATE' || f.severity === 'MEDIUM');

  let maxScore;
  if (hasCritical) {
    maxScore = 15;      // Score capped at 15 for CRITICAL flags
  } else if (hasSevere) {
    maxScore = 35;      // Score capped at 35 for SEVERE/HIGH flags
  } else if (hasModerate) {
    maxScore = 60;      // Score capped at 60 for MODERATE/MEDIUM flags
  } else {
    maxScore = 100;     // No cap
  }

  // Override AI's score if it exceeds ceiling
  const enforcedScore = Math.min(maxScore, auditResult.trust_score);

  if (enforcedScore !== auditResult.trust_score) {
    console.log(`Score override: ${auditResult.trust_score} → ${enforcedScore}`);
  }

  auditResult.trust_score = enforcedScore;
  return auditResult;
}
```

---

## 3. Audit Agent V1 (`services/audit_agent.js`)

### Purpose
Original agentic audit with discovery tools - can request more data during audit.

### API Configuration
```javascript
async callDeepSeek() {
  const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',     // NOT deepseek-reasoner
      messages: this.messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.1,
      max_tokens: 4000
    })
  });
  return response.json();
}
```

### Available Tools (4 total)
```javascript
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_stored_data',
      description: 'Get all collected data for this contractor from the database.'
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_collection',
      description: 'Request additional data collection for a specific source.',
      parameters: {
        properties: {
          source: {
            type: 'string',
            enum: ['tdlr', 'bbb', 'yelp', 'google_maps', 'court_records', 'google_news',
                   'reddit', 'glassdoor', 'indeed', 'osha', 'epa_echo', 'tx_franchise',
                   'porch', 'buildzoom', 'homeadvisor']
          },
          reason: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Run an ad-hoc web search for specific information.'
    }
  },
  {
    type: 'function',
    function: {
      name: 'finalize_score',
      description: 'Commit the final Trust Score and audit results.'
    }
  }
];
```

### Scoring Methodology (from prompt)
```
SCORING METHODOLOGY (base 60 points, normalize to 100):
- Verification (15 pts): License status, permit history vs claims
- Reputation (15 pts): Cross-platform ratings, review authenticity, complaint patterns
- Credibility (10 pts): Years in business, portfolio consistency, professional affiliations
- Financial (10 pts): Liens, bankruptcy signals, payment complaint patterns
- Red Flag Absence (10 pts): No critical issues found

MULTIPLIERS:
- CRITICAL red flag (fraud, active lawsuit, license revoked) → ×0 (auto-fail, score 0-15)
- SEVERE red flag (BBB F, major complaint pattern) → ×0.3 (score 15-35)
- MODERATE red flags only (inconsistencies, missing data) → ×0.7 (score 40-60)
- MINOR red flags only (small issues) → ×0.9 (score 60-75)
- No red flags → ×1.0 (score 75-100)
```

---

## 4. Forensic Audit (`forensic_audit_puppeteer.js`)

### Purpose
Original single-pass audit - scrapes data and extracts with one DeepSeek call.

### API Configuration
```javascript
const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
  },
  body: JSON.stringify({
    model: DEEPSEEK_MODEL,        // 'deepseek-chat'
    messages: [
      {
        role: 'system',
        content: 'You are a forensic data analyst specializing in contractor verification. Extract structured data from HTML and identify red flags. Return only valid JSON, never markdown code blocks.'
      },
      {
        role: 'user',
        content: fullPrompt        // Contains HTML + extraction template
      }
    ],
    temperature: 0.1,
    max_tokens: 4000
  })
});
```

### Red Flag Detection Rules (embedded in prompt)
```
RED FLAG DETECTION RULES (apply these strictly):

=== CRITICAL (automatic fail, score 0-20) ===
- TDLR/license revoked or suspended
- Active fraud investigation in news
- Bankruptcy filed within 24 months
- OSHA willful violations
- EPA significant violations
- Court judgments for fraud/theft

=== HIGH SEVERITY (major concern, score cap 40) ===
- TDLR license expired > 90 days
- 3+ civil judgments against the company
- Multiple OSHA serious violations
- News investigations (non-fraud but serious)
- BBB grade F with pattern of unresolved complaints
- Multiple platforms showing deposit/abandonment complaints

=== MEDIUM SEVERITY (notable concern) ===
- No TDLR license found (for licensed trades like HVAC, electrical, plumbing)
- Reddit complaint patterns (3+ negative threads)
- YouTube complaint videos exist with details
- Single civil judgment
- Rating conflicts: If Angi vs Yelp vs Google ratings differ by >1 star
- Indeed/Glassdoor showing high turnover or commission-only structure
- OSHA violations (non-serious)

=== LOW SEVERITY (minor flags) ===
- TDLR license expiring within 60 days
- No presence on a specific platform
- Minor BBB complaints (resolved)
- Glassdoor rating below 3.0
```

---

## 5. Email Scraper (`scrape_emails_deepseek.js`)

### Purpose
Extract email addresses from contractor websites.

### API Configuration
```javascript
const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
  },
  body: JSON.stringify({
    model: DEEPSEEK_MODEL,        // 'deepseek-chat'
    messages: [
      {
        role: 'system',
        content: 'You are an email extraction assistant. Extract emails from HTML and return only valid JSON.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.1,
    max_tokens: 500
  })
});
```

---

## 6. Cost Estimation

All modules use the same cost calculation:

```javascript
function estimateCost(response) {
  const usage = response.usage || {};
  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;

  // DeepSeek pricing (approximate)
  // ~$0.14/1M input tokens
  // ~$0.28/1M output tokens
  return (inputTokens * 0.00000014) + (outputTokens * 0.00000028);
}
```

---

## 7. Known Issues / Bugs

### Review Analyzer Not Running
During collection, this error appears:
```
Review analysis error: Cannot read properties of undefined (reading 'length')
```

This suggests the `analyzeReviews` function is receiving malformed data - likely `reviewData.google_maps` or similar is undefined when accessed.

### Environment Variable Not Exported
The `.env` file uses standard format but `source .env` doesn't export variables to child processes. The audit scripts require:
```bash
DEEPSEEK_API_KEY=sk-xxx node run_audit_v2.js --id 123
```

---

## 8. Recommendations for Enabling Reasoning

To enable DeepSeek's reasoning mode, you would need to:

1. Change model from `deepseek-chat` to `deepseek-reasoner` (if available)
2. Or use a model like `deepseek-r1` if that's the reasoning variant
3. Potentially adjust temperature and prompts for reasoning tasks

Current architecture is already structured for reasoning (stores `reasoning_trace`), but doesn't use DeepSeek's native reasoning capabilities.

---

## Chat Context: Fake Review Discussion

**User Question:** What exactly does the logic/code look like for determining if the reviews are fake?

**Answer Summary:**
1. **AI-Based** (`review_analyzer.js`): Sends review data to DeepSeek with a fraud detection prompt looking for timing clusters, generic language, platform discrepancies, and shill account patterns. Returns a `fake_review_score` 0-100.

2. **Rule-Based Fallback**: Simple check - if BBB rating is "F" but Google is >= 4.5, flags as "CRITICAL: likely fake reviews or complaint suppression"

3. **Agent Heuristics**: The audit agents also reason about review authenticity in their prompts. For example, "Perfect 5.0 rating with 935 reviews - statistically improbable" triggers a flag.

**Key Finding:** The AI-based review analyzer is failing during collection (undefined errors), so most fake review detection happens through:
- The simple BBB vs Google discrepancy check
- The audit agent's prompt-based reasoning
