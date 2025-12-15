const Database = require('better-sqlite3');
const db = new Database('db.sqlite3');

try {
    console.log('--- Source Success Rates ---');
    const results = db.prepare(`
    SELECT 
      source_name,
      count(*) as total,
      sum(case when fetch_status = 'success' then 1 else 0 end) as success_count,
      sum(case when fetch_status = 'not_found' then 1 else 0 end) as not_found,
      sum(case when fetch_status = 'error' then 1 else 0 end) as error_count,
       sum(case when raw_text IS NULL OR length(raw_text) < 50 then 1 else 0 end) as empty_content
    FROM contractor_raw_data 
    GROUP BY source_name 
    ORDER BY success_count DESC
  `).all();

    console.table(results.map(r => ({
        Source: r.source_name,
        Total: r.total,
        Success: r.success_count,
        'Not Found': r.not_found,
        Error: r.error_count,
        'Empty/Short': r.empty_content,
        'Real Success %': Math.round(((r.success_count - r.empty_content) / r.total) * 100)
    })));

    // Inspect a few "successful" records for suspicious content
    console.log('\n--- Content Sampling (First 200 chars) ---');
    const samples = db.prepare(`
    SELECT source_name, raw_text 
    FROM contractor_raw_data 
    WHERE fetch_status = 'success' 
    GROUP BY source_name 
    LIMIT 5
  `).all();

    samples.forEach(s => {
        console.log(`\n[${s.source_name}]: ${s.raw_text ? s.raw_text.substring(0, 150).replace(/\n/g, ' ') : 'NULL'}...`);
    });

} catch (e) {
    console.error('Error analyzing quality:', e);
}
