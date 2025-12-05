#!/usr/bin/env node
/**
 * Agentic Forensic Audit - Entry Point
 *
 * Usage:
 *   node run_audit.js --id 123
 *   node run_audit.js --name "Company Name" --city "Dallas" --state "TX"
 *   node run_audit.js --id 123 --dry-run
 *   node run_audit.js --id 123 --skip-collection
 *   node run_audit.js --list
 */

const { runForensicAudit, listRecentAudits } = require('./services/orchestrator');

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  if (['dry-run', 'skip-collection', 'collect-only', 'list', 'help'].includes(name)) return true;
  return args[idx + 1];
};

const showHelp = () => {
  console.log(`
Agentic Forensic Audit
======================

Usage:
  node run_audit.js --id <contractor_id>
  node run_audit.js --name "Company" --city "City" --state "TX"

Options:
  --id <id>           Audit contractor by database ID
  --name "Name"       Audit by company name (will search DB or create temp)
  --city "City"       City (default: Dallas)
  --state "XX"        State (default: TX)
  --dry-run           Don't save results to database
  --skip-collection   Skip data collection, use cached data only
  --collect-only      Only run collection, skip audit agent
  --list              List recent audits
  --help              Show this help

Examples:
  node run_audit.js --id 29
  node run_audit.js --name "Orange Elephant Roofing" --city "Dallas" --state "TX"
  node run_audit.js --id 29 --dry-run
  node run_audit.js --id 29 --collect-only
  node run_audit.js --list
`);
};

async function main() {
  // Check for API key
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('\x1b[31mERROR: DEEPSEEK_API_KEY not set\x1b[0m');
    console.error('Set it with: export DEEPSEEK_API_KEY=your_key');
    console.error('Or: source .env && export DEEPSEEK_API_KEY');
    process.exit(1);
  }

  // Handle help
  if (getArg('help') || args.length === 0) {
    showHelp();
    process.exit(0);
  }

  // Handle list
  if (getArg('list')) {
    await listRecentAudits(20);
    process.exit(0);
  }

  // Build input
  const input = {
    id: getArg('id') ? parseInt(getArg('id')) : null,
    name: getArg('name'),
    city: getArg('city') || 'Dallas',
    state: getArg('state') || 'TX'
  };

  // Validate input
  if (!input.id && !input.name) {
    console.error('\x1b[31mERROR: Must provide --id or --name\x1b[0m');
    showHelp();
    process.exit(1);
  }

  // Options
  const options = {
    dryRun: getArg('dry-run') || false,
    skipCollection: getArg('skip-collection') || false,
    collectOnly: getArg('collect-only') || false
  };

  try {
    const result = await runForensicAudit(input, options);

    if (!result) {
      process.exit(1);
    }

    // Exit code based on recommendation
    if (result.recommendation === 'AVOID') {
      process.exit(2); // Red flag
    } else if (result.recommendation === 'CAUTION' || result.recommendation === 'VERIFY') {
      process.exit(1); // Warning
    } else {
      process.exit(0); // Good
    }

  } catch (err) {
    console.error(`\x1b[31mFatal error: ${err.message}\x1b[0m`);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
