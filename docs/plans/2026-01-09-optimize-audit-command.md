# Optimize-Audit Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a `/optimize-audit` slash command that runs an interactive prompt optimization loop for the dialectic audit system.

**Architecture:** The command instructs Claude to: (1) run batched dialectic audits via `bin/batch_dialectic.js`, (2) compare results against benchmark expectations, (3) analyze misses and propose prompt changes, (4) ask user to apply/reject/stop, (5) loop until stopped. Prompt versions are timestamped and stored for history.

**Tech Stack:** Node.js, Claude Code slash commands (.md), existing DialecticAuditAgent

---

## Task 1: Create Benchmark Contractors File

**Files:**
- Create: `data/benchmark_contractors.json`

**Step 1: Create the benchmark file with test contractors**

```json
{
  "description": "Benchmark contractors for prompt optimization. Expected scores based on human judgment.",
  "tolerance_default": 10,
  "contractors": [
    {
      "id": 141,
      "name": "Tropic Island Pools",
      "expected": 40,
      "tolerance": 10,
      "category": "bad",
      "notes": "BBB F rating, unverified license - should score low"
    },
    {
      "id": 656,
      "name": "Bonnie & Clydes Pools and Spas",
      "expected": 35,
      "tolerance": 10,
      "category": "bad",
      "notes": "Deceptive sales practices, fake reviews flagged"
    },
    {
      "id": 665,
      "name": "Pinch A Penny Pool Patio Spa",
      "expected": 52,
      "tolerance": 15,
      "category": "mixed",
      "notes": "Mixed signals - good local reviews but poor Trustpilot"
    },
    {
      "id": 682,
      "name": "Empowered Renovations",
      "expected": 40,
      "tolerance": 10,
      "category": "bad",
      "notes": "Suspicious review profile, unverified credentials"
    }
  ]
}
```

**Step 2: Verify file is valid JSON**

Run: `node -e "console.log(JSON.parse(require('fs').readFileSync('data/benchmark_contractors.json')).contractors.length)"`

Expected: `4`

**Step 3: Commit**

```bash
git add data/benchmark_contractors.json
git commit -m "feat: add benchmark contractors for prompt optimization"
```

---

## Task 2: Create Prompt Versions Directory Structure

**Files:**
- Create: `data/prompt_versions/.gitkeep`
- Create: `data/prompt_versions/README.md`

**Step 1: Create the directory and README**

```bash
mkdir -p data/prompt_versions
```

Create `data/prompt_versions/README.md`:

```markdown
# Prompt Versions

This directory stores timestamped backups of persona prompts during optimization.

## File Naming

- `YYYY-MM-DDTHHMMSS_advocate.txt` - Consumer Advocate prompt
- `YYYY-MM-DDTHHMMSS_arbiter.txt` - Fair Arbiter prompt
- `YYYY-MM-DDTHHMMSS_synthesizer.txt` - Synthesizer prompt

## Usage

Each optimization cycle backs up prompts before modification. To revert:

1. Find the timestamp you want to restore
2. Copy content back to `services/audit_agent.js`
3. Or use the `/optimize-audit` command with `--revert TIMESTAMP`

## Changelog

Changes are logged in `changelog.json` with:
- timestamp
- persona modified
- hypothesis
- result (improved/worse/no_change)
```

**Step 2: Create .gitkeep to ensure directory is tracked**

```bash
touch data/prompt_versions/.gitkeep
```

**Step 3: Commit**

```bash
git add data/prompt_versions/
git commit -m "feat: add prompt versions directory for optimization history"
```

---

## Task 3: Create Batch Dialectic Runner

**Files:**
- Create: `bin/batch_dialectic.js`

**Step 1: Create the batch runner script**

