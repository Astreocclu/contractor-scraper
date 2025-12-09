#!/usr/bin/env node
/**
 * DeepSeek-powered email scraper for contractors
 *
 * Fallback for conventional scraping - uses Puppeteer to render JS
 * and DeepSeek to extract/infer emails from HTML content.
 *
 * Usage:
 *   node scrape_emails_deepseek.js [options]
 *
 * Options:
 *   --limit N      Process only N contractors
 *   --dry-run      Don't save to database
 *   --delay N      Seconds between requests (default: 1.5)
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const puppeteer = require('puppeteer');
const path = require('path');

// Config
const DB_PATH = path.join(__dirname, 'db.sqlite3');
const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL = 'deepseek-chat';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Pages to check for contact info
const CONTACT_PAGES = ['/contact', '/contact-us', '/about', '/about-us', '/team'];

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  if (name === 'dry-run') return true;
  return args[idx + 1];
};

const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : null;
const DRY_RUN = getArg('dry-run') || false;
const DELAY = getArg('delay') ? parseFloat(getArg('delay')) : 1.5;

// Logging helpers
const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalize URL to have https:// prefix
 */
function normalizeUrl(url) {
  if (!url) return null;
  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  return url;
}

/**
 * Fetch a page with Puppeteer, wait for JS render
 */
async function fetchPageHtml(browser, url, timeout = 15000) {
  const page = await browser.newPage();

  try {
    // Set reasonable viewport and user agent
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate and wait for network idle
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout
    });

    // Get rendered HTML
    const html = await page.content();
    return html;
  } catch (err) {
    // Return null on error (404, timeout, etc)
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Fetch all relevant pages for a contractor website
 */
async function fetchAllPages(browser, baseUrl) {
  const htmlParts = [];

  // Main page
  const mainHtml = await fetchPageHtml(browser, baseUrl);
  if (mainHtml) {
    htmlParts.push(`<!-- MAIN PAGE: ${baseUrl} -->\n${mainHtml}`);
  } else {
    // If main page fails, no point checking subpages
    return null;
  }

  // Contact/about pages
  const base = baseUrl.replace(/\/$/, '');
  for (const pagePath of CONTACT_PAGES) {
    const pageUrl = base + pagePath;
    const html = await fetchPageHtml(browser, pageUrl, 10000);
    if (html) {
      htmlParts.push(`<!-- SUBPAGE: ${pageUrl} -->\n${html}`);
    }
    // Small delay between subpages
    await sleep(300);
  }

  return htmlParts.join('\n\n');
}

/**
 * Truncate HTML to fit in API context window
 * DeepSeek has ~32k context, leave room for prompt/response
 */
function truncateHtml(html, maxChars = 60000) {
  if (!html || html.length <= maxChars) return html;

  // Truncate and add notice
  return html.substring(0, maxChars) + '\n<!-- TRUNCATED -->';
}

/**
 * Call DeepSeek API to extract emails from HTML
 */
async function extractEmailsWithDeepSeek(html, businessName, website) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY environment variable not set');
  }

  const truncatedHtml = truncateHtml(html);

  const prompt = `Extract any email addresses from this HTML for the business "${businessName}" (${website}).

Also infer likely emails from:
- Contact forms (look for hidden fields, action URLs)
- Obfuscated patterns like 'info [at] domain [dot] com'
- Owner names + domain patterns (John Smith + smithpools.com = john@smithpools.com)
- "Email us at" or similar text patterns

Return ONLY valid JSON (no markdown, no explanation):
{"emails": ["email1@example.com"], "confidence": "high/medium/low", "source": "found/inferred"}

If no email found or inferred, return:
{"emails": [], "confidence": "none", "source": "none"}

HTML content:
${truncatedHtml}`;

  const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an email extraction assistant. Extract emails from HTML and return only valid JSON. Never include placeholder emails like example@example.com.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from DeepSeek');
  }

  // Parse JSON from response (handle potential markdown wrapping)
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    // Try to extract JSON from response
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error(`Failed to parse DeepSeek response: ${content}`);
  }
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;

  // Basic format check
  const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!pattern.test(email)) return false;

  // Ignore placeholder/example emails
  const ignoredDomains = ['example.com', 'domain.com', 'email.com', 'test.com', 'yoursite.com'];
  const domain = email.split('@')[1].toLowerCase();
  if (ignoredDomains.includes(domain)) return false;

  // Ignore sentry, tracking, etc
  const ignoredPatterns = ['sentry.io', 'wixpress.com', 'squarespace'];
  if (ignoredPatterns.some(p => email.toLowerCase().includes(p))) return false;

  return true;
}

/**
 * Pick best email from list
 */
