/**
 * Collection Service
 *
 * Handles all data collection (Puppeteer scraping, API calls, form submissions).
 * Stores raw data to SQLite with cache TTL.
 */

const puppeteer = require('puppeteer');
const { searchTDLR } = require('../lib/tdlr_scraper');
const { searchCourtRecords } = require('../lib/court_scraper');
const { fetchAPISources } = require('../lib/api_sources');
const { analyzeReviews, quickDiscrepancyCheck } = require('./review_analyzer');

// Source definitions with cache TTL (in seconds)
const SOURCES = {
  // Tier 1: Reviews (cache 24h)
  bbb:       { ttl: 86400, tier: 1, type: 'url' },
  yelp:      { ttl: 86400, tier: 1, type: 'url' },
  google_maps: { ttl: 86400, tier: 1, type: 'url' },
  angi:      { ttl: 86400, tier: 1, type: 'url' },
  houzz:     { ttl: 86400, tier: 1, type: 'url' },
  thumbtack: { ttl: 86400, tier: 1, type: 'url' },
  facebook:  { ttl: 86400, tier: 1, type: 'url' },

  // Tier 2: News (cache 12h)
  google_news: { ttl: 43200, tier: 2, type: 'url' },
  local_news:  { ttl: 43200, tier: 2, type: 'url' },

  // Tier 3: Social (cache 24h)
  reddit:   { ttl: 86400, tier: 3, type: 'url' },
  youtube:  { ttl: 86400, tier: 3, type: 'url' },
  nextdoor_search: { ttl: 86400, tier: 3, type: 'url' },

  // Tier 4: Employee (cache 7d)
  indeed:    { ttl: 604800, tier: 4, type: 'url' },
  glassdoor: { ttl: 604800, tier: 4, type: 'url' },

  // Tier 5: Government (cache 7d)
  osha:     { ttl: 604800, tier: 5, type: 'url' },
  epa_echo: { ttl: 604800, tier: 5, type: 'url' },

  // Tier 6: TX-Specific (cache 7d)
  tdlr:            { ttl: 604800, tier: 6, type: 'form' },
  tx_ag_complaints: { ttl: 604800, tier: 6, type: 'url' },
  tx_sos_search:   { ttl: 604800, tier: 6, type: 'url' },
  tx_franchise:    { ttl: 604800, tier: 6, type: 'api' },

  // Tier 7: Courts (cache 7d)
  court_records:   { ttl: 604800, tier: 7, type: 'scraper' },
  tarrant_court:   { ttl: 604800, tier: 7, type: 'url' },
  dallas_court:    { ttl: 604800, tier: 7, type: 'url' },
  collin_court:    { ttl: 604800, tier: 7, type: 'url' },
  denton_court:    { ttl: 604800, tier: 7, type: 'url' },
  court_listener:  { ttl: 604800, tier: 7, type: 'api' },

  // Tier 8: Industry (cache 24h)
  porch:       { ttl: 86400, tier: 8, type: 'url' },
  buildzoom:   { ttl: 86400, tier: 8, type: 'url' },
  homeadvisor: { ttl: 86400, tier: 8, type: 'url' },

  // Website (cache 24h)
  website: { ttl: 86400, tier: 0, type: 'url' },
};

// Logging helpers
const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Parse BBB search results to extract structured data
 */
