# Outscraper Integration Plan

**Date:** 2026-01-06
**Status:** Ready for Implementation
**Confidence:** Claude 90%, DeepSeek 95%

---

## Executive Summary

Replace Serper API with Outscraper for review scraping to reduce costs from ~$200-400/month to ~$50-100/month.

**Scope:**
- Google Maps Reviews → Outscraper
- Yelp Reviews → Outscraper
- BBB → Outscraper
- Trustpilot → Outscraper
- Houzz → Keep Serper (not available on Outscraper)

**Approach:** Parallel rollout - run both providers, compare, then cut over.

---

## Phase 1: Setup & Configuration (Day 1)

### Task 1.1: Create Outscraper Account & Get API Key

**Steps:**
1. Sign up at https://outscraper.com
2. Navigate to API Keys section
3. Generate new API key
4. Add to `.env` file

**Verification:**
```bash
# Add to .env
echo "OUTSCRAPER_API_KEY=your_key_here" >> .env

# Verify it's set
source .env && echo $OUTSCRAPER_API_KEY | head -c 10
```

**Expected output:** First 10 chars of API key

---

### Task 1.2: Create Outscraper Service File

**File:** `services/outscraperService.js`

```javascript
const axios = require('axios');
const { cacheManager } = require('./cacheManager');
const costTrackingService = require('./costTrackingService');
const logger = require('./logger');

class OutscraperService {
    constructor() {
        this.apiKey = process.env.OUTSCRAPER_API_KEY;
        this.baseUrl = 'https://api.app.outscraper.com';
        this.headers = {
            'X-API-KEY': this.apiKey,
            'Content-Type': 'application/json'
        };

        // Pricing per 1000 (from Outscraper docs)
        this.pricing = {
            google_reviews: 3.00,    // $3/1000 after free tier
            yelp: 5.00,              // Estimated
            bbb: 5.00,               // Estimated
            trustpilot: 3.00         // Estimated
        };
    }

    /**
     * Get Google Maps reviews for a business
     * @param {string} query - Business name and location OR place_id
     * @param {number} reviewsLimit - Max reviews to fetch (default 20)
     * @returns {Promise<Object>} - Reviews data
     */
    async getGoogleReviews(query, reviewsLimit = 20) {
        const cacheKey = `outscraper:google:${query}:${reviewsLimit}`;

        const cached = await cacheManager.get(cacheKey);
        if (cached) {
            logger.debug('Cache hit for Outscraper Google reviews', { query });
            return cached;
        }

        try {
            const response = await axios.get(`${this.baseUrl}/maps/reviews-v3`, {
                headers: this.headers,
                params: {
                    query: query,
                    reviewsLimit: reviewsLimit,
                    language: 'en',
                    sort: 'newest'
                },
                timeout: 60000
            });

            const result = this.transformGoogleReviews(response.data);

            await this.trackCost('google_reviews', result.reviews?.length || 0);
            await cacheManager.set(cacheKey, result, 30 * 24 * 60 * 60);

            return result;
        } catch (error) {
            logger.error('Outscraper Google reviews error', { query, error: error.message });
            throw this.handleError(error);
        }
    }

    /**
     * Get Yelp reviews for a business
     * @param {string} businessUrl - Yelp business URL or search query
     * @param {number} limit - Max reviews
     * @returns {Promise<Object>} - Reviews data
     */
    async getYelpReviews(businessUrl, limit = 20) {
        const cacheKey = `outscraper:yelp:${businessUrl}:${limit}`;

        const cached = await cacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            const response = await axios.get(`${this.baseUrl}/yelp/reviews`, {
                headers: this.headers,
                params: {
                    query: businessUrl,
                    limit: limit
                },
                timeout: 60000
            });

            const result = this.transformYelpReviews(response.data);

            await this.trackCost('yelp', result.reviews?.length || 0);
            await cacheManager.set(cacheKey, result, 30 * 24 * 60 * 60);

            return result;
        } catch (error) {
            logger.error('Outscraper Yelp error', { businessUrl, error: error.message });
            throw this.handleError(error);
        }
    }

    /**
     * Get BBB data for a business
     * @param {string} businessUrl - BBB profile URL or search query
     * @returns {Promise<Object>} - BBB data
     */
    async getBBBData(businessUrl) {
        const cacheKey = `outscraper:bbb:${businessUrl}`;

        const cached = await cacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            const response = await axios.get(`${this.baseUrl}/bbb`, {
                headers: this.headers,
                params: {
                    query: businessUrl,
                    limit: 1
                },
                timeout: 60000
            });

            const result = this.transformBBBData(response.data);

            await this.trackCost('bbb', 1);
            await cacheManager.set(cacheKey, result, 30 * 24 * 60 * 60);

            return result;
        } catch (error) {
            logger.error('Outscraper BBB error', { businessUrl, error: error.message });
            throw this.handleError(error);
        }
    }

    /**
     * Get Trustpilot reviews for a business
     * @param {string} domain - Business domain (e.g., "example.com")
     * @param {number} limit - Max reviews
     * @returns {Promise<Object>} - Reviews data
     */
    async getTrustpilotReviews(domain, limit = 20) {
        const cacheKey = `outscraper:trustpilot:${domain}:${limit}`;

        const cached = await cacheManager.get(cacheKey);
        if (cached) return cached;

        try {
            const response = await axios.get(`${this.baseUrl}/trustpilot/reviews`, {
                headers: this.headers,
                params: {
                    query: `trustpilot.com/review/${domain}`,
                    limit: limit
                },
                timeout: 60000
            });

            const result = this.transformTrustpilotReviews(response.data);

            await this.trackCost('trustpilot', result.reviews?.length || 0);
            await cacheManager.set(cacheKey, result, 30 * 24 * 60 * 60);

            return result;
        } catch (error) {
            logger.error('Outscraper Trustpilot error', { domain, error: error.message });
            throw this.handleError(error);
        }
    }

    // ============ TRANSFORMERS ============

    transformGoogleReviews(data) {
        if (!data || !data[0]) return { reviews: [], rating: null, total: 0 };

        const place = data[0];
        return {
            source: 'google',
            name: place.name,
            rating: place.rating,
            total: place.reviews,
            reviews: (place.reviews_data || []).map(r => ({
                author: r.author_title,
                rating: r.review_rating,
                date: r.review_datetime_utc,
                text: r.review_text,
                response: r.owner_answer
            }))
        };
    }

    transformYelpReviews(data) {
        if (!data || !data[0]) return { reviews: [], rating: null, total: 0 };

        const biz = data[0];
        return {
            source: 'yelp',
            name: biz.name,
            rating: biz.rating,
            total: biz.review_count,
            reviews: (biz.reviews || []).map(r => ({
                author: r.user_name,
                rating: r.rating,
                date: r.date,
                text: r.comment
            }))
        };
    }

    transformBBBData(data) {
        if (!data || !data[0]) return { rating: null, accredited: false };

        const biz = data[0];
        return {
            source: 'bbb',
            name: biz.name,
            rating: biz.rating,
            accredited: biz.is_accredited,
            yearsInBusiness: biz.years_in_business,
            complaints: biz.complaints_count,
            reviews: biz.reviews_count
        };
    }

    transformTrustpilotReviews(data) {
        if (!data || !data[0]) return { reviews: [], rating: null, total: 0 };

        const biz = data[0];
        return {
            source: 'trustpilot',
            name: biz.name,
            rating: biz.rating,
            total: biz.reviews_count,
            reviews: (biz.reviews || []).map(r => ({
                author: r.author,
                rating: r.rating,
                date: r.date,
                text: r.text,
                title: r.title
            }))
        };
    }

    // ============ UTILITIES ============

    async trackCost(service, count) {
        const costPer1000 = this.pricing[service] || 5.00;
        const cost = (count / 1000) * costPer1000;

        await costTrackingService.trackApiCall({
            service: 'outscraper',
            endpoint: service,
            cost: cost,
            metadata: { count }
        });
    }

    handleError(error) {
        const status = error.response?.status;

        if (status === 401) return new Error('Invalid Outscraper API key');
        if (status === 402) return new Error('Outscraper balance insufficient');
        if (status === 429) return new Error('Outscraper rate limit exceeded');
        if (status >= 500) return new Error('Outscraper service unavailable');

        return new Error(`Outscraper error: ${error.message}`);
    }
}

module.exports = new OutscraperService();
```

