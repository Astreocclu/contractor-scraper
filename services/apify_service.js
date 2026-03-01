/**
 * Apify Service
 *
 * Handles interactions with Apify API for Google Maps review scraping.
 * Actor: Xb8osYTtOjlsgI6k9 (Google Maps Reviews Scraper)
 */

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const REVIEWS_ACTOR_ID = 'Xb8osYTtOjlsgI6k9';
const PLACES_ACTOR_ID = process.env.APIFY_PLACES_ACTOR_ID || 'nwua9Gu5YrADL7ZDj';
const APIFY_BASE_URL = 'https://api.apify.com/v2';
const APIFY_DEFAULT_MAX_REVIEWS = Math.max(1, parseInt(process.env.APIFY_MAX_REVIEWS || '200', 10));
const APIFY_REVIEW_SORT = process.env.APIFY_REVIEW_SORT || 'newest';

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
 * @param {number} maxReviews - Max reviews per place (default 200)
 * @returns {Promise<Array>} - Array of review objects
 */
async function fetchReviewsApify(googleMapsUrls, maxReviews = APIFY_DEFAULT_MAX_REVIEWS) {
  // Validate input
  if (!googleMapsUrls || !Array.isArray(googleMapsUrls) || googleMapsUrls.length === 0) {
    throw new Error('googleMapsUrls must be a non-empty array');
  }

  // Prepare actor input
  const input = {
    startUrls: googleMapsUrls.map(url => ({ url })),
    maxReviews: maxReviews,
    reviewsSort: APIFY_REVIEW_SORT,
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
function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isApifyErrorRow(item) {
  return !!item && typeof item === 'object' && hasNonEmptyString(item.error);
}

function isLikelyReviewRow(item) {
  if (!item || typeof item !== 'object') return false;
  if (isApifyErrorRow(item)) return false;

  const hasText = hasNonEmptyString(item.text);
  const hasRating = parseNumber(item.rating ?? item.stars) !== null;
  const hasReviewUrl = hasNonEmptyString(item.reviewUrl);
  const hasReviewerId = hasNonEmptyString(item.reviewerId);
  const hasDate = hasNonEmptyString(item.date) || hasNonEmptyString(item.publishedAtDate) || hasNonEmptyString(item.publishedAt);

  return hasText || hasRating || hasReviewUrl || hasReviewerId || hasDate;
}

function transformReview(apifyReview) {
  const rating = parseNumber(apifyReview.rating ?? apifyReview.stars);
  return {
    text: apifyReview.text ? String(apifyReview.text) : '',
    rating,
    stars: rating,
    reviewer_name: apifyReview.name || apifyReview.author || 'Anonymous',
    reviewer_id: apifyReview.reviewerId || null,
    date: apifyReview.date || apifyReview.publishedAtDate || apifyReview.publishedAt || null,
    likes: parseNumber(apifyReview.likesCount ?? apifyReview.likes),
    review_url: apifyReview.reviewUrl || '',
    source: 'google'
  };
}

function buildPlacesActorInput(businessName, location, maxReviews) {
  const searchString = [businessName, location].filter(Boolean).join(' ').trim();
  const query = searchString || businessName || location || '';

  return {
    searchStringsArray: [query],
    locationQuery: location || '',
    maxCrawledPlacesPerSearch: 1,
    maxReviews: Math.max(1, Math.min(maxReviews, APIFY_DEFAULT_MAX_REVIEWS)),
    reviewsSort: APIFY_REVIEW_SORT,
    reviewsOrigin: 'all',
    language: 'en',
    includeWebResults: false,
    scrapePlaceDetailPage: true,
    scrapeReviewsPersonalData: true,
    scrapeContacts: false,
    scrapeDirectories: false,
    scrapeImageAuthors: false,
    scrapeTableReservationProvider: false,
    maxImages: 0,
    maxQuestions: 0,
    maximumLeadsEnrichmentRecords: 0,
    skipClosedPlaces: false,
    searchMatching: 'all',
    website: 'allPlaces',
    allPlacesNoSearchAction: ''
  };
}

function transformPlaceActorReview(review) {
  const rating = parseNumber(review.rating ?? review.stars);
  return {
    text: hasNonEmptyString(review.text) ? String(review.text).trim() : '',
    rating,
    stars: rating,
    reviewer_name: review.name || review.author || 'Anonymous',
    reviewer_id: review.reviewerId || null,
    date: review.publishedAtDate || review.publishedAt || review.date || review.publishAt || null,
    likes: parseNumber(review.likesCount ?? review.likes),
    review_url: review.reviewUrl || '',
    source: 'google'
  };
}

function normalizePlacesActorResult(place, maxReviews) {
  if (!place || typeof place !== 'object') {
    return { found: false, error: 'Places actor returned empty result' };
  }

  const rawReviews = Array.isArray(place.reviews) ? place.reviews : [];
  const reviews = rawReviews
    .filter((review) => review && typeof review === 'object')
    .slice(0, maxReviews)
    .map((review) => ({
      ...transformPlaceActorReview(review),
      raw: review
    }));

  const nonemptyReviewCount = reviews.filter((review) => hasNonEmptyString(review.text)).length;
  const reviewCount = Math.max(0, parseNumber(place.reviewsCount) ?? reviews.length);
  const ratedReviews = reviews.filter((review) => Number.isFinite(review.rating));
  const avgRating = ratedReviews.length > 0
    ? parseFloat((ratedReviews.reduce((sum, review) => sum + review.rating, 0) / ratedReviews.length).toFixed(1))
    : (parseNumber(place.totalScore) ?? null);

  if (reviews.length === 0) {
    return {
      found: false,
      error: 'Places actor returned no review rows',
      maps_url: place.url || null
    };
  }

  return {
    found: true,
    business_name: place.title || '',
    rating: avgRating,
    review_count: reviewCount,
    fetched_review_count: reviews.length,
    nonempty_review_count: nonemptyReviewCount,
    reviews,
    maps_url: place.url || null,
    review_source: 'apify_places',
    requested_max_reviews: maxReviews,
    place_id: place.placeId || null,
    cid: place.cid || null
  };
}

async function scrapeGoogleReviewsViaPlacesActor(businessName, location, maxReviews = APIFY_DEFAULT_MAX_REVIEWS) {
  try {
    const input = buildPlacesActorInput(businessName, location, maxReviews);
    console.log(`    [Apify] Places lookup fallback: "${input.searchStringsArray[0]}" @ "${location || 'n/a'}"`);

    const runId = await startActorRun(PLACES_ACTOR_ID, input);
    console.log(`    [Apify] Places run started: ${runId}`);

    const runStatus = await pollRunStatus(runId);
    const items = await getDatasetItems(runStatus.defaultDatasetId);
    console.log(`    [Apify] Places fallback returned ${Array.isArray(items) ? items.length : 0} place row(s)`);

    if (!Array.isArray(items) || items.length === 0) {
      return {
        found: false,
        error: 'Places actor returned no place results'
      };
    }

    return normalizePlacesActorResult(items[0], maxReviews);
  } catch (err) {
    console.error(`    [Apify] Places fallback error: ${err.message}`);
    return {
      found: false,
      error: err.message
    };
  }
}

/**
 * High-level function to scrape reviews for a business
 * @param {string} googleMapsUrl - Google Maps URL for the business
 * @param {number} maxReviews - Max reviews to fetch (default 200)
 * @returns {Promise<object>} - Standardized result object
 */
async function scrapeGoogleReviewsApify(googleMapsUrl, maxReviews = APIFY_DEFAULT_MAX_REVIEWS) {
  try {
    const rawItems = await fetchReviewsApify([googleMapsUrl], maxReviews);

    if (!rawItems || rawItems.length === 0) {
      return {
        found: false,
        error: 'No reviews returned from Apify'
      };
    }

    const errorRows = rawItems.filter(isApifyErrorRow);
    const rawReviews = rawItems.filter(isLikelyReviewRow);

    if (rawReviews.length === 0) {
      const firstError = errorRows[0];
      const errorMessage = firstError
        ? `${firstError.error}${firstError.errorDescription ? `: ${firstError.errorDescription}` : ''}`
        : 'No valid review rows in actor output';

      return {
        found: false,
        error: errorMessage,
        maps_url: googleMapsUrl,
        raw_item_count: rawItems.length,
        error_row_count: errorRows.length
      };
    }

    // Get business info from first review
    const firstReview = rawReviews[0];
    const businessName = firstReview.title || '';

    // Preserve full review payload in structured_data for forensic analysis.
    const reviews = rawReviews.map((review) => ({
      ...transformReview(review),
      raw: review
    }));

    // Calculate average rating (guard against NaN from parseFloat(null))
    const ratedReviews = reviews.filter(r => Number.isFinite(r.rating));
    const totalStars = ratedReviews.reduce((sum, r) => sum + r.rating, 0);
    const avgRating = ratedReviews.length > 0
      ? parseFloat((totalStars / ratedReviews.length).toFixed(1))
      : null;
    const nonemptyReviewCount = reviews.filter(r => r.text && r.text.trim()).length;

    return {
      found: true,
      business_name: businessName,
      rating: avgRating,
      review_count: rawReviews.length,
      fetched_review_count: rawReviews.length,
      nonempty_review_count: nonemptyReviewCount,
      reviews: reviews,
      maps_url: googleMapsUrl,
      review_source: 'apify',
      requested_max_reviews: maxReviews,
      raw_item_count: rawItems.length,
      error_row_count: errorRows.length
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
  scrapeGoogleReviewsViaPlacesActor,
  transformReview
};
