/**
 * Orchestrator
 *
 * Coordinates the collection → audit loop.
 * Handles database connection, caching, and overall flow.
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { CollectionService } = require('./collection_service');
const { AuditAgent } = require('./audit_agent');

const DB_PATH = path.join(__dirname, '..', 'db.sqlite3');

// Logging helpers
const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

/**
 * Run a forensic audit on a contractor
 */
async function runForensicAudit(contractorInput, options = {}) {
  const { dryRun = false, skipCollection = false, collectOnly = false } = options;

  console.log('\n' + '═'.repeat(60));
  console.log('  🔍 AGENTIC FORENSIC AUDIT');
  console.log('═'.repeat(60));

  // Initialize sql.js
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Find or validate contractor
  let contractor;
  let contractorId;

  if (contractorInput.id) {
    // Lookup by ID
    const result = db.exec(`
      SELECT id, business_name, city, state, website, zip_code
      FROM contractors_contractor WHERE id = ?
    `, [contractorInput.id]);

    if (!result.length || !result[0].values.length) {
      error(`Contractor ID ${contractorInput.id} not found`);
      db.close();
      return null;
    }

    const row = result[0].values[0];
    contractorId = row[0];
    contractor = {
      id: row[0],
      name: row[1],
      city: row[2],
      state: row[3],
      website: row[4],
      zip: row[5]
    };
  } else if (contractorInput.name) {
    // Create temp contractor (not in DB)
    contractorId = null;
    contractor = {
      id: null,
      name: contractorInput.name,
      city: contractorInput.city || 'Dallas',
      state: contractorInput.state || 'TX',
      website: contractorInput.website,
      zip: contractorInput.zip
    };

    // Try to find matching contractor in DB
    const result = db.exec(`
      SELECT id, business_name, city, state, website, zip_code
      FROM contractors_contractor
      WHERE LOWER(business_name) LIKE LOWER(?)
      LIMIT 1
    `, [`%${contractor.name}%`]);

    if (result.length && result[0].values.length) {
      const row = result[0].values[0];
      contractorId = row[0];
      contractor.id = row[0];
      log(`  Found matching contractor in DB: ID ${contractorId}`);
    } else {
      warn(`  Contractor not in database - creating temporary entry`);
      // Insert temporary contractor with all required NOT NULL fields
      const slug = contractor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').trim();
      const now = new Date().toISOString();
      db.run(`
        INSERT INTO contractors_contractor (
          business_name, slug, address, city, state, website, zip_code, phone,
          google_review_count, google_reviews_json, yelp_review_count,
          bbb_accredited, bbb_complaint_count,
          trust_score, passes_threshold, verification_score, reputation_score,
          credibility_score, red_flag_score, bonus_score,
          admin_override_reason, ai_summary, ai_sentiment_score, ai_red_flags,
          is_claimed, is_active, first_scraped_at, tier
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '', '', 0, '[]', 0, 1, ?, 'UNRATED')
      `, [contractor.name, slug, '', contractor.city, contractor.state, contractor.website || '', contractor.zip || '', contractor.phone || '', now]);

      const idResult = db.exec('SELECT last_insert_rowid()');
      contractorId = idResult[0].values[0][0];
      contractor.id = contractorId;
      log(`  Created contractor ID: ${contractorId}`);
    }
  } else {
    error('Must provide either --id or --name');
    db.close();
    return null;
  }

  log(`\n📋 Contractor: ${contractor.name}`);
  log(`📍 Location: ${contractor.city}, ${contractor.state}`);
  if (contractor.website) log(`🌐 Website: ${contractor.website}`);

  // Initialize collection service
  const collectionService = new CollectionService(db);
  await collectionService.init();

  try {
    // Check for existing cached data
    const cacheResult = db.exec(`
      SELECT COUNT(*), SUM(CASE WHEN datetime(expires_at) > datetime('now') THEN 1 ELSE 0 END)
      FROM contractor_raw_data
      WHERE contractor_id = ?
    `, [contractorId]);

    const totalCached = cacheResult[0]?.values[0][0] || 0;
    const freshCached = cacheResult[0]?.values[0][1] || 0;

    if (!skipCollection) {
      if (freshCached >= 20) {
        log(`\n📦 Using ${freshCached} fresh cached sources (skipping collection)`);
      } else if (totalCached > 0) {
        log(`\n📦 Found ${totalCached} cached sources (${freshCached} fresh)`);
        log(`📥 Running collection to refresh stale data...`);
        await collectionService.runInitialCollection(contractorId, contractor);
      } else {
        log(`\n📥 No cached data - running initial collection...`);
        await collectionService.runInitialCollection(contractorId, contractor);
      }
    } else {
      log(`\n⏭️  Skipping collection (--skip-collection)`);
    }

    // If collect-only, return summary and exit
    if (collectOnly) {
      const coverage = db.exec(`
        SELECT fetch_status, COUNT(*) as cnt
        FROM contractor_raw_data
        WHERE contractor_id = ?
        GROUP BY fetch_status
      `, [contractorId]);

      const stats = {};
      if (coverage.length && coverage[0].values) {
        for (const row of coverage[0].values) {
          stats[row[0]] = row[1];
        }
      }

      console.log('\n' + '═'.repeat(60));
      console.log('  COLLECTION COMPLETE (--collect-only)');
      console.log('═'.repeat(60));
      console.log(`\n  Contractor: ${contractor.name}`);
      console.log(`  Sources collected: ${Object.values(stats).reduce((a, b) => a + b, 0)}`);
      console.log(`  Successful: ${stats.success || 0}`);
      console.log(`  Not found: ${stats.not_found || 0}`);
      console.log(`  Errors: ${stats.error || 0}`);

      // Save DB
      if (!dryRun) {
        const data = db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
        success('\n✅ Collection saved to database');
      } else {
        warn('\n⚠️  DRY RUN - collection not saved');
      }

      console.log('═'.repeat(60) + '\n');
      return { collectOnly: true, stats, contractor };
    }

    // Run agentic audit
    const agent = new AuditAgent(db, contractorId, contractor);
    const result = await agent.run(collectionService);

    // Display results
    console.log('\n' + '═'.repeat(60));
    console.log('  AUDIT RESULTS');
    console.log('═'.repeat(60));

    const scoreColor = result.trust_score >= 70 ? '\x1b[32m' :
                       result.trust_score >= 40 ? '\x1b[33m' : '\x1b[31m';

    console.log(`\n  Trust Score:    ${scoreColor}${result.trust_score}/100\x1b[0m`);
    console.log(`  Risk Level:     ${result.risk_level}`);
    console.log(`  Recommendation: ${result.recommendation}`);

    console.log('\n--- REASONING ---');
    console.log(result.reasoning);

    if (result.red_flags && result.red_flags.length > 0) {
      console.log('\n--- RED FLAGS ---');
      for (const flag of result.red_flags) {
        const severityColor = flag.severity === 'CRITICAL' ? '\x1b[31m' :
                              flag.severity === 'HIGH' ? '\x1b[31m' :
                              flag.severity === 'MEDIUM' ? '\x1b[33m' : '\x1b[0m';
        console.log(`${severityColor}  [${flag.severity}] ${flag.category}: ${flag.description}\x1b[0m`);
        if (flag.evidence) {
          console.log(`    Evidence: ${flag.evidence}`);
        }
      }
    }

    if (result.positive_signals && result.positive_signals.length > 0) {
      console.log('\n--- POSITIVE SIGNALS ---');
      for (const signal of result.positive_signals) {
        console.log(`  ✓ ${signal}`);
      }
    }

    if (result.gaps_remaining && result.gaps_remaining.length > 0) {
      console.log('\n--- DATA GAPS ---');
      for (const gap of result.gaps_remaining) {
        console.log(`  ⚠ ${gap}`);
      }
    }

    console.log('\n--- METADATA ---');
    console.log(`  Collection rounds: ${result.collection_rounds}`);
    console.log(`  API cost: $${result.total_cost.toFixed(4)}`);

    // Save database
    if (!dryRun) {
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
      success('\n✅ Audit saved to database');
    } else {
      warn('\n⚠️  DRY RUN - results not saved');
    }

    console.log('\n' + '═'.repeat(60));

    return result;

  } finally {
    await collectionService.close();
    db.close();
  }
}

