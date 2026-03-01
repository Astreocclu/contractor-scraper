#!/usr/bin/env node
/**
 * Generate snapshots for specific contractors
 */
const fs = require('fs');
const path = require('path');
const db = require(path.join(__dirname, '..', 'services', 'db_pg'));

async function generateSnapshot(contractorId) {
  try {
    const rows = await db.exec(
      'SELECT * FROM contractors_contractor WHERE id = $1',
      [contractorId]
    );

    if (rows.length === 0) {
      console.error(`Contractor ${contractorId} not found`);
      return null;
    }

    const dbContractor = rows[0];

    // Get raw data
    const rawData = await db.exec(
      `SELECT source_name, raw_text, structured_data, fetch_status, fetched_at
       FROM contractor_raw_data WHERE contractor_id = $1`,
      [contractorId]
    );

    if (rawData.length === 0) {
      console.error(`No raw data for contractor ${contractorId}`);
      return null;
    }

    const snapshot = {
      contractor_id: contractorId,
      business_name: dbContractor.business_name,
      city: dbContractor.city,
      state: dbContractor.state,
      verticals: dbContractor.verticals || [],
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

    const snapshotFile = `/tmp/snap_${contractorId}.json`;
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
    console.log(`✓ Generated ${snapshotFile}`);

    return snapshot;
  } catch (err) {
    console.error(`Error generating snapshot for ${contractorId}:`, err.message);
    return null;
  }
}

async function main() {
  const ids = process.argv.slice(2).map(n => parseInt(n));

  if (ids.length === 0) {
    console.error('Usage: node generate_snapshots.js <id1> [id2] ...');
    process.exit(1);
  }

  for (const id of ids) {
    await generateSnapshot(id);
  }

  process.exit(0);
}

main();
