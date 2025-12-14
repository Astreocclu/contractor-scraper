# Nightly Scheduler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automate contractor collection and auditing to run nightly from 8 PM to 6 AM Central Time, with state persistence and graceful shutdown.

**Architecture:** Single-process serial coordinator that runs audits sequentially (which trigger collection automatically via orchestrator). Systemd timer fires at 8 PM, service runs until 6 AM. State persisted after each contractor for crash recovery.

**Tech Stack:** Node.js, systemd (timer + service), existing PostgreSQL database

---

## Task 1: Add `skipLiens` Option to CollectionService

**Files:**
- Modify: `/home/reid/testhome/contractor-auditor/services/collection_service.js:1049`

**Step 1: Update `runInitialCollection` method signature**

Find line 1049:
```javascript
async runInitialCollection(contractorId, contractor) {
```

Replace with:
```javascript
async runInitialCollection(contractorId, contractor, options = {}) {
    const { skipLiens = false } = options;
```

**Step 2: Wrap county liens section in conditional**

Find lines 1472-1503 (the county liens section):
```javascript
    // County Liens (mechanic's liens, tax liens, judgments)
    log('\n  Searching county lien records...');
    try {
      const lienResult = await scrapeCountyLiensPython(contractor.name, null, contractor.city, contractor.state);
```

Replace the entire section with:
```javascript
    // County Liens (mechanic's liens, tax liens, judgments)
    if (!skipLiens) {
      log('\n  Searching county lien records...');
      try {
        const lienResult = await scrapeCountyLiensPython(contractor.name, null, contractor.city, contractor.state);
        const data = {
          source: 'county_liens',
          url: 'DFW County OPR',
          status: lienResult.total_records > 0 ? 'success' : 'not_found',
          text: `COUNTY LIENS:\n${JSON.stringify(lienResult, null, 2)}`,
          structured: lienResult
        };
        await this.storeRawData(contractorId, 'county_liens', data);
        await this.logCollectionRequest(contractorId, 'county_liens', 'initial', 'Initial collection - liens');
        results.push(data);

        if (lienResult.total_records > 0) {
          const activeCount = lienResult.lien_score?.active_liens || 0;
          const resolvedCount = lienResult.lien_score?.resolved_liens || 0;
          warn(`    Liens: Found ${lienResult.total_records} record(s) - ${activeCount} active, ${resolvedCount} resolved`);

          // Flag if there are active liens
          if (activeCount >= 3) {
            error(`    ⚠️ CRITICAL: ${activeCount} active liens (pattern of non-payment)`);
          } else if (activeCount >= 1) {
            warn(`    ⚠️ WARNING: ${activeCount} active lien(s) found`);
          }
        } else {
          success(`    Liens: No liens found`);
        }
      } catch (err) {
        warn(`    Liens: Error - ${err.message}`);
      }
    } else {
      log('\n  Skipping county lien records (--skip-liens)');
    }
```

**Step 3: Verify change**

Run: `grep -n "skipLiens" /home/reid/testhome/contractor-auditor/services/collection_service.js`
Expected: Should show lines with skipLiens option

**Step 4: Commit**

```bash
cd /home/reid/testhome/contractor-auditor
git add services/collection_service.js
git commit -m "feat: add skipLiens option to collection service

Allows skipping the 5-minute county lien scraper for faster batch processing."
```

---

## Task 2: Pass `skipLiens` Through Orchestrator

**Files:**
- Modify: `/home/reid/testhome/contractor-auditor/services/orchestrator.js:22,135-138`

**Step 1: Add skipLiens to options destructuring**

Find line 22:
```javascript
const { dryRun = false, skipCollection = false, collectOnly = false, batchMode = false } = options;
```

Replace with:
```javascript
const { dryRun = false, skipCollection = false, collectOnly = false, batchMode = false, skipLiens = false } = options;
```

**Step 2: Pass skipLiens to collection service**

Find lines 135-138:
```javascript
        log(`📥 Running collection to refresh stale data...`);
        await collectionService.runInitialCollection(contractorId, contractor);
      } else {
        log(`\n📥 No cached data - running initial collection...`);
        await collectionService.runInitialCollection(contractorId, contractor);
```

Replace with:
```javascript
        log(`📥 Running collection to refresh stale data...`);
        await collectionService.runInitialCollection(contractorId, contractor, { skipLiens });
      } else {
        log(`\n📥 No cached data - running initial collection...`);
        await collectionService.runInitialCollection(contractorId, contractor, { skipLiens });
```

**Step 3: Verify change**

Run: `grep -n "skipLiens" /home/reid/testhome/contractor-auditor/services/orchestrator.js`
Expected: Should show skipLiens in options and passed to runInitialCollection

**Step 4: Commit**

