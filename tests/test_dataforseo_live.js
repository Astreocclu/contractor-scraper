/**
 * DataForSEO LIVE endpoint test
 * Uses the synchronous /live endpoint instead of async standard queue
 * 
 * Run: node tests/test_dataforseo_live.js
 */

const fs = require('fs');
const path = require('path');

// Load .env manually
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
}

const login = process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_PASSWORD;

if (!login || !password) {
    console.error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set in .env');
    process.exit(1);
}

const auth = 'Basic ' + Buffer.from(login + ':' + password).toString('base64');

async function main() {
    console.log('=== DataForSEO LIVE Endpoint Test ===\n');
    console.log('Business: Firefighter Roofing');
    console.log('Location: Fort Worth,Texas,United States');
    console.log('Depth: 500 reviews');
    console.log('\nSending request (live = synchronous, no polling)...\n');

    const startTime = Date.now();

    const res = await fetch('https://api.dataforseo.com/v3/business_data/google/reviews/live', {
        method: 'POST',
        headers: {
            'Authorization': auth,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
            keyword: 'Firefighter Roofing',
            location_name: 'Fort Worth,Texas,United States',
            language_code: 'en',
            depth: 500,
            sort_by: 'newest'
        }])
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('Response in ' + elapsed + 's (status ' + res.status + ')');

    const data = await res.json();

    if (data.status_code !== 20000) {
        console.log('API Error:', data.status_message);
        console.log(JSON.stringify(data, null, 2).slice(0, 1000));
        return;
    }

    const task = data.tasks && data.tasks[0];
    if (!task) {
        console.log('No task in response');
        return;
    }

    const result = task.result && task.result[0];
    if (!result) {
        console.log('No result data');
        console.log('Task status:', task.status_code, task.status_message);
        console.log('Response preview:', JSON.stringify(task, null, 2).slice(0, 500));
        return;
    }

    const items = result.items || [];
    const withText = items.filter(function (i) { return i.review_text; }).length;

    console.log('\n=== RESULTS ===');
    console.log('Business:', result.title);
    console.log('Address:', result.sub_title);
    console.log('Rating:', result.rating && result.rating.value, '(' + (result.rating && result.rating.votes_count) + ' votes)');
    console.log('Total reviews on Google:', result.reviews_count);
    console.log('Reviews fetched:', items.length);
    console.log('Reviews with text:', withText);
    console.log('Cost: $' + data.cost);

    console.log('\nFirst 5 reviews:');
    items.slice(0, 5).forEach(function (r, i) {
        var rating = r.rating && r.rating.value ? r.rating.value : '?';
        var name = r.profile_name || 'anon';
        var time = r.time_ago || '?';
        console.log('  ' + (i + 1) + '. ★' + rating + ' by ' + name + ' (' + time + ')');
        var txt = (r.review_text || '(no text)').slice(0, 150);
        console.log('     "' + txt + '"');
        if (r.owner_answer) {
            console.log('     → Owner: "' + r.owner_answer.slice(0, 80) + '"');
        }
    });

    // Save full results
    var dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    var outPath = path.join(dataDir, 'dataforseo_test_firefighter_roofing.json');
    fs.writeFileSync(outPath, JSON.stringify({
        business_name: result.title,
        rating: result.rating && result.rating.value,
        total_review_count: result.reviews_count,
        fetched_count: items.length,
        with_text_count: withText,
        cost: data.cost,
        items: items
    }, null, 2));
    console.log('\nFull results saved to:', outPath);

    console.log('\n=== COMPARISON vs APIFY ===');
    console.log('Apify fetched:     100 reviews (capped at 100)');
    console.log('DataForSEO fetched: ' + items.length + ' reviews');
    if (items.length > 100) {
        console.log('✅ DataForSEO got ' + (items.length - 100) + ' MORE reviews than Apify!');
    }
    if (result.reviews_count && items.length === result.reviews_count) {
        console.log('✅ DataForSEO got ALL reviews (100% complete)');
    }
}

main().catch(function (err) {
    console.error('Error:', err.message);
});
