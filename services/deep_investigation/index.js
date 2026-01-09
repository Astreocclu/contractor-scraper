/**
 * Deep Investigation Framework - Main Entry Point
 *
 * Iterative investigation loop that catches fraud patterns by following leads.
 *
 * Usage:
 *   const { runDeepInvestigation } = require('./services/deep_investigation');
 *   const results = await runDeepInvestigation(contractorId, contractor, db, options);
 */

const { runRuleChecks } = require('./rule_checks');
const { executeQueries, extractFindings } = require('./query_executor');
const { runLLMCascade } = require('./llm_cascade');
const {
  INVESTIGATION_MODE,
  MAX_ITERATIONS,
  MAX_TIME_MS,
  MAX_QUERIES_PER_ITERATION,
  SEVERITY
} = require('./constants');

// Colored console logging
const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

/**
 * Load raw data from database for a contractor
 *
 * @param {object} db - Database connection with exec() method
 * @param {number} contractorId - Contractor ID to load data for
 * @returns {Promise<array>} Array of raw data rows
 */
async function loadRawData(db, contractorId) {
  try {
    const rows = await db.exec(`
      SELECT source_name, raw_text, structured_data, fetch_status
      FROM contractor_raw_data
      WHERE contractor_id = $1
      ORDER BY source_name
    `, [contractorId]);

    return rows || [];
  } catch (err) {
    warn(`  Failed to load raw data: ${err.message}`);
    return [];
  }
}

/**
 * Main deep investigation function
 *
 * Runs an iterative investigation loop:
 * 1. Rule-based checks identify known fraud patterns
 * 2. LLM cascade generates targeted follow-up queries
 * 3. Serper API executes searches
 * 4. Loop repeats until max_iterations/max_time/no new queries
 *
 * @param {number} contractorId - Contractor ID
 * @param {object} contractor - Contractor object with name, city, state, address
 * @param {object} db - Database connection
 * @param {object} options - Investigation options
 * @param {string} options.mode - 'minimal' | 'standard' | 'full'
 * @param {number} options.maxIterations - Max iterations (default: 5)
 * @param {number} options.maxTimeMs - Max time in ms (default: 180000)
 * @returns {Promise<object>} Investigation result
 */
