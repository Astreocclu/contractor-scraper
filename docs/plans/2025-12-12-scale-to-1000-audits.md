# Scale to 1000 Audits Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 8 reliability issues to enable batch processing of 1000+ contractor audits with parallel execution.

**Architecture:** Convert blocking `execSync` calls to async `spawn`, add robust error handling/retry logic, create batch runner with state persistence and graceful shutdown.

**Tech Stack:** Node.js (spawn, p-limit), Python (asyncio), Playwright, PostgreSQL

---

## Phase 1: Core Infrastructure (Tasks 1-3)

### Task 1: Create Async Command Runner

**Files:**
- Create: `services/async_command.js`
- Test: `tests/test_async_command.js`

**Step 1: Write the failing test**

```javascript
// tests/test_async_command.js
const { runCommand } = require('../services/async_command');

describe('runCommand', () => {
  test('executes command and returns stdout', async () => {
    const result = await runCommand('echo', ['hello']);
    expect(result).toBe('hello');
  });

  test('handles timeout', async () => {
    await expect(runCommand('sleep', ['5'], { timeout: 100 }))
      .rejects.toThrow(/timed out/);
  });

  test('parses JSON when option set', async () => {
    const result = await runCommand('echo', ['{"key":"value"}'], { json: true });
    expect(result).toEqual({ key: 'value' });
  });

  test('rejects on non-zero exit code', async () => {
    await expect(runCommand('false', []))
      .rejects.toThrow(/failed with code 1/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/reid/testhome/contractor-auditor && npm test -- tests/test_async_command.js`
Expected: FAIL with "Cannot find module '../services/async_command'"

**Step 3: Write implementation**

```javascript
// services/async_command.js
const { spawn } = require('child_process');

/**
 * Run a command asynchronously (non-blocking alternative to execSync)
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {Object} options - Options (timeout, json, cwd, env)
 * @returns {Promise<string|Object>} stdout or parsed JSON
 */
function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const { timeout = 0, json = false, cwd, env } = options;

    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    if (child.stdout) {
      child.stdout.on('data', (data) => { stdout += data.toString(); });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => { stderr += data.toString(); });
    }

    let timeoutId;
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        const err = new Error(`Command timed out after ${timeout}ms: ${command} ${args.join(' ')}`);
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }, timeout);
    }

    child.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });

    child.on('close', (code) => {
      if (killed) return; // Already handled by timeout
      if (timeoutId) clearTimeout(timeoutId);

      const result = stdout.trim();

      if (code === 0) {
        if (json) {
          try {
            resolve(JSON.parse(result));
          } catch (e) {
            // Try stderr as fallback (some scrapers output there)
            if (!result && stderr) {
              try {
                resolve(JSON.parse(stderr.trim()));
                return;
              } catch (e2) { /* ignore */ }
            }
            const parseErr = new Error(`Failed to parse JSON: ${e.message}`);
            parseErr.stdout = stdout;
            parseErr.stderr = stderr;
            reject(parseErr);
          }
        } else {
          resolve(result);
        }
      } else {
        const err = new Error(`Command failed with code ${code}: ${command} ${args.join(' ')}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

module.exports = { runCommand };
```

**Step 4: Run test to verify it passes**

Run: `cd /home/reid/testhome/contractor-auditor && npm test -- tests/test_async_command.js`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add services/async_command.js tests/test_async_command.js
git commit -m "feat: add async command runner to replace execSync"
```

---

### Task 2: Create Cost Tracker Service

**Files:**
- Create: `services/cost_tracker.js`
- Create: `logs/.gitkeep`

**Step 1: Write the service (no test needed - simple logging)**

```javascript
// services/cost_tracker.js
const fs = require('fs');
const path = require('path');

const COST_LOG_PATH = path.join(__dirname, '../logs/costs.jsonl');

// Ensure logs directory exists
const logsDir = path.dirname(COST_LOG_PATH);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// In-memory accumulator for session totals
let sessionCosts = {
  deepseek: 0,
  serper: 0,
  total: 0,
  requests: 0
};

/**
 * Log a cost event (append-only for crash safety)
 */
function logCost(source, cost, metadata = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    source,
    cost_usd: cost,
    ...metadata
  };

  // Append to file (crash-safe)
  fs.appendFileSync(COST_LOG_PATH, JSON.stringify(entry) + '\n');

  // Update session totals
  sessionCosts[source] = (sessionCosts[source] || 0) + cost;
  sessionCosts.total += cost;
  sessionCosts.requests++;

  return sessionCosts;
}

/**
 * Get current session costs
 */
function getSessionCosts() {
  return { ...sessionCosts };
}

/**
 * Reset session costs (for new batch run)
 */
function resetSessionCosts() {
  sessionCosts = { deepseek: 0, serper: 0, total: 0, requests: 0 };
}

module.exports = { logCost, getSessionCosts, resetSessionCosts };
```

