#!/usr/bin/env node
/**
 * Calibration Pipeline
 *
 * Selects 20 contractors using stratified sampling, runs dialectic council audits,
 * and generates PDF reports for human annotation.
 *
 * Usage:
 *   node bin/calibrate_pipeline.js [options]
 *
 * Options:
 *   --dry-run   Show selection only, don't run audits
 *   --pdf-only  Skip audits, just generate PDFs from existing audit records
 *   --reset     Clear state file and start fresh
 *   --help      Show this help message
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { runForensicAudit } = require('../services/orchestrator');
const db = require('../services/db_pg');
const { getSessionCosts, resetSessionCosts } = require('../services/cost_tracker');

// Configuration
const STATE_FILE = path.join(__dirname, '..', 'calibration_progress.json');
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'calibration_report.html');
const OUTPUT_DIR = path.join(__dirname, '..', 'exports', 'calibration', new Date().toISOString().split('T')[0]);

// Sampling configuration: 5/5/10/10 = 30 total
const SAMPLING_CONFIG = {
  clearGood: {
    count: 5,
    query: `SELECT id, business_name, city, state, trust_score, google_review_count
            FROM contractors_contractor
            WHERE trust_score >= 80
            ORDER BY google_review_count DESC
            LIMIT 5`
  },
  clearBad: {
    count: 5,
    query: `SELECT id, business_name, city, state, trust_score, google_review_count
            FROM contractors_contractor
            WHERE trust_score <= 25 AND trust_score > 0
            ORDER BY google_review_count DESC
            LIMIT 5`
  },
  greyRich: {
    count: 10,
    query: `SELECT id, business_name, city, state, trust_score, google_review_count
            FROM contractors_contractor
            WHERE trust_score BETWEEN 40 AND 70 AND google_review_count >= 30
            ORDER BY RANDOM()
            LIMIT 10`
  },
  greyPoor: {
    count: 10,
    query: `SELECT id, business_name, city, state, trust_score, google_review_count
            FROM contractors_contractor
            WHERE trust_score BETWEEN 40 AND 70 AND (google_review_count < 10 OR google_review_count IS NULL)
            ORDER BY RANDOM()
            LIMIT 10`
  }
};

// Graceful shutdown handling
let isShuttingDown = false;

function setupShutdownHandlers() {
  const handler = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n\nReceived ${signal}. Stopping after current operation...`);
    saveState();
  };

  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}

// State management
let state = {
  selected: [],       // { id, business_name, city, state, trust_score, category }
  audited: [],        // { id, success, timestamp }
  pdfsGenerated: [],  // { id, path, timestamp }
  failed: [],         // { id, error, stage, timestamp }
  startedAt: null,
  lastUpdated: null
};

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      state = {
        ...state,
        ...loaded
      };
      console.log(`Loaded state: ${state.selected.length} selected, ${state.audited.length} audited, ${state.pdfsGenerated.length} PDFs generated, ${state.failed.length} failed`);
    } catch (e) {
      console.warn('Could not load state file, starting fresh');
    }
  }
}

function saveState() {
  state.lastUpdated = new Date().toISOString();
  // Atomic write: temp file then rename
  const tempFile = STATE_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2));
  fs.renameSync(tempFile, STATE_FILE);
}

function resetState() {
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
    console.log('State cleared.');
  }
  state = {
    selected: [],
    audited: [],
    pdfsGenerated: [],
    failed: [],
    startedAt: null,
    lastUpdated: null
  };
}

/**
 * Select contractors using stratified sampling
 */
async function selectContractors() {
  console.log('\n' + '='.repeat(60));
  console.log('STRATIFIED CONTRACTOR SELECTION');
  console.log('='.repeat(60) + '\n');

  const selected = [];

  for (const [category, config] of Object.entries(SAMPLING_CONFIG)) {
    console.log(`Selecting ${config.count} contractors for ${category}...`);
    const rows = await db.exec(config.query);

    if (rows.length < config.count) {
      console.warn(`  Warning: Only found ${rows.length}/${config.count} contractors for ${category}`);
    }

    for (const row of rows) {
      selected.push({
        id: row.id,
        business_name: row.business_name,
        city: row.city,
        state: row.state,
        trust_score: row.trust_score,
        google_review_count: row.google_review_count,
        category
      });
      console.log(`  [${category}] ID ${row.id}: ${row.business_name} (Score: ${row.trust_score}, Reviews: ${row.google_review_count || 0})`);
    }
  }

  console.log(`\nTotal selected: ${selected.length}/20`);
  return selected;
}