```javascript
#!/usr/bin/env node
/**
 * Batch Dialectic Audit Runner
 *
 * Runs dialectic audits on multiple contractors with batched concurrency.
 *
 * Usage:
 *   node bin/batch_dialectic.js --benchmark data/benchmark_contractors.json
 *   node bin/batch_dialectic.js --ids 141,656,665,682
 *   node bin/batch_dialectic.js --benchmark data/benchmark_contractors.json --batch-size 3
 */

const fs = require('fs');
const path = require('path');
const { runForensicAudit } = require('../services/orchestrator');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1];
};

const benchmarkFile = getArg('benchmark');
const idsArg = getArg('ids');
const batchSize = parseInt(getArg('batch-size') || '3');
const outputFile = getArg('output');

async function runBatch(contractors, batchSize) {
  const results = [];

  for (let i = 0; i < contractors.length; i += batchSize) {
    const batch = contractors.slice(i, i + batchSize);
    console.error(`\n=== Running batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(contractors.length/batchSize)} (${batch.length} contractors) ===\n`);

    const batchPromises = batch.map(async (contractor) => {
      try {
        console.error(`Starting audit for ${contractor.name || contractor.id}...`);
        const result = await runForensicAudit(
          { id: contractor.id },
          {
            skipCollection: true,
            mode: 'dialectic',
            batchMode: true  // Prevents DB pool from closing
          }
        );

        return {
          id: contractor.id,
          name: contractor.name,
          expected: contractor.expected,
          tolerance: contractor.tolerance,
          actual: result?.trust_score ?? null,
          advocate_score: result?.advocate?.trust_score ?? result?.advocate?.score ?? null,
          arbiter_score: result?.arbiter?.trust_score ?? result?.arbiter?.score ?? null,
          verdict: result?.verdict ?? null,
          hit: result?.trust_score !== null &&
               Math.abs(result.trust_score - contractor.expected) <= (contractor.tolerance || 10),
          delta: result?.trust_score !== null ? result.trust_score - contractor.expected : null,
          reasoning_summary: result?.synthesis?.summary ?? null,
          error: null
        };
      } catch (err) {
        console.error(`Error auditing ${contractor.id}: ${err.message}`);
        return {
          id: contractor.id,
          name: contractor.name,
          expected: contractor.expected,
          tolerance: contractor.tolerance,
          actual: null,
          hit: false,
          delta: null,
          error: err.message
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Small delay between batches to avoid rate limits
    if (i + batchSize < contractors.length) {
      console.error('Waiting 2s before next batch...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return results;
}

async function main() {
  let contractors = [];

  if (benchmarkFile) {
    const benchmark = JSON.parse(fs.readFileSync(benchmarkFile, 'utf-8'));
    contractors = benchmark.contractors;
    console.error(`Loaded ${contractors.length} contractors from ${benchmarkFile}`);
  } else if (idsArg) {
    const ids = idsArg.split(',').map(id => parseInt(id.trim()));
    contractors = ids.map(id => ({ id, expected: 50, tolerance: 15 }));
    console.error(`Running on ${contractors.length} contractor IDs: ${ids.join(', ')}`);
  } else {
    console.error('Usage: node bin/batch_dialectic.js --benchmark <file> OR --ids 1,2,3');
    process.exit(1);
  }

  console.error(`Batch size: ${batchSize}`);
  console.error(`Starting batch audit...\n`);

  const results = await runBatch(contractors, batchSize);

  // Calculate summary stats
  const hits = results.filter(r => r.hit).length;
  const misses = results.filter(r => !r.hit && r.actual !== null).length;
  const errors = results.filter(r => r.error).length;

  const summary = {
    total: results.length,
    hits,
    misses,
    errors,
    hit_rate: ((hits / (results.length - errors)) * 100).toFixed(1) + '%',
    results
  };

  // Output JSON to stdout (logs go to stderr)
  const output = JSON.stringify(summary, null, 2);

  if (outputFile) {
    fs.writeFileSync(outputFile, output);
    console.error(`\nResults written to ${outputFile}`);
  } else {
    console.log(output);
  }

  console.error(`\n=== SUMMARY ===`);
  console.error(`Total: ${results.length} | Hits: ${hits} | Misses: ${misses} | Errors: ${errors}`);
  console.error(`Hit rate: ${summary.hit_rate}`);

  // Close DB pool
  const db = require('../services/db_pg');
  await db.close();

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Step 2: Make executable**

```bash
chmod +x bin/batch_dialectic.js
```

**Step 3: Verify syntax**

Run: `node -c bin/batch_dialectic.js`

Expected: No output (no syntax errors)

**Step 4: Test with single contractor**

Run: `source venv/bin/activate && set -a && . ./.env && set +a && node bin/batch_dialectic.js --ids 141 --batch-size 1 2>/dev/null | head -20`

Expected: JSON output with results array containing contractor 141

**Step 5: Commit**

```bash
git add bin/batch_dialectic.js
git commit -m "feat: add batch dialectic audit runner with configurable concurrency"
```

---

## Task 4: Create the Slash Command

**Files:**
- Create: `.claude/commands/optimize-audit.md`

**Step 1: Create the commands directory**

```bash
mkdir -p .claude/commands
```

**Step 2: Create the optimize-audit command**

```markdown
---
description: Interactive prompt optimization loop for dialectic audits
---

# Optimize Audit Prompts

You are running an interactive optimization loop for the dialectic audit system.

## Your Mission

Improve the three persona prompts (Advocate, Arbiter, Synthesizer) so that audit scores match human expectations in the benchmark file.

## The Loop

### Step 1: Run Benchmark Audits

Run the batch dialectic auditor:

```bash
source venv/bin/activate && set -a && . ./.env && set +a
node bin/batch_dialectic.js --benchmark data/benchmark_contractors.json --batch-size 3
```

