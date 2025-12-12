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