async function runDeepInvestigation(contractorId, contractor, db, options = {}) {
  const mode = options.mode || INVESTIGATION_MODE;
  const maxIterations = options.maxIterations || MAX_ITERATIONS;
  const maxTimeMs = options.maxTimeMs || MAX_TIME_MS;

  const startTime = Date.now();

  console.log('\n' + '='.repeat(60));
  console.log('  DEEP INVESTIGATION FRAMEWORK');
  console.log('='.repeat(60));
  log(`  Contractor: ${contractor.name}`);
  log(`  Mode: ${mode}`);
  log(`  Max iterations: ${maxIterations}`);

  // Track investigation state
  const state = {
    iteration: 0,
    total_queries_executed: 0,
    total_cost: 0,
    all_flags: [],
    all_query_results: [],
    executed_queries: new Set(),
    llm_trace: null
  };

  // Load initial raw data
  let rawData = await loadRawData(db, contractorId);
  log(`  Initial data sources: ${rawData.length}`);

  // ============ ITERATION LOOP ============
  while (state.iteration < maxIterations) {
    state.iteration++;
    const elapsed = Date.now() - startTime;

    // Check time limit
    if (elapsed >= maxTimeMs) {
      warn(`  Time limit reached (${Math.round(elapsed / 1000)}s)`);
      break;
    }

    log(`\n--- Iteration ${state.iteration}/${maxIterations} ---`);

    // 1. Run rule-based checks
    log('  Running rule-based checks...');
    const ruleResults = runRuleChecks(contractor, rawData);

    // Find new flags (not already discovered)
    const newFlags = ruleResults.flags.filter(f =>
      !state.all_flags.some(existing =>
        existing.category === f.category && existing.description === f.description
      )
    );

    if (newFlags.length > 0) {
      state.all_flags.push(...newFlags);
      log(`    Found ${newFlags.length} new flags (total: ${state.all_flags.length})`);
      for (const flag of newFlags) {
        const color = flag.severity === SEVERITY.CRITICAL ? '\x1b[31m' :
                      flag.severity === SEVERITY.SEVERE ? '\x1b[33m' : '\x1b[0m';
        log(`    ${color}[${flag.severity}] ${flag.category}: ${flag.description}\x1b[0m`);
      }
    } else {
      log('    No new flags');
    }

    // 2. Collect suggested queries (dedup against already executed)
    const pendingQueries = ruleResults.suggested_queries
      .filter(q => !state.executed_queries.has(q))
      .slice(0, MAX_QUERIES_PER_ITERATION);

    // 3. Run LLM cascade if triggered
    if (ruleResults.llm_trigger || state.iteration === 1) {
      log('  LLM analysis triggered...');
      const llmTrace = await runLLMCascade(
        contractor,
        ruleResults,
        rawData,
        state.all_query_results,
        mode
      );
      state.llm_trace = llmTrace;
      state.total_cost += llmTrace.total_cost;

      // Add LLM-suggested queries
      if (llmTrace.final_result?.suggested_queries) {
        for (const sq of llmTrace.final_result.suggested_queries) {
          const query = sq.query || sq;
          if (!state.executed_queries.has(query) && pendingQueries.length < MAX_QUERIES_PER_ITERATION) {
            pendingQueries.push(query);
          }
        }
      }

      // Add additional queries from Gemini if available
      if (llmTrace.final_result?.additional_queries) {
        for (const aq of llmTrace.final_result.additional_queries) {
          const query = aq.query;
          if (query && !state.executed_queries.has(query) && pendingQueries.length < MAX_QUERIES_PER_ITERATION) {
            pendingQueries.push(query);
          }
        }
      }
    }

    // 4. Execute queries if any pending
    if (pendingQueries.length === 0) {
      log('  No new queries to execute - investigation complete');
      break;
    }

    log(`  Executing ${pendingQueries.length} queries...`);
    const queryResults = await executeQueries(pendingQueries, contractorId, db, state.iteration);

    // Track executed queries
    for (const q of pendingQueries) {
      state.executed_queries.add(q);
    }
    state.all_query_results.push(...queryResults);
    state.total_queries_executed += pendingQueries.length;

    // 5. Extract findings from query results
    const findings = extractFindings(queryResults);

    // Check if we found virtual address evidence
    if (findings.virtual_address_evidence.length > 0) {
      const existingVirtualFlag = state.all_flags.find(f => f.category === 'virtual_address');
      if (existingVirtualFlag) {
        existingVirtualFlag.evidence.search_results = findings.virtual_address_evidence;
        existingVirtualFlag.severity = SEVERITY.CRITICAL;
        log(`    Upgraded virtual_address flag to CRITICAL (found confirmation)`);
      }
    }

    // Check if we found news mentions (lawsuits, scams)
    if (findings.news_mentions.length > 0) {
      const hasNewsFlag = state.all_flags.some(f => f.category === 'negative_news');
      if (!hasNewsFlag) {
        state.all_flags.push({
          severity: SEVERITY.SEVERE,
          category: 'negative_news',
          description: `Found ${findings.news_mentions.length} concerning news mentions`,
          evidence: findings.news_mentions
        });
      }
    }

    // 6. Reload raw data for next iteration
    rawData = await loadRawData(db, contractorId);
  }

  // ============ FINAL REPORT ============
  const elapsed = Date.now() - startTime;

  console.log('\n' + '='.repeat(60));
  console.log('  DEEP INVESTIGATION COMPLETE');
  console.log('='.repeat(60));
  log(`  Iterations: ${state.iteration}`);
  log(`  Queries executed: ${state.total_queries_executed}`);
  log(`  Total flags: ${state.all_flags.length}`);
  log(`  LLM cost: $${state.total_cost.toFixed(4)}`);
  log(`  Time: ${Math.round(elapsed / 1000)}s`);

  // Categorize flags by severity
  const critical = state.all_flags.filter(f => f.severity === SEVERITY.CRITICAL);
  const severe = state.all_flags.filter(f => f.severity === SEVERITY.SEVERE);
  const moderate = state.all_flags.filter(f => f.severity === SEVERITY.MODERATE);
  const low = state.all_flags.filter(f => f.severity === SEVERITY.LOW);

  if (critical.length > 0) {
    error(`\n  CRITICAL FLAGS (${critical.length}):`);
    for (const f of critical) {
      error(`    - ${f.category}: ${f.description}`);
    }
  }

  if (severe.length > 0) {
    warn(`\n  SEVERE FLAGS (${severe.length}):`);
    for (const f of severe) {
      warn(`    - ${f.category}: ${f.description}`);
    }
  }

  // Build final result
  const recommendation = getRecommendation(state.all_flags);
  const result = {
    contractor_id: contractorId,
    contractor_name: contractor.name,
    mode,
    iterations: state.iteration,
    queries_executed: state.total_queries_executed,
    elapsed_ms: elapsed,
    total_cost: state.total_cost,
    flags: state.all_flags,
    flags_by_severity: {
      critical: critical.length,
      severe: severe.length,
      moderate: moderate.length,
      low: low.length
    },
    llm_trace: state.llm_trace,
    recommendation
  };

  // Log recommendation
  const recColor = recommendation === 'AVOID' ? '\x1b[31m' :
                   recommendation === 'CAUTION' ? '\x1b[33m' : '\x1b[32m';
  log(`\n  ${recColor}Recommendation: ${recommendation}\x1b[0m`);

  // Store investigation results
  await storeInvestigationResults(db, contractorId, result);

  return result;
}

