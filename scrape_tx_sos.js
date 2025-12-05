#!/usr/bin/env node
/**
 * Texas Secretary of State Entity Scraper
 *
 * Uses the TX Comptroller API to search for business entities
 * and extract: legal name, formation date, status, registered agent, officers.
 *
 * API: https://comptroller.texas.gov/data-search/franchise-tax
 *
 * Usage:
 *   node scrape_tx_sos.js [options]
 *
 * Options:
 *   --limit N         Process only N contractors
 *   --dry-run         Don't save to database
 *   --name "Name"     Test single contractor by name
 *   --id N            Process single contractor by database ID
 *   --delay N         Seconds between requests (default: 1.5)
 *   --verbose         Show debug output
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Config
const DB_PATH = path.join(__dirname, 'db.sqlite3');
const SEARCH_API = 'https://comptroller.texas.gov/data-search/franchise-tax';

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
const DELAY = getArg('delay') ? parseFloat(getArg('delay')) : 1.5;

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
 * Search for entity by name using the Comptroller API
 */
async function searchEntity(name) {
  const url = `${SEARCH_API}?name=${encodeURIComponent(name)}`;
  debug(`  Search: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Search API error: ${response.status}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error('Search API returned success: false');
  }

  return data.data || [];
}

/**
 * Get detailed entity info by taxpayer ID
 */
async function getEntityDetails(taxpayerId) {
  const url = `${SEARCH_API}/${encodeURIComponent(taxpayerId)}`;
  debug(`  Details: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Detail API error: ${response.status}`);
  }

  const result = await response.json();
  if (!result.success || !result.data) {
    throw new Error('Detail API returned no data');
  }

  return result.data;
}

/**
 * Fuzzy match contractor name against search results
 */
function findBestMatch(searchName, results) {
  if (!results || results.length === 0) return null;

  const normalize = (s) => s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const searchNorm = normalize(searchName);
  const searchWords = searchNorm.split(' ').filter(w => w.length > 2);

  let bestMatch = null;
  let bestScore = 0;

  for (const result of results) {
    const resultNorm = normalize(result.name);

    // Exact match
    if (resultNorm === searchNorm) {
      return result;
    }

    // Contains match
    if (resultNorm.includes(searchNorm) || searchNorm.includes(resultNorm)) {
      const score = 0.9;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
      continue;
    }

    // Word overlap score
    const resultWords = resultNorm.split(' ').filter(w => w.length > 2);
    const matchedWords = searchWords.filter(w => resultWords.some(rw => rw.includes(w) || w.includes(rw)));
    const score = matchedWords.length / Math.max(searchWords.length, 1);

    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = result;
    }
  }

  return bestMatch;
}

/**
 * Transform API response to standard format
 */
function transformEntityData(apiData) {
  const officers = (apiData.officerInfo || []).map(o => ({
    name: o.AGNT_NM || null,
    title: o.AGNT_TITL_TX || null,
    year: o.AGNT_ACTV_YR || null,
    address: [o.AD_STR_POB_TX, o.CITY_NM, o.ST_CD, o.AD_ZP].filter(Boolean).join(', ') || null,
    source: o.SOURCE || null
  }));

  return {
    legal_name: apiData.name || null,
    dba_name: apiData.dbaName || null,
    taxpayer_number: apiData.taxpayerId || null,
    fei_number: apiData.feiNumber || null,
    sos_file_number: apiData.sosFileNumber || null,
    formation_date: apiData.effectiveSosRegistrationDate || null,
    state_of_formation: (apiData.stateOfFormation || '').trim() || null,
    entity_status: apiData.rightToTransactTX || null,
    sos_status: apiData.sosRegistrationStatus || null,
    registered_agent: apiData.registeredAgentName || null,
    registered_office: [
      apiData.registeredOfficeAddressStreet,
      apiData.registeredOfficeAddressCity,
      apiData.registeredOfficeAddressState,
      apiData.registeredOfficeAddressZip
    ].filter(Boolean).join(', ') || null,
    mailing_address: [
      apiData.mailingAddressStreet,
      apiData.mailingAddressCity,
      apiData.mailingAddressState,
      apiData.mailingAddressZip
    ].filter(Boolean).join(', ') || null,
    officers: officers,
    report_year: apiData.reportYear || null,
    last_updated: apiData.lastUpdated || null
  };
}

/**
 * Calculate years since formation
 */
function calculateYearsInBusiness(formationDate) {
  if (!formationDate) return null;

  // Parse MM/DD/YYYY format
  const match = formationDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;

  const year = parseInt(match[3]);
  if (year && year > 1900 && year <= new Date().getFullYear()) {
    return new Date().getFullYear() - year;
  }

  return null;
}

/**
 * Check for years in business mismatch
 */
function checkYearsMismatch(contractor, sosData) {
  const sosYears = calculateYearsInBusiness(sosData.formation_date);
  if (!sosYears) return null;

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
 */
function checkEntityStatus(sosData) {
  const status = (sosData.entity_status || '').toUpperCase();
  const sosStatus = (sosData.sos_status || '').toUpperCase();

  if (status.includes('FORFEITED') || status.includes('INVOLUNTARILY ENDED')) {
    return {
      severity: 'high',
      category: 'entity_status',
      description: `Entity status: ${sosData.entity_status}`,
      entity_status: sosData.entity_status,
      sos_status: sosData.sos_status
    };
  }

  if (sosStatus === 'INACTIVE') {
    return {
      severity: 'medium',
      category: 'entity_status',
      description: `SOS registration status: INACTIVE`,
      entity_status: sosData.entity_status,
      sos_status: sosData.sos_status
    };
  }

  return null;
}

/**
 * Process a single contractor
 */
async function processContractor(contractor) {
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
    log(`  Searching TX Comptroller API...`);
    const searchResults = await searchEntity(contractor.business_name);
    debug(`  Found ${searchResults.length} results`);

    if (searchResults.length === 0) {
      result.error = 'no_results';
      return result;
    }

    result.search_success = true;

    // Find best match
    const match = findBestMatch(contractor.business_name, searchResults);
    if (!match) {
      result.error = 'no_match';
      debug(`  No good match found in: ${searchResults.map(r => r.name).join(', ')}`);
      return result;
    }

    result.match_found = true;
    log(`  Matched: ${match.name}`);
    debug(`  Taxpayer ID: ${match.taxpayerId}`);

    // Get detailed info
    log(`  Fetching entity details...`);
    const apiData = await getEntityDetails(match.taxpayerId);
    const sosData = transformEntityData(apiData);
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
 */
function saveToDatabase(db, contractorId, sosData, flags) {
  // Update contractor with SOS data
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

    const taggedFlags = flags.map(f => ({ ...f, source: 'tx_sos_scraper' }));
    allFlags.push(...taggedFlags);

    db.run(`UPDATE contractors_contractor SET ai_red_flags = ? WHERE id = ?`, [JSON.stringify(allFlags), contractorId]);
  }

  debug(`  Saved: license_number=${sosData.sos_file_number}, status=${sosData.entity_status}`);
}

/**
 * Main function
 */
async function main() {
  log('=== TEXAS SOS ENTITY SCRAPER ===\n');
  log(`API: ${SEARCH_API}\n`);

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

  let processed = 0;
  let found = 0;
  let notFound = 0;
  let errors = 0;
  let flagged = 0;

  for (let i = 0; i < contractors.length; i++) {
    const c = contractors[i];
    const num = i + 1;

    log(`[${num}/${contractors.length}] ${c.business_name}`);

    const result = await processContractor(c);
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
        const statusColor = result.data.entity_status.toUpperCase().includes('ACTIVE') ? log : warn;
        statusColor(`    Status: ${result.data.entity_status}`);
      }
      if (result.data.sos_status) {
        log(`    SOS Status: ${result.data.sos_status}`);
      }
      if (result.data.registered_agent) {
        log(`    Agent: ${result.data.registered_agent}`);
      }
      if (result.data.officers.length > 0) {
        log(`    Officers: ${result.data.officers.map(o => `${o.title}: ${o.name}`).join(', ')}`);
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

  // Save database
  if (!DRY_RUN && found > 0 && db) {
    log('\nSaving database...');
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
    success('Database saved.');
  }

  if (db) db.close();

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
