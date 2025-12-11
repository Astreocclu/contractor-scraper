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
