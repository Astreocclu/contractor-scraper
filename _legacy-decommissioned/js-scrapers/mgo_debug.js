#!/usr/bin/env node
/**
 * MGO Debug - Check available states and jurisdictions
 */

const puppeteer = require('puppeteer');

const MGO_EMAIL = process.env.MGO_EMAIL;
const MGO_PASSWORD = process.env.MGO_PASSWORD;

async function debug() {
  console.log('MGO DEBUG - Checking available options\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  try {
    // Login
    console.log('[1] Logging in...');
    await page.goto('https://www.mgoconnect.org/cp/login', { waitUntil: 'networkidle2' });
    await page.waitForTimeout(2000);
    await page.type('input[type="email"], #exampleInputEmail1', MGO_EMAIL, { delay: 30 });
    await page.type('input[type="password"], #exampleInputPassword1', MGO_PASSWORD, { delay: 30 });
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        if (b.textContent?.toLowerCase().includes('login')) b.click();
      });
    });
    await page.waitForTimeout(5000);
    console.log('    Logged in');

    // Go to search
    console.log('[2] Going to search page...');
    await page.goto('https://www.mgoconnect.org/cp/search', { waitUntil: 'networkidle2' });
    await page.waitForTimeout(3000);

    // Click State dropdown and list options
    console.log('[3] Clicking State dropdown...');
    await page.evaluate(() => {
      const dropdowns = document.querySelectorAll('.p-dropdown');
      for (const dd of dropdowns) {
        if (dd.textContent?.includes('Select a State')) {
          dd.click();
          return;
        }
      }
    });
    await page.waitForTimeout(2000);

    // Get all state options
    const states = await page.evaluate(() => {
      const items = document.querySelectorAll('.p-dropdown-item, li[role="option"]');
      return Array.from(items).map(i => i.textContent?.trim()).filter(Boolean);
    });
    console.log('    Available States:', states.slice(0, 20));

    // Click away to close dropdown
    await page.click('body');
    await page.waitForTimeout(1000);

    // If Texas exists, select it
    if (states.some(s => s?.includes('Texas'))) {
      console.log('\n[4] Texas found! Selecting it...');
      await page.evaluate(() => {
        const dropdowns = document.querySelectorAll('.p-dropdown');
        for (const dd of dropdowns) {
          if (dd.textContent?.includes('Select a State')) {
            dd.click();
            return;
          }
        }
      });
      await page.waitForTimeout(1000);

      await page.evaluate(() => {
        const items = document.querySelectorAll('.p-dropdown-item, li[role="option"]');
        for (const item of items) {
          if (item.textContent?.includes('Texas')) {
            item.click();
            return;
          }
        }
      });
      await page.waitForTimeout(2000);

      // Now check Jurisdiction dropdown
      console.log('[5] Checking Jurisdiction dropdown...');
      await page.evaluate(() => {
        const dropdowns = document.querySelectorAll('.p-dropdown');
        for (const dd of dropdowns) {
          if (dd.textContent?.includes('Select a Jurisdiction') || dd.textContent?.includes('Jurisdiction')) {
            dd.click();
            return;
          }
        }
      });
      await page.waitForTimeout(2000);

      const jurisdictions = await page.evaluate(() => {
        const items = document.querySelectorAll('.p-dropdown-item, li[role="option"]');
        return Array.from(items).map(i => i.textContent?.trim()).filter(Boolean);
      });
      console.log('    Available Jurisdictions for Texas:', jurisdictions.slice(0, 30));
    } else {
      console.log('\n    Texas NOT in available states!');
      console.log('    This MGO account may not have access to Texas jurisdictions.');
    }

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}

debug().catch(console.error);
