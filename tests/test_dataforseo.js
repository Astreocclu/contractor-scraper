/**
 * DataForSEO Google Reviews - Quick Test
 *
 * Run: node tests/test_dataforseo.js
 * Live test: node tests/test_dataforseo.js --live
 * 
 * Requires: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in .env
 * Free $1 credit on signup → ~13,000 reviews
 */

// Load .env manually (no dotenv dependency in this project)
const fs = require('fs');
const envPath = require('path').join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
}

const { scrapeGoogleReviewsDataForSEO, transformReview } = require('../services/dataforseo_service');

// Test with a known business that Apify capped at 100 reviews
const TEST_BUSINESS = 'Firefighter Roofing';
const TEST_LOCATION = 'Fort Worth, TX';
const TEST_MAX_REVIEWS = 500; // Ask for 500 to see if we get more than Apify's 100 cap

async function testTransform() {
    console.log('\n=== Test: transformReview ===');

    const dfsReview = {
        review_text: 'Great service, highly recommend!',
        rating: { value: 5, votes_count: 0, max_value: 5 },
        profile_name: 'John Doe',
        review_url: 'https://google.com/maps/reviews/...',
        time_ago: '2 months ago',
        owner_answer: 'Thank you for the kind words!',
        review_images: [],
        review_likes: 3
    };

    const transformed = transformReview(dfsReview);

    console.assert(transformed.text === 'Great service, highly recommend!', 'text should match');
    console.assert(transformed.rating === 5, 'rating should be 5');
    console.assert(transformed.reviewer_name === 'John Doe', 'reviewer_name should match');
    console.assert(transformed.source === 'google', 'source should be google');
    console.assert(transformed.provider === 'dataforseo', 'provider should be dataforseo');
    console.assert(transformed.owner_response === 'Thank you for the kind words!', 'owner_response should match');
    console.assert(transformed.review_likes === 3, 'review_likes should be 3');

    console.log('PASS: transformReview works correctly');
}

async function testCredentials() {
    console.log('\n=== Test: Credentials Check ===');

    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;

    if (!login || !password) {
        console.log('FAIL: DATAFORSEO_LOGIN and/or DATAFORSEO_PASSWORD not set in .env');
        console.log('  → Sign up at https://app.dataforseo.com/register');
        console.log('  → Get API creds from https://app.dataforseo.com/api-access');
        console.log('  → Add to .env:');
        console.log('    DATAFORSEO_LOGIN=your-email@example.com');
        console.log('    DATAFORSEO_PASSWORD=your-api-password');
        return false;
    }

    // Test auth with a lightweight call
    const encoded = Buffer.from(`${login}:${password}`).toString('base64');
    try {
        const res = await fetch('https://api.dataforseo.com/v3/business_data/google/languages', {
            headers: { 'Authorization': `Basic ${encoded}` }
        });

        if (res.ok) {
            console.log('PASS: Credentials valid ✓');
            return true;
        } else {
            console.log(`FAIL: Auth failed with status ${res.status}`);
            const text = await res.text();
            console.log(`  Response: ${text.slice(0, 200)}`);
            return false;
        }
    } catch (err) {
        console.log(`FAIL: Connection error: ${err.message}`);
        return false;
    }
}

async function testLiveReviewScrape() {
    console.log('\n=== Test: LIVE Google Reviews Scrape ===');
    console.log(`Business: ${TEST_BUSINESS}`);
    console.log(`Location: ${TEST_LOCATION}`);
    console.log(`Max Reviews: ${TEST_MAX_REVIEWS}`);
    console.log('This may take 1-5 minutes...\n');

    const startTime = Date.now();
    const result = await scrapeGoogleReviewsDataForSEO(TEST_BUSINESS, TEST_LOCATION, TEST_MAX_REVIEWS);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n--- Results ---');
    console.log(`Time: ${elapsed}s`);
    console.log(`Found: ${result.found}`);

    if (result.found) {
        console.log(`Business: ${result.business_name}`);
        console.log(`Rating: ${result.rating}`);
        console.log(`Total reviews on Google: ${result.total_review_count}`);
        console.log(`Reviews fetched: ${result.fetched_review_count}`);
        console.log(`Reviews with text: ${result.nonempty_review_count}`);
        console.log(`Cost: $${result.cost}`);
        console.log(`Maps URL: ${result.maps_url}`);
        console.log(`Task ID: ${result.task_id}`);

        // Show first 3 reviews
        console.log('\n--- Sample Reviews ---');
        const sample = result.reviews.slice(0, 3);
        for (const review of sample) {
            console.log(`  ★${review.rating} by ${review.reviewer_name} (${review.review_date})`);
            console.log(`    "${(review.text || '(no text)').slice(0, 150)}"`);
            if (review.owner_response) {
                console.log(`    → Owner: "${review.owner_response.slice(0, 100)}"`);
            }
            console.log('');
        }

        // Compare with Apify's 100-review cap
        console.log('--- Comparison with Apify ---');
        console.log(`  Apify fetched: 100 reviews (capped)`);
        console.log(`  DataForSEO fetched: ${result.fetched_review_count} reviews`);
        if (result.fetched_review_count > 100) {
            console.log(`  ✅ DataForSEO got ${result.fetched_review_count - 100} MORE reviews than Apify!`);
        } else if (result.fetched_review_count === result.total_review_count) {
            console.log(`  ✅ DataForSEO got ALL ${result.fetched_review_count} reviews (100% complete)`);
        }

        // Save full results to file for inspection
        const fs = require('fs');
        const outPath = require('path').join(__dirname, '..', 'data', `dataforseo_test_${TEST_BUSINESS.toLowerCase().replace(/\s+/g, '_')}.json`);
        fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
        console.log(`\nFull results saved to: ${outPath}`);
    } else {
        console.log(`Error: ${result.error}`);
    }
}

async function runTests() {
    console.log('DataForSEO Service Tests');
    console.log('========================\n');

    await testTransform();

    const credsOk = await testCredentials();

    if (process.argv.includes('--live')) {
        if (credsOk) {
            await testLiveReviewScrape();
        } else {
            console.log('\n=== Skipping live test (credentials not valid) ===');
        }
    } else {
        console.log('\n=== Skipping live API test (run with --live flag) ===');
    }

    console.log('\n========================');
    console.log('Tests complete');
}

runTests().catch(console.error);
