/**
 * Collection Service
 *
 * Handles all data collection (Puppeteer scraping, API calls, form submissions).
 * Stores raw data to SQLite with cache TTL.
 */

const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const path = require('path');
const { searchCourtRecords } = require('../lib/court_scraper');
const { fetchAPISources } = require('../lib/api_sources');
const { analyzeReviews, quickDiscrepancyCheck } = require('./review_analyzer');

// Path to Python scrapers
const SCRAPERS_DIR = path.join(__dirname, '..', 'scrapers');

/**
 * Call a Python scraper and return JSON result
 */
function callPythonScraper(script, args = [], timeout = 60000) {
  const scriptPath = path.join(SCRAPERS_DIR, script);
  const quotedArgs = args.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ');
  const cmd = `python3 "${scriptPath}" ${quotedArgs} --json`;

  try {
    const output = execSync(cmd, {
      cwd: SCRAPERS_DIR,
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return JSON.parse(output.trim());
  } catch (err) {
    // Try to parse any output even on error
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout.trim());
      } catch (parseErr) {
        // ignore
      }
    }
    throw new Error(`Python scraper error: ${err.message}`);
  }
}

/**
 * Search TDLR using Python Playwright scraper
 */
async function searchTDLRPython(businessName) {
  return callPythonScraper('tdlr.py', [businessName]);
}

/**
 * Scrape BBB using Python httpx scraper
 */
async function scrapeBBBPython(businessName, city = 'Fort Worth', state = 'TX') {
  return callPythonScraper('bbb.py', [businessName, city, state, '--with-details']);
}

/**
 * Scrape Google Maps using Python Playwright scraper (NO API)
 */
async function scrapeGoogleMapsPython(businessName, location = 'Fort Worth, TX', maxReviews = 20) {
  return callPythonScraper('google_maps.py', [businessName, location, '--max-reviews', String(maxReviews)], 90000);
}

/**
 * Scrape Yelp rating via Yahoo Search (bypasses DataDome)
 */
