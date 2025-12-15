#!/usr/bin/env node
/**
 * Audit Runner V2 - Simplified Flow
 *
 * V2 assumes collection already happened via batch_collect.js
 * This script only runs the audit on pre-collected data.
 *
 * Usage:
 *   node run_audit_v2.js --id 29
 *   node run_audit_v2.js --id 29 --dry-run
 */

const db = require('../services/db_pg');
const puppeteer = require('puppeteer');
const { AuditAgentV2 } = require('../services/audit_agent_v2');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  if (['dry-run', 'help'].includes(name)) return true;
  return args[idx + 1];
};

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

async function main() {
  // Check API key
  if (!process.env.DEEPSEEK_API_KEY) {
    error('ERROR: DEEPSEEK_API_KEY not set');
    process.exit(1);
  }

  const contractorId = getArg('id') ? parseInt(getArg('id')) : null;
  const dryRun = getArg('dry-run');

  if (!contractorId || getArg('help')) {
    console.log(`
Audit Runner V2 - Simplified
=============================

Runs audit on PRE-COLLECTED data. Collection must happen first:
  node batch_collect.js --id 29

Usage:
  node run_audit_v2.js --id 29
  node run_audit_v2.js --id 29 --dry-run
`);
    process.exit(0);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  🔍 AUDIT V2 (Simplified)');
  console.log('═'.repeat(60));

  // Open database
  // (Postgres pool initialized on require)

  // Get contractor
  const rows = await db.exec(`
    SELECT id, business_name, city, state, website
    FROM contractors_contractor WHERE id = ?
  `, [contractorId]);

  if (rows.length === 0) {
    error(`Contractor ID ${contractorId} not found`);
    process.exit(1);
  }

  const row = rows[0];
  const contractor = {
    id: row.id,
    name: row.business_name,
    city: row.city,
    state: row.state,
    website: row.website
  };

  log(`\n📋 Contractor: ${contractor.name}`);
  log(`📍 Location: ${contractor.city}, ${contractor.state}`);

  // Check for collected data
  const dataCheck = await db.exec(`
    SELECT COUNT(*) as count FROM contractor_raw_data WHERE contractor_id = ?
  `, [contractorId]);

  const sourceCount = parseInt(dataCheck[0]?.count || 0);

  if (sourceCount === 0) {
    error(`\nNo collected data found for this contractor.`);
    error(`Run collection first: node batch_collect.js --id ${contractorId}`);
    process.exit(1);
  }

  log(`📦 Found ${sourceCount} collected sources`);

  try {
    // Run audit (no web access - pure analysis)
    const agent = new AuditAgentV2(db, contractorId, contractor);
    const auditResult = await agent.run();

    // Display results
    console.log('\n' + '═'.repeat(60));
    console.log('  AUDIT RESULTS');
    console.log('═'.repeat(60));

    const scoreColor = auditResult.trust_score >= 70 ? '\x1b[32m' :
      auditResult.trust_score >= 40 ? '\x1b[33m' : '\x1b[31m';

    console.log(`\n  Trust Score:    ${scoreColor}${auditResult.trust_score}/100\x1b[0m`);
    console.log(`  Risk Level:     ${auditResult.risk_level}`);
    console.log(`  Recommendation: ${auditResult.recommendation}`);

    console.log('\n--- REASONING ---');
    console.log(auditResult.reasoning);

    if (auditResult.red_flags?.length) {
      console.log('\n--- RED FLAGS ---');
      for (const flag of auditResult.red_flags) {
        const color = flag.severity === 'CRITICAL' || flag.severity === 'HIGH' ? '\x1b[31m' :
          flag.severity === 'MEDIUM' ? '\x1b[33m' : '\x1b[0m';
        console.log(`${color}  [${flag.severity}] ${flag.category}: ${flag.description}\x1b[0m`);
        if (flag.evidence) console.log(`    Evidence: ${flag.evidence}`);
      }
    }

    if (auditResult.positive_signals?.length) {
      console.log('\n--- POSITIVE SIGNALS ---');
      auditResult.positive_signals.forEach(s => console.log(`  ✓ ${s}`));
    }

    if (auditResult.gaps?.length) {
      console.log('\n--- DATA GAPS ---');
      auditResult.gaps.forEach(g => console.log(`  ⚠ ${g}`));
    }

    console.log('\n--- METADATA ---');
    console.log(`  Investigations: ${auditResult.investigations || 0}`);
    console.log(`  API Cost: $${(auditResult.total_cost || 0).toFixed(4)}`);

    // Save
    if (!dryRun) {
      success('\n✅ Saved to database');
    } else {
      warn('\n⚠️  DRY RUN - not saved');
    }

    console.log('═'.repeat(60) + '\n');

  } finally {
    if (browser) await browser.close();
    await db.close();
  }
}

main().catch(err => {
  error(`Fatal: ${err.message}`);
  process.exit(1);
});
