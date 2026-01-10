# Apify Google Maps Reviews Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Apify Google Maps Reviews Scraper as a fallback option in the contractor audit pipeline.

**Architecture:** Create a Node.js service (`services/apify_service.js`) that calls Apify's REST API to run the Google Maps Reviews Scraper actor (Xb8osYTtOjlsgI6k9), polls for completion, and returns standardized review data. Integrate into `collection_service.js` as a fallback after Tiered/Serper scrapers.

**Tech Stack:** Node.js, axios (HTTP), Apify REST API v2

---

## Task 1: Create Apify Service Module

**Files:**
- Create: `services/apify_service.js`

**Step 1: Create the service file with axios and config**

```javascript
/**
 * Apify Service
 *
 * Handles interactions with Apify API for Google Maps review scraping.
 * Actor: Xb8osYTtOjlsgI6k9 (Google Maps Reviews Scraper)
 */

const axios = require('axios');

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const REVIEWS_ACTOR_ID = 'Xb8osYTtOjlsgI6k9';
const APIFY_BASE_URL = 'https://api.apify.com/v2';

// Polling config
const POLL_INTERVAL_MS = 5000;  // 5 seconds
const MAX_POLL_TIME_MS = 180000;  // 3 minutes

/**
 * Start an Apify actor run
 * @param {string} actorId - Actor ID or name
 * @param {object} input - Actor input configuration
 * @returns {Promise<string>} - Run ID
 */
async function startActorRun(actorId, input) {
  if (!APIFY_API_TOKEN) {
    throw new Error('APIFY_API_TOKEN not configured');
  }

  const response = await axios.post(
    `${APIFY_BASE_URL}/acts/${actorId}/runs`,
    input,
    {
      params: { token: APIFY_API_TOKEN },
      headers: { 'Content-Type': 'application/json' }
    }
  );

  return response.data.data.id;
}

/**
 * Poll actor run until completion
 * @param {string} runId - Run ID from startActorRun
 * @returns {Promise<object>} - Run status object with datasetId
 */
async function pollRunStatus(runId) {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    const response = await axios.get(
      `${APIFY_BASE_URL}/actor-runs/${runId}`,
      { params: { token: APIFY_API_TOKEN } }
    );

    const status = response.data.data.status;

    if (status === 'SUCCEEDED') {
      return response.data.data;
    }

    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ${status}: ${response.data.data.statusMessage || 'Unknown error'}`);
    }

    // Still running, wait and poll again
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Apify run timed out after ${MAX_POLL_TIME_MS / 1000}s`);
}

/**
 * Get dataset items from completed run
 * @param {string} datasetId - Dataset ID from run status
 * @returns {Promise<Array>} - Array of scraped items
 */
async function getDatasetItems(datasetId) {
  const response = await axios.get(
    `${APIFY_BASE_URL}/datasets/${datasetId}/items`,
    { params: { token: APIFY_API_TOKEN } }
  );

  return response.data;
}

/**
 * Fetch Google Maps reviews using Apify
 * @param {string[]} googleMapsUrls - Array of Google Maps URLs to scrape
 * @param {number} maxReviews - Max reviews per place (default 50)
 * @returns {Promise<Array>} - Array of review objects
 */
async function fetchReviewsApify(googleMapsUrls, maxReviews = 50) {
  // Prepare actor input
  const input = {
    startUrls: googleMapsUrls.map(url => ({ url })),
    maxReviews: maxReviews,
    language: 'en',
    personalData: true  // Include reviewer names
  };

  console.log(`    [Apify] Starting actor with ${googleMapsUrls.length} URL(s), maxReviews=${maxReviews}`);

  // Start the actor
  const runId = await startActorRun(REVIEWS_ACTOR_ID, input);
  console.log(`    [Apify] Run started: ${runId}`);

  // Poll until complete
  const runStatus = await pollRunStatus(runId);
  console.log(`    [Apify] Run completed, fetching results...`);

  // Get results
  const items = await getDatasetItems(runStatus.defaultDatasetId);
  console.log(`    [Apify] Got ${items.length} reviews`);

  return items;
}

/**
 * Transform Apify review format to our standard format
 * Apify format: { title, url, stars, name, reviewUrl, text }
 * Our format: { text, stars, reviewer_name, review_url, source }
 */
function transformReview(apifyReview) {
  return {
    text: apifyReview.text || '',
    stars: apifyReview.stars,
    reviewer_name: apifyReview.name || 'Anonymous',
    review_url: apifyReview.reviewUrl || '',
    source: 'google'
  };
}

/**
 * High-level function to scrape reviews for a business
 * @param {string} googleMapsUrl - Google Maps URL for the business
 * @param {number} maxReviews - Max reviews to fetch
 * @returns {Promise<object>} - Standardized result object
 */
async function scrapeGoogleReviewsApify(googleMapsUrl, maxReviews = 50) {
  try {
    const rawReviews = await fetchReviewsApify([googleMapsUrl], maxReviews);

    if (!rawReviews || rawReviews.length === 0) {
      return {
        found: false,
        error: 'No reviews returned from Apify'
      };
    }

    // Get business info from first review
    const firstReview = rawReviews[0];
    const businessName = firstReview.title || '';

    // Transform reviews to our format
    const reviews = rawReviews
      .filter(r => r.text)  // Only include reviews with text
      .map(transformReview);

    // Calculate average rating
    const totalStars = rawReviews.reduce((sum, r) => sum + (r.stars || 0), 0);
    const avgRating = rawReviews.length > 0 ? (totalStars / rawReviews.length).toFixed(1) : null;

    return {
      found: true,
      business_name: businessName,
      rating: parseFloat(avgRating),
      review_count: rawReviews.length,
      reviews: reviews,
      maps_url: googleMapsUrl,
      review_source: 'apify'
    };
  } catch (err) {
    console.error(`    [Apify] Error: ${err.message}`);
    return {
      found: false,
      error: err.message
    };
  }
}

module.exports = {
  startActorRun,
  pollRunStatus,
  getDatasetItems,
  fetchReviewsApify,
  scrapeGoogleReviewsApify,
  transformReview
};
```

