#!/usr/bin/env node
/**
 * TDLR (Texas Department of Licensing and Regulation) License Scraper
 *
 * Searches the TDLR license database for contractor licenses.
 * This handles form submission since TDLR requires interactive search.
 *
 * Usage:
 *   const { searchTDLR } = require('./lib/tdlr_scraper');
 *   const result = await searchTDLR(browser, 'Company Name');
 */

const TDLR_SEARCH_URL = 'https://www.tdlr.texas.gov/LicenseSearch/';

// License types relevant to contractors
const CONTRACTOR_LICENSE_TYPES = [
  'Air Conditioning and Refrigeration Contractor',
  'Electrician',
  'Electrical Contractor',
  'Plumber',
  'Property Tax Consultant',
  'Boiler',
  'Water Well',
  'Irrigation',
  'Tow Truck',
  'Vehicle Storage'
];

/**
 * Search TDLR for a business license
 * @param {Browser} browser - Puppeteer browser instance
 * @param {string} businessName - Name to search for
 * @param {Object} options - Search options
 * @returns {Object} License search results
 */
async function searchTDLR(browser, businessName, options = {}) {
  const page = await browser.newPage();
  const result = {
    found: false,
    licenses: [],
    search_term: businessName,
    error: null
  };

  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate to TDLR search page
    await page.goto(TDLR_SEARCH_URL, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for the search form to load
    await page.waitForSelector('input[name="SearchTerm"], input[id="SearchTerm"], input[type="text"]', { timeout: 10000 });

    // Find and fill the search input
    const searchInput = await page.$('input[name="SearchTerm"]') ||
                        await page.$('input[id="SearchTerm"]') ||
                        await page.$('input[type="text"]');

    if (!searchInput) {
      result.error = 'Could not find search input';
      return result;
    }

    // Clear any existing text and type the business name
    await searchInput.click({ clickCount: 3 });
    await searchInput.type(businessName, { delay: 50 });

    // Find and click the search button
    const searchButton = await page.$('button[type="submit"]') ||
                         await page.$('input[type="submit"]') ||
                         await page.$('button:contains("Search")') ||
                         await page.$('.search-button');

    if (searchButton) {
      await searchButton.click();
    } else {
      // Try pressing Enter instead
      await page.keyboard.press('Enter');
    }

    // Wait for results to load
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get the page content
    const content = await page.content();

    // Check if we got results
    if (content.includes('No records found') || content.includes('0 results')) {
      result.found = false;
      return result;
    }

    // Try to extract license information from the page
    const licenses = await page.evaluate(() => {
      const results = [];

      // Look for result rows/cards
      const rows = document.querySelectorAll('tr, .license-result, .result-item, .card');

      rows.forEach(row => {
        const text = row.innerText || '';

        // Skip header rows
        if (text.includes('License Number') && text.includes('Name')) return;

        // Look for license-like patterns
        const licenseMatch = text.match(/([A-Z]{2,4}\d{5,10})/);
        const statusMatch = text.match(/(Active|Expired|Revoked|Suspended|Inactive)/i);
        const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);

        if (licenseMatch || statusMatch) {
          results.push({
            raw_text: text.substring(0, 500),
            license_number: licenseMatch ? licenseMatch[1] : null,
            status: statusMatch ? statusMatch[1] : null,
            expiration_date: dateMatch ? dateMatch[1] : null
          });
        }
      });

      return results;
    });

    if (licenses.length > 0) {
      result.found = true;
      result.licenses = licenses;
    }

    // Also extract the full HTML for DeepSeek analysis
    result.html = await page.evaluate(() => document.body.innerText);

    return result;

  } catch (err) {
    result.error = err.message;
    return result;
  } finally {
    await page.close();
  }
}

/**
 * Search TDLR by license number
 * @param {Browser} browser - Puppeteer browser instance
 * @param {string} licenseNumber - License number to look up
 * @returns {Object} License details
 */
async function lookupTDLRLicense(browser, licenseNumber) {
  const page = await browser.newPage();
  const result = {
    found: false,
    license: null,
    error: null
  };

  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    await page.goto(TDLR_SEARCH_URL, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Look for license number search option
    const licenseRadio = await page.$('input[value="license"], input[name="searchType"][value="license"]');
    if (licenseRadio) {
      await licenseRadio.click();
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Fill in license number
    const searchInput = await page.$('input[name="SearchTerm"]') ||
                        await page.$('input[type="text"]');

    if (searchInput) {
      await searchInput.click({ clickCount: 3 });
      await searchInput.type(licenseNumber, { delay: 50 });
      await page.keyboard.press('Enter');

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 2000));

      const content = await page.content();

      if (!content.includes('No records found')) {
        result.found = true;
        result.html = await page.evaluate(() => document.body.innerText);

        // Try to extract structured data
        result.license = await page.evaluate(() => {
          const text = document.body.innerText;
          return {
            raw_text: text.substring(0, 2000),
            status: text.match(/(Active|Expired|Revoked|Suspended)/i)?.[1] || null,
            expiration: text.match(/Expir\w*[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1] || null,
            issue_date: text.match(/Issue\w*[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1] || null
          };
        });
      }
    }

    return result;

  } catch (err) {
    result.error = err.message;
    return result;
  } finally {
    await page.close();
  }
}

/**
 * Determine if a contractor type requires TDLR licensing
 * @param {string} businessName - Name of the business
 * @param {string} vertical - Business vertical/category
 * @returns {boolean} Whether TDLR license is expected
 */
function requiresTDLRLicense(businessName, vertical) {
  const name = (businessName || '').toLowerCase();
  const vert = (vertical || '').toLowerCase();

  const licensedKeywords = [
    'hvac', 'air condition', 'ac ', 'a/c', 'heating', 'cooling',
    'electric', 'electrical', 'electrician',
    'plumb', 'plumber', 'plumbing',
    'irrigation', 'sprinkler',
    'well', 'water well',
    'boiler',
    'towing', 'tow truck'
  ];

  return licensedKeywords.some(kw => name.includes(kw) || vert.includes(kw));
}

module.exports = {
  searchTDLR,
  lookupTDLRLicense,
  requiresTDLRLicense,
  TDLR_SEARCH_URL,
  CONTRACTOR_LICENSE_TYPES
};
