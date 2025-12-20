/**
 * Scoring Constraints
 *
 * Post-scoring constraints that enforce stricter requirements for high scores.
 * Can be toggled on/off via configuration.
 */

// Default configuration - stricter scoring disabled by default
const DEFAULT_CONFIG = {
  enabled: false,

  // Minimum review count required for RECOMMENDED (80+)
  minReviewsForRecommended: 25,

  // Require verified business registration for scores 85+
  requireRegistrationForHigh: true,
  registrationThreshold: 85,

  // Cap score if critical data gaps exist
  dataGapCeiling: 75,

  // Critical data gaps that trigger the ceiling
  criticalGaps: [
    'review count',
    'google review count',
    'google maps review count',
    'business registration',
    'franchise tax',
    'years in business'
  ]
};

// Active configuration (can be modified at runtime)
let activeConfig = { ...DEFAULT_CONFIG };

/**
 * Update the constraint configuration
 */
function configure(options) {
  activeConfig = { ...DEFAULT_CONFIG, ...options };
  return activeConfig;
}

/**
 * Get current configuration
 */
function getConfig() {
  return { ...activeConfig };
}

/**
 * Enable strict constraints
 */
function enable() {
  activeConfig.enabled = true;
}

/**
 * Disable strict constraints
 */
function disable() {
  activeConfig.enabled = false;
}

/**
 * Apply strict constraints to an audit result
 *
 * @param {Object} result - The audit result with trust_score, gaps, etc.
 * @param {Object} dataContext - Additional data context (review counts, registration status)
 * @returns {Object} - Modified result with constraints applied
 */
function applyConstraints(result, dataContext = {}) {
  if (!activeConfig.enabled) {
    return result;
  }

  const originalScore = result.trust_score;
  let constrainedScore = originalScore;
  const constraints = [];

  // 1. Check minimum review count for RECOMMENDED
  const reviewCount = dataContext.reviewCount || 0;
  if (originalScore >= 80 && reviewCount < activeConfig.minReviewsForRecommended) {
    const newMax = 79;
    if (constrainedScore > newMax) {
      constrainedScore = newMax;
      constraints.push({
        type: 'MIN_REVIEWS',
        reason: `Review count (${reviewCount}) below minimum (${activeConfig.minReviewsForRecommended}) for RECOMMENDED`,
        cap: newMax
      });
    }
  }

  // 2. Check business registration for high scores
  if (activeConfig.requireRegistrationForHigh) {
    const hasRegistration = dataContext.hasVerifiedRegistration || false;
    if (originalScore >= activeConfig.registrationThreshold && !hasRegistration) {
      const newMax = activeConfig.registrationThreshold - 1;
      if (constrainedScore > newMax) {
        constrainedScore = newMax;
        constraints.push({
          type: 'REGISTRATION_REQUIRED',
          reason: `Business registration not verified (required for ${activeConfig.registrationThreshold}+)`,
          cap: newMax
        });
      }
    }
  }

  // 3. Check for critical data gaps
  const gaps = result.gaps || result.gaps_remaining || [];
  const gapsLower = gaps.map(g => g.toLowerCase());

  const hasCriticalGap = activeConfig.criticalGaps.some(criticalGap =>
    gapsLower.some(gap => gap.includes(criticalGap.toLowerCase()))
  );

  if (hasCriticalGap && constrainedScore > activeConfig.dataGapCeiling) {
    constrainedScore = activeConfig.dataGapCeiling;
    constraints.push({
      type: 'DATA_GAP_CEILING',
      reason: `Critical data gaps detected, capped at ${activeConfig.dataGapCeiling}`,
      cap: activeConfig.dataGapCeiling,
      gaps: gaps.filter(g =>
        activeConfig.criticalGaps.some(cg => g.toLowerCase().includes(cg.toLowerCase()))
      )
    });
  }

  // Apply the most restrictive constraint
  if (constrainedScore !== originalScore) {
    console.log(`\x1b[33m⚠️ Strict constraint: ${originalScore} → ${constrainedScore}\x1b[0m`);
    for (const c of constraints) {
      console.log(`   ${c.type}: ${c.reason}`);
    }

    result.trust_score = constrainedScore;
    result.strict_constraints = {
      original_score: originalScore,
      constrained_score: constrainedScore,
      constraints_applied: constraints
    };
  }

  // ALWAYS enforce recommendation matches score when strict mode is enabled
  // (Agent may give inconsistent recommendation vs score)
  const expectedRec = constrainedScore < 50 ? 'AVOID' :
    constrainedScore < 80 ? 'NOT_RECOMMENDED' : 'RECOMMENDED';

  if (result.recommendation !== expectedRec) {
    console.log(`\x1b[33m⚠️ Recommendation fix: ${result.recommendation} → ${expectedRec} (score=${constrainedScore})\x1b[0m`);
    result.recommendation = expectedRec;
  }

  // Update risk level to match score
  if (constrainedScore <= 15) result.risk_level = 'CRITICAL';
  else if (constrainedScore <= 35) result.risk_level = 'SEVERE';
  else if (constrainedScore < 80) result.risk_level = 'MODERATE';
  else result.risk_level = 'TRUSTED';

  return result;
}

