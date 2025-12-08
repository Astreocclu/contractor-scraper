#!/usr/bin/env python3
"""Quick test to debug MGO button click issue."""

import asyncio
import os
from playwright.async_api import async_playwright
from playwright_stealth import Stealth

MGO_EMAIL = os.getenv('MGO_EMAIL')
MGO_PASSWORD = os.getenv('MGO_PASSWORD')


async def test_mgo():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 900},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        page = await context.new_page()

        # Apply stealth
        stealth = Stealth()
        await stealth.apply_stealth_async(page)

        # Capture console messages
        console_messages = []
        page.on('console', lambda msg: console_messages.append(f'{msg.type}: {msg.text}'))

        # Capture all network requests
        requests_made = []
        page.on('request', lambda req: requests_made.append(req.url) if 'api' in req.url.lower() else None)

        print('[1] Logging in...')
        await page.goto('https://www.mgoconnect.org/cp/login', wait_until='networkidle', timeout=60000)
        await asyncio.sleep(2)

        await page.fill('input[type="email"]', MGO_EMAIL)
        await page.fill('input[type="password"]', MGO_PASSWORD)

        # Click login
        await page.evaluate('''() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.textContent?.toLowerCase().includes('login')) {
                    btn.click();
                    return;
                }
            }
        }''')
        await asyncio.sleep(5)
        print(f'    Logged in: {"login" not in page.url}')

        print('[2] Selecting Irving...')
        await page.goto('https://www.mgoconnect.org/cp/home', wait_until='networkidle')
        await asyncio.sleep(2)

        # Select Texas
        await page.evaluate('''() => {
            const dropdowns = document.querySelectorAll('.p-dropdown');
            if (dropdowns[0]) dropdowns[0].click();
        }''')
        await asyncio.sleep(1)
        await page.keyboard.type('Texas', delay=100)
        await asyncio.sleep(1)
        await page.keyboard.press('Enter')
        await asyncio.sleep(3)

        # Select Irving
        await page.evaluate('''() => {
            const dropdowns = document.querySelectorAll('.p-dropdown');
            if (dropdowns[1]) dropdowns[1].click();
        }''')
        await asyncio.sleep(1)
        await page.keyboard.type('Irving', delay=100)
        await asyncio.sleep(1)
        await page.keyboard.press('Enter')
        await asyncio.sleep(2)

        # Click Continue
        await page.evaluate('''() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.textContent?.toLowerCase().includes('continue')) {
                    btn.click();
                    return;
                }
            }
        }''')
        await asyncio.sleep(5)

        print('[3] Going to search...')
        await page.goto('https://www.mgoconnect.org/cp/search', wait_until='networkidle')
        await asyncio.sleep(3)

        # Re-select jurisdiction on search page - need to wait and be more careful
        print('    Selecting Texas...')
        # Click on State dropdown
        state_dropdown = await page.query_selector('.p-dropdown')
        if state_dropdown:
            await state_dropdown.click()
            await asyncio.sleep(1)
            await page.keyboard.type('Texas', delay=100)
            await asyncio.sleep(1)
            # Click on the Texas option
            texas_option = await page.query_selector('.p-dropdown-item:has-text("Texas")')
            if texas_option:
                await texas_option.click()
            else:
                await page.keyboard.press('Enter')
            await asyncio.sleep(3)
            print('    Texas selected')

        print('    Selecting Irving...')
        # Find all dropdowns, click the second one (Jurisdiction)
        dropdowns = await page.query_selector_all('.p-dropdown')
        if len(dropdowns) > 1:
            await dropdowns[1].click()
            await asyncio.sleep(1)
            await page.keyboard.type('Irving', delay=100)
            await asyncio.sleep(1)
            irving_option = await page.query_selector('.p-dropdown-item:has-text("Irving")')
            if irving_option:
                await irving_option.click()
            else:
                await page.keyboard.press('Enter')
            await asyncio.sleep(5)  # Wait longer for form to load
            print('    Irving selected')

        # Take screenshot to verify form state
        await page.screenshot(path='debug_html/mgo_test_after_jurisdiction.png')

        # Check what elements are visible now
        has_search = await page.evaluate('''() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.textContent?.toLowerCase().includes('search') &&
                    !btn.textContent?.toLowerCase().includes('address')) {
                    return { found: true, text: btn.textContent, visible: btn.offsetParent !== null };
                }
            }
            return { found: false };
        }''')
        print(f'    Search button status: {has_search}')

        print('[4] Testing button click methods...')
        requests_made.clear()

        # Method 1: Playwright locator click
        print('    Method 1: Playwright locator.click()')
        try:
            btn = page.locator('button:has-text("Search")').first
            await btn.scroll_into_view_if_needed()
            await btn.click(timeout=5000)
            await asyncio.sleep(3)
            print(f'    -> API requests: {len([r for r in requests_made if "search" in r.lower()])}')
        except Exception as e:
            print(f'    -> Failed: {e}')

        # Method 2: dispatch_event
        print('    Method 2: dispatch_event("click")')
        requests_made.clear()
        try:
            btn = page.locator('button:has-text("Search")').first
            await btn.dispatch_event('click')
            await asyncio.sleep(3)
            print(f'    -> API requests: {len([r for r in requests_made if "search" in r.lower()])}')
        except Exception as e:
            print(f'    -> Failed: {e}')

        # Method 3: JavaScript click
        print('    Method 3: JS evaluate btn.click()')
        requests_made.clear()
        await page.evaluate('''() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.textContent?.toLowerCase().includes('search') &&
                    !btn.textContent?.toLowerCase().includes('address')) {
                    btn.click();
                    return true;
                }
            }
            return false;
        }''')
        await asyncio.sleep(3)
        print(f'    -> API requests: {len([r for r in requests_made if "search" in r.lower()])}')

        # Method 4: Mouse click at coordinates
        print('    Method 4: Mouse click at coordinates')
        requests_made.clear()
        box = await page.evaluate('''() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.textContent?.toLowerCase().includes('search') &&
                    !btn.textContent?.toLowerCase().includes('address')) {
                    const rect = btn.getBoundingClientRect();
                    return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
                }
            }
            return null;
        }''')
        if box:
            await page.mouse.click(box['x'], box['y'])
            await asyncio.sleep(3)
            print(f'    -> API requests: {len([r for r in requests_made if "search" in r.lower()])}')

        # Method 5: Focus + Enter
        print('    Method 5: Focus button + Enter key')
        requests_made.clear()
        try:
            btn = page.locator('button:has-text("Search")').first
            await btn.focus()
            await page.keyboard.press('Enter')
            await asyncio.sleep(3)
            print(f'    -> API requests: {len([r for r in requests_made if "search" in r.lower()])}')
        except Exception as e:
            print(f'    -> Failed: {e}')

        # Method 6: Angular-style event dispatch
        print('    Method 6: Angular dispatchEvent with bubbles')
        requests_made.clear()
        await page.evaluate('''() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.textContent?.toLowerCase().includes('search') &&
                    !btn.textContent?.toLowerCase().includes('address')) {
                    const event = new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    });
                    btn.dispatchEvent(event);
                    return true;
                }
            }
            return false;
        }''')
        await asyncio.sleep(3)
        print(f'    -> API requests: {len([r for r in requests_made if "search" in r.lower()])}')

        # Check console for errors
        errors = [m for m in console_messages if 'error' in m.lower()]
        if errors:
            print(f'\n[!] Console errors: {len(errors)}')
            for e in errors[:5]:
                print(f'    {e[:100]}')

        # Final screenshot
        await page.screenshot(path='debug_html/mgo_test_final.png', full_page=True)
        print(f'\nTotal API requests captured: {len(requests_made)}')
        print(f'Screenshot saved to debug_html/mgo_test_final.png')

        await browser.close()


if __name__ == '__main__':
    asyncio.run(test_mgo())
