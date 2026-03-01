#!/usr/bin/env node
/**
 * Source any contractors in a manifest that have no raw data yet,
 * then verify critical source coverage before allowing downstream steps.
 *
 * Usage:
 *   node bin/source_missing_from_manifest.js --config=path/to/sample.json
 *   node bin/source_missing_from_manifest.js --config=path/to/sample.json --verify-only
 *
 * Options:
 *   --verify-only                    Skip collection and only verify source coverage.
 *   --no-strict-sources              Do not fail process on missing critical sources.
 *   --required=a,b,c                 Override required source rules.
 *                                    Built-ins: google_presence, bbb, court_records, county_liens, tx_franchise
 *   --allow-statuses=x,y             Accepted fetch statuses (default: success,not_found)
 *   --no-collect-missing-critical    Disable automatic recollection for contractors flagged by critical source verification.
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db_pg');
const { CollectionService, isSourceFundingError } = require('../services/collection_service');

const args = process.argv.slice(2);
const configArg = args.find(a => a.startsWith('--config='));
const verifyOnly = args.includes('--verify-only');
const strictSources = !args.includes('--no-strict-sources');
const requiredArg = args.find(a => a.startsWith('--required='));
const allowStatusesArg = args.find(a => a.startsWith('--allow-statuses='));
const autoCollectMissingCritical = !args.includes('--no-collect-missing-critical');

if (!configArg) {
  console.log('Usage: node bin/source_missing_from_manifest.js --config=path/to/sample.json [--verify-only] [--no-strict-sources] [--required=a,b,c] [--allow-statuses=x,y] [--no-collect-missing-critical]');
  process.exit(1);
}

const configPath = configArg.split('=')[1];

const BUILTIN_RULES = {
  google_presence: {
    key: 'google_presence',
    description: 'At least one Google source present',
    anyOf: ['google_maps_local', 'google_maps_hq', 'google_maps_listed', 'google_maps']
  },
  bbb: {
    key: 'bbb',
    description: 'BBB source present',
    allOf: ['bbb']
  },
  court_records: {
    key: 'court_records',
    description: 'Court records source present',
    allOf: ['court_records']
  },
  county_liens: {
    key: 'county_liens',
    description: 'County liens source present',
    allOf: ['county_liens']
  },
  tx_franchise: {
    key: 'tx_franchise',
    description: 'Texas franchise source present',
    allOf: ['tx_franchise']
  }
};

const DEFAULT_REQUIRED_RULE_KEYS = [
  'google_presence',
  'bbb',
  'court_records',
  'county_liens',
  'tx_franchise'
];

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function getRequiredRules() {
  const requested = requiredArg
    ? parseCsv(requiredArg.split('=')[1])
    : DEFAULT_REQUIRED_RULE_KEYS;

  const rules = [];
  for (const key of requested) {
    if (BUILTIN_RULES[key]) {
      rules.push(BUILTIN_RULES[key]);
      continue;
    }
    rules.push({
      key,
      description: `Source ${key} present`,
      allOf: [key]
    });
  }
  return rules;
}

function makeSourceStatusMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const contractorId = Number(row.contractor_id);
    if (!map.has(contractorId)) map.set(contractorId, {});
    const bySource = map.get(contractorId);

    if (!bySource[row.source_name]) {
      bySource[row.source_name] = new Set();
    }
    bySource[row.source_name].add(row.fetch_status || 'unknown');
  }
  return map;
}

function sourceSatisfies(statusSet, allowedStatuses) {
  if (!statusSet || statusSet.size === 0) return false;
  for (const s of statusSet) {
    if (allowedStatuses.has(s)) return true;
  }
  return false;
}

function sourceSatisfiesForRule(ruleKey, statusSet, allowedStatuses) {
  // google_presence must be a live positive hit, not not_found.
  if (ruleKey === 'google_presence') {
    return sourceSatisfies(statusSet, new Set(['success']));
  }
  return sourceSatisfies(statusSet, allowedStatuses);
}

function evaluateRulesForContractor(sourceStatus, rules, allowedStatuses) {
  const failures = [];

  for (const rule of rules) {
    if (rule.anyOf && rule.anyOf.length > 0) {
      const candidates = rule.anyOf.map(sourceName => ({
        source: sourceName,
        statuses: [...(sourceStatus?.[sourceName] || [])],
        ok: sourceSatisfiesForRule(rule.key, sourceStatus?.[sourceName], allowedStatuses)
      }));
      const satisfied = candidates.some(c => c.ok);
      if (!satisfied) {
        failures.push({
          rule: rule.key,
          type: 'anyOf',
          required_any_of: rule.anyOf,
          observed: candidates
        });
      }
      continue;
    }

    if (rule.allOf && rule.allOf.length > 0) {
      const missing = [];
      for (const sourceName of rule.allOf) {
        const statuses = [...(sourceStatus?.[sourceName] || [])];
        if (!sourceSatisfiesForRule(rule.key, sourceStatus?.[sourceName], allowedStatuses)) {
          missing.push({ source: sourceName, statuses });
        }
      }
      if (missing.length > 0) {
        failures.push({
          rule: rule.key,
          type: 'allOf',
          required_all_of: rule.allOf,
          missing
        });
      }
    }
  }

  return failures;
}

async function verifySourceCoverage(contractorIds, rules, allowedStatuses) {
  const allSourceNames = new Set();
  for (const rule of rules) {
    (rule.anyOf || []).forEach(s => allSourceNames.add(s));
    (rule.allOf || []).forEach(s => allSourceNames.add(s));
  }

  const rows = await db.exec(
    `WITH ranked AS (
       SELECT
         contractor_id,
         source_name,
         fetch_status,
         fetched_at,
         ROW_NUMBER() OVER (
           PARTITION BY contractor_id, source_name
           ORDER BY fetched_at DESC NULLS LAST, id DESC
         ) AS rn
       FROM contractor_raw_data
       WHERE contractor_id = ANY($1::int[])
         AND source_name = ANY($2::text[])
     )
     SELECT contractor_id, source_name, fetch_status, fetched_at
     FROM ranked
     WHERE rn = 1`,
    [contractorIds, [...allSourceNames]]
  );

  const byContractor = makeSourceStatusMap(rows);

  const missingCritical = [];
  for (const contractorId of contractorIds) {
    const sourceStatus = byContractor.get(contractorId) || {};
    const failures = evaluateRulesForContractor(sourceStatus, rules, allowedStatuses);
    if (failures.length > 0) {
      missingCritical.push({ contractor_id: contractorId, failures });
    }
  }

  return {
    required_rules: rules,
    allowed_statuses: [...allowedStatuses],
    checked_contractors: contractorIds.length,
    contractors_missing_critical_sources: missingCritical.length,
    missing_critical: missingCritical
  };
}

async function collectForContractorIds(contractorIds, label = 'collection') {
  const startedAt = Date.now();
  const results = [];

  for (const id of contractorIds) {
    const rows = await db.exec(
      `SELECT id, business_name, city, state, website, zip_code
       FROM contractors_contractor
       WHERE id = $1`,
      [id]
    );

    if (!rows.length) {
      results.push({ id, status: 'NOT_FOUND' });
      console.log(`❌ ${id} not found`);
      continue;
    }

    const row = rows[0];
    const contractor = {
      id: row.id,
      name: row.business_name,
      city: row.city,
      state: row.state,
      website: row.website,
      zip: row.zip_code
    };

    console.log(`\n📥 [${label}] Sourcing ${contractor.name} (ID ${contractor.id})`);
    console.log(`   ${contractor.city}, ${contractor.state}`);

    let collected = false;
    let lastError = null;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const collectionService = new CollectionService(db);
      try {
        await collectionService.init();
        const sourceResults = await collectionService.runInitialCollection(contractor.id, contractor);
        const successCount = sourceResults.filter(r => r.status === 'success').length;
        const statusCounts = sourceResults.reduce((acc, r) => {
          acc[r.status] = (acc[r.status] || 0) + 1;
          return acc;
        }, {});

        results.push({
          id: contractor.id,
          name: contractor.name,
          status: 'COLLECTED',
          success_count: successCount,
          status_counts: statusCounts,
          attempts: attempt,
          label
        });

        console.log(`   ✅ Collected ${successCount}/${sourceResults.length} sources (attempt ${attempt}/${maxAttempts})`);
        collected = true;
        break;
      } catch (err) {
        if (isSourceFundingError(err)) {
          throw err;
        }
        lastError = err;
        console.log(`   ⚠️ Collection attempt / failed: `);
      } finally {
        await collectionService.close();
      }
    }

    if (!collected) {
      results.push({
        id: contractor.id,
        name: contractor.name,
        status: 'ERROR',
        error: lastError ? lastError.message : 'Unknown collection failure',
        attempts: maxAttempts,
        label
      });
      console.log(`   ❌ Collection error after ${maxAttempts} attempts: ${lastError ? lastError.message : 'Unknown'}`);
    }
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  const collected = results.filter(r => r.status === 'COLLECTED').length;
  const errors = results.filter(r => r.status === 'ERROR' || r.status === 'NOT_FOUND').length;

  return { results, elapsed_seconds: elapsed, collected, errors, total: contractorIds.length };
}

async function main() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const contractors = config.contractors || [];
  const ids = contractors.map(c => c.id).filter(Boolean);

  if (!ids.length) {
    throw new Error(`No contractors found in ${configPath}`);
  }

  const requiredRules = getRequiredRules();
  const allowedStatuses = new Set(
    allowStatusesArg
      ? parseCsv(allowStatusesArg.split('=')[1])
      : ['success', 'not_found']
  );

  console.log(`Manifest: ${configPath}`);
  console.log(`Contractors in manifest: ${ids.length}`);
  console.log(`Mode: ${verifyOnly ? 'verify-only' : 'source-then-verify'}`);
  console.log(`Strict source gate: ${strictSources ? 'ON' : 'OFF'}`);
  console.log(`Auto recollect missing-critical: ${autoCollectMissingCritical ? 'ON' : 'OFF'}`);
  console.log(`Required rules: ${requiredRules.map(r => r.key).join(', ')}`);
  console.log(`Allowed statuses: ${[...allowedStatuses].join(', ')}`);

  const rawRows = await db.exec(
    `SELECT contractor_id, COUNT(*)::int AS raw_count
     FROM contractor_raw_data
     WHERE contractor_id = ANY($1::int[])
     GROUP BY contractor_id`,
    [ids]
  );

  const rawMap = new Map(rawRows.map(r => [r.contractor_id, r.raw_count]));
  const missingRaw = ids.filter(id => !rawMap.has(id) || Number(rawMap.get(id)) === 0);

  console.log(`Already sourced (any raw): ${ids.length - missingRaw.length}`);
  console.log(`Missing raw data (any source): ${missingRaw.length}`);

  let rawCollectionSummary = {
    results: [],
    elapsed_seconds: 0,
    collected: 0,
    errors: 0,
    total: missingRaw.length,
    skipped: verifyOnly || missingRaw.length === 0
  };

  if (!verifyOnly && missingRaw.length > 0) {
    rawCollectionSummary = await collectForContractorIds(missingRaw, 'raw-missing');
  }

  const verificationInitial = await verifySourceCoverage(ids, requiredRules, allowedStatuses);

  let criticalCollectionSummary = {
    results: [],
    elapsed_seconds: 0,
    collected: 0,
    errors: 0,
    total: 0,
    skipped: true
  };

  let verificationFinal = verificationInitial;

  if (!verifyOnly && autoCollectMissingCritical && verificationInitial.contractors_missing_critical_sources > 0) {
    const criticalIds = verificationInitial.missing_critical.map(x => x.contractor_id);
    console.log(`\n🔁 Recollecting for critical-source failures: ${criticalIds.length} contractor(s)`);
    criticalCollectionSummary = await collectForContractorIds(criticalIds, 'critical-missing');
    criticalCollectionSummary.skipped = false;

    verificationFinal = await verifySourceCoverage(ids, requiredRules, allowedStatuses);
  }

  const outDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `source_missing_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

  const output = {
    config: configPath,
    total_manifest: ids.length,
    mode: verifyOnly ? 'verify-only' : 'source-then-verify',
    strict_sources: strictSources,
    auto_collect_missing_critical: autoCollectMissingCritical,
    missing_raw_initial: missingRaw.length,
    collection: {
      raw_missing: rawCollectionSummary,
      critical_missing: criticalCollectionSummary
    },
    verification_initial: verificationInitial,
    verification_final: verificationFinal
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log('\n=== Source Coverage Summary ===');
  console.log(`Initial critical failures: ${verificationInitial.contractors_missing_critical_sources}`);
  console.log(`Final critical failures: ${verificationFinal.contractors_missing_critical_sources}`);
  console.log(`Log: ${outPath}`);

  if (verificationFinal.contractors_missing_critical_sources > 0) {
    const sample = verificationFinal.missing_critical.slice(0, 10).map(x => x.contractor_id);
    console.log(`Flagged contractor IDs (sample): ${sample.join(', ')}`);
  }

  await db.close();

  if (strictSources && verificationFinal.contractors_missing_critical_sources > 0) {
    console.error('❌ Strict critical-source gate failed. Stopping pipeline.');
    process.exit(2);
  }

  console.log('✅ Source gate passed.');
}

main().catch(async err => {
  try {
    await db.close();
  } catch (_) {}
  if (isSourceFundingError(err)) {
    console.error(`❌ SOURCE FUNDING STOP: ${err.message}`);
    process.exit(3);
  }
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
