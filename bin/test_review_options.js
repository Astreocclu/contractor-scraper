#!/usr/bin/env node
/**
 * Test Review Analyzer Options A/B/C
 *
 * Option A: Pass damning quotes to audit agent
 * Option B: Add severity ratings to complaint_patterns
 * Option C: Both A and B
 */

const db = require('../services/db_pg');
const { AuditAgent } = require('../services/audit_agent');
const fs = require('fs');
const path = require('path');

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

// Test contractors - the flagged ones
const TEST_IDS = [656, 665, 687, 682, 635]; // Bonnie&Clydes, Pinch A Penny x2, Sun Valley, Empowered

// Original prompt (current)
const ORIGINAL_PROMPT = `You are a review analyst with deep reasoning capabilities. Your job is to understand the TRUE story behind a contractor's reviews.

## YOUR MISSION
Use your reasoning to determine: Are these reviews authentic reflections of customer experience, or is something fishy?

## THINK DEEPLY ABOUT
1. **Review Authenticity** - Do these read like real customers?
2. **Platform Consistency** - Do ratings tell a coherent story?
3. **Complaint Patterns** - What do unhappy customers say?
4. **Red Flags in Content** - Deposits taken, ghosting, legal threats

OUTPUT FORMAT (JSON only):
{
  "fake_review_score": 25,
  "confidence": "HIGH",
  "platform_ratings": {"google": 4.8, "yelp": null, "bbb": "F"},
  "discrepancy_detected": false,
  "discrepancy_explanation": "...",
  "complaint_patterns": ["Slow response times", "Pricing concerns"],
  "fake_signals": ["Multiple reviews posted same day"],
  "authentic_signals": ["Specific project details mentioned"],
  "summary": "Reviews appear authentic with minor concerns.",
  "recommendation": "TRUST_REVIEWS"
}`;

// Option A: Add damning_quotes field
const OPTION_A_PROMPT = `You are a review analyst with deep reasoning capabilities. Your job is to understand the TRUE story behind a contractor's reviews.

## YOUR MISSION
Use your reasoning to determine: Are these reviews authentic reflections of customer experience, or is something fishy?

## THINK DEEPLY ABOUT
1. **Review Authenticity** - Do these read like real customers?
2. **Platform Consistency** - Do ratings tell a coherent story?
3. **Complaint Patterns** - What do unhappy customers say?
4. **Red Flags in Content** - Deposits taken, ghosting, legal threats

## CRITICAL: EXTRACT DAMNING QUOTES
When you find concerning reviews, extract the EXACT QUOTES that show the problem.
The audit agent needs to see the customer's actual words, not just category labels.

OUTPUT FORMAT (JSON only):
{
  "fake_review_score": 25,
  "confidence": "HIGH",
  "platform_ratings": {"google": 4.8, "yelp": null, "bbb": "F"},
  "discrepancy_detected": false,
  "discrepancy_explanation": "...",
  "complaint_patterns": ["Slow response times", "Pricing concerns"],
  "damning_quotes": [
    {"quote": "They sold us a USED hot tub without telling us. Jennifer LIED.", "source": "1-star Google review", "issue": "Deceptive sales"},
    {"quote": "Preyed upon us as ignorant first-time owners", "source": "1-star Google review", "issue": "Predatory behavior"}
  ],
  "fake_signals": ["Multiple reviews posted same day"],
  "authentic_signals": ["Specific project details mentioned"],
  "summary": "Reviews appear authentic with minor concerns.",
  "recommendation": "TRUST_REVIEWS"
}

IMPORTANT: damning_quotes should include the 3-5 MOST SEVERE customer statements you find. Include exact quotes, not paraphrases.`;

