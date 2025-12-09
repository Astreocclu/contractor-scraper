const Database = require('better-sqlite3');
const db = new Database('db.sqlite3');

try {
    const scores = db.prepare('SELECT trust_score FROM contractors_contractor WHERE trust_score > 0').all();

    if (scores.length === 0) {
        console.log('No audited contractors found with score > 0.');
        process.exit(0);
    }

    const values = scores.map(s => s.trust_score);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;

    console.log(`Total Audited: ${values.length}`);
    console.log(`Average Score: ${avg.toFixed(2)}`);
    console.log(`Min Score: ${min}`);
    console.log(`Max Score: ${max}`);

    // Create bins
    const bins = {
        '1-20': 0,
        '21-40': 0,
        '41-60': 0,
        '61-80': 0,
        '81-100': 0
    };

    values.forEach(score => {
        if (score <= 20) bins['1-20']++;
        else if (score <= 40) bins['21-40']++;
        else if (score <= 60) bins['41-60']++;
        else if (score <= 80) bins['61-80']++;
        else bins['81-100']++;
    });

    console.log('\nScore Distribution:');
    Object.entries(bins).forEach(([range, count]) => {
        console.log(`${range}: ${count}`);
    });

} catch (e) {
    console.error('Error analyzing scores:', e);
}