function parseBBBResults(text, contractorName) {
  const result = {
    found: false,
    rating: null,
    accredited: false,
    complaint_count: null,
    years_in_business: null,
    locations_count: 0,
    raw_matches: []
  };

  if (!text) return result;

  // Normalize contractor name for matching - require key distinctive words
  const nameLower = contractorName.toLowerCase();
  // Filter to meaningful words (not "roofing", "construction", "llc", etc.)
  const commonWords = ['roofing', 'construction', 'llc', 'inc', 'corp', 'company', 'co', 'services', 'contractors'];
  const nameWords = nameLower.split(/\s+/).filter(w => w.length > 2 && !commonWords.includes(w));

  const textLower = text.toLowerCase();

  // Look for BBB Rating patterns near contractor name
  // Pattern: "CompanyName ... BBB Rating: X" within reasonable distance
  const ratingRegex = /BBB Rating:\s*([A-F][+-]?)/gi;
  let ratingMatch;

  while ((ratingMatch = ratingRegex.exec(text)) !== null) {
    const rating = ratingMatch[1];
    const matchIndex = ratingMatch.index;

    // Check 300 chars before the rating for contractor name
    const contextStart = Math.max(0, matchIndex - 300);
    const contextEnd = Math.min(text.length, matchIndex + 50);
    const context = textLower.substring(contextStart, contextEnd);

    // Require ALL distinctive name words to appear (stricter matching)
    const nameWordsFound = nameWords.filter(w => context.includes(w)).length;
    const allKeyWordsPresent = nameWordsFound === nameWords.length;

    // Also check that this isn't an ad (ads have "advertisement:" or "Ad Why are there ads" nearby)
    const isAd = context.includes('advertisement:') || context.includes('ad why are there ads');

    if (allKeyWordsPresent && !isAd) {
      result.found = true;
      result.raw_matches.push({
        rating,
        context: context.substring(Math.max(0, context.length - 200))
      });

      // Use the worst rating found (most conservative)
      if (!result.rating || ratingToScore(rating) < ratingToScore(result.rating)) {
        result.rating = rating;
      }
    }
  }

  // Check for accreditation - only if we found the business
  // Look for accreditation status near the business name, not globally
  if (result.found) {
    // F-rated businesses are typically NOT accredited
    // Only mark as accredited if explicitly stated near the business listing
    result.accredited = false; // Default to false, safer assumption

    // Look for explicit accreditation mention with the business name nearby
    const accreditedMatches = textLower.match(/orange.*elephant.*bbb accredited|bbb accredited.*orange.*elephant/i);
    if (accreditedMatches) {
      result.accredited = true;
    }
  }

  // Look for complaint count
  const complaintMatch = text.match(/(\d+)\s*complaints?\s*(closed|filed|in last)/i);
  if (complaintMatch) {
    result.complaint_count = parseInt(complaintMatch[1]);
  }

  // Look for years in business
  const yearsMatch = text.match(/(\d+)\s*years?\s*in\s*business/i);
  if (yearsMatch) {
    result.years_in_business = parseInt(yearsMatch[1]);
  }

  // Count unique locations (deduplicate by rating)
  if (result.found) {
    result.locations_count = result.raw_matches.filter(m => m.rating === result.rating).length;
  }

  return result;
}

// Helper to convert BBB rating to numeric score for comparison
function ratingToScore(rating) {
  const scores = { 'A+': 10, 'A': 9, 'A-': 8, 'B+': 7, 'B': 6, 'B-': 5, 'C+': 4, 'C': 3, 'C-': 2, 'D+': 1, 'D': 0, 'D-': -1, 'F': -2 };
  return scores[rating] ?? 0;
}

/**
 * Parse Google Maps search results
 */
function parseGoogleMapsResults(text, contractorName) {
  const result = {
    found: false,
    rating: null,
    review_count: null,
    business_name: null,
    status: null
  };

  if (!text) return result;

  const nameLower = contractorName.toLowerCase();
  const textLower = text.toLowerCase();

  // Check if contractor name appears
  const commonWords = ['roofing', 'construction', 'llc', 'inc', 'corp', 'company', 'services'];
  const nameWords = nameLower.split(/\s+/).filter(w => w.length > 2 && !commonWords.includes(w));
  const nameFound = nameWords.every(w => textLower.includes(w));

  if (!nameFound) return result;

  result.found = true;

  // Look for rating pattern: "4.8 (35)" or "4.8(35)"
  const ratingMatch = text.match(/(\d\.\d)\s*\((\d+)\)/);
  if (ratingMatch) {
    result.rating = parseFloat(ratingMatch[1]);
    result.review_count = parseInt(ratingMatch[2]);
  }

  // Check for "No reviews"
  if (textLower.includes('no reviews')) {
    result.status = 'no_reviews';
  }

  // Extract business status (Open/Closed)
  const statusMatch = text.match(/(Open|Closed)\s*·\s*(Closes|Opens)\s+(\d+\s*[AP]M)/i);
  if (statusMatch) {
    result.status = statusMatch[1].toLowerCase();
  }

  return result;
}

