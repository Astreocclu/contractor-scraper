#!/usr/bin/env node
/**
 * MGO Connect Reconnaissance Script
 * Explores the portal to understand structure and navigation
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

async function recon() {
  console.log('='.repeat(50));
  console.log('MGO CONNECT RECONNAISSANCE');
  console.log('='.repeat(50));

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  try {
    // Test Irving portal
    console.log('\n[1] Loading Irving MGO portal (JID=320)...');
    await page.goto('https://www.mgoconnect.org/cp?JID=320', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    await page.waitForTimeout(5000);

    // Save screenshot
    await page.screenshot({ path: 'debug_html/mgo_irving_1.png', fullPage: true });
    fs.writeFileSync('debug_html/mgo_irving_1.html', await page.content());
    console.log('    Saved screenshot and HTML');

    // Check current URL (may have redirected)
    console.log(`    Current URL: ${page.url()}`);

    // Look for key elements
    const pageInfo = await page.evaluate(() => {
      const result = {
        title: document.title,
        hasLoginForm: !!document.querySelector('input[type="password"]'),
        hasSearchForm: !!document.querySelector('input[type="search"]') || !!document.querySelector('[placeholder*="search" i]'),
        buttons: [],
        links: [],
        inputs: [],
        tables: document.querySelectorAll('table').length,
        grids: document.querySelectorAll('[class*="grid"]').length,
        tabs: [],
        headings: []
      };

      // Collect buttons
      document.querySelectorAll('button, [role="button"], .btn').forEach(el => {
        const text = el.textContent?.trim().substring(0, 50);
        if (text && !result.buttons.includes(text)) {
          result.buttons.push(text);
        }
      });

      // Collect navigation links
      document.querySelectorAll('a, [role="link"]').forEach(el => {
        const text = el.textContent?.trim().substring(0, 50);
        const href = el.href || el.getAttribute('routerlink');
        if (text && href) {
          result.links.push({ text, href: href.substring(0, 100) });
        }
      });

      // Collect inputs
      document.querySelectorAll('input, select').forEach(el => {
        result.inputs.push({
          type: el.type || el.tagName.toLowerCase(),
          name: el.name || el.id || el.placeholder || '(unnamed)',
          placeholder: el.placeholder || ''
        });
      });

      // Collect tabs
      document.querySelectorAll('[role="tab"], .tab, .nav-tab').forEach(el => {
        const text = el.textContent?.trim();
        if (text) result.tabs.push(text);
      });

      // Collect headings
      document.querySelectorAll('h1, h2, h3').forEach(el => {
        const text = el.textContent?.trim().substring(0, 100);
        if (text) result.headings.push(text);
      });

      return result;
    });

    console.log('\n[2] Page Analysis:');
    console.log(`    Title: ${pageInfo.title}`);
    console.log(`    Has login form: ${pageInfo.hasLoginForm}`);
    console.log(`    Has search form: ${pageInfo.hasSearchForm}`);
    console.log(`    Tables: ${pageInfo.tables}, Grids: ${pageInfo.grids}`);

    console.log('\n    Headings:');
    pageInfo.headings.slice(0, 10).forEach(h => console.log(`      - ${h}`));

    console.log('\n    Tabs:');
    pageInfo.tabs.slice(0, 10).forEach(t => console.log(`      - ${t}`));

    console.log('\n    Buttons:');
    pageInfo.buttons.slice(0, 15).forEach(b => console.log(`      - ${b}`));

    console.log('\n    Inputs:');
    pageInfo.inputs.slice(0, 10).forEach(i => console.log(`      - ${i.type}: ${i.name} (${i.placeholder})`));

    console.log('\n    Links (first 15):');
    pageInfo.links.slice(0, 15).forEach(l => console.log(`      - "${l.text}" -> ${l.href}`));

    // Try to find permits section
    console.log('\n[3] Looking for permit-related elements...');
    const permitElements = await page.evaluate(() => {
      const keywords = ['permit', 'building', 'inspection', 'license', 'application', 'search'];
      const found = [];

      keywords.forEach(keyword => {
        document.querySelectorAll('*').forEach(el => {
          const text = el.textContent?.toLowerCase() || '';
          const classList = el.className?.toLowerCase() || '';
          if ((text.includes(keyword) || classList.includes(keyword)) && el.tagName !== 'SCRIPT') {
            const tag = el.tagName.toLowerCase();
            if (['a', 'button', 'li', 'div', 'span', 'h1', 'h2', 'h3', 'label'].includes(tag)) {
              found.push({
                tag,
                text: el.textContent?.trim().substring(0, 80),
                class: el.className?.substring(0, 50),
                id: el.id
              });
            }
          }
        });
      });

      // Dedupe by text
      const seen = new Set();
      return found.filter(f => {
        if (seen.has(f.text)) return false;
        seen.add(f.text);
        return true;
      }).slice(0, 20);
    });

    console.log('    Permit-related elements:');
    permitElements.forEach(el => {
      console.log(`      <${el.tag}> "${el.text}" ${el.id ? `id="${el.id}"` : ''}`);
    });

    // Try clicking on potential permit links
    console.log('\n[4] Attempting to navigate to permits section...');

    // Look for common permit navigation patterns
    const clickTargets = [
      'text/Permits',
      'text/Building',
      'text/Search',
      'text/Public',
      '[routerlink*="permit"]',
      '[routerlink*="search"]',
      'a[href*="permit"]',
      'a[href*="search"]'
    ];

    for (const selector of clickTargets) {
      try {
        let clicked = false;
        if (selector.startsWith('text/')) {
          const text = selector.replace('text/', '');
          clicked = await page.evaluate((searchText) => {
            const elements = [...document.querySelectorAll('a, button, [role="button"], li')];
            for (const el of elements) {
              if (el.textContent?.trim().toLowerCase().includes(searchText.toLowerCase())) {
                el.click();
                return true;
              }
            }
            return false;
          }, text);
        } else {
          const el = await page.$(selector);
          if (el) {
            await el.click();
            clicked = true;
          }
        }

        if (clicked) {
          console.log(`    Clicked: ${selector}`);
          await page.waitForTimeout(3000);
          await page.screenshot({ path: `debug_html/mgo_after_click.png`, fullPage: true });
          fs.writeFileSync('debug_html/mgo_after_click.html', await page.content());
          console.log(`    New URL: ${page.url()}`);
          break;
        }
      } catch (e) {
        // Ignore click errors
      }
    }

  } catch (e) {
    console.error(`\nERROR: ${e.message}`);
  } finally {
    await browser.close();
  }

  console.log('\n' + '='.repeat(50));
  console.log('RECON COMPLETE - Check debug_html/ for screenshots');
  console.log('='.repeat(50));
}

recon().catch(console.error);
