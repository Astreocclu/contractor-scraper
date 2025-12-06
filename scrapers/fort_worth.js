#!/usr/bin/env node
/**
 * FORT WORTH PERMIT SCRAPER
 * Portal: Accela Citizen Access
 * URL: https://aca-prod.accela.com/CFW/Cap/CapHome.aspx?module=Development
 *
 * ============================================================
 * ITERATION NOTES - Update these as you learn from each run:
 * ============================================================
 *
 * LAST RUN: 2025-12-06 20:45
 * RESULT: 10 permits, all with contractor (cathedralplumbingtx.com)
 *
 * ISSUES FOUND:
 * - Addresses all show "undefined undefined undefined" - HTML has placeholder data
 * - Pagination page 2 failed - DeepSeek couldn't parse truncated HTML
 * - All contractors same value (might be session user, not permit contractor)
 *
 * KNOWN WORKING:
 * - Portal loads at CapHome.aspx?module=Development&TabName=Development
 * - Search button: #ctl00_PlaceHolderMain_btnNewSearch
 * - Results appear in table: #ctl00_PlaceHolderMain_dgvPermitList_gdvPermitList
 * - Contractor shown in "Created By" column (usernames like "cathedralplumbingtx.com")
 * - Test run got 10 permits successfully
 *
 * KNOWN ISSUES:
 * - Contractor field shows usernames, not company names
 * - Some addresses show "undefined" for city/zip
 * - Dates are "Updated Time" not issue date
 *
 * SELECTORS TO TRY IF BROKEN:
 * - Search form: #ctl00_PlaceHolderMain_dvGenearlSearch
 * - Pagination: look for page number links in table footer
 * - Detail links: a[href*="CapDetail.aspx"]
 *
 * DEEPSEEK PROMPT TWEAKS:
 * - May need to specify Accela table structure
 * - Contractor is in "Created By" column
 * ============================================================
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = 'https://aca-prod.accela.com/CFW';

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
  console.log('FORT WORTH PERMIT SCRAPER');
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
    console.log('[1] Loading Fort Worth Accela portal...');
    await page.goto(`${BASE_URL}/Cap/CapHome.aspx?module=Development&TabName=Development`, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    await page.waitForTimeout(3000);
    console.log('    OK - Page loaded');

    // Step 2: Submit search (empty search = all recent permits)
    console.log('[2] Submitting search...');
    try {
      await page.click('#ctl00_PlaceHolderMain_btnNewSearch');
      await page.waitForTimeout(8000);
      console.log('    OK - Search submitted');
    } catch (e) {
      console.log(`    WARN - Search button click failed: ${e.message}`);
      errors.push({ step: 'search_click', error: e.message });
    }

    // Step 3: Extract permits from results pages
    let pageNum = 1;
    while (permits.length < targetCount) {
      console.log(`\n[3.${pageNum}] Extracting page ${pageNum}...`);

      const html = cleanHTML(await page.content());
      fs.writeFileSync(`debug_html/fortworth_p${pageNum}.html`, await page.content());

      const extractPrompt = `Extract permit records from this Fort Worth Accela search results page.

Look for the results table (id contains "dgvPermitList" or "gdvPermitList"). For each row, extract:
- permit_id: Record/Permit number (e.g., "PM25-10408", "PE25-14386")
- address: Street address (may have "undefined" parts - keep as-is)
- type: Permit type (e.g., "Mechanical Umbrella Permit", "Electrical Standalone Permit")
- date: Any date shown (Updated Time, Applied Date, etc.)
- status: Status (Issued, Finaled, Pending, Complete, Closed)
- contractor: "Created By" column value (may be username like "cathedralplumbingtx.com")
- description: Project name/description if shown

Return JSON:
{"permits": [{"permit_id": "...", "address": "...", "type": "...", "date": "...", "status": "...", "contractor": "...", "description": "..."}], "has_next_page": true/false, "total_rows": <number>}

HTML (truncated):
${html.substring(0, 100000)}`;

      const response = await callDeepSeek(extractPrompt);
      const data = parseJSON(response);

      if (data?.permits?.length) {
        permits.push(...data.permits);
        console.log(`    OK - Got ${data.permits.length} permits (total: ${permits.length})`);
        console.log(`    Has next page: ${data.has_next_page}`);
      } else {
        console.log('    WARN - No permits extracted');
        console.log('    Response preview:', response.substring(0, 200));
        errors.push({ step: `extract_page_${pageNum}`, error: 'No permits in response' });
        break;
      }

      if (permits.length >= targetCount) break;
      if (!data.has_next_page) {
        console.log('    No more pages indicated');
        break;
      }

      // Try next page - Accela uses numeric page links
      console.log('    Trying next page...');
      const nextClicked = await page.evaluate((currentPage) => {
        // Look for page number link
        const links = document.querySelectorAll('a[href*="javascript:"]');
        for (const link of links) {
          const text = link.textContent?.trim();
          if (text === String(currentPage + 1)) {
            link.click();
            return true;
          }
          if (text === '>' || text === 'Next' || text === '»') {
            link.click();
            return true;
          }
        }
        return false;
      }, pageNum);

      if (!nextClicked) {
        console.log('    Could not find next page link');
        break;
      }

      await page.waitForTimeout(5000);
      pageNum++;
    }

  } catch (e) {
    console.error(`\nFATAL ERROR: ${e.message}`);
    errors.push({ step: 'main', error: e.message });
  } finally {
    await browser.close();
  }

  // Save results
  const output = {
    source: 'fort_worth',
    portal_type: 'Accela',
    scraped_at: new Date().toISOString(),
    target_count: targetCount,
    actual_count: permits.length,
    with_contractor: permits.filter(p => p.contractor && p.contractor !== 'anonymous').length,
    errors: errors,
    permits: permits.slice(0, targetCount)
  };

  fs.writeFileSync('fort_worth_raw.json', JSON.stringify(output, null, 2));

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Permits scraped: ${output.actual_count}`);
  console.log(`With contractor: ${output.with_contractor}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Output: fort_worth_raw.json`);

  if (errors.length > 0) {
    console.log('\nERRORS:');
    errors.forEach(e => console.log(`  - ${e.step}: ${e.error}`));
  }

  // Show samples
  console.log('\nSAMPLE PERMITS:');
  permits.slice(0, 5).forEach(p => {
    console.log(`  ${p.permit_id} | ${p.type} | ${p.contractor || '(none)'}`);
  });

  return output;
}

const count = parseInt(process.argv[2]) || 50;
scrape(count).catch(console.error);