/**
 * Parse Glassdoor search results
 */
function parseGlassdoorResults(text, contractorName) {
  const result = {
    found: false,
    rating: null,
    review_count: null,
    salary_count: null
  };

  if (!text) return result;

  const nameLower = contractorName.toLowerCase();
  const textLower = text.toLowerCase();

  // Check if contractor name appears
  const commonWords = ['roofing', 'construction', 'llc', 'inc', 'corp', 'company', 'services'];
  const nameWords = nameLower.split(/\s+/).filter(w => w.length > 2 && !commonWords.includes(w));
  const nameFound = nameWords.every(w => textLower.includes(w));

  if (!nameFound) return result;

  result.found = true;

  // Look for rating pattern: "3.2 ★" or "3.2★"
  const ratingMatch = text.match(/(\d\.\d)\s*★/);
  if (ratingMatch) {
    result.rating = parseFloat(ratingMatch[1]);
  }

  // Look for review count: "79 reviews"
  const reviewMatch = text.match(/(\d+)\s*reviews/i);
  if (reviewMatch) {
    result.review_count = parseInt(reviewMatch[1]);
  }

  // Look for salary count: "111 salaries"
  const salaryMatch = text.match(/(\d+)\s*salaries/i);
  if (salaryMatch) {
    result.salary_count = parseInt(salaryMatch[1]);
  }

  return result;
}

