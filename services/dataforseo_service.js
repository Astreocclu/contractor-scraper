/**
 * DataForSEO Service
 *
 * Handles Google Reviews scraping via DataForSEO API.
 * Cost: ~$0.075 per 1,000 reviews (standard queue)
 * 
 * API Flow: POST task → poll tasks_ready → GET results
 * Docs: https://docs.dataforseo.com/v3/business_data/google/reviews/
 */

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3';
const HTTP_TIMEOUT_MS = Math.max(5000, parseInt(process.env.DATAFORSEO_HTTP_TIMEOUT_MS || '45000', 10));

// Polling config
const POLL_INTERVAL_MS = 15000;   // 15 seconds (standard queue is slow)
const MAX_POLL_TIME_MS = 1200000; // 20 minutes (standard queue takes up to 45 min)

async function fetchWithTimeout(url, options = {}, timeoutMs = HTTP_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw new Error(`DataForSEO request timeout after ${timeoutMs}ms`);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

function getAuthHeader() {
    if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) {
        throw new Error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set in .env');
    }
    const encoded = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
    return `Basic ${encoded}`;
}

/**
 * Post a Google Reviews task
 * @param {object} params - Task parameters
 * @param {string} params.keyword - Business name to search for
 * @param {string} [params.place_id] - Google Place ID (most accurate)
 * @param {string} [params.cid] - Google CID
 * @param {number} [params.depth=100] - Number of reviews to fetch (charged per 10)
 * @param {string} [params.sort_by='newest'] - Sort: newest, highest_rating, lowest_rating, relevant
 * @param {string} [params.location_name] - Location (e.g., "Dallas,Texas,United States")
 * @param {string} [params.language_code='en'] - Language code
 * @returns {Promise<object>} - Task info with id
 */
async function postReviewTask(params) {
    const {
        keyword,
        place_id,
        cid,
        depth = 100,
        sort_by = 'newest',
        location_name = 'United States',
        language_code = 'en'
    } = params;

    const taskData = {
        language_code,
        location_name,
        depth,
        sort_by
    };

    // Priority: place_id > cid > keyword
    if (place_id) {
        taskData.place_id = place_id;
    } else if (cid) {
        taskData.cid = cid;
    } else if (keyword) {
        taskData.keyword = keyword;
    } else {
        throw new Error('Must provide keyword, place_id, or cid');
    }

    const response = await fetchWithTimeout(`${DATAFORSEO_API_BASE}/business_data/google/reviews/task_post`, {
        method: 'POST',
        headers: {
            'Authorization': getAuthHeader(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify([taskData])
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`DataForSEO task_post failed (${response.status}): ${text}`);
    }

    const data = await response.json();

    if (data.status_code !== 20000) {
        throw new Error(`DataForSEO API error: ${data.status_message}`);
    }

    const task = data.tasks?.[0];
    if (!task || task.status_code !== 20100) {
        throw new Error(`DataForSEO task error: ${task?.status_message || 'Unknown error'}`);
    }

    return {
        id: task.id,
        cost: data.cost,
        status_message: task.status_message
    };
}

/**
 * Poll for task completion and retrieve results
 * @param {string} taskId - Task ID from postReviewTask
 * @returns {Promise<object>} - Full result object with reviews
 */
async function pollAndGetResults(taskId) {
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_POLL_TIME_MS) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

        // Check if task is ready
        const readyResponse = await fetchWithTimeout(`${DATAFORSEO_API_BASE}/business_data/google/reviews/tasks_ready`, {
            headers: { 'Authorization': getAuthHeader() }
        });

        if (!readyResponse.ok) {
            console.log(`    [DataForSEO] Poll check failed (${readyResponse.status}), retrying...`);
            continue;
        }

        const readyData = await readyResponse.json();
        const readyTasks = readyData.tasks?.[0]?.result || [];
        const isReady = readyTasks.some(t => t.id === taskId);

        if (!isReady) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`    [DataForSEO] Task ${taskId} not ready yet (${elapsed}s elapsed)...`);
            continue;
        }

        // Task is ready — fetch results
        const resultResponse = await fetchWithTimeout(`${DATAFORSEO_API_BASE}/business_data/google/reviews/task_get/${taskId}`, {
            headers: { 'Authorization': getAuthHeader() }
        });

        if (!resultResponse.ok) {
            const text = await resultResponse.text();
            throw new Error(`DataForSEO task_get failed (${resultResponse.status}): ${text}`);
        }

        const resultData = await resultResponse.json();

        if (resultData.status_code !== 20000) {
            throw new Error(`DataForSEO results error: ${resultData.status_message}`);
        }

        return resultData.tasks?.[0];
    }

    throw new Error(`DataForSEO task ${taskId} timed out after ${MAX_POLL_TIME_MS / 1000}s`);
}

/**
 * Transform DataForSEO review to our standard format
 */
