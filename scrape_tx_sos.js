#!/usr/bin/env node
/**
 * Texas Secretary of State / Comptroller Entity Scraper
 *
 * Uses Puppeteer to search the TX Comptroller's entity database
 * and extracts: legal name, formation date, status, registered agent, officers.
 *
 * Target: https://mycpa.cpa.state.tx.us/coa/
 *
 * Usage:
 *   node scrape_tx_sos.js [options]
 *
 * Options:
 *   --limit N         Process only N contractors
 *   --dry-run         Don't save to database
 *   --name "Name"     Test single contractor by name
 *   --id N            Process single contractor by database ID
 *   --delay N         Seconds between requests (default: 2)
 *   --verbose         Show debug output
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// Config
const DB_PATH = path.join(__dirname, 'db.sqlite3');
const SEARCH_URL = 'https://mycpa.cpa.state.tx.us/coa/';

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  if (['dry-run', 'verbose'].includes(name)) return true;
  return args[idx + 1];
};

const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : null;
const DRY_RUN = getArg('dry-run') || false;
const SINGLE_NAME = getArg('name');
const SINGLE_ID = getArg('id') ? parseInt(getArg('id')) : null;
const VERBOSE = getArg('verbose') || false;
const DELAY = getArg('delay') ? parseFloat(getArg('delay')) : 2;

// Logging helpers
const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);
const debug = (msg) => VERBOSE && console.log(`\x1b[90m${msg}\x1b[0m`);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Search for entity using Puppeteer
 * @param {Object} browser - Puppeteer browser instance
 * @param {string} name - Business name to search
 * @returns {Object|null} - Entity data or null if not found
 */
async function searchEntity(browser, name) {
  const page = await browser.newPage();

  try {
    // Set viewport and user agent
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    debug(`  Navigating to ${SEARCH_URL}`);
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for the search form to load
    await page.waitForSelector('input[name="taxpayerName"], input[name="taxPayerName"], input#taxpayerName, form input[type="text"]', { timeout: 10000 });

    // Find and fill the search input (try multiple possible selectors)
    const searchSelectors = [
      'input[name="taxpayerName"]',
      'input[name="taxPayerName"]',
      'input#taxpayerName',
      'input#taxPayerName',
      'input[name="searchName"]',
      'form input[type="text"]:first-of-type'
    ];

    let inputFound = false;
    for (const selector of searchSelectors) {
      try {
        const input = await page.$(selector);
        if (input) {
          await input.click({ clickCount: 3 }); // Select all existing text
          await input.type(name, { delay: 50 });
          debug(`  Filled search input using selector: ${selector}`);
          inputFound = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!inputFound) {
      throw new Error('Could not find search input field');
    }

    // Find and click the search button
    const buttonSelectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      'input[value="Search"]',
      'input[value="Submit"]',
      'button:contains("Search")',
      'form button'
    ];

    let buttonClicked = false;
    for (const selector of buttonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            button.click()
          ]);
          debug(`  Clicked submit using selector: ${selector}`);
          buttonClicked = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!buttonClicked) {
      // Try pressing Enter as fallback
      await page.keyboard.press('Enter');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
      debug('  Submitted form via Enter key');
    }

    // Wait a moment for results to render
    await sleep(1000);

    // Check for "no results" message
    const pageContent = await page.content();
    const noResultsPatterns = [
      /no\s*(records?|results?|matches?)\s*(found|returned)/i,
      /0\s*results?/i,
      /did not find any/i,
      /no\s*taxpayer/i
    ];

    for (const pattern of noResultsPatterns) {
      if (pattern.test(pageContent)) {
        debug('  No results found (matched no-results pattern)');
        return null;
      }
    }

    // Try to extract entity data from results
    const entityData = await extractEntityData(page, name);
    return entityData;

  } catch (err) {
    debug(`  Search error: ${err.message}`);
    throw err;
  } finally {
    await page.close();
  }
}