/**
 * Extract data context from database for constraint checking
 *
 * @param {Object} db - Database connection
 * @param {number} contractorId - Contractor ID
 * @returns {Object} - Data context for constraints
 */
async function extractDataContext(db, contractorId) {
  const context = {
    reviewCount: 0,
    hasVerifiedRegistration: false
  };

  // Helper to parse structured_data (handles both JSONB objects and strings)
  const parseData = (structuredData) => {
    if (!structuredData) return null;
    if (typeof structuredData === 'object') return structuredData;
    try {
      return JSON.parse(structuredData);
    } catch (e) {
      return null;
    }
  };

  try {
    // Get Google Maps review data
    const googleRows = await db.exec(`
      SELECT structured_data
      FROM contractor_raw_data
      WHERE contractor_id = ?
      AND source_name IN ('google_maps', 'google_maps_local', 'google_maps_hq')
      AND fetch_status = 'success'
    `, [contractorId]);

    let totalReviews = 0;
    for (const row of googleRows) {
      const data = parseData(row.structured_data);
      if (data) {
        // Handle different data formats
        const count = data.review_count || data.reviewCount || data.reviews?.length || 0;
        totalReviews += parseInt(count) || 0;
      }
    }

    // Also check Angi, Yelp for additional review counts
    const otherRows = await db.exec(`
      SELECT structured_data, source_name
      FROM contractor_raw_data
      WHERE contractor_id = ?
      AND source_name IN ('angi', 'yelp', 'yelp_yahoo', 'houzz')
      AND fetch_status = 'success'
    `, [contractorId]);

    for (const row of otherRows) {
      const data = parseData(row.structured_data);
      if (data) {
        const count = data.review_count || data.reviewCount || data.reviews?.length || 0;
        totalReviews += parseInt(count) || 0;
      }
    }

    context.reviewCount = totalReviews;

    // Check for business registration
    const regRows = await db.exec(`
      SELECT structured_data, fetch_status
      FROM contractor_raw_data
      WHERE contractor_id = ?
      AND source_name IN ('tx_franchise', 'tx_sos', 'business_registration')
      AND fetch_status = 'success'
    `, [contractorId]);

    for (const row of regRows) {
      const data = parseData(row.structured_data);
      if (data) {
        // Check for active status indicators
        if (data.status === 'active' || data.status === 'Active' ||
            data.taxpayer_number || data.filing_number ||
            data.right_to_transact === true) {
          context.hasVerifiedRegistration = true;
          break;
        }
      }
    }
  } catch (err) {
    console.error('Error extracting data context:', err.message);
  }

  return context;
}

/**
 * Enforce lien-based score caps
 * Code-level enforcement that the LLM CANNOT override
 *
 * @param {number} baseScore - The score from the LLM
 * @param {Object} lienData - Lien score data from database
 * @returns {Object} - { score, wasCapped, maxAllowed, reason }
 */
function enforceLienCaps(baseScore, lienData) {
    if (!lienData || !lienData.lien_score) {
        return {
            score: baseScore,
            wasCapped: false,
            maxAllowed: 100,
            reason: null
        };
    }

    const lienScore = lienData.lien_score;
    const againstCount = Math.max(0, lienScore.liens_against_count || lienScore.liens_against_contractor?.length || 0);
    const notes = lienScore.notes || [];
    const hasTaxLien = notes.some(n => typeof n === 'string' && n.toLowerCase().includes('tax lien'));

    let maxScore = 100;
    const reasons = [];

    // Liens AGAINST contractor = they didn't pay someone
    if (againstCount >= 3) {
        maxScore = 35;
        reasons.push(`${againstCount} liens filed AGAINST contractor (pattern of non-payment)`);
    } else if (againstCount >= 1) {
        maxScore = 70;
        reasons.push(`${againstCount} lien(s) filed AGAINST contractor (payment issues)`);
    }

    // Tax liens are critical
    if (hasTaxLien) {
        maxScore = Math.min(maxScore, 15);
        reasons.push('Tax lien against contractor (CRITICAL)');
    }

    // Liens BY contractor = no penalty (they filed to collect, normal business)

    const cappedScore = Math.min(baseScore, maxScore);
    const reason = reasons.length > 0 ? reasons.join(' + ') : null;

    if (cappedScore < baseScore) {
        console.log(`\x1b[33m⚠️ Lien cap: ${baseScore} → ${cappedScore}\x1b[0m`);
        console.log(`   LIEN_CAP: ${reason}`);
    }

    return {
        score: cappedScore,
        wasCapped: cappedScore < baseScore,
        maxAllowed: maxScore,
        reason: reason
    };
}

module.exports = {
  configure,
  getConfig,
  enable,
  disable,
  applyConstraints,
  extractDataContext,
  enforceLienCaps,
  DEFAULT_CONFIG
};