// Option B: Severity ratings on complaint_patterns
const OPTION_B_PROMPT = `You are a review analyst with deep reasoning capabilities. Your job is to understand the TRUE story behind a contractor's reviews.

## YOUR MISSION
Use your reasoning to determine: Are these reviews authentic reflections of customer experience, or is something fishy?

## THINK DEEPLY ABOUT
1. **Review Authenticity** - Do these read like real customers?
2. **Platform Consistency** - Do ratings tell a coherent story?
3. **Complaint Patterns** - What do unhappy customers say?
4. **Red Flags in Content** - Deposits taken, ghosting, legal threats

## SEVERITY RATINGS FOR COMPLAINTS
Rate each complaint pattern by severity:
- CRITICAL: Fraud, deception, selling damaged goods as new, scam behavior
- SEVERE: Predatory targeting of vulnerable customers, threats, taking money and ghosting
- HIGH: Property damage, major negligence, repeated failures
- MEDIUM: Poor communication, delays, pricing disputes
- LOW: Minor service issues, inconveniences

OUTPUT FORMAT (JSON only):
{
  "fake_review_score": 25,
  "confidence": "HIGH",
  "platform_ratings": {"google": 4.8, "yelp": null, "bbb": "F"},
  "discrepancy_detected": false,
  "discrepancy_explanation": "...",
  "complaint_patterns": [
    {"pattern": "Sold used/damaged goods as new", "severity": "CRITICAL", "count": 1},
    {"pattern": "Lied about product origin", "severity": "CRITICAL", "count": 1},
    {"pattern": "Poor communication", "severity": "MEDIUM", "count": 3}
  ],
  "fake_signals": ["Multiple reviews posted same day"],
  "authentic_signals": ["Specific project details mentioned"],
  "summary": "Reviews appear authentic with minor concerns.",
  "recommendation": "TRUST_REVIEWS"
}`;

// Option C: Both damning quotes AND severity ratings
const OPTION_C_PROMPT = `You are a review analyst with deep reasoning capabilities. Your job is to understand the TRUE story behind a contractor's reviews.

## YOUR MISSION
Use your reasoning to determine: Are these reviews authentic reflections of customer experience, or is something fishy?

## THINK DEEPLY ABOUT
1. **Review Authenticity** - Do these read like real customers?
2. **Platform Consistency** - Do ratings tell a coherent story?
3. **Complaint Patterns** - What do unhappy customers say?
4. **Red Flags in Content** - Deposits taken, ghosting, legal threats

## SEVERITY RATINGS FOR COMPLAINTS
Rate each complaint pattern by severity:
- CRITICAL: Fraud, deception, selling damaged goods as new, scam behavior
- SEVERE: Predatory targeting of vulnerable customers, threats, taking money and ghosting
- HIGH: Property damage, major negligence, repeated failures
- MEDIUM: Poor communication, delays, pricing disputes
- LOW: Minor service issues, inconveniences

## CRITICAL: EXTRACT DAMNING QUOTES
When you find concerning reviews, extract the EXACT QUOTES that show the problem.
The audit agent needs to see the customer's actual words, not just category labels.

OUTPUT FORMAT (JSON only):
{
  "fake_review_score": 25,
  "confidence": "HIGH",
  "platform_ratings": {"google": 4.8, "yelp": null, "bbb": "F"},
  "discrepancy_detected": false,
  "discrepancy_explanation": "...",
  "complaint_patterns": [
    {"pattern": "Sold used/damaged goods as new", "severity": "CRITICAL", "count": 1},
    {"pattern": "Lied about product origin", "severity": "CRITICAL", "count": 1},
    {"pattern": "Poor communication", "severity": "MEDIUM", "count": 3}
  ],
  "damning_quotes": [
    {"quote": "They sold us a USED hot tub without telling us. Jennifer LIED.", "source": "1-star Google review", "severity": "CRITICAL"},
    {"quote": "Preyed upon us as ignorant first-time owners", "source": "1-star Google review", "severity": "SEVERE"}
  ],
  "fake_signals": ["Multiple reviews posted same day"],
  "authentic_signals": ["Specific project details mentioned"],
  "summary": "Reviews appear authentic with minor concerns.",
  "recommendation": "TRUST_REVIEWS"
}

IMPORTANT: damning_quotes should include the 3-5 MOST SEVERE customer statements you find. Include exact quotes with severity ratings.`;