```bash
cd /home/reid/testhome/contractor-auditor
git add services/orchestrator.js
git commit -m "feat: pass skipLiens option through orchestrator to collection service"
```

---

## Task 3: Add CLI Flags to Batch Audit Runner

**Files:**
- Modify: `/home/reid/testhome/contractor-auditor/batch_audit_runner.js`

**Step 1: Add new CLI flags to help text**

Find lines 303-323 (help text):
```javascript
  --retry-review  Retry review analysis for failed contractors
  --status        Show current batch status
  --help          Show this help
```

Add before `--help`:
```javascript
  --skip-liens    Skip county lien scraping (faster, ~2x throughput)
  --max N         Alias for --limit (max contractors to process)
```

**Step 2: Parse new flags in main()**

Find around line 369 (where limit is parsed):
```javascript
    const limit = args.includes('--limit')
      ? parseInt(args[args.indexOf('--limit') + 1])
      : null;
```

Replace with:
```javascript
    // Parse limit (support both --limit and --max as aliases)
    let limit = null;
    if (args.includes('--limit')) {
      limit = parseInt(args[args.indexOf('--limit') + 1]);
    } else if (args.includes('--max')) {
      limit = parseInt(args[args.indexOf('--max') + 1]);
    }

    // Parse skipLiens flag
    const skipLiens = args.includes('--skip-liens');
```

**Step 3: Pass skipLiens to runBatch**

Find line 388:
```javascript
  await runBatch(contractorIds);
```

Replace with:
```javascript
  await runBatch(contractorIds, { skipLiens });
```

**Step 4: Update runBatch function signature**

Find line 114:
```javascript
async function runBatch(contractorIds) {
```

Replace with:
```javascript
async function runBatch(contractorIds, options = {}) {
  const { skipLiens = false } = options;
```

**Step 5: Pass skipLiens to runForensicAudit**

Find line 153:
```javascript
      const result = await runForensicAudit({ id }, { dryRun: false, batchMode: true });
```

Replace with:
```javascript
      const result = await runForensicAudit({ id }, { dryRun: false, batchMode: true, skipLiens });
```

**Step 6: Verify changes**

Run: `node /home/reid/testhome/contractor-auditor/batch_audit_runner.js --help`
Expected: Should show --skip-liens and --max options in help

**Step 7: Commit**

```bash
cd /home/reid/testhome/contractor-auditor
git add batch_audit_runner.js
git commit -m "feat: add --skip-liens and --max flags to batch audit runner

--skip-liens: Skip county lien scraping for ~2x faster processing
--max: Alias for --limit for convenience"
```

---

## Task 4: Create Nightly Scheduler Script

**Files:**
- Create: `/home/reid/testhome/contractor-auditor/scripts/nightly_scheduler.js`

**Step 1: Create scripts directory if needed**

Run: `mkdir -p /home/reid/testhome/contractor-auditor/scripts`

**Step 2: Create the nightly scheduler**

