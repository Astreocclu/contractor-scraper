#!/usr/bin/env node
/**
 * Hunter.io Domain Search API Test
 *
 * Usage:
 *   node scripts/hunter_test.js [--limit N] [--dry-run]
 */

const https = require('https');

const API_KEY = process.env.HUNTER_API_KEY || 'd9ed3264d07405e2d2a5f7b608f16ec722f16a46';

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
  return new Pool({ host: 'localhost', database: 'contractors_dev', user: 'postgres' });
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  try {
    let clean = url.trim();
    if (!clean.startsWith('http')) clean = 'https://' + clean;
    const parsed = new URL(clean);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Call Hunter.io Domain Search API
 */
function hunterSearch(domain) {
  return new Promise((resolve, reject) => {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${API_KEY}`;

    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Parse error: ${body.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Hunter.io Domain Search Test ===');
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Limit: ${limit} contractors`);
  console.log('');

  // Check account
  const account = await new Promise((resolve, reject) => {
    https.get(`https://api.hunter.io/v2/account?api_key=${API_KEY}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });

  if (account.errors) {
    console.error('API Error:', account.errors);
    process.exit(1);
  }

  const credits = account.data?.requests;
  console.log(`Credits: ${credits?.searches?.used || 0}/${credits?.searches?.available || 0} searches used`);
  console.log('');

  const pool = createPool();

  const result = await pool.query(`
    SELECT id, business_name, website
    FROM contractors_contractor
    WHERE website IS NOT NULL AND website != ''
      AND (email IS NULL OR email = '')
    ORDER BY id
    LIMIT $1
  `, [limit]);

  console.log(`Found ${result.rows.length} contractors to test`);
  console.log('');

  let processed = 0, found = 0, creditsUsed = 0;

  for (const contractor of result.rows) {
    processed++;
    const domain = extractDomain(contractor.website);

    console.log(`[${processed}/${result.rows.length}] ${contractor.business_name} (ID: ${contractor.id})`);
    console.log(`  Domain: ${domain || 'INVALID'}`);

    if (!domain) {
      console.log('  SKIP: Invalid URL\n');
      continue;
    }

    // Skip social/marketplace domains
    const skipDomains = ['facebook.com', 'instagram.com', 'houzz.com', 'yelp.com', 'homedepot.com', 'lowes.com', 'google.com'];
    if (skipDomains.some(d => domain.includes(d))) {
      console.log('  SKIP: Social/marketplace\n');
      continue;
    }

    if (isDryRun) {
      console.log('  [DRY RUN] Would search Hunter.io\n');
      continue;
    }

    try {
      const response = await hunterSearch(domain);

      if (response.errors) {
        console.log(`  ERROR: ${JSON.stringify(response.errors)}`);
      } else if (response.data?.emails?.length > 0) {
        const emails = response.data.emails;
        // Prefer generic emails (info@, contact@) over personal
        const genericEmail = emails.find(e => e.type === 'generic');
        const bestEmail = genericEmail || emails[0];

        console.log(`  FOUND: ${bestEmail.value} (${emails.length} total, confidence: ${bestEmail.confidence}%)`);
        found++;
        creditsUsed += emails.length; // Hunter charges per email found

        // Update database
        await pool.query(
          'UPDATE contractors_contractor SET email = $1 WHERE id = $2',
          [bestEmail.value, contractor.id]
        );
        console.log('  SAVED');
      } else {
        console.log('  NO RESULTS');
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
    }

    console.log('');
    await sleep(1000); // Rate limit
  }

  await pool.end();

  console.log('=== Summary ===');
  console.log(`Processed: ${processed}`);
  console.log(`Found: ${found}`);
  console.log(`Hit Rate: ${(found / processed * 100).toFixed(1)}%`);
  console.log(`Credits Used: ~${creditsUsed}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