/**
 * Run dialectic audits on selected contractors
 */
async function runAudits(contractors) {
  console.log('\n' + '='.repeat(60));
  console.log('RUNNING DIALECTIC AUDITS');
  console.log('='.repeat(60) + '\n');

  // Filter out already audited
  const auditedIds = new Set(state.audited.map(a => a.id));
  const toAudit = contractors.filter(c => !auditedIds.has(c.id));

  console.log(`To audit: ${toAudit.length} (${state.audited.length} already done)`);

  for (let i = 0; i < toAudit.length; i++) {
    if (isShuttingDown) {
      console.log('Shutdown requested, stopping audits.');
      break;
    }

    const contractor = toAudit[i];
    console.log(`\n[${i + 1}/${toAudit.length}] Auditing ${contractor.business_name} (ID: ${contractor.id})...`);

    try {
      const result = await runForensicAudit(
        { id: contractor.id },
        { mode: 'dialectic', batchMode: true, skipCollection: false }
      );

      if (!result) {
        throw new Error('Audit returned null result');
      }

      state.audited.push({
        id: contractor.id,
        success: true,
        newScore: result.trust_score,
        recommendation: result.recommendation,
        timestamp: new Date().toISOString()
      });
      console.log(`  -> Score: ${result.trust_score}/100 (${result.recommendation})`);

    } catch (err) {
      state.failed.push({
        id: contractor.id,
        error: err.message || String(err),
        stage: 'audit',
        timestamp: new Date().toISOString()
      });
      console.error(`  -> FAILED: ${err.message}`);
    }

    saveState();
  }
}

/**
 * Get score CSS class based on score value
 */
