# Email Backfill Scraper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a Playwright-based script that visits contractor websites to extract email addresses, filling the gap for ~1,844 contractors who have websites but no email.

**Architecture:** Separate Node.js backfill script (not coupled to google_maps.py). Uses single Playwright browser with new context per URL for isolation. Smart navigation visits homepage first, then contact page if no email found. Sequential processing with random jitter to avoid bot detection.

**Tech Stack:** Node.js, Playwright, PostgreSQL (pg client)

---

## Task 1: Install Playwright

**Files:**
- Modify: `package.json`

**Step 1: Install playwright dependency**

Run:
```bash
cd /home/reid/testhome/contractor-auditor
npm install playwright
```

Expected: `playwright` added to package.json dependencies

**Step 2: Install browser binaries**

Run:
```bash
npx playwright install chromium
```

Expected: Chromium browser downloaded (may take 1-2 minutes)

**Step 3: Verify installation**

Run:
```bash
node -e "const { chromium } = require('playwright'); console.log('Playwright OK');"
```

Expected: `Playwright OK`

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add playwright dependency for email scraper"
```

---

## Task 2: Create Email Extraction Utilities

**Files:**
- Create: `scrapers/email_utils.js`
- Create: `tests/test_email_utils.js`

**Step 1: Write failing test for email regex extraction**

Create `tests/test_email_utils.js`:

```javascript
const assert = require('assert');
const { extractEmailsFromText, filterJunkEmails, JUNK_DOMAINS } = require('../scrapers/email_utils');

