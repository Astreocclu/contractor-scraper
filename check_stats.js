const Database = require('better-sqlite3');
const db = new Database('db.sqlite3');

try {
    const total = db.prepare('SELECT count(*) as count FROM contractors_contractor').get();
    const audited = db.prepare('SELECT count(*) as count FROM contractors_contractor WHERE trust_score > 0').get();
    const unaudited = db.prepare('SELECT count(*) as count FROM contractors_contractor WHERE trust_score = 0 OR trust_score IS NULL').get();

    console.log('Total Contractors:', total.count);
    console.log('Audited Contractors (Score > 0):', audited.count);
    console.log('Unaudited Contractors (Score = 0/Null):', unaudited.count);

    try {
        const auditRecords = db.prepare('SELECT count(*) as count FROM audit_records').get();
        console.log('Total Audit Records:', auditRecords.count);
    } catch (e) {
        console.log('Could not query audit_records table:', e.message);
    }

} catch (e) {
    console.error('Error querying database:', e);
}