**Step 2: Create logs directory gitkeep**

```bash
mkdir -p /home/reid/testhome/contractor-auditor/logs
touch /home/reid/testhome/contractor-auditor/logs/.gitkeep
echo "costs.jsonl" >> /home/reid/testhome/contractor-auditor/logs/.gitignore
```

**Step 3: Commit**

```bash
git add services/cost_tracker.js logs/.gitkeep logs/.gitignore
git commit -m "feat: add cost tracker service with append-only logging"
```

---

### Task 3: Create Rate Limiter Service

**Files:**
- Create: `services/rate_limiter.js`

**Step 1: Write the service**

```javascript
// services/rate_limiter.js

/**
 * Simple token bucket rate limiter
 */
class RateLimiter {
  constructor(tokensPerSecond, maxTokens = null) {
    this.tokensPerSecond = tokensPerSecond;
    this.maxTokens = maxTokens || tokensPerSecond * 2;
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.tokensPerSecond);
    this.lastRefill = now;
  }

  async acquire(tokens = 1) {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }

    // Wait for enough tokens
    const needed = tokens - this.tokens;
    const waitMs = (needed / this.tokensPerSecond) * 1000;
    await new Promise(resolve => setTimeout(resolve, waitMs));

    this.refill();
    this.tokens -= tokens;
  }
}

// Pre-configured limiters
const limiters = {
  serper: new RateLimiter(10, 20),    // 10 req/s, burst of 20
  google: new RateLimiter(0.5, 2),    // 1 req per 2s (conservative)
  deepseek: new RateLimiter(5, 10)    // 5 req/s
};

/**
 * Acquire a rate limit token before making a request
 */
async function acquireToken(service) {
  const limiter = limiters[service];
  if (limiter) {
    await limiter.acquire();
  }
}

module.exports = { RateLimiter, acquireToken, limiters };
```

**Step 2: Commit**

```bash
git add services/rate_limiter.js
git commit -m "feat: add token bucket rate limiter service"
```

---

## Phase 2: Fix Scraper Issues (Tasks 4-7)

### Task 4: Convert execSync to Async in Collection Service

**Files:**
- Modify: `services/collection_service.js`

**Step 1: Add imports at top of file**

Find line with `const { execSync } = require('child_process');` and replace:

```javascript
// OLD:
const { execSync } = require('child_process');

// NEW:
const { runCommand } = require('./async_command');
```

**Step 2: Replace callPythonScraper function (around line 21)**

```javascript
// OLD (lines ~21-45):
function callPythonScraper(script, args = [], timeout = 60000) {
  const scriptPath = path.join(SCRAPERS_DIR, script);
  const quotedArgs = args.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ');
  const cmd = `python3 "${scriptPath}" ${quotedArgs} --json`;

  try {
    const output = execSync(cmd, {
      cwd: SCRAPERS_DIR,
      timeout,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return JSON.parse(output.trim());
  } catch (err) {
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout.trim());
      } catch (parseErr) {}
    }
    throw new Error(`Python scraper error: ${err.message}`);
  }
}

// NEW:
async function callPythonScraper(script, args = [], timeout = 60000) {
  const scriptPath = path.join(SCRAPERS_DIR, script);
  const fullArgs = [...args, '--json'];

  try {
    return await runCommand('python3', [scriptPath, ...fullArgs], {
      cwd: SCRAPERS_DIR,
      timeout,
      json: true
    });
  } catch (err) {
    // Try to extract JSON from stdout/stderr on error
    if (err.stdout) {
      try { return JSON.parse(err.stdout.trim()); } catch (e) {}
    }
    if (err.stderr) {
      try { return JSON.parse(err.stderr.trim()); } catch (e) {}
    }
    throw new Error(`Python scraper error: ${err.message}`);
  }
}
```

**Step 3: Fix scrapeYelpYahooPython (around line 71)**

