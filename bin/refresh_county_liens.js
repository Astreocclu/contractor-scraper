#!/usr/bin/env node
/**
 * Refresh county lien data for specific contractors.
 *
 * Usage:
 *   node bin/refresh_county_liens.js --ids 1,2,3 [--timeout-ms 600000] [--counties dallas]
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db_pg');
const { CollectionService } = require('../services/collection_service');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_PATH = path.join(
  LOG_DIR,
  `refresh_county_liens_${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
);

function logEvent(event) {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  const entry = { ts: new Date().toISOString(), ...event };
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
}

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1];
};

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

async function fetchContractor(contractorId) {
  const rows = await db.exec(`
    SELECT id, business_name, city, state, website, zip_code
    FROM contractors_contractor WHERE id = ?
  `, [contractorId]);

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    name: row.business_name,
    city: row.city,
    state: row.state,
    website: row.website,
    zip: row.zip_code
  };
}

async function main() {
  const idsArg = getArg('ids');
  if (!idsArg) {
    console.log(`
Usage:
  node bin/refresh_county_liens.js --ids 1,2,3 [--timeout-ms 600000] [--counties dallas]
`);
    process.exit(0);
  }

  const timeoutMs = parseInt(getArg('timeout-ms') || process.env.COUNTY_LIENS_TIMEOUT_MS || '600000', 10);
  const countiesArg = getArg('counties');
  const counties = countiesArg
    ? countiesArg.split(',').map((c) => String(c || '').trim().toLowerCase()).filter(Boolean)
    : null;
  const contractorIds = idsArg.split(',').map((id) => parseInt(id, 10)).filter(Boolean);

  log(`\nRefreshing county liens for ${contractorIds.length} contractor(s)...`);
  logEvent({ event: 'start', total: contractorIds.length, timeout_ms: timeoutMs });

  const collectionService = new CollectionService(db);
  await collectionService.init();

  const results = [];
  const startTime = Date.now();

  try {
    for (const id of contractorIds) {
      const contractor = await fetchContractor(id);
      if (!contractor) {
        error(`Contractor ID ${id} not found`);
        logEvent({ event: 'not_found', contractor_id: id });
        continue;
      }

      log(`\n📋 ${contractor.name} (ID ${contractor.id})`);
      log(`   ${contractor.city}, ${contractor.state}`);

      const lienData = await collectionService.runCountyLienCollection(
        contractor.id,
        contractor,
        {
          timeoutMs,
          requestedBy: 'manual',
          reason: 'County liens refresh',
          counties
        }
      );

      results.push(lienData);
      logEvent({
        event: 'refreshed',
        contractor_id: contractor.id,
        status: lienData.status,
        error: lienData.error || null,
        total_records: lienData.structured?.total_records ?? null
      });
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const notFoundCount = results.filter(r => r.status === 'not_found').length;

    console.log('\n' + '═'.repeat(60));
    console.log('  SUMMARY');
    console.log('═'.repeat(60));
    console.log(`  Total: ${results.length}`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Not found: ${notFoundCount}`);
    console.log(`  Errors: ${errorCount}`);
    console.log(`  Time: ${elapsed}s`);
    console.log('═'.repeat(60) + '\n');

    logEvent({
      event: 'summary',
      total: results.length,
      success: successCount,
      not_found: notFoundCount,
      errors: errorCount,
      elapsed_sec: elapsed
    });
  } finally {
    await collectionService.close();
    await db.close();
  }
}

main().catch((err) => {
  error(`Fatal: ${err.message}`);
  process.exit(1);
});
