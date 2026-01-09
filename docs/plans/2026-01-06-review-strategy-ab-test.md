# A/B Test: Review Collection Strategy Comparison

**Date:** 2026-01-06
**Status:** Ready for implementation
**Confidence:** 95%

---

## Overview

Compare two review collection strategies to validate cost savings while maintaining audit quality.

| Strategy | Description | Est. Cost/Contractor |
|----------|-------------|---------------------|
| **Current** | Serper(8) + SerpAPI(100) if >50 reviews | $0.002 - $1.55 |
| **Proposed** | Serper(10) + SerpAPI(max(10, 10%) - 10) | $0.002 - $0.20 |

**Expected savings:** ~72% ($196 for full 3,420 contractors)

---

## Test Design

### Sample Selection
- **30 contractors total** from PostgreSQL database
- 10 small (0-20 reviews)
- 10 medium (21-100 reviews)
- 10 large (100+ reviews)

### For Each Contractor
1. Run **current** strategy → collect reviews → run audit → log metrics
2. Wait 3 seconds (rate limit buffer)
3. Run **proposed** strategy → collect reviews → run audit → log metrics
4. Compare scores

### Metrics Tracked
- `serper_calls` - Number of Serper API calls
- `serpapi_calls` - Number of SerpAPI calls
- `reviews_collected` - Total reviews retrieved
- `collection_cost` - Serper ($0.001/call) + SerpAPI ($0.015/call)
- `audit_cost` - DeepSeek (~$0.003/audit)
- `trust_score` - Final audit score (0-100)
- `risk_level` - CRITICAL/SEVERE/MODERATE/LOW
- `collection_time_ms` - Time to collect reviews
- `audit_time_ms` - Time to run audit

---

## Implementation Tasks

### Task 1: Modify google_reviews_tiered.py

**File:** `scrapers/google_reviews_tiered.py`

**Changes:**
1. Add `--strategy` CLI argument: `current` | `proposed`
2. Add `--target-reviews` for proposed strategy override
3. Return cost metrics in output JSON

**Test command:**
```bash
# Current strategy
python3 scrapers/google_reviews_tiered.py "Texas Outdoor Oasis" "Dallas, TX" --strategy current

# Proposed strategy
python3 scrapers/google_reviews_tiered.py "Texas Outdoor Oasis" "Dallas, TX" --strategy proposed
```

**Expected output additions:**
```json
{
  "strategy": "proposed",
  "serper_calls": 2,
  "serpapi_calls": 4,
  "collection_cost": 0.062,
  "target_reviews": 30,
  "actual_reviews": 30
}
```

**Code changes:**

```python
# Add to argument parser (after line 337)
import argparse

def main():
    parser = argparse.ArgumentParser(description='Tiered Google Reviews Scraper')
    parser.add_argument('business_name', help='Business name to search')
    parser.add_argument('location', nargs='?', default='Fort Worth, TX', help='City, State')
    parser.add_argument('max_reviews', nargs='?', type=int, default=100, help='Max reviews')
    parser.add_argument('--strategy', choices=['current', 'proposed'], default='current',
                        help='Collection strategy: current (escalate if >50) or proposed (10%% or 10 min)')
    args = parser.parse_args()

    result = scrape_tiered(args.business_name, args.location, args.max_reviews, strategy=args.strategy)
    print(json.dumps(result, indent=2))
```

```python
# Modify scrape_tiered function (around line 270)
def scrape_tiered(
    business_name: str,
    location: str = "Fort Worth, TX",
    max_reviews: int = 100,
    force_full: bool = False,
    strategy: str = "current"  # NEW PARAMETER
) -> dict:

    # Track API calls for cost calculation
    metrics = {
        "strategy": strategy,
        "serper_calls": 0,
        "serpapi_calls": 0
    }

    # Step 1: Serper (always)
    serper_result = scrape_serper(business_name, location)
    metrics["serper_calls"] = 2  # places + reviews

    if not serper_result.get("found"):
        # Fallback to SerpAPI
        serpapi_result = scrape_serpapi(business_name, location, max_reviews)
        metrics["serpapi_calls"] = estimate_serpapi_calls(max_reviews)
        serpapi_result["metrics"] = metrics
        serpapi_result["collection_cost"] = calculate_cost(metrics)
        return serpapi_result

    total_available = serper_result.get("review_count", 0) or 0

    # Strategy-specific escalation logic
    if strategy == "current":
        # CURRENT: Escalate if >50 reviews or fraud signals
        fraud_check = quick_fraud_check(serper_result.get("reviews", []))
        should_escalate = force_full or fraud_check["escalate"] or total_available > 50
        target_reviews = 100 if should_escalate else 8
    else:
        # PROPOSED: 10% or 10 minimum
        target_reviews = max(10, int(total_available * 0.10))
        should_escalate = target_reviews > 10

    if not should_escalate:
        serper_result["metrics"] = metrics
        serper_result["collection_cost"] = calculate_cost(metrics)
        serper_result["target_reviews"] = target_reviews
        return serper_result

    # Escalate to SerpAPI
    serpapi_result = scrape_serpapi(business_name, location, target_reviews)
    metrics["serpapi_calls"] = estimate_serpapi_calls(target_reviews)

    if serpapi_result.get("found"):
        serpapi_result["metrics"] = metrics
        serpapi_result["collection_cost"] = calculate_cost(metrics)
        serpapi_result["target_reviews"] = target_reviews
        serpapi_result["escalated"] = True
        return serpapi_result

    # Fallback to Serper results
    serper_result["metrics"] = metrics
    serper_result["collection_cost"] = calculate_cost(metrics)
    return serper_result


def estimate_serpapi_calls(reviews_needed: int) -> int:
    """Estimate SerpAPI calls: 1 search + ceil((reviews-8)/10) pages"""
    if reviews_needed <= 8:
        return 2
    return 2 + ((reviews_needed - 8) + 9) // 10


def calculate_cost(metrics: dict) -> float:
    """Calculate total API cost"""
    serper_cost = metrics.get("serper_calls", 0) * 0.001
    serpapi_cost = metrics.get("serpapi_calls", 0) * 0.015
    return round(serper_cost + serpapi_cost, 4)
```