/**
 * Extract entity data from results page
 * @param {Object} page - Puppeteer page
 * @param {string} searchName - Original search name for matching
 * @returns {Object|null} - Extracted entity data
 */
async function extractEntityData(page, searchName) {
  // Try to find result rows or detail sections
  const data = await page.evaluate((searchName) => {
    const result = {
      legal_name: null,
      formation_date: null,
      entity_status: null,
      sos_status: null,
      registered_agent: null,
      registered_office: null,
      officers: [],
      taxpayer_number: null,
      sos_file_number: null,
      state_of_formation: null
    };

    // Helper to get text content by label
    const getValueByLabel = (labelText) => {
      const labels = Array.from(document.querySelectorAll('td, th, dt, label, span, div'));
      for (const el of labels) {
        if (el.textContent.toLowerCase().includes(labelText.toLowerCase())) {
          // Check next sibling or adjacent cell
          const next = el.nextElementSibling;
          if (next) return next.textContent.trim();

          // Check parent's next sibling
          const parentNext = el.parentElement?.nextElementSibling;
          if (parentNext) return parentNext.textContent.trim();
        }
      }
      return null;
    };

    // Try to find data from table or detail view
    const tables = document.querySelectorAll('table');

    // Look for specific fields by common labels
    result.legal_name = getValueByLabel('Taxpayer Name') ||
                        getValueByLabel('Business Name') ||
                        getValueByLabel('Entity Name') ||
                        getValueByLabel('Legal Name');

    result.formation_date = getValueByLabel('SOS Registration Date') ||
                            getValueByLabel('Formation Date') ||
                            getValueByLabel('Date Formed') ||
                            getValueByLabel('Effective Date');

    result.entity_status = getValueByLabel('Right to Transact') ||
                           getValueByLabel('Status') ||
                           getValueByLabel('Entity Status');

    result.sos_status = getValueByLabel('SOS Status') ||
                        getValueByLabel('SOS Registration Status');

    result.registered_agent = getValueByLabel('Registered Agent') ||
                              getValueByLabel('Agent Name');

    result.registered_office = getValueByLabel('Registered Office') ||
                               getValueByLabel('Office Address');

    result.taxpayer_number = getValueByLabel('Taxpayer Number') ||
                             getValueByLabel('Taxpayer ID') ||
                             getValueByLabel('TX Taxpayer');

    result.sos_file_number = getValueByLabel('SOS File Number') ||
                             getValueByLabel('File Number');

    result.state_of_formation = getValueByLabel('State of Formation') ||
                                getValueByLabel('State Formed');

    // Try to extract officers from tables
    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.toLowerCase());
      const hasOfficerInfo = headers.some(h =>
        h.includes('officer') || h.includes('director') || h.includes('title')
      );

      if (hasOfficerInfo) {
        const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length >= 2) {
            const officer = {
              name: cells[0]?.textContent.trim() || null,
              title: cells[1]?.textContent.trim() || null
            };
            if (officer.name && officer.name !== '') {
              result.officers.push(officer);
            }
          }
        }
      }
    }

    // If we found a legal name, consider it a match
    if (result.legal_name) {
      return result;
    }

    // Try to find first result in a list and extract basic info
    const resultLinks = document.querySelectorAll('a[href*="taxpayer"], a[href*="detail"], table a');
    if (resultLinks.length > 0) {
      // Get the first result's text as legal name
      result.legal_name = resultLinks[0].textContent.trim();
      return result;
    }

    // Last resort: look for any prominent text that might be the business name
    const heading = document.querySelector('h1, h2, h3, .result-name, .business-name');
    if (heading) {
      result.legal_name = heading.textContent.trim();
      return result;
    }

    return null;
  }, searchName);

  return data;
}

/**
 * Fuzzy match names for verification
 * @param {string} searchName - Name we searched for
 * @param {string} foundName - Name we found
 * @returns {boolean} - Whether names are a reasonable match
 */
