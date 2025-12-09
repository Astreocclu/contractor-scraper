const Database = require('better-sqlite3');
const db = new Database('db.sqlite3');

try {
    console.log('--- Latest AI Reasoning Traces ---');
    const audits = db.prepare(`
    SELECT 
        cc.business_name, 
        ar.trust_score, 
        ar.risk_level, 
        ar.reasoning_trace,
        ar.recommendation
    FROM audit_records ar
    JOIN contractors_contractor cc ON ar.contractor_id = cc.id
    ORDER BY ar.finalized_at DESC
    LIMIT 3
  `).all();

    audits.forEach(a => {
        console.log(`\n=== ${a.business_name} (${a.trust_score}/100) ===`);
        console.log(`Risk: ${a.risk_level} | Rec: ${a.recommendation}`);
        // Extract the last chunk of reasoning (usually the conclusion)
        const thinking = a.reasoning_trace || '';
        // Only show the first 1000 chars of the thought process
        console.log(`Reasoning Extract:\n${thinking.substring(0, 1000)}...`);
    });

} catch (e) {
    console.error(e);
}