function getScoreClass(score) {
  if (score >= 70) return 'score-high';
  if (score >= 40) return 'score-medium';
  return 'score-low';
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  if (typeof text !== 'string') {
    text = JSON.stringify(text, null, 2);
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Process template with simple mustache-like replacement
 */
function processTemplate(template, data) {
  let result = template;

  // Handle {{#if redFlags}}...{{/if}}
  const ifRedFlagsMatch = result.match(/\{\{#if redFlags\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/);
  if (ifRedFlagsMatch) {
    if (data.redFlags && data.redFlags.length > 0) {
      result = result.replace(ifRedFlagsMatch[0], ifRedFlagsMatch[1]);
    } else {
      result = result.replace(ifRedFlagsMatch[0], ifRedFlagsMatch[2]);
    }
  }

  // Handle {{#if redFlags}}...{{/if}} without else
  const ifRedFlagsNoElse = result.match(/\{\{#if redFlags\}\}([\s\S]*?)\{\{\/if\}\}/);
  if (ifRedFlagsNoElse) {
    if (data.redFlags && data.redFlags.length > 0) {
      result = result.replace(ifRedFlagsNoElse[0], ifRedFlagsNoElse[1]);
    } else {
      result = result.replace(ifRedFlagsNoElse[0], '<div class="no-red-flags">No red flags identified during audit.</div>');
    }
  }

  // Handle {{#each redFlags}}...{{/each}}
  const eachRedFlagsMatch = result.match(/\{\{#each redFlags\}\}([\s\S]*?)\{\{\/each\}\}/);
  if (eachRedFlagsMatch && data.redFlags && data.redFlags.length > 0) {
    const itemTemplate = eachRedFlagsMatch[1];
    const items = data.redFlags.map(flag => {
      let item = itemTemplate;
      item = item.replace(/\{\{severity\}\}/g, flag.severity || 'MEDIUM');
      item = item.replace(/\{\{text\}\}/g, escapeHtml(flag.text || flag.description || ''));
      return item;
    }).join('');
    result = result.replace(eachRedFlagsMatch[0], items);
  } else if (eachRedFlagsMatch) {
    result = result.replace(eachRedFlagsMatch[0], '');
  }

  // Handle {{#each rawDataSources}}...{{/each}}
  const eachRawDataMatch = result.match(/\{\{#each rawDataSources\}\}([\s\S]*?)\{\{\/each\}\}/);
  if (eachRawDataMatch && data.rawDataSources && data.rawDataSources.length > 0) {
    const itemTemplate = eachRawDataMatch[1];
    const items = data.rawDataSources.map(source => {
      let item = itemTemplate;
      item = item.replace(/\{\{name\}\}/g, escapeHtml(source.name));
      item = item.replace(/\{\{content\}\}/g, escapeHtml(source.content));
      return item;
    }).join('');
    result = result.replace(eachRawDataMatch[0], items);
  } else if (eachRawDataMatch) {
    result = result.replace(eachRawDataMatch[0], '<p>No raw data available.</p>');
  }

  // Simple placeholder replacement for all other {{key}} patterns
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' || typeof value === 'number') {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(regex, escapeHtml(String(value)));
    }
  }

  return result;
}

/**
 * Generate PDF for a single contractor
 */
async function generatePdf(browser, contractor, template) {
  // Fetch audit record
  const auditRecord = await db.getOne(`
    SELECT ar.*, cc.business_name, cc.city, cc.state, cc.google_review_count
    FROM audit_records ar
    JOIN contractors_contractor cc ON ar.contractor_id = cc.id
    WHERE ar.contractor_id = ?
    ORDER BY ar.created_at DESC
    LIMIT 1
  `, [contractor.id]);

  if (!auditRecord) {
    throw new Error(`No audit record found for contractor ${contractor.id}`);
  }

  // Fetch raw data sources
  const rawDataRows = await db.exec(`
    SELECT source_name, structured_data, raw_text, fetch_status
    FROM contractor_raw_data
    WHERE contractor_id = ? AND fetch_status = 'success'
    ORDER BY source_name
  `, [contractor.id]);

  // Parse reasoning trace for persona data
  let personaData = {
    advocateScore: 'N/A',
    advocateScoreClass: 'score-medium',
    advocateConfidence: 'N/A',
    advocateReasoning: 'No dialectic audit data available.',
    advocateConcerns: 'N/A',
    arbiterScore: 'N/A',
    arbiterScoreClass: 'score-medium',
    arbiterConfidence: 'N/A',
    arbiterReasoning: 'No dialectic audit data available.',
    arbiterPositives: 'N/A',
    synthesizerScore: 'N/A',
    synthesizerScoreClass: 'score-medium',
    synthesizerReasoning: 'No dialectic audit data available.',
    strongerCase: 'N/A',
    agreements: 'N/A',
    disagreements: 'N/A'
  };

  if (auditRecord.reasoning_trace) {
    try {
      const trace = typeof auditRecord.reasoning_trace === 'string'
        ? JSON.parse(auditRecord.reasoning_trace)
        : auditRecord.reasoning_trace;

      if (trace.advocate) {
        personaData.advocateScore = trace.advocate.trust_score || 'N/A';
        personaData.advocateScoreClass = getScoreClass(trace.advocate.trust_score || 50);
        personaData.advocateConfidence = trace.advocate.assessment_confidence ? `${trace.advocate.assessment_confidence}%` : 'N/A';
        personaData.advocateReasoning = trace.advocate.reasoning || 'N/A';
        personaData.advocateConcerns = Array.isArray(trace.advocate.key_concerns)
          ? trace.advocate.key_concerns.join(', ')
          : (trace.advocate.key_concerns || 'N/A');
      }

      if (trace.arbiter) {
        personaData.arbiterScore = trace.arbiter.trust_score || 'N/A';
        personaData.arbiterScoreClass = getScoreClass(trace.arbiter.trust_score || 50);
        personaData.arbiterConfidence = trace.arbiter.assessment_confidence ? `${trace.arbiter.assessment_confidence}%` : 'N/A';
        personaData.arbiterReasoning = trace.arbiter.reasoning || 'N/A';
        personaData.arbiterPositives = Array.isArray(trace.arbiter.positive_factors)
          ? trace.arbiter.positive_factors.join(', ')
          : (trace.arbiter.positive_factors || 'N/A');
      }

      if (trace.synthesizer) {
        personaData.synthesizerScore = trace.synthesizer.trust_score || 'N/A';
        personaData.synthesizerScoreClass = getScoreClass(trace.synthesizer.trust_score || 50);
        personaData.synthesizerReasoning = trace.synthesizer.reasoning || 'N/A';
        personaData.strongerCase = trace.synthesizer.stronger_case || 'N/A';
        personaData.agreements = Array.isArray(trace.synthesizer.agreements)
          ? trace.synthesizer.agreements.join('; ')
          : (trace.synthesizer.agreements || 'N/A');
        personaData.disagreements = Array.isArray(trace.synthesizer.disagreements)
          ? trace.synthesizer.disagreements.join('; ')
          : (trace.synthesizer.disagreements || 'N/A');
      }
    } catch (e) {
      console.warn(`  Warning: Could not parse reasoning_trace: ${e.message}`);
    }
  }

  // Parse red flags
  let redFlags = [];
  if (auditRecord.red_flags) {
    try {
      const flags = typeof auditRecord.red_flags === 'string'
        ? JSON.parse(auditRecord.red_flags)
        : auditRecord.red_flags;
      redFlags = Array.isArray(flags) ? flags.map(f => ({
        severity: f.severity || 'MEDIUM',
        text: f.text || f.description || f.flag || String(f)
      })) : [];
    } catch (e) {
      console.warn(`  Warning: Could not parse red_flags: ${e.message}`);
    }
  }

  // Prepare raw data sources
  const rawDataSources = rawDataRows.map(row => {
    let content = '';
    if (row.structured_data) {
      try {
        const parsed = typeof row.structured_data === 'string'
          ? JSON.parse(row.structured_data)
          : row.structured_data;
        content = JSON.stringify(parsed, null, 2);
      } catch (e) {
        content = row.structured_data;
      }
    } else if (row.raw_text) {
      content = row.raw_text.substring(0, 5000); // Limit raw text
    } else {
      content = '(No data)';
    }
    return {
      name: row.source_name,
      content: content
    };
  });

  // Prepare template data
  const templateData = {
    contractorName: auditRecord.business_name || contractor.business_name,
    contractorId: contractor.id,
    city: auditRecord.city || contractor.city,
    state: auditRecord.state || contractor.state,
    category: contractor.category || 'Unknown',
    auditDate: new Date(auditRecord.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    googleReviewCount: auditRecord.google_review_count || 0,
    finalScore: auditRecord.trust_score,
    scoreClass: getScoreClass(auditRecord.trust_score),
    riskLevel: auditRecord.risk_level || 'Unknown',
    recommendation: auditRecord.recommendation || 'Unknown',
    summary: auditRecord.summary || 'No summary available.',
    ...personaData,
    redFlags,
    rawDataSources
  };

  // Process template
  const html = processTemplate(template, templateData);

  // Generate PDF
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  // Sanitize filename
  const safeName = (contractor.business_name || 'Unknown')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);

  const pdfPath = path.join(OUTPUT_DIR, `${safeName}_${contractor.id}.pdf`);

  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '0.5in',
      right: '0.5in',
      bottom: '0.5in',
      left: '0.5in'
    }
  });

  await page.close();
  return pdfPath;
}

/**
 * Generate PDFs for all audited contractors
 */
async function generatePdfs(contractors) {
  console.log('\n' + '='.repeat(60));
  console.log('GENERATING PDF REPORTS');
  console.log('='.repeat(60) + '\n');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created output directory: ${OUTPUT_DIR}`);
  }

  // Load template
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Template not found: ${TEMPLATE_PATH}`);
  }
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  // Filter to contractors with audits, excluding already generated PDFs
  const auditedIds = new Set(state.audited.filter(a => a.success).map(a => a.id));
  const generatedIds = new Set(state.pdfsGenerated.map(p => p.id));

  const toGenerate = contractors.filter(c =>
    auditedIds.has(c.id) && !generatedIds.has(c.id)
  );

  console.log(`To generate: ${toGenerate.length} PDFs (${state.pdfsGenerated.length} already done)`);

  if (toGenerate.length === 0) {
    console.log('No PDFs to generate.');
    return;
  }

  // Launch Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    for (let i = 0; i < toGenerate.length; i++) {
      if (isShuttingDown) {
        console.log('Shutdown requested, stopping PDF generation.');
        break;
      }

      const contractor = toGenerate[i];
      console.log(`\n[${i + 1}/${toGenerate.length}] Generating PDF for ${contractor.business_name} (ID: ${contractor.id})...`);

      try {
        const pdfPath = await generatePdf(browser, contractor, template);

        state.pdfsGenerated.push({
          id: contractor.id,
          path: pdfPath,
          timestamp: new Date().toISOString()
        });
        console.log(`  -> Saved: ${pdfPath}`);

      } catch (err) {
        state.failed.push({
          id: contractor.id,
          error: err.message || String(err),
          stage: 'pdf',
          timestamp: new Date().toISOString()
        });
        console.error(`  -> FAILED: ${err.message}`);
      }

      saveState();
    }
  } finally {
    await browser.close();
  }
}

/**
 * Print summary
 */
function printSummary() {
  const costs = getSessionCosts();

  console.log('\n' + '='.repeat(60));
  console.log('CALIBRATION PIPELINE COMPLETE');
  console.log('='.repeat(60));
  console.log(`Selected:        ${state.selected.length}`);
  console.log(`Audited:         ${state.audited.length}`);
  console.log(`PDFs Generated:  ${state.pdfsGenerated.length}`);
  console.log(`Failed:          ${state.failed.length}`);
  console.log(`Output Dir:      ${OUTPUT_DIR}`);
  console.log(`Total API Cost:  $${costs.total.toFixed(4)}`);
  console.log(`State saved to:  ${STATE_FILE}`);

  if (state.failed.length > 0) {
    console.log('\nFailed contractors:');
    for (const f of state.failed) {
      console.log(`  ID ${f.id} (${f.stage}): ${f.error}`);
    }
  }

  console.log('='.repeat(60) + '\n');
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(`
Usage: node bin/calibrate_pipeline.js [options]

Options:
  --dry-run   Show selection only, don't run audits
  --pdf-only  Skip audits, just generate PDFs from existing audit records
  --reset     Clear state file and start fresh
  --help      Show this help message

Examples:
  node bin/calibrate_pipeline.js --dry-run      # Preview selection
  node bin/calibrate_pipeline.js                # Full pipeline
  node bin/calibrate_pipeline.js --pdf-only     # Regenerate PDFs only
  node bin/calibrate_pipeline.js --reset        # Start fresh
`);
    process.exit(0);
  }

  setupShutdownHandlers();
  resetSessionCosts();

  // Handle --reset flag
  if (args.includes('--reset')) {
    resetState();
  } else {
    loadState();
  }

  const dryRun = args.includes('--dry-run');
  const pdfOnly = args.includes('--pdf-only');

  try {
    // Select contractors (or use existing selection)
    if (state.selected.length === 0) {
      state.selected = await selectContractors();
      state.startedAt = new Date().toISOString();
      saveState();
    } else {
      console.log(`\nUsing existing selection of ${state.selected.length} contractors`);
      console.log('Use --reset to select new contractors\n');
    }

    if (dryRun) {
      console.log('\n-- DRY RUN MODE: No audits or PDFs generated --');
      printSummary();
      await db.close();
      process.exit(0);
    }

    // Run audits (unless pdf-only)
    if (!pdfOnly) {
      await runAudits(state.selected);
    } else {
      console.log('\n-- PDF ONLY MODE: Skipping audits --');
    }

    // Generate PDFs
    await generatePdfs(state.selected);

    // Print summary
    printSummary();

  } catch (err) {
    console.error('Fatal error:', err);
    saveState();
    await db.close();
    process.exit(1);
  }

  await db.close();
  process.exit(0);
}

main();