function namesMatch(searchName, foundName) {
  if (!searchName || !foundName) return false;

  const normalize = (s) => s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const a = normalize(searchName);
  const b = normalize(foundName);

  // Exact match
  if (a === b) return true;

  // Contains match
  if (a.includes(b) || b.includes(a)) return true;

  // Word overlap
  const aWords = a.split(' ').filter(w => w.length > 2);
  const bWords = b.split(' ').filter(w => w.length > 2);
  const matched = aWords.filter(w => bWords.some(bw => bw.includes(w) || w.includes(bw)));

  return matched.length >= Math.min(aWords.length, bWords.length) * 0.5;
}

/**
 * Calculate years since formation
 * @param {string} formationDate - Date string (various formats)
 * @returns {number|null} - Years since formation or null
 */
function calculateYearsInBusiness(formationDate) {
  if (!formationDate) return null;

  // Try MM/DD/YYYY format
  let match = formationDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const year = parseInt(match[3]);
    if (year > 1900 && year <= new Date().getFullYear()) {
      return new Date().getFullYear() - year;
    }
  }

  // Try YYYY-MM-DD format
  match = formationDate.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = parseInt(match[1]);
    if (year > 1900 && year <= new Date().getFullYear()) {
      return new Date().getFullYear() - year;
    }
  }

  // Try to extract just the year
  match = formationDate.match(/\b(19|20)\d{2}\b/);
  if (match) {
    const year = parseInt(match[0]);
    return new Date().getFullYear() - year;
  }

  return null;
}

/**
 * Check for years in business mismatch
 * @param {Object} contractor - Contractor record from DB
 * @param {Object} sosData - Scraped SOS data
 * @returns {Object|null} - Mismatch flag or null
 */
function checkYearsMismatch(contractor, sosData) {
  const sosYears = calculateYearsInBusiness(sosData.formation_date);
  if (!sosYears) return null;

  // Check against BBB years in business if available
  const claimedYears = contractor.bbb_years_in_business;
  if (!claimedYears) return null;

  const diff = Math.abs(claimedYears - sosYears);
  if (diff >= 3) {
    return {
      severity: diff >= 5 ? 'high' : 'medium',
      category: 'years_mismatch',
      description: `Claimed ${claimedYears} years in business, but TX SOS shows formation ${sosYears} years ago (${sosData.formation_date})`,
      claimed_years: claimedYears,
      actual_years: sosYears,
      formation_date: sosData.formation_date
    };
  }

  return null;
}

/**
 * Check entity status for red flags
 * @param {Object} sosData - SOS data
 * @returns {Object|null} - Status flag or null
 */
function checkEntityStatus(sosData) {
  const status = (sosData.entity_status || '').toUpperCase();
  const sosStatus = (sosData.sos_status || '').toUpperCase();

  if (status.includes('FORFEITED') || status.includes('INVOLUNTARILY') || status.includes('TERMINATED')) {
    return {
      severity: 'high',
      category: 'entity_status',
      description: `Entity status: ${sosData.entity_status}`,
      entity_status: sosData.entity_status,
      sos_status: sosData.sos_status
    };
  }

  if (sosStatus === 'INACTIVE' || status.includes('INACTIVE')) {
    return {
      severity: 'medium',
      category: 'entity_status',
      description: `Entity status: INACTIVE`,
      entity_status: sosData.entity_status,
      sos_status: sosData.sos_status
    };
  }

  return null;
}

/**
 * Process a single contractor
 * @param {Object} browser - Puppeteer browser
 * @param {Object} contractor - Contractor record
 * @returns {Object} - Result with SOS data and any flags
 */
