#!/usr/bin/env node
/**
 * Batch Full Pipeline Script
 *
 * Runs full source collection (sources + reviews) then audits
 * for a specified number of contractors, N at a time.
 *
 * Usage:
 *   node batch_full_pipeline.js --count 350 --concurrency 5
 *   node batch_full_pipeline.js --count 350 --concurrency 5 --skip-collection
 */

const db = require('./services/db_pg');
const { CollectionService } = require('./services/collection_service');
const { AuditAgentV2 } = require('./services/audit_agent_v2');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    if (idx === -1) return null;
    if (['skip-collection', 'skip-audit', 'help', 'force'].includes(name)) return true;
    return args[idx + 1];
};
const getIntArg = (name) => {
    const val = getArg(name);
    return val ? parseInt(val, 10) : null;
};

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

// Run collection for a single contractor
async function collectForContractor(collectionService, contractorId, force) {
    const rows = await db.exec(`
    SELECT id, business_name, city, state, website, zip_code
    FROM contractors_contractor WHERE id = ?
  `, [contractorId]);

    if (rows.length === 0) {
        error(`  [${contractorId}] Not found`);
        return { id: contractorId, status: 'not_found' };
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

    // Check cache freshness
    const cacheRows = await db.exec(`
    SELECT COUNT(*) as count, SUM(CASE WHEN expires_at > NOW() THEN 1 ELSE 0 END) as fresh
    FROM contractor_raw_data WHERE contractor_id = ?
  `, [contractorId]);

    const fresh = parseInt(cacheRows[0]?.fresh || 0);

    if (fresh >= 20 && !force) {
        log(`  [${contractorId}] ${contractor.name} - Cached (${fresh} sources)`);
        return { id: contractorId, status: 'cached', name: contractor.name };
    }

    try {
        const results = await collectionService.runInitialCollection(contractorId, contractor);
        const successCount = results.filter(r => r.status === 'success').length;
        success(`  [${contractorId}] ${contractor.name} - Collected ${successCount}/${results.length}`);
        return { id: contractorId, status: 'collected', name: contractor.name, sources: successCount };
    } catch (err) {
        error(`  [${contractorId}] ${contractor.name} - Error: ${err.message}`);
        return { id: contractorId, status: 'error', name: contractor.name, error: err.message };
    }
}

// Run audit for a single contractor (no web access - pure analysis)
async function auditContractor(contractorId) {
    const rows = await db.exec(`
    SELECT id, business_name, city, state, website
    FROM contractors_contractor WHERE id = ?
  `, [contractorId]);

    if (rows.length === 0) {
        error(`  [${contractorId}] Not found`);
        return { id: contractorId, status: 'not_found' };
    }

    const row = rows[0];
    const contractor = {
        id: row.id,
        name: row.business_name,
        city: row.city,
        state: row.state,
        website: row.website
    };

    // Check for collected data
    const dataCheck = await db.exec(`
    SELECT COUNT(*) as count FROM contractor_raw_data WHERE contractor_id = ?
  `, [contractorId]);

    const sourceCount = parseInt(dataCheck[0]?.count || 0);

    if (sourceCount === 0) {
        warn(`  [${contractorId}] ${contractor.name} - No data collected`);
        return { id: contractorId, status: 'no_data', name: contractor.name };
    }

    try {
        const agent = new AuditAgentV2(db, contractorId, contractor);
        const auditResult = await agent.run();

        const scoreColor = auditResult.trust_score >= 70 ? '\x1b[32m' :
            auditResult.trust_score >= 40 ? '\x1b[33m' : '\x1b[31m';

        log(`  [${contractorId}] ${contractor.name} - ${scoreColor}Score: ${auditResult.trust_score}\x1b[0m | ${auditResult.risk_level}`);

        return {
            id: contractorId,
            status: 'audited',
            name: contractor.name,
            score: auditResult.trust_score,
            risk: auditResult.risk_level
        };
    } catch (err) {
        error(`  [${contractorId}] ${contractor.name} - Audit Error: ${err.message}`);
        return { id: contractorId, status: 'error', name: contractor.name, error: err.message };
    }
}

// Run tasks in batches with concurrency
async function runInBatches(items, fn, concurrency) {
    const results = [];

    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        log(`\n--- Batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(items.length / concurrency)} (IDs: ${batch.join(', ')}) ---`);

        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);

        // Small delay between batches to avoid overwhelming resources
        if (i + concurrency < items.length) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    return results;
}

