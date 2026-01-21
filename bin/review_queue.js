#!/usr/bin/env node
/**
 * Review Queue CLI
 *
 * Manage the manual review queue for low-confidence search matches.
 *
 * Usage:
 *   node bin/review_queue.js --list              List pending reviews
 *   node bin/review_queue.js --show <id>         Show details for a review
 *   node bin/review_queue.js --approve <id>      Approve a match
 *   node bin/review_queue.js --reject <id> [reason]  Reject a match
 *   node bin/review_queue.js --stats             Show queue statistics
 *   node bin/review_queue.js --ab-summary        Show A/B test summary
 */

const db = require('../services/db_pg');
const { getSummary: getABSummary, getTierBreakdown, getStatisticalAnalysis } = require('../services/ab_test');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function success(msg) { console.log(`${colors.green}${msg}${colors.reset}`); }
function warn(msg) { console.log(`${colors.yellow}${msg}${colors.reset}`); }
function error(msg) { console.log(`${colors.red}${msg}${colors.reset}`); }
function info(msg) { console.log(`${colors.cyan}${msg}${colors.reset}`); }
function dim(msg) { console.log(`${colors.dim}${msg}${colors.reset}`); }

/**
 * List pending reviews
 */
async function listPending(limit = 50) {
  const rows = await db.exec(`
    SELECT rq.id, c.id as contractor_id, c.business_name, c.trade, c.city,
           rq.confidence_score, rq.created_at,
           rq.scraped_data->>'name' as scraped_name,
           rq.scraped_data->>'address' as scraped_address,
           rq.scraped_data->>'rating' as scraped_rating,
           rq.validation_details->'reasons' as reasons,
           rq.validation_details->'scores' as scores
    FROM review_queue rq
    JOIN contractors_contractor c ON rq.contractor_id = c.id
    WHERE rq.status = 'pending'
    ORDER BY rq.created_at DESC
    LIMIT $1
  `, [limit]);

  console.log('\n=== PENDING REVIEWS ===\n');

  if (!rows || rows.length === 0) {
    success('No pending reviews!');
    return;
  }

  rows.forEach(r => {
    const confidencePct = (r.confidence_score * 100).toFixed(0);
    const confidenceColor = r.confidence_score >= 0.70 ? colors.green :
                           r.confidence_score >= 0.60 ? colors.yellow : colors.red;

    console.log(`[${colors.cyan}${r.id}${colors.reset}] ${colors.blue}${r.business_name}${colors.reset} (${r.trade || 'unknown'}, ${r.city || 'unknown'})`);
    console.log(`    Scraped as: "${r.scraped_name}" @ ${r.scraped_address || 'unknown address'}`);
    console.log(`    Confidence: ${confidenceColor}${confidencePct}%${colors.reset}`);

    // Show individual scores if available
    if (r.scores) {
      const scores = typeof r.scores === 'string' ? JSON.parse(r.scores) : r.scores;
      const scoreStr = Object.entries(scores)
        .map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`)
        .join(', ');
      dim(`    Scores: ${scoreStr}`);
    }

    // Show reasons
    if (r.reasons) {
      const reasons = typeof r.reasons === 'string' ? JSON.parse(r.reasons) : r.reasons;
      if (reasons.length > 0) {
        warn(`    Reasons: ${reasons.join('; ')}`);
      }
    }

    dim(`    Created: ${new Date(r.created_at).toLocaleString()}`);
    console.log('');
  });

  console.log(`Total: ${rows.length} pending reviews`);
}

/**
 * Show details for a specific review
 */
async function showReview(id) {
  const rows = await db.exec(`
    SELECT rq.*, c.business_name, c.trade, c.city, c.phone, c.address,
           c.license_number, c.owner_name
    FROM review_queue rq
    JOIN contractors_contractor c ON rq.contractor_id = c.id
    WHERE rq.id = $1
  `, [id]);

  if (!rows || rows.length === 0) {
    error(`Review #${id} not found`);
    return;
  }

  const r = rows[0];
  const scraped = typeof r.scraped_data === 'string' ? JSON.parse(r.scraped_data) : r.scraped_data;
  const validation = typeof r.validation_details === 'string' ? JSON.parse(r.validation_details) : r.validation_details;

  console.log('\n=== REVIEW DETAILS ===\n');

  info('Database Record:');
  console.log(`  Business: ${r.business_name}`);
  console.log(`  Trade: ${r.trade || 'N/A'}`);
  console.log(`  City: ${r.city || 'N/A'}`);
  console.log(`  Phone: ${r.phone || 'N/A'}`);
  console.log(`  Address: ${r.address || 'N/A'}`);
  console.log(`  License: ${r.license_number || 'N/A'}`);
  console.log(`  Owner: ${r.owner_name || 'N/A'}`);

  console.log('');
  info('Scraped Data:');
  console.log(`  Name: ${scraped.name || 'N/A'}`);
  console.log(`  Address: ${scraped.address || 'N/A'}`);
  console.log(`  Phone: ${scraped.phone || 'N/A'}`);
  console.log(`  Rating: ${scraped.rating || 'N/A'}★`);
  console.log(`  Reviews: ${scraped.review_count || 0}`);
  console.log(`  Categories: ${(scraped.categories || scraped.types || []).join(', ') || 'N/A'}`);

  console.log('');
  info('Validation:');
  console.log(`  Confidence: ${(r.confidence_score * 100).toFixed(0)}%`);
  console.log(`  Status: ${r.status}`);

  if (validation?.scores) {
    console.log('  Scores:');
    Object.entries(validation.scores).forEach(([k, v]) => {
      const color = v >= 0.7 ? colors.green : v >= 0.5 ? colors.yellow : colors.red;
      console.log(`    ${k}: ${color}${(v * 100).toFixed(0)}%${colors.reset}`);
    });
  }

  if (validation?.reasons?.length > 0) {
    console.log('  Reasons:');
    validation.reasons.forEach(r => warn(`    - ${r}`));
  }

  console.log('');
  dim(`Created: ${new Date(r.created_at).toLocaleString()}`);
  if (r.reviewed_at) {
    dim(`Reviewed: ${new Date(r.reviewed_at).toLocaleString()} by ${r.reviewed_by}`);
  }

  console.log('\nCommands:');
  console.log(`  Approve: node bin/review_queue.js --approve ${id}`);
  console.log(`  Reject:  node bin/review_queue.js --reject ${id} "Wrong business"`);
}

/**
 * Approve a review
 */
async function approve(id) {
  const result = await db.exec(`
    UPDATE review_queue
    SET status = 'approved', reviewed_at = NOW(), reviewed_by = 'cli'
    WHERE id = $1 AND status = 'pending'
    RETURNING id
  `, [id]);

  if (result && result.length > 0) {
    success(`✓ Approved review #${id}`);
  } else {
    error(`Review #${id} not found or already processed`);
  }
}

/**
 * Reject a review
 */
async function reject(id, reason) {
  const result = await db.exec(`
    UPDATE review_queue
    SET status = 'rejected', reviewed_at = NOW(), reviewed_by = 'cli', rejection_reason = $2
    WHERE id = $1 AND status = 'pending'
    RETURNING id
  `, [id, reason || 'No reason given']);

  if (result && result.length > 0) {
    success(`✗ Rejected review #${id}: ${reason || 'No reason given'}`);
  } else {
    error(`Review #${id} not found or already processed`);
  }
}

/**
 * Show queue statistics
 */
async function showStats() {
  console.log('\n=== REVIEW QUEUE STATISTICS ===\n');

  // Queue status breakdown
  const statusRows = await db.exec(`
    SELECT status, COUNT(*) as count
    FROM review_queue
    GROUP BY status
  `);

  info('Queue Status:');
  (statusRows || []).forEach(r => {
    const color = r.status === 'pending' ? colors.yellow :
                  r.status === 'approved' ? colors.green : colors.red;
    console.log(`  ${color}${r.status}${colors.reset}: ${r.count}`);
  });

  // Confidence distribution
  const confRows = await db.exec(`
    SELECT
      CASE
        WHEN confidence_score >= 0.75 THEN '75-79%'
        WHEN confidence_score >= 0.70 THEN '70-74%'
        WHEN confidence_score >= 0.65 THEN '65-69%'
        WHEN confidence_score >= 0.60 THEN '60-64%'
        ELSE '<60%'
      END as range,
      COUNT(*) as count
    FROM review_queue
    WHERE status = 'pending'
    GROUP BY range
    ORDER BY range DESC
  `);

  console.log('');
  info('Pending by Confidence:');
  (confRows || []).forEach(r => {
    console.log(`  ${r.range}: ${r.count}`);
  });

  // Recent activity
  const activityRows = await db.exec(`
    SELECT
      DATE(reviewed_at) as date,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
    FROM review_queue
    WHERE reviewed_at IS NOT NULL AND reviewed_at > NOW() - INTERVAL '7 days'
    GROUP BY DATE(reviewed_at)
    ORDER BY date DESC
  `);

  console.log('');
  info('Recent Activity (7 days):');
  if (!activityRows || activityRows.length === 0) {
    dim('  No recent activity');
  } else {
    activityRows.forEach(r => {
      console.log(`  ${r.date}: ${colors.green}+${r.approved}${colors.reset} / ${colors.red}-${r.rejected}${colors.reset}`);
    });
  }

  // Search metrics
  const metricsRows = await db.exec(`
    SELECT * FROM search_metrics_daily
    ORDER BY date DESC
    LIMIT 7
  `);

  console.log('');
  info('Search Metrics (7 days):');
  if (!metricsRows || metricsRows.length === 0) {
    dim('  No metrics recorded yet');
  } else {
    metricsRows.forEach(r => {
      const total = r.total_searches || 0;
      const t1 = (r.tier1_success || 0) + (r.tier1_fail || 0);
      const t1Rate = t1 > 0 ? ((r.tier1_success / t1) * 100).toFixed(0) : 'N/A';
      console.log(`  ${r.date}: ${total} searches, Tier1 ${t1Rate}% success, avg conf ${(r.avg_confidence || 0).toFixed(2)}`);
    });
  }
}

/**
 * Show A/B test summary
 */
async function showABSummary() {
  console.log('\n=== A/B TEST SUMMARY ===\n');

  try {
    const summary = await getABSummary();

    if (!summary || summary.length === 0) {
      dim('No A/B test data recorded yet');
      return;
    }

    info('Variant Performance:');
    summary.forEach(s => {
      const color = s.variant === 'new' ? colors.cyan : colors.yellow;
      console.log(`\n  ${color}${s.variant.toUpperCase()}${colors.reset}:`);
      console.log(`    Total: ${s.total}`);
      console.log(`    Found: ${s.found} (${s.successRate})`);
      console.log(`    Avg Confidence: ${s.avgConfidence}`);
      console.log(`    Avg Search Time: ${s.avgSearchTime}`);
    });

    // Tier breakdown for new search
    const tierBreakdown = await getTierBreakdown();
    if (tierBreakdown.new && Object.keys(tierBreakdown.new).length > 0) {
      console.log('');
      info('Tier Breakdown (NEW):');
      Object.entries(tierBreakdown.new).forEach(([tier, count]) => {
        console.log(`    ${tier}: ${count}`);
      });
    }

    // Statistical analysis
    const analysis = await getStatisticalAnalysis();
    if (analysis && !analysis.error) {
      console.log('');
      info('Statistical Analysis:');
      console.log(`    New Success: ${analysis.newSuccess}`);
      console.log(`    Legacy Success: ${analysis.legacySuccess}`);
      console.log(`    Chi-squared: ${analysis.chiSquared}`);
      console.log(`    p-value: ${analysis.pValue}`);
      console.log(`    Significant: ${analysis.significant ? colors.green + 'YES' : colors.yellow + 'NO'}${colors.reset}`);
      console.log(`    Recommendation: ${analysis.recommendation}`);
    }

  } catch (err) {
    error(`Failed to get A/B summary: ${err.message}`);
  }
}

/**
 * Main CLI handler
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case '--list':
      case '-l':
        await listPending(parseInt(args[1]) || 50);
        break;

      case '--show':
      case '-s':
        if (!args[1]) {
          error('Usage: --show <id>');
          break;
        }
        await showReview(parseInt(args[1]));
        break;

      case '--approve':
      case '-a':
        if (!args[1]) {
          error('Usage: --approve <id>');
          break;
        }
        await approve(parseInt(args[1]));
        break;

      case '--reject':
      case '-r':
        if (!args[1]) {
          error('Usage: --reject <id> [reason]');
          break;
        }
        await reject(parseInt(args[1]), args.slice(2).join(' '));
        break;

      case '--stats':
        await showStats();
        break;

      case '--ab-summary':
      case '--ab':
        await showABSummary();
        break;

      case '--help':
      case '-h':
      default:
        console.log(`
${colors.cyan}Review Queue CLI${colors.reset}

Manage the manual review queue for low-confidence search matches.

${colors.yellow}Commands:${colors.reset}
  --list, -l [limit]          List pending reviews (default: 50)
  --show, -s <id>             Show details for a review
  --approve, -a <id>          Approve a match
  --reject, -r <id> [reason]  Reject a match
  --stats                     Show queue statistics
  --ab-summary, --ab          Show A/B test summary
  --help, -h                  Show this help

${colors.yellow}Examples:${colors.reset}
  node bin/review_queue.js --list
  node bin/review_queue.js --show 42
  node bin/review_queue.js --approve 42
  node bin/review_queue.js --reject 42 "Wrong business type"
  node bin/review_queue.js --stats
  node bin/review_queue.js --ab
        `);
    }
  } finally {
    await db.close();
  }
}

main().catch(err => {
  error(`Error: ${err.message}`);
  process.exit(1);
});
