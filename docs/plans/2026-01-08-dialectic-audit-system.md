# Dialectic Audit System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace mechanical score anchors with three-persona dialectic reasoning (Consumer Advocate, Fair Arbiter, Synthesizer) that produces trust scores through adversarial analysis.

**Architecture:** Three sequential DeepSeek passes. Advocate finds reasons NOT to trust. Arbiter finds reasons TO trust. Synthesizer weighs both perspectives against raw data to produce final verdict. All score anchors, caps, and multipliers are stripped.

**Tech Stack:** Node.js, DeepSeek API, existing PostgreSQL schema

---

## Task 1: Add --mode=dialectic Flag to CLI

**Files:**
- Modify: `bin/run_audit.js:16-23` (arg parsing)
- Modify: `bin/run_audit.js:25-56` (help text)
- Modify: `bin/run_audit.js:94-99` (options object)

**Step 1: Add mode to arg parser**

In `bin/run_audit.js`, update the `getArg` function's boolean list and add mode parsing:

```javascript
// Line 21 - add 'dialectic' to boolean flags isn't needed, it takes a value
// But we need to handle --mode flag

const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  if (['dry-run', 'skip-collection', 'collect-only', 'list', 'help', 'strict'].includes(name)) return true;
  return args[idx + 1];
};
```

No change needed to getArg - it already handles value flags.

**Step 2: Add to help text**

After line 45 (before --list), add:

```javascript
  --mode <mode>       Audit mode: 'standard' (default) or 'dialectic'
                      Dialectic uses three-persona adversarial analysis
```

**Step 3: Add to options object**

Around line 94-99, update the options object:

```javascript
  // Options
  const options = {
    dryRun: getArg('dry-run') || false,
    skipCollection: getArg('skip-collection') || false,
    collectOnly: getArg('collect-only') || false,
    mode: getArg('mode') || 'standard'  // ADD THIS LINE
  };
```

**Step 4: Verify help displays correctly**

Run: `node bin/run_audit.js --help`

Expected: Help text shows `--mode <mode>` option with description.

**Step 5: Commit**

```bash
git add bin/run_audit.js
git commit -m "feat: add --mode=dialectic flag to audit CLI"
```

---

## Task 2: Create DialecticAuditAgent Class

**Files:**
- Modify: `services/audit_agent.js` (add new class after existing AuditAgent)

**Step 1: Add persona prompt constants after line 135**

```javascript
const ADVOCATE_PROMPT = `You are the Consumer Advocate - a skeptical investigator who protects homeowners.

YOUR JOB: Find reasons NOT to trust this contractor.

YOUR MINDSET:
- Bad actors game reviews. Look for patterns that indicate manipulation.
- BBB F ratings are damning - businesses can respond to complaints but chose not to.
- When you see a pattern of complaints, assume the pattern is real.
- Missing data in critical areas (licensing, insurance) is a red flag, not neutral.
- Your job is to surface every legitimate concern a homeowner should know about.

ANALYZE THE DATA:
1. What claims does this contractor make? (years in business, licensing, quality)
2. What does the evidence actually show?
3. Where are the gaps, inconsistencies, or warning signs?
4. What's the worst reasonable interpretation of this evidence?

YOUR OUTPUT must be JSON:
{
  "trust_score": <0-100, reflecting your skeptical assessment>,
  "assessment_confidence": <0-100, how certain you are about your score>,
  "data_confidence": <0-100, how reliable is the underlying evidence>,
  "reasoning": "<Your detailed analysis. Be specific. Cite evidence. Another analyst should be able to challenge your reasoning.>",
  "key_concerns": ["<Specific concern 1>", "<Specific concern 2>"],
  "acknowledged_positives": ["<Strongest positive signal you see, and why it doesn't override concerns>"],
  "data_gaps": ["<What couldn't you verify>"]
}`;

const ARBITER_PROMPT = `You are the Fair Arbiter - a balanced investigator who gives benefit of the doubt.

YOUR JOB: Find reasons this contractor might be trustworthy despite red flags.

YOUR MINDSET:
- Unhappy customers review more than happy ones. Consider selection bias.
- Every business gets some bad reviews. Look for resolution patterns.
- BBB ratings reflect complaint handling, not necessarily quality. Ask what complaints were about.
- Missing data might be a database issue, not deception. A sole proprietor may not have LLC registration - that's legal.
- Context matters. A 2-year-old business can't have 10 years of reviews.
- Your job is to find the reasonable interpretation that favors the contractor.

