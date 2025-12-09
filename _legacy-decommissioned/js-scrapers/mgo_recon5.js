#!/usr/bin/env node
/**
 * MGO Connect - Check publicportal path
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

async function recon() {
  console.log('='.repeat(50));
  console.log('CHECKING MGO PUBLICPORTAL');
  console.log('='.repeat(50));

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  // Check publicportal
  console.log('\n[1] Loading publicportal...');
  await page.goto('https://www.mgoconnect.org/publicportal', {
    waitUntil: 'networkidle2',
    timeout: 60000
  });
  await page.waitForTimeout(5000);

  console.log(`    URL: ${page.url()}`);
  console.log(`    Title: ${await page.title()}`);

  await page.screenshot({ path: 'debug_html/mgo_publicportal.png', fullPage: true });
  fs.writeFileSync('debug_html/mgo_publicportal.html', await page.content());

  // Analyze the page
  const pageInfo = await page.evaluate(() => {
    const result = {
      headings: [],
      inputs: [],
      buttons: [],
      links: [],
      bodyText: document.body?.textContent?.substring(0, 1000) || ''
    };

    document.querySelectorAll('h1, h2, h3, h4').forEach(h => {
      result.headings.push(h.textContent?.trim());
    });

    document.querySelectorAll('input, select').forEach(i => {
      result.inputs.push({
        type: i.type || i.tagName,
        name: i.name || i.id || i.placeholder,
        placeholder: i.placeholder
      });
    });

    document.querySelectorAll('button, input[type="submit"], [role="button"]').forEach(b => {
      result.buttons.push(b.textContent?.trim() || b.value);
    });

    document.querySelectorAll('a').forEach(a => {
      if (a.href && a.textContent?.trim()) {
        result.links.push({
          text: a.textContent.trim().substring(0, 50),
          href: a.href
        });
      }
    });

    return result;
  });

  console.log('\n    Headings:', pageInfo.headings.slice(0, 10));
  console.log('\n    Inputs:');
  pageInfo.inputs.forEach(i => console.log(`      - [${i.type}] ${i.name}`));
  console.log('\n    Buttons:', pageInfo.buttons.slice(0, 10));
  console.log('\n    Links:');
  pageInfo.links.slice(0, 20).forEach(l => console.log(`      - "${l.text}" -> ${l.href}`));
  console.log('\n    Body text preview:', pageInfo.bodyText.substring(0, 500));

  // Try variations with city context
  console.log('\n' + '='.repeat(50));
  console.log('TRYING PUBLICPORTAL WITH CITY CONTEXT');
  console.log('='.repeat(50));

  const variations = [
    'https://www.mgoconnect.org/publicportal?JID=320',
    'https://www.mgoconnect.org/publicportal/Irving',
    'https://www.mgoconnect.org/publicportal/search',
    'https://www.mgoconnect.org/publicportal/permits',
  ];

  for (const url of variations) {
    console.log(`\n[Testing] ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForTimeout(2000);
      const finalUrl = page.url();
      const isLogin = finalUrl.includes('login');
      console.log(`    -> ${finalUrl}`);
      console.log(`    Login redirect: ${isLogin}`);

      if (!isLogin && !finalUrl.includes('publicportal')) {
        // Something different loaded
        await page.screenshot({ path: `debug_html/mgo_pub_variant.png`, fullPage: true });
        console.log('    >>> Different page loaded - saved screenshot');
      }
    } catch (e) {
      console.log(`    ERROR: ${e.message}`);
    }
  }

  await browser.close();
}

recon().catch(console.error);
