#!/usr/bin/env node
/**
 * Collect 30 Southlake permits with full contractor details
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

async function callDeepSeek(prompt, maxTokens = 4000) {
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

async function main() {
  console.log('Southlake 30 Permit Collector');
  console.log('=============================\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const allPermits = [];

  try {
    // Load search page
    console.log('Loading Southlake permit search...');
    await page.goto('https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService#/search?m=2&ps=10&pn=1&em=true',
      { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));

    // Click search
    console.log('Clicking search...');
    const searchBtn = await page.$('#button-Search');
    if (searchBtn) await searchBtn.click();
    await new Promise(r => setTimeout(r, 5000));

    // Sort by Finalized Date Descending
    console.log('Sorting by Finalized Date (Descending)...');
    await page.select('#PermitCriteria_SortBy', 'string:FinalDate');
    await new Promise(r => setTimeout(r, 1000));
    await page.select('#SortAscending', 'boolean:false');
    await new Promise(r => setTimeout(r, 4000));

    // Save debug HTML
    fs.writeFileSync('debug_html/collect_page1.html', await page.content());
    console.log('Saved debug HTML');

    // Collect permits from 3 pages (10 per page = 30)
    for (let pageNum = 1; pageNum <= 3; pageNum++) {
      console.log(`\n--- Page ${pageNum} ---`);

      // Get permit links from current page
      const permitLinks = await page.evaluate(() => {
        const links = [];
        const records = document.querySelectorAll('[id^="entityRecordDiv"]');
        records.forEach(rec => {
          const link = rec.querySelector('a[href*="#/permit/"]');
          if (link) {
            // Extract permit ID from the record text
            const text = rec.innerText;
            const permitMatch = text.match(/Permit Number\s*([A-Z0-9-]+)/i);
            const addressMatch = text.match(/Address\s*([^\n]+)/i);
            links.push({
              permit_id: permitMatch ? permitMatch[1].trim() : 'Unknown',
              address: addressMatch ? addressMatch[1].trim() : '',
              detail_link: link.getAttribute('href')
            });
          }
        });
        return links;
      });

      console.log(`Found ${permitLinks.length} permits on page ${pageNum}`);

      // Get details for each permit
      for (const permit of permitLinks) {
        console.log(`  Getting details for ${permit.permit_id}...`);

        const detailUrl = `https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService${permit.detail_link}`;
        await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));

        const detailHtml = cleanHTML(await page.content());

        const detailPrompt = `Extract permit details from this HTML. Return JSON:
{
  "permit_id": "...",
  "address": "...",
  "type": "...",
  "status": "...",
  "applied_date": "...",
  "issued_date": "...",
  "finalized_date": "...",
  "description": "...",
  "valuation": "...",
  "contractor": {
    "company": "...",
    "contact_name": "...",
    "type": "Applicant/Contractor/etc"
  }
}

Look for Contacts table with aria-label attributes like "Company ...", "First Name ...", "Last Name ...".
The contractor is usually Type="Applicant" or "Contractor".

HTML (first 100000 chars):
${detailHtml.substring(0, 100000)}`;

        const response = await callDeepSeek(detailPrompt, 2000);
        const details = extractJSON(response);

        if (details) {
          allPermits.push(details);
          const contractor = details.contractor?.company || 'No contractor';
          console.log(`    ✓ ${details.type} - ${contractor}`);
        } else {
          console.log(`    ✗ Failed to parse`);
          allPermits.push({ permit_id: permit.permit_id, error: 'Failed to parse' });
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 500));
      }

      // Navigate to next page if not last
      if (pageNum < 3) {
        console.log(`\nNavigating to page ${pageNum + 1}...`);
        // Go back to search and navigate to next page
        await page.goto('https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService#/search?m=2&ps=10&pn=1&em=true',
          { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));

        // Click search
        const searchBtn2 = await page.$('#button-Search');
        if (searchBtn2) await searchBtn2.click();
        await new Promise(r => setTimeout(r, 4000));

        // Sort again
        await page.select('#PermitCriteria_SortBy', 'string:FinalDate');
        await new Promise(r => setTimeout(r, 1000));
        await page.select('#SortAscending', 'boolean:false');
        await new Promise(r => setTimeout(r, 3000));

        // Click next page button
        const nextBtn = await page.$('.pagination-next-page');
        if (nextBtn) {
          for (let i = 0; i < pageNum; i++) {
            await nextBtn.click();
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
    }

    // Summary
    console.log('\n\n========== SUMMARY ==========');
    console.log(`Total permits collected: ${allPermits.length}`);

    const withContractor = allPermits.filter(p => p.contractor?.company && p.contractor.company !== '');
    console.log(`With contractor info: ${withContractor.length}`);

    console.log('\nContractors found:');
    withContractor.forEach(p => {
      console.log(`  ${p.permit_id}: ${p.contractor.company} (${p.contractor.contact_name || 'no contact'})`);
    });

    // Save results
    fs.writeFileSync('southlake_30_permits.json', JSON.stringify(allPermits, null, 2));
    console.log('\nSaved to: southlake_30_permits.json');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