describe('Email Extraction', () => {
  describe('extractEmailsFromText', () => {
    it('extracts standard email addresses', () => {
      const text = 'Contact us at info@company.com or sales@company.com';
      const result = extractEmailsFromText(text);
      assert.deepStrictEqual(result, ['info@company.com', 'sales@company.com']);
    });

    it('handles email with subdomains', () => {
      const text = 'Email: support@mail.company.co.uk';
      const result = extractEmailsFromText(text);
      assert.deepStrictEqual(result, ['support@mail.company.co.uk']);
    });

    it('ignores image filenames that look like emails', () => {
      const text = 'icon@2x.png and logo@3x.jpg should not match';
      const result = extractEmailsFromText(text);
      assert.deepStrictEqual(result, []);
    });

    it('returns empty array for no matches', () => {
      const text = 'No emails here, just text';
      const result = extractEmailsFromText(text);
      assert.deepStrictEqual(result, []);
    });

    it('deduplicates emails', () => {
      const text = 'info@test.com and info@test.com again';
      const result = extractEmailsFromText(text);
      assert.deepStrictEqual(result, ['info@test.com']);
    });
  });

  describe('filterJunkEmails', () => {
    it('filters out junk domain emails', () => {
      const emails = ['real@company.com', 'test@wixpress.com', 'fake@sentry.io'];
      const result = filterJunkEmails(emails);
      assert.deepStrictEqual(result, ['real@company.com']);
    });

    it('filters out example/placeholder emails', () => {
      const emails = ['email@example.com', 'name@domain.com', 'your@email.com'];
      const result = filterJunkEmails(emails);
      assert.deepStrictEqual(result, []);
    });

    it('keeps legitimate business emails', () => {
      const emails = ['info@realcompany.com', 'sales@contractor.net'];
      const result = filterJunkEmails(emails);
      assert.deepStrictEqual(result, ['info@realcompany.com', 'sales@contractor.net']);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
cd /home/reid/testhome/contractor-auditor
npm test tests/test_email_utils.js
```

Expected: FAIL with `Cannot find module '../scrapers/email_utils'`

**Step 3: Write minimal implementation**

Create `scrapers/email_utils.js`:

```javascript
/**
 * Email extraction utilities for website scraping
 */

// Junk domains to filter out (platform emails, not business emails)
const JUNK_DOMAINS = [
  'wixpress.com',
  'wix.com',
  'sentry.io',
  'cloudflare.com',
  'example.com',
  'domain.com',
  'email.com',
  'test.com',
  'placeholder.com',
  'squarespace.com',
  'wordpress.com',
  'godaddy.com',
];

// Junk local parts (generic placeholders)
const JUNK_LOCAL_PARTS = [
  'your',
  'name',
  'email',
  'user',
  'username',
  'youremail',
  'yourname',
];

// Image/asset extensions to ignore
const ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.css', '.js'];

/**
 * Extract email addresses from text using regex
 * @param {string} text - Text to search
 * @returns {string[]} - Array of unique email addresses
 */
function extractEmailsFromText(text) {
  if (!text || typeof text !== 'string') return [];

  // RFC 5322 compatible pattern (simplified)
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi;
  const matches = text.match(emailPattern) || [];

  // Filter out image/asset filenames
  const filtered = matches.filter(email => {
    const lower = email.toLowerCase();
    return !ASSET_EXTENSIONS.some(ext => lower.endsWith(ext));
  });

  // Deduplicate and lowercase
  const unique = [...new Set(filtered.map(e => e.toLowerCase()))];

  return unique;
}

/**
 * Filter out junk/placeholder emails
 * @param {string[]} emails - Array of emails to filter
 * @returns {string[]} - Filtered array
 */
function filterJunkEmails(emails) {
  return emails.filter(email => {
    const lower = email.toLowerCase();
    const [localPart, domain] = lower.split('@');

    // Check junk domains
    if (JUNK_DOMAINS.some(junk => domain.includes(junk))) {
      return false;
    }

    // Check junk local parts
    if (JUNK_LOCAL_PARTS.includes(localPart)) {
      return false;
    }

    return true;
  });
}

/**
 * Prioritize business-like emails (info@, office@, contact@, hello@)
 * @param {string[]} emails - Array of emails
 * @returns {string|null} - Best email or null
 */
function selectBestEmail(emails) {
  if (!emails || emails.length === 0) return null;
  if (emails.length === 1) return emails[0];

  // Priority prefixes (in order)
  const priorities = ['info', 'contact', 'office', 'hello', 'sales', 'support'];

  for (const prefix of priorities) {
    const match = emails.find(e => e.toLowerCase().startsWith(prefix + '@'));
    if (match) return match;
  }

  // Return first email if no priority match
  return emails[0];
}

module.exports = {
  extractEmailsFromText,
  filterJunkEmails,
  selectBestEmail,
  JUNK_DOMAINS,
  JUNK_LOCAL_PARTS,
};
```

**Step 4: Run test to verify it passes**

Run:
```bash
npm test tests/test_email_utils.js
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add scrapers/email_utils.js tests/test_email_utils.js
git commit -m "feat: add email extraction utilities with junk filtering"
```

---

## Task 3: Create Website Scraper Module

**Files:**
- Create: `scrapers/website_scraper.js`
- Create: `tests/test_website_scraper.js`

**Step 1: Write failing integration test**

Create `tests/test_website_scraper.js`:

```javascript
const assert = require('assert');
const { scrapeEmailFromWebsite, findContactPageUrl } = require('../scrapers/website_scraper');

describe('Website Scraper', () => {
  // Note: These tests require network access and Playwright
  // Skip in CI with: SKIP_INTEGRATION=1 npm test

  describe('findContactPageUrl', () => {
    it('returns null for empty links array', () => {
      const result = findContactPageUrl([]);
      assert.strictEqual(result, null);
    });

    it('finds contact page link', () => {
      const links = [
        { href: '/about', text: 'About Us' },
        { href: '/contact', text: 'Contact' },
        { href: '/services', text: 'Services' },
      ];
      const result = findContactPageUrl(links);
      assert.strictEqual(result, '/contact');
    });

    it('matches "Contact Us" text', () => {
      const links = [
        { href: '/reach-out', text: 'Contact Us' },
      ];
      const result = findContactPageUrl(links);
      assert.strictEqual(result, '/reach-out');
    });

    it('matches "Get In Touch" text', () => {
      const links = [
        { href: '/info', text: 'Get In Touch' },
      ];
      const result = findContactPageUrl(links);
      assert.strictEqual(result, '/info');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
npm test tests/test_website_scraper.js
```

Expected: FAIL with `Cannot find module '../scrapers/website_scraper'`

**Step 3: Write the website scraper implementation**

Create `scrapers/website_scraper.js`:

```javascript
/**
 * Website email scraper using Playwright
 * Visits homepage and contact pages to extract email addresses
 */

const { chromium } = require('playwright');
const { extractEmailsFromText, filterJunkEmails, selectBestEmail } = require('./email_utils');

// Contact page link patterns
const CONTACT_PATTERNS = [
  /contact/i,
  /about/i,
  /get.?in.?touch/i,
  /reach.?out/i,
  /location/i,
];

/**
 * Find contact page URL from array of links
 * @param {Array<{href: string, text: string}>} links - Page links
 * @returns {string|null} - Best contact page href or null
 */
function findContactPageUrl(links) {
  if (!links || links.length === 0) return null;

  for (const link of links) {
    const hrefLower = (link.href || '').toLowerCase();
    const textLower = (link.text || '').toLowerCase();

    for (const pattern of CONTACT_PATTERNS) {
      if (pattern.test(hrefLower) || pattern.test(textLower)) {
        return link.href;
      }
    }
  }

  return null;
}

/**
 * Extract emails from a page
 * @param {import('playwright').Page} page - Playwright page
 * @returns {Promise<string[]>} - Array of emails found
 */
async function extractEmailsFromPage(page) {
  const emails = [];

  // Method 1: mailto links
  const mailtoLinks = await page.$$eval('a[href^="mailto:"]', els =>
    els.map(el => el.href.replace('mailto:', '').split('?')[0])
  );
  emails.push(...mailtoLinks);

  // Method 2: Regex on visible text
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  const regexEmails = extractEmailsFromText(bodyText);
  emails.push(...regexEmails);

  // Deduplicate and filter
  const unique = [...new Set(emails.map(e => e.toLowerCase()))];
  return filterJunkEmails(unique);
}

/**
 * Get all links from page for contact page discovery
 * @param {import('playwright').Page} page - Playwright page
 * @returns {Promise<Array<{href: string, text: string}>>}
 */
async function getPageLinks(page) {
  return page.$$eval('a[href]', els =>
    els.map(el => ({
      href: el.getAttribute('href'),
      text: el.innerText?.trim() || '',
    }))
  );
}

/**
 * Scrape email from a website URL
 * @param {string} url - Website URL to scrape
 * @param {object} options - Options
 * @param {import('playwright').Browser} options.browser - Shared browser instance
 * @param {number} options.timeout - Page timeout in ms (default 15000)
 * @returns {Promise<{email: string|null, source: string|null, error: string|null}>}
 */
async function scrapeEmailFromWebsite(url, options = {}) {
  const { browser, timeout = 15000 } = options;

  if (!browser) {
    throw new Error('Browser instance required');
  }

  // Normalize URL
  let normalizedUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    normalizedUrl = 'https://' + url;
  }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  page.setDefaultTimeout(timeout);

  try {
    // Visit homepage
    await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded' });

    // Extract emails from homepage
    let emails = await extractEmailsFromPage(page);

    if (emails.length > 0) {
      const best = selectBestEmail(emails);
      return { email: best, source: 'homepage', error: null };
    }

    // No email on homepage - look for contact page
    const links = await getPageLinks(page);
    const contactHref = findContactPageUrl(links);

    if (contactHref) {
      try {
        // Navigate to contact page
        const contactUrl = new URL(contactHref, normalizedUrl).href;
        await page.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

        emails = await extractEmailsFromPage(page);

        if (emails.length > 0) {
          const best = selectBestEmail(emails);
          return { email: best, source: 'contact_page', error: null };
        }
      } catch (contactErr) {
        // Contact page failed, but homepage worked - not a critical error
      }
    }

    // No email found anywhere
    return { email: null, source: null, error: null };

  } catch (err) {
    return { email: null, source: null, error: err.message };
  } finally {
    await context.close();
  }
}

module.exports = {
  scrapeEmailFromWebsite,
  findContactPageUrl,
  extractEmailsFromPage,
  getPageLinks,
};
```

**Step 4: Run test to verify it passes**

Run:
```bash
npm test tests/test_website_scraper.js
```

Expected: Unit tests PASS (integration tests may be skipped)

**Step 5: Commit**

```bash
git add scrapers/website_scraper.js tests/test_website_scraper.js
git commit -m "feat: add website scraper with smart contact page navigation"
```

---

## Task 4: Create Backfill Script

**Files:**
- Create: `scrapers/backfill_emails.js`

**Step 1: Create the main backfill script**

Create `scrapers/backfill_emails.js`:

```javascript
#!/usr/bin/env node
/**
 * Email Backfill Script
 *
 * Finds contractors with websites but no email, visits their sites,
 * and extracts email addresses.
 *
 * Usage:
 *   node scrapers/backfill_emails.js [--test] [--limit N] [--ids 1,2,3]
 *
 * Options:
 *   --test    Run on test IDs only (101, 19, 9, 33, 60)
 *   --limit N Process only N contractors
 *   --ids X   Comma-separated list of contractor IDs
 *   --dry-run Don't save to database, just log results
 */

const { chromium } = require('playwright');
const { Pool } = require('pg');
const { scrapeEmailFromWebsite } = require('./website_scraper');

// Parse command line args
const args = process.argv.slice(2);
const isTest = args.includes('--test');
const isDryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null;
const idsIdx = args.indexOf('--ids');
const specificIds = idsIdx !== -1 ? args[idsIdx + 1].split(',').map(Number) : null;

// Test IDs (verified to have website but no email)
const TEST_IDS = [101, 19, 9, 33, 60];

// Database connection
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'contractors_dev',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '',
});

/**
 * Sleep for random duration (rate limiting)
 * @param {number} minMs - Minimum milliseconds
 * @param {number} maxMs - Maximum milliseconds
 */
function sleep(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch contractors needing email backfill
 * @returns {Promise<Array<{id: number, business_name: string, website: string}>>}
 */
async function fetchContractorsNeedingEmail() {
  let query = `
    SELECT id, business_name, website
    FROM contractors_contractor
    WHERE website IS NOT NULL
      AND website != ''
      AND (email IS NULL OR email = '')
  `;

  const params = [];

  if (isTest) {
    query += ` AND id = ANY($1)`;
    params.push(TEST_IDS);
  } else if (specificIds) {
    query += ` AND id = ANY($1)`;
    params.push(specificIds);
  }

  query += ` ORDER BY id`;

  if (limit) {
    query += ` LIMIT ${limit}`;
  }

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Update contractor email in database
 * @param {number} id - Contractor ID
 * @param {string} email - Email address
 */
async function updateContractorEmail(id, email) {
  if (isDryRun) {
    console.log(`  [DRY RUN] Would update ID ${id} with email: ${email}`);
    return;
  }

  await pool.query(
    `UPDATE contractors_contractor SET email = $1 WHERE id = $2`,
    [email, id]
  );
}

/**
 * Main backfill function
 */
async function main() {
  console.log('=== Email Backfill Script ===');
  console.log(`Mode: ${isTest ? 'TEST' : isDryRun ? 'DRY RUN' : 'PRODUCTION'}`);
  console.log('');

  // Fetch contractors
  const contractors = await fetchContractorsNeedingEmail();
  console.log(`Found ${contractors.length} contractors needing email`);
  console.log('');

  if (contractors.length === 0) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  // Launch browser
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });

  // Stats
  let processed = 0;
  let found = 0;
  let errors = 0;

  try {
    for (const contractor of contractors) {
      processed++;
      const progress = `[${processed}/${contractors.length}]`;

      console.log(`${progress} ${contractor.business_name} (ID: ${contractor.id})`);
      console.log(`  URL: ${contractor.website}`);

      const result = await scrapeEmailFromWebsite(contractor.website, { browser });

      if (result.error) {
        console.log(`  ERROR: ${result.error}`);
        errors++;
      } else if (result.email) {
        console.log(`  FOUND: ${result.email} (from ${result.source})`);
        found++;
        await updateContractorEmail(contractor.id, result.email);
      } else {
        console.log(`  NO EMAIL FOUND`);
      }

      console.log('');

      // Rate limiting: 1-3 second delay between requests
      if (processed < contractors.length) {
        await sleep(1000, 3000);
      }
    }
  } finally {
    await browser.close();
    await pool.end();
  }

  // Summary
  console.log('=== Summary ===');
  console.log(`Processed: ${processed}`);
  console.log(`Found:     ${found}`);
  console.log(`Errors:    ${errors}`);
  console.log(`Hit Rate:  ${((found / processed) * 100).toFixed(1)}%`);

  // Success criteria: 25%+ hit rate
  const hitRate = (found / processed) * 100;
  if (hitRate >= 25) {
    console.log('SUCCESS: Hit rate meets target (25%+)');
  } else {
    console.log('BELOW TARGET: Hit rate below 25%');
  }
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Step 2: Make script executable and test syntax**

Run:
```bash
chmod +x scrapers/backfill_emails.js
node --check scrapers/backfill_emails.js
```

Expected: No syntax errors

**Step 3: Commit**

```bash
git add scrapers/backfill_emails.js
git commit -m "feat: add email backfill script with rate limiting and progress tracking"
```

---

## Task 5: Test Against Sample Contractors

**Files:**
- None (execution task)

**Step 1: Load environment variables**

Run:
```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
```

**Step 2: Run test batch (dry run first)**

Run:
```bash
node scrapers/backfill_emails.js --test --dry-run
```

Expected output:
- Should show 5 contractors being processed
- Should show email extraction attempts
- Should NOT update database (dry run)
- Should show hit rate at end

**Step 3: Run test batch (real)**

Run:
```bash
node scrapers/backfill_emails.js --test
```

Expected:
- Processes 5 contractors
- Finds emails for some of them
- Updates database
- Shows hit rate (target: 25%+)

**Step 4: Verify database updates**

Run:
```bash
source venv/bin/activate && set -a && . ./.env && set +a && python3 -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from contractors.models import Contractor
for id in [101, 19, 9, 33, 60]:
    c = Contractor.objects.get(id=id)
    print(f'ID {id}: {c.email or \"NONE\"}')"
```

Expected: Some contractors now have emails populated

**Step 5: Commit test results to SESSION-NOTES.md**

Update SESSION-NOTES.md with results, then:
```bash
git add SESSION-NOTES.md
git commit -m "docs: record email backfill test results"
```

---

## Task 6: Full Backfill (Production Run)

**Files:**
- None (execution task)

**Step 1: Count total contractors to process**

Run:
```bash
source venv/bin/activate && set -a && . ./.env && set +a && python3 -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from contractors.models import Contractor
count = Contractor.objects.filter(website__isnull=False, email__isnull=True).exclude(website='').count()
print(f'Contractors needing email: {count}')"
```

Expected: ~1,844 contractors (minus test ones already filled)

**Step 2: Run full backfill**

Run:
```bash
node scrapers/backfill_emails.js 2>&1 | tee backfill_log.txt
```

Expected:
- Takes 30-90 minutes (1-3s per contractor)
- Progress logged to console and file
- Final hit rate reported

**Step 3: Verify results**

Run:
```bash
source venv/bin/activate && set -a && . ./.env && set +a && python3 -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from contractors.models import Contractor
total = Contractor.objects.filter(website__isnull=False).exclude(website='').count()
with_email = Contractor.objects.filter(website__isnull=False, email__isnull=False).exclude(website='').exclude(email='').count()
print(f'With website: {total}')
print(f'With email: {with_email}')
print(f'Fill rate: {(with_email/total*100):.1f}%')"
```

**Step 4: Commit and document**

```bash
git add backfill_log.txt
git commit -m "docs: add email backfill run log"
```

---

## Verification Checklist

- [ ] Playwright installed and browser binaries present
- [ ] `npm test` passes for email_utils and website_scraper
- [ ] Test run (5 contractors) completes without errors
- [ ] At least 1 email found in test run (20%+ hit rate)
- [ ] Database correctly updated with found emails
- [ ] Full backfill completes (may run in background)

## Future Work (Not in this plan)

1. **Integrate into CollectionService** - Add email scraping to new contractor collection flow
2. **Retry mechanism** - Re-run on failed URLs with longer timeout
3. **Alternative sources** - Add Prospeo API as fallback for high-priority contractors
