#!/usr/bin/env node
/**
 * MGO CONNECT PERMIT SCRAPER
 * Portal: My Government Online (MGO Connect)
 * Covers: Irving, Lewisville, Denton, Cedar Hill, and more DFW cities
 *
 * Requires login - credentials from .env:
 *   MGO_EMAIL, MGO_PASSWORD
 *
 * Usage:
 *   node scrapers/mgo_connect.js Irving 50
 *   node scrapers/mgo_connect.js Lewisville 25
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const MGO_EMAIL = process.env.MGO_EMAIL;
const MGO_PASSWORD = process.env.MGO_PASSWORD;

// City JID mappings (jurisdiction IDs)
const MGO_CITIES = {
  // DFW Area
  'Irving': 245,
  'Lewisville': 325,
  'Duncanville': 0,
  'Celina': 0,
  'Lucas': 0,
  'PilotPoint': 0,
  'Pilot Point': 0,
  'VanAlstyne': 0,
  'Van Alstyne': 0,
  // Central Texas
  'Georgetown': 0,
  'Temple': 0,
  'Killeen': 0,
  'SanMarcos': 0,
  'San Marcos': 0,
  // Other major
  'Amarillo': 0,
  'WichitaFalls': 0,
  'Wichita Falls': 0,
  // Note: ID 0 means lookup by name
};

async function callDeepSeek(prompt) {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 4000
    })
  });
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

function cleanHTML(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/\s+/g, ' ');
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch (e) { }
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (match) try { return JSON.parse(match[1]); } catch (e) { }
  return null;
}

async function login(page) {
  console.log('[LOGIN] Navigating to login page...');
  await page.goto('https://www.mgoconnect.org/cp/login', {
    waitUntil: 'networkidle2',
    timeout: 60000
  });
  await page.waitForTimeout(3000);

  // Check if already logged in
  const currentUrl = page.url();
  if (!currentUrl.includes('login')) {
    console.log('[LOGIN] Already logged in');
    return true;
  }

  console.log('[LOGIN] Entering credentials...');

  // Find and fill email field
  try {
    await page.waitForSelector('input[type="email"], input[name*="email"], #exampleInputEmail1', { timeout: 10000 });
    await page.type('input[type="email"], input[name*="email"], #exampleInputEmail1', MGO_EMAIL, { delay: 50 });
    console.log('[LOGIN] Email entered');
  } catch (e) {
    console.log('[LOGIN] Could not find email field, trying alternative...');
    const emailInput = await page.$('input[placeholder*="email" i]');
    if (emailInput) {
      await emailInput.type(MGO_EMAIL, { delay: 50 });
    }
  }

  // Find and fill password field
  try {
    await page.type('input[type="password"], #exampleInputPassword1', MGO_PASSWORD, { delay: 50 });
    console.log('[LOGIN] Password entered');
  } catch (e) {
    console.log('[LOGIN] Could not find password field');
  }

  // Click login button
  console.log('[LOGIN] Clicking login button...');
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent?.toLowerCase().includes('login')) {
        btn.click();
        return;
      }
    }
  });

  await page.waitForTimeout(5000);

  // Check if login succeeded
  const postLoginUrl = page.url();
  if (postLoginUrl.includes('login')) {
    console.log('[LOGIN] FAILED - still on login page');
    await page.screenshot({ path: 'debug_html/mgo_login_failed.png', fullPage: true });
    return false;
  }

  console.log('[LOGIN] SUCCESS');
  return true;
}

async function scrape(cityName, targetCount = 50, skipDesignation = false) {
  console.log('='.repeat(50));
  console.log(`MGO CONNECT SCRAPER - ${cityName.toUpperCase()}`);
  console.log('='.repeat(50));
  console.log(`Target: ${targetCount} permits`);
  console.log(`Mode: ${skipDesignation ? 'ALL PERMITS (no designation filter)' : 'Residential only'}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Validate inputs
  if (!MGO_EMAIL || !MGO_PASSWORD) {
    console.error('ERROR: MGO_EMAIL and MGO_PASSWORD must be set in .env');
    process.exit(1);
  }

  if (!DEEPSEEK_API_KEY) {
    console.error('ERROR: DEEPSEEK_API_KEY not set');
    process.exit(1);
  }

  const jid = MGO_CITIES[cityName];
  if (jid === undefined) {
    console.error(`ERROR: Unknown city "${cityName}". Available: ${Object.keys(MGO_CITIES).join(', ')}`);
    process.exit(1);
  }

  // Use headless: false for debugging, headless: 'new' for production
  const headless = process.env.MGO_DEBUG ? false : 'new';
  console.log(`Browser mode: ${headless === false ? 'VISIBLE (debug)' : 'headless'}`);

  const browser = await puppeteer.launch({
    headless: headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  const permits = [];
  const errors = [];

  // Helper function to capture API response synchronously
  async function captureSearchResponse(actionFn) {
    // Start waiting for response BEFORE triggering the action
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('/api/v3/cp/project/search-projects') &&
              !resp.url().includes('chart') &&
              resp.status() === 200,
      { timeout: 30000 }
    );

    // Execute the action (click search or next page)
    await actionFn();

    // Wait for and capture the response
    try {
      const response = await responsePromise;
      const text = await response.text();
      console.log(`    [API] search-projects response (${text.length} bytes)`);

      const data = JSON.parse(text);

      // Debug: show data structure
      const dataType = Array.isArray(data) ? 'array' : typeof data;
      console.log(`    [API] Data type: ${dataType}`);
      if (!Array.isArray(data) && typeof data === 'object') {
        console.log(`    [API] Object keys: ${Object.keys(data).slice(0, 5).join(', ')}`);
      }

      // Handle both direct array and wrapped responses
      let items = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data && typeof data === 'object') {
        // Try common wrapper properties
        items = data.data || data.results || data.projects || data.permits || data.content || [];
      }

      // Check if first item looks like a permit (has projectNumber or projectID)
      if (items.length > 0 && (items[0].projectNumber || items[0].projectID || items[0].projectAddress)) {
        console.log(`    [API] *** GOT ${items.length} PERMITS ***`);
        console.log(`    [API] Sample: ${items[0].projectNumber} | ${items[0].workType} | ${items[0].projectAddress}`);
        // Save raw API data for debugging
        fs.writeFileSync('debug_html/api_response.json', JSON.stringify(items, null, 2));
        return items;
      } else if (items.length > 0) {
        console.log(`    [API] Got ${items.length} items but not permits. First item keys: ${Object.keys(items[0]).join(', ')}`);
      } else {
        console.log(`    [API] No items found in response`);
      }

      return [];
    } catch (e) {
      console.log(`    [API] Error capturing response: ${e.message}`);
      return [];
    }
  }

  try {
    // Step 1: Login
    console.log('\n[1] Logging in...');
    const loggedIn = await login(page);
    if (!loggedIn) {
      throw new Error('Login failed');
    }

    // Step 2: Select jurisdiction (State + City) using the HOME page flow
    console.log(`\n[2] Selecting jurisdiction: Texas → ${cityName}...`);

    // IMPORTANT: Must go to /cp/home first to set jurisdiction context
    await page.goto('https://www.mgoconnect.org/cp/home', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    await page.waitForTimeout(3000);
    console.log('    On home page, selecting jurisdiction...');

    // Click State dropdown and type to filter (PrimeNG dropdowns support typing)
    console.log('    Opening State dropdown...');
    const stateClicked = await page.evaluate(() => {
      const dropdowns = document.querySelectorAll('.p-dropdown');
      for (const dd of dropdowns) {
        if (dd.textContent?.includes('Select a State')) {
          dd.click();
          return true;
        }
      }
      return false;
    });
    console.log(`    State dropdown opened: ${stateClicked}`);
    await page.waitForTimeout(1000);

    // Type "Texas" into the filter input (PrimeNG dropdowns have a filter)
    console.log('    Typing "Texas" to filter...');
    await page.keyboard.type('Texas', { delay: 100 });
    await page.waitForTimeout(1000);

    // Press Enter or click the filtered result
    const texasSelected = await page.evaluate(() => {
      const items = document.querySelectorAll('.p-dropdown-item, li[role="option"]');
      for (const item of items) {
        if (item.textContent?.includes('Texas')) {
          item.click();
          return true;
        }
      }
      return false;
    });

    if (!texasSelected) {
      console.log('    Texas not found via click, trying keyboard Enter...');
      await page.keyboard.press('Enter');
    } else {
      console.log('    Texas selected');
    }

    // CRITICAL: Wait longer for jurisdiction list to load via API call
    console.log('    Waiting 5s for jurisdictions to load...');
    await page.waitForTimeout(5000);

    // Click Jurisdiction dropdown
    console.log('    Opening Jurisdiction dropdown...');
    const jurisdictionOpened = await page.evaluate(() => {
      const dropdowns = document.querySelectorAll('.p-dropdown');
      for (const dd of dropdowns) {
        if (dd.textContent?.includes('Select a Jurisdiction') ||
          dd.textContent?.includes('Jurisdiction')) {
          dd.click();
          return true;
        }
      }
      // Try second dropdown
      if (dropdowns.length >= 2) {
        dropdowns[1].click();
        return true;
      }
      return false;
    });
    console.log(`    Jurisdiction dropdown opened: ${jurisdictionOpened}`);
    await page.waitForTimeout(1500);

    // Type city name to filter
    console.log(`    Typing "${cityName}" to filter...`);
    await page.keyboard.type(cityName, { delay: 100 });
    await page.waitForTimeout(1500);

    // Select the city
    const citySelected = await page.evaluate((city) => {
      const items = document.querySelectorAll('.p-dropdown-item, li[role="option"]');
      console.log(`Found ${items.length} dropdown items`);
      for (const item of items) {
        if (item.textContent?.toLowerCase().includes(city.toLowerCase())) {
          item.click();
          return { selected: true, text: item.textContent };
        }
      }
      return { selected: false, count: items.length };
    }, cityName);

    if (citySelected.selected) {
      console.log(`    Selected: ${citySelected.text}`);
    } else {
      console.log(`    City not found. Found ${citySelected.count} items. Trying Enter...`);
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(2000);

    // Click Continue button to establish jurisdiction context
    console.log('    Clicking Continue button...');
    const continueClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.toLowerCase().includes('continue')) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    console.log(`    Continue clicked: ${continueClicked}`);
    await page.waitForTimeout(5000);

    await page.screenshot({ path: `debug_html/mgo_${cityName.toLowerCase()}_jurisdiction.png`, fullPage: true });
    console.log(`    Current URL: ${page.url()}`);

    // Step 3: Navigate to permit search
    console.log('\n[3] Looking for permit search...');

    // Try clicking "Search Permits" link
    const searchClicked = await page.evaluate(() => {
      const links = document.querySelectorAll('a');
      for (const link of links) {
        if (link.textContent?.toLowerCase().includes('search permit')) {
          link.click();
          return true;
        }
      }
      return false;
    });

    if (searchClicked) {
      console.log('    Clicked "Search Permits" link');
      await page.waitForTimeout(5000);
    } else {
      // Try direct URL
      console.log('    Trying direct search URL...');
      await page.goto('https://www.mgoconnect.org/cp/search', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await page.waitForTimeout(3000);
    }

    console.log(`    Search URL: ${page.url()}`);
    await page.screenshot({ path: `debug_html/mgo_${cityName.toLowerCase()}_search.png`, fullPage: true });
    fs.writeFileSync(`debug_html/mgo_${cityName.toLowerCase()}_search.html`, await page.content());

    // Step 4: Analyze and interact with search page
    console.log('\n[4] Analyzing search page...');

    const html = cleanHTML(await page.content());
    const analyzePrompt = `Analyze this MGO Connect permit search page for ${cityName}, TX.

1. What search fields are available? (permit number, address, date range, permit type, etc.)
2. Is there a way to search for all recent permits?
3. What buttons/actions are available?
4. Are there any results already showing?

Return JSON:
{
  "page_type": "search_form|results_list|error|other",
  "search_fields": ["field1", "field2"],
  "has_results": true/false,
  "result_count": <number or null>,
  "search_button_selector": "CSS selector for search button",
  "next_action": "click_search|fill_date_range|select_permit_type|none",
  "notes": "any useful observations"
}

HTML:
${html.substring(0, 80000)}`;

    const analysisResponse = await callDeepSeek(analyzePrompt);
    const analysis = parseJSON(analysisResponse);

    if (analysis) {
      console.log(`    Page type: ${analysis.page_type}`);
      console.log(`    Search fields: ${analysis.search_fields?.join(', ') || 'none found'}`);
      console.log(`    Has results: ${analysis.has_results}`);
      console.log(`    Next action: ${analysis.next_action}`);
    }

    // Step 5: Fill in search criteria (Designation, Date Range)
    console.log('\n[5] Filling search criteria...');

    // Calculate date range - 4 weeks back
    const today = new Date();
    const weeksBack = 4;
    const startDate = new Date(today.getTime() - weeksBack * 7 * 24 * 60 * 60 * 1000);
    const formatDate = (d) => `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}/${d.getFullYear()}`;
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(today);
    console.log(`    Date range: ${startDateStr} to ${endDateStr} (${weeksBack} weeks)`);

    // 5a: Select "Residential" from Designation dropdown (skip if --no-filter flag)
    if (!skipDesignation) {
      console.log('    Selecting Designation: Residential...');
      const designationSelected = await page.evaluate(async () => {
        const dropdowns = document.querySelectorAll('.p-dropdown');
        for (const dd of dropdowns) {
          const label = dd.querySelector('.p-dropdown-label');
          if (label && (label.textContent?.includes('Select Designation') || label.getAttribute('aria-label')?.includes('Designation'))) {
            dd.click();
            return { opened: true };
          }
        }
        return { opened: false, error: 'Designation dropdown not found' };
      });

      if (designationSelected.opened) {
        await page.waitForTimeout(1000);
        await page.keyboard.type('Residential', { delay: 50 });
        await page.waitForTimeout(500);

        const selected = await page.evaluate(() => {
          const items = document.querySelectorAll('.p-dropdown-item, li[role="option"]');
          for (const item of items) {
            if (item.textContent?.toLowerCase().includes('residential')) {
              item.click();
              return { selected: true, text: item.textContent?.trim() };
            }
          }
          return { selected: false };
        });
        console.log(`    Designation: ${selected.selected ? selected.text : 'NOT SELECTED'}`);
      } else {
        console.log(`    WARNING: ${designationSelected.error}`);
      }
      await page.waitForTimeout(1000);
    } else {
      console.log('    SKIPPING designation filter (--no-filter mode)');
    }

    // 5b: Fill date fields using keyboard input (PrimeNG calendars need actual typing)
    console.log('    Setting date filters...');

    // Find and click on "Created After" input, then type the date
    const afterInput = await page.$('input[placeholder="Created After"]');
    if (afterInput) {
      await afterInput.click();
      await page.waitForTimeout(300);
      // Clear any existing value and type new one
      await afterInput.click({ clickCount: 3 }); // Select all
      await page.keyboard.type(startDateStr, { delay: 50 });
      await page.keyboard.press('Tab'); // Tab out to confirm
      await page.waitForTimeout(500);
      console.log(`    Created After (${startDateStr}): typed`);
    } else {
      console.log(`    Created After: NOT FOUND`);
    }

    // Find and click on "Created Before" input, then type the date
    const beforeInput = await page.$('input[placeholder="Created Before"]');
    if (beforeInput) {
      await beforeInput.click();
      await page.waitForTimeout(300);
      await beforeInput.click({ clickCount: 3 }); // Select all
      await page.keyboard.type(endDateStr, { delay: 50 });
      await page.keyboard.press('Tab'); // Tab out to confirm
      await page.waitForTimeout(500);
      console.log(`    Created Before (${endDateStr}): typed`);
    } else {
      console.log(`    Created Before: NOT FOUND`);
    }

    // Click somewhere neutral to ensure Angular picks up the changes
    await page.click('body');
    await page.waitForTimeout(500);

    await page.waitForTimeout(1000);

    // Click search and capture API response synchronously
    console.log('    Clicking search and capturing API response...');

    const apiPermitData = await captureSearchResponse(async () => {
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, input[type="submit"]');
        for (const btn of buttons) {
          const text = (btn.textContent || btn.value || '').toLowerCase();
          if (text.includes('search') || text.includes('find') || text.includes('submit')) {
            btn.click();
            return;
          }
        }
      });
    });

    // Wait a moment for Angular to render
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `debug_html/mgo_${cityName.toLowerCase()}_results.png`, fullPage: true });
    fs.writeFileSync(`debug_html/mgo_${cityName.toLowerCase()}_results.html`, await page.content());

    // Step 6: Extract permits
    console.log('\n[6] Extracting permits...');

    // First try to extract directly from the rendered table (more reliable)
    const tableData = await page.evaluate(() => {
      const results = [];

      // Find the results table - look for p-table or standard table with permit data
      const table = document.querySelector('p-table table, table.p-datatable-table, .p-datatable table');
      if (!table) {
        // Try looking for any table with the right headers
        const tables = document.querySelectorAll('table');
        for (const t of tables) {
          const headers = t.querySelectorAll('th');
          const headerText = Array.from(headers).map(h => h.textContent?.toLowerCase() || '').join(' ');
          if (headerText.includes('project') || headerText.includes('permit') || headerText.includes('address')) {
            // Found the right table
            const rows = t.querySelectorAll('tbody tr');
            for (const row of rows) {
              const cells = row.querySelectorAll('td');
              if (cells.length >= 4) {
                results.push({
                  permit_id: cells[0]?.textContent?.trim() || '',
                  project_name: cells[1]?.textContent?.trim() || '',
                  type: cells[2]?.textContent?.trim() || '',
                  status: cells[3]?.textContent?.trim() || '',
                  address: cells[4]?.textContent?.trim() || ''
                });
              }
            }
            break;
          }
        }
        return { source: 'fallback_table', count: results.length, results };
      }

      // Extract from p-table
      const rows = table.querySelectorAll('tbody tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 4) {
          results.push({
            permit_id: cells[0]?.textContent?.trim() || '',
            project_name: cells[1]?.textContent?.trim() || '',
            type: cells[2]?.textContent?.trim() || '',
            status: cells[3]?.textContent?.trim() || '',
            address: cells[4]?.textContent?.trim() || ''
          });
        }
      }
      return { source: 'p-table', count: results.length, results };
    });

    console.log(`    Table extraction: ${tableData.count} rows from ${tableData.source}`);

    // Add table data to permits
    if (tableData.results?.length > 0) {
      for (const item of tableData.results) {
        if (item.permit_id) {
          permits.push({
            permit_id: item.permit_id,
            address: item.address || '',
            type: item.type || '',
            status: item.status || '',
            description: item.project_name || '',
            contractor: ''
          });
        }
      }
      console.log(`    Extracted ${permits.length} permits from table`);
    }

    // Also try API data if we captured any
    let totalRowsFromAPI = 0;
    if (apiPermitData.length > 0 && permits.length === 0) {
      console.log(`    Using ${apiPermitData.length} permits from API response`);

      // Get total rows count from first item (API returns totalRows in each row)
      if (apiPermitData[0]?.totalRows) {
        totalRowsFromAPI = apiPermitData[0].totalRows;
        console.log(`    API reports ${totalRowsFromAPI} total matching permits`);
      }

      // Map API data to our permit format
      for (const item of apiPermitData) {
        const permit = {
          permit_id: item.projectNumber || item.projectID || item.permitNumber || item.id,
          address: item.projectAddress || item.address || item.siteAddress || item.propertyAddress || '',
          type: item.workType || item.permitType || item.type || '',
          designation: item.designation || item.designationType || '',
          status: item.projectStatus || item.status || '',
          date: item.dateCreated || item.createdDate || item.issuedDate || '',
          description: item.projectDescription || item.description || item.projectName || '',
          contractor: item.contractorName || item.contractor || item.businessName || ''
        };

        if (permit.permit_id || permit.address) {
          permits.push(permit);
        }
      }

      console.log(`    Extracted ${permits.length} permits from API data (page 1)`);
    }

    // Paginate through remaining results if there are more
    const effectiveTarget = Math.min(targetCount, totalRowsFromAPI || 500);
    let pageNum = 1;
    while (permits.length < effectiveTarget && totalRowsFromAPI > 0 && permits.length < totalRowsFromAPI) {
      console.log(`    Need more permits (have ${permits.length}/${totalRowsFromAPI}, target ${effectiveTarget})...`);

      // Check if next page button is available
      const hasNextPage = await page.evaluate(() => {
        const nextBtns = document.querySelectorAll('.p-paginator-next, button[aria-label="Next Page"]');
        for (const btn of nextBtns) {
          if (!btn.disabled && !btn.classList.contains('p-disabled')) {
            return true;
          }
        }
        return false;
      });

      if (!hasNextPage) {
        console.log('    No more pages available');
        break;
      }

      pageNum++;
      console.log(`    Fetching page ${pageNum}...`);

      // Click next and capture response synchronously
      const nextPageData = await captureSearchResponse(async () => {
        await page.evaluate(() => {
          const nextBtns = document.querySelectorAll('.p-paginator-next, button[aria-label="Next Page"]');
          for (const btn of nextBtns) {
            if (!btn.disabled && !btn.classList.contains('p-disabled')) {
              btn.click();
              return;
            }
          }
        });
      });

      if (nextPageData.length > 0) {
        for (const item of nextPageData) {
          const permit = {
            permit_id: item.projectNumber || item.projectID || item.permitNumber || item.id,
            address: item.projectAddress || item.address || item.siteAddress || item.propertyAddress || '',
            type: item.workType || item.permitType || item.type || '',
            designation: item.designation || item.designationType || '',
            status: item.projectStatus || item.status || '',
            date: item.dateCreated || item.createdDate || item.issuedDate || '',
            description: item.projectDescription || item.description || item.projectName || '',
            contractor: item.contractorName || item.contractor || item.businessName || ''
          };

          if (permit.permit_id || permit.address) {
            permits.push(permit);
          }
        }
        console.log(`    Page ${pageNum}: Got ${nextPageData.length} permits (total: ${permits.length})`);
      } else {
        console.log(`    Page ${pageNum}: No data, stopping pagination`);
        break;
      }
    }

    // If no API data at all, fall back to DeepSeek
    if (permits.length === 0) {
      console.log('    No API data captured, trying DeepSeek extraction...');
      const resultsHtml = cleanHTML(await page.content());

      const extractPrompt = `Extract ALL permit records from this MGO Connect search results page for ${cityName}, TX.

Look for permit data in tables, grids, or card layouts. For each permit, extract:
- permit_id: Permit/Record number (e.g., "BLD-2024-12345", "PRJ-123456")
- address: Property address
- type: Permit type (Building, Electrical, Plumbing, Mechanical, Pool, Fence, etc.)
- date: Date (applied, issued, or finalized)
- status: Status (Issued, Active, Complete, Closed, Expired, etc.)
- contractor: Contractor name if shown
- description: Project description if shown

Return JSON:
{"permits": [{...}], "has_next_page": true/false, "total_results": <number or null>}

HTML:
${resultsHtml.substring(0, 100000)}`;

      const extractResponse = await callDeepSeek(extractPrompt);
      const extractData = parseJSON(extractResponse);

      if (extractData?.permits?.length) {
        const validPermits = extractData.permits.filter(p => p.permit_id);
        permits.push(...validPermits);
        console.log(`    DeepSeek got ${validPermits.length} permits`);
      } else {
        console.log('    No permits found via DeepSeek');
        errors.push({ step: 'extract_deepseek', error: 'No permits in response' });
      }
    }

    console.log(`\n    Total permits extracted: ${permits.length}`);

  } catch (e) {
    console.error(`\nFATAL ERROR: ${e.message}`);
    errors.push({ step: 'main', error: e.message });
    await page.screenshot({ path: `debug_html/mgo_${cityName.toLowerCase()}_error.png`, fullPage: true });
  } finally {
    await browser.close();
  }

  // Save results
  const output = {
    source: cityName.toLowerCase(),
    portal_type: 'MGO_Connect',
    jid: MGO_CITIES[cityName],
    scraped_at: new Date().toISOString(),
    target_count: targetCount,
    actual_count: permits.length,
    with_contractor: permits.filter(p => p.contractor).length,
    errors: errors,
    permits: permits.slice(0, targetCount)
  };

  const outputFile = `${cityName.toLowerCase()}_raw.json`;
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`City: ${cityName}`);
  console.log(`Permits scraped: ${output.actual_count}`);
  console.log(`With contractor: ${output.with_contractor}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Output: ${outputFile}`);

  if (errors.length > 0) {
    console.log('\nERRORS:');
    errors.forEach(e => console.log(`  - ${e.step}: ${e.error}`));
  }

  if (permits.length > 0) {
    console.log('\nSAMPLE PERMITS:');
    permits.slice(0, 5).forEach(p => {
      console.log(`  ${p.permit_id} | ${p.type || 'unknown'} | ${p.address || 'no address'}`);
    });
  }

  return output;
}

// Parse command line args
const cityArg = process.argv[2] || 'Irving';
const countArg = parseInt(process.argv[3]) || 50;
const skipDesignation = process.argv.includes('--no-filter') || process.argv.includes('--all');

scrape(cityArg, countArg, skipDesignation).catch(console.error);
