# Score Variance Validation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Validate that the Dec 14 temperature and lien direction fixes produce consistent, accurate scores before scaling to all contractors.

**Architecture:** Run variance tests on 3 contractor types (known-good, known-bad, liens-present), verify score consistency within 5 points, then run 10 full-pipeline audits with intense analysis of each result.

**Tech Stack:** Node.js (audit pipeline), Python (scrapers, Django), PostgreSQL, DeepSeek API

---

## Context: What Was Fixed (Dec 14)

| Fix | Before | After |
|-----|--------|-------|
| Temperature | 0.1 (29-point variance) | 0 (2-point variance) |
| Lien direction | All liens = red flag | Liens BY contractor = neutral, AGAINST = red flag |
| Lien scraper | No direction field | Returns `liens_by_contractor` and `liens_against_contractor` |

**Stale Cache Warning:** Old lien cache files don't have direction fields. Must use fresh collection or clear cache.

---

## Test Contractors

| ID | Name | Type | Expected Score Range |
|----|------|------|----------------------|
| 1524 | Orange Elephant Roofing | Known fraud | 10-20 (CRITICAL) |
| 288 | Dimensional Pro Construction | High-rated, clean | 85-95 (RECOMMENDED) |
| 121 | Splishin' and A Splashin' Pools | High-rated, clean | 85-95 (RECOMMENDED) |
| 101 | Beautiful Backyard Living | Has liens BY contractor | 60-80 (should NOT be CRITICAL) |
| 39 | Claffey Pools | High reviews + high liens | Verify lien interpretation |

---

## Task 1: Create Variance Test Script

**Files:**
- Create: `scripts/variance_test.js`

**Step 1: Write the variance test script**

```javascript
#!/usr/bin/env node
/**
 * Variance Test Script
 *
 * Runs the same contractor through audit N times (default 5)
 * to verify score consistency at temperature 0.
 *
 * Usage: node scripts/variance_test.js --id 288 --runs 5
 */

const { runForensicAudit } = require('../services/orchestrator');

async function runVarianceTest(contractorId, runs = 5) {
  console.log(`\n=== Variance Test: Contractor ${contractorId} ===`);
  console.log(`Running ${runs} audits with --skip-collection (cached data only)\n`);

  const results = [];

  for (let i = 1; i <= runs; i++) {
    console.log(`Run ${i}/${runs}...`);
    try {
      const result = await runForensicAudit({
        contractorId,
        skipCollection: true,  // Use cached data for consistency
        dryRun: true,          // Don't save to DB
        batchMode: true        // Keep DB pool open
      });

      results.push({
        run: i,
        score: result.trustScore,
        recommendation: result.recommendation,
        riskLevel: result.riskLevel,
        iterations: result.iterations || 'N/A'
      });

      console.log(`  Score: ${result.trustScore}, ${result.recommendation}`);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      results.push({ run: i, error: err.message });
    }
  }

  // Calculate variance
  const scores = results.filter(r => r.score).map(r => r.score);
  if (scores.length < 2) {
    console.log('\nInsufficient successful runs for variance calculation');
    return results;
  }

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const spread = max - min;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  console.log(`\n=== Results ===`);
  console.log(`Scores: ${scores.join(', ')}`);
  console.log(`Range: ${min}-${max} (spread: ${spread} points)`);
  console.log(`Average: ${avg.toFixed(1)}`);
  console.log(`Variance: ${spread <= 5 ? 'PASS' : 'FAIL'} (target: ≤5 points)`);

  return { results, min, max, spread, avg, pass: spread <= 5 };
}

// CLI
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : null;
};

const contractorId = parseInt(getArg('id') || '288');
const runs = parseInt(getArg('runs') || '5');

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY not set. Run: source venv/bin/activate && set -a && . ./.env && set +a');
  process.exit(1);
}

runVarianceTest(contractorId, runs)
  .then(result => {
    process.exit(result.pass ? 0 : 1);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
```

**Step 2: Make executable**

Run: `chmod +x scripts/variance_test.js`

**Step 3: Commit**

```bash
git add scripts/variance_test.js
git commit -m "feat: add variance test script for score consistency validation"
```

---

## Task 2: Collect Fresh Data for Test Contractors

**Files:**
- Uses: `bin/batch_collect.js`

