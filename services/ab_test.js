/**
 * A/B Testing Module
 *
 * Manages A/B testing for search strategies (new tiered search vs legacy).
 *
 * Features:
 * - Deterministic variant assignment (same contractor = same group)
 * - Result logging for statistical analysis
 * - Summary statistics for decision making
 *
 * Configuration via environment variables:
 * - AB_TEST_ENABLED: 'true' to enable A/B testing
 * - AB_NEW_PERCENTAGE: Percentage of traffic to new search (0.10 = 10%)
 * - AB_TEST_NAME: Unique name for this test (for multiple concurrent tests)
 */

const db = require('./db_pg');

const AB_CONFIG = {
  enabled: process.env.AB_TEST_ENABLED === 'true',
  newSearchPercentage: parseFloat(process.env.AB_NEW_PERCENTAGE || '0.10'),
  testName: process.env.AB_TEST_NAME || 'tiered_search_v1'
};

/**
 * Determine which search variant to use for a contractor
 * Uses deterministic assignment based on contractor ID
 *
 * @param {number} contractorId - Contractor ID
 * @returns {string} 'new' or 'legacy'
 */
function getVariant(contractorId) {
  if (!AB_CONFIG.enabled) {
    return 'new'; // Default to new when A/B testing disabled
  }

  // Deterministic hash based on contractor ID
  // Same contractor always gets same variant
  const hash = contractorId % 100;
  return hash < (AB_CONFIG.newSearchPercentage * 100) ? 'new' : 'legacy';
}

/**
 * Log an A/B test result
 *
 * @param {number} contractorId - Contractor ID
 * @param {string} variant - 'new' or 'legacy'
 * @param {Object} result - Search result to log
 * @param {boolean} result.found - Whether a match was found
 * @param {number} result.tier - Which tier found the match (1-5, null if not found)
 * @param {number} result.confidence - Match confidence (0-1)
 * @param {number} result.searchTime - Time taken in ms
 * @param {Array} result.attempts - Search attempts made
 */
async function logResult(contractorId, variant, result) {
  try {
    await db.exec(`
      INSERT INTO ab_test_results (test_name, contractor_id, variant, result_json)
      VALUES ($1, $2, $3, $4)
    `, [AB_CONFIG.testName, contractorId, variant, JSON.stringify(result)]);

    console.log(`[AB Test] Logged ${variant} result for contractor ${contractorId}`);
  } catch (err) {
    console.error(`[AB Test] Failed to log result: ${err.message}`);
  }
}

/**
 * Get summary statistics for the current A/B test
 *
 * @returns {Array} Summary by variant
 */
async function getSummary() {
  try {
    const rows = await db.exec(`
      SELECT variant,
             COUNT(*) as total,
             COUNT(*) FILTER (WHERE (result_json->>'found')::boolean = true) as found,
             COUNT(*) FILTER (WHERE (result_json->>'found')::boolean = false) as not_found,
             AVG((result_json->>'confidence')::float) FILTER (WHERE (result_json->>'confidence')::float IS NOT NULL) as avg_confidence,
             AVG((result_json->>'searchTime')::float) FILTER (WHERE (result_json->>'searchTime')::float IS NOT NULL) as avg_search_time
      FROM ab_test_results
      WHERE test_name = $1
      GROUP BY variant
    `, [AB_CONFIG.testName]);

    // Calculate success rates and format results
    return (rows || []).map(row => ({
      variant: row.variant,
      total: parseInt(row.total),
      found: parseInt(row.found || 0),
      notFound: parseInt(row.not_found || 0),
      successRate: row.total > 0 ? ((row.found / row.total) * 100).toFixed(1) + '%' : 'N/A',
      avgConfidence: row.avg_confidence ? parseFloat(row.avg_confidence).toFixed(2) : 'N/A',
      avgSearchTime: row.avg_search_time ? parseFloat(row.avg_search_time).toFixed(0) + 'ms' : 'N/A'
    }));
  } catch (err) {
    console.error(`[AB Test] Failed to get summary: ${err.message}`);
    return [];
  }
}

/**
 * Get detailed results for analysis
 *
 * @param {number} limit - Max results to return
 * @returns {Array} Detailed results
 */