Parse the JSON output to understand:
- Which contractors HIT their expected range (within tolerance)
- Which contractors MISSED and by how much
- The reasoning each persona gave

### Step 2: Analyze Misses

For each miss, examine:
1. What was the expected score vs actual?
2. Which persona pushed the score in the wrong direction?
3. What reasoning did that persona give?
4. Is there a pattern across multiple misses?

Look for patterns like:
- "Advocate ignores positive signals"
- "Arbiter too forgiving of BBB F ratings"
- "Synthesizer always sides with Arbiter"

### Step 3: Propose a Change

Based on your analysis, propose ONE specific change to ONE persona's prompt.

Format your proposal:
```
HYPOTHESIS: [What pattern you're trying to fix]
PERSONA: [Advocate | Arbiter | Synthesizer]
CHANGE: [Specific text to add, remove, or modify]
EXPECTED EFFECT: [Which contractors should improve and why]
```

### Step 4: Ask User

Use AskUserQuestion to ask:
- "Apply this change and run again"
- "Reject, try different hypothesis"
- "Stop optimization here"

### Step 5: If Applying

1. Backup current prompts to `data/prompt_versions/` with timestamp
2. Modify the prompt constant in `services/audit_agent.js`
3. Log the change to `data/prompt_versions/changelog.json`
4. Return to Step 1

## Backup Format

When backing up prompts, use this naming:
```
data/prompt_versions/YYYY-MM-DDTHHMMSS_advocate.txt
data/prompt_versions/YYYY-MM-DDTHHMMSS_arbiter.txt
data/prompt_versions/YYYY-MM-DDTHHMMSS_synthesizer.txt
```

## Changelog Format

Append to `data/prompt_versions/changelog.json`:
```json
{
  "timestamp": "2026-01-09T00:00:00",
  "persona": "advocate",
  "hypothesis": "Advocate ignores positive review volume",
  "change_summary": "Added instruction to acknowledge review volume before concerns",
  "before_hit_rate": "50%",
  "after_hit_rate": "75%",
  "result": "improved"
}
```

## Success Criteria

Stop when:
- 80%+ of benchmark contractors hit their expected range
- OR user says stop
- OR 10 optimization cycles completed

## Important Notes

- Make ONE change at a time to isolate effects
- Always backup before modifying
- If a change makes things worse, revert it
- Focus on the WORST misses first (largest delta)
```

**Step 3: Verify command file exists**

Run: `cat .claude/commands/optimize-audit.md | head -5`

Expected: Shows the frontmatter with description

**Step 4: Commit**

```bash
git add .claude/commands/optimize-audit.md
git commit -m "feat: add /optimize-audit slash command for prompt optimization"
```

---

## Task 5: Create Changelog JSON Structure

**Files:**
- Create: `data/prompt_versions/changelog.json`

**Step 1: Create initial changelog**

```json
{
  "description": "Log of prompt optimization changes",
  "baseline": {
    "timestamp": "2026-01-09T00:00:00",
    "note": "Initial dialectic prompts from implementation"
  },
  "changes": []
}
```

**Step 2: Verify valid JSON**

Run: `node -e "console.log(JSON.parse(require('fs').readFileSync('data/prompt_versions/changelog.json')).description)"`

Expected: `Log of prompt optimization changes`

**Step 3: Commit**

```bash
git add data/prompt_versions/changelog.json
git commit -m "feat: add changelog for prompt optimization history"
```

---

## Task 6: Test Full Command Flow

**Step 1: Verify all files exist**

Run:
```bash
ls -la data/benchmark_contractors.json data/prompt_versions/changelog.json .claude/commands/optimize-audit.md bin/batch_dialectic.js
```

Expected: All four files listed with recent timestamps

**Step 2: Test batch runner with full benchmark**

Run:
```bash
source venv/bin/activate && set -a && . ./.env && set +a
node bin/batch_dialectic.js --benchmark data/benchmark_contractors.json --batch-size 2 --output /tmp/test_results.json
cat /tmp/test_results.json | head -30
```

Expected: JSON with results array, hit_rate calculated

**Step 3: Verify the command is recognized**

The `/optimize-audit` command should now be available in Claude Code when run from the auditor directory.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete /optimize-audit command implementation"
```

---

## Summary

After completing all tasks, you will have:

1. `data/benchmark_contractors.json` - Contractors with expected scores
2. `data/prompt_versions/` - Directory for prompt history
3. `data/prompt_versions/changelog.json` - Change tracking
4. `bin/batch_dialectic.js` - Batched audit runner
5. `.claude/commands/optimize-audit.md` - The slash command

**Usage:**
```
/optimize-audit
```

This launches the interactive optimization loop where Claude runs audits, analyzes results, proposes changes, and you approve/reject each cycle.
