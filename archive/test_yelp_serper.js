const Database = require('better-sqlite3');
const { CollectionService } = require('./services/collection_service');

const db = new Database('db.sqlite3');
const service = new CollectionService(db);

async function test() {
    await service.init();

    console.log('Testing Yelp via Serper...');
    // Use a known Yelp URL format that we build in the app
    const url = 'https://www.yelp.com/search?find_desc=Neighborhood+Pool+Service&find_loc=Carrollton%2C+TX';

    const result = await service.fetchPage(url, 'yelp');

    console.log('Status:', result.status);
    console.log('Source:', result.source);
    console.log('Result Type:', result.structured && result.structured.source ? result.structured.source : 'puppeteer');

    if (result.structured && result.structured.source === 'serper') {
        console.log('✅ SUCCESS: Used Serper API');
        console.log('Query Used:', result.structured.query);
        console.log('Results Found:', result.structured.results.length);
        if (result.structured.results.length > 0) {
            console.log('First Result:', result.structured.results[0].title);
        }
    } else {
        console.log('❌ FAILURE: Did not use Serper API');
    }

    await service.close();
}

test().catch(console.error);
