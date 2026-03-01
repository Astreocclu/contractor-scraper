/**
 * Check status of a previously posted DataForSEO task 
 * and try to also fetch via task_get directly (some tasks can be fetched even if not in tasks_ready)
 */
const fs = require('fs');
const path = require('path');

// Load .env
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

var login = process.env.DATAFORSEO_LOGIN;
var password = process.env.DATAFORSEO_PASSWORD;
var auth = 'Basic ' + Buffer.from(login + ':' + password).toString('base64');
var taskId = '02180629-1404-0298-0000-e314e720655d';

async function main() {
    console.log('Checking task:', taskId);

    // 1) Check tasks_ready
    console.log('\n--- Checking tasks_ready ---');
    var readyRes = await fetch('https://api.dataforseo.com/v3/business_data/google/reviews/tasks_ready', {
        headers: { 'Authorization': auth }
    });
    var readyData = await readyRes.json();
    var readyTasks = (readyData.tasks && readyData.tasks[0] && readyData.tasks[0].result) || [];
    console.log('Ready tasks count:', readyTasks.length);

    var isReady = false;
    for (var i = 0; i < readyTasks.length; i++) {
        if (readyTasks[i].id === taskId) {
            isReady = true;
            break;
        }
    }
    console.log('Our task in ready list:', isReady);

    // 2) Try to fetch directly regardless
    console.log('\n--- Trying task_get directly ---');
    var getRes = await fetch('https://api.dataforseo.com/v3/business_data/google/reviews/task_get/' + taskId, {
        headers: { 'Authorization': auth }
    });
    var getData = await getRes.json();

    var task = getData.tasks && getData.tasks[0];
    if (!task) {
        console.log('No task returned');
        console.log(JSON.stringify(getData, null, 2).slice(0, 500));
        return;
    }

    console.log('Task status_code:', task.status_code);
    console.log('Task status_message:', task.status_message);

    var result = task.result && task.result[0];
    if (!result) {
        console.log('No result yet — task still processing');
        return;
    }

    var items = result.items || [];
    var withText = 0;
    for (var j = 0; j < items.length; j++) {
        if (items[j].review_text) withText++;
    }

    console.log('\n=== RESULTS ===');
    console.log('Business:', result.title);
    console.log('Address:', result.sub_title);
    if (result.rating) {
        console.log('Rating:', result.rating.value, '(' + result.rating.votes_count + ' votes)');
    }
    console.log('Total reviews on Google:', result.reviews_count);
    console.log('Reviews fetched:', items.length);
    console.log('Reviews with text:', withText);
    console.log('Cost: $' + getData.cost);

    console.log('\nFirst 5 reviews:');
    for (var k = 0; k < Math.min(5, items.length); k++) {
        var r = items[k];
        var rating = (r.rating && r.rating.value) ? r.rating.value : '?';
        var name = r.profile_name || 'anon';
        var time = r.time_ago || '?';
        console.log('  ' + (k + 1) + '. star' + rating + ' by ' + name + ' (' + time + ')');
        var txt = (r.review_text || '(no text)').slice(0, 150);
        console.log('     "' + txt + '"');
        if (r.owner_answer) {
            console.log('     -> Owner: "' + r.owner_answer.slice(0, 80) + '"');
        }
    }

    // Save
    var dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    var outPath = path.join(dataDir, 'dataforseo_test_firefighter_roofing.json');
    fs.writeFileSync(outPath, JSON.stringify({
        business_name: result.title,
        rating: result.rating && result.rating.value,
        total_review_count: result.reviews_count,
        fetched_count: items.length,
        with_text_count: withText,
        cost: getData.cost,
        items: items
    }, null, 2));
    console.log('\nSaved to:', outPath);

    console.log('\n=== COMPARISON vs APIFY ===');
    console.log('Apify fetched:     100 reviews (capped)');
    console.log('DataForSEO fetched:', items.length, 'reviews');
    if (items.length > 100) {
        console.log('DataForSEO got ' + (items.length - 100) + ' MORE reviews than Apify!');
    }
}

main().catch(function (err) { console.error('Error:', err.message); });
