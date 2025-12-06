#!/usr/bin/env node
/**
 * Southlake Permit Puller
 *
 * Pulls recent residential building permits from Southlake EnerGov portal
 * with full details including contractor information.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Call DeepSeek API
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

// Clean HTML
function cleanHTML(html) {
  let cleaned = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
  cleaned = cleaned.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');
  cleaned = cleaned.replace(/\s+/g, ' ');
  return cleaned;
}

// Extract JSON from response
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
  console.log('Southlake Permit Puller');
  console.log('=======================\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  try {
    // Step 1: Go to search page
    console.log('Step 1: Loading Southlake permit search...');

    const searchUrl = 'https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService#/search?m=2&ps=10&pn=1&em=true';

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for Angular to load
    console.log('Step 2: Waiting for page to fully load...');
    await new Promise(r => setTimeout(r, 5000));

    // Type a search for recent permits (use "2024" or "pool" to find recent activity)
    console.log('Step 3: Searching for "pool" permits...');
    try {
      await page.type('#SearchKeyword', 'pool');
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.log('  Keyword search skipped:', e.message);
    }

    // Click search button to get initial results
    console.log('Step 4: Clicking search button...');
    const searchBtn = await page.$('#button-Search');
    if (searchBtn) {
      await searchBtn.click();
      await new Promise(r => setTimeout(r, 5000));
    }

    // Step 4b: Sort by Finalized Date Descending to get most recent permits
    console.log('Step 4b: Sorting by Finalized Date (Descending)...');
    try {
      // Set sort field to Finalized Date
      await page.select('#PermitCriteria_SortBy', 'string:FinalDate');
      await new Promise(r => setTimeout(r, 1000));

      // Set sort direction to Descending
      await page.select('#SortAscending', 'boolean:false');
      await new Promise(r => setTimeout(r, 4000));

      console.log('  Sort applied successfully');
    } catch (e) {
      console.log(`  Sort failed: ${e.message}`);
    }

    // Get the HTML with results
    const html = await page.content();
    const cleanedHtml = cleanHTML(html);

    console.log(`Step 5: Got ${html.length} bytes, analyzing with DeepSeek...`);

    // Save debug HTML
    fs.writeFileSync('debug_html/southlake_recent.html', html);

    // Ask DeepSeek to extract permits
    const extractPrompt = `You are extracting permit data from a Southlake, TX EnerGov portal.

TASK: Extract ALL permit records visible on this page. For each permit, extract:
- permit_id: The permit number (e.g., "BLD-24-0123")
- address: Full street address
- type: Permit type (e.g., "Building Residential", "Pool", "Electrical")
- applied_date: When applied
- issued_date: When issued
- status: Current status
- description: Project description
- detail_link: The href/link to the permit detail page (look for links with GUID like #/permit/ABC123-DEF456)

IMPORTANT: Look for recent permits (2024, 2025 dates). Focus on RESIDENTIAL building permits, pool permits, remodel permits.

Return JSON:
{
  "total_results": <number shown on page>,
  "permits": [
    {
      "permit_id": "...",
      "address": "...",
      "type": "...",
      "applied_date": "...",
      "issued_date": "...",
      "status": "...",
      "description": "...",
      "detail_link": "..."
    }
  ],
  "sort_order": "what order are results in?",
  "notes": "any observations"
}

HTML (first 150000 chars):
${cleanedHtml.substring(0, 150000)}`;

    const response = await callDeepSeek(extractPrompt);
    const data = extractJSON(response);

    if (data && data.permits && data.permits.length > 0) {
      console.log(`\nFound ${data.permits.length} permits (${data.total_results} total)`);
      console.log(`Sort order: ${data.sort_order}`);
      console.log(`Notes: ${data.notes}\n`);

      // Show first 5 permits
      console.log('Recent permits:');
      console.log('================');
      for (const permit of data.permits.slice(0, 10)) {
        console.log(`\n${permit.permit_id}`);
        console.log(`  Address: ${permit.address}`);
        console.log(`  Type: ${permit.type}`);
        console.log(`  Applied: ${permit.applied_date}`);
        console.log(`  Issued: ${permit.issued_date}`);
        console.log(`  Status: ${permit.status}`);
        console.log(`  Description: ${permit.description?.substring(0, 80)}...`);
        if (permit.detail_link) {
          console.log(`  Detail Link: ${permit.detail_link}`);
        }
      }

      // Step 6: Click into first permit to get contractor details
      if (data.permits[0]?.detail_link) {
        console.log('\n\nStep 6: Getting full details for first permit...');

        const detailUrl = data.permits[0].detail_link.startsWith('http')
          ? data.permits[0].detail_link
          : `https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService${data.permits[0].detail_link}`;

        console.log(`  Navigating to: ${detailUrl}`);

        await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 4000));

        const detailHtml = cleanHTML(await page.content());
        fs.writeFileSync('debug_html/southlake_permit_detail.html', await page.content());

        const detailPrompt = `Extract ALL details from this permit detail page:

Look for:
- Permit number
- Full address
- Permit type
- Status
- Applied/Issued/Expires dates
- Valuation/cost
- Description

CRITICAL - CONTACTS TABLE:
The page has a Contacts table with columns: Type, Company, First Name, Last Name, Title, Confirmation, Billing.
Look for aria-label attributes like:
- aria-label="Type Applicant"
- aria-label="Company Mosaic Building Co."
- aria-label="First Name Michael"
- aria-label="Last Name Fermier"

Extract EVERY contact row from this table. The contractor/builder is usually "Applicant" type.

Also look for:
- Inspections scheduled/completed
- Any fees or payments

Return JSON:
{
  "permit_id": "...",
  "address": "...",
  "type": "...",
  "status": "...",
  "dates": {
    "applied": "...",
    "issued": "...",
    "expires": "...",
    "finalized": "..."
  },
  "valuation": "...",
  "description": "...",
  "contacts": [
    {
      "type": "Applicant/Contractor/Owner",
      "company_name": "...",
      "first_name": "...",
      "last_name": "...",
      "title": "..."
    }
  ],
  "inspections": [...],
  "fees": [...],
  "raw_fields": {}
}

HTML:
${detailHtml.substring(0, 120000)}`;

        const detailResponse = await callDeepSeek(detailPrompt);
        const detailData = extractJSON(detailResponse);

        if (detailData) {
          console.log('\n=== FULL PERMIT DETAILS ===');
          console.log(JSON.stringify(detailData, null, 2));

          // Save the full permit data
          fs.writeFileSync('southlake_permit_sample.json', JSON.stringify(detailData, null, 2));
          console.log('\nSaved full permit to: southlake_permit_sample.json');
        }
      }

      // Save all permits
      fs.writeFileSync('southlake_permits.json', JSON.stringify(data, null, 2));
      console.log('\nSaved all permits to: southlake_permits.json');

    } else {
      console.log('No permits found or failed to parse response');
      console.log('Raw response:', response?.substring(0, 500));
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
