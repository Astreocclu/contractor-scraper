#!/usr/bin/env node
/**
 * Collect and snapshot data for experiment contractors
 *
 * Snapshots EXISTING data from the database (fast).
 * Does NOT run fresh collection - uses whatever is already there.
 * Run this ONCE before experiments to ensure consistent data across all 300 runs.
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db_pg');

const SNAPSHOT_DIR = path.join(__dirname, '..', 'experiments', 'data', 'snapshots');
const CONFIG_PATH = path.join(__dirname, '..', 'experiments', 'config', 'experiment_matrix.json');

async function main() {
  console.log('='.repeat(60));
  console.log('  EXPERIMENT DATA SNAPSHOT');
  console.log('='.repeat(60));

  // Load config
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  const contractors = config.contractors;

  // Create snapshot directory with date
  const dateStr = new Date().toISOString().split('T')[0];
  const snapshotPath = path.join(SNAPSHOT_DIR, dateStr);

  if (!fs.existsSync(snapshotPath)) {
    fs.mkdirSync(snapshotPath, { recursive: true });
  }

  console.log(`\nSnapshotting data for ${contractors.length} contractors...`);
  console.log(`Snapshots will be saved to: ${snapshotPath}\n`);

  const results = [];

  for (const contractor of contractors) {
    console.log(`\n[${contractor.id}] ${contractor.name}`);
    console.log('-'.repeat(40));

    try {
      // Get contractor from DB
      const rows = await db.exec(
        'SELECT * FROM contractors_contractor WHERE id = $1',
        [contractor.id]
      );

      if (rows.length === 0) {
        console.log('  ERROR: Contractor not found in database');
        results.push({ id: contractor.id, name: contractor.name, status: 'NOT_FOUND' });
        continue;
      }

      const dbContractor = rows[0];

      // Fetch raw data from DB
      const rawData = await db.exec(
        `SELECT source_name, raw_text, structured_data, fetch_status, fetched_at
         FROM contractor_raw_data WHERE contractor_id = $1`,
        [contractor.id]
      );

      if (rawData.length === 0) {
        console.log('  WARNING: No raw data in database. Need to run collection first.');
        results.push({ id: contractor.id, name: contractor.name, status: 'NO_DATA' });
        continue;
      }

      // Build snapshot
      const snapshot = {
        contractor_id: contractor.id,
        business_name: dbContractor.business_name,
        city: dbContractor.city,
        state: dbContractor.state,
        archetype: contractor.archetype,
        expected_score: contractor.expected,
        snapshot_at: new Date().toISOString(),
        sources: {}
      };

      for (const row of rawData) {
        // structured_data may already be parsed by PG driver (jsonb type)
        let data = row.structured_data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (e) { /* keep as string */ }
        }
        snapshot.sources[row.source_name] = {
          status: row.fetch_status,
          fetched_at: row.fetched_at,
          data: data || row.raw_text
        };
      }

      // Save snapshot
      const safeName = contractor.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const snapshotFile = path.join(snapshotPath, `${contractor.id}_${safeName}.json`);
      fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));

      console.log(`  Saved: ${path.basename(snapshotFile)}`);
      console.log(`  Sources: ${Object.keys(snapshot.sources).length}`);
      console.log(`  Data keys: ${Object.keys(snapshot.sources).join(', ')}`);

      results.push({
        id: contractor.id,
        name: contractor.name,
        status: 'OK',
        sources: Object.keys(snapshot.sources).length
      });

    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      results.push({ id: contractor.id, name: contractor.name, status: 'ERROR', error: err.message });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  SNAPSHOT SUMMARY');
  console.log('='.repeat(60));

  const okCount = results.filter(r => r.status === 'OK').length;
  const noDataCount = results.filter(r => r.status === 'NO_DATA').length;
  const errorCount = results.filter(r => r.status === 'ERROR' || r.status === 'NOT_FOUND').length;

  console.log(`\n  OK:       ${okCount}/${contractors.length}`);
  console.log(`  NO_DATA:  ${noDataCount}/${contractors.length}`);
  console.log(`  ERRORS:   ${errorCount}/${contractors.length}`);

  if (noDataCount > 0) {
    console.log('\n  Contractors missing data need collection:');
    for (const r of results.filter(r => r.status === 'NO_DATA')) {
      console.log(`    - ${r.name} (ID: ${r.id})`);
    }
    console.log('\n  Run: node bin/run_audit.js --id <ID> --collect-only');
  }

  // Save summary
  const summaryFile = path.join(snapshotPath, '_summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify({
    snapshot_date: dateStr,
    contractors: results,
    totals: { ok: okCount, no_data: noDataCount, errors: errorCount }
  }, null, 2));

  console.log(`\n  Summary saved to: ${summaryFile}`);
  console.log('='.repeat(60));

  await db.close();

  // Exit with error if any contractors missing
  if (okCount < contractors.length) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
