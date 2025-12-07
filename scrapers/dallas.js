#!/usr/bin/env node
/**
 * DALLAS PERMIT SCRAPER
 * Portal: Accela Citizen Access (DallasNow - migrated May 2025)
 * URL: https://aca-prod.accela.com/DALLASTX/Cap/CapHome.aspx?module=Building
 *
 * Adapted from Fort Worth Accela scraper
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = 'https://aca-prod.accela.com/DALLASTX';

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
  console.log('DALLAS PERMIT SCRAPER (DallasNow/Accela)');
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
    console.log('[1] Loading Dallas Accela portal (DallasNow)...');
    await page.goto(`${BASE_URL}/Cap/CapHome.aspx?module=Building&TabName=Home`, {
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
      fs.writeFileSync(`debug_html/dallas_p${pageNum}.html`, await page.content());

      const extractPrompt = `Extract permit records from this Dallas Accela search results page.

Look for the results table (id contains "dgvPermitList" or "gdvPermitList"). For each row, extract:
- permit_id: Record/Permit number
- address: Street address
- type: Permit type (e.g., "Building Permit", "Electrical Permit")
- date: Any date shown (Updated Time, Applied Date, etc.)
- status: Status (Issued, Finaled, Pending, Complete, Closed)
- contractor: "Created By" column value
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

      // Try next page
      console.log('    Trying next page...');
      const nextClicked = await page.evaluate((currentPage) => {
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
    source: 'dallas',
    portal_type: 'Accela',
    scraped_at: new Date().toISOString(),
    target_count: targetCount,
    actual_count: permits.length,
    with_contractor: permits.filter(p => p.contractor && p.contractor !== 'anonymous').length,
    errors: errors,
    permits: permits.slice(0, targetCount)
  };

  fs.writeFileSync('dallas_raw.json', JSON.stringify(output, null, 2));

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Permits scraped: ${output.actual_count}`);
  console.log(`With contractor: ${output.with_contractor}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Output: dallas_raw.json`);

  if (errors.length > 0) {
    console.log('\nERRORS:');
    errors.forEach(e => console.log(`  - ${e.step}: ${e.error}`));
  }

  console.log('\nSAMPLE PERMITS:');
  permits.slice(0, 5).forEach(p => {
    console.log(`  ${p.permit_id} | ${p.type} | ${p.contractor || '(none)'}`);
  });

  return output;
}

const count = parseInt(process.argv[2]) || 50;
scrape(count).catch(console.error);