async function getDetailedResults(limit = 100) {
  try {
    const rows = await db.exec(`
      SELECT ab.id, ab.contractor_id, ab.variant, ab.result_json, ab.created_at,
             c.business_name, c.trade, c.city
      FROM ab_test_results ab
      JOIN contractors_contractor c ON ab.contractor_id = c.id
      WHERE ab.test_name = $1
      ORDER BY ab.created_at DESC
      LIMIT $2
    `, [AB_CONFIG.testName, limit]);

    return rows || [];
  } catch (err) {
    console.error(`[AB Test] Failed to get detailed results: ${err.message}`);
    return [];
  }
}

/**
 * Get tier breakdown by variant
 *
 * @returns {Object} Tier breakdown
 */
async function getTierBreakdown() {
  try {
    const rows = await db.exec(`
      SELECT variant,
             (result_json->>'tier')::int as tier,
             COUNT(*) as count
      FROM ab_test_results
      WHERE test_name = $1
        AND (result_json->>'tier')::int IS NOT NULL
      GROUP BY variant, tier
      ORDER BY variant, tier
    `, [AB_CONFIG.testName]);

    // Group by variant
    const breakdown = { new: {}, legacy: {} };
    for (const row of (rows || [])) {
      if (!breakdown[row.variant]) breakdown[row.variant] = {};
      breakdown[row.variant][`tier${row.tier}`] = parseInt(row.count);
    }

    return breakdown;
  } catch (err) {
    console.error(`[AB Test] Failed to get tier breakdown: ${err.message}`);
    return { new: {}, legacy: {} };
  }
}

/**
 * Check if A/B testing is enabled
 *
 * @returns {boolean}
 */
function isEnabled() {
  return AB_CONFIG.enabled;
}

/**
 * Get current test configuration
 *
 * @returns {Object}
 */
function getConfig() {
  return { ...AB_CONFIG };
}

/**
 * Calculate statistical significance (chi-squared test)
 * Returns p-value for difference between variants
 *
 * @returns {Object} Statistical analysis
 */
async function getStatisticalAnalysis() {
  const summary = await getSummary();

  if (summary.length < 2) {
    return { error: 'Need both variants for comparison' };
  }

  const newData = summary.find(s => s.variant === 'new');
  const legacyData = summary.find(s => s.variant === 'legacy');

  if (!newData || !legacyData) {
    return { error: 'Missing variant data' };
  }

  // Chi-squared test for independence
  const observed = [
    [newData.found, newData.notFound],
    [legacyData.found, legacyData.notFound]
  ];

  const totalNew = newData.total;
  const totalLegacy = legacyData.total;
  const totalFound = newData.found + legacyData.found;
  const totalNotFound = newData.notFound + legacyData.notFound;
  const grandTotal = totalNew + totalLegacy;

  // Expected values
  const expected = [
    [(totalNew * totalFound) / grandTotal, (totalNew * totalNotFound) / grandTotal],
    [(totalLegacy * totalFound) / grandTotal, (totalLegacy * totalNotFound) / grandTotal]
  ];

  // Chi-squared statistic
  let chiSquared = 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      if (expected[i][j] > 0) {
        chiSquared += Math.pow(observed[i][j] - expected[i][j], 2) / expected[i][j];
      }
    }
  }

  // Approximate p-value (df=1)
  // Using simplified chi-squared CDF approximation
  const pValue = chiSquared > 3.84 ? (chiSquared > 6.63 ? '<0.01' : '<0.05') : '>0.05';

  return {
    newSuccess: (newData.found / newData.total * 100).toFixed(1) + '%',
    legacySuccess: (legacyData.found / legacyData.total * 100).toFixed(1) + '%',
    chiSquared: chiSquared.toFixed(3),
    pValue,
    significant: chiSquared > 3.84,
    recommendation: chiSquared > 3.84
      ? (newData.found / newData.total > legacyData.found / legacyData.total
        ? 'New search is significantly better'
        : 'Legacy search is significantly better')
      : 'No significant difference yet - need more data'
  };
}

module.exports = {
  getVariant,
  logResult,
  getSummary,
  getDetailedResults,
  getTierBreakdown,
  getStatisticalAnalysis,
  isEnabled,
  getConfig,
  AB_CONFIG
};
