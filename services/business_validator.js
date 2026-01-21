/**
 * Business Validator
 *
 * Validates that scraped business data matches the expected contractor.
 * Uses name similarity, category matching, location proximity, phone, and address.
 *
 * Decision thresholds:
 * - >= 0.80: Auto-approve (high confidence match)
 * - 0.60-0.79: Needs manual review
 * - 0.40-0.59: Low confidence, rejected
 * - < 0.40: Rejected
 */

const levenshtein = require('fast-levenshtein');
const { isDFWCity } = require('./dfw_cities');

class BusinessValidator {
  constructor() {
    // Trade to valid categories mapping (positive signals)
    this.TRADE_CATEGORIES = {
      'foundation': ['foundation', 'concrete', 'masonry', 'construction', 'structural', 'pier', 'leveling'],
      'pool': ['pool', 'spa', 'swimming', 'aquatic', 'water feature'],
      'roofing': ['roof', 'roofing', 'shingle', 'construction', 'contractor'],
      'plumbing': ['plumber', 'plumbing', 'pipe', 'drain', 'sewer', 'water heater'],
      'electrical': ['electric', 'electrical', 'electrician', 'wiring', 'panel'],
      'hvac': ['hvac', 'heating', 'air conditioning', 'cooling', 'ac', 'furnace'],
      'patio': ['patio', 'outdoor', 'landscape', 'deck', 'pergola', 'cover'],
      'fence': ['fence', 'fencing', 'gate', 'wood fence', 'iron fence'],
      'remodel': ['remodel', 'renovation', 'construction', 'contractor', 'home improvement'],
      'general': ['contractor', 'construction', 'home improvement', 'handyman']
    };

    // Negative categories - automatic rejection if matched
    this.NEGATIVE_CATEGORIES = {
      'foundation': ['auto', 'mechanic', 'car', 'vehicle', 'restaurant', 'retail', 'food', 'salon', 'spa', 'nail'],
      'pool': ['auto', 'mechanic', 'car', 'vehicle', 'office', 'retail', 'food', 'salon', 'billiard'],
      'roofing': ['auto', 'mechanic', 'car', 'vehicle', 'restaurant', 'retail', 'food', 'salon'],
      'plumbing': ['auto', 'mechanic', 'car', 'vehicle', 'restaurant', 'retail', 'food', 'salon'],
      'electrical': ['auto', 'mechanic', 'car', 'vehicle', 'restaurant', 'retail', 'food', 'salon'],
      'hvac': ['auto', 'mechanic', 'car', 'vehicle', 'restaurant', 'retail', 'food', 'salon'],
      'patio': ['auto', 'mechanic', 'car', 'vehicle', 'restaurant', 'retail', 'food', 'salon'],
      'fence': ['auto', 'mechanic', 'car', 'vehicle', 'restaurant', 'retail', 'food', 'salon'],
      'remodel': ['auto', 'mechanic', 'car', 'vehicle', 'restaurant', 'retail', 'food', 'salon'],
      'general': ['auto', 'mechanic', 'car', 'vehicle', 'restaurant', 'food', 'salon']
    };
  }

