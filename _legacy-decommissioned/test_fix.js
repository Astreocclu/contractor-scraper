const Database = require('better-sqlite3');
const { CollectionService } = require('./services/collection_service');

const db = new Database('db.sqlite3');
const service = new CollectionService(db);

async function test() {
    await service.init();

    console.log('Testing Dallas Court (should use Serper)...');
    const url = 'https://www.google.com/search?q=site:dallascounty.org+SunRoom+Season+civil';

    const result = await service.fetchPage(url, 'dallas_court');

    console.log('Status:', result.status);
    console.log('Source:', result.source);
    console.log('Result Type:', result.structured && result.structured.source ? result.structured.source : 'puppeteer');
    console.log('Results Found:', result.structured && result.structured.results ? result.structured.results.length : 0);

    if (result.structured && result.structured.source === 'serper') {
        console.log('✅ SUCCESS: Used Serper API');
        console.log('First Result:', result.structured.results[0]?.title);
    } else {
        console.log('❌ FAILURE: Did not use Serper API');
    }

    await service.close();
}

test().catch(console.error);