**Verification:**
```bash
source venv/bin/activate && set -a && . ./.env && set +a

# Test current strategy
python3 scrapers/google_reviews_tiered.py "Texas Outdoor Oasis" "Dallas, TX" --strategy current 2>&1 | grep -E '"strategy"|"serper_calls"|"serpapi_calls"|"collection_cost"'

# Test proposed strategy
python3 scrapers/google_reviews_tiered.py "Texas Outdoor Oasis" "Dallas, TX" --strategy proposed 2>&1 | grep -E '"strategy"|"serper_calls"|"serpapi_calls"|"collection_cost"'
```

---

### Task 2: Create bin/ab_test_reviews.js

**File:** `bin/ab_test_reviews.js`

**Purpose:** Orchestrate the A/B test across 30 contractors

```javascript
#!/usr/bin/env node
/**
 * A/B Test: Review Collection Strategy Comparison
 *
 * Tests 30 contractors (10 small, 10 medium, 10 large review counts)
 * Runs both current and proposed strategies on each
 * Generates markdown report + JSON data
 *
 * Usage:
 *   node bin/ab_test_reviews.js [--dry-run] [--limit N]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Django ORM access via Python
async function queryContractors(size, limit = 10) {
  return new Promise((resolve, reject) => {
    const script = `
import django, os, json
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from contractors.models import Contractor

ranges = {
    'small': (1, 20),
    'medium': (21, 100),
    'large': (101, 10000)
}
low, high = ranges['${size}']
contractors = Contractor.objects.filter(
    google_review_count__gte=low,
    google_review_count__lte=high,
    is_active=True
).order_by('?')[:${limit}]  # Random sample