/**
 * List recent audits
 */
async function listRecentAudits(limit = 10) {
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  try {
    const result = db.exec(`
      SELECT
        ar.id,
        cc.business_name,
        ar.trust_score,
        ar.risk_level,
        ar.recommendation,
        ar.collection_rounds,
        ar.created_at
      FROM audit_records ar
      JOIN contractors_contractor cc ON ar.contractor_id = cc.id
      ORDER BY ar.created_at DESC
      LIMIT ?
    `, [limit]);

    if (!result.length || !result[0].values.length) {
      log('No audits found');
      return [];
    }

    console.log('\nRecent Audits:');
    console.log('-'.repeat(80));

    for (const row of result[0].values) {
      const [id, name, score, risk, rec, rounds, date] = row;
      const scoreColor = score >= 70 ? '\x1b[32m' : score >= 40 ? '\x1b[33m' : '\x1b[31m';
      console.log(`  #${id} | ${name.substring(0, 30).padEnd(30)} | ${scoreColor}${score}/100\x1b[0m | ${rec} | ${date}`);
    }

    return result[0].values;
  } finally {
    db.close();
  }
}

/**
 * Get data coverage for a contractor
 */
async function getDataCoverage(contractorId) {
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  try {
    const result = db.exec(`
      SELECT source_name, fetch_status, fetched_at, expires_at
      FROM contractor_raw_data
      WHERE contractor_id = ?
      ORDER BY source_name
    `, [contractorId]);

    if (!result.length) {
      return { sources: [], total: 0 };
    }

    const sources = result[0].values.map(row => ({
      name: row[0],
      status: row[1],
      fetched: row[2],
      expires: row[3],
      fresh: row[3] ? new Date(row[3]) > new Date() : false
    }));

    return {
      sources,
      total: sources.length,
      successful: sources.filter(s => s.status === 'success').length,
      fresh: sources.filter(s => s.fresh).length
    };
  } finally {
    db.close();
  }
}

module.exports = {
  runForensicAudit,
  listRecentAudits,
  getDataCoverage
};
