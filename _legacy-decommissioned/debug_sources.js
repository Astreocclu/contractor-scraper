const Database = require('better-sqlite3');
const db = new Database('db.sqlite3');

try {
    // 1. Check Angi/BBB/Yelp status breakdown specifically
    console.log('--- Status Breakdown for Major Sources ---');
    const statuses = db.prepare(`
    SELECT source_name, fetch_status, count(*) as cnt 
    FROM contractor_raw_data 
    WHERE source_name IN ('angi', 'bbb', 'yelp', 'court_records', 'collin_court')
    GROUP BY source_name, fetch_status
  `).all();
    console.table(statuses);

    // 2. Check content of an Angi record (supposedly failing?)
    console.log('\n--- Angi Record Sample ---');
    const angi = db.prepare("SELECT fetch_status, raw_text, structured_data FROM contractor_raw_data WHERE source_name = 'angi' LIMIT 1").get();
    if (angi) {
        console.log('Status:', angi.fetch_status);
        console.log('Structured Data:', angi.structured_data ? angi.structured_data.substring(0, 500) : 'NULL');
        // If structured data is present, is it meaningful?
    }

    // 3. Check Court Record content (suspected Captcha)
    console.log('\n--- Collin Court Record Sample ---');
    const court = db.prepare("SELECT fetch_status, raw_text FROM contractor_raw_data WHERE source_name = 'collin_court' LIMIT 1").get();
    if (court) {
        console.log('Status:', court.fetch_status);
        console.log('Raw Text Preview:', court.raw_text ? court.raw_text.substring(0, 300) : 'NULL');
    }

} catch (e) {
    console.error(e);
}
