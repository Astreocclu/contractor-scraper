#!/usr/bin/env node
/**
 * Test Insurance Confidence Calculation
 *
 * Collects data for a contractor and calculates insurance confidence score.
 *
 * Usage:
 *   node test_insurance_confidence.js --name "Orange Elephant Roofing" --city "Dallas"
 */

const db = require('../services/db_pg');
const { CollectionService, calculateInsuranceConfidence } = require('../services/collection_service');

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
  const name = getArg('name') || 'Orange Elephant Roofing';
  const city = getArg('city') || 'Dallas';
  const state = getArg('state') || 'TX';
  const dryRun = getArg('dry-run');

  console.log('\n' + '═'.repeat(60));
  console.log('  🔍 INSURANCE CONFIDENCE TEST');
  console.log('═'.repeat(60));

  log(`\n📋 Contractor: ${name}`);
  log(`📍 Location: ${city}, ${state}`);

  // Initialize database
  // (Postgres pool initialized on require)

  // Check if contractor exists or create
  let contractorId;
  const result = db.exec(`
    SELECT id, business_name FROM contractors_contractor
    WHERE LOWER(business_name) LIKE LOWER(?)
  `, [`%${name}%`]);
  const rows = await db.exec(`
    SELECT id, business_name FROM contractors_contractor
    WHERE LOWER(business_name) LIKE LOWER(?)
  `, [`%${name}%`]);

  if (rows.length > 0) {
    contractorId = rows[0].id;
    log(`\n✓ Found existing contractor ID: ${contractorId}`);
  } else {
    // Create new contractor with all required fields
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').trim();
    const inserted = await db.insert(`
      INSERT INTO contractors_contractor (
        business_name, slug, address, city, state, zip_code, phone, website,
        google_review_count, google_reviews_json, yelp_review_count,
        bbb_accredited, bbb_complaint_count,
        trust_score, passes_threshold, verification_score, reputation_score,
        credibility_score, red_flag_score, bonus_score, admin_override_reason,
        ai_summary, ai_sentiment_score, ai_red_flags,
        is_claimed, is_active, first_scraped_at, tier
      )
      VALUES (?, ?, '', ?, ?, '', '', '', 0, '[]', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '', '', 0, '[]', 0, 1, NOW(), 'standard')
    `, [name, slug, city, state]);

    contractorId = inserted.id;
    log(`\n+ Created new contractor ID: ${contractorId}`);
  }

  const contractor = { id: contractorId, name, city, state, website: null, zip: null };

  // Initialize collection service
  const collectionService = new CollectionService(db);
  await collectionService.init();

  try {
    // Run collection
    log('\n📥 Running data collection...');
    const results = await collectionService.runInitialCollection(contractorId, contractor);

    const successCount = results.filter(r => r.status === 'success').length;
    success(`\n✓ Collected ${successCount} / ${results.length} sources`);

    // Get all collected data from database
    // Get all collected data from database
    const rawDataRows = await db.exec(`
      SELECT source_name, raw_text, structured_data, fetch_status
      FROM contractor_raw_data
      WHERE contractor_id = ?
      `, [contractorId]);

    // Format data for insurance confidence calculation
    const collectedData = [];
    if (rawDataRows.length > 0) {
      for (const row of rawDataRows) {
        collectedData.push({
          source_name: row.source_name,
          raw_text: row.raw_text,
          structured_data: row.structured_data,
          fetch_status: row.fetch_status
        });
      }
    }

    // Calculate insurance confidence
    console.log('\n' + '═'.repeat(60));
    console.log('  🛡️  INSURANCE CONFIDENCE');
    console.log('═'.repeat(60));

    const insuranceResult = calculateInsuranceConfidence(collectedData);

    const levelColor = insuranceResult.level === 'HIGH' ? '\x1b[32m' :
      insuranceResult.level === 'MEDIUM' ? '\x1b[33m' : '\x1b[31m';

    console.log(`\n  Score: ${levelColor}${insuranceResult.score} / ${insuranceResult.max}\x1b[0m`);
    console.log(`  Level: ${levelColor}${insuranceResult.level}\x1b[0m`);

    if (insuranceResult.signals.length) {
      console.log('\n  Signals detected:');
      for (const signal of insuranceResult.signals) {
        console.log(`    ✓ ${signal}`);
      }
    } else {
      console.log('\n  No insurance signals detected');
    }

    if (insuranceResult.note) {
      warn(`\n  ⚠️  ${insuranceResult.note}`);
    }

    // Show source coverage summary
    console.log('\n' + '─'.repeat(60));
    console.log('  SOURCE COVERAGE');
    console.log('─'.repeat(60));

    const statusCounts = {};
    for (const d of collectedData) {
      statusCounts[d.fetch_status] = (statusCounts[d.fetch_status] || 0) + 1;
    }

    console.log(`  Total sources: ${collectedData.length}`);
    console.log(`  Successful: ${statusCounts.success || 0}`);
    console.log(`  Not found: ${statusCounts.not_found || 0}`);
    console.log(`  Errors: ${statusCounts.error || 0}`);

    // Key sources for insurance
    console.log('\n  Insurance-relevant sources:');
    const keySources = ['bbb', 'tdlr', 'permits', 'tx_sos', 'website'];
    for (const src of keySources) {
      const data = collectedData.find(d => d.source_name === src);
      if (data) {
        const statusIcon = data.fetch_status === 'success' ? '✓' :
          data.fetch_status === 'not_found' ? '○' : '✗';
        console.log(`    ${statusIcon} ${src}: ${data.fetch_status}`);
      } else {
        console.log(`    - ${src}: not collected`);
      }
    }

    // Save database
    if (!dryRun) {
      success('\n✅ Database saved');
    } else {
      warn('\n⚠️  DRY RUN - not saved');
    }

    console.log('\n' + '═'.repeat(60) + '\n');

    return insuranceResult;

  } finally {
    await collectionService.close();
    await db.close();
  }
}

main().catch(err => {
  error(`\nFatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