**Verification:**
```bash
# Check file exists and has correct structure
node -e "const svc = require('./services/outscraperService'); console.log('Outscraper service loaded:', typeof svc.getGoogleReviews)"
```

**Expected output:** `Outscraper service loaded: function`

---

## Phase 2: Integration with Collection Service (Day 2)

### Task 2.1: Add Provider Toggle to Collection Service

**File:** `services/collection_service.js`

**Add after existing imports:**
```javascript
const outscraperService = require('./outscraperService');

// Feature flag - set via env or config
const USE_OUTSCRAPER = process.env.USE_OUTSCRAPER === 'true';
```

**Add new method for Google reviews:**
```javascript
async collectGoogleReviews(contractorName, city, state) {
    const query = `${contractorName}, ${city}, ${state}`;

    if (USE_OUTSCRAPER) {
        try {
            return await outscraperService.getGoogleReviews(query, 20);
        } catch (error) {
            logger.warn('Outscraper failed, falling back to Serper', { error: error.message });
            // Fall through to Serper
        }
    }

    // Existing Serper logic
    return await this.collectFromSerper('google', query);
}
```

**Verification:**
```bash
# Test with feature flag off (uses Serper)
USE_OUTSCRAPER=false node -e "
const svc = require('./services/collection_service');
console.log('Collection service loaded');
"

# Test with feature flag on (uses Outscraper)
USE_OUTSCRAPER=true node -e "
const svc = require('./services/collection_service');
console.log('Outscraper mode enabled');
"
```