```javascript
// OLD (lines ~71-100) uses execSync directly
// Replace the entire function:

async function scrapeYelpYahooPython(businessName, location = 'Fort Worth, TX') {
  const scriptPath = path.join(SCRAPERS_DIR, 'yelp.py');

  try {
    const output = await runCommand('python3', [scriptPath, businessName, location, '--yahoo'], {
      cwd: SCRAPERS_DIR,
      timeout: 60000
    });

    // Parse output - look for rating pattern
    const ratingMatch = output.match(/Rating:\s*([\d.]+)/);
    const reviewsMatch = output.match(/Reviews:\s*(\d+)/);
    const urlMatch = output.match(/URL:\s*(https?:\/\/[^\s]+)/);
    const foundMatch = output.match(/Found:\s*(True|False)/i);

    return {
      found: foundMatch ? foundMatch[1].toLowerCase() === 'true' : false,
      rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
      review_count: reviewsMatch ? parseInt(reviewsMatch[1]) : null,
      url: urlMatch ? urlMatch[1] : null
    };
  } catch (err) {
    console.error(`Yelp Yahoo scraper error: ${err.message}`);
    return { found: false, rating: null, review_count: null, url: null };
  }
}
```

**Step 4: Fix any other execSync calls (search for remaining)**

Run: `grep -n "execSync" services/collection_service.js`

For each remaining call, convert to `await runCommand(...)` following the same pattern.

**Step 5: Test manually**

Run: `cd /home/reid/testhome/contractor-auditor && source venv/bin/activate && set -a && . ./.env && set +a && node -e "
const { scrapeBBBPython } = require('./services/collection_service');
scrapeBBBPython('Test Company', 'Dallas', 'TX').then(console.log).catch(console.error);
"`

Expected: Returns BBB data object (or "not found" error - both are valid)

**Step 6: Commit**

```bash
git add services/collection_service.js
git commit -m "refactor: convert execSync to async spawn in collection service"
```

---

### Task 5: Fix Review Analyzer JSON Parsing

**Files:**
- Modify: `services/review_analyzer.js`

**Step 1: Find the JSON parsing section (search for "JSON.parse")**

Run: `grep -n "JSON.parse" services/review_analyzer.js`

**Step 2: Add robust extraction function after imports**

```javascript
// Add near top of file, after imports:

/**
 * Extract JSON from LLM response that may contain markdown or extra text
 */
function extractJSON(text) {
  // Try 1: Direct parse
  try {
    return JSON.parse(text);
  } catch (e) {}

  // Try 2: Extract from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {}
  }

  // Try 3: Find JSON object in text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {}
  }

  // Try 4: Regex extraction for key fields
  const result = {
    fake_review_score: null,
    confidence: null,
    recommendation: 'VERIFY_REVIEWS'
  };

  const scoreMatch = text.match(/["']?fake_review_score["']?\s*[:=]\s*(\d+)/i);
  if (scoreMatch) result.fake_review_score = parseInt(scoreMatch[1]);

  const confMatch = text.match(/["']?confidence["']?\s*[:=]\s*["']?(\w+)["']?/i);
  if (confMatch) result.confidence = confMatch[1];

  const recMatch = text.match(/["']?recommendation["']?\s*[:=]\s*["']?(TRUST_REVIEWS|VERIFY_REVIEWS|DISTRUST_REVIEWS)["']?/i);
  if (recMatch) result.recommendation = recMatch[1].toUpperCase();

  // Only return if we got at least the score
  if (result.fake_review_score !== null) {
    return result;
  }

  return null;
}
```

**Step 3: Replace JSON.parse calls with extractJSON**

Find lines like:
```javascript
const parsed = JSON.parse(jsonStr);
```

Replace with:
```javascript
const parsed = extractJSON(jsonStr);
if (!parsed) {
  console.warn('[review_analyzer] Could not extract JSON from response');
  return {
    score: null,
    confidence: null,
    recommendation: 'VERIFY_REVIEWS',
    error: 'Failed to parse response'
  };
}
```

**Step 4: Commit**

```bash
git add services/review_analyzer.js
git commit -m "fix: robust JSON extraction in review analyzer"
```

---

### Task 6: Fix Website Scraper Navigation Errors

**Files:**
- Modify: `scrapers/website_scraper.js`

**Step 1: Find the $$eval calls**

Run: `grep -n "\$\$eval\|\$eval" scrapers/website_scraper.js`

**Step 2: Create retry wrapper function at top of file**