  /**
   * Check if scraped result matches contractor
   * @param {Object} contractor - DB contractor record
   * @param {Object} scraped - Serper/SerpApi result
   * @returns {Object} { match, confidence, autoApprove, needsReview, reasons, scores }
   */
  isConfidentMatch(contractor, scraped) {
    if (!scraped || !scraped.name) {
      return {
        match: false,
        confidence: 0,
        rejected: true,
        reasons: ['No scraped data'],
        scores: {}
      };
    }

    // Support both 'business_name' and 'name' field naming
    const businessName = contractor.business_name || contractor.name;

    const scores = {
      name: this.nameScore(businessName, scraped.name),
      category: this.categoryScore(contractor.trade, scraped.categories || scraped.types || []),
      location: this.locationScore(contractor.city, scraped.address || scraped.city),
      phone: this.phoneScore(contractor.phone, scraped.phone),
      address: this.addressScore(contractor.address, scraped.address)
    };

    const reasons = [];

    // Check for automatic rejection (negative categories)
    if (scores.category === -1) {
      return {
        match: false,
        confidence: 0,
        rejected: true,
        reasons: [`Category mismatch: scraped business appears to be ${this.extractCategory(scraped)}`],
        scores
      };
    }

    // Weighted confidence score
    const confidence =
      scores.name * 0.30 +
      scores.category * 0.25 +
      scores.location * 0.15 +
      scores.phone * 0.15 +
      scores.address * 0.15;

    // Build reasons for low scores
    if (scores.name < 0.5) {
      reasons.push(`Name mismatch: "${scraped.name}" vs "${businessName}" (${(scores.name * 100).toFixed(0)}%)`);
    }
    if (scores.category < 0.5 && scores.category !== -1) {
      reasons.push(`Category uncertain: ${this.extractCategory(scraped)}`);
    }
    if (scores.location < 0.5) {
      reasons.push(`Location mismatch: scraped from ${scraped.address || scraped.city || 'unknown'}`);
    }
    if (scores.phone < 0.3 && contractor.phone && scraped.phone) {
      reasons.push(`Phone mismatch: ${scraped.phone} vs ${contractor.phone}`);
    }

    // Decision matrix
    if (confidence >= 0.80) {
      return { match: true, confidence, autoApprove: true, reasons, scores };
    }
    if (confidence >= 0.60) {
      return { match: true, confidence, needsReview: true, reasons, scores };
    }
    if (confidence >= 0.40) {
      return { match: false, confidence, lowConfidence: true, reasons, scores };
    }
    return { match: false, confidence, rejected: true, reasons, scores };
  }

  /**
   * Extract category string from scraped result
   */
  extractCategory(scraped) {
    const cats = scraped.categories || scraped.types || [];
    if (Array.isArray(cats) && cats.length > 0) {
      return cats.slice(0, 2).join(', ');
    }
    return 'unknown';
  }

  /**
   * Calculate name similarity score (0-1)
   */
  nameScore(dbName, scrapedName) {
    if (!dbName || !scrapedName) return 0;

    const norm1 = this.normalizeName(dbName);
    const norm2 = this.normalizeName(scrapedName);

    // Exact match
    if (norm1 === norm2) return 1.0;

    // Contains check (one contains the other)
    if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.85;

    // Word overlap check
    const words1 = new Set(norm1.split(/\s+/));
    const words2 = new Set(norm2.split(/\s+/));
    const intersection = [...words1].filter(w => words2.has(w) && w.length > 2);
    const wordOverlap = intersection.length / Math.max(words1.size, words2.size);
    if (wordOverlap >= 0.6) return 0.70 + (wordOverlap * 0.15);

    // Levenshtein distance
    const distance = levenshtein.get(norm1, norm2);
    const maxLen = Math.max(norm1.length, norm2.length);
    const similarity = 1 - (distance / maxLen);

    return Math.max(0, similarity);
  }

