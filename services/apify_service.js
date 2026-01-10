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
