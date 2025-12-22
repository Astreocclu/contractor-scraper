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
        skipCollection: true,
        batchMode: true
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
