#!/usr/bin/env node
/**
 * MGO Connect - Check city websites for their actual permit portal links
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

async function recon() {
  console.log('='.repeat(50));
  console.log('CHECKING CITY WEBSITES FOR MGO PORTAL LINKS');
  console.log('='.repeat(50));

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  // Check Irving's official permit page
  const citiesToCheck = [
    {
      name: 'Irving',
      permitPage: 'https://www.cityofirving.org/3146/Online-Permitting-Portal',
    },
    {
      name: 'Lewisville',
      permitPage: 'https://www.cityoflewisville.com/departments/inspections/online-permitting',
    },
    {
      name: 'Denton',
      permitPage: 'https://www.cityofdenton.com/en-us/residents/permits-development',
    }
  ];

  for (const city of citiesToCheck) {
    console.log(`\n[${city.name}] Checking: ${city.permitPage}`);
    try {
      await page.goto(city.permitPage, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForTimeout(3000);

      console.log(`    Current URL: ${page.url()}`);

      // Look for MGO links or permit portal links
      const links = await page.evaluate(() => {
        return [...document.querySelectorAll('a')].filter(a => {
          const href = a.href?.toLowerCase() || '';
          const text = a.textContent?.toLowerCase() || '';
          return href.includes('mgo') || href.includes('permit') || href.includes('mygovernment') ||
                 text.includes('permit') || text.includes('online') || text.includes('search');
        }).map(a => ({
          text: a.textContent?.trim().substring(0, 60),
          href: a.href
        })).slice(0, 15);
      });

      console.log('    Permit-related links:');
      links.forEach(l => console.log(`      - "${l.text}" -> ${l.href}`));

      // Save page
      const safeName = city.name.toLowerCase();
      await page.screenshot({ path: `debug_html/city_${safeName}.png`, fullPage: true });
      fs.writeFileSync(`debug_html/city_${safeName}.html`, await page.content());

    } catch (e) {
      console.log(`    ERROR: ${e.message}`);
    }
  }

  // Now check Irving's direct MGO link if we found one
  console.log('\n' + '='.repeat(50));
  console.log('CHECKING IRVING DIRECT MGO ACCESS');
  console.log('='.repeat(50));

  // Try Irving's inspections page which should have permit info
  await page.goto('https://www.cityofirving.org/181/Inspections', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  await page.waitForTimeout(3000);

  const irvingLinks = await page.evaluate(() => {
    return [...document.querySelectorAll('a')].filter(a => {
      const href = a.href?.toLowerCase() || '';
      return href.includes('mgo') || href.includes('permit') || href.includes('mygovernment');
    }).map(a => ({
      text: a.textContent?.trim(),
      href: a.href
    }));
  });

  console.log('Irving Inspections page links:');
  irvingLinks.forEach(l => console.log(`  - "${l.text}" -> ${l.href}`));

  // Try a different approach - check if MGO has a public records search
  console.log('\n' + '='.repeat(50));
  console.log('TRYING ALTERNATIVE MGO PATHS');
  console.log('='.repeat(50));

  const altPaths = [
    'https://www.mgoconnect.org/publicportal',
    'https://www.mgoconnect.org/public',
    'https://publicportal.mgoconnect.org',
    'https://www.mygovernmentonline.org/public-search',
    'https://www.mygovernmentonline.org/permit-search',
  ];

  for (const url of altPaths) {
    console.log(`\n[Testing] ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      console.log(`    -> ${page.url()}`);
      console.log(`    Title: ${await page.title()}`);
    } catch (e) {
      console.log(`    ERROR: ${e.message}`);
    }
  }

  await browser.close();

  console.log('\n' + '='.repeat(50));
  console.log('CONCLUSION');
  console.log('='.repeat(50));
  console.log('MGO Connect appears to require authentication for permit search.');
  console.log('This would require either:');
  console.log('  1. Creating a free account (if available)');
  console.log('  2. Finding an alternative public records portal');
  console.log('  3. Deprioritizing MGO cities');
}

recon().catch(console.error);