**Step 2: Verify file created**

Run: `ls -la services/apify_service.js`
Expected: File exists with ~180 lines

**Step 3: Commit**

```bash
git add services/apify_service.js
git commit -m "feat: add Apify service for Google Maps reviews"
```

---

## Task 2: Add Environment Configuration

**Files:**
- Modify: `.env`

**Step 1: Add Apify token to .env**

Add these lines to `.env`:

```bash
# Apify API
APIFY_API_TOKEN=apify_api_2smU4uRCspeIm158RSbOsSIqYfS8VW3WOCYV
USE_APIFY=true
```

**Step 2: Verify env loads**

Run: `source venv/bin/activate && set -a && . ./.env && set +a && echo $APIFY_API_TOKEN | head -c 20`
Expected: `apify_api_2smU4uRCsp`

**Step 3: Commit**

```bash
git add .env
git commit -m "config: add Apify API token"
```

---

## Task 3: Write Integration Test for Apify Service

**Files:**
- Create: `tests/test_apify_service.js`

**Step 1: Create test file**

```javascript
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
```

**Step 2: Run unit test (no API call)**

Run: `node tests/test_apify_service.js`
Expected: `PASS: transformReview works correctly`

**Step 3: Run live integration test**

Run: `source venv/bin/activate && set -a && . ./.env && set +a && node tests/test_apify_service.js --live`
Expected: `PASS: Got X reviews, rating Y.Z` (takes 1-3 minutes)

**Step 4: Commit**

```bash
git add tests/test_apify_service.js
git commit -m "test: add Apify service integration tests"
```

---

## Task 4: Integrate Apify into Collection Service

**Files:**
- Modify: `services/collection_service.js`

**Step 1: Add import at top of file (after line ~13)**

Find this section near the top:
```javascript
const { analyzeReviews, quickDiscrepancyCheck } = require('./review_analyzer');
```

Add after it:
```javascript
const { scrapeGoogleReviewsApify } = require('./apify_service');
```

**Step 2: Add Apify wrapper function (after line ~135, near other scraper functions)**

Find the section with `scrapeGoogleReviewsOutscraper` and add after it:

```javascript
// ============ APIFY INTEGRATION ============
// Feature flag: Set USE_APIFY=true in .env to enable Apify fallback
const USE_APIFY = process.env.USE_APIFY === 'true';

/**
 * Scrape Google reviews via Apify API
 * Cost: ~$0.50-1.00 per 100 reviews (pay per compute unit)
 * @param {string} businessName - Business name for URL lookup
 * @param {string} location - Location string (e.g., "Dallas, TX")
 * @param {number} maxReviews - Max reviews to fetch
 * @param {string} googleMapsUrl - Optional direct URL (skips lookup)
 */
async function scrapeGoogleReviewsApifyWrapper(businessName, location, maxReviews = 50, googleMapsUrl = null) {
  // If we don't have a direct URL, we need to find one first
  if (!googleMapsUrl) {
    // Use Serper to find the Google Maps URL
    if (process.env.SERPER_API_KEY) {
      console.log(`    [Apify] No URL provided, using Serper to find Google Maps URL...`);
      const serperResult = await scrapeGoogleReviewsSerper(businessName, location, 1);
      if (serperResult.found && serperResult.maps_url) {
        googleMapsUrl = serperResult.maps_url;
        console.log(`    [Apify] Found URL: ${googleMapsUrl}`);
      } else {
        return { found: false, error: 'Could not find Google Maps URL via Serper' };
      }
    } else {
      return { found: false, error: 'No Google Maps URL and no SERPER_API_KEY to find one' };
    }
  }

  return scrapeGoogleReviewsApify(googleMapsUrl, maxReviews);
}
```

