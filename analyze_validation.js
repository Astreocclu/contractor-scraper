const Database = require('better-sqlite3');
const db = new Database('db.sqlite3');

try {
    // 1. Check Yelp configuration (handled by manual inspection of file, but let's check data type in DB)
    const yelpData = db.prepare("SELECT source_url, raw_text FROM contractor_raw_data WHERE source_name = 'yelp' ORDER BY fetched_at DESC LIMIT 1").get();
    console.log('--- Yelp Data Check ---');
    if (yelpData) {
        console.log('Latest Yelp URL:', yelpData.source_url);
        console.log('Is Serper:', yelpData.source_url === 'serper_api');
    } else {
        console.log('No recent Yelp data found.');
    }

    // 2. Analyze the recent validation batch (last 10 audits)
    console.log('\n--- Recent Validation Audits ---');
    const recentAudits = db.prepare(`
    SELECT 
        ar.contractor_id, 
        cc.business_name, 
        ar.trust_score, 
        ar.risk_level, 
        ar.sources_used,
        ar.finalized_at
    FROM audit_records ar
    JOIN contractors_contractor cc ON ar.contractor_id = cc.id
    ORDER BY ar.finalized_at DESC
    LIMIT 10
  `).all();

    recentAudits.forEach(audit => {
        console.log(`\n[${audit.business_name}] Score: ${audit.trust_score} (${audit.risk_level})`);
        const sources = JSON.parse(audit.sources_used || '[]');

        // Check for new sources
        const newSources = ['dallas_court', 'tarrant_court', 'osha', 'epa_echo', 'tx_sos_search'];
        const foundNew = sources.filter(s => newSources.includes(s));
        console.log(`  New Sources Active: ${foundNew.join(', ') || 'None'}`);

        // Check if they actually have content (via raw_data)
        const data = db.prepare(`SELECT source_name, fetch_status FROM contractor_raw_data WHERE contractor_id = ? AND source_name IN ('${newSources.join("','")}')`).all(audit.contractor_id);
        const successes = data.filter(d => d.fetch_status === 'success').map(d => d.source_name);
        console.log(`  New Sources Valid (Success): ${successes.join(', ') || 'None'}`);
    });

    // 3. Check for Serper API usage in raw data specifically
    const serperUsage = db.prepare("SELECT count(*) as count FROM contractor_raw_data WHERE source_url = 'serper_api'").get();
    console.log(`\nTotal Serper API Records in DB: ${serperUsage.count}`);

} catch (e) {
    console.error(e);
}
