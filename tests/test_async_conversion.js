#!/usr/bin/env node

/**
 * Test script for async conversion
 * Tests that execSync -> runCommand conversion works correctly
 */

const path = require('path');
const { runCommand } = require('./services/async_command');

const SCRAPERS_DIR = path.join(__dirname, 'scrapers');

async function testBBBScraper() {
  console.log('Testing BBB scraper with async runCommand...');

  const scriptPath = path.join(SCRAPERS_DIR, 'bbb.py');
  const businessName = 'Test Company';
  const city = 'Dallas';
  const state = 'TX';

  try {
    const result = await runCommand('python3', [
      scriptPath,
      businessName,
      city,
      state,
      '--with-details',
      '--json'
    ], {
      cwd: SCRAPERS_DIR,
      timeout: 60000,
      json: true
    });

    console.log('\n✅ SUCCESS: BBB scraper completed');
    console.log('Result:', JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    if (err.stdout) {
      console.log('STDOUT:', err.stdout);
    }
    if (err.stderr) {
      console.log('STDERR:', err.stderr);
    }
    throw err;
  }
}

async function testYelpScraper() {
  console.log('\n\nTesting Yelp scraper with async runCommand...');

  const scriptPath = path.join(SCRAPERS_DIR, 'yelp.py');
  const businessName = 'Test Company';
  const location = 'Dallas, TX';

  try {
    const output = await runCommand('python3', [
      scriptPath,
      businessName,
      location,
      '--yahoo'
    ], {
      cwd: SCRAPERS_DIR,
      timeout: 60000
    });

    // Parse output - look for rating pattern
    const ratingMatch = output.match(/Rating:\s*([\d.]+)/);
    const reviewsMatch = output.match(/Reviews:\s*(\d+)/);
    const urlMatch = output.match(/URL:\s*(https?:\/\/[^\s]+)/);
    const foundMatch = output.match(/Found:\s*(True|False)/i);

    const result = {
      found: foundMatch ? foundMatch[1].toLowerCase() === 'true' : false,
      rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
      review_count: reviewsMatch ? parseInt(reviewsMatch[1]) : null,
      yelp_url: urlMatch ? urlMatch[1] : null,
      source: 'yahoo_yelp'
    };

    console.log('\n✅ SUCCESS: Yelp scraper completed');
    console.log('Result:', JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    if (err.stdout) {
      console.log('STDOUT:', err.stdout);
    }
    if (err.stderr) {
      console.log('STDERR:', err.stderr);
    }
    throw err;
  }
}

async function testWebsiteScraper() {
  console.log('\n\nTesting website scraper with async runCommand...');

  const scriptPath = path.join(SCRAPERS_DIR, 'website_scraper.js');
  const url = 'https://example.com';

  try {
    const result = await runCommand('node', [scriptPath, url], {
      timeout: 30000,
      json: true
    });

    console.log('\n✅ SUCCESS: Website scraper completed');
    console.log('Result:', JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    console.error('\n❌ ERROR:', err.message);
    if (err.stdout) {
      console.log('STDOUT:', err.stdout);
    }
    if (err.stderr) {
      console.log('STDERR:', err.stderr);
    }
    throw err;
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('ASYNC COMMAND CONVERSION TEST');
  console.log('='.repeat(80));

  const tests = [
    { name: 'BBB Scraper', fn: testBBBScraper },
    { name: 'Yelp Scraper', fn: testYelpScraper },
    { name: 'Website Scraper', fn: testWebsiteScraper }
  ];

  const results = [];

  for (const test of tests) {
    try {
      await test.fn();
      results.push({ name: test.name, status: 'PASS' });
    } catch (err) {
      results.push({ name: test.name, status: 'FAIL', error: err.message });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));

  for (const result of results) {
    const status = result.status === 'PASS' ? '✅' : '❌';
    console.log(`${status} ${result.name}: ${result.status}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }

  const passCount = results.filter(r => r.status === 'PASS').length;
  console.log(`\nTotal: ${passCount}/${results.length} tests passed`);

  process.exit(passCount === results.length ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