**Step 1: Clear stale lien cache for test contractors**

Run:
```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
python3 -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from contractors.models import ContractorRawData
# Delete stale county_liens data (missing direction fields)
deleted = ContractorRawData.objects.filter(source_name='county_liens').delete()
print(f'Deleted {deleted[0]} stale lien cache records')
"
```

Expected: Count of deleted records (could be 0 if already cleared)

**Step 2: Collect fresh data for all 5 test contractors**

Run:
```bash
for id in 1524 288 121 101 39; do
  echo "=== Collecting contractor $id ==="
  node bin/batch_collect.js --id $id --force
  echo ""
done
```

Expected: Each contractor shows collection results for Google Maps, BBB, Yelp, county_liens, etc.

**Step 3: Verify lien data has direction fields**

Run:
```bash
python3 -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from contractors.models import ContractorRawData
import json

for cid in [1524, 288, 121, 101, 39]:
    try:
        rec = ContractorRawData.objects.filter(contractor_id=cid, source_name='county_liens').first()
        if rec:
            data = rec.structured_data if isinstance(rec.structured_data, dict) else json.loads(rec.structured_data)
            has_direction = 'liens_by_contractor' in data
            print(f'Contractor {cid}: {\"HAS\" if has_direction else \"MISSING\"} direction fields')
        else:
            print(f'Contractor {cid}: No lien data')
    except Exception as e:
        print(f'Contractor {cid}: ERROR - {e}')
"
```

Expected: All contractors show "HAS direction fields" or "No lien data"

---

## Task 3: Run Variance Test on Known-Good Contractor

**Files:**
- Uses: `scripts/variance_test.js`

**Step 1: Run variance test on contractor 288 (Dimensional Pro)**

Run:
```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
node scripts/variance_test.js --id 288 --runs 5
```

Expected:
- Scores should be 85-95 range
- Spread ≤ 5 points (PASS)
- All runs show RECOMMENDED

**Step 2: Record results**

Note the output: min, max, spread, average, pass/fail

---

## Task 4: Run Variance Test on Known-Bad Contractor

**Files:**
- Uses: `scripts/variance_test.js`

**Step 1: Run variance test on contractor 1524 (Orange Elephant - known fraud)**

Run:
```bash
node scripts/variance_test.js --id 1524 --runs 5
```

Expected:
- Scores should be 10-20 range (CRITICAL)
- Spread ≤ 5 points (PASS)
- All runs show AVOID
- Red flags should include fraud indicators

**Step 2: Record results**

Note the output: min, max, spread, average, pass/fail

---

## Task 5: Run Variance Test on Liens-Present Contractor

**Files:**
- Uses: `scripts/variance_test.js`

**Step 1: Run variance test on contractor 101 (Beautiful Backyard - has liens BY contractor)**

Run:
```bash
node scripts/variance_test.js --id 101 --runs 5
```

Expected:
- Scores should be 60-80 range (NOT 10-20)
- If scores are still <30, the lien direction fix may not be applied correctly
- Spread ≤ 5 points (PASS)
- Should NOT show CRITICAL/AVOID just because of liens filed BY the contractor

**Step 2: If score is unexpectedly low, investigate**

Run:
```bash
node bin/run_audit.js --id 101 --dry-run 2>&1 | tee /tmp/audit_101.log
grep -i "lien" /tmp/audit_101.log | head -20
```

Check if agent mentions "liens filed BY contractor" vs "liens AGAINST contractor"

---

## Task 6: Run 10 Full-Pipeline Audits

**Files:**
- Uses: `bin/batch_audit_runner.js`

**Step 1: Select 10 diverse contractors for full testing**

Run:
```bash
python3 -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from contractors.models import Contractor
import random

# Get contractors with websites (better data)
candidates = list(Contractor.objects.exclude(website__isnull=True).exclude(website='').values_list('id', flat=True)[:500])
selected = random.sample(candidates, 10)
print('Selected contractor IDs:', ','.join(map(str, selected)))
"
```

Note the 10 IDs.

**Step 2: Run full collection + audit on these 10**

Run:
```bash
# Replace with actual IDs from step 1
node bin/batch_audit_runner.js --reset --ids 123,456,789,...
```

