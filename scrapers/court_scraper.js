#!/usr/bin/env node
/**
 * County Court Records Scraper for DFW Area
 *
 * Searches county court systems for civil cases, judgments, liens.
 * Focuses on DFW counties: Dallas, Tarrant, Collin, Denton.
 *
 * Usage:
 *   const { searchCourtRecords } = require('./lib/court_scraper');
 *   const result = await searchCourtRecords(browser, 'Company Name', 'Dallas');
 */

// County court search configurations
const COURT_CONFIGS = {
  tarrant: {
    name: 'Tarrant County',
    searchUrl: 'https://apps.tarrantcounty.com/vsearch/',
    directSearch: true
  },
  dallas: {
    name: 'Dallas County',
    // Dallas uses a complex portal, so we use Google site search
    searchUrl: null,
    googleSearch: true
  },
  collin: {
    name: 'Collin County',
    searchUrl: 'https://apps.collincountytx.gov/pubaccess/',
    directSearch: false,
    requiresForm: true
  },
  denton: {
    name: 'Denton County',
    searchUrl: null,
    googleSearch: true
  }
};

/**
 * Search Tarrant County court records
 */
async function searchTarrantCourt(browser, businessName) {
  const page = await browser.newPage();
  const result = {
    county: 'Tarrant',
    found: false,
    cases: [],
    error: null
  };

  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    await page.goto('https://apps.tarrantcounty.com/vsearch/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for the search form
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });

    // Look for the party name search input
    const inputs = await page.$$('input[type="text"]');
    if (inputs.length > 0) {
      await inputs[0].type(businessName, { delay: 30 });
    }

    // Select civil case type if available
    const civilOption = await page.$('select option[value*="civil"], select option[value*="CV"]');
    if (civilOption) {
      const selectId = await page.evaluate(el => el.parentElement.id, civilOption);
      if (selectId) {
        await page.select(`#${selectId}`, await page.evaluate(el => el.value, civilOption));
      }
    }

    // Submit search
    const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:contains("Search")');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    } else {
      await page.keyboard.press('Enter');
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Extract results
    const content = await page.evaluate(() => document.body.innerText);

    if (!content.includes('No records found') && !content.includes('0 results')) {
      result.found = true;
      result.html = content.substring(0, 5000);

      // Try to extract case information
      result.cases = await page.evaluate(() => {
        const cases = [];
        const rows = document.querySelectorAll('tr, .case-row, .result-row');

        rows.forEach(row => {
          const text = row.innerText || '';
          const caseMatch = text.match(/(\d{2}-\d+-\w+|\d{4}-CV-\d+)/);
          const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);

          if (caseMatch) {
            cases.push({
              case_number: caseMatch[1],
              date: dateMatch ? dateMatch[1] : null,
              description: text.substring(0, 200)
            });
          }
        });

        return cases.slice(0, 10); // Limit to 10 cases
      });
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
 * Search via Google for county court records
 * Used for counties without direct search APIs
 */
