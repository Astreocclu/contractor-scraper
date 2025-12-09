const Database = require('better-sqlite3');
const { runForensicAudit } = require('./services/orchestrator');

const db = new Database('db.sqlite3');

async function runBatch() {
    // Get 10 contractors that haven't been audited yet (or just any 10)
    // We prefer ones with names so we can actually search them
    const contractors = db.prepare(`
    SELECT id, business_name, city, state 
    FROM contractors_contractor 
    WHERE business_name IS NOT NULL AND business_name != ''
    ORDER BY RANDOM() 
    LIMIT 10
  `).all();

    console.log(`Starting validation batch for ${contractors.length} contractors...`);

    for (const c of contractors) {
        console.log(`\n--------------------------------------------------`);
        console.log(`Auditing: ${c.business_name} (ID: ${c.id})`);
        try {
            // Run with collection enabled (force refresh if needed, but orchestrator handles it)
            // We'll pass { skipCollection: false } explicitly
            await runForensicAudit({ id: c.id }, { skipCollection: false, dryRun: false });
        } catch (e) {
            console.error(`Error auditing ${c.id}:`, e.message);
        }
    }
}

runBatch().catch(console.error);
