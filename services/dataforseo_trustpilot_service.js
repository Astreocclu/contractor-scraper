/**
 * DataForSEO Trustpilot Reviews Service
 *
 * Fetches Trustpilot reviews via DataForSEO Business Data API.
 * Cost: $0.00075 per 20 reviews (standard queue)
 * Max depth: 200 reviews
 *
 * API Flow: POST task → poll tasks_ready → GET results
 * Docs: https://docs.dataforseo.com/v3/business_data/trustpilot/reviews/
 */

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3';

const TP_ENDPOINT = 'business_data/trustpilot/reviews';
const POLL_INTERVAL_MS = 10000;    // 10s — Trustpilot tasks are lighter than Google
const MAX_POLL_TIME_MS = 600000;   // 10 minutes

function getAuthHeader() {
    if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) {
        throw new Error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set in .env');
    }
    return `Basic ${Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64')}`;
}

/**
 * Extract domain from a URL or return as-is if already a domain
 * "https://www.example.com/page" → "www.example.com"
 * "example.com" → "example.com"
 */
function extractDomain(input) {
    if (!input) return null;
    try {
        // If it looks like a URL, parse it
        if (input.includes('://')) {
            return new URL(input).hostname;
        }
        // Strip trailing slashes and paths
        return input.split('/')[0].trim().toLowerCase();
    } catch {
        return input.trim().toLowerCase();
    }
}

/**
 * Post a Trustpilot Reviews task
 * @param {string} domain - Domain as it appears on Trustpilot (e.g. "www.example.com")
 * @param {number} depth - Number of reviews to fetch (max 200, charged per 20)
 * @param {string} sortBy - Sort: "recency" or "relevance" (default: recency)
 */