async function runReviewAnalysis(contractorId, prompt) {
  // Get contractor info
  const contractor = await db.getOne(`
    SELECT id, business_name, city, state, website
    FROM contractors_contractor WHERE id = $1
  `, [contractorId]);

  if (!contractor) throw new Error(`Contractor ${contractorId} not found`);

  // Get existing raw data for review sources
  const rows = await db.exec(`
    SELECT source_name, structured_data, raw_text
    FROM contractor_raw_data
    WHERE contractor_id = $1 AND source_name IN (
      'google_maps', 'google_maps_local', 'google_maps_hq',
      'yelp', 'yelp_yahoo', 'bbb', 'trustpilot', 'glassdoor', 'angi', 'houzz'
    )
  `, [contractorId]);

  // Build review data object
  const reviewData = {};
  for (const row of rows) {
    if (row.structured_data) {
      const data = typeof row.structured_data === 'string'
        ? JSON.parse(row.structured_data)
        : row.structured_data;
      reviewData[row.source_name] = data;
    }
  }

  // Build context for LLM
  let context = `## CONTRACTOR: ${contractor.business_name}\n\n`;
  context += `## PLATFORM RATINGS\n`;

  for (const [source, data] of Object.entries(reviewData)) {
    if (data?.rating) {
      context += `- ${source}: ${data.rating}★ (${data.review_count || 'unknown'} reviews)\n`;
    }
  }

  context += `\n## RAW REVIEW DATA\n`;

  for (const [source, data] of Object.entries(reviewData)) {
    if (data?.reviews && Array.isArray(data.reviews)) {
      const reviews = data.reviews;
      const fiveStars = reviews.filter(r => r.rating === 5).slice(0, 10);
      const oneStars = reviews.filter(r => r.rating === 1 || r.rating === 2).slice(0, 10);

      context += `\n### ${source.toUpperCase()}\n`;
      context += `Total reviews: ${reviews.length}\n\n`;

      if (fiveStars.length > 0) {
        context += `**5-STAR REVIEWS:**\n`;
        fiveStars.forEach((r, i) => {
          context += `[${i+1}] ${r.author || 'Anonymous'}: ${(r.text || '').substring(0, 500)}\n\n`;
        });
      }

      if (oneStars.length > 0) {
        context += `**1-2 STAR REVIEWS:**\n`;
        oneStars.forEach((r, i) => {
          context += `[${i+1}] ${r.author || 'Anonymous'}: ${(r.text || '').substring(0, 800)}\n\n`;
        });
      }
    }
  }

  // Call DeepSeek with the specific prompt
  const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: context }
      ],
      temperature: 0,
      max_tokens: 2000
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek error: ${response.status}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || '';

  // Extract JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  return JSON.parse(jsonMatch[0]);
}

async function runAuditWithReviewData(contractorId, reviewAnalysis) {
  // Get contractor
  const contractor = await db.getOne(`
    SELECT id, business_name as name, city, state, website
    FROM contractors_contractor WHERE id = $1
  `, [contractorId]);

  // Temporarily update review_analysis in raw_data
  await db.run(`
    UPDATE contractor_raw_data
    SET structured_data = $1
    WHERE contractor_id = $2 AND source_name = 'review_analysis'
  `, [JSON.stringify(reviewAnalysis), contractorId]);

  // Run audit
  const agent = new AuditAgent(db, contractorId, contractor);
  const result = await agent.run();

  return result;
}

