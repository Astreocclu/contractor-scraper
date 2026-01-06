# 100% Confidence Verification Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Take confidence from 85-90% to 100% by testing: fresh collection, new contractor creation, and adding integration tests.

**Architecture:** Manual verification tests + automated integration test file that can be re-run.

**Tech Stack:** Node.js, Mocha, PostgreSQL

---

## Task 1: Test Fresh Collection (Force Refresh)

**Files:**
- Test only, no code changes

**Step 1: Find a contractor with stale cache**

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
node -e "
const db = require('./services/db_pg');
(async () => {
  const rows = await db.exec(\`
    SELECT DISTINCT c.id, c.business_name,
           COUNT(r.id) as sources,
           MIN(r.fetched_at) as oldest
    FROM contractors_contractor c
    JOIN contractor_raw_data r ON c.id = r.contractor_id
    WHERE c.trust_score > 0
    GROUP BY c.id, c.business_name
    HAVING COUNT(r.id) > 5
    ORDER BY MIN(r.fetched_at) ASC
    LIMIT 3
  \`);
  rows.forEach(r => console.log('ID', r.id, ':', r.business_name, '- sources:', r.sources, '- oldest:', r.oldest));
  await db.close();
})();
"
```

**Step 2: Force fresh collection on one contractor**

Pick an ID from step 1 (call it $ID), then:

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a

# First, delete cached data to force fresh collection
node -e "
const db = require('./services/db_pg');
(async () => {
  await db.run('DELETE FROM contractor_raw_data WHERE contractor_id = ?', [$ID]);
  console.log('Cleared cache for contractor $ID');
  await db.close();
})();
"

# Now run audit - this will trigger fresh collection
node bin/run_audit.js --id $ID 2>&1 | tee /tmp/fresh_collection_test.log
```

**Step 3: Verify collection happened**

```bash
# Check that new data was collected
grep -E "📥|collection|scraping|BBB|Google|Yelp" /tmp/fresh_collection_test.log | head -20

# Verify we got a score
grep "Trust Score" /tmp/fresh_collection_test.log
```

**Step 4: Record result**

Expected: Audit completes with score, collection logs show data being fetched.

**Step 5: No commit needed (test only)**

---

## Task 2: Test New Contractor Creation (Full Pipeline)

**Files:**
- Test only, no code changes

**Step 1: Create a brand new contractor via audit**

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a

# Use a real DFW contractor that's NOT in our database
# Example: "ABC Home Services Dallas" (made up but realistic)
node bin/run_audit.js --name "Milestone Electric Air and Plumbing" --city "Dallas" --state "TX" 2>&1 | tee /tmp/new_contractor_test.log
```

**Step 2: Verify contractor was created**

```bash
# Check for "Creating temporary entry" or "Found matching"
grep -E "Creating|Found matching|contractor ID" /tmp/new_contractor_test.log

# Verify audit completed
grep "Trust Score" /tmp/new_contractor_test.log
```

**Step 3: Verify in database**

```bash
node -e "
const db = require('./services/db_pg');
(async () => {
  const rows = await db.exec(\`
    SELECT id, business_name, trust_score, created_at
    FROM contractors_contractor
    WHERE business_name ILIKE '%Milestone%'
    ORDER BY id DESC
    LIMIT 1
  \`);
  console.log('New contractor:', rows[0]);
  await db.close();
})();
"
```

**Step 4: Record result**

Expected: New contractor created, collection ran, audit completed with score.

**Step 5: No commit needed (test only)**

---

## Task 3: Create Integration Test File

**Files:**
- Create: `tests/integration/test_audit_pipeline.js`

**Step 1: Create integration test directory**

```bash
mkdir -p tests/integration
```

**Step 2: Write the integration test file**

Create `tests/integration/test_audit_pipeline.js`:

```javascript
/**
 * Integration Tests for Audit Pipeline
 *
 * Tests the full audit flow from orchestrator through agent.
 * Run with: npm test -- tests/integration/test_audit_pipeline.js
 */

const assert = require('assert');
const db = require('../../services/db_pg');
const { runForensicAudit } = require('../../services/orchestrator');

// Test contractors - must exist in DB with cached data
const TEST_CONTRACTORS = {
  low_score: { id: 39, expected_range: [30, 45] },    // Known bad contractor
  high_score: { id: 35, expected_range: [80, 95] }   // Known good contractor
};

describe('Audit Pipeline Integration', function() {
  // Increase timeout for API calls
  this.timeout(120000);

  after(async function() {
    await db.close();
  });

  describe('AuditAgent', function() {
    it('should produce scores in expected range for low-score contractor', async function() {
      const { id, expected_range } = TEST_CONTRACTORS.low_score;

      const result = await runForensicAudit({ id }, {
        skipCollection: true,  // Use cached data
        batchMode: true        // Don't close DB
      });

      assert(result, 'Audit should return a result');
      assert(typeof result.trust_score === 'number', 'Should have numeric trust_score');
      assert(result.trust_score >= expected_range[0], `Score ${result.trust_score} should be >= ${expected_range[0]}`);
      assert(result.trust_score <= expected_range[1], `Score ${result.trust_score} should be <= ${expected_range[1]}`);
      assert(result.recommendation === 'AVOID', 'Low score should recommend AVOID');
    });

    it('should produce scores in expected range for high-score contractor', async function() {
      const { id, expected_range } = TEST_CONTRACTORS.high_score;

      const result = await runForensicAudit({ id }, {
        skipCollection: true,
        batchMode: true
      });

      assert(result, 'Audit should return a result');
      assert(typeof result.trust_score === 'number', 'Should have numeric trust_score');
      assert(result.trust_score >= expected_range[0], `Score ${result.trust_score} should be >= ${expected_range[0]}`);
      assert(result.trust_score <= expected_range[1], `Score ${result.trust_score} should be <= ${expected_range[1]}`);
      assert(result.recommendation === 'RECOMMENDED', 'High score should recommend RECOMMENDED');
    });

    it('should be deterministic (same score on repeated runs)', async function() {
      const { id } = TEST_CONTRACTORS.low_score;
      const scores = [];

      // Run 3 times
      for (let i = 0; i < 3; i++) {
        const result = await runForensicAudit({ id }, {
          skipCollection: true,
          batchMode: true
        });
        scores.push(result.trust_score);
      }

      // All scores should be identical
      const allSame = scores.every(s => s === scores[0]);
      assert(allSame, `Scores should be identical but got: ${scores.join(', ')}`);
    });
  });

  describe('Result Structure', function() {
    it('should return all required fields', async function() {
      const { id } = TEST_CONTRACTORS.low_score;

      const result = await runForensicAudit({ id }, {
        skipCollection: true,
        batchMode: true
      });

      // Required fields
      assert(typeof result.trust_score === 'number', 'trust_score should be number');
      assert(typeof result.risk_level === 'string', 'risk_level should be string');
      assert(typeof result.recommendation === 'string', 'recommendation should be string');
      assert(typeof result.reasoning === 'string', 'reasoning should be string');

      // Risk level should be valid
      const validRiskLevels = ['CRITICAL', 'SEVERE', 'HIGH', 'MODERATE', 'LOW', 'TRUSTED'];
      assert(validRiskLevels.includes(result.risk_level), `risk_level "${result.risk_level}" should be valid`);

      // Recommendation should be valid
      const validRecs = ['AVOID', 'NOT_RECOMMENDED', 'RECOMMENDED'];
      assert(validRecs.includes(result.recommendation), `recommendation "${result.recommendation}" should be valid`);
    });

    it('should include red_flags array for low-score contractor', async function() {
      const { id } = TEST_CONTRACTORS.low_score;

      const result = await runForensicAudit({ id }, {
        skipCollection: true,
        batchMode: true
      });

      assert(Array.isArray(result.red_flags), 'red_flags should be array');
      assert(result.red_flags.length > 0, 'Low score contractor should have red flags');
    });
  });
});
```

**Step 3: Run the tests**

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
npm test -- tests/integration/test_audit_pipeline.js
```

Expected: All tests pass

**Step 4: Commit**

```bash
git add tests/integration/test_audit_pipeline.js
git commit -m "test: add integration tests for audit pipeline

- Tests low-score and high-score contractors
- Verifies deterministic scoring (0 variance)
- Validates result structure and required fields
- Run with: npm test -- tests/integration/test_audit_pipeline.js"
```

---

## Task 4: Run Full Verification Suite

**Files:**
- Test only, no code changes

**Step 1: Run the new integration tests**

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
npm test -- tests/integration/test_audit_pipeline.js 2>&1 | tee /tmp/integration_test_results.log
```

**Step 2: Run the existing variance test**

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
./tests/variance_test.sh 39 3 2>&1 | tee /tmp/variance_results.log
```

**Step 3: Record final results**

```bash
echo "=== INTEGRATION TESTS ===" > /tmp/final_verification.log
grep -E "passing|failing|✓|✗" /tmp/integration_test_results.log >> /tmp/final_verification.log

echo "" >> /tmp/final_verification.log
echo "=== VARIANCE TEST ===" >> /tmp/final_verification.log
tail -5 /tmp/variance_results.log >> /tmp/final_verification.log

cat /tmp/final_verification.log
```

**Step 4: Update confidence assessment**

If all tests pass:
- Fresh collection: ✅ Verified
- New contractor: ✅ Verified
- Integration tests: ✅ Added and passing
- Confidence: **100%**

**Step 5: No commit needed (verification only)**

---

## Summary

| Task | What It Tests | Adds to Confidence |
|------|---------------|-------------------|
| 1 | Fresh collection (no cache) | +5% |
| 2 | New contractor creation | +5% |
| 3 | Integration tests (automated) | +5% (reusable) |
| 4 | Full verification suite | Confirms 100% |

**Total estimated tasks:** 4
**Risk level:** LOW (tests only, no code changes except adding test file)