```javascript
#!/usr/bin/env node
/**
 * Nightly Scheduler
 *
 * Runs batch audits from 8 PM to 6 AM Central Time.
 * Designed to be triggered by systemd timer at 8 PM.
 *
 * Features:
 * - Time window enforcement (stops at 6 AM)
 * - State persistence (crash recovery via batch_audit_runner)
 * - Graceful shutdown on SIGTERM
 * - Progress logging to logs/nightly_runs.log
 * - Optional --force flag to bypass time window (for testing)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const TIMEZONE = 'America/Chicago';
const START_HOUR = 20; // 8 PM
const END_HOUR = 6;    // 6 AM
const CHECK_INTERVAL_MS = 60000; // Check time every minute
const BATCH_SIZE = 50; // Process 50 contractors per batch loop
const PROJECT_ROOT = path.join(__dirname, '..');
const LOG_FILE = path.join(PROJECT_ROOT, 'logs', 'nightly_runs.log');

// Ensure logs directory exists
const logsDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// State
let isShuttingDown = false;
let currentProcess = null;
let stats = {
  startTime: new Date(),
  contractorsProcessed: 0,
  successful: 0,
  failed: 0
};

function log(msg) {
  const ts = new Date().toLocaleString('en-US', { timeZone: TIMEZONE });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function getCurrentHour() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: TIMEZONE
  }).formatToParts(now);

  const hourPart = parts.find(p => p.type === 'hour');
  return parseInt(hourPart.value, 10);
}

function isWindowOpen(forceMode = false) {
  if (forceMode) return true;

  const hour = getCurrentHour();
  // Window is open from 8 PM (20) to 6 AM (6)
  // That means: hour >= 20 OR hour < 6
  return hour >= START_HOUR || hour < END_HOUR;
}

function runBatchAudit(skipLiens = true) {
  return new Promise((resolve, reject) => {
    const args = [
      path.join(PROJECT_ROOT, 'batch_audit_runner.js'),
      '--resume',
      '--limit', String(BATCH_SIZE)
    ];

    if (skipLiens) {
      args.push('--skip-liens');
    }

    log(`Starting batch: node ${args.join(' ')}`);

    currentProcess = spawn('node', args, {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    let stdout = '';
    let stderr = '';

    currentProcess.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(text);
      stdout += text;
    });

    currentProcess.stderr.on('data', (data) => {
      const text = data.toString();
      process.stderr.write(text);
      stderr += text;
    });

    currentProcess.on('close', (code) => {
      currentProcess = null;

      // Parse stats from output
      const completedMatch = stdout.match(/Completed.*?:\s*(\d+)/);
      const failedMatch = stdout.match(/Failed:\s*(\d+)/);

      if (completedMatch) stats.successful += parseInt(completedMatch[1]) || 0;
      if (failedMatch) stats.failed += parseInt(failedMatch[1]) || 0;
      stats.contractorsProcessed = stats.successful + stats.failed;

      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        reject(new Error(`Batch exited with code ${code}`));
      }
    });

    currentProcess.on('error', (err) => {
      currentProcess = null;
      reject(err);
    });
  });
}

function printSummary() {
  const duration = Math.round((new Date() - stats.startTime) / 1000 / 60);
  log('');
  log('=' .repeat(60));
  log('NIGHTLY RUN SUMMARY');
  log('='.repeat(60));
  log(`Duration: ${duration} minutes`);
  log(`Contractors processed: ${stats.contractorsProcessed}`);
  log(`Successful: ${stats.successful}`);
  log(`Failed: ${stats.failed}`);
  log('='.repeat(60));
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log(`\nReceived ${signal}, shutting down gracefully...`);

  if (currentProcess) {
    log('Sending SIGTERM to batch process...');
    currentProcess.kill('SIGTERM');

    // Wait up to 30 seconds for graceful exit
    await new Promise(resolve => setTimeout(resolve, 30000));

    if (currentProcess) {
      log('Force killing batch process...');
      currentProcess.kill('SIGKILL');
    }
  }

  printSummary();
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  const forceMode = args.includes('--force');
  const skipLiens = !args.includes('--with-liens'); // Default: skip liens

  if (args.includes('--help')) {
    console.log(`
Nightly Scheduler - Runs batch audits from 8 PM to 6 AM Central

Usage: node nightly_scheduler.js [options]

Options:
  --force       Bypass time window check (for testing)
  --with-liens  Include county lien scraping (slower, ~5min each)
  --help        Show this help

The scheduler runs in a loop, processing batches of 50 contractors
until the time window closes at 6 AM Central.

State is persisted after each contractor via batch_audit_runner.js,
so the process can be safely killed and resumed.
`);
    process.exit(0);
  }

  // Setup signal handlers
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  log('='.repeat(60));
  log('NIGHTLY SCHEDULER STARTED');
  log('='.repeat(60));
  log(`Timezone: ${TIMEZONE}`);
  log(`Window: ${START_HOUR}:00 - ${END_HOUR}:00`);
  log(`Force mode: ${forceMode}`);
  log(`Skip liens: ${skipLiens}`);
  log('');

  if (!isWindowOpen(forceMode)) {
    log(`Outside time window (current hour: ${getCurrentHour()}). Exiting.`);
    log('Use --force to bypass time window check.');
    process.exit(0);
  }

  // Main loop - keep running batches until window closes
  while (!isShuttingDown && isWindowOpen(forceMode)) {
    try {
      await runBatchAudit(skipLiens);

      // Brief pause between batches
      log('Batch complete. Checking time window...');
      await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (err) {
      log(`Batch error: ${err.message}`);
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }

  if (!isShuttingDown) {
    log(`Time window closed (current hour: ${getCurrentHour()}). Stopping.`);
  }

  printSummary();
  process.exit(0);
}

main().catch(err => {
  log(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
```

**Step 3: Make executable**

Run: `chmod +x /home/reid/testhome/contractor-auditor/scripts/nightly_scheduler.js`

**Step 4: Test the script (force mode)**

Run: `cd /home/reid/testhome/contractor-auditor && node scripts/nightly_scheduler.js --help`
Expected: Should show help text

Run: `cd /home/reid/testhome/contractor-auditor && timeout 30 node scripts/nightly_scheduler.js --force --with-liens 2>&1 | head -50`
Expected: Should start processing (will timeout after 30s for testing)

**Step 5: Commit**

```bash
cd /home/reid/testhome/contractor-auditor
git add scripts/nightly_scheduler.js
git commit -m "feat: add nightly scheduler script

Runs batch audits from 8 PM to 6 AM Central Time.
- Time window enforcement
- Graceful shutdown on SIGTERM
- Progress logging to logs/nightly_runs.log
- --force flag for testing outside time window
- --with-liens flag to include slow county lien scraping"
```

