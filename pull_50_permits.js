#!/usr/bin/env node
/**
 * Pull 50 raw permits each from Southlake and Fort Worth
 * No filtering - just grab recent permits with whatever data is available
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

async function callDeepSeek(prompt, maxTokens = 8000) {
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
      max_tokens: maxTokens
    })
  });
  const data = await response.json();
  return data.choices[0].message.content;
}

function cleanHTML(html) {
  let cleaned = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
  cleaned = cleaned.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');
  cleaned = cleaned.replace(/\s+/g, ' ');
  return cleaned;
}

function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1].trim()); } catch (e2) {}
    }
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch (e3) {}
    }
    return null;
  }
}

async function pullSouthlake(browser, targetCount = 50) {
  console.log('\n========================================');
  console.log('SOUTHLAKE - Pulling permits');
  console.log('========================================\n');

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  const allPermits = [];

  try {
    // Go to search page
    console.log('Loading Southlake EnerGov portal...');
    const searchUrl = 'https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService#/search?m=2&ps=10&pn=1&em=true';
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));

    // Click search to get all permits
    console.log('Clicking search button...');
    const searchBtn = await page.$('#button-Search');
    if (searchBtn) {
      await searchBtn.click();
      await new Promise(r => setTimeout(r, 5000));
    }

    // Sort by most recent
    console.log('Sorting by Finalized Date (newest first)...');
    try {
      await page.select('#PermitCriteria_SortBy', 'string:FinalDate');
      await new Promise(r => setTimeout(r, 1000));
      await page.select('#SortAscending', 'boolean:false');
      await new Promise(r => setTimeout(r, 4000));
    } catch (e) {
      console.log('  Sort failed, continuing with default order');
    }

    // Pull multiple pages
    let pageNum = 1;
    while (allPermits.length < targetCount && pageNum <= 6) {
      console.log(`\nExtracting page ${pageNum}...`);

      const html = await page.content();
      const cleanedHtml = cleanHTML(html);

      const extractPrompt = `Extract ALL permit records from this Southlake EnerGov search results page.

For EACH permit record visible, extract:
- permit_id: Permit number
- address: Full address
- type: Permit type
- applied_date: Application date
- issued_date: Issue date
- finalized_date: Finalized date
- status: Current status
- description: Project description
- contractor: Any contractor/applicant name visible
- detail_link: Link to detail page (href with GUID)

Return JSON array of permits:
{
  "permits": [
    {
      "permit_id": "...",
      "address": "...",
      "type": "...",
      "applied_date": "...",
      "issued_date": "...",
      "finalized_date": "...",
      "status": "...",
      "description": "...",
      "contractor": "...",
      "detail_link": "..."
    }
  ],
  "has_next_page": true/false,
  "total_shown": <number of permits on this page>
}

HTML:
${cleanedHtml.substring(0, 150000)}`;

      const response = await callDeepSeek(extractPrompt);
      const data = extractJSON(response);

      if (data && data.permits) {
        for (const p of data.permits) {
          p.source = 'southlake';
          p.scraped_at = new Date().toISOString();
          allPermits.push(p);
        }
        console.log(`  Got ${data.permits.length} permits (total: ${allPermits.length})`);
      }

      // Try to go to next page
      if (allPermits.length < targetCount) {
        try {
          const nextBtn = await page.$('a[ng-click*="nextPage"]');
          if (nextBtn) {
            await nextBtn.click();
            await new Promise(r => setTimeout(r, 4000));
            pageNum++;
          } else {
            // Try clicking page number
            const pageLink = await page.$(`a[ng-click*="goToPage(${pageNum + 1})"]`);
            if (pageLink) {
              await pageLink.click();
              await new Promise(r => setTimeout(r, 4000));
              pageNum++;
            } else {
              break;
            }
          }
        } catch (e) {
          console.log('  No more pages');
          break;
        }
      }
    }

    console.log(`\nSouthlake complete: ${allPermits.length} permits`);

  } catch (error) {
    console.error('Southlake error:', error.message);
  } finally {
    await page.close();
  }

  return allPermits.slice(0, targetCount);
}

async function pullFortWorth(browser, targetCount = 50) {
  console.log('\n========================================');
  console.log('FORT WORTH - Pulling permits');
  console.log('========================================\n');

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  const allPermits = [];

  try {
    // Go to Fort Worth Accela portal
    console.log('Loading Fort Worth Accela portal...');
    const url = 'https://aca-prod.accela.com/CFW/Cap/CapHome.aspx?module=Development&TabName=Development';
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    // Click search button to get results
    console.log('Submitting search...');
    try {
      const searchBtn = await page.$('#ctl00_PlaceHolderMain_btnNewSearch');
      if (searchBtn) {
        await searchBtn.click();
        await new Promise(r => setTimeout(r, 8000));
      }
    } catch (e) {
      console.log('  Search button click failed:', e.message);
    }

    // Pull multiple pages
    let pageNum = 1;
    while (allPermits.length < targetCount && pageNum <= 6) {
      console.log(`\nExtracting page ${pageNum}...`);

      const html = await page.content();
      const cleanedHtml = cleanHTML(html);

      // Save debug
      fs.writeFileSync(`debug_html/fortworth_page${pageNum}.html`, html);

      const extractPrompt = `Extract ALL permit records from this Fort Worth Accela search results page.

Look for a results table with permit data. For EACH permit row, extract:
- permit_id: Permit/Record number (e.g., "PM25-10408", "PE25-14386")
- address: Full street address
- type: Permit type (e.g., "Mechanical Umbrella Permit", "Electrical Standalone Permit")
- date: Any date shown (applied, issued, updated)
- status: Status (Issued, Finaled, Pending, etc.)
- contractor: Contractor name, company, or username if shown
- description: Project description if any

Return JSON:
{
  "permits": [
    {
      "permit_id": "...",
      "address": "...",
      "type": "...",
      "date": "...",
      "status": "...",
      "contractor": "...",
      "description": "..."
    }
  ],
  "has_next_page": true/false,
  "total_shown": <number>
}

HTML:
${cleanedHtml.substring(0, 150000)}`;

      const response = await callDeepSeek(extractPrompt);
      const data = extractJSON(response);

      if (data && data.permits) {
        for (const p of data.permits) {
          p.source = 'fort_worth';
          p.scraped_at = new Date().toISOString();
          allPermits.push(p);
        }
        console.log(`  Got ${data.permits.length} permits (total: ${allPermits.length})`);
      }

      // Try to go to next page
      if (allPermits.length < targetCount && data?.has_next_page) {
        try {
          // Accela pagination - look for next page link
          const nextLinks = await page.$$('a[href*="javascript:"][class*="aca"]');
          let clicked = false;

          for (const link of nextLinks) {
            const text = await page.evaluate(el => el.textContent, link);
            if (text.includes('>') || text.includes('Next') || text.trim() === String(pageNum + 1)) {
              await link.click();
              await new Promise(r => setTimeout(r, 5000));
              clicked = true;
              pageNum++;
              break;
            }
          }

          if (!clicked) {
            // Try direct page number click
            const pageLinks = await page.$$('a');
            for (const link of pageLinks) {
              const text = await page.evaluate(el => el.textContent?.trim(), link);
              if (text === String(pageNum + 1)) {
                await link.click();
                await new Promise(r => setTimeout(r, 5000));
                pageNum++;
                break;
              }
            }
          }
        } catch (e) {
          console.log('  Pagination failed:', e.message);
          break;
        }
      } else {
        break;
      }
    }

    console.log(`\nFort Worth complete: ${allPermits.length} permits`);

  } catch (error) {
    console.error('Fort Worth error:', error.message);
  } finally {
    await page.close();
  }

  return allPermits.slice(0, targetCount);
}

async function main() {
  console.log('==============================================');
  console.log('Permit Puller - 50 each from Southlake & Fort Worth');
  console.log('==============================================');
  console.log(`Started: ${new Date().toISOString()}\n`);

  if (!DEEPSEEK_API_KEY) {
    console.error('ERROR: DEEPSEEK_API_KEY not set');
    process.exit(1);
  }

  // Ensure debug dir exists
  if (!fs.existsSync('debug_html')) {
    fs.mkdirSync('debug_html');
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // Pull from both cities
    const southlakePermits = await pullSouthlake(browser, 50);
    const fortWorthPermits = await pullFortWorth(browser, 50);

    // Combine results
    const results = {
      pulled_at: new Date().toISOString(),
      southlake: {
        count: southlakePermits.length,
        permits: southlakePermits
      },
      fort_worth: {
        count: fortWorthPermits.length,
        permits: fortWorthPermits
      },
      total: southlakePermits.length + fortWorthPermits.length
    };

    // Save results
    fs.writeFileSync('raw_permits_50.json', JSON.stringify(results, null, 2));
    console.log('\n==============================================');
    console.log('COMPLETE');
    console.log('==============================================');
    console.log(`Southlake: ${southlakePermits.length} permits`);
    console.log(`Fort Worth: ${fortWorthPermits.length} permits`);
    console.log(`Total: ${results.total} permits`);
    console.log(`\nSaved to: raw_permits_50.json`);

    // Show samples
    console.log('\n--- Sample Southlake permits ---');
    for (const p of southlakePermits.slice(0, 3)) {
      console.log(`  ${p.permit_id} | ${p.type} | ${p.address} | ${p.contractor || '(no contractor)'}`);
    }

    console.log('\n--- Sample Fort Worth permits ---');
    for (const p of fortWorthPermits.slice(0, 3)) {
      console.log(`  ${p.permit_id} | ${p.type} | ${p.address} | ${p.contractor || '(no contractor)'}`);
    }

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
