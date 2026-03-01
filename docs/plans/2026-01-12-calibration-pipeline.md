# Calibration Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a pipeline that selects 20 stratified contractors, runs dialectic council audits, and generates comprehensive PDF reports for manual calibration/ground-truth establishment.

**Architecture:** Single Node.js script (`bin/calibrate_pipeline.js`) that queries DB for 20 contractors (4 good / 4 bad / 6 grey-rich / 6 grey-poor), runs `orchestrator.runForensicAudit()` with dialectic mode, then uses Puppeteer to render HTML → PDF reports containing council output + raw data appendix.

**Tech Stack:** Node.js, PostgreSQL (via db_pg.js), Puppeteer, existing orchestrator/audit infrastructure

---

## Task 1: Create HTML Report Template

**Files:**
- Create: `templates/calibration_report.html`

**Step 1: Create templates directory if needed**

```bash
mkdir -p templates
```

**Step 2: Create the HTML template**

Create `templates/calibration_report.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>{{contractorName}} - Calibration Audit Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11px;
      line-height: 1.4;
      color: #333;
      padding: 20px;
    }
    .header {
      border-bottom: 3px solid #2c3e50;
      padding-bottom: 15px;
      margin-bottom: 20px;
    }
    .header h1 { font-size: 24px; color: #2c3e50; }
    .header .meta { color: #666; margin-top: 5px; }

    .section { margin-bottom: 25px; page-break-inside: avoid; }
    .section h2 {
      font-size: 14px;
      background: #2c3e50;
      color: white;
      padding: 8px 12px;
      margin-bottom: 10px;
    }
    .section-content { padding: 10px; background: #f9f9f9; border: 1px solid #ddd; }

    .score-box {
      display: inline-block;
      padding: 15px 25px;
      font-size: 28px;
      font-weight: bold;
      border-radius: 8px;
      margin: 10px 0;
    }
    .score-high { background: #27ae60; color: white; }
    .score-medium { background: #f39c12; color: white; }
    .score-low { background: #e74c3c; color: white; }

    .persona {
      border: 1px solid #bdc3c7;
      padding: 12px;
      margin: 10px 0;
      background: white;
    }
    .persona h3 {
      font-size: 12px;
      color: #2980b9;
      margin-bottom: 8px;
      border-bottom: 1px solid #eee;
      padding-bottom: 5px;
    }
    .persona .score { font-weight: bold; font-size: 16px; }
    .persona .reasoning { margin-top: 8px; font-style: italic; color: #555; }

    .annotator-section {
      border: 2px dashed #3498db;
      padding: 20px;
      min-height: 200px;
      background: #fff;
    }
    .annotator-section h3 { color: #3498db; margin-bottom: 15px; }
    .annotator-field { margin: 15px 0; }
    .annotator-field label { display: block; font-weight: bold; margin-bottom: 5px; }
    .annotator-field .input-line {
      border-bottom: 1px solid #ccc;
      height: 25px;
      margin-top: 5px;
    }
    .annotator-field textarea-placeholder {
      border: 1px solid #ccc;
      min-height: 80px;
      display: block;
      background: #fafafa;
    }

    .raw-data {
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 9px;
      white-space: pre-wrap;
      word-wrap: break-word;
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 15px;
      max-height: none;
      overflow: visible;
    }

    .red-flag {
      padding: 8px;
      margin: 5px 0;
      border-left: 4px solid;
    }
    .red-flag.CRITICAL { border-color: #c0392b; background: #fadbd8; }
    .red-flag.HIGH { border-color: #e74c3c; background: #f9ebea; }
    .red-flag.MEDIUM { border-color: #f39c12; background: #fef9e7; }
    .red-flag.LOW { border-color: #3498db; background: #ebf5fb; }

    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #ecf0f1; }

    .page-break { page-break-before: always; }

    @media print {
      body { padding: 10px; }
      .raw-data { font-size: 8px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>{{contractorName}}</h1>
    <div class="meta">
      <strong>Location:</strong> {{city}}, {{state}} |
      <strong>Contractor ID:</strong> {{contractorId}} |
      <strong>Audit Date:</strong> {{auditDate}}
    </div>
    <div class="meta">
      <strong>Category:</strong> {{category}} |
      <strong>Google Reviews:</strong> {{googleReviewCount}}
    </div>
  </div>

  <!-- SECTION 1: FINAL VERDICT -->
  <div class="section">
    <h2>1. COUNCIL VERDICT</h2>
    <div class="section-content">
      <div class="score-box {{scoreClass}}">{{finalScore}}/100</div>
      <p><strong>Risk Level:</strong> {{riskLevel}} | <strong>Recommendation:</strong> {{recommendation}}</p>
      <p style="margin-top: 10px;"><strong>Summary:</strong> {{summary}}</p>
    </div>
  </div>

  <!-- SECTION 2: THREE PERSONA ANALYSIS -->
  <div class="section">
    <h2>2. COUNCIL ANALYSIS (Three Personas)</h2>
    <div class="section-content">
      <div class="persona">
        <h3>Consumer Advocate (Skeptical)</h3>
        <div class="score">Score: {{advocateScore}}/100 | Confidence: {{advocateConfidence}}%</div>
        <div class="reasoning">{{advocateReasoning}}</div>
        {{#if advocateConcerns}}
        <div style="margin-top: 8px;"><strong>Key Concerns:</strong> {{advocateConcerns}}</div>
        {{/if}}
      </div>

      <div class="persona">
        <h3>Fair Arbiter (Charitable)</h3>
        <div class="score">Score: {{arbiterScore}}/100 | Confidence: {{arbiterConfidence}}%</div>
        <div class="reasoning">{{arbiterReasoning}}</div>
        {{#if arbiterPositives}}
        <div style="margin-top: 8px;"><strong>Key Positives:</strong> {{arbiterPositives}}</div>
        {{/if}}
      </div>

      <div class="persona">
        <h3>Synthesizer (Final Judge)</h3>
        <div class="score">Score: {{synthesizerScore}}/100</div>
        <div class="reasoning">{{synthesizerReasoning}}</div>
        <div style="margin-top: 8px;">
          <strong>Stronger Case:</strong> {{strongerCase}}<br>
          <strong>Agreements:</strong> {{agreements}}<br>
          <strong>Disagreements:</strong> {{disagreements}}
        </div>
      </div>
    </div>
  </div>

  <!-- SECTION 3: RED FLAGS -->
  <div class="section">
    <h2>3. RED FLAGS IDENTIFIED</h2>
    <div class="section-content">
      {{#if redFlags}}
      {{#each redFlags}}
      <div class="red-flag {{this.severity}}">
        <strong>[{{this.severity}}]</strong> {{this.description}}
        {{#if this.source}}<br><small>Source: {{this.source}}</small>{{/if}}
      </div>
      {{/each}}
      {{else}}
      <p>No red flags identified.</p>
      {{/if}}
    </div>
  </div>

  <!-- SECTION 4: HUMAN ANNOTATOR WORKSHEET -->
  <div class="section page-break">
    <h2>4. HUMAN ANNOTATOR WORKSHEET</h2>
    <div class="annotator-section">
      <h3>Your Manual Assessment</h3>

      <div class="annotator-field">
        <label>Your Trust Score (0-100):</label>
        <div class="input-line"></div>
      </div>

      <div class="annotator-field">
        <label>Your Confidence (0-100):</label>
        <div class="input-line"></div>
      </div>

      <div class="annotator-field">
        <label>Do you agree with the Council? (Y/N):</label>
        <div class="input-line"></div>
      </div>

      <div class="annotator-field">
        <label>If NO, why do you disagree?</label>
        <div class="textarea-placeholder" style="min-height: 60px;"></div>
      </div>

      <div class="annotator-field">
        <label>Which persona was most accurate? (Advocate / Arbiter / Synthesizer):</label>
        <div class="input-line"></div>
      </div>

      <div class="annotator-field">
        <label>What did the Council miss?</label>
        <div class="textarea-placeholder" style="min-height: 60px;"></div>
      </div>

      <div class="annotator-field">
        <label>What did the Council over-weight?</label>
        <div class="textarea-placeholder" style="min-height: 60px;"></div>
      </div>

      <div class="annotator-field">
        <label>Additional Notes:</label>
        <div class="textarea-placeholder" style="min-height: 80px;"></div>
      </div>
    </div>
  </div>

  <!-- SECTION 5: RAW DATA APPENDIX -->
  <div class="section page-break">
    <h2>5. RAW DATA APPENDIX</h2>
    <div class="section-content">
      <p><em>All collected source data for this contractor:</em></p>

      {{#each rawDataSources}}
      <h4 style="margin-top: 15px; background: #34495e; color: white; padding: 5px 10px;">
        {{this.sourceName}} ({{this.status}})
      </h4>
      <div class="raw-data">{{this.data}}</div>
      {{/each}}
    </div>
  </div>

  <!-- FOOTER -->
  <div style="margin-top: 30px; text-align: center; color: #999; font-size: 10px;">
    Generated by TrustHome Calibration Pipeline | {{auditDate}}
  </div>
</body>
</html>
```