ANALYZE THE DATA:
1. What positive signals exist? (review volume, resolution of issues, longevity)
2. For each red flag, what's the charitable interpretation?
3. What context might explain apparent problems?
4. What's the best reasonable interpretation of this evidence?

YOUR OUTPUT must be JSON:
{
  "trust_score": <0-100, reflecting your charitable assessment>,
  "assessment_confidence": <0-100, how certain you are about your score>,
  "data_confidence": <0-100, how reliable is the underlying evidence>,
  "reasoning": "<Your detailed analysis. Be specific. Cite evidence. Another analyst should be able to challenge your reasoning.>",
  "key_positives": ["<Specific positive 1>", "<Specific positive 2>"],
  "acknowledged_concerns": ["<Legitimate concern you see, and why it might not be disqualifying>"],
  "data_gaps": ["<What couldn't you verify>"]
}`;

const SYNTHESIZER_PROMPT = `You are the Synthesizer - a senior analyst who produces the final assessment.

You have read two perspectives:
- The Consumer Advocate (skeptical, protective of homeowners)
- The Fair Arbiter (charitable, gives benefit of the doubt)

YOUR JOB: Weigh both perspectives against the raw data and produce the final verdict.

YOUR PROCESS:
1. AGREEMENTS: Where do both analysts agree? These are high-confidence findings.
2. DISAGREEMENTS: Where do they differ? Identify the specific evidence they weighted differently.
3. YOUR JUDGMENT: Who made the stronger case and why? What did one analyst see that the other missed or dismissed?
4. FINAL SCORE: Your score emerges from your reasoning. Don't average the two scores - make your own judgment.

CRITICAL RULES:
- If both analysts agree (within 15 points), your confidence should be HIGH.
- If they disagree by 30+ points, you MUST explain which specific evidence each weighted differently.
- Your reasoning must be detailed enough that a third analyst could challenge it.

YOUR OUTPUT must be JSON:
{
  "final_trust_score": <0-100>,
  "final_assessment_confidence": <0-100>,
  "final_data_confidence": <0-100>,
  "agreements": ["<Point both analysts agreed on>"],
  "disagreements": [
    {
      "point": "<The disputed issue>",
      "advocate_view": "<What the Advocate said>",
      "arbiter_view": "<What the Arbiter said>",
      "your_judgment": "<Who was right and why>"
    }
  ],
  "stronger_case": "<advocate|arbiter|balanced>",
  "stronger_case_reasoning": "<Why one perspective was more compelling, or why they balanced out>",
  "summary": "<Final assessment in 2-3 sentences>",
  "red_flags": [
    {"severity": "<HIGH|MEDIUM|LOW>", "description": "<what you found>", "source": "<evidence source>"}
  ],
  "verified_positives": ["<Verified positive finding>"],
  "unverified_items": ["<What remains uncertain>"]
}`;
```

**Step 2: Add DialecticAuditAgent class after existing AuditAgent class (after line 477)**

```javascript
class DialecticAuditAgent {
  constructor(db, contractorId, contractor) {
    this.db = db;
    this.contractorId = contractorId;
    this.contractor = contractor;
    this.totalCost = 0;
  }

  /**
   * Build the data prompt with all collected data
   * (Reuses logic from AuditAgent)
   */
  async buildDataPrompt() {
    const rows = await this.db.exec(`
      SELECT source_name, raw_text, structured_data, fetch_status
      FROM contractor_raw_data
      WHERE contractor_id = ?
      ORDER BY source_name
    `, [this.contractorId]);

    if (rows.length === 0) {
      return 'NO DATA COLLECTED - cannot audit without data.';
    }

    let prompt = `## CONTRACTOR INFO
Name: ${this.contractor.name}
Location: ${this.contractor.city}, ${this.contractor.state}
Website: ${this.contractor.website || 'Not provided'}

