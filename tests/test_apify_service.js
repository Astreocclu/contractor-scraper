/**
 * Integration tests for Apify service
 *
 * Run: node tests/test_apify_service.js
 * Requires: APIFY_API_TOKEN in environment
 */

const { scrapeGoogleReviewsApify, transformReview } = require('../services/apify_service');

// Test data
const TEST_URL = 'https://www.google.com/maps/place/Elite+Roofing+Solutions/@32.8795,-96.7655,17z';

async function testTransformReview() {
  console.log('\n=== Test: transformReview ===');

  const apifyReview = {
    title: 'Test Business',
    url: 'https://maps.google.com/...',
    stars: 5,
    name: 'John Doe',
    reviewUrl: 'https://maps.google.com/reviews/...',
    text: 'Great service!'
  };

  const transformed = transformReview(apifyReview);

  console.assert(transformed.text === 'Great service!', 'text should match');
  console.assert(transformed.stars === 5, 'stars should be 5');
  console.assert(transformed.reviewer_name === 'John Doe', 'reviewer_name should match');
  console.assert(transformed.source === 'google', 'source should be google');

  console.log('PASS: transformReview works correctly');
}

async function testScrapeReviewsApify() {
  console.log('\n=== Test: scrapeGoogleReviewsApify (LIVE API) ===');

  if (!process.env.APIFY_API_TOKEN) {
    console.log('SKIP: APIFY_API_TOKEN not set');
    return;
  }

  console.log(`Scraping reviews for: ${TEST_URL}`);
  console.log('This may take 1-3 minutes...\n');

  const result = await scrapeGoogleReviewsApify(TEST_URL, 10);

  console.log('Result:', JSON.stringify(result, null, 2).slice(0, 500) + '...');

  if (result.found) {
    console.assert(result.reviews.length > 0, 'should have reviews');
    console.assert(result.rating > 0, 'should have rating');
    console.assert(result.review_source === 'apify', 'source should be apify');
    console.log(`PASS: Got ${result.reviews.length} reviews, rating ${result.rating}`);
  } else {
    console.log(`WARN: Business not found or error: ${result.error}`);
  }
}

async function runTests() {
  console.log('Apify Service Tests');
  console.log('===================\n');

  await testTransformReview();

  // Only run live test if explicitly requested
  if (process.argv.includes('--live')) {
    await testScrapeReviewsApify();
  } else {
    console.log('\n=== Skipping live API test (run with --live flag) ===');
  }

  console.log('\n===================');
  console.log('Tests complete');
}

runTests().catch(console.error);
