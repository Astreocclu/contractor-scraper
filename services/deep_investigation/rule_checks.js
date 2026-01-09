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
