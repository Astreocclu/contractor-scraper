/**
 * Search Logger & Metrics
 *
 * Tracks search results, manages review queue, and aggregates daily metrics.
 *
 * Features:
 * - Logs search tier, confidence, location to contractor_raw_data
 * - Queues low-confidence matches for manual review
 * - Updates daily metrics for search performance analysis
 */

const db = require('./db_pg');

class SearchLogger {
  /**
   * Log a completed search result to contractor_raw_data
   * @param {number} contractorId - Contractor ID
   * @param {Object} searchResult - Result from TieredSearch
   * @param {number} searchResult.tier - Which tier found the match (1-5)
   * @param {number} searchResult.confidence - Match confidence (0-1)
   * @param {Object} searchResult.result - The scraped data
   * @param {Array} searchResult.attempts - All search attempts made
   */
  async logResult(contractorId, searchResult) {
    try {
      // Update the contractor_raw_data record with search metadata
      await db.exec(`
        UPDATE contractor_raw_data
        SET search_tier = $2,
            search_confidence = $3,
            location_searched = $4,
            search_attempts = $5
        WHERE contractor_id = $1 AND source_name = 'google_maps_local'
      `, [
        contractorId,
        searchResult.tier,
        searchResult.confidence,
        searchResult.result?.location_searched || searchResult.result?.address || null,
        JSON.stringify(searchResult.attempts)
      ]);

      // Update daily metrics
      const today = new Date().toISOString().split('T')[0];
      const success = searchResult.tier !== null;
      if (searchResult.tier) {
        await this.updateMetrics(today, searchResult.tier, success);
      }

      console.log(`[SearchLogger] Logged result for contractor ${contractorId}: tier=${searchResult.tier}, confidence=${searchResult.confidence?.toFixed(2)}`);
    } catch (err) {
      console.error(`[SearchLogger] Failed to log result for contractor ${contractorId}: ${err.message}`);
      // Don't throw - logging failures shouldn't break the audit
    }
  }

