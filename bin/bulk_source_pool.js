#!/usr/bin/env node
/**
 * bulk_source_pool.js - Source all unsourced pool contractors independently of audit
 *
 * Runs initial collection for pool contractors missing critical sources.
 * Designed to run as a long-lived background process (hours/days).
 *
 * Usage:
 *   node bin/bulk_source_pool.js [--limit=N] [--skip-fully-sourced] [--dry-run]
 *
 * Options:
 *   --limit=N              Max contractors to process (default: unlimited)
 *   --skip-fully-sourced   Skip contractors that already pass the 5-source gate (default: true)
 *   --dry-run              Just show what would be sourced, don't actually run
 *   --resume               Resume from where we left off (skip already-sourced)
 *   --shuffle              Randomize order (default: sequential by ID)
 *
 * Critical sources checked: google_presence, bbb, court_records, county_liens, tx_franchise
 *
 * Progress is logged to logs/bulk_source_YYYY-MM-DDTHH-MM-SS.jsonl
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db_pg');
const { CollectionService, isSourceFundingError } = require('../services/collection_service');

const args = process.argv.slice(2);
function getArg(name) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : null;
}
const hasFlag = name => args.includes(`--${name}`);

const limit = getArg('limit') ? parseInt(getArg('limit'), 10) : Infinity;
const dryRun = hasFlag('dry-run');
const shuffle = hasFlag('shuffle');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = path.join(LOG_DIR, `bulk_source_${ts}.jsonl`);
const logStream = dryRun ? null : fs.createWriteStream(logPath, { flags: 'a' });

function logEvent(obj) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...obj });
  if (logStream) logStream.write(line + '\n');
  console.log(line);
}

async function getUnsourcedPoolContractors() {
  // Get all pool contractors
  const all = await db.exec(`
    SELECT id, business_name, city, state, website, zip_code
    FROM contractors_contractor
    WHERE category = 'Pool'
    ORDER BY id
  `);

  // Check which ones pass the 5-source gate
  const ids = all.map(r => r.id);
  const sourced = await db.exec(`
    SELECT contractor_id,
      MAX(CASE WHEN source_name IN ('google_maps','google_maps_hq','google_maps_local')
               AND fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) as has_google,
      MAX(CASE WHEN source_name = 'bbb' AND fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) as has_bbb,
      MAX(CASE WHEN source_name = 'court_records' AND fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) as has_court,
      MAX(CASE WHEN source_name = 'county_liens' AND fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) as has_liens,
      MAX(CASE WHEN source_name = 'tx_franchise' AND fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) as has_tx
    FROM contractor_raw_data
    WHERE contractor_id = ANY($1::int[])
    GROUP BY contractor_id
  `, [ids]);

  const gateMap = new Map();
  for (const r of sourced) {
    const passes = r.has_google > 0 && r.has_bbb > 0 && r.has_court > 0 && r.has_liens > 0 && r.has_tx > 0;
    gateMap.set(r.contractor_id, passes);
  }

  // Filter to unsourced only
  const unsourced = all.filter(r => !gateMap.get(r.id));

  return unsourced;
}

async function main() {
  console.log('=== Bulk Pool Contractor Sourcing ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Limit: ${limit === Infinity ? 'unlimited' : limit}`);

  const unsourced = await getUnsourcedPoolContractors();
  console.log(`Pool contractors needing sourcing: ${unsourced.length}`);

  if (shuffle) {
    for (let i = unsourced.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unsourced[i], unsourced[j]] = [unsourced[j], unsourced[i]];
    }
  }

  const toProcess = unsourced.slice(0, Math.min(limit, unsourced.length));
  console.log(`Will process: ${toProcess.length} contractors`);

  if (dryRun) {
    for (const c of toProcess.slice(0, 20)) {
      console.log(`  Would source: ${c.business_name} (ID ${c.id}) - ${c.city}, ${c.state}`);
    }
    if (toProcess.length > 20) console.log(`  ... and ${toProcess.length - 20} more`);
    await db.close();
    return;
  }

  logEvent({
    event: 'start',
    total: toProcess.length,
    mode: 'live',
    shuffle
  });

  let success = 0;
  let errors = 0;
  let skipped = 0;
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i++) {
    const row = toProcess[i];
    const contractor = {
      id: row.id,
      name: row.business_name,
      city: row.city,
      state: row.state,
      website: row.website,
      zip: row.zip_code
    };

    const pct = ((i / toProcess.length) * 100).toFixed(1);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = i > 0 ? (elapsed / i) : 0;
    const eta = i > 0 ? Math.round(rate * (toProcess.length - i) / 60) : '?';
    console.log(`\n[${i + 1}/${toProcess.length}] (${pct}%) ETA: ${eta}min | ${contractor.name} (ID ${contractor.id}) - ${contractor.city}`);

    const collectionService = new CollectionService(db);
    try {
      await collectionService.init();
      const sourceResults = await collectionService.runInitialCollection(contractor.id, contractor);
      const successCount = sourceResults.filter(r => r.status === 'success').length;
      const statusCounts = sourceResults.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {});

      logEvent({
        event: 'sourced',
        contractor_id: contractor.id,
        name: contractor.name,
        city: contractor.city,
        success_count: successCount,
        total_sources: sourceResults.length,
        statuses: statusCounts
      });

      success++;
      console.log(`  ✅ ${successCount}/${sourceResults.length} sources collected`);
    } catch (err) {
      if (isSourceFundingError(err)) {
        logEvent({ event: 'funding_error', contractor_id: contractor.id, error: err.message });
        console.error('🛑 FUNDING ERROR - stopping to prevent charges');
        break;
      }

      logEvent({
        event: 'error',
        contractor_id: contractor.id,
        name: contractor.name,
        error: err.message
      });
      errors++;
      console.log(`  ❌ Error: ${err.message}`);
    } finally {
      await collectionService.close();
    }
  }

  const totalElapsed = Math.round((Date.now() - startTime) / 1000);
  const summary = {
    event: 'complete',
    total_processed: success + errors,
    success,
    errors,
    skipped,
    elapsed_seconds: totalElapsed,
    avg_seconds_per_contractor: success > 0 ? Math.round(totalElapsed / (success + errors)) : 0
  };
  logEvent(summary);

  console.log('\n' + '═'.repeat(60));
  console.log('  BULK SOURCING COMPLETE');
  console.log('═'.repeat(60));
  console.log(`  Processed: ${success + errors}`);
  console.log(`  Success: ${success}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Time: ${Math.round(totalElapsed / 60)} min`);
  console.log(`  Avg: ${summary.avg_seconds_per_contractor}s per contractor`);
  console.log(`  Log: ${logPath}`);
  console.log('═'.repeat(60));

  await db.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
