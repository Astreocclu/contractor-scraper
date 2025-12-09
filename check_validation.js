const Database = require('better-sqlite3');
const db = new Database('db.sqlite3');

try {
    // Check for recent Serper data (modified in last 5 minutes)
    const recent = db.prepare(`
    SELECT contractor_id, source_name, fetch_status, fetched_at, length(raw_text) as size
    FROM contractor_raw_data
    WHERE datetime(fetched_at) > datetime('now', '-10 minutes')
      AND (source_url = 'serper_api' OR source_name IN ('dallas_court', 'google_news', 'osha'))
    ORDER BY fetched_at DESC
    LIMIT 20
  `).all();

    console.log(`Found ${recent.length} recent Serper records:`);
    console.table(recent);

    // Check if any have actual results (size > 500 usually implies some text)
    const successCount = recent.filter(r => r.fetch_status === 'success').length;
    console.log(`Successful fetches: ${successCount}`);

} catch (e) {
    console.error(e);
}
