#!/usr/bin/env node
/**
 * Snapshot existing raw data for the 300-sample hybrid run.
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db_pg');

const BASE_DIR = path.join(__dirname, '..', 'experiments', 'hybrid_300');
const CONFIG_PATH = path.join(BASE_DIR, 'config', 'sample_300.json');
const SNAPSHOT_DIR = path.join(BASE_DIR, 'data', 'snapshots');

async function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  const contractors = config.contractors || [];

  if (!contractors.length) {
    throw new Error('No contractors in sample config');
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const snapshotPath = path.join(SNAPSHOT_DIR, dateStr);
  if (!fs.existsSync(snapshotPath)) {
    fs.mkdirSync(snapshotPath, { recursive: true });
  }

  const results = [];

  for (const contractor of contractors) {
    try {
      const rows = await db.exec(
        'SELECT * FROM contractors_contractor WHERE id = $1',
        [contractor.id]
      );

      if (rows.length === 0) {
        results.push({ id: contractor.id, name: contractor.name, status: 'NOT_FOUND' });
        continue;
      }

      const dbContractor = rows[0];
      const rawData = await db.exec(
        `SELECT source_name, raw_text, structured_data, fetch_status, fetched_at
         FROM contractor_raw_data WHERE contractor_id = $1`,
        [contractor.id]
      );

      if (rawData.length === 0) {
        results.push({ id: contractor.id, name: contractor.name, status: 'NO_DATA' });
        continue;
      }

      const snapshot = {
        contractor_id: contractor.id,
        business_name: dbContractor.business_name,
        city: dbContractor.city,
        state: dbContractor.state,
        verticals: contractor.verticals || [],
        archetype: contractor.archetype || 'unknown',
        expected_score: contractor.expected || null,
        snapshot_at: new Date().toISOString(),
        sources: {}
      };

      for (const row of rawData) {
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

      const safeName = contractor.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const snapshotFile = path.join(snapshotPath, `${contractor.id}_${safeName}.json`);
      fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));

      results.push({ id: contractor.id, name: contractor.name, status: 'OK', sources: Object.keys(snapshot.sources).length });
    } catch (err) {
      results.push({ id: contractor.id, name: contractor.name, status: 'ERROR', error: err.message });
    }
  }

  const okCount = results.filter(r => r.status === 'OK').length;
  const noDataCount = results.filter(r => r.status === 'NO_DATA').length;
  const errorCount = results.filter(r => r.status === 'ERROR' || r.status === 'NOT_FOUND').length;

  const summaryFile = path.join(snapshotPath, '_summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify({
    snapshot_date: dateStr,
    contractors: results,
    totals: { ok: okCount, no_data: noDataCount, errors: errorCount }
  }, null, 2));

  console.log(`Snapshot complete: OK=${okCount}, NO_DATA=${noDataCount}, ERRORS=${errorCount}`);
  console.log(`Summary: ${summaryFile}`);

  await db.close();

  if (okCount < contractors.length) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
