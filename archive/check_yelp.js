const Database = require('better-sqlite3');
const db = new Database('db.sqlite3');

try {
    const yelp = db.prepare("SELECT raw_text, fetch_status FROM contractor_raw_data WHERE source_name = 'yelp' AND fetch_status = 'success' ORDER BY fetched_at DESC LIMIT 1").get();

    console.log('--- Yelp Content Check ---');
    if (yelp) {
        const text = yelp.raw_text.toLowerCase();
        console.log('Review Count in Text?', text.includes('reviews'));
        console.log('Login Wall?', text.includes('log in') || text.includes('sign up'));
        console.log('Captcha?', text.includes('robot') || text.includes('captcha'));
        console.log('Preview:', yelp.raw_text.substring(0, 200).replace(/\n/g, ' '));
    } else {
        console.log('No successful Yelp records found.');
    }

} catch (e) {
    console.error(e);
}