async function processContractor(browser, contractor) {
  const result = {
    contractor_id: contractor.id,
    business_name: contractor.business_name,
    search_success: false,
    match_found: false,
    data: null,
    flags: [],
    error: null
  };

  try {
    log(`  Searching TX SOS...`);
    const sosData = await searchEntity(browser, contractor.business_name);

    if (!sosData) {
      result.error = 'no_results';
      return result;
    }

    result.search_success = true;

    // Verify the match
    if (!sosData.legal_name || !namesMatch(contractor.business_name, sosData.legal_name)) {
      result.error = 'no_match';
      debug(`  Name mismatch: searched "${contractor.business_name}", found "${sosData.legal_name}"`);
      return result;
    }

    result.match_found = true;
    result.data = sosData;

    // Check for red flags
    const yearsMismatch = checkYearsMismatch(contractor, sosData);
    if (yearsMismatch) {
      result.flags.push(yearsMismatch);
      warn(`  FLAG: ${yearsMismatch.description}`);
    }

    const statusFlag = checkEntityStatus(sosData);
    if (statusFlag) {
      result.flags.push(statusFlag);
      warn(`  FLAG: ${statusFlag.description}`);
    }

    return result;

  } catch (err) {
    result.error = err.message;
    return result;
  }
}

/**
 * Save results to database
 * @param {Object} db - sql.js database
 * @param {number} contractorId - Contractor ID
 * @param {Object} sosData - SOS data to save
 * @param {Array} flags - Any flags detected
 */
function saveToDatabase(db, contractorId, sosData, flags) {
  const now = new Date().toISOString();

  // Use existing license_* fields to store SOS data
  db.run(`
    UPDATE contractors_contractor SET
      license_number = ?,
      license_status = ?,
      license_type = 'TX_SOS'
    WHERE id = ?
  `, [
    sosData.sos_file_number || sosData.taxpayer_number,
    sosData.entity_status || sosData.sos_status,
    contractorId
  ]);

  // Append flags to ai_red_flags if any
  if (flags.length > 0) {
    const existingResult = db.exec(`SELECT ai_red_flags FROM contractors_contractor WHERE id = ?`, [contractorId]);
    let allFlags = [];
    if (existingResult.length > 0 && existingResult[0].values[0][0]) {
      try {
        allFlags = JSON.parse(existingResult[0].values[0][0]);
        if (!Array.isArray(allFlags)) allFlags = [];
      } catch (e) {
        allFlags = [];
      }
    }

    // Add new flags with source tag
    const taggedFlags = flags.map(f => ({ ...f, source: 'tx_sos_scraper' }));
    allFlags.push(...taggedFlags);

    db.run(`UPDATE contractors_contractor SET ai_red_flags = ? WHERE id = ?`, [JSON.stringify(allFlags), contractorId]);
  }

  debug(`  Saved: license_number=${sosData.sos_file_number || sosData.taxpayer_number}, status=${sosData.entity_status}`);
}

/**
 * Main function
 */
