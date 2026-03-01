---
name: trust-audit
description: |
  Run forensic audit on a contractor to generate Trust Score (15-100).
  Use when user asks to "audit contractor X" or "check trust score for Y".
  Analyzes 30+ data sources (Google, BBB, licenses, courts) using DeepSeek LLM.
license: MIT
compatibility: marvin
metadata:
  marvin-category: work
  user-invocable: true
  slash-command: /audit
  model: default
  proactive: false
---

# Trust Audit Skill

Run forensic audit on a contractor to generate a Trust Score (15-100).

## When to Use

Trigger phrases:
- "Audit contractor [name/ID]"
- "Run a trust audit on [contractor]"
- "Check trust score for [ID]"
- "Investigate [contractor name]"
- "/audit [ID]"

## Process

### Step 1: Identify the Contractor

If user provides:
- **Contractor ID**: Use directly with `get_contractor_details(contractor_id)`
- **Contractor name**: Use `search_contractors(city, min_score=0, limit=20)` to find matches
- **Ambiguous input**: Ask user to clarify

Example:
```javascript
// By ID
const details = await mcp.get_contractor_details(123);

// By name
const matches = await mcp.search_contractors("Dallas", 0, 20);
// Show user the matches and ask which one
```

### Step 2: Check Existing Audit Data

Use `get_contractor_details()` to check:
- Does the contractor have an existing Trust Score?
- When was the last audit run?
- Is the data still valid (TTL < 7 days)?

If data is fresh (< 7 days old), show existing results unless user explicitly requests a re-audit.

### Step 3: Run the Audit

Navigate to the auditor directory and run the audit script:

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate && set -a && . ./.env && set +a
node bin/run_audit.js --id <contractor_id> [--mode dialectic]
```

**Audit Modes:**

| Mode | Description | Cost | Speed | Use Case |
|------|-------------|------|-------|----------|
| `standard` (default) | Single DeepSeek pass | ~$0.003 | ~30s | Batch audits, screening |
| `dialectic` | 3-persona adversarial | ~$0.009 | ~90s | Important audits, borderline cases |

**When to use dialectic mode:**
- User explicitly requests "deep audit" or "thorough investigation"
- Contractor has conflicting signals (high reviews but court records)
- Previous audit was borderline or uncertain
- High-value decision (large contract, sensitive project)

### Step 4: Monitor the Audit

The audit script will:
1. **Collect data** from 30+ sources (Tier 1-8):
   - Tier 1: Reviews (Google, BBB, Yelp, Trustpilot)
   - Tier 2: News (Google News, local sources)
   - Tier 3: Social (Reddit, YouTube)
   - Tier 4: Employee feedback (Indeed, Glassdoor)
   - Tier 5: Government (OSHA, EPA)
   - Tier 6: Texas compliance (Franchise Tax)
   - Tier 7: Courts (County liens, judgments)
   - Tier 8: Industry platforms (Porch, BuildZoom, HomeAdvisor)

2. **Analyze reviews** using strategic sampling:
   - 10 five-star reviews (catch fake positives)
   - 10 one-two star reviews (real complaints)
   - 5 mid-range reviews (balanced perspective)

3. **Run LLM analysis**:
   - Standard: Single DeepSeek pass
   - Dialectic: 3-persona adversarial reasoning
     - Consumer Advocate (skeptical)
     - Fair Arbiter (charitable)
     - Synthesizer (final judgment)

4. **Save results** to PostgreSQL:
   - `audit_records` table
   - `contractors_contractor` table (Trust Score update)
   - `contractor_raw_data` table (cached data)

### Step 5: Retrieve and Present Results

After the audit completes, use `get_contractor_details(contractor_id)` to fetch:
- Final Trust Score (15-100)
- Assessment confidence (how sure we are)
- Data confidence (how complete the data is)
- Red flags identified
- Key findings summary
- Reasoning trace (for dialectic mode)

### Step 6: Generate Audit Report

Present the results in a structured format:

```markdown
# Trust Audit Report: [Contractor Name]

**Trust Score:** [score]/100
**Assessment Confidence:** [confidence]%
**Data Confidence:** [data_confidence]%
**Last Audited:** [timestamp]

## Summary
[Brief 2-3 sentence summary of findings]

## Key Findings
- [Finding 1]
- [Finding 2]
- [Finding 3]

## Red Flags
- [Flag 1: description]
- [Flag 2: description]

## Data Sources Analyzed
- Reviews: [Google count], [BBB count], [Yelp count]
- Licenses: [TX license status]
- Court records: [liens found]
- Compliance: [OSHA violations, EPA violations]

## Recommendation
[Based on score and flags, recommend trust level: Trusted / Proceed with Caution / High Risk]

---
*Audit Version: [standard/dialectic]*
*Generated: [timestamp]*
```

### Step 7: Handle Edge Cases

**No data found:**
- Check if contractor name/ID is valid
- Suggest alternative search terms
- Note that lack of data itself is a signal (new business or inactive)

**Audit script fails:**
- Check error logs in auditor directory
- Common issues:
  - Missing .env variables
  - Playwright browser not installed
  - Database connection failure
- Run `node bin/check_status.js` for diagnostics

**Score seems wrong:**
- Review the reasoning trace (dialectic mode shows full debate)
- Check for data quality issues (fake reviews, outdated records)
- Consider re-running with dialectic mode for deeper analysis

**User disputes results:**
- Show the data sources and reasoning
- Offer to re-run with dialectic mode
- Document the dispute for future calibration

## Output Format

```
Completed Trust Audit: **[Contractor Name]** (ID: [id])

Trust Score: [score]/100 ([confidence]% confident)
Status: [Trusted / Caution / High Risk]

Key Findings:
- [Finding 1]
- [Finding 2]
- [Finding 3]

Red Flags: [count]
Data Sources: [count reviewed]
Audit Mode: [standard/dialectic]

Full report available via: get_contractor_details([id])
```

## Notes

- Trust Scores are deterministic (DeepSeek seed=42, temperature=0)
- Scores range from 15-100 (not 0-100)
- Dialectic mode provides adversarial reasoning for higher confidence
- Data is cached with TTL (7 days default) to reduce scraping load
- All audit results are saved to PostgreSQL for historical tracking

## Related Commands

- `search_contractors(city, min_score, limit)` - Find contractors
- `get_contractor_details(contractor_id)` - Get audit results
- `count_contractors(city)` - Count contractors by city
- `analyze_market(city, trade)` - Market analysis

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Contractor not found" | Use search_contractors() to find the ID |
| Audit script hangs | Check Playwright browser, kill stale processes |
| Low data confidence | Re-run audit, data may have been unavailable |
| Conflicting scores | Use dialectic mode for deeper analysis |

---

*Skill created: 2026-01-24*