async function searchViaGoogle(browser, businessName, county) {
  const page = await browser.newPage();
  const result = {
    county: county,
    found: false,
    mentions: [],
    error: null
  };

  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    const siteMap = {
      dallas: 'dallascounty.org',
      denton: 'dentoncounty.gov',
      collin: 'collincountytx.gov'
    };

    const site = siteMap[county.toLowerCase()] || `${county.toLowerCase()}county.gov`;
    const searchQuery = `site:${site} "${businessName}" civil OR lawsuit OR judgment`;

    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Extract search results
    const content = await page.evaluate(() => document.body.innerText);

    if (!content.includes('did not match any documents') && !content.includes('No results found')) {
      result.found = true;
      result.html = content.substring(0, 5000);

      // Extract individual results
      result.mentions = await page.evaluate(() => {
        const mentions = [];
        const results = document.querySelectorAll('.g, .tF2Cxc');

        results.forEach(r => {
          const title = r.querySelector('h3')?.innerText || '';
          const snippet = r.querySelector('.VwiC3b, .IsZvec')?.innerText || '';
          const link = r.querySelector('a')?.href || '';

          if (title || snippet) {
            mentions.push({
              title: title.substring(0, 100),
              snippet: snippet.substring(0, 200),
              url: link
            });
          }
        });

        return mentions.slice(0, 5);
      });
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
 * Search Collin County court records
 */
async function searchCollinCourt(browser, businessName) {
  const page = await browser.newPage();
  const result = {
    county: 'Collin',
    found: false,
    cases: [],
    error: null
  };

  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    await page.goto('https://apps.collincountytx.gov/pubaccess/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Collin County has a more complex interface
    // Look for name search link/button
    const nameSearchLink = await page.$('a:contains("Name Search"), a[href*="name"]');
    if (nameSearchLink) {
      await nameSearchLink.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
    }

    // Find and fill search input
    const searchInput = await page.$('input[name*="name"], input[id*="name"], input[type="text"]');
    if (searchInput) {
      await searchInput.type(businessName, { delay: 30 });

      const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const content = await page.evaluate(() => document.body.innerText);

    if (!content.includes('No records') && !content.includes('0 results')) {
      result.found = true;
      result.html = content.substring(0, 5000);
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
 * Main function to search all DFW county courts
 */
async function searchCourtRecords(browser, businessName, counties = ['tarrant', 'dallas', 'collin', 'denton']) {
  const results = {
    business_name: businessName,
    courts_checked: [],
    total_cases_found: 0,
    cases: [],
    errors: []
  };

  for (const county of counties) {
    const countyLower = county.toLowerCase();

    try {
      let countyResult;

      switch (countyLower) {
        case 'tarrant':
          countyResult = await searchTarrantCourt(browser, businessName);
          break;
        case 'collin':
          countyResult = await searchCollinCourt(browser, businessName);
          break;
        case 'dallas':
        case 'denton':
        default:
          countyResult = await searchViaGoogle(browser, businessName, county);
          break;
      }

      results.courts_checked.push(countyLower);

      if (countyResult.found) {
        results.cases.push({
          county: countyResult.county,
          found: true,
          cases: countyResult.cases || [],
          mentions: countyResult.mentions || [],
          html: countyResult.html
        });
        results.total_cases_found += (countyResult.cases?.length || countyResult.mentions?.length || 0);
      }

      if (countyResult.error) {
        results.errors.push({ county: countyLower, error: countyResult.error });
      }

      // Delay between county searches
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (err) {
      results.errors.push({ county: countyLower, error: err.message });
    }
  }

  return results;
}

/**
 * Search federal court records via CourtListener API
 */
async function searchCourtListener(businessName, apiKey) {
  if (!apiKey) {
    return { found: false, error: 'No API key provided' };
  }

  const result = {
    found: false,
    cases: [],
    error: null
  };

  try {
    const response = await fetch(
      `https://www.courtlistener.com/api/rest/v3/search/?q=${encodeURIComponent(businessName)}&type=o`,
      {
        headers: {
          'Authorization': `Token ${apiKey}`
        }
      }
    );

    if (!response.ok) {
      result.error = `API error: ${response.status}`;
      return result;
    }

    const data = await response.json();

    if (data.results && data.results.length > 0) {
      result.found = true;
      result.cases = data.results.slice(0, 10).map(c => ({
        case_name: c.caseName,
        court: c.court,
        date_filed: c.dateFiled,
        docket_number: c.docketNumber,
        absolute_url: c.absolute_url
      }));
    }

    return result;

  } catch (err) {
    result.error = err.message;
    return result;
  }
}

module.exports = {
  searchCourtRecords,
  searchTarrantCourt,
  searchCollinCourt,
  searchViaGoogle,
  searchCourtListener,
  COURT_CONFIGS
};
