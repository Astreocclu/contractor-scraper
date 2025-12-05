#!/usr/bin/env node
/**
 * Batch Collection Script (V2)
 *
 * Collects data for contractors and stores to database.
 * Run this as a separate job before auditing.
 *
 * Usage:
 *   node batch_collect.js --id 29              # Single contractor
 *   node batch_collect.js --all                # All contractors needing refresh
 *   node batch_collect.js --ids 29,74,83       # Multiple IDs
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const { CollectionService } = require('./services/collection_service');

const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  if (['all', 'dry-run', 'force'].includes(name)) return true;
  return args[idx + 1];
};

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

async function collectForContractor(db, collectionService, contractorId) {
  // Get contractor info
  const result = db.exec(`
    SELECT id, business_name, city, state, website, zip_code
    FROM contractors_contractor WHERE id = ?
  `, [contractorId]);

  if (!result.length || !result[0].values.length) {
    error(`Contractor ID ${contractorId} not found`);
    return null;
  }

  const row = result[0].values[0];
  const contractor = {
    id: row[0],
    name: row[1],
    city: row[2],
    state: row[3],
    website: row[4],
    zip: row[5]
  };

  log(`\n📋 ${contractor.name} (ID ${contractor.id})`);
  log(`   ${contractor.city}, ${contractor.state}`);

  // Check cache freshness
  const cacheResult = db.exec(`
    SELECT COUNT(*), SUM(CASE WHEN datetime(expires_at) > datetime('now') THEN 1 ELSE 0 END)
    FROM contractor_raw_data WHERE contractor_id = ?
  `, [contractorId]);

  const total = cacheResult[0]?.values[0][0] || 0;
  const fresh = cacheResult[0]?.values[0][1] || 0;

  const force = getArg('force');

  if (fresh >= 20 && !force) {
    log(`   ⏭️  ${fresh} fresh sources cached, skipping (use --force to override)`);
    return { contractor, status: 'cached', fresh };
  }

  // Run collection
  const results = await collectionService.runInitialCollection(contractorId, contractor);
  const successCount = results.filter(r => r.status === 'success').length;

  success(`   ✓ Collected ${successCount}/${results.length} sources`);

  return { contractor, status: 'collected', count: successCount };
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  📥 BATCH COLLECTION (V2)');
  console.log('═'.repeat(60));

  const dryRun = getArg('dry-run');
  const singleId = getArg('id') ? parseInt(getArg('id')) : null;
  const multiIds = getArg('ids') ? getArg('ids').split(',').map(Number) : null;
  const collectAll = getArg('all');

  // Initialize database
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Determine which contractors to collect
  let contractorIds = [];

  if (singleId) {
    contractorIds = [singleId];
  } else if (multiIds) {
    contractorIds = multiIds;
  } else if (collectAll) {
    // Get contractors needing refresh (no fresh data or never collected)
    const result = db.exec(`
      SELECT DISTINCT c.id
      FROM contractors_contractor c
      LEFT JOIN (
        SELECT contractor_id, COUNT(*) as fresh_count
        FROM contractor_raw_data
        WHERE datetime(expires_at) > datetime('now')
        GROUP BY contractor_id
      ) rd ON c.id = rd.contractor_id
      WHERE c.is_active = 1
        AND (rd.fresh_count IS NULL OR rd.fresh_count < 20)
      ORDER BY c.id
      LIMIT 50
    `);

    if (result.length && result[0].values) {
      contractorIds = result[0].values.map(r => r[0]);
    }
  } else {
    console.log(`
Usage:
  node batch_collect.js --id 29           # Single contractor
  node batch_collect.js --ids 29,74,83    # Multiple contractors
  node batch_collect.js --all             # All needing refresh (max 50)

Options:
  --dry-run    Don't save to database
  --force      Refresh even if cached
`);
    process.exit(0);
  }

  log(`\nContractors to collect: ${contractorIds.length}`);

  // Initialize collection service
  const collectionService = new CollectionService(db);
  await collectionService.init();

  const results = [];
  const startTime = Date.now();

  try {
    for (const id of contractorIds) {
      const result = await collectForContractor(db, collectionService, id);
      if (result) results.push(result);
    }

    // Save database
    if (!dryRun) {
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
      success('\n✅ Database saved');
    } else {
      warn('\n⚠️  DRY RUN - not saved');
    }

    // Summary
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const collected = results.filter(r => r.status === 'collected').length;
    const cached = results.filter(r => r.status === 'cached').length;

    console.log('\n' + '═'.repeat(60));
    console.log('  SUMMARY');
    console.log('═'.repeat(60));
    console.log(`  Total: ${results.length}`);
    console.log(`  Collected: ${collected}`);
    console.log(`  Cached (skipped): ${cached}`);
    console.log(`  Time: ${elapsed}s`);
    console.log('═'.repeat(60) + '\n');

  } finally {
    await collectionService.close();
    db.close();
  }
}

main().catch(err => {
  error(`Fatal: ${err.message}`);
  process.exit(1);
});
