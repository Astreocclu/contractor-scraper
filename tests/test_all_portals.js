#!/usr/bin/env node
/**
 * DFW Permit Portal Tester
 *
 * Tests all 30 DFW city permit portals using Puppeteer + DeepSeek.
 * The goal: grab at least one permit from each city.
 *
 * Usage:
 *   node test_all_portals.js
 *   node test_all_portals.js --city dallas
 *   node test_all_portals.js --skip-tested
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// DeepSeek config
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

// All 30 DFW cities with their portal info
const CITIES = [
  // Tier 1: Major Cities
  { name: 'Dallas', slug: 'dallas', population: 1300000, portalType: 'DallasNow',
    url: 'https://developmentservices.dallascityhall.com/dsweb/',
    searchUrl: 'https://developmentservices.dallascityhall.com/dsweb/Search/Index' },

  { name: 'Fort Worth', slug: 'fort_worth', population: 900000, portalType: 'Accela',
    url: 'https://aca-prod.accela.com/CFW/Default.aspx',
    searchUrl: 'https://aca-prod.accela.com/CFW/Cap/CapHome.aspx?module=Development&TabName=Development' },

  { name: 'Arlington', slug: 'arlington', population: 400000, portalType: 'ServiceFlow',
    url: 'https://ap.arlingtontx.gov/AP/sfjsp?interviewID=PublicSearchV2' },

  // Tier 2: Large Suburbs
  { name: 'Plano', slug: 'plano', population: 280000, portalType: 'eTRAKiT',
    url: 'https://trakit.plano.gov/etrakit_prod/Search/permit.aspx' },

  { name: 'Garland', slug: 'garland', population: 240000, portalType: 'CSS',
    url: 'https://www.garlandtx.gov/2892/Building-Permits',
    searchUrl: 'https://www.garlandtx.gov/2892/Building-Permits' },

  { name: 'Frisco', slug: 'frisco', population: 220000, portalType: 'eTRAKiT',
    url: 'https://etrakit.friscotexas.gov/etrakit3/',
    searchUrl: 'https://etrakit.friscotexas.gov/etrakit3/Search/permit.aspx' },

  { name: 'Irving', slug: 'irving', population: 220000, portalType: 'CSS',
    url: 'https://www.mygovernmentonline.org/tx/irving',
    searchUrl: 'https://www.mygovernmentonline.org/tx/irving' },

  { name: 'McKinney', slug: 'mckinney', population: 180000, portalType: 'ROWay',
    url: 'https://mckinney.tx.roway.net/Permits',
    searchUrl: 'https://mckinney.tx.roway.net/Permits/Search' },

  { name: 'Grand Prairie', slug: 'grand_prairie', population: 180000, portalType: 'Accela',
    url: 'https://aca-prod.accela.com/GRANDPRAIRIE/Default.aspx',
    searchUrl: 'https://aca-prod.accela.com/GRANDPRAIRIE/Cap/CapHome.aspx?module=Building' },

  { name: 'Carrollton', slug: 'carrollton', population: 145000, portalType: 'CSS',
    url: 'https://www.cityofcarrollton.com/departments/departments-a-f/building-inspections/permit-information' },

  { name: 'Denton', slug: 'denton', population: 140000, portalType: 'EnerGov',
    url: 'https://aca.cityofdenton.com/CitizenAccess/',
    searchUrl: 'https://aca.cityofdenton.com/CitizenAccess/Cap/CapHome.aspx?module=Building' },

  { name: 'Mesquite', slug: 'mesquite', population: 140000, portalType: 'CSS',
    url: 'https://mesquite.onlinegovt.com/case_status/',
    searchUrl: 'https://mesquite.onlinegovt.com/case_status/' },

  // Tier 3: Mid-Size Cities
  { name: 'Lewisville', slug: 'lewisville', population: 115000, portalType: 'EnerGov',
    url: 'https://selfservice.lewisvilletx.gov/energov_prod/selfservice#/home',
    searchUrl: 'https://selfservice.lewisvilletx.gov/energov_prod/selfservice#/search' },

  { name: 'Richardson', slug: 'richardson', population: 115000, portalType: 'CSS',
    url: 'https://www.cor.net/departments/development-services/building-inspection/permits-and-inspections' },

  { name: 'Allen', slug: 'allen', population: 105000, portalType: 'EnerGov',
    url: 'https://energov.cityofallen.org/EnerGov_Prod/SelfService#/home',
    searchUrl: 'https://energov.cityofallen.org/EnerGov_Prod/SelfService#/search' },

  { name: 'Rowlett', slug: 'rowlett', population: 75000, portalType: 'EnerGov',
    url: 'https://energov.rowlett.com/EnerGov_Prod/SelfService#/home' },

  { name: 'DeSoto', slug: 'desoto', population: 55000, portalType: 'Unknown',
    url: 'https://www.desototexas.gov/490/Building-Permits' },

  { name: 'Grapevine', slug: 'grapevine', population: 55000, portalType: 'MyGov',
    url: 'https://public.mygov.us/tx_grapevine',
    searchUrl: 'https://public.mygov.us/tx_grapevine/permit/search' },

  // Tier 4: Smaller Municipalities
  { name: 'Duncanville', slug: 'duncanville', population: 40000, portalType: 'Unknown',
    url: 'https://www.duncanville.com/departments/building_permits.php' },

  { name: 'Southlake', slug: 'southlake', population: 38000, portalType: 'EnerGov',
    url: 'https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService#/home',
    searchUrl: 'https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService#/search?m=2&ps=10&pn=1&em=true' },

  { name: 'Farmers Branch', slug: 'farmers_branch', population: 35000, portalType: 'EnerGov',
    url: 'https://egselfservice.farmersbranchtx.gov/EnerGov_Prod/SelfService#/home',
    searchUrl: 'https://egselfservice.farmersbranchtx.gov/EnerGov_Prod/SelfService#/search' },

  { name: 'Lancaster', slug: 'lancaster', population: 35000, portalType: 'MyGov',
    url: 'https://public.mygov.us/tx_lancaster',
    searchUrl: 'https://public.mygov.us/tx_lancaster/permit/search' },

  { name: 'Balch Springs', slug: 'balch_springs', population: 25000, portalType: 'Unknown',
    url: 'https://www.cityofbalchsprings.com/departments/building-inspections/' },

  { name: 'Colleyville', slug: 'colleyville', population: 25000, portalType: 'EnerGov',
    url: 'https://energov.colleyville.com/EnerGov_Prod/SelfService#/home',
    searchUrl: 'https://energov.colleyville.com/EnerGov_Prod/SelfService#/search' },

  { name: 'Sachse', slug: 'sachse', population: 25000, portalType: 'Unknown',
    url: 'https://www.cityofsachse.com/284/Building-Permits' },

  { name: 'Watauga', slug: 'watauga', population: 23000, portalType: 'Unknown',
    url: 'https://www.wataugatx.org/329/Building-Permits' },

  { name: 'Keller', slug: 'keller', population: 18000, portalType: 'EnerGov',
    url: 'https://energov.cityofkeller.com/EnerGov_Prod/SelfService#/home',
    searchUrl: 'https://energov.cityofkeller.com/EnerGov_Prod/SelfService#/search' },

  { name: 'Cedar Hill', slug: 'cedar_hill', population: 13000, portalType: 'MyGov',
    url: 'https://public.mygov.us/cedarhill_tx',
    searchUrl: 'https://public.mygov.us/cedarhill_tx/permit/search' },

  { name: 'Princeton', slug: 'princeton', population: 5000, portalType: 'EnerGov',
    url: 'https://energov.princetontx.gov/EnerGov_Prod/SelfService#/home',
    searchUrl: 'https://energov.princetontx.gov/EnerGov_Prod/SelfService#/search' },

  { name: 'North Richland Hills', slug: 'nrh', population: 70000, portalType: 'eTRAKiT',
    url: 'https://etrakit.nrhtx.com/etrakit3/',
    searchUrl: 'https://etrakit.nrhtx.com/etrakit3/Search/permit.aspx' },
];

// Results storage
const RESULTS_FILE = path.join(__dirname, 'portal_test_results.json');
let results = {};

// Load existing results if any
function loadResults() {
  try {
    if (fs.existsSync(RESULTS_FILE)) {
      results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
      console.log(`Loaded ${Object.keys(results).length} previous results`);
    }
  } catch (e) {
    results = {};
  }
}

// Save results
function saveResults() {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

// Call DeepSeek API
async function callDeepSeek(prompt, systemPrompt = null, maxTokens = 4000) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY not set');
  }

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: 0.1,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Extract JSON from response
function extractJSON(text) {
  try {
    // Try direct parse
    return JSON.parse(text);
  } catch (e) {
    // Try to find JSON in markdown blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch (e2) {}
    }
    // Try to find raw JSON object
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch (e3) {}
    }
    return null;
  }
}

// Clean HTML - remove CSS, scripts, and keep only content
function cleanHTML(html) {
  // Remove <style> tags and their content
  let cleaned = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove inline styles that are just CSS definitions
  cleaned = cleaned.replace(/style="[^"]*"/gi, '');

  // Remove <script> tags
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Remove comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

  // Remove SVG elements (often huge)
  cleaned = cleaned.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');

  // Collapse multiple whitespace/newlines
  cleaned = cleaned.replace(/\s+/g, ' ');

  // Remove empty tags
  cleaned = cleaned.replace(/<[^>]+>\s*<\/[^>]+>/g, '');

  return cleaned;
}

// Learning context - accumulates successful patterns
let learningContext = {
  successfulPatterns: [],
  failedPatterns: [],
  portalTypeStrategies: {}
};

const LEARNING_FILE = path.join(__dirname, 'portal_learning.json');

function loadLearning() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      learningContext = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      console.log(`Loaded learning context: ${learningContext.successfulPatterns.length} successful patterns`);
    }
  } catch (e) {
    learningContext = { successfulPatterns: [], failedPatterns: [], portalTypeStrategies: {} };
  }
}

function saveLearning() {
  fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningContext, null, 2));
}

// Build prompt with learning context
function buildExtractionPrompt(city, html, previousAttempts = []) {
  let contextSection = '';

  // Add successful patterns for this portal type
  const typePatterns = learningContext.portalTypeStrategies[city.portalType];
  if (typePatterns && typePatterns.successfulApproach) {
    contextSection += `\n\nPREVIOUS SUCCESS FOR ${city.portalType} PORTALS:\n${typePatterns.successfulApproach}\n`;
  }

  // Add failed attempts for this city
  if (previousAttempts.length > 0) {
    contextSection += `\n\nPREVIOUS FAILED ATTEMPTS FOR ${city.name}:\n`;
    previousAttempts.forEach((attempt, i) => {
      contextSection += `Attempt ${i+1}: ${attempt.error}\n`;
    });
    contextSection += `\nTry a DIFFERENT approach this time.\n`;
  }

  return `You are analyzing a city permit portal to extract building permit data.

CITY: ${city.name}, TX
PORTAL TYPE: ${city.portalType}
URL: ${city.url}
${contextSection}

TASK: Extract ANY permit records you can find on this page. Look for:
1. Permit numbers/IDs
2. Addresses
3. Permit types (building, pool, electrical, etc.)
4. Dates (issued, applied, expires)
5. Contractor/applicant names
6. Status (approved, pending, etc.)
7. Descriptions

Also identify:
- Is this a search page that needs input?
- Is there a results table visible?
- What selectors/patterns could be used to navigate?
- What links lead to permit search or recent permits?

RESPOND WITH JSON:
{
  "page_type": "search_form" | "results_list" | "info_page" | "login_required" | "error",
  "permits_found": [
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
  "navigation_hints": {
    "search_form_selector": "...",
    "results_table_selector": "...",
    "next_steps": "..."
  },
  "useful_links": ["..."],
  "extraction_confidence": 0-100,
  "notes": "..."
}

HTML CONTENT (cleaned, truncated to 120000 chars):
${cleanHTML(html).substring(0, 120000)}`;
}

// Portal-specific interaction strategies
async function interactWithPortal(page, city) {
  const strategies = {
    'EnerGov': async () => {
      // EnerGov: Wait for Angular, then click Search button
      console.log('  Waiting for EnerGov app to load...');
      await new Promise(r => setTimeout(r, 4000));

      // Try clicking the search button
      try {
        const searchBtn = await page.$('#button-Search');
        if (searchBtn) {
          console.log('  Clicking Search button...');
          await searchBtn.click();
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (e) {
        console.log('  Could not click search button:', e.message);
      }
    },

    'eTRAKiT': async () => {
      // eTRAKiT: Look for search form and submit
      console.log('  Waiting for eTRAKiT to load...');
      await new Promise(r => setTimeout(r, 3000));

      try {
        // Try to find and click search
        const searchBtn = await page.$('input[type="submit"][value*="Search"]');
        if (searchBtn) {
          console.log('  Clicking Search...');
          await searchBtn.click();
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (e) {
        console.log('  eTRAKiT interaction error:', e.message);
      }
    },

    'Accela': async () => {
      // Accela: Wait for page load then click search
      console.log('  Waiting for Accela portal...');
      await new Promise(r => setTimeout(r, 4000));

      // Try clicking the search button
      try {
        const searchBtn = await page.$('#ctl00_PlaceHolderMain_btnNewSearch');
        if (searchBtn) {
          console.log('  Clicking Accela Search button...');
          await searchBtn.click();
          await new Promise(r => setTimeout(r, 5000));
        }
      } catch (e) {
        console.log('  Accela search click error:', e.message);
      }
    },

    'MyGov': async () => {
      // MyGov: Navigate to permit search
      console.log('  Waiting for MyGov...');
      await new Promise(r => setTimeout(r, 3000));
    },

    'default': async () => {
      // Default: just wait for page load
      await new Promise(r => setTimeout(r, 3000));
    }
  };

  const strategy = strategies[city.portalType] || strategies['default'];
  await strategy();
}

// Test a single city portal
async function testCity(browser, city, attempt = 1) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${city.name} (${city.portalType}) - Attempt ${attempt}`);
  console.log(`URL: ${city.searchUrl || city.url}`);
  console.log('='.repeat(60));

  const page = await browser.newPage();

  // Set longer timeout and better viewport
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1280, height: 800 });

  // Set a realistic user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const result = {
    city: city.name,
    slug: city.slug,
    portalType: city.portalType,
    url: city.searchUrl || city.url,
    timestamp: new Date().toISOString(),
    attempt,
    success: false,
    permits: [],
    error: null,
    pageType: null,
    navigationHints: null,
    notes: null
  };

  try {
    // Navigate to the portal
    console.log('  Loading page...');
    const targetUrl = city.searchUrl || city.url;

    // Use longer timeout for slow portals
    const pageTimeout = city.slug === 'keller' ? 90000 : 60000;
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: pageTimeout
    });

    // Apply portal-specific interaction strategy
    await interactWithPortal(page, city);

    // Get the page HTML
    const html = await page.content();
    console.log(`  Got ${html.length} bytes of HTML`);

    // Save HTML for debugging
    const debugDir = path.join(__dirname, 'debug_html');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);
    fs.writeFileSync(
      path.join(debugDir, `${city.slug}_attempt${attempt}.html`),
      html
    );

    // Get previous attempts for this city
    const previousAttempts = results[city.slug]?.attempts || [];

    // Send to DeepSeek for analysis
    console.log('  Sending to DeepSeek for analysis...');
    const prompt = buildExtractionPrompt(city, html, previousAttempts);

    const response = await callDeepSeek(prompt);
    console.log('  Got DeepSeek response');

    // Parse the response
    const parsed = extractJSON(response);

    if (parsed) {
      result.pageType = parsed.page_type;
      result.permits = parsed.permits_found || [];
      result.navigationHints = parsed.navigation_hints;
      result.notes = parsed.notes;
      result.confidence = parsed.extraction_confidence;
      result.usefulLinks = parsed.useful_links;

      if (result.permits.length > 0) {
        result.success = true;
        console.log(`  SUCCESS! Found ${result.permits.length} permits`);

        // Log first permit as sample
        console.log(`  Sample permit:`, JSON.stringify(result.permits[0], null, 2));

        // Update learning context
        learningContext.successfulPatterns.push({
          city: city.name,
          portalType: city.portalType,
          pageType: result.pageType,
          approach: result.notes
        });

        if (!learningContext.portalTypeStrategies[city.portalType]) {
          learningContext.portalTypeStrategies[city.portalType] = {};
        }
        learningContext.portalTypeStrategies[city.portalType].successfulApproach =
          `Page type: ${result.pageType}. ${result.notes}`;

        saveLearning();
      } else {
        console.log(`  No permits found. Page type: ${result.pageType}`);
        console.log(`  Notes: ${result.notes}`);

        // Check if we need to navigate somewhere
        if (result.navigationHints?.next_steps) {
          console.log(`  Next steps: ${result.navigationHints.next_steps}`);
        }
        if (result.usefulLinks?.length > 0) {
          console.log(`  Useful links: ${result.usefulLinks.join(', ')}`);
        }
      }
    } else {
      result.error = 'Failed to parse DeepSeek response';
      result.rawResponse = response.substring(0, 500);
      console.log('  Failed to parse response');
    }

  } catch (error) {
    result.error = error.message;
    console.log(`  ERROR: ${error.message}`);

    // Track failed patterns
    learningContext.failedPatterns.push({
      city: city.name,
      portalType: city.portalType,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    await page.close();
  }

  // Store result
  if (!results[city.slug]) {
    results[city.slug] = { attempts: [] };
  }
  results[city.slug].attempts.push(result);
  results[city.slug].latestSuccess = result.success;
  results[city.slug].latestPermitCount = result.permits.length;

  saveResults();

  return result;
}

// Try to navigate and extract permits with multiple strategies
async function testCityWithStrategies(browser, city) {
  // First attempt: direct URL
  let result = await testCity(browser, city, 1);

  if (result.success) return result;

  // Second attempt: if we got navigation hints, try following them
  if (result.navigationHints?.next_steps && result.usefulLinks?.length > 0) {
    console.log(`\n  Trying navigation strategy...`);

    // Update city URL with first useful link
    const newCity = { ...city };
    const usefulLink = result.usefulLinks[0];

    // Handle relative URLs
    if (usefulLink.startsWith('/')) {
      const baseUrl = new URL(city.url);
      newCity.url = `${baseUrl.origin}${usefulLink}`;
    } else if (usefulLink.startsWith('http')) {
      newCity.url = usefulLink;
    }

    if (newCity.url !== city.url) {
      result = await testCity(browser, newCity, 2);
      if (result.success) return result;
    }
  }

  // Third attempt: try common search patterns for the portal type
  if (city.portalType === 'EnerGov' && !city.searchUrl?.includes('search')) {
    console.log(`\n  Trying EnerGov search pattern...`);
    const newCity = { ...city };
    newCity.url = city.url.replace('#/home', '#/search?m=2&ps=10&pn=1&em=true');
    result = await testCity(browser, newCity, 3);
  }

  return result;
}

// Main execution
async function main() {
  console.log('DFW Permit Portal Tester');
  console.log('========================\n');

  // Check for API key
  if (!DEEPSEEK_API_KEY) {
    console.error('ERROR: DEEPSEEK_API_KEY environment variable not set');
    console.log('Run: export DEEPSEEK_API_KEY=your-key-here');
    process.exit(1);
  }

  // Parse args
  const args = process.argv.slice(2);
  const singleCity = args.find(a => a.startsWith('--city='))?.split('=')[1];
  const skipTested = args.includes('--skip-tested');

  // Load previous state
  loadResults();
  loadLearning();

  // Launch browser
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // Filter cities
    let citiesToTest = CITIES;

    if (singleCity) {
      citiesToTest = CITIES.filter(c =>
        c.slug === singleCity ||
        c.name.toLowerCase() === singleCity.toLowerCase()
      );
      if (citiesToTest.length === 0) {
        console.error(`City not found: ${singleCity}`);
        console.log('Available cities:', CITIES.map(c => c.slug).join(', '));
        process.exit(1);
      }
    }

    if (skipTested) {
      citiesToTest = citiesToTest.filter(c => !results[c.slug]?.latestSuccess);
      console.log(`Skipping ${CITIES.length - citiesToTest.length} already-tested cities`);
    }

    console.log(`\nTesting ${citiesToTest.length} cities...\n`);

    // Test each city
    const summary = {
      total: citiesToTest.length,
      success: 0,
      failed: 0,
      permitsFound: 0,
      byPortalType: {}
    };

    for (const city of citiesToTest) {
      const result = await testCityWithStrategies(browser, city);

      if (result.success) {
        summary.success++;
        summary.permitsFound += result.permits.length;
      } else {
        summary.failed++;
      }

      // Track by portal type
      if (!summary.byPortalType[city.portalType]) {
        summary.byPortalType[city.portalType] = { success: 0, failed: 0, total: 0 };
      }
      summary.byPortalType[city.portalType].total++;
      if (result.success) {
        summary.byPortalType[city.portalType].success++;
      } else {
        summary.byPortalType[city.portalType].failed++;
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 2000));
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total cities tested: ${summary.total}`);
    console.log(`Successful: ${summary.success} (${Math.round(summary.success/summary.total*100)}%)`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Total permits found: ${summary.permitsFound}`);

    console.log('\nBy Portal Type:');
    for (const [type, stats] of Object.entries(summary.byPortalType)) {
      console.log(`  ${type}: ${stats.success}/${stats.total} successful`);
    }

    console.log('\nSuccessful cities:');
    for (const city of citiesToTest) {
      if (results[city.slug]?.latestSuccess) {
        console.log(`  ✓ ${city.name} (${results[city.slug].latestPermitCount} permits)`);
      }
    }

    console.log('\nFailed cities:');
    for (const city of citiesToTest) {
      if (!results[city.slug]?.latestSuccess) {
        const lastAttempt = results[city.slug]?.attempts?.slice(-1)[0];
        console.log(`  ✗ ${city.name}: ${lastAttempt?.pageType || lastAttempt?.error || 'unknown'}`);
      }
    }

    // Save final learning context
    saveLearning();
    console.log(`\nResults saved to: ${RESULTS_FILE}`);
    console.log(`Learning saved to: ${LEARNING_FILE}`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
