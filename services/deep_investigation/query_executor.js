/**
 * Query Executor
 *
 * Executes Serper API searches and stores results in contractor_raw_data.
 */

const { SERPER_CONFIG } = require('./constants');

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);

/**
 * Execute a single Serper search
 */
async function executeSerperQuery(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'No SERPER_API_KEY', query };
  }

  try {
    const response = await fetch(`${SERPER_CONFIG.BASE_URL}/search`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: query,
        num: SERPER_CONFIG.MAX_RESULTS
      })
    });

    if (!response.ok) {
      throw new Error(`Serper API error: ${response.status}`);
    }

    const data = await response.json();
    const results = data.organic || [];

    return {
      success: true,
      query,
      result_count: results.length,
      results: results.slice(0, 5).map(r => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet?.substring(0, 300)
      })),
      knowledge_graph: data.knowledgeGraph || null,
      answer_box: data.answerBox || null
    };
  } catch (err) {
    return { success: false, error: err.message, query };
  }
}

/**
 * Execute multiple queries with rate limiting
 */
async function executeQueries(queries, contractorId, db, iterationNumber) {
  const results = [];

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    log(`  [${i + 1}/${queries.length}] Searching: ${query.substring(0, 60)}...`);

    const result = await executeSerperQuery(query);
    results.push(result);

    // Store in database
    if (db && contractorId) {
      await storeQueryResult(db, contractorId, query, result, iterationNumber);
    }

    // Rate limiting
    if (i < queries.length - 1) {
      await new Promise(r => setTimeout(r, SERPER_CONFIG.RATE_LIMIT_MS));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const totalResults = results.reduce((sum, r) => sum + (r.result_count || 0), 0);

  success(`  Executed ${queries.length} queries: ${successCount} successful, ${totalResults} total results`);

  return results;
}

/**
 * Store query result in contractor_raw_data
 */
async function storeQueryResult(db, contractorId, query, result, iterationNumber) {
  const now = new Date().toISOString();
  const sourceName = `deep_investigation_${iterationNumber}`;
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  // Build raw text from results
  let rawText = `Query: ${query}\n\n`;
  if (result.results) {
    for (const r of result.results) {
      rawText += `Title: ${r.title}\nURL: ${r.link}\nSnippet: ${r.snippet}\n\n`;
    }
  }

  try {
    await db.run(`
      INSERT INTO contractor_raw_data
      (contractor_id, source_name, source_url, raw_text, structured_data, fetch_status, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (contractor_id, source_name)
      DO UPDATE SET
        source_url = EXCLUDED.source_url,
        raw_text = contractor_raw_data.raw_text || '\n---\n' || EXCLUDED.raw_text,
        structured_data = EXCLUDED.structured_data,
        fetch_status = EXCLUDED.fetch_status,
        fetched_at = EXCLUDED.fetched_at,
        expires_at = EXCLUDED.expires_at
    `, [
      contractorId,
      sourceName,
      `serper:${query.substring(0, 100)}`,
      rawText,
      JSON.stringify(result),
      result.success ? 'success' : 'error',
      now,
      expires
    ]);
  } catch (err) {
    warn(`  Failed to store query result: ${err.message}`);
  }
}

/**
 * Extract key findings from query results
 */
function extractFindings(queryResults) {
  const findings = {
    virtual_address_evidence: [],
    timeline_evidence: [],
    permit_evidence: [],
    review_evidence: [],
    news_mentions: [],
    other: []
  };

  for (const result of queryResults) {
    if (!result.success || !result.results) continue;

    for (const r of result.results) {
      const snippet = (r.snippet || '').toLowerCase();
      const title = (r.title || '').toLowerCase();

      // Categorize findings
      if (snippet.includes('mailbox') || snippet.includes('ups store') || snippet.includes('postal')) {
        findings.virtual_address_evidence.push({
          title: r.title,
          snippet: r.snippet,
          url: r.link
        });
      }

      if (snippet.includes('established') || snippet.includes('founded') || snippet.includes('since')) {
        findings.timeline_evidence.push({
          title: r.title,
          snippet: r.snippet,
          url: r.link
        });
      }

      if (snippet.includes('permit') || title.includes('buildzoom')) {
        findings.permit_evidence.push({
          title: r.title,
          snippet: r.snippet,
          url: r.link
        });
      }

      if (title.includes('review') || snippet.includes('rating') || snippet.includes('stars')) {
        findings.review_evidence.push({
          title: r.title,
          snippet: r.snippet,
          url: r.link
        });
      }

      if (snippet.includes('lawsuit') || snippet.includes('scam') || snippet.includes('complaint') ||
          snippet.includes('investigation') || snippet.includes('fraud')) {
        findings.news_mentions.push({
          title: r.title,
          snippet: r.snippet,
          url: r.link
        });
      }
    }
  }

  return findings;
}

module.exports = {
  executeSerperQuery,
  executeQueries,
  storeQueryResult,
  extractFindings
};