async function postTrustpilotTask(domain, depth = 100, sortBy = 'recency') {
    const taskData = {
        domain,
        depth: Math.min(depth, 200),  // API max is 200
        sort_by: sortBy
    };

    const response = await fetch(`${DATAFORSEO_API_BASE}/${TP_ENDPOINT}/task_post`, {
        method: 'POST',
        headers: {
            'Authorization': getAuthHeader(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify([taskData])
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`DataForSEO Trustpilot task_post failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    if (data.status_code !== 20000) {
        throw new Error(`DataForSEO API error: ${data.status_message}`);
    }

    const task = data.tasks?.[0];
    if (!task || task.status_code !== 20100) {
        throw new Error(`DataForSEO task error: ${task?.status_message || 'Unknown error'}`);
    }

    return { id: task.id, cost: data.cost, status_message: task.status_message };
}

/**
 * Poll for task completion and retrieve results
 */
async function pollTrustpilotResults(taskId) {
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_POLL_TIME_MS) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

        const readyResponse = await fetch(`${DATAFORSEO_API_BASE}/${TP_ENDPOINT}/tasks_ready`, {
            headers: { 'Authorization': getAuthHeader() }
        });

        if (!readyResponse.ok) {
            console.log(`    [DataForSEO/TP] Poll check failed (${readyResponse.status}), retrying...`);
            continue;
        }

        const readyData = await readyResponse.json();
        const readyTasks = readyData.tasks?.[0]?.result || [];
        const isReady = readyTasks.some(t => t.id === taskId);

        if (!isReady) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`    [DataForSEO/TP] Task ${taskId} not ready yet (${elapsed}s elapsed)...`);
            continue;
        }

        // Task is ready — fetch results
        const resultResponse = await fetch(`${DATAFORSEO_API_BASE}/${TP_ENDPOINT}/task_get/${taskId}`, {
            headers: { 'Authorization': getAuthHeader() }
        });

        if (!resultResponse.ok) {
            const text = await resultResponse.text();
            throw new Error(`DataForSEO Trustpilot task_get failed (${resultResponse.status}): ${text}`);
        }

        const resultData = await resultResponse.json();
        if (resultData.status_code !== 20000) {
            throw new Error(`DataForSEO Trustpilot results error: ${resultData.status_message}`);
        }

        return resultData.tasks?.[0];
    }

    throw new Error(`DataForSEO Trustpilot task ${taskId} timed out after ${MAX_POLL_TIME_MS / 1000}s`);
}

/**
 * Transform DataForSEO Trustpilot review to our standard format
 */
function transformTrustpilotReview(review) {
    const ownerResponse = review.responses?.[0] || null;
    return {
        text: review.review_text || null,
        title: review.title || null,
        rating: review.rating?.value || null,
        reviewer_name: review.user_profile?.name || null,
        reviewer_url: review.user_profile?.url || null,
        reviewer_image: review.user_profile?.image_url || null,
        reviewer_location: review.user_profile?.location || null,
        reviewer_review_count: review.user_profile?.reviews_count || null,
        review_url: review.url || null,
        review_date: review.timestamp || null,
        verified: review.verified || false,
        language: review.language || null,
        review_images: review.review_images || [],
        owner_response: ownerResponse?.text || null,
        owner_response_title: ownerResponse?.title || null,
        owner_response_date: ownerResponse?.timestamp || null,
        source: 'trustpilot',
        provider: 'dataforseo',
        raw: review
    };
}

/**
 * High-level function: scrape Trustpilot reviews for a business
 * @param {string} websiteOrDomain - Business website URL or domain
 * @param {number} maxReviews - Max reviews to fetch (max 200)
 * @param {object} options
 * @param {string} [options.sort_by='recency'] - "recency" or "relevance"
 * @returns {Promise<object>} - Standardized result
 */
async function scrapeTrustpilotReviewsDataForSEO(websiteOrDomain, maxReviews = 100, options = {}) {
    try {
        if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) {
            return { found: false, error: 'DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD not configured' };
        }

        const domain = extractDomain(websiteOrDomain);
        if (!domain) {
            return { found: false, error: 'No domain provided' };
        }

        const depth = Math.min(maxReviews, 200);
        const sortBy = options.sort_by || 'recency';

        console.log(`    [DataForSEO/TP] Posting Trustpilot task: domain="${domain}", depth=${depth}`);
        const task = await postTrustpilotTask(domain, depth, sortBy);
        console.log(`    [DataForSEO/TP] Task posted: ${task.id} (cost: $${task.cost})`);

        console.log(`    [DataForSEO/TP] Polling for results...`);
        const result = await pollTrustpilotResults(task.id);

        if (!result?.result?.[0]) {
            return {
                found: false,
                error: 'No results returned from DataForSEO Trustpilot',
                task_id: task.id
            };
        }

        const taskResult = result.result[0];
        const rawReviews = (taskResult.items || []).filter(
            item => item.type === 'trustpilot_review_search' ||
                item.review_text !== undefined ||
                item.rating !== undefined
        );

        const reviews = rawReviews.map(transformTrustpilotReview);
        const ratedReviews = reviews.filter(r => Number.isFinite(r.rating));
        const totalStars = ratedReviews.reduce((sum, r) => sum + r.rating, 0);
        const avgRating = ratedReviews.length > 0
            ? parseFloat((totalStars / ratedReviews.length).toFixed(1))
            : taskResult.rating?.value || null;
        const nonemptyCount = reviews.filter(r => r.text && r.text.trim()).length;

        return {
            found: true,
            business_name: taskResult.title || null,
            domain: taskResult.domain || domain,
            location: taskResult.location || null,
            rating: avgRating,
            total_review_count: taskResult.reviews_count || null,
            review_count: reviews.length,
            fetched_review_count: reviews.length,
            nonempty_review_count: nonemptyCount,
            reviews,
            profile_url: taskResult.check_url || `https://www.trustpilot.com/review/${domain}`,
            review_source: 'dataforseo_trustpilot',
            requested_max_reviews: maxReviews,
            task_id: task.id,
            cost: result.cost
        };
    } catch (err) {
        console.error(`    [DataForSEO/TP] Error: ${err.message}`);
        return {
            found: false,
            error: err.message
        };
    }
}

module.exports = {
    postTrustpilotTask,
    pollTrustpilotResults,
    transformTrustpilotReview,
    scrapeTrustpilotReviewsDataForSEO,
    extractDomain
};
