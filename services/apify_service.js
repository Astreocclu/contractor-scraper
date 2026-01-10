/**
 * Apify Service
 *
 * Handles interactions with Apify API for Google Maps review scraping.
 * Actor: Xb8osYTtOjlsgI6k9 (Google Maps Reviews Scraper)
 */

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

  const url = `${APIFY_BASE_URL}/acts/${actorId}/runs?token=${encodeURIComponent(APIFY_API_TOKEN)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`Apify API error ${response.status}: ${errData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.data.id;
}

/**
 * Poll actor run until completion
 * @param {string} runId - Run ID from startActorRun
 * @returns {Promise<object>} - Run status object with datasetId
 */
async function pollRunStatus(runId) {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    const url = `${APIFY_BASE_URL}/actor-runs/${runId}?token=${encodeURIComponent(APIFY_API_TOKEN)}`;
    const response = await fetch(url);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`Apify API error ${response.status}: ${errData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const status = data.data.status;

    if (status === 'SUCCEEDED') {
      return data.data;
    }

    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ${status}: ${data.data.statusMessage || 'Unknown error'}`);
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
  const url = `${APIFY_BASE_URL}/datasets/${datasetId}/items?token=${encodeURIComponent(APIFY_API_TOKEN)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`Apify API error ${response.status}: ${errData.error?.message || response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch Google Maps reviews using Apify
 * @param {string[]} googleMapsUrls - Array of Google Maps URLs to scrape
 * @param {number} maxReviews - Max reviews per place (default 50)
 * @returns {Promise<Array>} - Array of review objects
 */
async function fetchReviewsApify(googleMapsUrls, maxReviews = 50) {
  // Validate input
  if (!googleMapsUrls || !Array.isArray(googleMapsUrls) || googleMapsUrls.length === 0) {
    throw new Error('googleMapsUrls must be a non-empty array');
  }

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

    // Calculate average rating (guard against NaN from parseFloat(null))
    const totalStars = rawReviews.reduce((sum, r) => sum + (r.stars || 0), 0);
    const avgRating = rawReviews.length > 0
      ? parseFloat((totalStars / rawReviews.length).toFixed(1))
      : null;

    return {
      found: true,
      business_name: businessName,
      rating: avgRating,
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