function transformReview(dfsReview) {
    return {
        text: dfsReview.review_text || null,
        rating: dfsReview.rating?.value || null,
        reviewer_name: dfsReview.profile_name || null,
        review_url: dfsReview.review_url || null,
        review_date: dfsReview.time_ago || dfsReview.original_review_date || null,
        timestamp: dfsReview.timestamp || null,
        owner_response: dfsReview.owner_answer || null,
        owner_response_date: dfsReview.owner_time_ago || null,
        review_images: dfsReview.review_images || [],
        review_likes: dfsReview.review_likes || 0,
        source: 'google',
        provider: 'dataforseo',
        raw: dfsReview
    };
}

/**
 * High-level function: scrape Google reviews for a business
 * @param {string} businessName - Business name
 * @param {string} location - Location (e.g., "Fort Worth, TX")
 * @param {number} maxReviews - Max reviews to fetch
 * @param {object} [options] - Additional options
 * @param {string} [options.place_id] - Google Place ID for precise lookup
 * @param {string} [options.cid] - Google CID
 * @param {string} [options.sort_by='newest'] - Sort order
 * @returns {Promise<object>} - Standardized result object matching apify_service format
 */
async function scrapeGoogleReviewsDataForSEO(businessName, location = 'Fort Worth, TX', maxReviews = 200, options = {}) {
    try {
        if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) {
            return { found: false, error: 'DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD not configured' };
        }

        // Build location_name from location string
        // "Fort Worth, TX" → "Fort Worth,Texas,United States"
        const locationParts = location.split(',').map(s => s.trim());
        const stateMap = {
            'TX': 'Texas', 'CA': 'California', 'NY': 'New York', 'FL': 'Florida',
            'IL': 'Illinois', 'PA': 'Pennsylvania', 'OH': 'Ohio', 'GA': 'Georgia',
            'NC': 'North Carolina', 'MI': 'Michigan', 'NJ': 'New Jersey', 'VA': 'Virginia',
            'WA': 'Washington', 'AZ': 'Arizona', 'MA': 'Massachusetts', 'TN': 'Tennessee',
            'IN': 'Indiana', 'MO': 'Missouri', 'MD': 'Maryland', 'WI': 'Wisconsin',
            'CO': 'Colorado', 'MN': 'Minnesota', 'SC': 'South Carolina', 'AL': 'Alabama',
            'LA': 'Louisiana', 'KY': 'Kentucky', 'OR': 'Oregon', 'OK': 'Oklahoma',
            'CT': 'Connecticut', 'UT': 'Utah', 'NV': 'Nevada', 'AR': 'Arkansas',
            'MS': 'Mississippi', 'KS': 'Kansas', 'NM': 'New Mexico', 'NE': 'Nebraska'
        };

        let locationName = 'United States';
        if (locationParts.length >= 2) {
            const city = locationParts[0];
            const stateAbbr = locationParts[1].toUpperCase();
            const stateFull = stateMap[stateAbbr] || locationParts[1];
            locationName = `${city},${stateFull},United States`;
        }

        const taskParams = {
            keyword: businessName,
            depth: maxReviews,
            sort_by: options.sort_by || 'newest',
            location_name: locationName,
            language_code: 'en'
        };

        if (options.place_id) taskParams.place_id = options.place_id;
        if (options.cid) taskParams.cid = options.cid;

        console.log(`    [DataForSEO] Posting review task: "${businessName}" in ${locationName}, depth=${maxReviews}`);
        const task = await postReviewTask(taskParams);
        console.log(`    [DataForSEO] Task posted: ${task.id} (cost so far: $${task.cost})`);

        console.log(`    [DataForSEO] Polling for results...`);
        const result = await pollAndGetResults(task.id);

        if (!result?.result?.[0]) {
            return {
                found: false,
                error: 'No results returned from DataForSEO',
                task_id: task.id
            };
        }

        const taskResult = result.result[0];
        const rawReviews = taskResult.items || [];

        // Filter to actual review items (type === 'google_reviews_review_element')
        const reviewItems = rawReviews.filter(item =>
            item.type === 'google_reviews_review_element' ||
            item.review_text !== undefined ||
            item.rating !== undefined
        );

        const reviews = reviewItems.map(transformReview);
        const ratedReviews = reviews.filter(r => Number.isFinite(r.rating));
        const totalStars = ratedReviews.reduce((sum, r) => sum + r.rating, 0);
        const avgRating = ratedReviews.length > 0
            ? parseFloat((totalStars / ratedReviews.length).toFixed(1))
            : taskResult.rating?.value || null;
        const nonemptyReviewCount = reviews.filter(r => r.text && r.text.trim()).length;

        return {
            found: true,
            business_name: taskResult.title || businessName,
            rating: avgRating,
            total_review_count: taskResult.reviews_count || null,
            review_count: reviewItems.length,
            fetched_review_count: reviewItems.length,
            nonempty_review_count: nonemptyReviewCount,
            reviews: reviews,
            maps_url: taskResult.url || null,
            review_source: 'dataforseo',
            requested_max_reviews: maxReviews,
            task_id: task.id,
            cost: result.cost,
            check_url: taskResult.check_url || null
        };
    } catch (err) {
        console.error(`    [DataForSEO] Error: ${err.message}`);
        return {
            found: false,
            error: err.message
        };
    }
}

module.exports = {
    postReviewTask,
    pollAndGetResults,
    transformReview,
    scrapeGoogleReviewsDataForSEO
};
