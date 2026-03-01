#!/usr/bin/env node
/**
 * Sample 100 contractors with existing raw data and write config.
 *
 * Usage:
 *   node bin/hybrid_100_sample.js [--vertical=pool] [--exclude=path.json] [--output=path.json] [--group=B]
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db_pg');

async function main() {
  // Parse CLI args
  const verticalArg = process.argv.find(a => a.startsWith('--vertical='));
  const excludeArg = process.argv.find(a => a.startsWith('--exclude='));
  const outputArg = process.argv.find(a => a.startsWith('--output='));
  const groupArg = process.argv.find(a => a.startsWith('--group='));

  const vertical = verticalArg ? verticalArg.split('=')[1] : 'pool';
  const group = groupArg ? groupArg.split('=')[1] : 'A';
  const experimentDir = group === 'A' ? 'hybrid_100' : `hybrid_100_${group}`;
  const baseDir = path.join(__dirname, '..', 'experiments', experimentDir);
  const outputPath = outputArg
    ? outputArg.split('=')[1]
    : (group === 'A'
      ? path.join(baseDir, 'config', 'sample_100.json')
      : path.join(baseDir, 'config', `sample_100_group_${group}.json`));

  // Load exclusion list if provided
  let excludeIds = new Set();
  if (excludeArg) {
    const excludePath = excludeArg.split('=')[1];
    if (fs.existsSync(excludePath)) {
      const excludeData = JSON.parse(fs.readFileSync(excludePath, 'utf-8'));
      const contractors = excludeData.contractors || excludeData;
      for (const c of contractors) {
        excludeIds.add(c.id || c.contractor_id);
      }
      console.log(`Excluding ${excludeIds.size} contractors from ${excludePath}`);
    }
  }

  // Get more than needed to filter out exclusions
  const limit = 100 + excludeIds.size + 50;
  const rows = await db.exec(`
    SELECT c.id, c.business_name, c.city, c.state
    FROM contractors_contractor c
    WHERE c.is_active = true
      AND EXISTS (
        SELECT 1 FROM contractors_contractor_verticals cv
        JOIN contractors_vertical v ON cv.vertical_id = v.id
        WHERE cv.contractor_id = c.id AND v.slug = $1
      )
      AND EXISTS (
        SELECT 1 FROM contractor_raw_data r
        WHERE r.contractor_id = c.id
      )
    ORDER BY random()
    LIMIT $2
  `, [vertical, limit]);

  // Filter out excluded IDs
  const filtered = rows.filter(r => !excludeIds.has(r.id)).slice(0, 100);
  console.log(`Sampling 100 ${vertical} contractors for Group ${group}...`);
  console.log(`  Available: ${rows.length}, After exclusions: ${filtered.length}`);

  if (filtered.length === 0) {
    throw new Error('No contractors found with raw data after exclusions');
  }

  if (filtered.length < 100) {
    console.warn(`Warning: Only ${filtered.length} contractors available (need 100)`);
  }

  const contractors = [];

  for (const row of filtered) {
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
    group,
    contractors,
    settings: {
      seed: 42,
      vertical,
      excluded_from: excludeArg ? excludeArg.split('=')[1] : null,
      note: `Random sample of ${contractors.length} ${vertical} contractors for Group ${group}`
    }
  };

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
  console.log(`Saved sample config to ${outputPath}`);

  await db.close();
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
