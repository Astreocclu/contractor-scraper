#!/usr/bin/env node
/**
 * Email Backfill Script
 *
 * Finds contractors with websites but no email, visits their sites,
 * and extracts email addresses.
 *
 * Usage:
 *   node scrapers/backfill_emails.js [--test] [--limit N] [--ids 1,2,3]
 *
 * Options:
 *   --test    Run on test IDs only (101, 19, 9, 33, 60)
 *   --limit N Process only N contractors
 *   --ids X   Comma-separated list of contractor IDs
 *   --dry-run Don't save to database, just log results
 */

const { chromium } = require('playwright');
const { Pool } = require('pg');
const { scrapeEmailFromWebsite } = require('./website_scraper');

// Parse command line args
const args = process.argv.slice(2);
const isTest = args.includes('--test');
const isDryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null;
const idsIdx = args.indexOf('--ids');
const specificIds = idsIdx !== -1 ? args[idsIdx + 1].split(',').map(Number) : null;

// Test IDs (verified to have website but no email)
const TEST_IDS = [101, 19, 9, 33, 60];

// Database connection
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'contractors_dev',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '',
});

/**
 * Sleep for random duration (rate limiting)
 * @param {number} minMs - Minimum milliseconds
 * @param {number} maxMs - Maximum milliseconds
 */
function sleep(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch contractors needing email backfill
 * @returns {Promise<Array<{id: number, business_name: string, website: string}>>}
 */
async function fetchContractorsNeedingEmail() {
  let query = `
    SELECT id, business_name, website
    FROM contractors_contractor
    WHERE website IS NOT NULL
      AND website != ''
      AND (email IS NULL OR email = '')
  `;

  const params = [];

  if (isTest) {
    query += ` AND id = ANY($1)`;
    params.push(TEST_IDS);
  } else if (specificIds) {
    query += ` AND id = ANY($1)`;
    params.push(specificIds);
  }

  query += ` ORDER BY id`;

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Update contractor email in database
 * @param {number} id - Contractor ID
 * @param {string} email - Email address
 */
async function updateContractorEmail(id, email) {
  if (isDryRun) {
    console.log(`  [DRY RUN] Would update ID ${id} with email: ${email}`);
    return;
  }

  await pool.query(
    `UPDATE contractors_contractor SET email = $1 WHERE id = $2`,
    [email, id]
  );
}

/**
 * Main backfill function
 */
async function main() {
  console.log('=== Email Backfill Script ===');
  console.log(`Mode: ${isTest ? 'TEST' : isDryRun ? 'DRY RUN' : 'PRODUCTION'}`);
  console.log('');

  // Fetch contractors
  const contractors = await fetchContractorsNeedingEmail();
  console.log(`Found ${contractors.length} contractors needing email`);
  console.log('');

  if (contractors.length === 0) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  // Launch browser
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });

  // Stats
  let processed = 0;
  let found = 0;
  let errors = 0;

  try {
    for (const contractor of contractors) {
      processed++;
      const progress = `[${processed}/${contractors.length}]`;

      console.log(`${progress} ${contractor.business_name} (ID: ${contractor.id})`);
      console.log(`  URL: ${contractor.website}`);

      const result = await scrapeEmailFromWebsite(contractor.website, { browser });

      if (result.error) {
        console.log(`  ERROR: ${result.error}`);
        errors++;
      } else if (result.email) {
        console.log(`  FOUND: ${result.email} (from ${result.source})`);
        found++;
        await updateContractorEmail(contractor.id, result.email);
      } else {
        console.log(`  NO EMAIL FOUND`);
      }

      console.log('');

      // Rate limiting: 1-3 second delay between requests
      if (processed < contractors.length) {
        await sleep(1000, 3000);
      }
    }
  } finally {
    await browser.close();
    await pool.end();
  }

  // Summary
  console.log('=== Summary ===');
  console.log(`Processed: ${processed}`);
  console.log(`Found:     ${found}`);
  console.log(`Errors:    ${errors}`);
  console.log(`Hit Rate:  ${((found / processed) * 100).toFixed(1)}%`);

  // Success criteria: 25%+ hit rate
  const hitRate = (found / processed) * 100;
  if (hitRate >= 25) {
    console.log('SUCCESS: Hit rate meets target (25%+)');
  } else {
    console.log('BELOW TARGET: Hit rate below 25%');
  }
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