Or run individually for more control:
```bash
for id in ID1 ID2 ID3 ID4 ID5 ID6 ID7 ID8 ID9 ID10; do
  echo "=== Full audit: Contractor $id ==="
  node bin/run_audit.js --id $id
  echo ""
  sleep 5  # Rate limit
done
```

Expected: Each audit completes with score, recommendation, reasoning

**Step 3: Record all results**

```bash
python3 -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from contractors.models import ContractorAudit
from django.utils import timezone
from datetime import timedelta

recent = ContractorAudit.objects.filter(
    created_at__gte=timezone.now() - timedelta(hours=1)
).order_by('-created_at')[:10]

print('Recent Audits:')
print('ID | Score | Risk | Recommendation | Contractor')
print('-' * 60)
for a in recent:
    print(f'{a.contractor_id} | {a.trust_score} | {a.risk_level} | {a.recommendation} | {a.contractor.business_name[:30]}')
"
```

---

## Task 7: Intense Analysis of Each Result

**Files:**
- Uses: Django shell, audit_records table

**Step 1: For each of the 10 audits, review reasoning**

Run for each contractor ID:
```bash
python3 -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from contractors.models import ContractorAudit
import json

# Replace with actual contractor ID
cid = 123
audit = ContractorAudit.objects.filter(contractor_id=cid).order_by('-created_at').first()
if audit:
    print(f'=== Contractor {cid}: {audit.contractor.business_name} ===')
    print(f'Score: {audit.trust_score}, Risk: {audit.risk_level}, Rec: {audit.recommendation}')
    print()
    print('RED FLAGS:')
    flags = audit.red_flags or []
    for f in flags[:5]:
        if isinstance(f, dict):
            print(f'  - [{f.get(\"severity\", \"?\")}] {f.get(\"description\", str(f))[:80]}')
        else:
            print(f'  - {str(f)[:80]}')
    print()
    print('POSITIVE SIGNALS:')
    signals = audit.positive_signals or []
    for s in signals[:5]:
        print(f'  + {str(s)[:80]}')
"
```

**Step 2: Check for scoring anomalies**

Look for:
- High-rated contractors (4.8+ Google) scoring below 70
- Contractors with no red flags scoring below 80
- Contractors with liens BY them (not AGAINST) being marked CRITICAL
- Score doesn't match the evidence in reasoning

**Step 3: Document any issues found**

Add to ERRORS.md if bugs are found.

---

## Task 8: Summarize Validation Results

**Files:**
- Create/Update: `docs/validation/2025-12-19-variance-validation-results.md`

**Step 1: Create validation results document**

```markdown
# Variance Validation Results - 2025-12-19

## Summary

| Test | Result | Notes |
|------|--------|-------|
| Known-good variance (ID 288) | PASS/FAIL | Spread: X points |
| Known-bad variance (ID 1524) | PASS/FAIL | Spread: X points |
| Liens-present variance (ID 101) | PASS/FAIL | Spread: X points, lien direction correct: YES/NO |

## Full Pipeline Audits (10 contractors)

| ID | Name | Score | Risk | Issues Found |
|----|------|-------|------|--------------|
| ... | ... | ... | ... | ... |

## Conclusion

[Ready for scale-up / Needs fixes: ...]

## Issues to Address

1. ...
2. ...
```

**Step 2: Commit validation results**

```bash
git add docs/validation/
git commit -m "docs: add variance validation results for Dec 19 testing"
```

---

## Success Criteria

Before scaling to all ~4,000 contractors, ALL must pass:

1. **Variance ≤ 5 points** on all 3 test types (good/bad/liens)
2. **Known fraud scores CRITICAL** (Orange Elephant < 20)
3. **Known good scores RECOMMENDED** (Dimensional Pro > 80)
4. **Liens BY contractor NOT treated as CRITICAL** (Beautiful Backyard > 50)
5. **10 full-pipeline audits complete without errors**
6. **Score distributions look reasonable** (not all 90s, not all 20s)

---

## If Validation Fails

- **Variance > 5 points:** Investigate DeepSeek prompt, consider structured scoring
- **Lien direction wrong:** Check `scrapers/county_liens/orchestrator.py` and `services/audit_agent_v2.js` prompt
- **Good contractors scoring low:** Check for over-penalization of missing data
- **Bad contractors scoring high:** Check if red flags are being detected

Do NOT proceed to scale-up until all criteria pass.
