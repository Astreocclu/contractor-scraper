#!/usr/bin/env node
/**
 * Multi-City Permit Scraper Test
 * Tries each city for max 10 minutes or 10 iterations
 * Logs results and moves on
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const MAX_TIME_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ITERATIONS = 10;

// Cities by population (excluding Southlake/Fort Worth which already work)
// URLs updated Dec 6, 2025 from dfw-contractor-audit-v3-corrected.md
const CITIES = [
  {
    name: 'Dallas',
    population: 1300000,
    urls: [
      'https://aca-prod.accela.com/DALLASTX/Cap/CapHome.aspx?module=Building&TabName=Home'
    ],
    portalType: 'Accela'
  },
  {
    name: 'Arlington',
    population: 400000,
    urls: [
      'https://ap.arlingtontx.gov/AP/sfjsp?interviewID=PublicSearch'
    ],
    portalType: 'AMANDA'
  },
  {
    name: 'Plano',
    population: 290000,
    urls: [
      'https://trakit.plano.gov/etrakit_prod/Search/permit.aspx'
    ],
    portalType: 'eTRAKiT'
  },
  {
    name: 'Garland',
    population: 240000,
    urls: [
      'https://www.garlandtx.gov/35/Business-Development'
    ],
    portalType: 'CSS'
  },
  {
    name: 'Irving',
    population: 240000,
    urls: [
      'https://www.mgoconnect.org/cp?JID=320'
    ],
    portalType: 'MGO'
  },
  {
    name: 'Frisco',
    population: 220000,
    urls: [
      'https://etrakit.friscotexas.gov'
    ],
    portalType: 'eTRAKiT'
  },
  {
    name: 'McKinney',
    population: 200000,
    urls: [
      'https://egov.mckinneytexas.org/EnerGov_Prod/SelfService#/search?m=2'
    ],
    portalType: 'EnerGov'
  },
  {
    name: 'Grand_Prairie',
    population: 195000,
    urls: [
      'https://aca-prod.accela.com/GPTX/Default.aspx'
    ],
    portalType: 'Accela'
  },
  {
    name: 'Denton',
    population: 150000,
    urls: [
      'https://www.mgoconnect.org/cp?JID=285'
    ],
    portalType: 'MGO'
  },
  {
    name: 'Carrollton',
    population: 140000,
    urls: [
      'https://cityserve.cityofcarrollton.com/CityViewPortal'
    ],
    portalType: 'CSS'
  },
  {
    name: 'Lewisville',
    population: 115000,
    urls: [
      'https://www.mgoconnect.org/cp?JID=325'
    ],
    portalType: 'MGO'
  },
  {
    name: 'Richardson',
    population: 120000,
    urls: [
      'https://aca-prod.accela.com/COR/Default.aspx'
    ],
    portalType: 'Accela'
  }
];

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

async function testCity(browser, city) {
  const startTime = Date.now();
  const result = {
    name: city.name,
    population: city.population,
    portalType: city.portalType,
    startTime: new Date().toISOString(),
    urls_tried: [],
    permits: [],
    status: 'pending',
    error: null,
    iterations: 0,
    timeSpent: 0
  };

  console.log(`\n${'='.repeat(50)}`);
  console.log(`${city.name.toUpperCase()} (pop: ${city.population.toLocaleString()})`);
  console.log(`${'='.repeat(50)}`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  try {
    for (const url of city.urls) {
      if (Date.now() - startTime > MAX_TIME_MS) {
        console.log(`  TIME LIMIT reached after ${Math.round((Date.now() - startTime) / 1000)}s`);
        result.status = 'timeout';
        break;
      }

      if (result.iterations >= MAX_ITERATIONS) {
        console.log(`  ITERATION LIMIT reached`);
        result.status = 'max_iterations';
        break;
      }

      result.iterations++;
      result.urls_tried.push(url);
      console.log(`\n  [${result.iterations}] Trying: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForTimeout(3000);

        const html = cleanHTML(await page.content());

        // Save debug HTML
        const safeName = city.name.toLowerCase().replace(/[^a-z]/g, '_');
        fs.writeFileSync(`debug_html/${safeName}_${result.iterations}.html`, await page.content());

        // Ask DeepSeek to analyze the page
        const analyzePrompt = `Analyze this permit portal page for ${city.name}, TX.

1. What type of page is this? (search_form, results_list, info_page, login_required, error)
2. Are there any permit records visible? If yes, extract them.
3. What's the next step to get permit data?
4. Any useful links or buttons to click?

For any permits found, extract:
- permit_id, address, type, date, status, contractor, description

Return JSON:
{
  "page_type": "...",
  "permits_found": true/false,
  "permits": [...],
  "next_action": "click_search|fill_form|click_link|navigate_to|login_required|none",
  "next_target": "selector or URL",
  "useful_links": [...],
  "notes": "..."
}

HTML (truncated):
${html.substring(0, 80000)}`;

        const response = await callDeepSeek(analyzePrompt);
        const analysis = parseJSON(response);

        if (analysis) {
          console.log(`    Page type: ${analysis.page_type}`);
          console.log(`    Permits found: ${analysis.permits_found}`);
          console.log(`    Next action: ${analysis.next_action} -> ${analysis.next_target || 'n/a'}`);

          if (analysis.permits && analysis.permits.length > 0) {
            result.permits.push(...analysis.permits);
            console.log(`    EXTRACTED ${analysis.permits.length} permits!`);
          }

          // Try next action if we have time
          if (analysis.next_action === 'click_search' && analysis.next_target) {
            try {
              await page.click(analysis.next_target);
              await page.waitForTimeout(5000);
              result.iterations++;

              const newHtml = cleanHTML(await page.content());
              const extractPrompt = `Extract ALL permit records from this page. Return JSON: {"permits": [{permit_id, address, type, date, status, contractor, description}]}

HTML: ${newHtml.substring(0, 80000)}`;

              const extractResponse = await callDeepSeek(extractPrompt);
              const extractData = parseJSON(extractResponse);

              if (extractData?.permits?.length) {
                result.permits.push(...extractData.permits);
                console.log(`    After click: extracted ${extractData.permits.length} more permits`);
              }
            } catch (e) {
              console.log(`    Click failed: ${e.message}`);
            }
          }

          if (analysis.next_action === 'navigate_to' && analysis.next_target) {
            // Add to URLs to try - fix relative URLs
            let nextUrl = analysis.next_target;
            if (nextUrl.startsWith('/')) {
              // Convert relative URL to absolute using current page's origin
              const currentUrl = new URL(url);
              nextUrl = `${currentUrl.origin}${nextUrl}`;
            }
            // Only add if it's a valid URL
            if (nextUrl.startsWith('http') && !city.urls.includes(nextUrl)) {
              city.urls.push(nextUrl);
              console.log(`    Added new URL to try: ${nextUrl}`);
            }
          }
        }

        if (result.permits.length > 0) {
          result.status = 'success';
          break;
        }

      } catch (e) {
        console.log(`    ERROR: ${e.message}`);
        result.error = e.message;
      }
    }

    if (result.permits.length === 0 && result.status === 'pending') {
      result.status = 'no_permits_found';
    }

  } finally {
    await page.close();
  }

  result.timeSpent = Math.round((Date.now() - startTime) / 1000);
  result.endTime = new Date().toISOString();

  console.log(`\n  RESULT: ${result.status} | ${result.permits.length} permits | ${result.timeSpent}s`);

  return result;
}

async function main() {
  console.log('='.repeat(60));
  console.log('MULTI-CITY PERMIT SCRAPER TEST');
  console.log('Max 10 minutes or 10 iterations per city');
  console.log('='.repeat(60));
  console.log(`Started: ${new Date().toISOString()}\n`);

  if (!DEEPSEEK_API_KEY) {
    console.error('ERROR: DEEPSEEK_API_KEY not set');
    process.exit(1);
  }

  if (!fs.existsSync('debug_html')) {
    fs.mkdirSync('debug_html');
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const results = [];

  try {
    for (const city of CITIES) {
      const result = await testCity(browser, city);
      results.push(result);

      // Save intermediate results
      fs.writeFileSync('multi_city_results.json', JSON.stringify(results, null, 2));
    }

  } finally {
    await browser.close();
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(60));

  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status !== 'success');

  console.log(`\nSuccessful: ${successful.length}/${results.length}`);
  for (const r of successful) {
    console.log(`  ${r.name}: ${r.permits.length} permits`);
  }

  console.log(`\nFailed: ${failed.length}/${results.length}`);
  for (const r of failed) {
    console.log(`  ${r.name}: ${r.status} (${r.error || 'no error'})`);
  }

  // Save final results
  fs.writeFileSync('multi_city_results.json', JSON.stringify(results, null, 2));
  console.log('\nResults saved to: multi_city_results.json');
}

main().catch(console.error);
