#!/usr/bin/env node
/**
 * MGO Connect Reconnaissance - Phase 3
 * Explore all possible public access paths
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

async function recon() {
  console.log('='.repeat(50));
  console.log('MGO CONNECT RECON - PUBLIC ACCESS PATHS');
  console.log('='.repeat(50));

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  // Try different paths and JID combinations
  const pathsToTry = [
    // Irving variations
    'https://www.mgoconnect.org/cp?JID=320',
    'https://www.mgoconnect.org/cp/portal?JID=320',
    'https://www.mgoconnect.org/cp/public-search?JID=320',
    'https://www.mgoconnect.org/cp/permit-lookup?JID=320',
    'https://www.mgoconnect.org/cp/permits?JID=320',
    // Try without JID (generic)
    'https://www.mgoconnect.org/cp/public',
    'https://www.mgoconnect.org/cp/guest',
    // Maybe different structure
    'https://mgoconnect.org/Irving',
    'https://mgoconnect.org/Irving/permits',
    // Check if there's an API or public lookup
    'https://www.mgoconnect.org/api/public/permits',
  ];

  for (const url of pathsToTry) {
    console.log(`\n[Testing] ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForTimeout(2000);

      const finalUrl = page.url();
      const isLogin = finalUrl.includes('login');
      const title = await page.title();

      console.log(`    -> ${finalUrl}`);
      console.log(`    Title: ${title}`);
      console.log(`    Login redirect: ${isLogin}`);

      if (!isLogin) {
        // Found a non-login page! Save it
        const safeName = url.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        await page.screenshot({ path: `debug_html/mgo_${safeName}.png`, fullPage: true });
        fs.writeFileSync(`debug_html/mgo_${safeName}.html`, await page.content());
        console.log(`    >>> SAVED - possible public access!`);

        // Check content
        const hasPermitContent = await page.evaluate(() => {
          const text = document.body.textContent || '';
          return {
            hasPermit: /permit/i.test(text),
            hasSearch: /search/i.test(text),
            hasApply: /apply/i.test(text),
            links: [...document.querySelectorAll('a')].slice(0, 10).map(a => ({
              text: a.textContent?.trim().substring(0, 50),
              href: a.href
            }))
          };
        });
        console.log(`    Content: permit=${hasPermitContent.hasPermit}, search=${hasPermitContent.hasSearch}, apply=${hasPermitContent.hasApply}`);
        if (hasPermitContent.links.length > 0) {
          console.log('    Links:');
          hasPermitContent.links.forEach(l => console.log(`      - ${l.text}: ${l.href}`));
        }
      }
    } catch (e) {
      console.log(`    ERROR: ${e.message}`);
    }
  }

  // Now let's explore the portal landing page more carefully
  console.log('\n' + '='.repeat(50));
  console.log('EXPLORING PORTAL LANDING PAGE');
  console.log('='.repeat(50));

  await page.goto('https://www.mgoconnect.org/cp?JID=320', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  await page.waitForTimeout(5000);

  // Get all links on the page
  const allLinks = await page.evaluate(() => {
    return [...document.querySelectorAll('a')].map(a => ({
      text: a.textContent?.trim(),
      href: a.href,
      onclick: a.getAttribute('onclick')
    })).filter(l => l.href && l.text);
  });

  console.log('\nAll links on portal page:');
  allLinks.forEach(l => {
    console.log(`  "${l.text}" -> ${l.href}`);
  });

  // Try clicking "Search Permits" from the landing page (maybe it's different when coming from portal)
  console.log('\n[Trying to click Search Permits link...]');
  const clicked = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    for (const link of links) {
      if (link.textContent?.includes('Search Permits')) {
        link.click();
        return link.href;
      }
    }
    return null;
  });

  if (clicked) {
    console.log(`Clicked link pointing to: ${clicked}`);
    await page.waitForTimeout(5000);
    console.log(`Now at: ${page.url()}`);

    const isLogin = page.url().includes('login');
    if (!isLogin) {
      await page.screenshot({ path: 'debug_html/mgo_search_from_portal.png', fullPage: true });
      fs.writeFileSync('debug_html/mgo_search_from_portal.html', await page.content());
      console.log('FOUND PUBLIC SEARCH ACCESS!');
    } else {
      console.log('Still redirecting to login...');
    }
  }

  await browser.close();

  console.log('\n' + '='.repeat(50));
  console.log('RECON COMPLETE');
  console.log('='.repeat(50));
}

recon().catch(console.error);
