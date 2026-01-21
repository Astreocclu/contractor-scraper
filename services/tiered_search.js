/**
 * Tiered Search
 *
 * Orchestrates multi-tier Google search with validation and circuit breaker.
 *
 * Tiers:
 * 1. Primary location (contractor's city)
 * 2. Add trade to query
 * 3. Disambiguate with license/owner
 * 4. Fallback to nearby DFW cities
 * 5. Phone number search
 */

const CircuitBreaker = require('opossum');
const Bottleneck = require('bottleneck');
const { LocationResolver } = require('./location_resolver');
const { BusinessValidator } = require('./business_validator');
const { DFW_MAJOR_CITIES } = require('./dfw_cities');
const db = require('./db_pg');

// Rate limiter: 2 requests/sec max to avoid API throttling
const limiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 500
});

// Circuit breaker configuration (can be overridden via env vars)
const breakerOptions = {
  timeout: parseInt(process.env.SEARCH_TIMEOUT || '15000'),
  errorThresholdPercentage: parseInt(process.env.CIRCUIT_ERROR_THRESHOLD || '50'),
  resetTimeout: parseInt(process.env.CIRCUIT_RESET_TIMEOUT || '30000'),
  volumeThreshold: 5
};

class TieredSearch {
  /**
   * @param {Function} searchFn - The underlying search function (e.g., scrapeGoogleReviewsTiered)
   */
  constructor(searchFn) {
    this.resolver = new LocationResolver();
    this.validator = new BusinessValidator();
    this.searchFn = searchFn;
    this.breaker = new CircuitBreaker(this.wrappedSearch.bind(this), breakerOptions);

    // Circuit breaker events for logging
    this.breaker.on('open', () => console.log('[Circuit] OPEN - Google API failing, requests will be rejected'));
    this.breaker.on('halfOpen', () => console.log('[Circuit] HALF-OPEN - Testing if API is back'));
    this.breaker.on('close', () => console.log('[Circuit] CLOSED - API restored, normal operation'));
  }

  /**
   * Wrapped search function for circuit breaker
   */
  async wrappedSearch(query, location, maxReviews = 100) {
    return this.searchFn(query, location, maxReviews);
  }

  /**
   * Execute tiered search with validation
   * @param {Object} contractor - DB contractor record
   * @returns {Object} { result, tier, attempts, confidence, autoApprove, needsReview }
   */
  async search(contractor) {
    const attempts = [];
    const location = this.resolver.resolve(contractor);
    const businessName = contractor.business_name || contractor.name;

    // Tier 1: Primary location (contractor's city)
    let result = await this.attemptSearch(businessName, `${location.city}, ${location.state}`);
    attempts.push({
      tier: 1,
      query: businessName,
      location: `${location.city}, ${location.state}`,
      found: result?.found || false
    });

    if (result?.found) {
      const validation = this.validator.isConfidentMatch(contractor, result);
      if (validation.match) {
        return this.buildResult(result, 1, attempts, validation, location);
      }
      attempts[attempts.length - 1].validation = validation;
    }

    // Tier 2: Add trade to query
    if (contractor.trade) {
      const tradeQuery = `${businessName} ${contractor.trade}`.trim();
      result = await this.attemptSearch(tradeQuery, `${location.city}, ${location.state}`);
      attempts.push({
        tier: 2,
        query: tradeQuery,
        location: `${location.city}, ${location.state}`,
        found: result?.found || false
      });

      if (result?.found) {
        const validation = this.validator.isConfidentMatch(contractor, result);
        if (validation.match) {
          return this.buildResult(result, 2, attempts, validation, location);
        }
        attempts[attempts.length - 1].validation = validation;
      }
    }

    // Tier 3: Disambiguate with license or owner name
    if (contractor.license_number || contractor.owner_name) {
      const disambigQuery = contractor.license_number
        ? `${businessName} license ${contractor.license_number}`
        : `${businessName} ${contractor.owner_name}`;
      result = await this.attemptSearch(disambigQuery, `${location.city}, ${location.state}`);
      attempts.push({
        tier: 3,
        query: disambigQuery,
        location: `${location.city}, ${location.state}`,
        found: result?.found || false
      });

      if (result?.found) {
        const validation = this.validator.isConfidentMatch(contractor, result);
        if (validation.match) {
          return this.buildResult(result, 3, attempts, validation, location);
        }
        attempts[attempts.length - 1].validation = validation;
      }
    }

    // Tier 4: Fallback to nearby DFW cities (limit to 3)
    const fallbacks = location.fallbackLocations || DFW_MAJOR_CITIES.filter(c => c !== location.city).slice(0, 3);
    for (const city of fallbacks) {
      result = await this.attemptSearch(businessName, `${city}, TX`);
      attempts.push({
        tier: 4,
        query: businessName,
        location: `${city}, TX`,
        found: result?.found || false
      });

      if (result?.found) {
        const validation = this.validator.isConfidentMatch(contractor, result);
        if (validation.match) {
          return this.buildResult(result, 4, attempts, validation, location);
        }
        attempts[attempts.length - 1].validation = validation;
      }
    }

    // Tier 5: Phone number search (last resort)
    if (contractor.phone) {
      const phoneDigits = contractor.phone.replace(/\D/g, '');
      result = await this.attemptSearch(phoneDigits, 'Texas');
      attempts.push({
        tier: 5,
        query: phoneDigits,
        location: 'Texas',
        method: 'phone',
        found: result?.found || false
      });

      if (result?.found) {
        const validation = this.validator.isConfidentMatch(contractor, result);
        if (validation.match) {
          return this.buildResult(result, 5, attempts, validation, location);
        }
        attempts[attempts.length - 1].validation = validation;
      }
    }

    // All tiers exhausted - no match found
    return this.handleZeroResults(contractor, attempts);
  }

