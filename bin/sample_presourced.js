#!/usr/bin/env node
/**
 * sample_presourced.js - Sample N contractors that are already fully sourced but not yet audited
 *
 * Usage:
 *   node bin/sample_presourced.js --group=J [--count=100] [--vertical=pool]
 *
 * This creates the experiment directory and config file for the progressive pipeline.
 * Only samples contractors that PASS the 5-source gate and have NOT been in any previous batch.
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db_pg');

const args = process.argv.slice(2);
function getArg(name) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : null;
}

const group = getArg('group');
const count = parseInt(getArg('count') || '100', 10);
const vertical = getArg('vertical') || 'pool';

if (!group) {
  console.log('Usage: node bin/sample_presourced.js --group=J [--count=100] [--vertical=pool]');
  process.exit(1);
}

async function getExcludedIds() {
  const expDir = path.join(__dirname, '..', 'experiments');
  const excludeIds = new Set();

  // Scan all hybrid_100_* directories for sample configs
  const dirs = fs.readdirSync(expDir).filter(d => d.startsWith('hybrid_100'));
  for (const dir of dirs) {
    const configDir = path.join(expDir, dir, 'config');
    if (!fs.existsSync(configDir)) continue;

    const files = fs.readdirSync(configDir).filter(f => f.startsWith('sample_') && f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(configDir, file), 'utf8'));
        const contractors = data.contractors || (Array.isArray(data) ? data : []);
        for (const c of contractors) {
          const id = c.contractor_id || c.id;
          if (id) excludeIds.add(id);
        }
      } catch (e) {
        // Skip unparseable files
      }
    }
  }

  return excludeIds;
}

async function main() {
  console.log(`=== Sample Pre-Sourced Contractors ===`);
  console.log(`Group: ${group} | Count: ${count} | Vertical: ${vertical}`);

  const excludeIds = await getExcludedIds();
  console.log(`Excluding ${excludeIds.size} contractors from previous batches`);

  // Category mapping
  const categoryMap = {
    pool: 'Pool',
    // Add more as needed
  };
  const category = categoryMap[vertical] || vertical;

  // Find contractors that pass the 5-source gate and aren't excluded
  const candidates = await db.exec(`
    WITH gate_check AS (
      SELECT
        crd.contractor_id,
        MAX(CASE WHEN crd.source_name IN ('google_maps','google_maps_hq','google_maps_local')
                 AND crd.fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) as has_google,
        MAX(CASE WHEN crd.source_name = 'bbb' AND crd.fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) as has_bbb,
        MAX(CASE WHEN crd.source_name = 'court_records' AND crd.fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) as has_court,
        MAX(CASE WHEN crd.source_name = 'county_liens' AND crd.fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) as has_liens,
        MAX(CASE WHEN crd.source_name = 'tx_franchise' AND crd.fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) as has_tx
      FROM contractor_raw_data crd
      JOIN contractors_contractor cc ON cc.id = crd.contractor_id
      WHERE cc.category = $1
      GROUP BY crd.contractor_id
      HAVING
        MAX(CASE WHEN crd.source_name IN ('google_maps','google_maps_hq','google_maps_local')
                 AND crd.fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) > 0
        AND MAX(CASE WHEN crd.source_name = 'bbb' AND crd.fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) > 0
        AND MAX(CASE WHEN crd.source_name = 'court_records' AND crd.fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) > 0
        AND MAX(CASE WHEN crd.source_name = 'county_liens' AND crd.fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) > 0
        AND MAX(CASE WHEN crd.source_name = 'tx_franchise' AND crd.fetch_status IN ('success','not_found') THEN 1 ELSE 0 END) > 0
    )
    SELECT cc.id as contractor_id, cc.business_name, cc.city, cc.state
    FROM gate_check gc
    JOIN contractors_contractor cc ON cc.id = gc.contractor_id
    ORDER BY random()
  `, [category]);

  // Filter out excluded IDs
  const available = candidates.filter(c => !excludeIds.has(c.contractor_id));
  console.log(`Gate-passing & not-yet-audited: ${available.length}`);

  if (available.length === 0) {
    console.log('❌ No pre-sourced contractors available. Run bulk_source_pool.js first.');
    await db.close();
    process.exit(1);
  }

  const sampled = available.slice(0, Math.min(count, available.length));
  console.log(`Sampled: ${sampled.length}`);

  // Create experiment directory
  const experimentName = group === 'A' ? 'hybrid_100' : `hybrid_100_${group}`;
  const expDir = path.join(__dirname, '..', 'experiments', experimentName, 'config');
  fs.mkdirSync(expDir, { recursive: true });

  // Write sample file
  const sampleData = {
    version: '1.0',
    created: new Date().toISOString(),
    group,
    pre_sourced: true,
    contractors: sampled.map(c => ({
      contractor_id: c.contractor_id,
      id: c.contractor_id,
      business_name: c.business_name,
      city: c.city,
      state: c.state,
      verticals: [vertical]
    }))
  };

  const sampleFile = group === 'A'
    ? 'sample_100.json'
    : `sample_100_group_${group}.json`;
  const outPath = path.join(expDir, sampleFile);
  fs.writeFileSync(outPath, JSON.stringify(sampleData, null, 2));

  // Write exclusion list
  const allExcluded = [...excludeIds, ...sampled.map(c => c.contractor_id)].sort((a, b) => a - b);
  const excludeFile = `exclude_through_${group.toLowerCase()}.json`;
  fs.writeFileSync(path.join(expDir, excludeFile), JSON.stringify(allExcluded, null, 2));

  console.log(`\n✅ Created ${outPath}`);
  console.log(`✅ Created ${path.join(expDir, excludeFile)}`);
  console.log(`\nTo audit, run:`);
  console.log(`  node bin/hybrid_100_progressive_pipeline.js --group=${group} --model=deepseek --skip-source --fresh`);
  console.log(`\n(--skip-source because these are already sourced)`);

  // Show city distribution
  const cities = {};
  for (const c of sampled) cities[c.city] = (cities[c.city] || 0) + 1;
  const top = Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('\nCity distribution:');
  for (const [city, n] of top) console.log(`  ${city}: ${n}`);

  await db.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