---

### Task 2.2: Add Parallel Comparison Mode

**File:** `services/collection_service.js`

**Add comparison method:**
```javascript
async collectWithComparison(source, contractorName, city, state) {
    const query = `${contractorName}, ${city}, ${state}`;

    // Run both in parallel
    const [outscraperResult, serperResult] = await Promise.allSettled([
        outscraperService.getGoogleReviews(query, 20),
        this.collectFromSerper('google', query)
    ]);

    // Log comparison for analysis
    logger.info('Provider comparison', {
        contractor: contractorName,
        outscraper: {
            status: outscraperResult.status,
            reviewCount: outscraperResult.value?.reviews?.length || 0,
            rating: outscraperResult.value?.rating
        },
        serper: {
            status: serperResult.status,
            reviewCount: serperResult.value?.reviews?.length || 0,
            rating: serperResult.value?.rating
        }
    });

    // Return Outscraper if successful, else Serper
    if (outscraperResult.status === 'fulfilled') {
        return outscraperResult.value;
    }
    return serperResult.value;
}
```

---

## Phase 3: Houzz Fallback (Day 2)

### Task 3.1: Keep Serper for Houzz Only

**File:** `services/collection_service.js`

Houzz will continue using existing Serper logic. No changes needed - just document that Houzz is excluded from migration.

**Add comment:**
```javascript
// HOUZZ: Outscraper does not support Houzz scraping.
// Continue using Serper for Houzz reviews only.
// This is the only Serper usage post-migration.
```

---

## Phase 4: Testing (Day 3-4)

### Task 4.1: Manual Test Script

**File:** `bin/test_outscraper.js`

```javascript
#!/usr/bin/env node
require('dotenv').config();

const outscraperService = require('../services/outscraperService');

async function testOutscraper() {
    const testCases = [
        {
            name: 'Google Maps Reviews',
            fn: () => outscraperService.getGoogleReviews('Infinity Pool Contractors, Dallas, TX', 5)
        },
        {
            name: 'Yelp Reviews',
            fn: () => outscraperService.getYelpReviews('infinity-pool-contractors-dallas', 5)
        },
        {
            name: 'BBB Data',
            fn: () => outscraperService.getBBBData('infinity-pool-contractors-dallas')
        },
        {
            name: 'Trustpilot Reviews',
            fn: () => outscraperService.getTrustpilotReviews('infinitypools.com', 5)
        }
    ];

    console.log('Testing Outscraper Integration\n');
    console.log('='.repeat(50));

    for (const test of testCases) {
        console.log(`\n${test.name}:`);
        try {
            const result = await test.fn();
            console.log(`  Status: SUCCESS`);
            console.log(`  Rating: ${result.rating}`);
            console.log(`  Reviews: ${result.reviews?.length || 0}`);
        } catch (error) {
            console.log(`  Status: FAILED`);
            console.log(`  Error: ${error.message}`);
        }
    }
}

testOutscraper().catch(console.error);
```

