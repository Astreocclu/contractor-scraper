// services/cost_tracker.js
const fs = require('fs');
const path = require('path');

const COST_LOG_PATH = path.join(__dirname, '../logs/costs.jsonl');

// Ensure logs directory exists
const logsDir = path.dirname(COST_LOG_PATH);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// In-memory accumulator for session totals
let sessionCosts = {
  deepseek: 0,
  serper: 0,
  total: 0,
  requests: 0
};

/**
 * Log a cost event (append-only for crash safety)
 */
function logCost(source, cost, metadata = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    source,
    cost_usd: cost,
    ...metadata
  };

  // Append to file (crash-safe)
  fs.appendFileSync(COST_LOG_PATH, JSON.stringify(entry) + '\n');

  // Update session totals
  sessionCosts[source] = (sessionCosts[source] || 0) + cost;
  sessionCosts.total += cost;
  sessionCosts.requests++;

  return sessionCosts;
}

/**
 * Get current session costs
 */
function getSessionCosts() {
  return { ...sessionCosts };
}

/**
 * Reset session costs (for new batch run)
 */
function resetSessionCosts() {
  sessionCosts = { deepseek: 0, serper: 0, total: 0, requests: 0 };
}

module.exports = { logCost, getSessionCosts, resetSessionCosts };