**Step 3: Add Apify as fallback in runInitialCollection**

Find the section around line 1380 (after Claude Vision fallback, before Traditional scraper):

```javascript
      // FALLBACK 2: Traditional Playwright scraper (rating only, no review text usually)
      if (!gmapsLocalResult) {
```

Insert BEFORE that block:

```javascript
      // FALLBACK: Apify (if enabled and previous methods failed)
      if (!gmapsLocalResult && USE_APIFY && APIFY_API_TOKEN) {
        log(`    [Apify] Trying Apify fallback...`);
        try {
          gmapsLocalResult = await scrapeGoogleReviewsApifyWrapper(contractor.name, TARGET_MARKET, 50);
          if (gmapsLocalResult.found && gmapsLocalResult.reviews?.length > 0) {
            success(`    [Apify] Got ${gmapsLocalResult.reviews.length} reviews`);
            gmapsLocalResult.review_source = 'apify';
          } else {
            warn(`    [Apify] No reviews found, falling back...`);
            gmapsLocalResult = null;
          }
        } catch (apifyErr) {
          warn(`    [Apify] Error: ${apifyErr.message}, falling back...`);
          gmapsLocalResult = null;
        }
      }

```

**Step 4: Add APIFY_API_TOKEN to environment check**

Near the top where USE_OUTSCRAPER is defined (around line 104), add:

```javascript
const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
```

**Step 5: Verify syntax is valid**

Run: `node -c services/collection_service.js`
Expected: `Syntax OK` (no output means success)

**Step 6: Commit**

```bash
git add services/collection_service.js
git commit -m "feat: integrate Apify as Google reviews fallback"
```

---

## Task 5: End-to-End Test with Real Contractor

**Files:** None (testing only)

**Step 1: Run audit on test contractor with Apify enabled**

Run:
```bash
source venv/bin/activate && set -a && . ./.env && set +a
# Temporarily disable other scrapers to force Apify
SERPER_API_KEY= USE_APIFY=true node bin/run_audit.js --name "Elite Roofing Solutions" --city "Dallas" --state "TX" --collect-only
```

Expected: Collection completes, shows `[Apify] Got X reviews`

**Step 2: Verify data stored correctly**

Run:
```bash
source venv/bin/activate && set -a && . ./.env && set +a
node -e "
const db = require('./services/db_pg');
(async () => {
  const rows = await db.exec(\`
    SELECT source_name, fetch_status, LENGTH(raw_text) as data_size
    FROM contractor_raw_data
    WHERE contractor_id = (SELECT id FROM contractors_contractor WHERE business_name LIKE '%Elite Roofing%' LIMIT 1)
    ORDER BY fetched_at DESC LIMIT 5
  \`);
  console.log(rows);
  process.exit(0);
})();
"
```

Expected: Row with `source_name: 'google_maps_local'`, `fetch_status: 'success'`

**Step 3: Run full audit to verify DeepSeek can use the data**

Run:
```bash
source venv/bin/activate && set -a && . ./.env && set +a
node bin/run_audit.js --name "Elite Roofing Solutions" --city "Dallas" --state "TX"
```

Expected: Audit completes with trust score, uses review data in analysis

---

## Task 6: Update Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add Apify to the Commands section**

Find the section with scraper commands and add:

```markdown
### Apify Google Reviews
- Fallback for Google Maps review scraping
- Uses actor `Xb8osYTtOjlsgI6k9`
- Enabled via `USE_APIFY=true` in .env
- Cost: ~$0.50-1.00 per 100 reviews
```

**Step 2: Add to File Map**

Add under services:
```markdown
| Apify service | `services/apify_service.js` |
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Apify integration to CLAUDE.md"
```

---

## Summary

| Task | Files | Purpose |
|------|-------|---------|
| 1 | `services/apify_service.js` | Core Apify API integration |
| 2 | `.env` | Add API token |
| 3 | `tests/test_apify_service.js` | Integration tests |
| 4 | `services/collection_service.js` | Wire into audit pipeline |
| 5 | (testing) | E2E verification |
| 6 | `CLAUDE.md` | Documentation |

**Total estimated time:** 30-45 minutes

**Rollback:** Set `USE_APIFY=false` in `.env` to disable without code changes.
