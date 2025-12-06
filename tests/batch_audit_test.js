#!/usr/bin/env node
/**
 * Batch Forensic Audit Test
 *
 * Tests multiple contractors and outputs summary results.
 * Usage: node batch_audit_test.js
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Env should already be sourced
// Just check that DEEPSEEK_API_KEY is set
if (!process.env.DEEPSEEK_API_KEY) {
  console.error('ERROR: DEEPSEEK_API_KEY not set. Run: source .env && export DEEPSEEK_API_KEY');
  process.exit(1);
}

const TESTS = [
  // Known bad contractor (by name - not in DB)
  { name: 'Orange Elephant Roofing', city: 'Dallas', state: 'TX', expected: 'bad' },

  // Database contractors (by ID) - reduced to 5 for faster testing
  { id: 29, expected: 'unknown' },   // SunRoom Season
  { id: 74, expected: 'unknown' },   // Castro's Pool
  { id: 83, expected: 'unknown' },   // Riverbend Sandler Pools
  { id: 106, expected: 'unknown' },  // Screenmobile of Dallas
  { id: 206, expected: 'unknown' },  // Garrett Outdoor Living
];

const results = [];

async function runAudit(test, index) {
  const startTime = Date.now();
  const testNum = index + 1;
  const total = TESTS.length;

  let cmd;
  let label;

  if (test.id) {
    cmd = `node forensic_audit_puppeteer.js --id ${test.id} --dry-run`;
    label = `ID ${test.id}`;
  } else {
    cmd = `node forensic_audit_puppeteer.js --name "${test.name}" --city "${test.city}" --state "${test.state}" --dry-run`;
    label = test.name;
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[${testNum}/${total}] Testing: ${label}`);
  console.log(`${'='.repeat(70)}`);

  try {
    const output = execSync(cmd, {
      encoding: 'utf8',
      timeout: 300000, // 5 minutes per test
      env: { ...process.env, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY }
    });

    // Parse results from output
    const scoreMatch = output.match(/Score:\s*(\d+)\/100/);
    const recMatch = output.match(/Recommendation:\s*(\w+)/);
    const nameMatch = output.match(/Contractor:\s*(.+)/);
    const flagsMatch = output.match(/RED FLAGS ---\n([\s\S]*?)(?=\n---|\n====)/);

    const score = scoreMatch ? parseInt(scoreMatch[1]) : null;
    const recommendation = recMatch ? recMatch[1] : 'unknown';
    const contractorName = nameMatch ? nameMatch[1].trim() : label;

    // Count red flags by severity
    let criticalFlags = 0, highFlags = 0, mediumFlags = 0, lowFlags = 0;
    if (flagsMatch) {
      const flagText = flagsMatch[1];
      criticalFlags = (flagText.match(/\[CRITICAL\]/g) || []).length;
      highFlags = (flagText.match(/\[HIGH\]/g) || []).length;
      mediumFlags = (flagText.match(/\[MEDIUM\]/g) || []).length;
      lowFlags = (flagText.match(/\[LOW\]/g) || []).length;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    results.push({
      label: contractorName,
      id: test.id || 'N/A',
      score,
      recommendation,
      criticalFlags,
      highFlags,
      mediumFlags,
      lowFlags,
      expected: test.expected,
      elapsed: `${elapsed}s`,
      status: 'success'
    });

    // Print summary for this test
    const scoreColor = score >= 70 ? '\x1b[32m' : (score >= 40 ? '\x1b[33m' : '\x1b[31m');
    console.log(`\n  Result: ${scoreColor}${score}/100\x1b[0m | ${recommendation}`);
    console.log(`  Flags: ${criticalFlags} critical, ${highFlags} high, ${mediumFlags} medium, ${lowFlags} low`);
    console.log(`  Time: ${elapsed}s`);

  } catch (err) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.error(`  ERROR: ${err.message.split('\n')[0]}`);

    results.push({
      label,
      id: test.id || 'N/A',
      score: null,
      recommendation: 'ERROR',
      criticalFlags: 0,
      highFlags: 0,
      mediumFlags: 0,
      lowFlags: 0,
      expected: test.expected,
      elapsed: `${elapsed}s`,
      status: 'error',
      error: err.message.split('\n')[0]
    });
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('BATCH FORENSIC AUDIT TEST');
  console.log(`Testing ${TESTS.length} contractors`);
  console.log('='.repeat(70));

  const startTime = Date.now();

  // Run tests sequentially
  for (let i = 0; i < TESTS.length; i++) {
    await runAudit(TESTS[i], i);
  }

  const totalTime = Math.round((Date.now() - startTime) / 1000);

  // Print summary table
  console.log('\n\n' + '='.repeat(70));
  console.log('SUMMARY RESULTS');
  console.log('='.repeat(70));
  console.log('\n| Contractor | Score | Recommendation | Red Flags | Time |');
  console.log('|------------|-------|----------------|-----------|------|');

  for (const r of results) {
    const shortName = r.label.substring(0, 30).padEnd(30);
    const scoreStr = r.score !== null ? `${r.score}/100` : 'ERROR';
    const flagStr = `${r.criticalFlags}C/${r.highFlags}H/${r.mediumFlags}M`;
    console.log(`| ${shortName} | ${scoreStr.padEnd(5)} | ${r.recommendation.padEnd(14)} | ${flagStr.padEnd(9)} | ${r.elapsed.padEnd(4)} |`);
  }

  // Stats
  const successful = results.filter(r => r.status === 'success');
  const avgScore = successful.length > 0
    ? Math.round(successful.reduce((sum, r) => sum + (r.score || 0), 0) / successful.length)
    : 0;
  const avoidCount = results.filter(r => r.recommendation === 'AVOID').length;
  const cautionCount = results.filter(r => r.recommendation === 'CAUTION').length;
  const recommendedCount = results.filter(r => r.recommendation === 'RECOMMENDED').length;

  console.log('\n--- STATISTICS ---');
  console.log(`Total tests: ${TESTS.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Average score: ${avgScore}/100`);
  console.log(`Recommendations: ${recommendedCount} recommended, ${cautionCount} caution, ${avoidCount} avoid`);
  console.log(`Total time: ${totalTime}s (${Math.round(totalTime/60)}min)`);

  // Check Orange Elephant specifically
  const orangeResult = results.find(r => r.label.includes('Orange Elephant'));
  if (orangeResult) {
    console.log('\n--- ORANGE ELEPHANT CHECK ---');
    if (orangeResult.score !== null && orangeResult.score <= 30) {
      console.log('\x1b[32m✓ Orange Elephant scored low as expected (' + orangeResult.score + '/100)\x1b[0m');
    } else if (orangeResult.score !== null) {
      console.log('\x1b[33m⚠ Orange Elephant scored ' + orangeResult.score + '/100 (expected < 30)\x1b[0m');
    } else {
      console.log('\x1b[31m✗ Orange Elephant test failed\x1b[0m');
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('BATCH TEST COMPLETE');
  console.log('='.repeat(70));
}

main().catch(console.error);