result = [{'id': c.id, 'name': c.business_name, 'city': c.city, 'state': c.state, 'review_count': c.google_review_count} for c in contractors]
print(json.dumps(result))
`;
    const proc = spawn('python3', ['-c', script], { cwd: process.cwd() });
    let stdout = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => console.error(d.toString()));
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`Query failed: ${code}`));
      else resolve(JSON.parse(stdout));
    });
  });
}

async function runCollection(contractor, strategy) {
  return new Promise((resolve, reject) => {
    const location = `${contractor.city || 'Fort Worth'}, ${contractor.state || 'TX'}`;
    const args = [
      'scrapers/google_reviews_tiered.py',
      contractor.name,
      location,
      '--strategy', strategy
    ];

    const start = Date.now();
    const proc = spawn('python3', args, {
      cwd: process.cwd(),
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      const elapsed = Date.now() - start;
      try {
        // Find JSON in output (skip stderr logging)
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: 'No JSON output' };
        result.collection_time_ms = elapsed;
        result.strategy = strategy;
        resolve(result);
      } catch (e) {
        resolve({ error: e.message, strategy, collection_time_ms: elapsed });
      }
    });
  });
}

async function runAudit(contractorId) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const proc = spawn('node', ['bin/run_audit.js', '--id', String(contractorId)], {
      cwd: process.cwd(),
      env: { ...process.env }
    });

    let stdout = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => console.error(d.toString()));
    proc.on('close', code => {
      const elapsed = Date.now() - start;
      // Extract score from audit output
      const scoreMatch = stdout.match(/Trust Score:\s*(\d+)/i);
      const riskMatch = stdout.match(/Risk Level:\s*(\w+)/i);
      resolve({
        trust_score: scoreMatch ? parseInt(scoreMatch[1]) : null,
        risk_level: riskMatch ? riskMatch[1] : null,
        audit_time_ms: elapsed,
        audit_cost: 0.003  // DeepSeek estimate
      });
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest(dryRun = false, limit = 10) {
  console.log('=== A/B Test: Review Collection Strategy ===\n');

  // Sample contractors
  console.log('Sampling contractors from database...');
  const small = await queryContractors('small', limit);
  const medium = await queryContractors('medium', limit);
  const large = await queryContractors('large', limit);
  const contractors = [...small, ...medium, ...large];

  console.log(`Selected ${contractors.length} contractors:`);
  console.log(`  Small (0-20 reviews): ${small.length}`);
  console.log(`  Medium (21-100 reviews): ${medium.length}`);
  console.log(`  Large (100+ reviews): ${large.length}\n`);

  if (dryRun) {
    console.log('DRY RUN - would test these contractors:');
    contractors.forEach(c => console.log(`  ${c.id}: ${c.name} (${c.review_count} reviews)`));
    return;
  }

  const results = [];

  for (let i = 0; i < contractors.length; i++) {
    const c = contractors[i];
    const size = c.review_count <= 20 ? 'small' : c.review_count <= 100 ? 'medium' : 'large';

    console.log(`\n[${i + 1}/${contractors.length}] ${c.name} (${c.review_count} reviews, ${size})`);

    // Run CURRENT strategy
    console.log('  Running CURRENT strategy...');
    const currentCollection = await runCollection(c, 'current');
    const currentAudit = await runAudit(c.id);

    // Wait to avoid rate limiting
    await sleep(3000);

    // Run PROPOSED strategy
    console.log('  Running PROPOSED strategy...');
    const proposedCollection = await runCollection(c, 'proposed');
    const proposedAudit = await runAudit(c.id);

    results.push({
      contractor_id: c.id,
      contractor_name: c.name,
      total_reviews: c.review_count,
      size_bucket: size,
      current: {
        ...currentCollection,
        ...currentAudit,
        total_cost: (currentCollection.collection_cost || 0) + currentAudit.audit_cost
      },
      proposed: {
        ...proposedCollection,
        ...proposedAudit,
        total_cost: (proposedCollection.collection_cost || 0) + proposedAudit.audit_cost
      }
    });

    // Progress summary
    const scoreDiff = Math.abs((currentAudit.trust_score || 0) - (proposedAudit.trust_score || 0));
    const costSavings = ((currentCollection.collection_cost || 0) - (proposedCollection.collection_cost || 0)).toFixed(3);
    console.log(`  Current: ${currentAudit.trust_score} score, $${currentCollection.collection_cost?.toFixed(3) || '?'}`);
    console.log(`  Proposed: ${proposedAudit.trust_score} score, $${proposedCollection.collection_cost?.toFixed(3) || '?'}`);
    console.log(`  Score diff: ${scoreDiff}, Cost savings: $${costSavings}`);

    // Wait between contractors
    await sleep(2000);
  }

  // Generate reports
  await generateReports(results);
}

async function generateReports(results) {
  const timestamp = new Date().toISOString().split('T')[0];
  const jsonPath = `docs/analysis/review-strategy-ab-test-${timestamp}.json`;
  const mdPath = `docs/analysis/review-strategy-ab-test-${timestamp}.md`;

  // Ensure directory exists
  fs.mkdirSync('docs/analysis', { recursive: true });

  // Save JSON
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`\nJSON saved: ${jsonPath}`);

  // Calculate aggregates
  const bySize = { small: [], medium: [], large: [] };
  results.forEach(r => bySize[r.size_bucket].push(r));

  let totalCurrentCost = 0, totalProposedCost = 0;
  let scoreDiffs = [];

  results.forEach(r => {
    totalCurrentCost += r.current.total_cost || 0;
    totalProposedCost += r.proposed.total_cost || 0;
    if (r.current.trust_score && r.proposed.trust_score) {
      scoreDiffs.push(Math.abs(r.current.trust_score - r.proposed.trust_score));
    }
  });

  const avgScoreDiff = scoreDiffs.length ? (scoreDiffs.reduce((a, b) => a + b, 0) / scoreDiffs.length).toFixed(1) : 'N/A';
  const maxScoreDiff = scoreDiffs.length ? Math.max(...scoreDiffs) : 'N/A';
  const costSavings = ((1 - totalProposedCost / totalCurrentCost) * 100).toFixed(1);

  // Generate markdown
  const md = `# A/B Test Results: Review Collection Strategy

**Date:** ${timestamp}
**Contractors Tested:** ${results.length}

## Summary

| Metric | Current | Proposed | Diff |
|--------|---------|----------|------|
| Total Cost | $${totalCurrentCost.toFixed(2)} | $${totalProposedCost.toFixed(2)} | -${costSavings}% |
| Avg Score Diff | - | - | ${avgScoreDiff} points |
| Max Score Diff | - | - | ${maxScoreDiff} points |

