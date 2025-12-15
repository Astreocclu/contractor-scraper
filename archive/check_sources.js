const Database = require('better-sqlite3');
const db = new Database('db.sqlite3');

try {
    // Get all unique sources found in the data
    const sources = db.prepare('SELECT source_name, count(*) as count FROM contractor_raw_data GROUP BY source_name ORDER BY count DESC').all();

    console.log('--- Sources Found in Database ---');
    sources.forEach(s => {
        console.log(`${s.source_name}: ${s.count} records`);
    });

    // Calculate average sources per audited contractor
    const coverage = db.prepare(`
    SELECT AVG(source_count) as avg_sources
    FROM (
      SELECT contractor_id, count(DISTINCT source_name) as source_count
      FROM contractor_raw_data
      WHERE contractor_id IN (SELECT id FROM contractors_contractor WHERE trust_score > 0)
      GROUP BY contractor_id
    )
  `).get();

    console.log(`\nAverage sources per audited contractor: ${coverage.avg_sources.toFixed(1)}`);

} catch (e) {
    console.error('Error analyzing sources:', e);
}