/**
 * Get recommendation based on flags
 *
 * @param {array} flags - Array of flag objects with severity
 * @returns {string} 'AVOID' | 'CAUTION' | 'PROCEED_TO_AUDIT'
 */
function getRecommendation(flags) {
  const critical = flags.filter(f => f.severity === SEVERITY.CRITICAL).length;
  const severe = flags.filter(f => f.severity === SEVERITY.SEVERE).length;

  if (critical >= 1) return 'AVOID';
  if (severe >= 3) return 'AVOID';
  if (severe >= 1) return 'CAUTION';
  return 'PROCEED_TO_AUDIT';
}

/**
 * Store investigation results in database
 *
 * @param {object} db - Database connection
 * @param {number} contractorId - Contractor ID
 * @param {object} result - Investigation result object
 */
async function storeInvestigationResults(db, contractorId, result) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  const summaryText = `Deep investigation completed in ${result.iterations} iterations. ` +
    `Found ${result.flags.length} flags (${result.flags_by_severity.critical} critical, ` +
    `${result.flags_by_severity.severe} severe). Recommendation: ${result.recommendation}`;

  try {
    await db.run(`
      INSERT INTO contractor_raw_data
      (contractor_id, source_name, source_url, raw_text, structured_data, fetch_status, fetched_at, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (contractor_id, source_name)
      DO UPDATE SET
        raw_text = EXCLUDED.raw_text,
        structured_data = EXCLUDED.structured_data,
        fetch_status = EXCLUDED.fetch_status,
        fetched_at = EXCLUDED.fetched_at,
        expires_at = EXCLUDED.expires_at
    `, [
      contractorId,
      'deep_investigation_summary',
      'internal',
      summaryText,
      JSON.stringify(result),
      'success',
      now,
      expires
    ]);

    success('  Investigation results stored');
  } catch (err) {
    warn(`  Failed to store investigation results: ${err.message}`);
  }
}

module.exports = {
  runDeepInvestigation,
  loadRawData,
  getRecommendation,
  storeInvestigationResults
};
