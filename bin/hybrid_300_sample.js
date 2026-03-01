#!/usr/bin/env node
/**
 * Sample 300 contractors with existing raw data and write config.
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db_pg');

const BASE_DIR = path.join(__dirname, '..', 'experiments', 'hybrid_300');
const CONFIG_PATH = path.join(BASE_DIR, 'config', 'sample_300.json');

async function main() {
  const rows = await db.exec(`
    SELECT c.id, c.business_name, c.city, c.state
    FROM contractors_contractor c
    WHERE c.is_active = true
      AND EXISTS (
        SELECT 1 FROM contractor_raw_data r
        WHERE r.contractor_id = c.id
      )
    ORDER BY random()
    LIMIT 300
  `);

  if (rows.length === 0) {
    throw new Error('No contractors found with raw data');
  }

  const contractors = [];

  for (const row of rows) {
    const verticals = await db.exec(
      `SELECT v.slug
       FROM contractors_vertical v
       JOIN contractors_contractor_verticals cv ON cv.vertical_id = v.id
       WHERE cv.contractor_id = $1`,
      [row.id]
    );

    contractors.push({
      id: row.id,
      name: row.business_name,
      city: row.city,
      state: row.state,
      archetype: 'unknown',
      expected: null,
      verticals: verticals.map(v => v.slug)
    });
  }

  const config = {
    version: '1.0',
    created: new Date().toISOString(),
    contractors,
    settings: {
      seed: 42,
      note: 'Random sample of 300 contractors with existing raw data'
    }
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`Saved sample config to ${CONFIG_PATH}`);

  await db.close();
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
