#!/usr/bin/env node
/**
 * Generate source coverage summary for a list of contractor IDs.
 *
 * Usage:
 *   node scripts/generate_source_coverage.js --ids-file logs/pool_100_ids_2026-02-05.txt
 *   node scripts/generate_source_coverage.js --ids-file <path> --out logs/custom_coverage.json
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db_pg');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1];
};

async function main() {
  const idsFile = getArg('ids-file') || path.join(LOG_DIR, 'pool_100_ids_2026-02-05.txt');
  const outPath = getArg('out') || path.join(
    LOG_DIR,
    `pool_100_source_coverage_${new Date().toISOString().slice(0, 10)}.json`
  );

  if (!fs.existsSync(idsFile)) {
    console.error(`IDs file not found: ${idsFile}`);
    process.exit(1);
  }

  const ids = fs.readFileSync(idsFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseInt(line, 10))
    .filter((n) => Number.isFinite(n));

  if (ids.length === 0) {
    console.error('No contractor IDs provided.');
    process.exit(1);
  }

  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.exec(
    `SELECT source_name, fetch_status, COUNT(*) as cnt
     FROM contractor_raw_data
     WHERE contractor_id IN (${placeholders})
     GROUP BY source_name, fetch_status
     ORDER BY source_name`,
    ids
  );

  const bySource = new Map();
  for (const row of rows) {
    const source = row.source_name;
    const status = row.fetch_status;
    const cnt = parseInt(row.cnt, 10) || 0;
    if (!bySource.has(source)) {
      bySource.set(source, {
        source,
        success: 0,
        not_found: 0,
        error: 0,
        other: 0,
        total: 0
      });
    }
    const entry = bySource.get(source);
    if (status === 'success') entry.success += cnt;
    else if (status === 'not_found') entry.not_found += cnt;
    else if (status === 'error') entry.error += cnt;
    else entry.other += cnt;
    entry.total += cnt;
  }

  const outputRows = Array.from(bySource.values())
    .sort((a, b) => a.source.localeCompare(b.source))
    .map((row) => ({
      source: row.source,
      success: row.success,
      not_found: row.not_found,
      error: row.error,
      total: row.total,
      success_rate_pct: row.total ? Number(((row.success / row.total) * 100).toFixed(1)) : 0,
      ...(row.other ? { other: row.other } : {})
    }));

  const payload = {
    total_ids: ids.length,
    rows: outputRows
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Saved coverage: ${outPath}`);
} 

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.close();
  });

