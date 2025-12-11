/**
 * Test script for county lien scrapers.
 * 
 * Usage:
 *   node tests/test_lien_scrapers.js
 *   node tests/test_lien_scrapers.js "ABC Contractors LLC"
 */

const { execSync } = require('child_process');
const path = require('path');

const SCRAPERS_DIR = path.join(__dirname, '..', 'scrapers');

// Test cases - known companies for validation
const TEST_CASES = [
    {
        name: 'Orange Elephant Roofing',
        description: 'Known problematic contractor - may have liens',
        expectLiens: true
    },
    {
        name: 'Test Company That Does Not Exist XYZ123',
        description: 'Nonexistent company - should return empty',
        expectLiens: false
    }
];

function log(msg) {
    console.log(msg);
}

function success(msg) {
    console.log(`\x1b[32m✓ ${msg}\x1b[0m`);
}

function warn(msg) {
    console.log(`\x1b[33m⚠ ${msg}\x1b[0m`);
}

function error(msg) {
    console.log(`\x1b[31m✗ ${msg}\x1b[0m`);
}

/**
 * Call the Python lien orchestrator
 */
function scrapeLiens(businessName, ownerName = null) {
    const scriptPath = path.join(SCRAPERS_DIR, 'county_liens', 'orchestrator.py');
    let args = `--name "${businessName}"`;
    if (ownerName) {
        args += ` --owner "${ownerName}"`;
    }

    const cmd = `python3 "${scriptPath}" ${args}`;

    try {
        const output = execSync(cmd, {
            cwd: SCRAPERS_DIR,
            timeout: 300000, // 5 minutes
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        return JSON.parse(output.trim());
    } catch (err) {
        if (err.stdout) {
            try {
                return JSON.parse(err.stdout.trim());
            } catch {
                // ignore
            }
        }
        throw new Error(`Scraper error: ${err.message}`);
    }
}

/**
 * Test the entity resolver
 */
function testEntityResolver() {
    log('\n=== Testing Entity Resolver ===');

    const testNames = [
        ['ABC Contractors LLC', 'ABC CONTRACTORS LLC'],
        ['Smith\'s Pool Service, Inc.', 'SMITHS POOL SERVICE INC'],
        ['Johnson & Sons Construction', 'JOHNSON SONS CONSTRUCTION'],
        ['XYZ Corp d/b/a SuperBuilders', 'XYZ CORP DBA SUPERBUILDERS'],
    ];

    const scriptPath = path.join(SCRAPERS_DIR, 'county_liens', 'entity_resolver.py');
    const cmd = `python3 -c "
from entity_resolver import EntityResolver
resolver = EntityResolver()
tests = ${JSON.stringify(testNames)}
for original, expected in tests:
    normalized = resolver.normalize_name(original)
    match = 'PASS' if expected in normalized else 'FAIL'
    print(f'{match}: {original} -> {normalized}')
"`;

    try {
        const output = execSync(cmd, {
            cwd: path.join(SCRAPERS_DIR, 'county_liens'),
            encoding: 'utf-8'
        });
        console.log(output);
        success('Entity resolver tests completed');
    } catch (err) {
        warn(`Entity resolver test error: ${err.message}`);
    }
}

/**
 * Test a single contractor
 */
function testContractor(businessName) {
    log(`\n=== Testing Lien Scraper for: ${businessName} ===`);

    try {
        const startTime = Date.now();
        const results = scrapeLiens(businessName);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        log(`\nCompleted in ${elapsed}s`);
        log(`Total records: ${results.total_records || 0}`);

        if (results.lien_score) {
            const score = results.lien_score;
            log(`Lien Score: ${score.score}/${score.max_score}`);
            log(`Active liens: ${score.active_liens}`);
            log(`Resolved liens: ${score.resolved_liens}`);

            if (score.notes && score.notes.length > 0) {
                log('Notes:');
                score.notes.forEach(note => log(`  - ${note}`));
            }
        }

        // Show county breakdown
        if (results.counties) {
            log('\nBy County:');
            for (const [county, data] of Object.entries(results.counties)) {
                const count = data.count || (data.records ? data.records.length : 0);
                log(`  ${county.toUpperCase()}: ${count} records`);
            }
        }

        // Show sample records
        if (results.total_records > 0) {
            log('\nSample Records:');
            let shown = 0;
            for (const [county, data] of Object.entries(results.counties || {})) {
                for (const record of (data.records || []).slice(0, 2)) {
                    log(`  [${record.document_type}] ${record.grantee} - $${record.amount || 'N/A'} (${record.filing_date})`);
                    shown++;
                    if (shown >= 5) break;
                }
                if (shown >= 5) break;
            }
        }

        return results;

    } catch (err) {
        error(`Test failed: ${err.message}`);
        return null;
    }
}

/**
 * Run all tests
 */
async function runTests() {
    log('='.repeat(60));
    log('COUNTY LIEN SCRAPER TEST SUITE');
    log('='.repeat(60));

    // Check if custom name provided
    const customName = process.argv[2];
    if (customName) {
        testContractor(customName);
        return;
    }

    // Test entity resolver first (fast)
    testEntityResolver();

    // Test each case
    for (const testCase of TEST_CASES) {
        log(`\n${'='.repeat(60)}`);
        log(`Test: ${testCase.description}`);

        const results = testContractor(testCase.name);

        if (results) {
            const hasLiens = (results.total_records || 0) > 0;
            if (testCase.expectLiens && hasLiens) {
                success(`Expected liens and found ${results.total_records}`);
            } else if (!testCase.expectLiens && !hasLiens) {
                success('Expected no liens and found none');
            } else if (testCase.expectLiens && !hasLiens) {
                warn('Expected liens but found none (portal may be down or name mismatch)');
            } else {
                warn(`Unexpected: found ${results.total_records} liens when expected none`);
            }
        }
    }

    log('\n' + '='.repeat(60));
    log('TEST SUITE COMPLETE');
    log('='.repeat(60));
    log('\nNote: Actual lien results depend on live portal data.');
    log('Selectors may need adjustment after manual portal testing.');
}

runTests().catch(console.error);
