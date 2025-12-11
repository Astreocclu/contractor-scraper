/**
 * Website email scraper using Playwright
 * Visits homepage and contact pages to extract email addresses
 */

const { chromium } = require('playwright');
const { extractEmailsFromText, filterJunkEmails, selectBestEmail } = require('./email_utils');

// Contact page link patterns
const CONTACT_PATTERNS = [
  /contact/i,
  /get.?in.?touch/i,
  /reach.?out/i,
  /location/i,
  /about/i,
];

/**
 * Find contact page URL from array of links
 * @param {Array<{href: string, text: string}>} links - Page links
 * @returns {string|null} - Best contact page href or null
 */
function findContactPageUrl(links) {
  if (!links || links.length === 0) return null;

  // Iterate patterns first (priority order), then links
  for (const pattern of CONTACT_PATTERNS) {
    for (const link of links) {
      const hrefLower = (link.href || '').toLowerCase();
      const textLower = (link.text || '').toLowerCase();

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
