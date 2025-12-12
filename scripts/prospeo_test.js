#!/usr/bin/env node
/**
 * Prospeo Domain Search API Test
 * Tests email finding by company domain
 *
 * Usage:
 *   node scripts/prospeo_test.js [--limit N] [--dry-run]
 */

const https = require('https');

const API_KEY = process.env.PROSPEO_API_KEY || '11198a0b075d40178bd260ff75212240';

// Parse args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 10;
const isDryRun = args.includes('--dry-run');

// Database connection
const { Pool } = require('pg');
function createPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    return new Pool({
      host: url.hostname,
      port: url.port || 5432,
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
    });
  }
  return new Pool({
    host: 'localhost',
    database: 'contractors_dev',
    user: 'postgres',
  });
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  try {
    let clean = url.trim();
    if (!clean.startsWith('http')) {
      clean = 'https://' + clean;
    }
    const parsed = new URL(clean);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Call Prospeo Domain Search API
 */
function prospeoSearch(domain) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ company: domain, limit: 10 });

    const options = {
      hostname: 'api.prospeo.io',
      path: '/domain-search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KEY': API_KEY,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Parse error: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Prospeo Domain Search Test ===');
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Limit: ${limit} contractors`);
  console.log('');

  // First check account info
  console.log('Checking account credits...');
  const accountCheck = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.prospeo.io',
      path: '/account-information',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KEY': API_KEY,
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write('{}');
    req.end();
  });

  if (accountCheck.error) {
    console.error('API Error:', accountCheck.message);
    process.exit(1);
  }

  console.log(`Credits remaining: ${accountCheck.response?.credits_used}/${accountCheck.response?.credits_limit || 'unknown'}`);
  console.log('');

  const pool = createPool();

  // Get contractors with website but no email
  const result = await pool.query(`
    SELECT id, business_name, website
    FROM contractors_contractor
    WHERE website IS NOT NULL
      AND website != ''
      AND (email IS NULL OR email = '')
    ORDER BY id
    LIMIT $1
  `, [limit]);

  console.log(`Found ${result.rows.length} contractors to test`);
  console.log('');

  let processed = 0;
  let found = 0;
  let creditsUsed = 0;

  for (const contractor of result.rows) {
    processed++;
    const domain = extractDomain(contractor.website);

    console.log(`[${processed}/${result.rows.length}] ${contractor.business_name} (ID: ${contractor.id})`);
    console.log(`  Website: ${contractor.website}`);
    console.log(`  Domain: ${domain || 'INVALID'}`);

    if (!domain) {
      console.log('  SKIP: Invalid URL');
      console.log('');
      continue;
    }

    // Skip social media / marketplace domains
    const skipDomains = ['facebook.com', 'instagram.com', 'houzz.com', 'yelp.com', 'homedepot.com', 'lowes.com'];
    if (skipDomains.some(d => domain.includes(d))) {
      console.log('  SKIP: Social/marketplace domain');
      console.log('');
      continue;
    }

    if (isDryRun) {
      console.log('  [DRY RUN] Would search Prospeo');
      console.log('');
      continue;
    }

    try {
      const response = await prospeoSearch(domain);

      if (response.error) {
        console.log(`  ERROR: ${response.message}`);
      } else if (response.response?.email_list?.length > 0) {
        const emails = response.response.email_list;
        const bestEmail = emails.find(e => e.email_type === 'generic') || emails[0];

        console.log(`  FOUND: ${bestEmail.email} (${emails.length} total)`);
        found++;
        creditsUsed++;

        // Update database
        await pool.query(
          'UPDATE contractors_contractor SET email = $1 WHERE id = $2',
          [bestEmail.email, contractor.id]
        );
        console.log('  SAVED to database');
      } else {
        console.log('  NO RESULTS (0 credits used)');
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }

    console.log('');

    // Rate limit: 1 request per second
    await sleep(1000);
  }

  await pool.end();

  console.log('=== Summary ===');
  console.log(`Processed: ${processed}`);
  console.log(`Found: ${found}`);
  console.log(`Hit Rate: ${(found / processed * 100).toFixed(1)}%`);
  console.log(`Credits Used: ~${creditsUsed}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
