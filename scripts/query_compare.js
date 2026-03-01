#!/usr/bin/env node
// Temporary script: fetch core comparison fields for two contractors
// Usage: node scripts/query_compare.js 8684 8667

const path = require('path');
const fs = require('fs');

// Load .env into process.env
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

const db = require('../services/db_pg');

async function main() {
  const [a, b] = process.argv.slice(2);
  if (!a || !b) {
    console.error('Usage: node scripts/query_compare.js <idA> <idB>');
    process.exit(1);
  }
  const ids = [parseInt(a, 10), parseInt(b, 10)];
  try {
    const rows = await db.exec(
      `SELECT id, business_name, city, state,
              trust_score, verification_score, reputation_score, credibility_score, red_flag_score,
              google_review_count, google_rating,
              bbb_accredited, bbb_complaint_count,
              is_active
         FROM contractors_contractor
        WHERE id = $1 OR id = $2`,
      ids
    );

    // Pull latest audit record if exists
    const audits = await db.exec(
      `SELECT contractor_id, trust_score, recommendation, risk_level, created_at
         FROM audit_records
        WHERE contractor_id = $1 OR contractor_id = $2
        ORDER BY created_at DESC`,
      ids
    );

    const latestAuditById = {};
    for (const rec of audits) {
      if (!latestAuditById[rec.contractor_id]) latestAuditById[rec.contractor_id] = rec;
    }

    const out = rows.map(r => ({
      id: r.id,
      name: r.business_name,
      city: r.city,
      state: r.state,
      trust_score: r.trust_score,
      verification_score: r.verification_score,
      reputation_score: r.reputation_score,
      credibility_score: r.credibility_score,
      red_flag_score: r.red_flag_score,
      google_review_count: r.google_review_count,
      google_rating: r.google_rating,
      bbb_accredited: r.bbb_accredited,
      bbb_complaint_count: r.bbb_complaint_count,
      is_active: r.is_active,
      latest_audit: latestAuditById[r.id] || null
    }));

    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('ERR', e.message);
    process.exit(2);
  } finally {
    await db.close();
  }
}

main();

