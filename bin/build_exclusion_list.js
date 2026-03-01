#!/usr/bin/env node
/**
 * Build a combined exclusion list from one or more sampled groups.
 *
 * Usage:
 *   node bin/build_exclusion_list.js
 *   node bin/build_exclusion_list.js --groups=A,B,C,D --output=experiments/hybrid_100_E/config/exclude_abcd.json
 */

const fs = require('fs');
const path = require('path');

function parseArg(name, fallback = null) {
  const match = process.argv.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : fallback;
}

function fileForGroup(group) {
  const g = String(group || '').trim().toUpperCase();
  if (!g) return null;
  if (g === 'A') return 'experiments/hybrid_100/config/sample_100.json';
  return `experiments/hybrid_100_${g}/config/sample_100_group_${g}.json`;
}

function readGroupContractors(group) {
  const configPath = fileForGroup(group);
  if (!configPath) return [];
  if (!fs.existsSync(configPath)) {
    console.warn(`Skipping group ${group}: missing ${configPath}`);
    return [];
  }

  const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const contractors = data.contractors || data;
  return contractors.map(c => ({
    id: c.id || c.contractor_id,
    name: c.name || c.business_name || null,
    group: String(group).toUpperCase()
  })).filter(c => Number.isFinite(Number(c.id)));
}

function main() {
  const groupsArg = parseArg('groups', 'A,B,C');
  const groups = groupsArg
    .split(',')
    .map(x => x.trim().toUpperCase())
    .filter(Boolean);

  const outputDefaultGroup = parseArg('target-group', 'D').toUpperCase();
  const outputArg = parseArg(
    'output',
    `experiments/hybrid_100_${outputDefaultGroup}/config/exclude_${groups.join('').toLowerCase()}.json`
  );

  const all = groups.flatMap(readGroupContractors);
  const unique = [...new Map(all.map(c => [c.id, c])).values()];

  const output = {
    created_at: new Date().toISOString(),
    groups,
    total_unique: unique.length,
    contractors: unique
  };

  const outDir = path.dirname(outputArg);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputArg, JSON.stringify(output, null, 2));

  console.log(`Groups: ${groups.join(', ')}`);
  console.log(`Unique IDs: ${unique.length}`);
  console.log(`Wrote: ${outputArg}`);
}

main();