async function scrapeYelpYahooPython(businessName, location = 'Fort Worth, TX') {
  // Note: yelp.py doesn't support --json, outputs to stderr, parses result differently
  const scriptPath = path.join(SCRAPERS_DIR, 'yelp.py');
  const quotedArgs = [businessName, location].map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ');
  const cmd = `python3 "${scriptPath}" ${quotedArgs} --yahoo`;

  try {
    const output = execSync(cmd, {
      cwd: SCRAPERS_DIR,
      timeout: 60000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    // Parse output - look for rating pattern
    const ratingMatch = output.match(/Rating:\s*([\d.]+)/);
    const reviewsMatch = output.match(/Reviews:\s*(\d+)/);
    const urlMatch = output.match(/URL:\s*(https?:\/\/[^\s]+)/);
    const foundMatch = output.match(/Found:\s*(True|False)/i);

    return {
      found: foundMatch ? foundMatch[1].toLowerCase() === 'true' : false,
      rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
      review_count: reviewsMatch ? parseInt(reviewsMatch[1]) : null,
      yelp_url: urlMatch ? urlMatch[1] : null,
      source: 'yahoo_yelp'
    };
  } catch (err) {
    // Try to parse stderr output
    if (err.stdout) {
      const output = err.stdout;
      const ratingMatch = output.match(/Rating:\s*([\d.]+)/);
      const reviewsMatch = output.match(/Reviews:\s*(\d+)/);
      if (ratingMatch) {
        return {
          found: true,
          rating: parseFloat(ratingMatch[1]),
          review_count: reviewsMatch ? parseInt(reviewsMatch[1]) : null,
          source: 'yahoo_yelp'
        };
      }
    }
    throw new Error(`Python scraper error: ${err.message}`);
  }
}

/**
 * Scrape rating from SERP for any site (Angi, Houzz, etc.)
 * Bypasses anti-bot by reading Yahoo Search snippets
 */
async function scrapeSerpRatingPython(businessName, location = 'Fort Worth, TX', site = 'angi.com') {
  return callPythonScraper('serp_rating.py', [businessName, location, '--site', site, '--json'], 60000);
}

/**
 * Scrape Trustpilot by direct URL check (trustpilot.com/review/{domain})
 * More accurate than SERP - no wrong company matches
 */
async function scrapeTrustpilotPython(websiteUrl) {
  if (!websiteUrl) {
    return { found: false, error: 'No website URL provided' };
  }
  return callPythonScraper('trustpilot.py', [websiteUrl], 30000);
}

// Source definitions with cache TTL (in seconds)
const SOURCES = {
  // Tier 1: Reviews (cache 24h)
  bbb: { ttl: 86400, tier: 1, type: 'url' },
  yelp: { ttl: 86400, tier: 1, type: 'url' },
  yelp_yahoo: { ttl: 86400, tier: 1, type: 'scraper' },  // Yahoo Search fallback for Yelp rating
  google_maps_local: { ttl: 86400, tier: 1, type: 'url' },  // Search in target market (DFW)
  google_maps_hq: { ttl: 86400, tier: 1, type: 'url' },  // Search in contractor's HQ location
  angi: { ttl: 86400, tier: 1, type: 'serp' },       // SERP scraper (bypasses anti-bot)
  houzz: { ttl: 86400, tier: 1, type: 'serp' },      // SERP scraper (bypasses anti-bot)
  trustpilot: { ttl: 86400, tier: 1, type: 'direct' },  // Direct URL check by domain (more accurate)
  thumbtack: { ttl: 86400, tier: 1, type: 'url' },
  facebook: { ttl: 86400, tier: 1, type: 'url' },

  // Tier 2: News (cache 12h)
  google_news: { ttl: 43200, tier: 2, type: 'url' },
  local_news: { ttl: 43200, tier: 2, type: 'url' },

  // Tier 3: Social (cache 24h)
  reddit: { ttl: 86400, tier: 3, type: 'url' },
  youtube: { ttl: 86400, tier: 3, type: 'url' },
  nextdoor_search: { ttl: 86400, tier: 3, type: 'url' },

  // Tier 4: Employee (cache 7d)
  indeed: { ttl: 604800, tier: 4, type: 'url' },
  glassdoor: { ttl: 604800, tier: 4, type: 'url' },

  // Tier 5: Government (cache 7d)
  osha: { ttl: 604800, tier: 5, type: 'url' },
  epa_echo: { ttl: 604800, tier: 5, type: 'url' },

  // Tier 6: TX-Specific (cache 7d)
  // tdlr removed - unreliable, Texas-only, many trades don't require it
  tx_ag_complaints: { ttl: 604800, tier: 6, type: 'url' },
  tx_sos_search: { ttl: 604800, tier: 6, type: 'url' },
  tx_franchise: { ttl: 604800, tier: 6, type: 'api' },

  // Tier 7: Courts (cache 7d)
  court_records: { ttl: 604800, tier: 7, type: 'scraper' },
  tarrant_court: { ttl: 604800, tier: 7, type: 'url' },
  dallas_court: { ttl: 604800, tier: 7, type: 'url' },
  collin_court: { ttl: 604800, tier: 7, type: 'url' },
  denton_court: { ttl: 604800, tier: 7, type: 'url' },
  court_listener: { ttl: 604800, tier: 7, type: 'api' },

  // Tier 8: Industry (cache 24h)
  porch: { ttl: 86400, tier: 8, type: 'url' },
  buildzoom: { ttl: 86400, tier: 8, type: 'url' },
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
 * Parse Google Maps search results - finds best matching listing
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

  // Extract key words from contractor name (ignore common suffixes)
  const commonWords = ['roofing', 'construction', 'llc', 'inc', 'corp', 'company', 'services', 'the', 'and', 'of'];
  const nameWords = nameLower.split(/[\s\(\)]+/).filter(w => w.length > 2 && !commonWords.includes(w));

  // Find ALL listings with ratings in the text
  // Pattern: "Business Name X.X (NN)" where X.X is rating and NN is review count
  const listingPattern = /([A-Za-z][A-Za-z0-9\s&',.-]+?)\s+(\d\.\d)\s*\((\d+)\)/g;
  const listings = [];
  let match;

  while ((match = listingPattern.exec(text)) !== null) {
    const businessName = match[1].trim();
    const rating = parseFloat(match[2]);
    const reviewCount = parseInt(match[3]);

    // Score this listing based on name match
    const businessLower = businessName.toLowerCase();
    const matchedWords = nameWords.filter(w => businessLower.includes(w));
    const score = matchedWords.length / nameWords.length;

    listings.push({ businessName, rating, reviewCount, score, matchedWords });
  }

  if (listings.length === 0) return result;

  // Sort by match score (highest first), then by review count as tiebreaker
  listings.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.reviewCount - a.reviewCount;
  });

  const best = listings[0];

  // Require at least 40% word match
  if (best.score < 0.4) return result;

  result.found = true;
  result.business_name = best.businessName;
  result.rating = best.rating;
  result.review_count = best.reviewCount;

  // Extract business status near the matched listing
  const textLower = text.toLowerCase();
  const businessIndex = textLower.indexOf(best.businessName.toLowerCase());
  if (businessIndex !== -1) {
    const nearbyText = text.substring(businessIndex, businessIndex + 200);
    const statusMatch = nearbyText.match(/(Open|Closed)\s*·/i);
    if (statusMatch) {
      result.status = statusMatch[1].toLowerCase();
    }
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

    // For Google Maps, use website domain if available (much better results)
    const websiteDomain = website ? website.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;

    // Target market for local search (DFW)
    const targetMarket = { city: 'Dallas', state: 'TX' };
    const localQuery = websiteDomain
      ? `${websiteDomain}+${targetMarket.city}+${targetMarket.state}`
      : `${encodedName}+${targetMarket.city}+${targetMarket.state}`;
    const hqQuery = websiteDomain || `${encodedName}+${encodedCity}+${encodedState}`;

    const urls = {
      bbb: `https://www.bbb.org/search?find_text=${encodedName}&find_loc=${location}`,
      yelp: `https://www.yelp.com/search?find_desc=${encodedName}&find_loc=${encodedCity},%20${encodedState}`,
      google_maps_local: `https://www.google.com/maps/search/${localQuery}`,
      google_maps_hq: `https://www.google.com/maps/search/${hqQuery}`,
      angi: `https://www.angi.com/search?query=${encodedName}&location=${encodedCity},%20${encodedState}`,
      houzz: `https://www.houzz.com/search/professionals/query/${encodedName}/location/${citySlug}--${stateLower}`,
      trustpilot: `https://www.trustpilot.com/search?query=${encodedName}`,
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
   * Fetch search results via Serper API (bypasses Google blocking)
   */
  async fetchSerper(urlOrQuery, source, timeout = 20000) {
    const apiKey = process.env.SERPER_API_KEY || '1da327ecf7f11f83885d70dc2637bd5dec2f9426';

    let query = urlOrQuery;

    // Smart Query Generation
    if (source === 'yelp' && urlOrQuery.includes('yelp.com')) {
      // Convert Yelp internal search to Google Site Search (much cleaner results)
      try {
        const urlObj = new URL(urlOrQuery);
        const desc = urlObj.searchParams.get('find_desc');
        const loc = urlObj.searchParams.get('find_loc');
        if (desc && loc) {
          query = `site:yelp.com "${desc}" "${loc}"`;
        }
      } catch (e) {
        // fallback
      }
    } else if (urlOrQuery.includes('google.com/search') || urlOrQuery.includes('google.com/maps')) {
      // Extract query from Google URL
      try {
        const urlObj = new URL(urlOrQuery);
        query = urlObj.searchParams.get('q');
        if (!query && urlOrQuery.includes('q=')) {
          query = decodeURIComponent(urlOrQuery.split('q=')[1].split('&')[0]).replace(/\+/g, ' ');
        }
      } catch (e) {
        // use raw
      }
    }

    if (!query) query = urlOrQuery;

    log(`  Fetching ${source} via Serper API...`);

    try {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: query })
      });

      if (!response.ok) {
        throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json();
      const results = json.organic || [];

      // Convert to string for storage (simulate text equivalent of a search page)
      // We format this to look like what our parsers might expect, or just generic text
      const text = results.map(r => `${r.title}\n${r.link}\n${r.snippet}`).join('\n\n---\n\n');

      success(`    ${source}: Found ${results.length} results via API`);

      return {
        source,
        url: urlOrQuery,
        status: results.length > 0 ? 'success' : 'not_found',
        text: text,
        structured: {
          source: 'serper',
          query: query,
          results: results
        }
      };

    } catch (err) {
      warn(`    ${source}: API Error - ${err.message}`);
      return {
        source,
        url: urlOrQuery,
        status: 'error',
        error: err.message,
        text: null,
        structured: null
      };
    }
  }

  /**
   * Fetch a single page with Puppeteer (or API if blocked)
   */
  async fetchPage(url, source, timeout = 20000) {
    // List of sources blocked by Google/Captcha that we should route to Serper
    const BLOCKED_SOURCES = [
      'yelp', // Moved to Serper per user request
      'court_records', 'tarrant_court', 'dallas_court', 'collin_court', 'denton_court',
      'tx_sos_search', 'tx_franchise', 'tx_ag_complaints',
      'osha', 'epa_echo',
      'google_news', 'local_news', 'nextdoor_search',
      'open_corporates'
    ];

    if (BLOCKED_SOURCES.includes(source)) {
      return this.fetchSerper(url, source, timeout);
    }

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
    const BATCH_SIZE = 1;

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
          } else if (result.source === 'google_maps_local' || result.source === 'google_maps_hq') {
            const parsed = parseGoogleMapsResults(result.text, contractor.name);
            result.structured = parsed;
            if (parsed.found && parsed.rating) {
              const label = result.source === 'google_maps_local' ? 'Google Maps (DFW)' : 'Google Maps (HQ)';
              log(`    📋 ${label}: ${parsed.rating}★ (${parsed.review_count} reviews)`);
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

    // BBB - Use Python httpx scraper (more reliable than Puppeteer)
    log('\n  Fetching BBB (Python scraper)...');
    try {
      const bbbResult = await scrapeBBBPython(contractor.name, contractor.city, contractor.state);
      const bbbData = {
        source: 'bbb',
        url: bbbResult.profile_url || 'https://www.bbb.org',
        status: bbbResult.found ? 'success' : 'not_found',
        text: JSON.stringify(bbbResult, null, 2),
        structured: bbbResult
      };
      this.storeRawData(contractorId, 'bbb', bbbData);
      this.logCollectionRequest(contractorId, 'bbb', 'initial', 'Initial collection (Python)');
      // Replace any existing BBB result from URL batch
      const existingIdx = results.findIndex(r => r.source === 'bbb');
      if (existingIdx >= 0) {
        results[existingIdx] = bbbData;
      } else {
        results.push(bbbData);
      }

      if (bbbResult.found) {
        const ratingInfo = bbbResult.rating ? `Rating=${bbbResult.rating}` : 'No rating';
        const accredInfo = bbbResult.accredited ? 'Accredited' : 'Not Accredited';
        log(`    📋 BBB: ${ratingInfo}, ${accredInfo}`);
        if (bbbResult.is_critical) {
          error(`    🚨 CRITICAL: BBB rating ${bbbResult.rating} indicates serious issues`);
        } else if (bbbResult.is_warning) {
          warn(`    ⚠️ WARNING: BBB rating ${bbbResult.rating} indicates concerns`);
        }
      } else {
        warn(`    BBB: Not found`);
      }
    } catch (err) {
      warn(`    BBB: Error - ${err.message}`);
    }

    // Google Maps - Use Python Playwright scraper (NO API, avoids $300 overcharge)
    // Search local market, contractor's listed city, AND true HQ if different
    const TARGET_MARKET = 'Dallas, TX';  // DFW target market for homeowner leads

    // Determine HQ location - use contractor.hq_location if set, else fall back to city/state
    const listedLocation = `${contractor.city}, ${contractor.state}`;
    const hqLocation = contractor.hq_location || contractor.hq_city
      ? `${contractor.hq_city || contractor.city}, ${contractor.hq_state || contractor.state}`
      : null;

    // 1. Search in LOCAL market (where homeowners search)
    log('\n  Fetching Google Maps LOCAL (DFW market)...');
    try {
      const gmapsLocalResult = await scrapeGoogleMapsPython(contractor.name, TARGET_MARKET);
      const gmapsLocalData = {
        source: 'google_maps_local',
        url: gmapsLocalResult.maps_url || 'https://www.google.com/maps',
        status: gmapsLocalResult.found ? 'success' : 'not_found',
        text: JSON.stringify(gmapsLocalResult, null, 2),
        structured: gmapsLocalResult
      };
      this.storeRawData(contractorId, 'google_maps_local', gmapsLocalData);
      this.logCollectionRequest(contractorId, 'google_maps_local', 'initial', 'Initial collection - DFW market');

      // Replace any existing from URL batch
      const existingLocalIdx = results.findIndex(r => r.source === 'google_maps_local');
      if (existingLocalIdx >= 0) {
        results[existingLocalIdx] = gmapsLocalData;
      } else {
        results.push(gmapsLocalData);
      }

      if (gmapsLocalResult.found) {
        const ratingInfo = gmapsLocalResult.rating ? `${gmapsLocalResult.rating}★` : 'No rating';
        const reviewInfo = gmapsLocalResult.review_count ? `${gmapsLocalResult.review_count} reviews` : 'No reviews';
        success(`    Google Maps (DFW): ${ratingInfo} (${reviewInfo})`);

        // Flag insufficient reviews (< 20 threshold)
        const reviewCount = gmapsLocalResult.review_count || 0;
        if (reviewCount < 20) {
          gmapsLocalResult.insufficient_reviews = true;
          gmapsLocalResult.review_flag = 'INSUFFICIENT_REVIEWS';
          warn(`    ⚠️ INSUFFICIENT_REVIEWS: Only ${reviewCount} reviews (threshold: 20)`);
        }
      } else {
        warn(`    Google Maps (DFW): Not found`);
      }
    } catch (err) {
      warn(`    Google Maps (DFW): Error - ${err.message}`);
    }

    // 2. Search in listed location (contractor's listed city, e.g. branch office)
    if (listedLocation.toLowerCase() !== TARGET_MARKET.toLowerCase()) {
      log(`  Fetching Google Maps LISTED (${listedLocation})...`);
      try {
        const gmapsListedResult = await scrapeGoogleMapsPython(contractor.name, listedLocation);
        const gmapsListedData = {
          source: 'google_maps_listed',
          url: gmapsListedResult.maps_url || 'https://www.google.com/maps',
          status: gmapsListedResult.found ? 'success' : 'not_found',
          text: JSON.stringify(gmapsListedResult, null, 2),
          structured: gmapsListedResult
        };
        this.storeRawData(contractorId, 'google_maps_listed', gmapsListedData);
        this.logCollectionRequest(contractorId, 'google_maps_listed', 'initial', 'Initial collection - Listed location');
        results.push(gmapsListedData);

        if (gmapsListedResult.found) {
          const ratingInfo = gmapsListedResult.rating ? `${gmapsListedResult.rating}★` : 'No rating';
          const reviewInfo = gmapsListedResult.review_count ? `${gmapsListedResult.review_count} reviews` : 'No reviews';
          success(`    Google Maps (Listed): ${ratingInfo} (${reviewInfo})`);

          // Flag insufficient reviews
          const reviewCount = gmapsListedResult.review_count || 0;
          if (reviewCount < 20) {
            gmapsListedResult.insufficient_reviews = true;
            gmapsListedResult.review_flag = 'INSUFFICIENT_REVIEWS';
          }
        } else {
          warn(`    Google Maps (Listed): Not found`);
        }
      } catch (err) {
        warn(`    Google Maps (Listed): Error - ${err.message}`);
      }
    }

    // 3. Search in TRUE HQ location if different from listed location
    // HQ can be set via contractor.hq_city/hq_state fields
    if (hqLocation && hqLocation.toLowerCase() !== listedLocation.toLowerCase() && hqLocation.toLowerCase() !== TARGET_MARKET.toLowerCase()) {
      log(`  Fetching Google Maps HQ (${hqLocation})...`);
      try {
        const gmapsHqResult = await scrapeGoogleMapsPython(contractor.name, hqLocation);
        const gmapsHqData = {
          source: 'google_maps_hq',
          url: gmapsHqResult.maps_url || 'https://www.google.com/maps',
          status: gmapsHqResult.found ? 'success' : 'not_found',
          text: JSON.stringify(gmapsHqResult, null, 2),
          structured: gmapsHqResult
        };
        this.storeRawData(contractorId, 'google_maps_hq', gmapsHqData);
        this.logCollectionRequest(contractorId, 'google_maps_hq', 'initial', 'Initial collection - True HQ');
        results.push(gmapsHqData);

        if (gmapsHqResult.found) {
          const ratingInfo = gmapsHqResult.rating ? `${gmapsHqResult.rating}★` : 'No rating';
          const reviewInfo = gmapsHqResult.review_count ? `${gmapsHqResult.review_count} reviews` : 'No reviews';
          success(`    Google Maps (HQ): ${ratingInfo} (${reviewInfo})`);

          // Flag insufficient reviews
          const reviewCount = gmapsHqResult.review_count || 0;
          if (reviewCount < 20) {
            gmapsHqResult.insufficient_reviews = true;
            gmapsHqResult.review_flag = 'INSUFFICIENT_REVIEWS';
          }
        } else {
          warn(`    Google Maps (HQ): Not found`);
        }
      } catch (err) {
        warn(`    Google Maps (HQ): Error - ${err.message}`);
      }
    } else if (!hqLocation) {
      // No separate HQ set, use listed location as HQ
      const existingListed = results.find(r => r.source === 'google_maps_listed');
      if (existingListed) {
        const gmapsHqData = { ...existingListed, source: 'google_maps_hq' };
        this.storeRawData(contractorId, 'google_maps_hq', gmapsHqData);
        results.push(gmapsHqData);
      }
    }

    // Yelp via Yahoo Search (bypasses DataDome blocking)
    log('\n  Fetching Yelp rating (via Yahoo Search)...');
    try {
      const yelpResult = await scrapeYelpYahooPython(contractor.name, listedLocation);
      const yelpData = {
        source: 'yelp_yahoo',
        url: yelpResult.yelp_url || 'https://www.yelp.com',
        status: yelpResult.found ? 'success' : 'not_found',
        text: JSON.stringify(yelpResult, null, 2),
        structured: yelpResult
      };
      this.storeRawData(contractorId, 'yelp_yahoo', yelpData);
      this.logCollectionRequest(contractorId, 'yelp_yahoo', 'initial', 'Initial collection - Yahoo fallback');
      results.push(yelpData);

      if (yelpResult.found) {
        const ratingInfo = yelpResult.rating ? `${yelpResult.rating}★` : 'No rating';
        const reviewInfo = yelpResult.review_count ? `${yelpResult.review_count} reviews` : 'No review count';
        success(`    Yelp (Yahoo): ${ratingInfo} (${reviewInfo})`);
      } else {
        warn(`    Yelp (Yahoo): Not found`);
      }
    } catch (err) {
      warn(`    Yelp (Yahoo): Error - ${err.message}`);
    }

    // Angi, Houzz via SERP scraping (bypasses anti-bot)
    const serpSites = [
      { key: 'angi', site: 'angi.com', name: 'Angi' },
      { key: 'houzz', site: 'houzz.com', name: 'Houzz' },
    ];

    for (const { key, site, name } of serpSites) {
      log(`  Fetching ${name} rating (via SERP)...`);
      try {
        const serpResult = await scrapeSerpRatingPython(contractor.name, listedLocation, site);
        const serpData = {
          source: key,
          url: serpResult.url || `https://www.${site}`,
          status: serpResult.found ? 'success' : 'not_found',
          text: JSON.stringify(serpResult, null, 2),
          structured: serpResult
        };
        this.storeRawData(contractorId, key, serpData);
        this.logCollectionRequest(contractorId, key, 'initial', `Initial collection - SERP ${site}`);
        results.push(serpData);

        if (serpResult.found && serpResult.rating) {
          const reviewInfo = serpResult.review_count ? `${serpResult.review_count} reviews` : 'No count';
          success(`    ${name}: ${serpResult.rating}★ (${reviewInfo})`);
        } else if (serpResult.found) {
          warn(`    ${name}: Found but no rating extracted`);
        } else {
          warn(`    ${name}: Not found`);
        }
      } catch (err) {
        warn(`    ${name}: Error - ${err.message}`);
      }
    }

    // Trustpilot via direct URL check (more accurate than SERP)
    log(`  Fetching Trustpilot rating (via direct URL)...`);
    try {
      if (contractor.website) {
        const tpResult = await scrapeTrustpilotPython(contractor.website);
        const tpData = {
          source: 'trustpilot',
          url: tpResult.profile_url || 'https://www.trustpilot.com',
          status: tpResult.found ? 'success' : 'not_found',
          text: JSON.stringify(tpResult, null, 2),
          structured: tpResult
        };
        this.storeRawData(contractorId, 'trustpilot', tpData);
        this.logCollectionRequest(contractorId, 'trustpilot', 'initial', 'Initial collection - direct URL');
        results.push(tpData);

        if (tpResult.found && tpResult.rating) {
          const reviewInfo = tpResult.review_count ? `${tpResult.review_count} reviews` : 'No count';
          success(`    Trustpilot: ${tpResult.rating}★ (${reviewInfo}) - ${tpResult.business_name || 'unknown'}`);
        } else if (tpResult.found) {
          warn(`    Trustpilot: Profile exists but no rating`);
        } else {
          warn(`    Trustpilot: No profile found for domain`);
        }
      } else {
        warn(`    Trustpilot: Skipped (no website URL)`);
      }
    } catch (err) {
      warn(`    Trustpilot: Error - ${err.message}`);
    }

    // NOTE: TDLR license verification removed - too unreliable and Texas-specific
    // Many trades don't require TDLR, and missing data was creating false negatives

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
        if (['bbb', 'google_maps', 'google_maps_local', 'google_maps_hq', 'glassdoor', 'yelp', 'yelp_yahoo', 'angi', 'trustpilot', 'houzz', 'porch'].includes(r.source)) {
          reviewData[r.source] = {
            ...r.structured,
            raw_text: r.text
          };
          // Also populate google_maps_local from google_maps for review analyzer compatibility
          if (r.source === 'google_maps' && !reviewData.google_maps_local) {
            reviewData.google_maps_local = {
              ...r.structured,
              raw_text: r.text
            };
          }
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
    } else if (sourceName === 'bbb') {
      // Use Python httpx scraper for BBB
      try {
        const bbbResult = await scrapeBBBPython(contractor.name, contractor.city, contractor.state);
        result = {
          source: 'bbb',
          url: bbbResult.profile_url || 'https://www.bbb.org',
          status: bbbResult.found ? 'success' : 'not_found',
          text: JSON.stringify(bbbResult, null, 2),
          structured: bbbResult
        };
        if (bbbResult.found) {
          log(`    📋 BBB (Python): Rating=${bbbResult.rating}, Accredited=${bbbResult.accredited}`);
        }
      } catch (err) {
        result = { source: 'bbb', status: 'error', error: err.message };
      }
    } else if (sourceName === 'yelp_yahoo') {
      // Use Python Playwright scraper for Yelp via Yahoo
      try {
        const location = `${contractor.city}, ${contractor.state}`;
        const yelpResult = await scrapeYelpYahooPython(contractor.name, location);
        result = {
          source: 'yelp_yahoo',
          url: yelpResult.yelp_url || 'https://www.yelp.com',
          status: yelpResult.found ? 'success' : 'not_found',
          text: JSON.stringify(yelpResult, null, 2),
          structured: yelpResult
        };
        if (yelpResult.found) {
          log(`    📋 Yelp (Yahoo): ${yelpResult.rating}★ (${yelpResult.review_count} reviews)`);
        }
      } catch (err) {
        result = { source: 'yelp_yahoo', status: 'error', error: err.message };
      }
    } else if (sourceName === 'angi' || sourceName === 'houzz') {
      // Use SERP scraper for these sites (bypasses anti-bot)
      const siteMap = { angi: 'angi.com', houzz: 'houzz.com' };
      try {
        const location = `${contractor.city}, ${contractor.state}`;
        const serpResult = await scrapeSerpRatingPython(contractor.name, location, siteMap[sourceName]);
        result = {
          source: sourceName,
          url: serpResult.url || `https://www.${siteMap[sourceName]}`,
          status: serpResult.found ? 'success' : 'not_found',
          text: JSON.stringify(serpResult, null, 2),
          structured: serpResult
        };
        if (serpResult.found) {
          log(`    📋 ${sourceName}: ${serpResult.rating}★ (${serpResult.review_count} reviews)`);
        }
      } catch (err) {
        result = { source: sourceName, status: 'error', error: err.message };
      }
    } else if (sourceName === 'trustpilot') {
      // Use direct URL check (trustpilot.com/review/{domain}) - more accurate than SERP
      try {
        const tpResult = await scrapeTrustpilotPython(contractor.website);
        result = {
          source: 'trustpilot',
          url: tpResult.profile_url || 'https://www.trustpilot.com',
          status: tpResult.found ? 'success' : 'not_found',
          text: JSON.stringify(tpResult, null, 2),
          structured: tpResult
        };
        if (tpResult.found) {
          log(`    📋 Trustpilot: ${tpResult.rating}★ (${tpResult.review_count} reviews) - ${tpResult.business_name}`);
        } else if (!contractor.website) {
          log(`    ⏭️  Trustpilot: Skipped (no website)`);
        }
      } catch (err) {
        result = { source: 'trustpilot', status: 'error', error: err.message };
      }
    } else if (sourceName === 'google_maps' || sourceName === 'google_maps_local' || sourceName === 'google_maps_hq') {
      // Use Python Playwright scraper for Google Maps (NO API)
      try {
        const location = `${contractor.city}, ${contractor.state}`;
        const gmapsResult = await scrapeGoogleMapsPython(contractor.name, location);
        result = {
          source: sourceName,
          url: gmapsResult.maps_url || 'https://www.google.com/maps',
          status: gmapsResult.found ? 'success' : 'not_found',
          text: JSON.stringify(gmapsResult, null, 2),
          structured: gmapsResult
        };
        if (gmapsResult.found) {
          log(`    📋 Google Maps (Python): ${gmapsResult.rating}★ (${gmapsResult.review_count} reviews)`);
        }
      } catch (err) {
        result = { source: sourceName, status: 'error', error: err.message };
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
// ... existing code ...

