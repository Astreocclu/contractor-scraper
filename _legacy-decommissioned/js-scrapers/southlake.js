#!/usr/bin/env node
/**
 * SOUTHLAKE PERMIT SCRAPER
 * Portal: EnerGov (Angular SPA)
 * URL: https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService
 *
 * ============================================================
 * ITERATION NOTES - Update these as you learn from each run:
 * ============================================================
 *
 * LAST RUN: 2025-12-06 20:44
 * RESULT: 10 permits extracted, 5 with contractor (but hallucinated!)
 *
 * ISSUES FOUND:
 * - DeepSeek hallucinated "ABC Pools" and "John Smith" for all contractors
 * - Empty permits returned for slots 6-10 (extraction incomplete)
 * - Pagination not working - goToPage() not accessible from page.evaluate
 *
 * KNOWN WORKING:
 * - Search page loads at #/search?m=2
 * - #button-Search triggers search
 * - Sort by FinalDate works: #PermitCriteria_SortBy = 'string:FinalDate'
 * - Descending: #SortAscending = 'boolean:false'
 * - Results appear in divs with id="entityRecordDiv0", entityRecordDiv1, etc.
 * - Detail pages at #/permit/{GUID}
 * - Contacts table has aria-label attributes for extraction
 *
 * KNOWN ISSUES:
 * - (none documented yet)
 *
 * SELECTORS TO TRY IF BROKEN:
 * - Pagination: a[ng-click*="nextPage"], a[ng-click*="goToPage"]
 * - Results count: label with "Found X results"
 * - Permit links: a[href*="#/permit/"]
 *
 * DEEPSEEK PROMPT TWEAKS:
 * - If missing data, add more specific field hints
 * - If wrong format, show example output
 * ============================================================
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = 'https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService';

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
  try { return JSON.parse(text); } catch (e) {}
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (match) try { return JSON.parse(match[1]); } catch (e) {}
  return null;
}

async function scrape(targetCount = 50) {
  console.log('='.repeat(50));
  console.log('SOUTHLAKE PERMIT SCRAPER');
  console.log('='.repeat(50));
  console.log(`Target: ${targetCount} permits`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  if (!DEEPSEEK_API_KEY) {
    console.error('ERROR: DEEPSEEK_API_KEY not set');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const permits = [];
  const errors = [];

  try {
    // Step 1: Load search page
    console.log('[1] Loading search page...');
    await page.goto(`${BASE_URL}#/search?m=2`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForTimeout(5000);
    console.log('    OK - Page loaded');

    // Step 2: Click search
    console.log('[2] Clicking search button...');
    await page.click('#button-Search');
    await page.waitForTimeout(5000);
    console.log('    OK - Search submitted');

    // Step 3: Sort by most recent
    console.log('[3] Sorting by finalized date (newest first)...');
    try {
      await page.select('#PermitCriteria_SortBy', 'string:FinalDate');
      await page.waitForTimeout(1000);
      await page.select('#SortAscending', 'boolean:false');
      await page.waitForTimeout(4000);
      console.log('    OK - Sorted');
    } catch (e) {
      console.log(`    WARN - Sort failed: ${e.message}`);
      errors.push({ step: 'sort', error: e.message });
    }

    // Step 4: Extract permits from search results
    let pageNum = 1;
    while (permits.length < targetCount) {
      console.log(`\n[4.${pageNum}] Extracting page ${pageNum}...`);

      const html = cleanHTML(await page.content());
      fs.writeFileSync(`debug_html/southlake_p${pageNum}.html`, await page.content());

      const extractPrompt = `Extract ALL permit records from this Southlake EnerGov search results page.

There are divs with id="entityRecordDiv0" through "entityRecordDiv9" (10 permits per page).
Extract EVERY permit - do not skip any.

For EACH permit div, extract:
- permit_id: The permit number shown in the link (e.g., "RPOOL25-0012", "RFENC25-0092")
- address: Street address (look for TX addresses)
- type: Permit type (e.g., "Pool & Spa (Residential)", "Fence - Pool Barrier")
- status: Status like "Closed", "Issued", "Active"
- applied_date: Application date
- issued_date: Issue date
- finalized_date: Finalized date
- description: Project description text
- detail_link: The href containing "#/permit/" and a GUID

You MUST return exactly 10 permits if the page has 10 entityRecordDiv elements.

Return JSON:
{"permits": [{"permit_id": "...", "address": "...", "type": "...", "status": "...", "applied_date": "...", "issued_date": "...", "finalized_date": "...", "description": "...", "detail_link": "..."}], "count": 10}

HTML:
${html.substring(0, 120000)}`;

      const response = await callDeepSeek(extractPrompt);
      const data = parseJSON(response);

      if (data?.permits?.length) {
        // Filter out empty/invalid permits
        const validPermits = data.permits.filter(p => p.permit_id && p.permit_id.length > 3);
        permits.push(...validPermits);
        console.log(`    OK - Got ${validPermits.length} valid permits (${data.permits.length} total, ${permits.length} cumulative)`);
      } else {
        console.log('    WARN - No permits extracted');
        console.log('    Response preview:', response.substring(0, 200));
        errors.push({ step: `extract_page_${pageNum}`, error: 'No permits in response' });
      }

      if (permits.length >= targetCount) break;

      // Try next page
      const nextPage = pageNum + 1;
      console.log(`    Looking for page ${nextPage}...`);

      // Use XPath to find page link
      const hasNext = await page.evaluate((nextP) => {
        // Find all links and look for one with just the page number
        const allLinks = document.querySelectorAll('a');
        for (const link of allLinks) {
          const text = link.textContent?.trim();
          // Match page number or "Next" / ">"
          if (text === String(nextP) || (text === '>' && nextP > 1)) {
            console.log('Found pagination link:', text);
            link.click();
            return true;
          }
        }
        // Also try the Angular pagination specifically
        const paginationLinks = document.querySelectorAll('.pagination a, [ng-click*="Page"] a');
        for (const link of paginationLinks) {
          if (link.textContent?.trim() === String(nextP)) {
            link.click();
            return true;
          }
        }
        return false;
      }, nextPage);

      if (!hasNext) {
        console.log('    No more pages available');
        break;
      }
      console.log(`    Navigating to page ${nextPage}...`);

      await page.waitForTimeout(4000);
      pageNum++;
    }

    // Step 5: Get contractor details from detail pages
    console.log(`\n[5] Getting contractor details for ${Math.min(permits.length, targetCount)} permits...`);

    for (let i = 0; i < Math.min(permits.length, targetCount); i++) {
      const permit = permits[i];
      if (!permit.detail_link) continue;

      // Build full URL - detail_link is like "#/permit/GUID"
      const detailUrl = `https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService${permit.detail_link}`;
      console.log(`    Visiting: ${detailUrl}`);

      try {
        await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForTimeout(3000);

        const rawHtml = await page.content();
        fs.writeFileSync(`debug_html/southlake_detail_${i}.html`, rawHtml);
        const html = cleanHTML(rawHtml);

        // Extract just the aria-label patterns we need
        const ariaLabels = html.match(/aria-label="(Type |Company |First Name |Last Name )[^"]*"/g) || [];
        const valuationMatch = html.match(/\$[\d,]+\.\d{2}/g) || [];

        const detailPrompt = `Extract contractor info from these aria-label attributes found on a permit page:

${ariaLabels.join('\n')}

Valuation amounts found: ${valuationMatch.slice(0, 5).join(', ')}

Parse the aria-labels to extract:
- contractor_company: Value after "Company " (e.g., aria-label="Company CBM Construction" -> "CBM Construction")
- contractor_name: Combine First Name + Last Name values
- contractor_type: Value after "Type " (e.g., "Applicant", "Contractor")
- valuation: First dollar amount

Return JSON:
{"contractor_company": "", "contractor_name": "", "contractor_type": "", "valuation": ""}`;

        const response = await callDeepSeek(detailPrompt);
        const data = parseJSON(response);

        if (data) {
          permit.contractor_company = data.contractor_company || '';
          permit.contractor_name = data.contractor_name || '';
          permit.contractor_type = data.contractor_type || '';
          permit.valuation = data.valuation || '';
          if (data.full_description) permit.description = data.full_description;
        }

        const contractor = permit.contractor_company || permit.contractor_name || '(none)';
        console.log(`    ${i + 1}/${targetCount}: ${permit.permit_id} -> ${contractor}`);

      } catch (e) {
        console.log(`    ${i + 1}/${targetCount}: ${permit.permit_id} -> ERROR: ${e.message}`);
        errors.push({ step: `detail_${permit.permit_id}`, error: e.message });
      }
    }

  } catch (e) {
    console.error(`\nFATAL ERROR: ${e.message}`);
    errors.push({ step: 'main', error: e.message });
  } finally {
    await browser.close();
  }

  // Save results
  const output = {
    source: 'southlake',
    portal_type: 'EnerGov',
    scraped_at: new Date().toISOString(),
    target_count: targetCount,
    actual_count: permits.length,
    with_contractor: permits.filter(p => p.contractor_company || p.contractor_name).length,
    errors: errors,
    permits: permits.slice(0, targetCount)
  };

  fs.writeFileSync('southlake_raw.json', JSON.stringify(output, null, 2));

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Permits scraped: ${output.actual_count}`);
  console.log(`With contractor: ${output.with_contractor}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Output: southlake_raw.json`);

  if (errors.length > 0) {
    console.log('\nERRORS:');
    errors.forEach(e => console.log(`  - ${e.step}: ${e.error}`));
  }

  return output;
}

const count = parseInt(process.argv[2]) || 50;
scrape(count).catch(console.error);