async function testOption(optionName, prompt, contractorIds) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TESTING OPTION ${optionName}`);
  console.log('='.repeat(80));

  const results = [];

  for (const id of contractorIds) {
    const contractor = await db.getOne(`
      SELECT business_name, trust_score as old_score
      FROM contractors_contractor WHERE id = $1
    `, [id]);

    console.log(`\n[${id}] ${contractor.business_name} (current score: ${contractor.old_score})`);

    try {
      // Run review analysis with test prompt
      console.log('  Running review analysis...');
      const reviewAnalysis = await runReviewAnalysis(id, prompt);

      // Show what we got
      if (reviewAnalysis.damning_quotes) {
        console.log('  Damning quotes extracted:');
        reviewAnalysis.damning_quotes.forEach(q => {
          console.log(`    - "${q.quote.substring(0, 60)}..." [${q.severity || q.issue}]`);
        });
      }
      if (reviewAnalysis.complaint_patterns && reviewAnalysis.complaint_patterns[0]?.severity) {
        console.log('  Severity-rated patterns:');
        reviewAnalysis.complaint_patterns.forEach(p => {
          console.log(`    - [${p.severity}] ${p.pattern}`);
        });
      }

      // Run audit with new review data
      console.log('  Running audit...');
      const auditResult = await runAuditWithReviewData(id, reviewAnalysis);

      const newScore = auditResult.trust_score;
      const diff = newScore - contractor.old_score;
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';

      console.log(`  Result: ${contractor.old_score} → ${newScore} (${arrow}${Math.abs(diff)})`);

      results.push({
        id,
        name: contractor.business_name,
        old_score: contractor.old_score,
        new_score: newScore,
        diff,
        review_analysis: reviewAnalysis
      });

    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      results.push({ id, name: contractor.business_name, error: err.message });
    }
  }

  return results;
}

async function main() {
  console.log('Review Analyzer Options Test');
  console.log('============================\n');

  // Get baseline scores
  console.log('Baseline scores:');
  for (const id of TEST_IDS) {
    const c = await db.getOne(`SELECT business_name, trust_score FROM contractors_contractor WHERE id = $1`, [id]);
    console.log(`  [${id}] ${c.business_name}: ${c.trust_score}`);
  }

  // Test each option
  const resultsA = await testOption('A (Damning Quotes)', OPTION_A_PROMPT, TEST_IDS);
  const resultsB = await testOption('B (Severity Ratings)', OPTION_B_PROMPT, TEST_IDS);
  const resultsC = await testOption('C (Both)', OPTION_C_PROMPT, TEST_IDS);

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log('='.repeat(80));

  console.log('\n| ID  | Contractor                  | Baseline | Opt A | Opt B | Opt C |');
  console.log('|-----|----------------------------|----------|-------|-------|-------|');

  for (let i = 0; i < TEST_IDS.length; i++) {
    const id = TEST_IDS[i];
    const a = resultsA[i];
    const b = resultsB[i];
    const c = resultsC[i];

    const name = (a.name || '').substring(0, 26).padEnd(26);
    const baseline = String(a.old_score || '-').padStart(8);
    const scoreA = a.new_score ? String(a.new_score).padStart(5) : '  ERR';
    const scoreB = b.new_score ? String(b.new_score).padStart(5) : '  ERR';
    const scoreC = c.new_score ? String(c.new_score).padStart(5) : '  ERR';

    console.log(`| ${id} | ${name} | ${baseline} | ${scoreA} | ${scoreB} | ${scoreC} |`);
  }

  // Calculate averages
  const avgA = resultsA.filter(r => r.new_score).reduce((s, r) => s + r.diff, 0) / resultsA.length;
  const avgB = resultsB.filter(r => r.new_score).reduce((s, r) => s + r.diff, 0) / resultsB.length;
  const avgC = resultsC.filter(r => r.new_score).reduce((s, r) => s + r.diff, 0) / resultsC.length;

  console.log(`\nAverage score change: A=${avgA.toFixed(1)}, B=${avgB.toFixed(1)}, C=${avgC.toFixed(1)}`);

  // Save results
  const output = {
    test_date: new Date().toISOString(),
    contractors: TEST_IDS,
    results: { A: resultsA, B: resultsB, C: resultsC },
    averages: { A: avgA, B: avgB, C: avgC }
  };

  fs.writeFileSync(
    path.join(__dirname, '../docs/analysis/review-options-test.json'),
    JSON.stringify(output, null, 2)
  );

  console.log('\nResults saved to docs/analysis/review-options-test.json');

  await db.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
