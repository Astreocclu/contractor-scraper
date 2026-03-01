#!/usr/bin/env node
const fs = require('fs');
const { Client } = require('pg');

async function main() {
  const a = JSON.parse(fs.readFileSync('./experiments/hybrid_100/config/sample_100.json', 'utf-8'));
  const b = JSON.parse(fs.readFileSync('./experiments/hybrid_100_B/config/sample_100_group_B.json', 'utf-8'));
  const c = JSON.parse(fs.readFileSync('./experiments/hybrid_100_C/config/sample_100_group_C.json', 'utf-8'));
  const usedIds = new Set([
    ...a.contractors.map(x => x.contractor_id || x.id),
    ...b.contractors.map(x => x.contractor_id || x.id),
    ...c.contractors.map(x => x.contractor_id || x.id)
  ]);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const res = await client.query(
    "SELECT id, business_name, city FROM contractors WHERE verticals @> $1::jsonb",
    [JSON.stringify(["pool"])]
  );

  const allPool = res.rows;
  const remaining = allPool.filter(r => !usedIds.has(r.id));

  console.log('Total pool contractors in DB:', allPool.length);
  console.log('Already sampled (A+B+C):', usedIds.size);
  console.log('Remaining unsampled:', remaining.length);

  if (remaining.length >= 100) {
    console.log('\nEnough for Batch D!');
  } else {
    console.log('\nNOT enough for a full 100-batch. Only', remaining.length, 'left.');
  }

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