**Step 3: Verify template created**

```bash
ls -la templates/calibration_report.html
```

Expected: File exists with ~200 lines

---

## Task 2: Create Main Calibration Pipeline Script

**Files:**
- Create: `bin/calibrate_pipeline.js`

**Step 1: Create the script**

Create `bin/calibrate_pipeline.js`:

```javascript
#!/usr/bin/env node
/**
 * Calibration Pipeline
 *
 * Selects 20 stratified contractors, runs dialectic audits,
 * generates PDF reports for manual calibration/ground-truth establishment.
 *
 * Usage:
 *   node bin/calibrate_pipeline.js              # Full run (20 contractors)
 *   node bin/calibrate_pipeline.js --dry-run    # Show selection only
 *   node bin/calibrate_pipeline.js --pdf-only   # Generate PDFs from existing audits
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const db = require('../services/db_pg');
const { runForensicAudit } = require('../services/orchestrator');
const { getSessionCosts, resetSessionCosts } = require('../services/cost_tracker');

// Configuration
const OUTPUT_DIR = path.join(__dirname, '..', 'exports', 'calibration', new Date().toISOString().split('T')[0]);
const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'calibration_report.html');
const STATE_FILE = path.join(__dirname, '..', 'calibration_progress.json');

// Stratified sampling configuration
const SAMPLING_CONFIG = {
  clearGood: { count: 4, query: `SELECT id, business_name, city, state, trust_score, google_review_count FROM contractors_contractor WHERE trust_score >= 80 ORDER BY google_review_count DESC LIMIT 4` },
  clearBad: { count: 4, query: `SELECT id, business_name, city, state, trust_score, google_review_count FROM contractors_contractor WHERE trust_score <= 25 AND trust_score > 0 ORDER BY google_review_count DESC LIMIT 4` },
  greyRich: { count: 6, query: `SELECT id, business_name, city, state, trust_score, google_review_count FROM contractors_contractor WHERE trust_score BETWEEN 40 AND 70 AND google_review_count >= 30 ORDER BY RANDOM() LIMIT 6` },
  greyPoor: { count: 6, query: `SELECT id, business_name, city, state, trust_score, google_review_count FROM contractors_contractor WHERE trust_score BETWEEN 40 AND 70 AND (google_review_count < 10 OR google_review_count IS NULL) ORDER BY RANDOM() LIMIT 6` }
};

// State management
let state = {
  selected: [],
  audited: [],
  pdfGenerated: [],
  failed: [],
  startedAt: null
};

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      console.log(`Loaded state: ${state.audited.length} audited, ${state.pdfGenerated.length} PDFs generated`);
    } catch (e) {
      console.warn('Could not load state, starting fresh');
    }
  }
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Select 20 contractors using stratified sampling
 */
async function selectContractors() {
  console.log('\n' + '='.repeat(60));
  console.log('  STRATIFIED CONTRACTOR SELECTION');
  console.log('='.repeat(60));

  const selected = [];

  for (const [category, config] of Object.entries(SAMPLING_CONFIG)) {
    const rows = await db.exec(config.query);
    console.log(`\n${category}: Found ${rows.length} candidates`);

    for (const row of rows) {
      selected.push({
        id: row.id,
        name: row.business_name,
        city: row.city,
        state: row.state,
        currentScore: row.trust_score,
        reviewCount: row.google_review_count || 0,
        category
      });
      console.log(`  - [${row.id}] ${row.business_name} (${row.city}) - Score: ${row.trust_score}, Reviews: ${row.google_review_count || 0}`);
    }
  }

  console.log(`\nTotal selected: ${selected.length} contractors`);
  return selected;
}

/**
 * Run dialectic audit on a contractor
 */
async function runAudit(contractor) {
  console.log(`\nAuditing: ${contractor.name} (ID: ${contractor.id})...`);

  try {
    const result = await runForensicAudit(
      { id: contractor.id },
      { mode: 'dialectic', batchMode: true, skipCollection: false }
    );

    if (!result) {
      throw new Error('Audit returned null');
    }

    return {
      success: true,
      contractorId: contractor.id,
      trustScore: result.trust_score,
      riskLevel: result.risk_level,
      recommendation: result.recommendation,
      reasoningTrace: result.reasoning_trace,
      redFlags: result.red_flags,
      cost: result.total_cost
    };

  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    return { success: false, contractorId: contractor.id, error: err.message };
  }
}

/**
 * Fetch raw data for a contractor from DB
 */
async function fetchRawData(contractorId) {
  const rows = await db.exec(`
    SELECT source_name, raw_text, structured_data, fetch_status
    FROM contractor_raw_data
    WHERE contractor_id = $1
    ORDER BY source_name
  `, [contractorId]);

  return rows.map(row => ({
    sourceName: row.source_name,
    status: row.fetch_status,
    data: row.structured_data
      ? JSON.stringify(JSON.parse(row.structured_data), null, 2)
      : (row.raw_text || 'No data')
  }));
}

/**
 * Fetch audit record from DB
 */
async function fetchAuditRecord(contractorId) {
  const rows = await db.exec(`
    SELECT ar.*, cc.business_name, cc.city, cc.state, cc.google_review_count
    FROM audit_records ar
    JOIN contractors_contractor cc ON ar.contractor_id = cc.id
    WHERE ar.contractor_id = $1
    ORDER BY ar.created_at DESC
    LIMIT 1
  `, [contractorId]);

  return rows[0] || null;
}

/**
 * Parse reasoning trace to extract persona details
 */
function parseReasoningTrace(trace) {
  if (!trace) return {};

  try {
    // The reasoning trace may be JSON or formatted text
    if (trace.startsWith('{') || trace.startsWith('[')) {
      return JSON.parse(trace);
    }

    // Parse text format
    const result = {
      advocate: { score: 0, confidence: 0, reasoning: '', concerns: [] },
      arbiter: { score: 0, confidence: 0, reasoning: '', positives: [] },
      synthesizer: { score: 0, reasoning: '', strongerCase: '', agreements: [], disagreements: [] }
    };

    // Extract sections using regex patterns
    const advocateMatch = trace.match(/Consumer Advocate.*?Score:\s*(\d+).*?Confidence:\s*(\d+)/s);
    if (advocateMatch) {
      result.advocate.score = parseInt(advocateMatch[1]);
      result.advocate.confidence = parseInt(advocateMatch[2]);
    }

    const arbiterMatch = trace.match(/Fair Arbiter.*?Score:\s*(\d+).*?Confidence:\s*(\d+)/s);
    if (arbiterMatch) {
      result.arbiter.score = parseInt(arbiterMatch[1]);
      result.arbiter.confidence = parseInt(arbiterMatch[2]);
    }

    return result;
  } catch (e) {
    console.warn('Could not parse reasoning trace:', e.message);
    return {};
  }
}

/**
 * Generate PDF report for a contractor
 */
async function generatePDF(contractor, browser) {
  const auditRecord = await fetchAuditRecord(contractor.id);
  if (!auditRecord) {
    console.log(`  No audit record found for ${contractor.name}`);
    return null;
  }

  const rawData = await fetchRawData(contractor.id);
  const trace = parseReasoningTrace(auditRecord.reasoning_trace);

  // Load template
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  // Calculate score class
  const score = auditRecord.trust_score || 0;
  const scoreClass = score >= 70 ? 'score-high' : score >= 40 ? 'score-medium' : 'score-low';

  // Simple template replacement (no handlebars needed)
  const replacements = {
    '{{contractorName}}': contractor.name,
    '{{city}}': contractor.city,
    '{{state}}': contractor.state,
    '{{contractorId}}': contractor.id,
    '{{auditDate}}': new Date().toISOString().split('T')[0],
    '{{category}}': contractor.category,
    '{{googleReviewCount}}': contractor.reviewCount || 0,
    '{{finalScore}}': score,
    '{{scoreClass}}': scoreClass,
    '{{riskLevel}}': auditRecord.risk_level || 'Unknown',
    '{{recommendation}}': auditRecord.recommendation || 'Unknown',
    '{{summary}}': trace.synthesizer?.summary || auditRecord.reasoning_trace?.substring(0, 500) || 'No summary available',
    '{{advocateScore}}': trace.advocate?.score || 'N/A',
    '{{advocateConfidence}}': trace.advocate?.confidence || 'N/A',
    '{{advocateReasoning}}': trace.advocate?.reasoning || 'See reasoning trace',
    '{{advocateConcerns}}': Array.isArray(trace.advocate?.concerns) ? trace.advocate.concerns.join(', ') : '',
    '{{arbiterScore}}': trace.arbiter?.score || 'N/A',
    '{{arbiterConfidence}}': trace.arbiter?.confidence || 'N/A',
    '{{arbiterReasoning}}': trace.arbiter?.reasoning || 'See reasoning trace',
    '{{arbiterPositives}}': Array.isArray(trace.arbiter?.positives) ? trace.arbiter.positives.join(', ') : '',
    '{{synthesizerScore}}': trace.synthesizer?.score || score,
    '{{synthesizerReasoning}}': trace.synthesizer?.reasoning || 'See full reasoning trace',
    '{{strongerCase}}': trace.synthesizer?.strongerCase || 'balanced',
    '{{agreements}}': Array.isArray(trace.synthesizer?.agreements) ? trace.synthesizer.agreements.join('; ') : 'See trace',
    '{{disagreements}}': Array.isArray(trace.synthesizer?.disagreements) ? JSON.stringify(trace.synthesizer.disagreements) : 'See trace'
  };

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), String(value));
  }

  // Handle red flags
  const redFlags = auditRecord.red_flags || [];
  let redFlagsHtml = '';
  if (Array.isArray(redFlags) && redFlags.length > 0) {
    for (const flag of redFlags) {
      redFlagsHtml += `
        <div class="red-flag ${flag.severity || 'MEDIUM'}">
          <strong>[${flag.severity || 'MEDIUM'}]</strong> ${flag.description || flag}
          ${flag.source ? `<br><small>Source: ${flag.source}</small>` : ''}
        </div>`;
    }
  } else {
    redFlagsHtml = '<p>No red flags identified.</p>';
  }
  html = html.replace(/\{\{#if redFlags\}\}[\s\S]*?\{\{\/if\}\}/g, redFlagsHtml);
  html = html.replace(/\{\{#each redFlags\}\}[\s\S]*?\{\{\/each\}\}/g, '');

  // Handle raw data sources
  let rawDataHtml = '';
  for (const source of rawData) {
    // Escape HTML in data
    const escapedData = source.data
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    rawDataHtml += `
      <h4 style="margin-top: 15px; background: #34495e; color: white; padding: 5px 10px;">
        ${source.sourceName} (${source.status})
      </h4>
      <div class="raw-data">${escapedData}</div>`;
  }
  html = html.replace(/\{\{#each rawDataSources\}\}[\s\S]*?\{\{\/each\}\}/g, rawDataHtml);

  // Generate PDF
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  const safeName = contractor.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const pdfPath = path.join(OUTPUT_DIR, `${safeName}_${contractor.id}.pdf`);

  await page.pdf({
    path: pdfPath,
    format: 'A4',
    margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
    printBackground: true
  });

  await page.close();
  console.log(`  Generated: ${pdfPath}`);
  return pdfPath;
}

/**
 * Main pipeline
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const pdfOnly = args.includes('--pdf-only');
  const reset = args.includes('--reset');

  console.log('\n' + '='.repeat(60));
  console.log('  CALIBRATION PIPELINE');
  console.log('  Ground Truth Generation for LLM Scoring');
  console.log('='.repeat(60));

  // Setup
  if (reset && fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
    console.log('State reset.');
  }
  loadState();

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created output directory: ${OUTPUT_DIR}`);
  }

  // Phase 1: Selection
  if (state.selected.length === 0) {
    state.selected = await selectContractors();
    state.startedAt = new Date().toISOString();
    saveState();
  } else {
    console.log(`\nUsing ${state.selected.length} previously selected contractors`);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] Would audit these contractors:');
    for (const c of state.selected) {
      console.log(`  - [${c.id}] ${c.name} (${c.category})`);
    }
    await db.close();
    return;
  }

  // Phase 2: Audits (skip if --pdf-only)
  if (!pdfOnly) {
    resetSessionCosts();
    const auditedSet = new Set(state.audited.map(a => a.contractorId));
    const toAudit = state.selected.filter(c => !auditedSet.has(c.id));

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  RUNNING DIALECTIC AUDITS (${toAudit.length} remaining)`);
    console.log('='.repeat(60));

    for (let i = 0; i < toAudit.length; i++) {
      const contractor = toAudit[i];
      console.log(`\n[${i + 1}/${toAudit.length}] ${contractor.name}`);

      const result = await runAudit(contractor);

      if (result.success) {
        state.audited.push(result);
        console.log(`  -> Score: ${result.trustScore}/100 (${result.recommendation})`);
      } else {
        state.failed.push({ contractorId: contractor.id, error: result.error });
      }
      saveState();
    }

    const costs = getSessionCosts();
    console.log(`\nAudit phase complete. Total cost: $${costs.total?.toFixed(4) || '0.00'}`);
  }

  // Phase 3: PDF Generation
  console.log(`\n${'='.repeat(60)}`);
  console.log('  GENERATING PDF REPORTS');
  console.log('='.repeat(60));

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const pdfSet = new Set(state.pdfGenerated.map(p => p.contractorId));

  for (const contractor of state.selected) {
    if (pdfSet.has(contractor.id)) {
      console.log(`  Skipping ${contractor.name} (already generated)`);
      continue;
    }

    try {
      const pdfPath = await generatePDF(contractor, browser);
      if (pdfPath) {
        state.pdfGenerated.push({ contractorId: contractor.id, path: pdfPath });
        saveState();
      }
    } catch (err) {
      console.error(`  Failed to generate PDF for ${contractor.name}: ${err.message}`);
    }
  }

  await browser.close();

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('  CALIBRATION PIPELINE COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Contractors selected: ${state.selected.length}`);
  console.log(`  Audits completed:     ${state.audited.length}`);
  console.log(`  PDFs generated:       ${state.pdfGenerated.length}`);
  console.log(`  Failed:               ${state.failed.length}`);
  console.log(`\n  Output directory: ${OUTPUT_DIR}`);
  console.log('='.repeat(60));

  await db.close();
}

