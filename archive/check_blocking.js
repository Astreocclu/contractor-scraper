const Database = require('better-sqlite3');
const db = new Database('db.sqlite3');

try {
    const sources = ['dallas_court', 'tarrant_court', 'denton_court'];

    sources.forEach(source => {
        console.log(`\n--- ${source} Sample ---`);
        const record = db.prepare(`SELECT raw_text FROM contractor_raw_data WHERE source_name = ? LIMIT 1`).get(source);
        if (record && record.raw_text) {
            const isCaptcha = record.raw_text.includes('unusual traffic') || record.raw_text.includes('recaptcha');
            console.log(`Is Captcha/Blocked: ${isCaptcha}`);
            console.log(`Preview: ${record.raw_text.substring(0, 150).replace(/\n/g, ' ')}...`);
        } else {
            console.log('No data found.');
        }
    });

} catch (e) {
    console.error(e);
}