```javascript
// Add after imports:

/**
 * Retry Playwright evaluation with context destruction handling
 */
async function safeEval(page, selector, evalFn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await page.$$eval(selector, evalFn);
    } catch (err) {
      if (err.message.includes('Execution context was destroyed') && attempt < maxRetries) {
        console.warn(`[website_scraper] Context destroyed, retry ${attempt}/${maxRetries}`);
        await page.waitForTimeout(500); // Brief pause before retry
        continue;
      }
      throw err;
    }
  }
}
```

**Step 3: Replace $$eval calls with safeEval**

Find:
```javascript
const emails = await page.$$eval('a[href^="mailto:"]', ...);
```

Replace with:
```javascript
const emails = await safeEval(page, 'a[href^="mailto:"]', ...);
```

**Step 4: Commit**

```bash
git add scrapers/website_scraper.js
git commit -m "fix: add retry logic for website scraper navigation errors"
```

---

### Task 7: Fix Houzz Timeout

**Files:**
- Modify: `scrapers/serp_rating.py`

**Step 1: Find timeout setting**

Run: `grep -n "timeout\|15000\|20000" scrapers/serp_rating.py`

**Step 2: Increase timeout from 15000/20000 to 30000**

Find lines like:
```python
await page.goto(url, timeout=15000)
# or
await page.goto(url, timeout=20000)
```

Replace with:
```python
await page.goto(url, timeout=30000)
```

**Step 3: Commit**

```bash
git add scrapers/serp_rating.py
git commit -m "fix: increase Houzz scraper timeout to 30s"
```

---

## Phase 3: Batch Runner (Tasks 8-9)

### Task 8: Create Batch Audit Runner

**Files:**
- Create: `batch_audit_runner.js`

**Step 1: Write the batch runner**