// CLI
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Step 2: Make script executable**

```bash
chmod +x bin/calibrate_pipeline.js
```

**Step 3: Verify script created**

```bash
head -30 bin/calibrate_pipeline.js
```

Expected: Shows the shebang and file header

---

## Task 3: Test with Dry Run

**Files:**
- None (testing only)

**Step 1: Run dry run to test selection logic**

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate && set -a && . ./.env && set +a
node bin/calibrate_pipeline.js --dry-run
```

Expected output:
```
STRATIFIED CONTRACTOR SELECTION
clearGood: Found 4 candidates
  - [xxx] Company A (City) - Score: 85, Reviews: 100
  ...
clearBad: Found 4 candidates
  ...
greyRich: Found 6 candidates
  ...
greyPoor: Found 6 candidates
  ...
Total selected: 20 contractors

[DRY RUN] Would audit these contractors:
  - [xxx] Company A (clearGood)
  ...
```

**Step 2: Review selection for sanity**

Verify:
- 4 contractors with score >= 80
- 4 contractors with score <= 25
- 6 contractors with score 40-70 AND reviews >= 30
- 6 contractors with score 40-70 AND reviews < 10

---

## Task 4: Test Single Audit + PDF

**Files:**
- None (testing only)

**Step 1: Run pipeline with just first contractor**

Modify the queries temporarily to LIMIT 1 each, or:

```bash
# First run one dialectic audit manually to test
node bin/run_audit.js --id <first_contractor_id> --mode dialectic
```

**Step 2: Test PDF generation on existing audit**

```bash
node bin/calibrate_pipeline.js --pdf-only
```

**Step 3: Open generated PDF and verify sections**

```bash
ls -la exports/calibration/$(date +%Y-%m-%d)/
xdg-open exports/calibration/$(date +%Y-%m-%d)/*.pdf  # Or use file manager
```

Verify PDF contains:
- [ ] Header with contractor info
- [ ] Council verdict with score
- [ ] Three persona analysis section
- [ ] Red flags section
- [ ] Human annotator worksheet (blank fields)
- [ ] Raw data appendix

---

## Task 5: Run Full Pipeline

**Files:**
- None (execution only)

**Step 1: Reset state and run full pipeline**

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate && set -a && . ./.env && set +a
node bin/calibrate_pipeline.js --reset
```

**Expected duration:** 1-2 hours (20 contractors × 5-10 min each for fresh collection + audit)

**Step 2: Monitor progress**

```bash
# In another terminal
watch -n 30 'cat calibration_progress.json | jq ".audited | length"'
```

**Step 3: If interrupted, resume**

```bash
node bin/calibrate_pipeline.js  # Will resume from saved state
```

**Step 4: Verify all 20 PDFs generated**

```bash
ls -la exports/calibration/$(date +%Y-%m-%d)/ | wc -l
# Should show 20 PDF files (+ 1 for header line)
```

---

## Task 6: Create Summary Index

**Files:**
- Create: Script generates `exports/calibration/YYYY-MM-DD/index.md`

**Step 1: Add index generation to pipeline (optional enhancement)**

After all PDFs generated, create a summary:

```bash
# Manual creation for now
cd exports/calibration/$(date +%Y-%m-%d)
echo "# Calibration Set - $(date +%Y-%m-%d)" > index.md
echo "" >> index.md
echo "| ID | Name | Category | Council Score | PDF |" >> index.md
echo "|---|---|---|---|---|" >> index.md
```

Then populate from state file.

---

## Verification Checklist

After full pipeline run:

- [ ] 20 PDFs in `exports/calibration/YYYY-MM-DD/`
- [ ] 4 PDFs are "clearGood" category (score >= 80)
- [ ] 4 PDFs are "clearBad" category (score <= 25)
- [ ] 6 PDFs are "greyRich" category (score 40-70, reviews >= 30)
- [ ] 6 PDFs are "greyPoor" category (score 40-70, reviews < 10)
- [ ] Each PDF has all 5 sections (verdict, personas, red flags, annotator, raw data)
- [ ] `calibration_progress.json` shows 20 audited, 20 pdfGenerated
- [ ] Total API cost logged

---

## Notes

- **Resumability:** Pipeline saves state after each audit. Safe to interrupt and resume.
- **PDF-only mode:** Use `--pdf-only` to regenerate PDFs from existing audits without re-running collection/audit
- **Fresh data:** Does NOT use `--skip-collection` - always collects fresh data for calibration accuracy
- **Cost estimate:** ~$0.003-0.007 per audit × 20 = $0.06-0.14 total for audits