---

## Task 5: Create Systemd Unit Files

**Files:**
- Create: `/home/reid/testhome/contractor-auditor/systemd/contractor-audit.service`
- Create: `/home/reid/testhome/contractor-auditor/systemd/contractor-audit.timer`

**Step 1: Create systemd directory**

Run: `mkdir -p /home/reid/testhome/contractor-auditor/systemd`

**Step 2: Create service file**

Create `/home/reid/testhome/contractor-auditor/systemd/contractor-audit.service`:

```ini
[Unit]
Description=Contractor Auditor Nightly Batch
After=network.target postgresql.service

[Service]
Type=simple
User=reid
WorkingDirectory=/home/reid/testhome/contractor-auditor
ExecStart=/usr/bin/node /home/reid/testhome/contractor-auditor/scripts/nightly_scheduler.js
Restart=on-failure
RestartSec=60

# Environment
Environment=NODE_ENV=production

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=contractor-audit

# Resource limits
MemoryMax=2G
CPUQuota=80%

# Graceful shutdown
TimeoutStopSec=60
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

**Step 3: Create timer file**

Create `/home/reid/testhome/contractor-auditor/systemd/contractor-audit.timer`:

```ini
[Unit]
Description=Run Contractor Auditor at 8 PM Central daily

[Timer]
# 8 PM Central Time (America/Chicago)
OnCalendar=*-*-* 20:00:00 America/Chicago

# If system was down at 8 PM, run immediately on boot
Persistent=true

# Small random delay to avoid thundering herd
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
```

**Step 4: Create installation instructions**

Create `/home/reid/testhome/contractor-auditor/systemd/README.md`:

```markdown
# Systemd Installation

## Install the timer and service

```bash
# Copy unit files to systemd directory
sudo cp contractor-audit.service /etc/systemd/system/
sudo cp contractor-audit.timer /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start the timer
sudo systemctl enable contractor-audit.timer
sudo systemctl start contractor-audit.timer

# Check timer status
sudo systemctl list-timers | grep contractor
```

## Manual control

```bash
# Start immediately (for testing)
sudo systemctl start contractor-audit.service

# Stop running job
sudo systemctl stop contractor-audit.service

# View logs
journalctl -u contractor-audit.service -f

# Check next scheduled run
systemctl list-timers contractor-audit.timer
```

## Disable

```bash
sudo systemctl stop contractor-audit.timer
sudo systemctl disable contractor-audit.timer
```
```

**Step 5: Commit**

```bash
cd /home/reid/testhome/contractor-auditor
git add systemd/
git commit -m "feat: add systemd timer and service for nightly scheduler

- contractor-audit.timer: Fires at 8 PM Central daily
- contractor-audit.service: Runs nightly_scheduler.js
- Persistent=true catches up if system was down
- Graceful shutdown with 60s timeout
- Resource limits (2GB RAM, 80% CPU)"
```

---

## Task 6: Update Documentation

**Files:**
- Modify: `/home/reid/testhome/contractor-auditor/STATUS.md`

**Step 1: Add nightly scheduler section**

Add to STATUS.md under Key Commands:

```markdown
### Nightly Scheduler

```bash
# Test nightly scheduler (bypasses time window)
node scripts/nightly_scheduler.js --force

# Test with lien scraping (slower)
node scripts/nightly_scheduler.js --force --with-liens

# Install systemd timer (runs 8 PM - 6 AM Central)
sudo cp systemd/*.service systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now contractor-audit.timer

# Check timer status
systemctl list-timers contractor-audit.timer

# View logs
journalctl -u contractor-audit.service -f
```
```

**Step 2: Commit**

```bash
cd /home/reid/testhome/contractor-auditor
git add STATUS.md
git commit -m "docs: add nightly scheduler commands to STATUS.md"
```

---

## Verification Checklist

After all tasks complete:

1. **Test skipLiens flag:**
   ```bash
   cd /home/reid/testhome/contractor-auditor
   node batch_audit_runner.js --skip-liens --limit 1
   ```
   Expected: Should NOT show "Searching county lien records..."

2. **Test nightly scheduler (force mode):**
   ```bash
   timeout 60 node scripts/nightly_scheduler.js --force 2>&1 | tail -20
   ```
   Expected: Should process contractors and show progress

3. **Test help messages:**
   ```bash
   node batch_audit_runner.js --help
   node scripts/nightly_scheduler.js --help
   ```
   Expected: Both should show new flags

4. **Verify files created:**
   ```bash
   ls -la scripts/nightly_scheduler.js systemd/
   ```
   Expected: nightly_scheduler.js, contractor-audit.service, contractor-audit.timer
