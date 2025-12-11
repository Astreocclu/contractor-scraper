const Database = require('better-sqlite3');
const db = new Database('db.sqlite3');

try {
    const sourcesToCheck = [
        'osha', 'epa_echo', 'tx_sos_search', 'tx_franchise',
        'facebook', 'google_news', 'open_corporates', 'linkedin'
    ];

    console.log('--- Checking Remaining Sources ---');

    sourcesToCheck.forEach(source => {
        const record = db.prepare(`SELECT fetch_status, raw_text FROM contractor_raw_data WHERE source_name = ? LIMIT 1`).get(source);

        console.log(`\n[${source}]`);
        if (!record) {
            console.log('Status: No Data Found');
        } else {
            console.log(`Status: ${record.fetch_status}`);
            if (record.raw_text) {
                const text = record.raw_text.toLowerCase();
                const isCaptcha = text.includes('unusual traffic') || text.includes('recaptcha') || text.includes('robot');
                const isLogin = text.includes('login') || text.includes('sign in');
                const length = record.raw_text.length;

                console.log(`Length: ${length}`);
                console.log(`Is Captcha: ${isCaptcha}`);
                console.log(`Is Login Wall: ${isLogin}`);
                console.log(`Preview: ${record.raw_text.substring(0, 100).replace(/\n/g, ' ')}...`);
            } else {
                console.log('Content: NULL');
            }
        }
    });

} catch (e) {
    console.error(e);
}
