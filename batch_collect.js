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

const db = require('./services/db_pg');
const { CollectionService } = require('./services/collection_service');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  if (['all', 'dry-run', 'force'].includes(name)) return true;
  return args[idx + 1];
};
const getIntArg = (name) => {
  const val = getArg(name);
  return val ? parseInt(val, 10) : null;
};

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

async function collectForContractor(db, collectionService, contractorId) {
  // Get contractor info
  const rows = await db.exec(`
    SELECT id, business_name, city, state, website, zip_code
    FROM contractors_contractor WHERE id = ?
  `, [contractorId]);

  if (rows.length === 0) {
    error(`Contractor ID ${contractorId} not found`);
    return null;
  }

  const row = rows[0];
  const contractor = {
    id: row.id,
    name: row.business_name,
    city: row.city,
    state: row.state,
    website: row.website,
    zip: row.zip_code
  };

  log(`\n📋 ${contractor.name} (ID ${contractor.id})`);
  log(`   ${contractor.city}, ${contractor.state}`);

  // Check cache freshness
  const cacheRows = await db.exec(`
    SELECT COUNT(*) as count, SUM(CASE WHEN expires_at > NOW() THEN 1 ELSE 0 END) as fresh
    FROM contractor_raw_data WHERE contractor_id = ?
  `, [contractorId]);

  const total = parseInt(cacheRows[0]?.count || 0);
  const fresh = parseInt(cacheRows[0]?.fresh || 0);

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
  const singleId = getIntArg('id');
  const multiIds = getArg('ids') ? getArg('ids').split(',').map(Number) : null;
  const collectAll = getArg('all');
  const limit = getIntArg('limit') || 50;

  // Initialize database
  // (Postgres pool initialized on require)

  // Determine which contractors to collect
  let contractorIds = [];

  if (singleId) {
    contractorIds = [singleId];
  } else if (multiIds) {
    contractorIds = multiIds;
  } else if (collectAll) {
    // Get contractors needing refresh (no fresh data or never collected)
    const rows = await db.exec(`
      SELECT DISTINCT c.id
      FROM contractors_contractor c
      LEFT JOIN (
        SELECT contractor_id, COUNT(*) as fresh_count
        FROM contractor_raw_data
        WHERE expires_at > NOW()
        GROUP BY contractor_id
      ) rd ON c.id = rd.contractor_id
      WHERE c.is_active = true
        AND (rd.fresh_count IS NULL OR rd.fresh_count < 20)
      ORDER BY c.id
      LIMIT ${limit}
    `);

    contractorIds = rows.map(r => r.id);
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
    await db.close();
  }
}

main().catch(err => {
  error(`Fatal: ${err.message}`);
  process.exit(1);
});