  /**
   * Normalize business name for comparison
   */
  normalizeName(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')  // Remove punctuation
      .replace(/\b(llc|inc|corp|co|ltd|company|services|service|and|the)\b/g, '')  // Remove common suffixes
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculate category match score (0, 0.5, 1, or -1 for rejection)
   */
  categoryScore(trade, scrapedCategories) {
    if (!scrapedCategories || scrapedCategories.length === 0) return 0.5; // Neutral if no categories

    const normalizedTrade = (trade || 'general').toLowerCase();
    const normalizedCategories = Array.isArray(scrapedCategories)
      ? scrapedCategories.map(c => String(c).toLowerCase())
      : [String(scrapedCategories).toLowerCase()];
    const categoryText = normalizedCategories.join(' ');

    // Check for negative categories first (auto-reject)
    const negatives = this.NEGATIVE_CATEGORIES[normalizedTrade] || this.NEGATIVE_CATEGORIES['general'];
    for (const neg of negatives) {
      if (categoryText.includes(neg)) {
        return -1; // Signal for rejection
      }
    }

    // Check for positive categories
    const positives = this.TRADE_CATEGORIES[normalizedTrade] || this.TRADE_CATEGORIES['general'];
    for (const pos of positives) {
      if (categoryText.includes(pos)) {
        return 1.0;
      }
    }

    // Generic contractor/construction is neutral-positive
    if (categoryText.includes('contractor') || categoryText.includes('construction') || categoryText.includes('home')) {
      return 0.6;
    }

    return 0.3; // No match but not rejected
  }

  /**
   * Calculate location proximity score (0-1)
   */
  locationScore(dbCity, scrapedLocation) {
    if (!dbCity || !scrapedLocation) return 0.5; // Neutral if missing

    const normDb = dbCity.toLowerCase().trim();
    const normScraped = scrapedLocation.toLowerCase();

    // Exact city match
    if (normScraped.includes(normDb)) return 1.0;

    // Both in DFW is acceptable
    if (isDFWCity(dbCity) && this.containsDFWCity(scrapedLocation)) return 0.7;

    // TX but different city
    if (normScraped.includes('tx') || normScraped.includes('texas')) return 0.3;

    return 0.0;
  }

  /**
   * Check if address contains any DFW city
   */
  containsDFWCity(address) {
    const DFW_NAMES = [
      'dallas', 'fort worth', 'plano', 'arlington', 'frisco', 'irving',
      'garland', 'mckinney', 'richardson', 'carrollton', 'denton',
      'lewisville', 'allen', 'flower mound', 'mesquite', 'grand prairie',
      'cedar hill', 'rowlett', 'rockwall', 'southlake', 'keller', 'grapevine'
    ];
    const norm = address.toLowerCase();
    return DFW_NAMES.some(city => norm.includes(city));
  }

  /**
   * Calculate phone match score (0-1)
   */
  phoneScore(dbPhone, scrapedPhone) {
    if (!dbPhone || !scrapedPhone) return 0.5; // Neutral if missing

    const norm1 = String(dbPhone).replace(/\D/g, '');
    const norm2 = String(scrapedPhone).replace(/\D/g, '');

    if (!norm1 || !norm2) return 0.5;

    // Exact match (last 10 digits)
    if (norm1.slice(-10) === norm2.slice(-10)) return 1.0;

    // Last 7 digits match (local number)
    if (norm1.slice(-7) === norm2.slice(-7)) return 0.8;

    // Area code match only
    if (norm1.substring(0, 3) === norm2.substring(0, 3)) return 0.3;

    return 0.0;
  }

  /**
   * Calculate address match score (0-1)
   */
  addressScore(dbAddress, scrapedAddress) {
    if (!dbAddress || !scrapedAddress) return 0.5; // Neutral if missing

    const norm1 = this.normalizeAddress(dbAddress);
    const norm2 = this.normalizeAddress(scrapedAddress);

    // Street number and name match
    if (norm1.number && norm2.number && norm1.street && norm2.street) {
      if (norm1.number === norm2.number && norm1.street === norm2.street) {
        return 1.0;
      }
      if (norm1.street === norm2.street) {
        return 0.7;
      }
      // Same street number, different street
      if (norm1.number === norm2.number) {
        return 0.4;
      }
    }

    return 0.3;
  }

  /**
   * Normalize address for comparison
   */
  normalizeAddress(address) {
    const norm = String(address).toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct|circle|cir)\b/g, '')
      .trim();

    const match = norm.match(/^(\d+)\s+(.+)/);
    if (match) {
      return {
        number: match[1],
        street: match[2].split(/\s+(apt|suite|ste|unit|#|\d)/)[0].trim()
      };
    }
    return { number: null, street: norm };
  }
}

module.exports = { BusinessValidator };