  /**
   * Queue a low-confidence match for manual review
   * @param {Object} contractor - Contractor record from DB
   * @param {Object} scraped - Scraped business data
   * @param {Object} validation - Validation result from BusinessValidator
   */
  async queueForReview(contractor, scraped, validation) {
    try {
      // Check if already queued to avoid duplicates
      const existing = await db.exec(`
        SELECT id FROM review_queue
        WHERE contractor_id = $1 AND status = 'pending'
        LIMIT 1
      `, [contractor.id]);

      if (existing && existing.length > 0) {
        console.log(`[SearchLogger] Contractor ${contractor.id} already in review queue, skipping`);
        return existing[0].id;
      }

      const result = await db.exec(`
        INSERT INTO review_queue
        (contractor_id, scraped_data, confidence_score, validation_details)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [
        contractor.id,
        JSON.stringify(scraped),
        validation.confidence,
        JSON.stringify({
          scores: validation.scores,
          reasons: validation.reasons,
          needsReview: validation.needsReview,
          lowConfidence: validation.lowConfidence
        })
      ]);

      console.log(`[SearchLogger] Queued contractor ${contractor.id} for review (confidence: ${(validation.confidence * 100).toFixed(0)}%)`);
      return result[0]?.id;
    } catch (err) {
      console.error(`[SearchLogger] Failed to queue contractor ${contractor.id} for review: ${err.message}`);
      return null;
    }
  }

  /**
   * Update daily search metrics
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {number} tier - Which tier (1-5)
   * @param {boolean} success - Whether search found a match
   */
  async updateMetrics(date, tier, success) {
    try {
      const column = success ? `tier${tier}_success` : `tier${tier}_fail`;

      // Upsert pattern: insert or update existing row
      await db.exec(`
        INSERT INTO search_metrics_daily (date, ${column}, total_searches)
        VALUES ($1, 1, 1)
        ON CONFLICT (date) DO UPDATE
        SET ${column} = search_metrics_daily.${column} + 1,
            total_searches = search_metrics_daily.total_searches + 1
      `, [date]);
    } catch (err) {
      console.error(`[SearchLogger] Failed to update metrics for ${date}: ${err.message}`);
    }
  }

  /**
   * Update average confidence for a date
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {number} confidence - Confidence score (0-1)
   */
  async updateAverageConfidence(date, confidence) {
    try {
      // Use running average: new_avg = (old_avg * (n-1) + new_value) / n
      await db.exec(`
        UPDATE search_metrics_daily
        SET avg_confidence = CASE
          WHEN avg_confidence IS NULL THEN $2
          ELSE (avg_confidence * (total_searches - 1) + $2) / total_searches
        END
        WHERE date = $1
      `, [date, confidence]);
    } catch (err) {
      console.error(`[SearchLogger] Failed to update avg confidence for ${date}: ${err.message}`);
    }
  }

  /**
   * Get search metrics for a date range
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Array} Daily metrics
   */
  async getMetrics(startDate, endDate) {
    const rows = await db.exec(`
      SELECT date,
             tier1_success, tier1_fail,
             tier2_success, tier2_fail,
             tier3_success, tier3_fail,
             tier4_success, tier4_fail,
             tier5_success, tier5_fail,
             avg_confidence,
             total_searches
      FROM search_metrics_daily
      WHERE date BETWEEN $1 AND $2
      ORDER BY date DESC
    `, [startDate, endDate]);

    return rows || [];
  }

  /**
   * Get summary metrics
   * @returns {Object} Aggregated metrics
   */
  async getSummary() {
    const rows = await db.exec(`
      SELECT
        SUM(tier1_success) as tier1_success,
        SUM(tier1_fail) as tier1_fail,
        SUM(tier2_success) as tier2_success,
        SUM(tier2_fail) as tier2_fail,
        SUM(tier3_success) as tier3_success,
        SUM(tier3_fail) as tier3_fail,
        SUM(tier4_success) as tier4_success,
        SUM(tier4_fail) as tier4_fail,
        SUM(tier5_success) as tier5_success,
        SUM(tier5_fail) as tier5_fail,
        AVG(avg_confidence) as avg_confidence,
        SUM(total_searches) as total_searches,
        COUNT(*) as days_tracked
      FROM search_metrics_daily
    `);

    const summary = rows[0] || {};

    // Calculate success rates by tier
    const tierStats = {};
    for (let i = 1; i <= 5; i++) {
      const success = parseInt(summary[`tier${i}_success`] || 0);
      const fail = parseInt(summary[`tier${i}_fail`] || 0);
      const total = success + fail;
      tierStats[`tier${i}`] = {
        success,
        fail,
        total,
        rate: total > 0 ? (success / total * 100).toFixed(1) + '%' : 'N/A'
      };
    }

    return {
      total_searches: parseInt(summary.total_searches || 0),
      avg_confidence: parseFloat(summary.avg_confidence || 0).toFixed(2),
      days_tracked: parseInt(summary.days_tracked || 0),
      tiers: tierStats
    };
  }

  /**
   * Get pending review queue items
   * @param {number} limit - Max items to return
   * @returns {Array} Pending review items
   */
  async getPendingReviews(limit = 20) {
    const rows = await db.exec(`
      SELECT rq.id, rq.contractor_id, rq.scraped_data,
             rq.confidence_score, rq.validation_details, rq.created_at,
             c.business_name, c.trade, c.city
      FROM review_queue rq
      JOIN contractors_contractor c ON rq.contractor_id = c.id
      WHERE rq.status = 'pending'
      ORDER BY rq.created_at ASC
      LIMIT $1
    `, [limit]);

    return rows || [];
  }

  /**
   * Approve a review queue item
   * @param {number} reviewId - Review queue ID
   * @param {string} reviewer - Reviewer name/email
   */
  async approveReview(reviewId, reviewer) {
    await db.exec(`
      UPDATE review_queue
      SET status = 'approved', reviewed_by = $2, reviewed_at = NOW()
      WHERE id = $1
    `, [reviewId, reviewer]);
  }

  /**
   * Reject a review queue item
   * @param {number} reviewId - Review queue ID
   * @param {string} reviewer - Reviewer name/email
   * @param {string} reason - Rejection reason
   */
  async rejectReview(reviewId, reviewer, reason) {
    await db.exec(`
      UPDATE review_queue
      SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3
      WHERE id = $1
    `, [reviewId, reviewer, reason]);
  }
}

module.exports = { SearchLogger };