**Verification:**
```bash
chmod +x bin/test_outscraper.js
source venv/bin/activate && set -a && . ./.env && set +a
node bin/test_outscraper.js
```

**Expected output:**
```
Testing Outscraper Integration

==================================================

Google Maps Reviews:
  Status: SUCCESS
  Rating: 4.8
  Reviews: 5

Yelp Reviews:
  Status: SUCCESS
  Rating: 4.5
  Reviews: 5
...
```

---

### Task 4.2: Comparison Test Script

**File:** `bin/compare_providers.js`

```javascript
#!/usr/bin/env node
require('dotenv').config();

const outscraperService = require('../services/outscraperService');
const serperService = require('../services/serperService');

async function compareProviders() {
    const contractors = [
        { name: 'Infinity Pool Contractors', city: 'Dallas', state: 'TX' },
        { name: 'Blue Water Pools', city: 'Fort Worth', state: 'TX' },
        { name: 'Epic Pavers', city: 'Plano', state: 'TX' }
    ];

    console.log('Provider Comparison Test\n');
    console.log('Contractor | Outscraper | Serper | Match?');
    console.log('-'.repeat(60));

    for (const c of contractors) {
        const query = `${c.name}, ${c.city}, ${c.state}`;

        const [outscraper, serper] = await Promise.allSettled([
            outscraperService.getGoogleReviews(query, 10),
            serperService.getGoogleReviews(query, 10)
        ]);

        const osRating = outscraper.value?.rating || 'ERR';
        const spRating = serper.value?.rating || 'ERR';
        const match = osRating === spRating ? 'YES' : 'NO';

        console.log(`${c.name.slice(0, 25).padEnd(25)} | ${osRating} | ${spRating} | ${match}`);
    }
}

compareProviders().catch(console.error);
```

---

## Phase 5: Rollout (Day 5-7)

### Task 5.1: Enable Parallel Mode

**Add to `.env`:**
```bash
USE_OUTSCRAPER=true
OUTSCRAPER_PARALLEL_MODE=true  # Run both, log comparison
```

### Task 5.2: Monitor for 3-5 Days

**Check logs for comparison data:**
```bash
# Find comparison logs
grep "Provider comparison" logs/*.log | tail -20
```

### Task 5.3: Full Cutover

**Update `.env`:**
```bash
USE_OUTSCRAPER=true
OUTSCRAPER_PARALLEL_MODE=false  # Outscraper only (except Houzz)
```

---

## Cost Tracking

### Expected Monthly Costs

| Provider | Source | Volume | Cost |
|----------|--------|--------|------|
| Outscraper | Google | 1000 contractors × 20 reviews | $60 |
| Outscraper | Yelp | 500 lookups | $2.50 |
| Outscraper | BBB | 500 lookups | $2.50 |
| Outscraper | Trustpilot | 500 lookups | $1.50 |
| Serper | Houzz only | 500 lookups | $25 |
| **Total** | | | **~$90/month** |

*Note: First 500 Google reviews/month are FREE*

---

## Rollback Plan

If Outscraper fails or data quality is poor:

1. Set `USE_OUTSCRAPER=false` in `.env`
2. Restart services
3. System automatically uses Serper

No code changes needed - feature flag handles rollback.

---

## Success Criteria

- [ ] All 4 Outscraper sources return valid data
- [ ] Data quality matches or exceeds Serper (verified via comparison)
- [ ] Cost reduced to target range ($50-100/month)
- [ ] No degradation in audit quality
- [ ] Cache hit rate > 30%

---

## Files Summary

| File | Action |
|------|--------|
| `services/outscraperService.js` | CREATE |
| `services/collection_service.js` | MODIFY |
| `bin/test_outscraper.js` | CREATE |
| `bin/compare_providers.js` | CREATE |
| `.env` | MODIFY (add keys) |
