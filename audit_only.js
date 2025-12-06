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

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { AuditAgentV2 } = require('./services/audit_agent_v2');

const DB_PATH = path.join(__dirname, 'db.sqlite3');

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
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Get contractor
  const result = db.exec(`
    SELECT id, business_name, city, state, website
    FROM contractors_contractor WHERE id = ?
  `, [contractorId]);

  if (!result.length || !result[0].values.length) {
    error(`Contractor ID ${contractorId} not found`);
    process.exit(1);
  }

  const row = result[0].values[0];
  const contractor = {
    id: row[0],
    name: row[1],
    city: row[2],
    state: row[3],
    website: row[4]
  };

  log(`\n📋 Contractor: ${contractor.name}`);
  log(`📍 Location: ${contractor.city}, ${contractor.state}`);

  // Check for collected data
  const dataCheck = db.exec(`
    SELECT COUNT(*) FROM contractor_raw_data WHERE contractor_id = ?
  `, [contractorId]);

  const sourceCount = dataCheck[0]?.values[0][0] || 0;

  if (sourceCount === 0) {
    error(`\nNo collected data found for this contractor.`);
    error(`Run collection first: node batch_collect.js --id ${contractorId}`);
    process.exit(1);
  }

  log(`📦 Found ${sourceCount} collected sources`);

  // Setup browser for investigate tool
  let browser = null;

  const searchFn = async (query) => {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox']
      });
    }

    const page = await browser.newPage();
    try {
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
        waitUntil: 'networkidle2',
        timeout: 15000
      });

      const results = await page.evaluate(() => {
        const items = document.querySelectorAll('#search .g');
        return Array.from(items).slice(0, 5).map(item => {
          const title = item.querySelector('h3')?.innerText || '';
          const snippet = item.querySelector('.VwiC3b')?.innerText || '';
          return `${title}\n${snippet}`;
        }).join('\n\n---\n\n');
      });

      return { results: results.substring(0, 2000), status: 'success' };
    } catch (err) {
      return { error: err.message, status: 'error' };
    } finally {
      await page.close();
    }
  };

  try {
    // Run audit
    const agent = new AuditAgentV2(db, contractorId, contractor);
    const auditResult = await agent.run(searchFn);

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
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
      success('\n✅ Saved to database');
    } else {
      warn('\n⚠️  DRY RUN - not saved');
    }

    console.log('═'.repeat(60) + '\n');

  } finally {
    if (browser) await browser.close();
    db.close();
  }
}

main().catch(err => {
  error(`Fatal: ${err.message}`);
  process.exit(1);
});