async function main() {
  log('=== TEXAS SOS ENTITY SCRAPER (Puppeteer) ===\n');
  log(`Target: ${SEARCH_URL}\n`);

  if (DRY_RUN) {
    warn('DRY RUN MODE - not saving to database\n');
  }

  // Open database
  const SQL = await initSqlJs();
  let db = null;

  if (!SINGLE_NAME || !DRY_RUN) {
    const dbBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(dbBuffer);
  }

  let contractors = [];

  if (SINGLE_NAME) {
    // Test mode - single contractor by name
    contractors = [{
      id: null,
      business_name: SINGLE_NAME,
      city: 'TX',
      bbb_years_in_business: null
    }];
    log(`Testing single contractor: ${SINGLE_NAME}\n`);
  } else if (SINGLE_ID) {
    // Single contractor by ID
    const result = db.exec(`
      SELECT id, business_name, city, bbb_years_in_business
      FROM contractors_contractor
      WHERE id = ?
    `, [SINGLE_ID]);

    if (!result.length || !result[0].values.length) {
      error(`Contractor with ID ${SINGLE_ID} not found`);
      db.close();
      process.exit(1);
    }

    const row = result[0].values[0];
    contractors = [{
      id: row[0],
      business_name: row[1],
      city: row[2],
      bbb_years_in_business: row[3]
    }];
    log(`Processing contractor ID ${SINGLE_ID}: ${contractors[0].business_name}\n`);
  } else {
    // Batch mode - get contractors needing SOS lookup
    let query = `
      SELECT id, business_name, city, bbb_years_in_business
      FROM contractors_contractor
      WHERE is_active = 1
        AND state = 'TX'
        AND (license_type IS NULL OR license_type != 'TX_SOS')
      ORDER BY trust_score DESC
    `;

    if (LIMIT) {
      query += ` LIMIT ${LIMIT}`;
    }

    const result = db.exec(query);
    if (result.length > 0) {
      contractors = result[0].values.map(row => ({
        id: row[0],
        business_name: row[1],
        city: row[2],
        bbb_years_in_business: row[3]
      }));
    }

    log(`Found ${contractors.length} contractors to process\n`);
  }

  if (contractors.length === 0) {
    log('No contractors to process.');
    if (db) db.close();
    return;
  }

  // Launch browser
  log('Launching browser...\n');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let processed = 0;
  let found = 0;
  let notFound = 0;
  let errors = 0;
  let flagged = 0;

  try {
    for (let i = 0; i < contractors.length; i++) {
      const c = contractors[i];
      const num = i + 1;

      log(`[${num}/${contractors.length}] ${c.business_name}`);

      const result = await processContractor(browser, c);
      processed++;

      if (result.error) {
        if (result.error === 'no_results' || result.error === 'no_match') {
          warn(`  No entity found`);
          notFound++;
        } else {
          error(`  Error: ${result.error}`);
          errors++;
        }
      } else if (result.data) {
        success(`  Found: ${result.data.legal_name}`);

        if (result.data.formation_date) {
          const years = calculateYearsInBusiness(result.data.formation_date);
          log(`    Formation: ${result.data.formation_date}${years ? ` (${years} years ago)` : ''}`);
        }
        if (result.data.entity_status) {
          const statusColor = (result.data.entity_status || '').toUpperCase().includes('ACTIVE') ? log : warn;
          statusColor(`    Status: ${result.data.entity_status}`);
        }
        if (result.data.sos_status) {
          log(`    SOS Status: ${result.data.sos_status}`);
        }
        if (result.data.registered_agent) {
          log(`    Agent: ${result.data.registered_agent}`);
        }
        if (result.data.officers && result.data.officers.length > 0) {
          log(`    Officers: ${result.data.officers.map(o => `${o.title || 'Officer'}: ${o.name}`).join(', ')}`);
        }

        found++;

        if (result.flags.length > 0) {
          flagged++;
        }

        // Save to database
        if (!DRY_RUN && c.id && db) {
          try {
            saveToDatabase(db, c.id, result.data, result.flags);
          } catch (saveErr) {
            error(`  Save error: ${saveErr.message}`);
          }
        }
      }

      // Delay between contractors
      if (i < contractors.length - 1) {
        await sleep(DELAY * 1000);
      }
    }
  } finally {
    await browser.close();

    // Save database
    if (!DRY_RUN && found > 0 && db) {
      log('\nSaving database...');
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
      success('Database saved.');
    }

    if (db) db.close();
  }

  // Summary
  log('\n' + '='.repeat(50));
  log('SUMMARY');
  log('='.repeat(50));
  success(`Entities found:    ${found}`);
  warn(`Not found:         ${notFound}`);
  error(`Errors:            ${errors}`);
  if (flagged > 0) {
    warn(`Flagged:           ${flagged}`);
  }
  log(`Total processed:   ${processed}`);

  if (processed > 0) {
    const hitRate = ((found / processed) * 100).toFixed(1);
    log(`Hit rate:          ${hitRate}%`);
  }

  if (DRY_RUN) {
    warn('\nDRY RUN - no changes saved. Remove --dry-run to save.');
  }
}

// Run
main().catch(err => {
  error(`Fatal error: ${err.message}`);
  if (VERBOSE) {
    console.error(err.stack);
  }
  process.exit(1);
});
