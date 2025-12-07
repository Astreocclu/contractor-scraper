#!/usr/bin/env node
/**
 * MGO Connect Reconnaissance - Phase 2
 * Explore the permit search page
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

async function recon() {
  console.log('='.repeat(50));
  console.log('MGO CONNECT RECON - SEARCH PAGE');
  console.log('='.repeat(50));

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  try {
    // Go directly to search page
    console.log('\n[1] Loading MGO search page...');
    await page.goto('https://mgoconnect.org/cp/search', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    await page.waitForTimeout(5000);

    await page.screenshot({ path: 'debug_html/mgo_search_1.png', fullPage: true });
    fs.writeFileSync('debug_html/mgo_search_1.html', await page.content());
    console.log(`    Current URL: ${page.url()}`);
    console.log('    Saved screenshot');

    // Analyze search page
    const searchInfo = await page.evaluate(() => {
      const result = {
        title: document.title,
        forms: [],
        inputs: [],
        buttons: [],
        selects: [],
        hasResults: false,
        resultCount: 0
      };

      // Find forms
      document.querySelectorAll('form').forEach(f => {
        result.forms.push({
          id: f.id,
          action: f.action,
          method: f.method
        });
      });

      // Find inputs
      document.querySelectorAll('input').forEach(el => {
        result.inputs.push({
          type: el.type,
          name: el.name || el.id,
          placeholder: el.placeholder,
          value: el.value
        });
      });

      // Find selects/dropdowns
      document.querySelectorAll('select, [role="listbox"], [role="combobox"]').forEach(el => {
        const options = [...el.querySelectorAll('option, [role="option"]')].map(o => o.textContent?.trim()).slice(0, 10);
        result.selects.push({
          name: el.name || el.id || el.getAttribute('formcontrolname'),
          options
        });
      });

      // Find buttons
      document.querySelectorAll('button, input[type="submit"], [role="button"]').forEach(el => {
        const text = el.textContent?.trim() || el.value;
        if (text) result.buttons.push(text.substring(0, 50));
      });

      // Check for results table/grid
      const tables = document.querySelectorAll('table, [class*="grid"], [class*="list"]');
      const rows = document.querySelectorAll('tr, [class*="row"]');
      result.hasResults = rows.length > 5;
      result.resultCount = rows.length;

      return result;
    });

    console.log('\n[2] Search Page Analysis:');
    console.log(`    Forms: ${searchInfo.forms.length}`);
    console.log(`    Inputs: ${searchInfo.inputs.length}`);
    console.log(`    Selects: ${searchInfo.selects.length}`);
    console.log(`    Buttons: ${searchInfo.buttons.length}`);
    console.log(`    Has results: ${searchInfo.hasResults} (${searchInfo.resultCount} rows)`);

    console.log('\n    Inputs:');
    searchInfo.inputs.forEach(i => {
      console.log(`      - [${i.type}] ${i.name || '(unnamed)'} placeholder="${i.placeholder}"`);
    });

    console.log('\n    Selects/Dropdowns:');
    searchInfo.selects.forEach(s => {
      console.log(`      - ${s.name}: ${s.options.join(', ')}`);
    });

    console.log('\n    Buttons:');
    searchInfo.buttons.forEach(b => console.log(`      - ${b}`));

    // Try submitting empty search
    console.log('\n[3] Attempting empty search...');

    // Look for search button
    const searchClicked = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button, input[type="submit"]')];
      for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() || btn.value?.toLowerCase() || '';
        if (text.includes('search') || text.includes('find') || text.includes('submit')) {
          btn.click();
          return btn.textContent?.trim() || btn.value;
        }
      }
      return null;
    });

    if (searchClicked) {
      console.log(`    Clicked: "${searchClicked}"`);
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'debug_html/mgo_search_results.png', fullPage: true });
      fs.writeFileSync('debug_html/mgo_search_results.html', await page.content());
      console.log(`    New URL: ${page.url()}`);

      // Check for results
      const resultsInfo = await page.evaluate(() => {
        const result = {
          url: window.location.href,
          tables: document.querySelectorAll('table').length,
          rows: [],
          hasPermitData: false
        };

        // Look for data rows
        document.querySelectorAll('tr, [class*="row"], [class*="item"]').forEach(row => {
          const text = row.textContent?.trim().substring(0, 200);
          if (text && text.length > 20) {
            result.rows.push(text);
          }
        });

        // Check for permit-like patterns
        const pageText = document.body.textContent || '';
        result.hasPermitData = /\d{4}-\d+|permit|PRJ-|BLD-/i.test(pageText);

        return result;
      });

      console.log(`    Tables: ${resultsInfo.tables}`);
      console.log(`    Data rows: ${resultsInfo.rows.length}`);
      console.log(`    Has permit data: ${resultsInfo.hasPermitData}`);

      if (resultsInfo.rows.length > 0) {
        console.log('\n    Sample rows:');
        resultsInfo.rows.slice(0, 5).forEach(r => {
          console.log(`      - ${r.substring(0, 100)}...`);
        });
      }
    } else {
      console.log('    No search button found');
    }

  } catch (e) {
    console.error(`\nERROR: ${e.message}`);
  } finally {
    await browser.close();
  }

  console.log('\n' + '='.repeat(50));
  console.log('RECON COMPLETE');
  console.log('='.repeat(50));
}

recon().catch(console.error);