async function main() {
    const count = getIntArg('count') || 350;
    const concurrency = getIntArg('concurrency') || 5;
    const skipCollection = getArg('skip-collection');
    const skipAudit = getArg('skip-audit');
    const force = getArg('force');

    if (getArg('help')) {
        console.log(`
Batch Full Pipeline
===================

Runs full source collection then audits for contractors.

Usage:
  node batch_full_pipeline.js --count 350 --concurrency 5
  node batch_full_pipeline.js --count 350 --concurrency 5 --skip-collection
  node batch_full_pipeline.js --count 350 --concurrency 5 --skip-audit

Options:
  --count N           Number of contractors to process (default: 350)
  --concurrency N     Process N contractors at a time (default: 5)
  --skip-collection   Skip collection phase, audit only
  --skip-audit        Skip audit phase, collect only
  --force             Force re-collection even if cached
`);
        process.exit(0);
    }

    console.log('\n' + '═'.repeat(70));
    console.log('  🚀 BATCH FULL PIPELINE');
    console.log(`  Count: ${count} | Concurrency: ${concurrency}`);
    console.log('═'.repeat(70));

    const startTime = Date.now();

    // Get contractors to process
    // Priority: those without trust_score or needing refresh
    const rows = await db.exec(`
    SELECT c.id
    FROM contractors_contractor c
    WHERE c.is_active = true
    ORDER BY c.trust_score ASC NULLS FIRST, c.id ASC
    LIMIT $1
  `, [count]);

    const contractorIds = rows.map(r => r.id);
    log(`\nFound ${contractorIds.length} contractors to process\n`);

    if (contractorIds.length === 0) {
        warn('No contractors found');
        await db.close();
        return;
    }

    let collectionResults = [];
    let auditResults = [];

    // Phase 1: Collection
    if (!skipCollection) {
        console.log('\n' + '─'.repeat(70));
        console.log('  📥 PHASE 1: COLLECTION (Sources + Reviews)');
        console.log('─'.repeat(70));

        const collectionService = new CollectionService(db);
        await collectionService.init();

        try {
            collectionResults = await runInBatches(
                contractorIds,
                (id) => collectForContractor(collectionService, id, force),
                concurrency
            );
        } finally {
            await collectionService.close();
        }

        // Summary
        const collected = collectionResults.filter(r => r.status === 'collected').length;
        const cached = collectionResults.filter(r => r.status === 'cached').length;
        const errors = collectionResults.filter(r => r.status === 'error').length;

        console.log('\n' + '─'.repeat(70));
        console.log('  COLLECTION SUMMARY');
        console.log('─'.repeat(70));
        console.log(`  Collected: ${collected}`);
        console.log(`  Cached: ${cached}`);
        console.log(`  Errors: ${errors}`);
    }

    // Phase 2: Auditing
    if (!skipAudit) {
        console.log('\n' + '─'.repeat(70));
        console.log('  🔍 PHASE 2: AUDITING (no web access - pure analysis)');
        console.log('─'.repeat(70));

        auditResults = await runInBatches(
            contractorIds,
            (id) => auditContractor(id),
            concurrency
        );

        // Audit Summary
        const audited = auditResults.filter(r => r.status === 'audited').length;
        const noData = auditResults.filter(r => r.status === 'no_data').length;
        const auditErrors = auditResults.filter(r => r.status === 'error').length;

        const scores = auditResults.filter(r => r.score).map(r => r.score);
        const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

        const riskCounts = {
            LOW: auditResults.filter(r => r.risk === 'LOW').length,
            MEDIUM: auditResults.filter(r => r.risk === 'MEDIUM').length,
            HIGH: auditResults.filter(r => r.risk === 'HIGH').length,
            CRITICAL: auditResults.filter(r => r.risk === 'CRITICAL').length,
        };

        console.log('\n' + '─'.repeat(70));
        console.log('  AUDIT SUMMARY');
        console.log('─'.repeat(70));
        console.log(`  Audited: ${audited}`);
        console.log(`  No Data: ${noData}`);
        console.log(`  Errors: ${auditErrors}`);
        console.log(`  Average Score: ${avgScore}`);
        console.log(`  Risk Distribution: LOW=${riskCounts.LOW}, MEDIUM=${riskCounts.MEDIUM}, HIGH=${riskCounts.HIGH}, CRITICAL=${riskCounts.CRITICAL}`);
    }

    // Final Summary
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;

    console.log('\n' + '═'.repeat(70));
    console.log('  ✅ PIPELINE COMPLETE');
    console.log('═'.repeat(70));
    console.log(`  Total Time: ${mins}m ${secs}s`);
    console.log(`  Contractors Processed: ${contractorIds.length}`);
    console.log('═'.repeat(70) + '\n');

    await db.close();
}

main().catch(err => {
    error(`Fatal: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});
