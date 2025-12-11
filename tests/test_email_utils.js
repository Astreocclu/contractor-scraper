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