## Results by Size

### Small (0-20 reviews)
| Contractor | Reviews | Current Score | Proposed Score | Diff | Current Cost | Proposed Cost |
|------------|---------|---------------|----------------|------|--------------|---------------|
${bySize.small.map(r => `| ${r.contractor_name.substring(0, 30)} | ${r.total_reviews} | ${r.current.trust_score || 'ERR'} | ${r.proposed.trust_score || 'ERR'} | ${Math.abs((r.current.trust_score || 0) - (r.proposed.trust_score || 0))} | $${(r.current.total_cost || 0).toFixed(3)} | $${(r.proposed.total_cost || 0).toFixed(3)} |`).join('\n')}

### Medium (21-100 reviews)
| Contractor | Reviews | Current Score | Proposed Score | Diff | Current Cost | Proposed Cost |
|------------|---------|---------------|----------------|------|--------------|---------------|
${bySize.medium.map(r => `| ${r.contractor_name.substring(0, 30)} | ${r.total_reviews} | ${r.current.trust_score || 'ERR'} | ${r.proposed.trust_score || 'ERR'} | ${Math.abs((r.current.trust_score || 0) - (r.proposed.trust_score || 0))} | $${(r.current.total_cost || 0).toFixed(3)} | $${(r.proposed.total_cost || 0).toFixed(3)} |`).join('\n')}

### Large (100+ reviews)
| Contractor | Reviews | Current Score | Proposed Score | Diff | Current Cost | Proposed Cost |
|------------|---------|---------------|----------------|------|--------------|---------------|
${bySize.large.map(r => `| ${r.contractor_name.substring(0, 30)} | ${r.total_reviews} | ${r.current.trust_score || 'ERR'} | ${r.proposed.trust_score || 'ERR'} | ${Math.abs((r.current.trust_score || 0) - (r.proposed.trust_score || 0))} | $${(r.current.total_cost || 0).toFixed(3)} | $${(r.proposed.total_cost || 0).toFixed(3)} |`).join('\n')}

## Conclusion

${avgScoreDiff <= 5 ? '**RECOMMENDATION: Adopt proposed strategy.** Score variance is minimal while cost savings are significant.' : '**CAUTION: Review results.** Score variance exceeds 5 points - may need tuning.'}

---
*Generated by ab_test_reviews.js*
`;

  fs.writeFileSync(mdPath, md);
  console.log(`Markdown saved: ${mdPath}`);

  // Print summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total Current Cost:  $${totalCurrentCost.toFixed(2)}`);
  console.log(`Total Proposed Cost: $${totalProposedCost.toFixed(2)}`);
  console.log(`Cost Savings:        ${costSavings}%`);
  console.log(`Avg Score Diff:      ${avgScoreDiff} points`);
  console.log(`Max Score Diff:      ${maxScoreDiff} points`);
}

// CLI
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 10;

runTest(dryRun, limit).catch(console.error);
```

**Verification:**
```bash
# Dry run to see selected contractors
node bin/ab_test_reviews.js --dry-run

# Run with 3 contractors per size (pilot)
node bin/ab_test_reviews.js --limit 3

# Full test (10 per size)
node bin/ab_test_reviews.js --limit 10
```

---

### Task 3: Run Pilot Test

**Purpose:** Validate the test harness before full run

**Commands:**
```bash
source venv/bin/activate && set -a && . ./.env && set +a

# Test modified scraper
python3 scrapers/google_reviews_tiered.py "Texas Outdoor Oasis" "Dallas, TX" --strategy current
python3 scrapers/google_reviews_tiered.py "Texas Outdoor Oasis" "Dallas, TX" --strategy proposed

# Run pilot (3 contractors per size = 9 total)
node bin/ab_test_reviews.js --limit 3
```

**Expected output:**
- 9 contractors tested
- JSON file in `docs/analysis/`
- Markdown report with comparison tables
- Cost savings estimate validated

---

### Task 4: Run Full Test

**Commands:**
```bash
source venv/bin/activate && set -a && . ./.env && set +a

# Full test (10 per size = 30 total)
node bin/ab_test_reviews.js --limit 10
```

**Expected duration:** ~45-60 minutes (30 contractors × 2 strategies × ~1 min each)

**Expected cost:** ~$5-10 total

---

## Success Criteria

1. **Cost validation:** Proposed strategy costs 60-80% less than current
2. **Quality validation:** Trust score difference ≤5 points for 90%+ of contractors
3. **No errors:** All 30 contractors complete both strategies successfully

---

## Rollback Plan

If test fails or shows quality degradation:
1. Revert `google_reviews_tiered.py` to original
2. Document failure mode in report
3. Consider alternative thresholds (15%, 20%)