  /**
   * Attempt a single search with rate limiting and circuit breaker
   */
  async attemptSearch(query, location, maxReviews = 100) {
    try {
      return await limiter.schedule(() => this.breaker.fire(query, location, maxReviews));
    } catch (err) {
      if (err.message && err.message.includes('Breaker is open')) {
        console.log(`[Circuit] Open - skipping search for "${query}"`);
        return { found: false, error: 'CIRCUIT_OPEN', circuitOpen: true };
      }
      console.error(`[Search] Error for "${query}": ${err.message}`);
      return { found: false, error: err.message };
    }
  }

  /**
   * Build successful result object
   */
  buildResult(result, tier, attempts, validation, resolvedLocation) {
    return {
      result: {
        ...result,
        search_tier: tier,
        search_confidence: validation.confidence,
        location_searched: attempts[attempts.length - 1].location,
        location_source: resolvedLocation.source
      },
      tier,
      attempts,
      confidence: validation.confidence,
      autoApprove: validation.autoApprove || false,
      needsReview: validation.needsReview || false,
      scores: validation.scores,
      reasons: validation.reasons
    };
  }

  /**
   * Handle case where all tiers failed to find a match
   */
  async handleZeroResults(contractor, attempts) {
    // Log to search_failures table for pattern analysis
    try {
      await db.exec(`
        INSERT INTO search_failures (contractor_id, attempts)
        VALUES ($1, $2)
      `, [contractor.id, JSON.stringify(attempts)]);
    } catch (err) {
      console.error(`[TieredSearch] Failed to log search failure: ${err.message}`);
    }

    // Mark contractor for manual research
    try {
      await db.exec(`
        UPDATE contractors_contractor
        SET needs_manual_search = true, search_notes = $2
        WHERE id = $1
      `, [contractor.id, `All ${attempts.length} search tiers failed at ${new Date().toISOString()}`]);
    } catch (err) {
      console.error(`[TieredSearch] Failed to update contractor: ${err.message}`);
    }

    return {
      result: null,
      tier: null,
      attempts,
      confidence: 0,
      notFound: true,
      action: 'MANUAL_RESEARCH_REQUIRED'
    };
  }

  /**
   * Get circuit breaker status
   */
  getCircuitStatus() {
    return {
      state: this.breaker.opened ? 'OPEN' : (this.breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED'),
      stats: this.breaker.stats
    };
  }
}

module.exports = { TieredSearch };