function extractTextContent(html) {
  if (!html) return '';

  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n');

  text = text.replace(/<[^>]+>/g, ' ');

  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  text = text
    .replace(/\s+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

class CollectionService {
  constructor(db) {
    this.db = db;
    this.browser = null;
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    log('Browser launched');
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      log('Browser closed');
    }
  }

  /**
   * Build URLs for all sources
   */
  buildUrls(contractor) {
    const { name, city, state, website, zip } = contractor;
    const encodedName = encodeURIComponent(name);
    const encodedCity = encodeURIComponent(city);
    const encodedState = encodeURIComponent(state);
    const location = `${encodedCity},%20${encodedState}`;
    const nameSlug = toSlug(name);
    const citySlug = toSlug(city);
    const stateLower = state.toLowerCase();

    const urls = {
      bbb: `https://www.bbb.org/search?find_text=${encodedName}&find_loc=${location}`,
      yelp: `https://www.yelp.com/search?find_desc=${encodedName}&find_loc=${encodedCity},%20${encodedState}`,
      google_maps: `https://www.google.com/maps/search/${encodedName}+${encodedCity}+${encodedState}`,
      angi: `https://www.angi.com/search?query=${encodedName}&location=${encodedCity},%20${encodedState}`,
      houzz: `https://www.houzz.com/search/professionals/query/${encodedName}/location/${citySlug}--${stateLower}`,
      thumbtack: zip
        ? `https://www.thumbtack.com/search?query=${encodedName}&zip=${zip}`
        : `https://www.thumbtack.com/search?query=${encodedName}&location=${encodedCity},%20${encodedState}`,
      facebook: `https://www.facebook.com/search/pages?q=${encodedName}%20${encodedCity}`,
      google_news: `https://www.google.com/search?q=${encodedName}+${encodedCity}+lawsuit+OR+complaint&tbm=nws`,
      local_news: `https://www.google.com/search?q=${encodedName}+${encodedCity}+site:dallasnews.com+OR+site:star-telegram.com+OR+site:wfaa.com+OR+site:nbcdfw.com+OR+site:fox4news.com`,
      reddit: `https://www.reddit.com/search/?q=${encodedName}%20${encodedCity}&type=link&sort=relevance`,
      youtube: `https://www.youtube.com/results?search_query=${encodedName}+${encodedCity}+review+OR+complaint`,
      nextdoor_search: `https://www.google.com/search?q=site:nextdoor.com+${encodedName}+${encodedCity}`,
      indeed: `https://www.indeed.com/cmp/${nameSlug}/reviews`,
      glassdoor: `https://www.glassdoor.com/Search/results.htm?keyword=${encodedName}`,
      osha: `https://www.osha.gov/ords/imis/establishment.search?p_logger=1&establishment=${encodedName}&State=${encodedState}`,
      epa_echo: `https://echo.epa.gov/facilities/facility-search/results?search_type=Name&Name=${encodedName}&State=${encodedState}`,
      porch: `https://porch.com/search/contractors?query=${encodedName}&near=${encodedCity}%2C%20${encodedState}`,
      buildzoom: `https://www.buildzoom.com/search?search=${encodedName}&location=${encodedCity}%2C+${encodedState}`,
      homeadvisor: `https://www.homeadvisor.com/rated.${nameSlug}.${citySlug}.${stateLower}.html`,
    };

    // TX-specific sources
    if (state.toUpperCase() === 'TX') {
      urls.tx_ag_complaints = `https://www.google.com/search?q=site:texasattorneygeneral.gov+${encodedName}`;
      urls.tx_sos_search = `https://mycpa.cpa.state.tx.us/coa/coaSearchBtn`;
      urls.tarrant_court = `https://www.google.com/search?q=site:apps.tarrantcounty.com+${encodedName}`;
      urls.dallas_court = `https://www.google.com/search?q=site:dallascounty.org+${encodedName}+civil`;
      urls.collin_court = `https://www.google.com/search?q=site:collincountytx.gov+${encodedName}`;
      urls.denton_court = `https://www.google.com/search?q=site:dentoncounty.gov+${encodedName}`;
    }

    if (website) {
      let normalizedUrl = website.trim();
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = 'https://' + normalizedUrl;
      }
      urls.website = normalizedUrl;
    }

    return urls;
  }

  /**
   * Fetch a single page with Puppeteer
   */
  async fetchPage(url, source, timeout = 20000) {
    const page = await this.browser.newPage();

    try {
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      log(`  Fetching ${source}...`);

      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout
      });

      await sleep(1500);

      const html = await page.content();
      const text = extractTextContent(html);
      success(`    ${source}: ${Math.round(html.length / 1024)}KB -> ${Math.round(text.length / 1024)}KB`);

      return {
        source,
        url,
        status: 'success',
        text,
        structured: null
      };
    } catch (err) {
      warn(`    ${source}: ${err.message.split('\n')[0]}`);
      return {
        source,
        url,
        status: 'error',
        error: err.message,
        text: null,
        structured: null
      };
    } finally {
      await page.close();
    }
  }

  /**
   * Store raw data to database
   */
  storeRawData(contractorId, source, data) {
    const now = new Date().toISOString();
    const ttl = SOURCES[source]?.ttl || 86400;
    const expires = new Date(Date.now() + ttl * 1000).toISOString();

    // Check if exists
    const existing = this.db.exec(
      `SELECT id FROM contractor_raw_data WHERE contractor_id = ? AND source_name = ?`,
      [contractorId, source]
    );

    if (existing.length && existing[0].values.length) {
      // Update existing
      this.db.run(`
        UPDATE contractor_raw_data SET
          source_url = ?, raw_text = ?, structured_data = ?,
          fetch_status = ?, error_message = ?, fetched_at = ?, expires_at = ?
        WHERE contractor_id = ? AND source_name = ?
      `, [
        data.url,
        data.text,
        data.structured ? JSON.stringify(data.structured) : null,
        data.status,
        data.error || null,
        now,
        expires,
        contractorId,
        source
      ]);
    } else {
      // Insert new
      this.db.run(`
        INSERT INTO contractor_raw_data
        (contractor_id, source_name, source_url, raw_text, structured_data, fetch_status, error_message, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        contractorId,
        source,
        data.url,
        data.text,
        data.structured ? JSON.stringify(data.structured) : null,
        data.status,
        data.error || null,
        now,
        expires
      ]);
    }
  }

  /**
   * Log a collection request
   */
  logCollectionRequest(contractorId, source, requestedBy, reason) {
    const now = new Date().toISOString();
    this.db.run(`
      INSERT INTO collection_log (contractor_id, source_name, requested_by, request_reason, status, started_at)
      VALUES (?, ?, ?, ?, 'running', ?)
    `, [contractorId, source, requestedBy, reason, now]);
  }

  /**
   * Get cached data for a source
   */
  getCachedData(contractorId, source) {
    const result = this.db.exec(`
      SELECT raw_text, structured_data, fetch_status, expires_at
      FROM contractor_raw_data
      WHERE contractor_id = ? AND source_name = ?
    `, [contractorId, source]);

    if (!result.length || !result[0].values.length) {
      return null;
    }

    const row = result[0].values[0];
    return {
      text: row[0],
      structured: row[1] ? JSON.parse(row[1]) : null,
      status: row[2],
      expires_at: row[3]
    };
  }

  /**
   * Check if cached data is expired
   */
  isExpired(cached) {
    if (!cached || !cached.expires_at) return true;
    return new Date(cached.expires_at) < new Date();
  }

  /**
   * Run initial collection for all sources
   */
  async runInitialCollection(contractorId, contractor) {
    log('\n📥 Running initial collection...');

    const results = [];
    const urls = this.buildUrls(contractor);

    // URL-based sources in parallel batches
    log(`URL sources to fetch: ${Object.keys(urls).length}`);
    const urlEntries = Object.entries(urls);
    const BATCH_SIZE = 5;

    for (let i = 0; i < urlEntries.length; i += BATCH_SIZE) {
      const batch = urlEntries.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(([source, url]) => this.fetchPage(url, source))
      );

      for (const result of batchResults) {
        // Apply source-specific parsing
        if (result.status === 'success' && result.text) {
          if (result.source === 'bbb') {
            const parsed = parseBBBResults(result.text, contractor.name);
            result.structured = parsed;
            if (parsed.found) {
              log(`    📋 BBB: Rating=${parsed.rating}, Accredited=${parsed.accredited}, Locations=${parsed.locations_count}`);
            }
          } else if (result.source === 'google_maps') {
            const parsed = parseGoogleMapsResults(result.text, contractor.name);
            result.structured = parsed;
            if (parsed.found && parsed.rating) {
              log(`    📋 Google Maps: ${parsed.rating}★ (${parsed.review_count} reviews)`);
            }
          } else if (result.source === 'glassdoor') {
            const parsed = parseGlassdoorResults(result.text, contractor.name);
            result.structured = parsed;
            if (parsed.found && parsed.rating) {
              log(`    📋 Glassdoor: ${parsed.rating}★ (${parsed.review_count} reviews)`);
            }
          }
        }
        this.storeRawData(contractorId, result.source, result);
        this.logCollectionRequest(contractorId, result.source, 'initial', 'Initial collection');
        results.push(result);
      }

      if (i + BATCH_SIZE < urlEntries.length) {
        await sleep(500);
      }
    }

    // TDLR (Texas only, form submission)
    // Skip for trades that don't require TDLR licensing (pools, patios, fences, enclosures)
    const unlicensedTrades = ['pool', 'patio', 'fence', 'enclosure', 'pergola', 'deck', 'screen', 'sunroom', 'outdoor living'];
    const isUnlicensedTrade = unlicensedTrades.some(trade =>
      contractor.name?.toLowerCase().includes(trade) ||
      contractor.verticals?.some(v => v.toLowerCase().includes(trade))
    );

    if (contractor.state?.toUpperCase() === 'TX' && !isUnlicensedTrade) {
      log('\n  Searching TDLR licenses...');
      try {
        const tdlrResult = await searchTDLR(this.browser, contractor.name);
        const data = {
          source: 'tdlr',
          url: 'https://www.tdlr.texas.gov/LicenseSearch/',
          status: tdlrResult.found ? 'success' : 'not_found',
          text: tdlrResult.found
            ? `TDLR LICENSE FOUND:\n${JSON.stringify(tdlrResult, null, 2)}`
            : 'No TDLR licenses found',
          structured: tdlrResult
        };
        this.storeRawData(contractorId, 'tdlr', data);
        this.logCollectionRequest(contractorId, 'tdlr', 'initial', 'Initial collection');
        results.push(data);

        if (tdlrResult.found) {
          success(`    TDLR: Found ${tdlrResult.licenses?.length || 0} license(s)`);
        } else {
          warn(`    TDLR: No licenses found`);
        }
      } catch (err) {
        warn(`    TDLR: Error - ${err.message}`);
        this.storeRawData(contractorId, 'tdlr', {
          source: 'tdlr',
          url: 'https://www.tdlr.texas.gov/LicenseSearch/',
          status: 'error',
          error: err.message,
          text: null
        });
      }
    }

    // Court records
    log('\n  Searching court records...');
    try {
      const courtResult = await searchCourtRecords(this.browser, contractor.name, ['tarrant', 'dallas', 'collin', 'denton']);
      const data = {
        source: 'court_records',
        url: 'DFW County Courts',
        status: courtResult.total_cases_found > 0 ? 'success' : 'not_found',
        text: `COURT RECORDS:\n${JSON.stringify(courtResult, null, 2)}`,
        structured: courtResult
      };
      this.storeRawData(contractorId, 'court_records', data);
      this.logCollectionRequest(contractorId, 'court_records', 'initial', 'Initial collection');
      results.push(data);

      if (courtResult.total_cases_found > 0) {
        warn(`    Courts: Found ${courtResult.total_cases_found} case(s)`);
      } else {
        success(`    Courts: No cases found`);
      }
    } catch (err) {
      warn(`    Courts: Error - ${err.message}`);
    }

    // API sources
    log('\n  Fetching API sources...');
    try {
      const apiResults = await fetchAPISources(contractor.name, contractor.state, {
        courtListenerApiKey: process.env.COURTLISTENER_API_KEY
      });

      // TX Franchise Tax
      if (apiResults.tx_franchise) {
        const data = {
          source: 'tx_franchise',
          url: 'https://comptroller.texas.gov',
          status: apiResults.tx_franchise.found ? 'success' : 'not_found',
          text: JSON.stringify(apiResults.tx_franchise, null, 2),
          structured: apiResults.tx_franchise
        };
        this.storeRawData(contractorId, 'tx_franchise', data);
        results.push(data);

        if (apiResults.tx_franchise.found) {
          success(`    TX Franchise: Found`);
        }
      }

      // OpenCorporates
      if (apiResults.open_corporates) {
        const data = {
          source: 'open_corporates',
          url: 'https://opencorporates.com',
          status: apiResults.open_corporates.found ? 'success' : 'not_found',
          text: JSON.stringify(apiResults.open_corporates, null, 2),
          structured: apiResults.open_corporates
        };
        this.storeRawData(contractorId, 'open_corporates', data);
        results.push(data);
      }

      // CourtListener
      if (apiResults.court_listener) {
        const data = {
          source: 'court_listener',
          url: 'https://www.courtlistener.com',
          status: apiResults.court_listener.found ? 'success' : 'not_found',
          text: JSON.stringify(apiResults.court_listener, null, 2),
          structured: apiResults.court_listener
        };
        this.storeRawData(contractorId, 'court_listener', data);
        results.push(data);
      }
    } catch (err) {
      warn(`    API sources: Error - ${err.message}`);
    }

    const successCount = results.filter(r => r.status === 'success').length;
    log(`\n✓ Collected ${successCount}/${results.length} sources`);

    // Run AI review analysis
    log('\n🔍 Analyzing reviews for authenticity...');
    try {
      // Gather review data from collected sources
      const reviewData = {};
      for (const r of results) {
        if (['bbb', 'google_maps', 'glassdoor', 'yelp', 'angi', 'houzz', 'porch'].includes(r.source)) {
          reviewData[r.source] = {
            ...r.structured,
            raw_text: r.text
          };
        }
      }

      // Quick discrepancy check first (no API needed)
      const quickCheck = quickDiscrepancyCheck(reviewData);
      if (quickCheck.flags.length > 0) {
        for (const flag of quickCheck.flags) {
          warn(`    ⚠️ ${flag}`);
        }
      }

      // Run full AI analysis if we have enough data
      if (Object.keys(reviewData).length >= 2) {
        const analysis = await analyzeReviews(contractor.name, reviewData);

        if (!analysis.skipped && !analysis.error) {
          // Store analysis as a special source
          const analysisData = {
            source: 'review_analysis',
            url: 'AI Analysis',
            status: 'success',
            text: analysis.summary || 'Analysis complete',
            structured: analysis
          };
          this.storeRawData(contractorId, 'review_analysis', analysisData);
          results.push(analysisData);

          // Log key findings
          if (analysis.fake_review_score >= 60) {
            error(`    🚨 FAKE REVIEW SCORE: ${analysis.fake_review_score}/100 - ${analysis.recommendation}`);
          } else if (analysis.fake_review_score >= 30) {
            warn(`    ⚠️ Fake Review Score: ${analysis.fake_review_score}/100 - ${analysis.recommendation}`);
          } else {
            success(`    ✓ Review Analysis: Score ${analysis.fake_review_score}/100 - ${analysis.recommendation}`);
          }

          if (analysis.discrepancy_detected) {
            warn(`    ⚠️ Rating Discrepancy: ${analysis.discrepancy_explanation}`);
          }

          log(`    💰 Analysis cost: $${analysis.cost?.toFixed(4) || '0.0000'}`);
        } else if (analysis.error) {
          warn(`    Review analysis error: ${analysis.error}`);
        }
      } else {
        log('    Insufficient review data for AI analysis');
      }
    } catch (err) {
      warn(`    Review analysis error: ${err.message}`);
    }

    return results;
  }

  /**
   * Fetch a specific source on demand (for agent requests)
   */
  async fetchSpecificSource(contractorId, contractor, sourceName, reason) {
    this.logCollectionRequest(contractorId, sourceName, 'audit_agent', reason);

    // Check cache
    const cached = this.getCachedData(contractorId, sourceName);
    if (cached && !this.isExpired(cached)) {
      log(`  ${sourceName}: Using cached data`);
      return { source: sourceName, status: 'cached', ...cached };
    }

    const sourceConfig = SOURCES[sourceName];
    if (!sourceConfig) {
      return { source: sourceName, status: 'error', error: `Unknown source: ${sourceName}` };
    }

    log(`  Fetching ${sourceName} (agent request: ${reason})...`);

    let result;

    if (sourceConfig.type === 'url') {
      const urls = this.buildUrls(contractor);
      if (urls[sourceName]) {
        result = await this.fetchPage(urls[sourceName], sourceName);
      } else {
        result = { source: sourceName, status: 'error', error: 'No URL for source' };
      }
    } else if (sourceConfig.type === 'form' && sourceName === 'tdlr') {
      try {
        const tdlrResult = await searchTDLR(this.browser, contractor.name);
        result = {
          source: 'tdlr',
          url: 'https://www.tdlr.texas.gov/LicenseSearch/',
          status: tdlrResult.found ? 'success' : 'not_found',
          text: JSON.stringify(tdlrResult, null, 2),
          structured: tdlrResult
        };
      } catch (err) {
        result = { source: 'tdlr', status: 'error', error: err.message };
      }
    } else if (sourceConfig.type === 'scraper' && sourceName === 'court_records') {
      try {
        const courtResult = await searchCourtRecords(this.browser, contractor.name, ['tarrant', 'dallas', 'collin', 'denton']);
        result = {
          source: 'court_records',
          status: courtResult.total_cases_found > 0 ? 'success' : 'not_found',
          text: JSON.stringify(courtResult, null, 2),
          structured: courtResult
        };
      } catch (err) {
        result = { source: 'court_records', status: 'error', error: err.message };
      }
    } else {
      result = { source: sourceName, status: 'error', error: `Source type ${sourceConfig.type} not implemented` };
    }

    // Store result
    if (result) {
      this.storeRawData(contractorId, sourceName, result);
    }

    return result;
  }

  /**
   * Ad-hoc web search
   */
  async searchWeb(query) {
    const page = await this.browser.newPage();
    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
        waitUntil: 'networkidle2',
        timeout: 15000
      });

      await sleep(2000);

      const results = await page.evaluate(() => {
        const items = document.querySelectorAll('#search .g');
        return Array.from(items).slice(0, 5).map(item => {
          const title = item.querySelector('h3')?.innerText || '';
          const snippet = item.querySelector('.VwiC3b')?.innerText || '';
          const link = item.querySelector('a')?.href || '';
          return `${title}\n${link}\n${snippet}`;
        }).join('\n\n---\n\n');
      });

      return { query, results: results.substring(0, 3000), status: 'success' };
    } catch (err) {
      return { query, status: 'error', error: err.message };
    } finally {
      await page.close();
    }
  }
}

/**
 * Calculate insurance confidence based on collected data signals
 * Called after all sources are collected
 */
function calculateInsuranceConfidence(collectedData) {
  let score = 0;
  const signals = [];

  // BBB Accredited (+3) - they actually verify insurance
  const bbb = collectedData.find(d => d.source_name === 'bbb');
  if (bbb?.structured_data?.accredited === true) {
    score += 3;
    signals.push('BBB accredited (insurance verified by BBB)');
  }

  // Active TDLR license (+2) - required to file insurance
  const tdlr = collectedData.find(d => d.source_name === 'tdlr');
  if (tdlr?.structured_data?.status === 'ACTIVE') {
    score += 2;
    signals.push('Active TDLR license (insurance filing required)');
  }

  // Recent permits (+2) - cities require insurance for permits
  const permits = collectedData.find(d => d.source_name === 'permits');
  const permitCount = permits?.structured_data?.recent_count || 0;
  if (permitCount >= 3) {
    score += 2;
    signals.push(`${permitCount} recent permits (city requires insurance)`);
  }

  // Business age (+1) - longevity signal
  const sos = collectedData.find(d => d.source_name === 'tx_sos');
  const yearsInBusiness = sos?.structured_data?.years_in_business || 0;
  if (yearsInBusiness >= 5) {
    score += 1;
    signals.push(`${yearsInBusiness} years in business`);
  }

  // Website mentions insurance (+1)
  const website = collectedData.find(d => d.source_name === 'website');
  const rawText = website?.raw_text?.toLowerCase() || '';
  if (rawText.includes('insured') || rawText.includes('insurance') || rawText.includes('bonded')) {
    score += 1;
    signals.push('Website mentions insurance/bonded');
  }

  return {
    score,
    max: 9,
    level: score >= 6 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW',
    signals,
    note: score < 3 ? 'Insurance unverified - recommend requesting COI' : null
  };
}

module.exports = { CollectionService, SOURCES, calculateInsuranceConfidence };