```javascript
// batch_audit_runner.js
const pLimit = require('p-limit');
const fs = require('fs');
const path = require('path');
const { auditContractor } = require('./services/orchestrator');
const db = require('./services/db_pg');
const { getSessionCosts, resetSessionCosts } = require('./services/cost_tracker');

// Configuration
const CONCURRENCY = 5;
const STATE_FILE = path.join(__dirname, 'batch_progress.json');

// Graceful shutdown handling
let isShuttingDown = false;
const activeAudits = new Set();

function setupShutdownHandlers() {
  const handler = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n\nReceived ${signal}. Finishing ${activeAudits.size} active audits...`);

    // Wait for active audits (with 60s timeout)
    const timeout = setTimeout(() => {
      console.log('Shutdown timeout - forcing exit');
      process.exit(1);
    }, 60000);

    await Promise.allSettled(activeAudits);
    clearTimeout(timeout);

    saveState();
    console.log('Graceful shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}

// State management
let state = {
  completed: [],
  failed: [],
  pending: [],
  startedAt: null,
  lastUpdated: null
};

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      console.log(`Loaded state: ${state.completed.length} completed, ${state.failed.length} failed`);
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

function markCompleted(id, result) {
  state.completed.push({ id, score: result.trust_score, timestamp: new Date().toISOString() });
  state.pending = state.pending.filter(pid => pid !== id);
  saveState();
}

function markFailed(id, error) {
  state.failed.push({ id, error: error.message, timestamp: new Date().toISOString() });
  state.pending = state.pending.filter(pid => pid !== id);
  saveState();
}

// Main batch function
async function runBatch(contractorIds) {
  setupShutdownHandlers();
  loadState();
  resetSessionCosts();

  state.startedAt = state.startedAt || new Date().toISOString();

  // Filter out already completed/failed
  const completedSet = new Set(state.completed.map(c => c.id));
  const failedSet = new Set(state.failed.map(f => f.id));
  const toProcess = contractorIds.filter(id => !completedSet.has(id) && !failedSet.has(id));

  state.pending = toProcess;
  saveState();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`BATCH AUDIT - ${toProcess.length} contractors`);
  console.log(`Already completed: ${state.completed.length}, failed: ${state.failed.length}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`${'='.repeat(60)}\n`);

  const limit = pLimit(CONCURRENCY);
  let processed = 0;

  const tasks = toProcess.map(id => limit(async () => {
    if (isShuttingDown) return;

    const auditPromise = (async () => {
      try {
        console.log(`[${++processed}/${toProcess.length}] Auditing contractor ${id}...`);
        const result = await auditContractor(id);
        markCompleted(id, result);
        console.log(`  -> Score: ${result.trust_score}/100 (${result.recommendation})`);
        return { id, success: true, result };
      } catch (err) {
        markFailed(id, err);
        console.error(`  -> FAILED: ${err.message}`);
        return { id, success: false, error: err.message };
      }
    })();

    activeAudits.add(auditPromise);
    const result = await auditPromise;
    activeAudits.delete(auditPromise);
    return result;
  }));

  const results = await Promise.all(tasks);

  // Summary
  const costs = getSessionCosts();
  console.log(`\n${'='.repeat(60)}`);
  console.log('BATCH COMPLETE');
  console.log(`${'='.repeat(60)}`);
  console.log(`Completed: ${state.completed.length}`);
  console.log(`Failed: ${state.failed.length}`);
  console.log(`Total API cost: $${costs.total.toFixed(4)}`);
  console.log(`State saved to: ${STATE_FILE}`);

  return results;
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(`
Usage: node batch_audit_runner.js [options]

Options:
  --limit N       Process only N contractors (default: all unaudited)
  --ids 1,2,3     Process specific contractor IDs
  --resume        Resume from saved state
  --reset         Clear state and start fresh
  --help          Show this help
`);
    process.exit(0);
  }

  if (args.includes('--reset')) {
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
      console.log('State cleared.');
    }
  }

  let contractorIds;

  if (args.includes('--ids')) {
    const idsArg = args[args.indexOf('--ids') + 1];
    contractorIds = idsArg.split(',').map(id => parseInt(id.trim()));
  } else {
    // Get unaudited contractors from DB
    const limit = args.includes('--limit')
      ? parseInt(args[args.indexOf('--limit') + 1])
      : null;

    const query = `
      SELECT id FROM contractors_contractor
      WHERE trust_score = 0 OR trust_score IS NULL
      ORDER BY id
      ${limit ? `LIMIT ${limit}` : ''}
    `;
    const result = await db.query(query);
    contractorIds = result.rows.map(r => r.id);
  }

  if (contractorIds.length === 0) {
    console.log('No contractors to process.');
    process.exit(0);
  }

  await runBatch(contractorIds);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Step 2: Test with small batch**

Run: `cd /home/reid/testhome/contractor-auditor && source venv/bin/activate && set -a && . ./.env && set +a && node batch_audit_runner.js --limit 3`

Expected: Processes 3 contractors with progress output

**Step 3: Test resume capability**

Run: `node batch_audit_runner.js --limit 3` (again)

Expected: "Already completed: 3" - skips previously done

**Step 4: Commit**

```bash
git add batch_audit_runner.js
git commit -m "feat: add batch audit runner with parallelism and state persistence"
```

---

### Task 9: Integration Test

**Step 1: Run 10 audit batch test**

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a

# Reset state for clean test
node batch_audit_runner.js --reset

# Run 10 audits
node batch_audit_runner.js --limit 10
```

**Step 2: Verify fixes**

Check the output for:
- [ ] No "undefined" review scores (review analyzer fix)
- [ ] Parallel execution visible (multiple "Auditing contractor X" in quick succession)
- [ ] Cost tracking displayed at end
- [ ] State file created (`batch_progress.json`)

**Step 3: Test graceful shutdown**

Run batch with more items, then Ctrl+C during execution:
```bash
node batch_audit_runner.js --limit 20
# Press Ctrl+C after a few audits start
```

Expected: "Finishing N active audits..." then clean exit with state saved

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: verify batch audit runner with 10 contractor test"
```

---

## Verification Checklist

After all tasks complete, verify:

| Fix | Verification | Expected |
|-----|--------------|----------|
| execSync → spawn | `htop` during batch | Multiple python3 processes |
| Review analyzer | Check audit logs | No "undefined" scores |
| Website scraper | Check logs | "retry 1/3" messages (or none) |
| Houzz timeout | Check logs | No 20s timeout errors |
| Batch runner | Run 10 audits | ~2 min (vs ~10 min sequential) |
| Cost tracker | Check `logs/costs.jsonl` | Entries for each API call |
| State persistence | Kill and resume | Picks up where left off |
| Graceful shutdown | Ctrl+C | Waits for active, saves state |

---

## Summary

**Total Tasks:** 9
**Estimated Time:** 2-3 hours
**Key Files Created:** 4 (`async_command.js`, `cost_tracker.js`, `rate_limiter.js`, `batch_audit_runner.js`)
**Key Files Modified:** 4 (`collection_service.js`, `review_analyzer.js`, `website_scraper.js`, `serp_rating.py`)