## COLLECTED DATA\n`;

    let totalChars = 0;
    const MAX_CHARS = 60000;

    for (const row of rows) {
      const { source_name, raw_text, structured_data, fetch_status } = row;

      if (fetch_status !== 'success' && fetch_status !== 'not_found') continue;

      let content = '';
      if (structured_data) {
        let data = structured_data;
        if (typeof structured_data === 'string') {
          try {
            data = JSON.parse(structured_data);
          } catch {
            data = structured_data;
          }
        }

        if (typeof data === 'object' && data !== null) {
          if (source_name === 'county_liens' && data.lien_score) {
            content = JSON.stringify({
              lien_score: data.lien_score,
              summary: data.summary,
              total_records: data.total_records,
              search_term: data.search_term
            }, null, 2);
          } else if (source_name === 'review_analysis' && data.summary) {
            content = JSON.stringify(data, null, 2);
          } else {
            const full = JSON.stringify(data, null, 2);
            if (full.length > 5000) {
              content = full.substring(0, 5000) + '\n...[truncated]';
            } else {
              content = full;
            }
          }
        } else {
          content = String(data);
        }
      } else if (raw_text) {
        content = raw_text.length > 3000 ? raw_text.substring(0, 3000) + '...[truncated]' : raw_text;
      } else {
        content = `[${fetch_status}]`;
      }

      const section = `\n### ${source_name.toUpperCase()}\n${content}\n`;

      if (totalChars + section.length > MAX_CHARS) {
        prompt += `\n### ${source_name.toUpperCase()}\n[Content truncated - ${raw_text?.length || 0} chars]\n`;
      } else {
        prompt += section;
        totalChars += section.length;
      }
    }

    return prompt;
  }

  /**
   * Run a single persona pass
   */
  async runPersona(personaName, systemPrompt, dataPrompt) {
    log(`\n🎭 Running ${personaName}...`);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: dataPrompt }
    ];

    const response = await this.callDeepSeek(messages);
    this.totalCost += this.estimateCost(response);

    const content = response.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        success(`  ✓ ${personaName} complete (score: ${result.trust_score || result.final_trust_score})`);
        return result;
      } catch (e) {
        warn(`  ⚠ ${personaName} returned invalid JSON, retrying...`);
        // Retry once with JSON-only request
        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: 'Please respond with valid JSON only.' });

        const retry = await this.callDeepSeek(messages);
        this.totalCost += this.estimateCost(retry);

        const retryContent = retry.choices?.[0]?.message?.content || '';
        const retryMatch = retryContent.match(/\{[\s\S]*\}/);
        if (retryMatch) {
          return JSON.parse(retryMatch[0]);
        }
      }
    }

    throw new Error(`${personaName} failed to produce valid output`);
  }

  /**
   * Run the Synthesizer with both persona outputs
   */
  async runSynthesizer(dataPrompt, advocateResult, arbiterResult) {
    log(`\n🔮 Running Synthesizer...`);

    const synthesizerInput = `${dataPrompt}

## CONSUMER ADVOCATE ANALYSIS
${JSON.stringify(advocateResult, null, 2)}

## FAIR ARBITER ANALYSIS
${JSON.stringify(arbiterResult, null, 2)}

Now synthesize these two perspectives and produce your final assessment.`;

    const messages = [
      { role: 'system', content: SYNTHESIZER_PROMPT },
      { role: 'user', content: synthesizerInput }
    ];

    const response = await this.callDeepSeek(messages);
    this.totalCost += this.estimateCost(response);

    const content = response.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        success(`  ✓ Synthesizer complete (final score: ${result.final_trust_score})`);
        return result;
      } catch (e) {
        warn(`  ⚠ Synthesizer returned invalid JSON, retrying...`);
        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: 'Please respond with valid JSON only.' });

        const retry = await this.callDeepSeek(messages);
        this.totalCost += this.estimateCost(retry);

        const retryContent = retry.choices?.[0]?.message?.content || '';
        const retryMatch = retryContent.match(/\{[\s\S]*\}/);
        if (retryMatch) {
          return JSON.parse(retryMatch[0]);
        }
      }
    }

    throw new Error('Synthesizer failed to produce valid output');
  }

  /**
   * Run the full dialectic audit
   */
  async run() {
    log('\n🤖 Dialectic Audit Agent - Three Persona Analysis');

    const dataPrompt = await this.buildDataPrompt();

    // Pass 1: Consumer Advocate
    const advocateResult = await this.runPersona('Consumer Advocate', ADVOCATE_PROMPT, dataPrompt);

    // Pass 2: Fair Arbiter
    const arbiterResult = await this.runPersona('Fair Arbiter', ARBITER_PROMPT, dataPrompt);

    // Pass 3: Synthesizer
    const synthesizerResult = await this.runSynthesizer(dataPrompt, advocateResult, arbiterResult);

    // Finalize and save
    return await this.finalizeResult(synthesizerResult, advocateResult, arbiterResult);
  }

  /**
   * Finalize and save result
   */
  async finalizeResult(synthesis, advocate, arbiter) {
    const now = new Date().toISOString();

    // Validate final score
    let finalScore = synthesis.final_trust_score;
    if (typeof finalScore !== 'number') {
      finalScore = 50;
    }
    finalScore = Math.max(0, Math.min(100, finalScore));

    // Derive verdict
    let verdict, recommendation, riskLevel;
    if (finalScore >= 80) {
      verdict = 'RECOMMENDED';
      recommendation = 'RECOMMENDED';
      riskLevel = 'TRUSTED';
    } else if (finalScore >= 65) {
      verdict = 'USE CAUTION';
      recommendation = 'NOT_RECOMMENDED';
      riskLevel = 'MODERATE';
    } else if (finalScore >= 50) {
      verdict = 'NOT RECOMMENDED';
      recommendation = 'NOT_RECOMMENDED';
      riskLevel = 'MODERATE';
    } else {
      verdict = 'AVOID';
      recommendation = 'AVOID';
      riskLevel = 'HIGH';
    }

    // Build full reasoning trace
    const reasoningTrace = JSON.stringify({
      mode: 'dialectic',
      advocate: advocate,
      arbiter: arbiter,
      synthesizer: synthesis
    }, null, 2);

    // Save to audit_records
    await this.db.run(`
      INSERT INTO audit_records (
        contractor_id, audit_version, trust_score, risk_level, recommendation,
        reasoning_trace, red_flags, positive_signals, gaps_identified,
        sources_used, collection_rounds, total_cost, created_at, finalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      this.contractorId,
      4,  // audit_version 4 = dialectic
      finalScore,
      riskLevel,
      recommendation,
      reasoningTrace,
      JSON.stringify(synthesis.red_flags || []),
      JSON.stringify(synthesis.verified_positives || []),
      JSON.stringify(synthesis.unverified_items || []),
      JSON.stringify([]),
      0,
      this.totalCost,
      now,
      now
    ]);

    // Update contractor
    const passesThreshold = finalScore >= 80;
    await this.db.run(`
      UPDATE contractors_contractor SET trust_score = ?, passes_threshold = ? WHERE id = ?
    `, [finalScore, passesThreshold, this.contractorId]);

    // Display formatted output
    console.log(this.formatOutput(synthesis, advocate, arbiter, finalScore, verdict));
    success('\n✅ Dialectic audit saved to database');

    return {
      trust_score: finalScore,
      verdict,
      recommendation,
      confidence: synthesis.final_assessment_confidence,
      data_confidence: synthesis.final_data_confidence,
      advocate: advocate,
      arbiter: arbiter,
      synthesis: synthesis,
      total_cost: this.totalCost
    };
  }

  formatOutput(synthesis, advocate, arbiter, finalScore, verdict) {
    let output = `
════════════════════════════════════════════════════════════
  DIALECTIC AUDIT RESULTS
════════════════════════════════════════════════════════════

  FINAL VERDICT:    ${verdict}
  FINAL SCORE:      ${finalScore}/100
  CONFIDENCE:       Assessment ${synthesis.final_assessment_confidence}% | Data ${synthesis.final_data_confidence}%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CONSUMER ADVOCATE (Skeptical)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Score: ${advocate.trust_score}/100  |  Confidence: ${advocate.assessment_confidence}% / ${advocate.data_confidence}%

  Key concerns:`;

    for (const concern of (advocate.key_concerns || [])) {
      output += `\n  • ${concern}`;
    }

    output += `\n
  Reasoning: ${(advocate.reasoning || '').substring(0, 500)}${(advocate.reasoning || '').length > 500 ? '...' : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FAIR ARBITER (Charitable)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Score: ${arbiter.trust_score}/100  |  Confidence: ${arbiter.assessment_confidence}% / ${arbiter.data_confidence}%

  Key positives:`;

    for (const positive of (arbiter.key_positives || [])) {
      output += `\n  • ${positive}`;
    }

    output += `\n
  Reasoning: ${(arbiter.reasoning || '').substring(0, 500)}${(arbiter.reasoning || '').length > 500 ? '...' : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SYNTHESIZER ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  AGREEMENTS:`;

    for (const agreement of (synthesis.agreements || [])) {
      output += `\n  ✓ ${agreement}`;
    }

    output += `\n
  DISAGREEMENTS:`;

    for (const disagreement of (synthesis.disagreements || [])) {
      output += `\n  ⚡ ${disagreement.point}`;
      output += `\n     Advocate: ${disagreement.advocate_view}`;
      output += `\n     Arbiter: ${disagreement.arbiter_view}`;
      output += `\n     Judgment: ${disagreement.your_judgment}`;
    }

    output += `\n
  STRONGER CASE: ${synthesis.stronger_case}
  ${synthesis.stronger_case_reasoning}

  SUMMARY: ${synthesis.summary}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  RED FLAGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    for (const flag of (synthesis.red_flags || [])) {
      const color = flag.severity === 'HIGH' ? '\x1b[31m' : '\x1b[33m';
      output += `\n${color}  [${flag.severity}] ${flag.description}\x1b[0m`;
    }

    if ((synthesis.red_flags || []).length === 0) {
      output += '\n  None identified';
    }

    output += `\n
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  METADATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  API Cost: $${this.totalCost.toFixed(4)}
  Advocate Score: ${advocate.trust_score} | Arbiter Score: ${arbiter.trust_score} | Final: ${finalScore}
════════════════════════════════════════════════════════════`;

    return output;
  }

  async callDeepSeek(messages) {
    const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek error: ${response.status}`);
    }

    return response.json();
  }

  estimateCost(response) {
    const usage = response.usage || {};
    return ((usage.prompt_tokens || 0) * 0.00000014) + ((usage.completion_tokens || 0) * 0.00000028);
  }
}
```

**Step 3: Update module.exports at bottom of file**

Change the exports line to include the new class:

```javascript
module.exports = { AuditAgent, DialecticAuditAgent, getVerdict, getConfidence, formatDisplayOutput };
```

**Step 4: Verify file compiles**

Run: `node -c services/audit_agent.js`

Expected: No syntax errors

**Step 5: Commit**

```bash
git add services/audit_agent.js
git commit -m "feat: add DialecticAuditAgent with three-persona analysis"
```

---

## Task 3: Wire Orchestrator to Use Dialectic Mode

**Files:**
- Modify: `services/orchestrator.js:10` (import)
- Modify: `services/orchestrator.js:22` (destructure mode)
- Modify: `services/orchestrator.js:190-192` (agent instantiation)

**Step 1: Update import**

Change line 10 from:

```javascript
const { AuditAgent } = require('./audit_agent');
```

To:

```javascript
const { AuditAgent, DialecticAuditAgent } = require('./audit_agent');
```

**Step 2: Extract mode from options**

At line 22, update the destructuring:

```javascript
const { dryRun = false, skipCollection = false, collectOnly = false, batchMode = false, skipLiens = false, mode = 'standard' } = options;
```

**Step 3: Use correct agent based on mode**

Around line 190-192, change:

```javascript
    // Run agentic audit
    const agent = new AuditAgent(db, contractorId, contractor);
    const result = await agent.run();
```

To:

```javascript
    // Run agentic audit
    let agent;
    if (mode === 'dialectic') {
      log('\n🎭 Using DIALECTIC mode (three-persona analysis)');
      agent = new DialecticAuditAgent(db, contractorId, contractor);
    } else {
      agent = new AuditAgent(db, contractorId, contractor);
    }
    const result = await agent.run();
```

**Step 4: Verify compilation**

Run: `node -c services/orchestrator.js`

Expected: No syntax errors

**Step 5: Commit**

```bash
git add services/orchestrator.js
git commit -m "feat: wire orchestrator to use DialecticAuditAgent when --mode=dialectic"
```

---

## Task 4: Test on Contractor 141

**Step 1: Activate environment**

```bash
cd /home/astre/command-center/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
```

**Step 2: Run standard mode (baseline)**

```bash
node bin/run_audit.js --id 141 --skip-collection
```

Expected: Standard single-pass audit completes, shows score and reasoning.

**Step 3: Run dialectic mode**

```bash
node bin/run_audit.js --id 141 --skip-collection --mode dialectic
```

Expected:
- See "Using DIALECTIC mode (three-persona analysis)"
- See "Running Consumer Advocate..."
- See "Running Fair Arbiter..."
- See "Running Synthesizer..."
- Full three-section output with Advocate score, Arbiter score, and Final score
- Disagreements section shows specific tensions
- API cost ~$0.01-0.02

**Step 4: Verify database saved**

```bash
node -e "
const db = require('./services/db_pg');
(async () => {
  const rows = await db.exec('SELECT audit_version, trust_score, reasoning_trace FROM audit_records WHERE contractor_id = 141 ORDER BY created_at DESC LIMIT 1');
  console.log('Version:', rows[0].audit_version);
  console.log('Score:', rows[0].trust_score);
  const trace = JSON.parse(rows[0].reasoning_trace);
  console.log('Mode:', trace.mode);
  console.log('Advocate score:', trace.advocate?.trust_score);
  console.log('Arbiter score:', trace.arbiter?.trust_score);
  await db.close();
})();
"
```

Expected: Version 4, mode "dialectic", three separate scores visible.

---

## Task 5: Test on Contractors 656, 665, 682

**Step 1: Run dialectic on 656**

```bash
node bin/run_audit.js --id 656 --skip-collection --mode dialectic
```

**Step 2: Run dialectic on 665**

```bash
node bin/run_audit.js --id 665 --skip-collection --mode dialectic
```

**Step 3: Run dialectic on 682**

```bash
node bin/run_audit.js --id 682 --skip-collection --mode dialectic
```

**Step 4: Compare results**

For each contractor, note:
- Advocate score vs Arbiter score (spread)
- Synthesizer's final score
- Quality of disagreement analysis
- Whether reasoning engages with real tensions

**Step 5: Commit all tests passing**

```bash
git add -A
git commit -m "test: verify dialectic audit on contractors 141, 656, 665, 682"
```

---

## Task 6: Document the New Mode

**Files:**
- Modify: `CLAUDE.md` (add dialectic mode documentation)

**Step 1: Add documentation after "Commands" section (around line 198)**

```markdown
---

## Dialectic Audit Mode

The `--mode=dialectic` flag enables three-persona adversarial analysis:

### The Three Personas

| Persona | Role | Question Asked |
|---------|------|----------------|
| Consumer Advocate | Skeptical, protective | "Why should we NOT trust this contractor?" |
| Fair Arbiter | Charitable, balanced | "Why might this contractor be trustworthy despite red flags?" |
| Synthesizer | Senior analyst | "Who made the stronger case and why?" |

### Usage

```bash
# Standard single-pass audit
node bin/run_audit.js --id 123

# Dialectic three-persona audit
node bin/run_audit.js --id 123 --mode dialectic
```

### Output Structure

Each persona produces:
- `trust_score` (0-100)
- `assessment_confidence` (0-100) - how certain about their score
- `data_confidence` (0-100) - how reliable the evidence is
- `reasoning` - detailed text another analyst could challenge

The Synthesizer also produces:
- `agreements` - where both personas agreed
- `disagreements` - where they differed and why
- `stronger_case` - which persona was more convincing
- `summary` - final assessment

### When to Use

- **Standard mode:** Fast, cheap (~$0.003), good for batch audits
- **Dialectic mode:** Slower, 3x cost (~$0.01), better reasoning quality for important audits

### Database

Dialectic audits are saved with `audit_version = 4`. The full three-persona trace is stored in `reasoning_trace` as JSON.
```

**Step 2: Commit documentation**

```bash
git add CLAUDE.md
git commit -m "docs: add dialectic audit mode documentation"
```

---

## Summary

After completing all tasks, you will have:

1. `--mode=dialectic` flag in CLI
2. `DialecticAuditAgent` class with three persona prompts
3. Orchestrator wired to use correct agent based on mode
4. Tested on contractors 141, 656, 665, 682
5. Documentation in CLAUDE.md

**Follow-up plan (not in scope):** Shepherding loop for iterative prompt optimization
