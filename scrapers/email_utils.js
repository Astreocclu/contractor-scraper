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