function pickBestEmail(emails) {
  if (!emails || !emails.length) return null;

  // Filter valid emails
  const valid = emails.filter(isValidEmail);
  if (!valid.length) return null;

  // Sort by preference: info@ > contact@ > sales@ > shortest
  return valid.sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    if (aLower.startsWith('info@')) return -1;
    if (bLower.startsWith('info@')) return 1;
    if (aLower.startsWith('contact@')) return -1;
    if (bLower.startsWith('contact@')) return 1;
    if (aLower.startsWith('sales@')) return -1;
    if (bLower.startsWith('sales@')) return 1;

    return a.length - b.length;
  })[0];
}

/**
 * Main scraping function
 */
async function main() {
  log('=== DEEPSEEK EMAIL SCRAPER ===\n');

  if (!DEEPSEEK_API_KEY) {
    error('ERROR: DEEPSEEK_API_KEY environment variable not set');
    error('Set it with: export DEEPSEEK_API_KEY=your_key_here');
    process.exit(1);
  }

  if (DRY_RUN) {
    warn('DRY RUN MODE - not saving to database\n');
  }

  // Open database with sql.js
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  // Get contractors needing emails
  let query = `
    SELECT id, business_name, website, city
    FROM contractors_contractor
    WHERE website IS NOT NULL
      AND website != ''
      AND (email IS NULL OR email = '')
      AND is_active = 1
    ORDER BY trust_score DESC
  `;

  if (LIMIT) {
    query += ` LIMIT ${LIMIT}`;
  }

  const result = db.exec(query);
  const contractors = result.length > 0 ? result[0].values.map(row => ({
    id: row[0],
    business_name: row[1],
    website: row[2],
    city: row[3]
  })) : [];

  log(`Found ${contractors.length} contractors needing email lookup\n`);

  if (contractors.length === 0) {
    log('No contractors need email scraping.');
    db.close();
    return;
  }

  // Launch browser
  log('Launching browser...\n');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let processed = 0;
  let found = 0;
  let missed = 0;
  let errors = 0;

  try {
    for (let i = 0; i < contractors.length; i++) {
      const c = contractors[i];
      const num = i + 1;

      log(`[${num}/${contractors.length}] ${c.business_name} (${c.city})`);

      const url = normalizeUrl(c.website);
      if (!url) {
        warn('  Invalid URL, skipping');
        errors++;
        continue;
      }

      log(`  URL: ${url}`);

      try {
        // Fetch all pages
        const html = await fetchAllPages(browser, url);

        if (!html) {
          warn('  Could not load website');
          missed++;
          processed++;
          await sleep(DELAY * 1000);
          continue;
        }

        log(`  Fetched ${Math.round(html.length / 1024)}KB of HTML`);

        // Call DeepSeek
        log('  Analyzing with DeepSeek...');
        const result = await extractEmailsWithDeepSeek(html, c.business_name, url);

        const bestEmail = pickBestEmail(result.emails);

        if (bestEmail) {
          success(`  FOUND: ${bestEmail} (${result.confidence}, ${result.source})`);

          if (result.emails.length > 1) {
            log(`  Also found: ${result.emails.filter(e => e !== bestEmail).join(', ')}`);
          }

          if (!DRY_RUN) {
            db.run('UPDATE contractors_contractor SET email = ? WHERE id = ?', [bestEmail, c.id]);
          }

          found++;
        } else {
          warn(`  MISS - no valid email found`);
          if (result.emails?.length) {
            log(`  (rejected: ${result.emails.join(', ')})`);
          }
          missed++;
        }

        processed++;

      } catch (err) {
        error(`  ERROR: ${err.message}`);
        errors++;
        processed++;
      }

      // Delay between contractors
      if (i < contractors.length - 1) {
        await sleep(DELAY * 1000);
      }
    }
  } finally {
    await browser.close();

    // Save database back to disk if not dry run
    if (!DRY_RUN && found > 0) {
      log('\nSaving database...');
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
      log('Database saved.');
    }

    db.close();
  }

  // Summary
  log('\n' + '='.repeat(50));
  log('SUMMARY');
  log('='.repeat(50));
  success(`Emails found:  ${found}`);
  warn(`No email:      ${missed}`);
  error(`Errors:        ${errors}`);
  log(`Total:         ${processed}`);

  if (processed > 0) {
    const hitRate = ((found / processed) * 100).toFixed(1);
    log(`Hit rate:      ${hitRate}%`);
  }

  if (DRY_RUN) {
    warn('\nDRY RUN - no changes saved. Remove --dry-run to save.');
  }
}

// Run
main().catch(err => {
  error(`Fatal error: ${err.message}`);
  process.exit(1);
});
