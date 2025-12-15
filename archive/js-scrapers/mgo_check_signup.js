#!/usr/bin/env node
/**
 * MGO Connect - Check if free account signup is available
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

async function checkSignup() {
  console.log('='.repeat(50));
  console.log('CHECKING MGO ACCOUNT SIGNUP');
  console.log('='.repeat(50));

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  try {
    // Go to login page
    console.log('\n[1] Loading login page...');
    await page.goto('https://www.mgoconnect.org/cp/login', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'debug_html/mgo_login.png', fullPage: true });
    fs.writeFileSync('debug_html/mgo_login.html', await page.content());

    // Look for signup/register button
    const signupInfo = await page.evaluate(() => {
      const result = {
        hasSignup: false,
        signupLinks: [],
        buttons: []
      };

      // Look for signup/register/new account links
      document.querySelectorAll('a, button').forEach(el => {
        const text = (el.textContent || '').toLowerCase();
        const href = el.href || '';
        if (text.includes('sign up') || text.includes('signup') ||
            text.includes('register') || text.includes('new account') ||
            text.includes('create account')) {
          result.hasSignup = true;
          result.signupLinks.push({
            text: el.textContent?.trim(),
            href,
            tag: el.tagName
          });
        }
        if (el.tagName === 'BUTTON' || el.type === 'submit') {
          result.buttons.push(el.textContent?.trim());
        }
      });

      return result;
    });

    console.log(`    Has signup option: ${signupInfo.hasSignup}`);
    console.log('    Buttons:', signupInfo.buttons);
    console.log('    Signup links:', signupInfo.signupLinks);

    // Try clicking New Account button
    console.log('\n[2] Looking for New Account button...');
    const clicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.toLowerCase().includes('new account')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (clicked) {
      console.log('    Clicked "New Account" button');
      await page.waitForTimeout(5000);
      console.log(`    New URL: ${page.url()}`);

      await page.screenshot({ path: 'debug_html/mgo_signup.png', fullPage: true });
      fs.writeFileSync('debug_html/mgo_signup.html', await page.content());

      // Check what fields are required
      const signupForm = await page.evaluate(() => {
        const inputs = [];
        document.querySelectorAll('input, select').forEach(i => {
          inputs.push({
            type: i.type,
            name: i.name || i.id || i.placeholder,
            required: i.required,
            placeholder: i.placeholder
          });
        });
        return {
          url: window.location.href,
          inputs,
          pageText: document.body?.textContent?.substring(0, 1000)
        };
      });

      console.log('\n    Signup form fields:');
      signupForm.inputs.forEach(i => {
        console.log(`      - [${i.type}] ${i.name} ${i.required ? '(required)' : ''}`);
      });
      console.log('\n    Page text preview:', signupForm.pageText?.substring(0, 300));
    }

  } catch (e) {
    console.error(`ERROR: ${e.message}`);
  } finally {
    await browser.close();
  }

  console.log('\n' + '='.repeat(50));
  console.log('SIGNUP CHECK COMPLETE');
  console.log('='.repeat(50));
}

checkSignup().catch(console.error);
