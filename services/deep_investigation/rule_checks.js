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
    let data;
    try {
      data = typeof bbbData.structured_data === 'string'
        ? JSON.parse(bbbData.structured_data)
        : bbbData.structured_data;
    } catch (e) {
      data = null;
    }
    if (!data) return flags;
    // Priority: founding_date (exact) > years_in_business (calculated) > start_date (legacy)
    if (data.founding_date) {
      // founding_date format: "MM/DD/YYYY" e.g., "09/25/2024"
      const parts = data.founding_date.split('/');
      if (parts.length === 3) {
        bbbStartYear = parseInt(parts[2]);
      }
    } else if (data.years_in_business) {
      bbbStartYear = new Date().getFullYear() - parseInt(data.years_in_business);
    } else if (data.start_date) {
      bbbStartYear = parseInt(data.start_date.substring(0, 4));
    }
  }

  // Extract claims from multiple sources (website, Google Maps, HomeAdvisor, Angi, etc.)
  let allClaims = [];
  const claimSources = ['website', 'google_maps', 'homeadvisor', 'angi', 'angies_list', 'houzz', 'thumbtack'];
  for (const sourceName of claimSources) {
    const sourceData = rawData?.find(r =>
      r.source_name === sourceName || r.source_name?.startsWith(sourceName)
    );
    if (sourceData?.raw_text) {
      const claims = extractYearsClaimed(sourceData.raw_text);
      if (claims) {
        allClaims.push(...claims.map(c => ({ ...c, source: sourceName })));
      }
    }
    // Also check structured_data for years_in_business claims
    if (sourceData?.structured_data) {
      let data;
      try {
        data = typeof sourceData.structured_data === 'string'
          ? JSON.parse(sourceData.structured_data)
          : sourceData.structured_data;
      } catch (e) {
        data = null;
      }
      if (data?.years_in_business && typeof data.years_in_business === 'number') {
        allClaims.push({
          type: 'years_experience',
          years_claimed: data.years_in_business,
          year: new Date().getFullYear() - data.years_in_business,
          raw: `${data.years_in_business} years (from ${sourceName})`,
          source: sourceName
        });
      }
    }
  }

  // Compare claims vs BBB (if we have both)
  if (bbbStartYear && allClaims.length > 0) {
    const maxClaim = allClaims.reduce((max, c) => c.years_claimed > max.years_claimed ? c : max, allClaims[0]);
    const maxClaimedYears = maxClaim.years_claimed;
    const claimedStartYear = new Date().getFullYear() - maxClaimedYears;
    const discrepancy = bbbStartYear - claimedStartYear;
    const bbbYearsInBusiness = new Date().getFullYear() - bbbStartYear;

    if (discrepancy > 10) {
      flags.push({
        severity: SEVERITY.CRITICAL,
        category: 'timeline_fabrication',
        description: `FRAUD: Claims ${maxClaimedYears} years in business (since ~${claimedStartYear}) but BBB shows founded ${bbbStartYear} (${discrepancy} year fabrication). Source: ${maxClaim.source || 'unknown'}`,
        evidence: {
          bbb_start_year: bbbStartYear,
          bbb_years_in_business: bbbYearsInBusiness,
          claimed_years: maxClaimedYears,
          claimed_start_year: claimedStartYear,
          discrepancy_years: discrepancy,
          claim_source: maxClaim.source,
          raw_claim: maxClaim.raw,
          all_claims: allClaims
        }
      });
    } else if (discrepancy > 5) {
      flags.push({
        severity: SEVERITY.SEVERE,
        category: 'timeline_discrepancy',
        description: `Major timeline discrepancy: claims ${maxClaimedYears} years but BBB shows ${bbbYearsInBusiness} years (${discrepancy} year gap). Source: ${maxClaim.source || 'unknown'}`,
        evidence: {
          bbb_start_year: bbbStartYear,
          bbb_years_in_business: bbbYearsInBusiness,
          claimed_years: maxClaimedYears,
          claimed_start_year: claimedStartYear,
          discrepancy_years: discrepancy,
          claim_source: maxClaim.source,
          all_claims: allClaims
        }
      });
    } else if (discrepancy > 2) {
      flags.push({
        severity: SEVERITY.MODERATE,
        category: 'timeline_minor_discrepancy',
        description: `Minor timeline discrepancy: claims ${maxClaimedYears} years, BBB shows ${bbbYearsInBusiness} years`,
        evidence: {
          bbb_start_year: bbbStartYear,
          claimed_years: maxClaimedYears,
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
    let data;
    try {
      data = typeof buildzoomData.structured_data === 'string'
        ? JSON.parse(buildzoomData.structured_data)
        : buildzoomData.structured_data;
    } catch (e) {
      data = null;
    }
    if (data) {
      permitCount = data.permit_count || 0;
    }
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
      let parsed;
      try {
        parsed = typeof data.structured_data === 'string'
          ? JSON.parse(data.structured_data)
          : data.structured_data;
      } catch (e) {
        parsed = null;
      }
      if (!parsed) {
        sourcesMissing.push(sourceName);
        continue;
      }

      // Check for reviews in multiple formats:
      // 1. Standard format: { found: true, review_count: N, rating: X }
      // 2. Serper format: { results: [{ rating: X, ratingCount: N }] }
      let hasReviews = false;

      // Standard format
      if (parsed.found && (parsed.review_count > 0 || parsed.rating)) {
        hasReviews = true;
      }

      // Serper results array format (used by Yelp, etc.)
      if (parsed.results && Array.isArray(parsed.results)) {
        const resultWithReviews = parsed.results.find(r =>
          (r.ratingCount && r.ratingCount > 0) || (r.rating && r.rating > 0)
        );
        if (resultWithReviews) {
          hasReviews = true;
        }
      }

      if (hasReviews) {
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
function runRuleChecks(contractor, rawData) {
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

  // 3. Permit ground truth check - DISABLED
  // BuildZoom data is incomplete - many cities not covered, permits under different names
  // Re-enable once we have our own permit scraping integrated
  // const permitFlags = checkPermitGroundTruth(contractor, rawData);
  // results.flags.push(...permitFlags);
  // results.summary.permits = { flags: permitFlags.length, details: permitFlags };
  results.summary.permits = { flags: 0, details: [], disabled: true };

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
