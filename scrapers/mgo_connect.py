#!/usr/bin/env python3
"""
MGO CONNECT PERMIT SCRAPER (Playwright Python)
Portal: My Government Online (MGO Connect)
Covers: Irving, Lewisville, Denton, Cedar Hill, and more DFW cities

NOTE: This Python/Playwright version has issues with button clicks not triggering
API calls. Use the Node.js/Puppeteer version instead:
  node scrapers/mgo_connect.js Irving 50

Requires login - credentials from .env:
  MGO_EMAIL, MGO_PASSWORD

Usage:
  python scrapers/mgo_connect.py Irving 50
  python scrapers/mgo_connect.py Lewisville 25
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import httpx
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

# City JID mappings (jurisdiction IDs)
# To find JID: Go to mgoconnect.org, select state/city, check URL parameter
MGO_CITIES = {
    # DFW Metro - Verified
    'Irving': 245,
    'Lewisville': 325,
    'Denton': 285,
    'Cedar Hill': 305,
    'CedarHill': 305,
    'Duncanville': 253,
    # DFW Metro - Need verification
    'Lancaster': 0,  # TODO: Find JID
    'Balch Springs': 0,  # TODO: Find JID
    'BalchSprings': 0,
    'Sachse': 0,  # TODO: Find JID
    # Central Texas
    'Georgetown': 0,  # TODO: Find JID
    'Temple': 0,
    'Killeen': 0,
    'San Marcos': 0,
    'SanMarcos': 0,
    # North Texas
    'Celina': 0,
    'Lucas': 0,
    'Pilot Point': 0,
    'PilotPoint': 0,
    'Van Alstyne': 0,
    'VanAlstyne': 0,
    # West Texas
    'Amarillo': 0,
    'Wichita Falls': 0,
    'WichitaFalls': 0,
}

DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')
MGO_EMAIL = os.getenv('MGO_EMAIL')
MGO_PASSWORD = os.getenv('MGO_PASSWORD')

# Permit types to EXCLUDE (garbage)
EXCLUDED_PERMIT_TYPES = {
    'garage sale', 'code enforcement', 'complaint', 'rental', 'license',
    'pre-development', 'conference', 'sign', 'billboard', 'commercial',
    'environmental', 'health', 'zoning', 'variance', 'planning', 'subdivision',
    'right-of-way', 'row', 'encroachment', 'special event', 'food', 'alcohol',
}


def is_valid_permit_type(permit_type: str) -> bool:
    """Check if permit type is one we want (not garbage)."""
    if not permit_type:
        return True

    permit_type_lower = permit_type.lower()

    for excluded in EXCLUDED_PERMIT_TYPES:
        if excluded in permit_type_lower:
            return False

    return True


def filter_permits(permits: list) -> tuple[list, dict]:
    """Filter out garbage permit types."""
    valid = []
    stats = {'bad_type': 0, 'empty': 0, 'total_rejected': 0}

    for p in permits:
        permit_type = p.get('type', '')
        permit_id = p.get('permit_id', '')

        if not permit_id and not p.get('address'):
            stats['empty'] += 1
            stats['total_rejected'] += 1
        elif not is_valid_permit_type(permit_type):
            stats['bad_type'] += 1
            stats['total_rejected'] += 1
        else:
            valid.append(p)

    return valid, stats


async def call_deepseek(prompt: str) -> str:
    """Call DeepSeek API for extraction."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            'https://api.deepseek.com/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {DEEPSEEK_API_KEY}'
            },
            json={
                'model': 'deepseek-chat',
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0.1,
                'max_tokens': 4000
            },
            timeout=60.0
        )
        data = response.json()
        return data.get('choices', [{}])[0].get('message', {}).get('content', '')


def parse_json(text: str) -> dict | None:
    """Parse JSON from text, handling markdown code blocks."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    import re
    match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text) or re.search(r'(\{[\s\S]*\})', text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    return None


async def login(page) -> bool:
    """Login to MGO Connect."""
    print('[LOGIN] Navigating to login page...')
    await page.goto('https://www.mgoconnect.org/cp/login', wait_until='networkidle', timeout=60000)
    await asyncio.sleep(3)

    # Check if already logged in
    if 'login' not in page.url:
        print('[LOGIN] Already logged in')
        return True

    print('[LOGIN] Entering credentials...')

    # Fill email
    try:
        await page.wait_for_selector('input[type="email"], input[name*="email"], #exampleInputEmail1', timeout=10000)
        await page.fill('input[type="email"], input[name*="email"], #exampleInputEmail1', MGO_EMAIL)
        print('[LOGIN] Email entered')
    except PlaywrightTimeout:
        print('[LOGIN] Could not find email field')
        return False

    # Fill password
    try:
        await page.fill('input[type="password"], #exampleInputPassword1', MGO_PASSWORD)
        print('[LOGIN] Password entered')
    except PlaywrightTimeout:
        print('[LOGIN] Could not find password field')
        return False

    # Click login button
    print('[LOGIN] Clicking login button...')
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

    if 'login' in page.url:
        print('[LOGIN] FAILED - still on login page')
        await page.screenshot(path='debug_html/mgo_login_failed.png', full_page=True)
        return False

    print('[LOGIN] SUCCESS')
    return True


async def scrape(city_name: str, target_count: int = 50):
    """Scrape permits from MGO Connect for a given city."""
    print('=' * 50)
    print(f'MGO CONNECT SCRAPER - {city_name.upper()}')
    print('=' * 50)
    print(f'Target: {target_count} permits')
    print(f'Time: {datetime.now().isoformat()}\n')

    # Validate inputs
    if not MGO_EMAIL or not MGO_PASSWORD:
        print('ERROR: MGO_EMAIL and MGO_PASSWORD must be set in .env')
        sys.exit(1)

    if not DEEPSEEK_API_KEY:
        print('ERROR: DEEPSEEK_API_KEY not set')
        sys.exit(1)

    jid = MGO_CITIES.get(city_name)
    if jid is None:
        print(f'ERROR: Unknown city "{city_name}". Available: {", ".join(MGO_CITIES.keys())}')
        sys.exit(1)

    permits = []
    errors = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 900},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        )
        page = await context.new_page()

        try:
            # Step 1: Login
            print('\n[1] Logging in...')
            if not await login(page):
                raise Exception('Login failed')

            # Step 2: Select jurisdiction
            print(f'\n[2] Selecting jurisdiction: Texas -> {city_name}...')
            await page.goto('https://www.mgoconnect.org/cp/home', wait_until='networkidle', timeout=60000)
            await asyncio.sleep(3)
            print('    On home page, selecting jurisdiction...')

            # Click State dropdown
            print('    Opening State dropdown...')
            state_clicked = await page.evaluate('''() => {
                const dropdowns = document.querySelectorAll('.p-dropdown');
                for (const dd of dropdowns) {
                    if (dd.textContent?.includes('Select a State')) {
                        dd.click();
                        return true;
                    }
                }
                return false;
            }''')
            print(f'    State dropdown opened: {state_clicked}')
            await asyncio.sleep(1)

            # Type Texas
            print('    Typing "Texas" to filter...')
            await page.keyboard.type('Texas', delay=100)
            await asyncio.sleep(1)

            # Select Texas
            texas_selected = await page.evaluate('''() => {
                const items = document.querySelectorAll('.p-dropdown-item, li[role="option"]');
                for (const item of items) {
                    if (item.textContent?.includes('Texas')) {
                        item.click();
                        return true;
                    }
                }
                return false;
            }''')
            if not texas_selected:
                await page.keyboard.press('Enter')
            else:
                print('    Texas selected')

            # Wait for jurisdictions to load
            print('    Waiting 5s for jurisdictions to load...')
            await asyncio.sleep(5)

            # Click Jurisdiction dropdown
            print('    Opening Jurisdiction dropdown...')
            await page.evaluate('''() => {
                const dropdowns = document.querySelectorAll('.p-dropdown');
                for (const dd of dropdowns) {
                    if (dd.textContent?.includes('Select a Jurisdiction') || dd.textContent?.includes('Jurisdiction')) {
                        dd.click();
                        return true;
                    }
                }
                if (dropdowns.length >= 2) {
                    dropdowns[1].click();
                    return true;
                }
                return false;
            }''')
            await asyncio.sleep(1.5)

            # Type city name
            print(f'    Typing "{city_name}" to filter...')
            await page.keyboard.type(city_name, delay=100)
            await asyncio.sleep(1.5)

            # Select city
            city_selected = await page.evaluate(f'''(city) => {{
                const items = document.querySelectorAll('.p-dropdown-item, li[role="option"]');
                for (const item of items) {{
                    if (item.textContent?.toLowerCase().includes(city.toLowerCase())) {{
                        item.click();
                        return {{ selected: true, text: item.textContent }};
                    }}
                }}
                return {{ selected: false }};
            }}''', city_name)

            if city_selected.get('selected'):
                print(f'    Selected: {city_selected.get("text")}')
            else:
                await page.keyboard.press('Enter')
            await asyncio.sleep(2)

            # Click Continue
            print('    Clicking Continue button...')
            await page.evaluate('''() => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    if (btn.textContent?.toLowerCase().includes('continue')) {
                        btn.click();
                        return true;
                    }
                }
                return false;
            }''')
            await asyncio.sleep(5)

            await page.screenshot(path=f'debug_html/mgo_{city_name.lower()}_jurisdiction.png', full_page=True)
            print(f'    Current URL: {page.url}')

            # Step 3: Navigate to permit search
            print('\n[3] Looking for permit search...')
            search_clicked = await page.evaluate('''() => {
                const links = document.querySelectorAll('a');
                for (const link of links) {
                    if (link.textContent?.toLowerCase().includes('search permit')) {
                        link.click();
                        return true;
                    }
                }
                return false;
            }''')

            if search_clicked:
                print('    Clicked "Search Permits" link')
                await asyncio.sleep(5)
            else:
                print('    Trying direct search URL...')
                await page.goto('https://www.mgoconnect.org/cp/search', wait_until='networkidle', timeout=30000)
                await asyncio.sleep(3)

            print(f'    Search URL: {page.url}')

            # Step 4: Fill search criteria
            print('\n[4] Filling search criteria...')

            # First, select jurisdiction on the search page (left sidebar)
            print('    Selecting jurisdiction on search page...')

            # Select State dropdown on search page - click to open
            state_opened = await page.evaluate('''() => {
                const dropdowns = document.querySelectorAll('.p-dropdown');
                for (const dd of dropdowns) {
                    const label = dd.textContent || '';
                    if (label.includes('Select a State') || label.includes('State')) {
                        dd.click();
                        return 'state';
                    }
                }
                if (dropdowns.length > 0) {
                    dropdowns[0].click();
                    return 'first';
                }
                return false;
            }''')
            print(f'    State dropdown opened: {state_opened}')
            await asyncio.sleep(1.5)

            # Click Texas option in dropdown
            texas_selected = await page.evaluate('''() => {
                const items = document.querySelectorAll('.p-dropdown-item, li[role="option"], .p-dropdown-items li');
                for (const item of items) {
                    if (item.textContent?.includes('Texas')) {
                        item.click();
                        return item.textContent.trim();
                    }
                }
                return false;
            }''')
            print(f'    Texas selected: {texas_selected}')
            await asyncio.sleep(3)

            # Select Jurisdiction dropdown - click to open
            await page.evaluate('''() => {
                const dropdowns = document.querySelectorAll('.p-dropdown');
                for (const dd of dropdowns) {
                    const label = dd.textContent || '';
                    if (label.includes('Select a Jurisdiction') || label.includes('Jurisdiction')) {
                        dd.click();
                        return true;
                    }
                }
                if (dropdowns.length > 1) dropdowns[1].click();
                return false;
            }''')
            await asyncio.sleep(1.5)

            # Type to filter, then click matching option
            await page.keyboard.type(city_name, delay=50)
            await asyncio.sleep(1)

            city_selected = await page.evaluate(f'''(cityName) => {{
                const items = document.querySelectorAll('.p-dropdown-item, li[role="option"], .p-dropdown-items li');
                for (const item of items) {{
                    if (item.textContent?.toLowerCase().includes(cityName.toLowerCase())) {{
                        item.click();
                        return item.textContent.trim();
                    }}
                }}
                return false;
            }}''', city_name)
            print(f'    Jurisdiction selected: {city_selected}')
            await asyncio.sleep(3)

            # Take screenshot to verify selection
            await page.screenshot(path=f'debug_html/mgo_{city_name.lower()}_jurisdiction_set.png')
            print(f'    Jurisdiction set to: Texas -> {city_name}')

            # Calculate date range - 4 weeks back (matching JS version)
            today = datetime.now()
            start_date = today - timedelta(weeks=4)
            start_str = start_date.strftime('%m/%d/%Y')
            end_str = today.strftime('%m/%d/%Y')
            print(f'    Date range: {start_str} to {end_str} (4 weeks)')

            # Step 5a: Select "Residential" from Designation dropdown
            print('    Selecting Designation: Residential...')
            designation_opened = await page.evaluate('''() => {
                const dropdowns = document.querySelectorAll('.p-dropdown');
                for (const dd of dropdowns) {
                    const label = dd.querySelector('.p-dropdown-label');
                    if (label && (label.textContent?.includes('Select Designation') || label.getAttribute('aria-label')?.includes('Designation'))) {
                        dd.click();
                        return true;
                    }
                }
                return false;
            }''')

            if designation_opened:
                await asyncio.sleep(1)
                await page.keyboard.type('Residential', delay=50)
                await asyncio.sleep(0.5)
                selected = await page.evaluate('''() => {
                    const items = document.querySelectorAll('.p-dropdown-item, li[role="option"]');
                    for (const item of items) {
                        if (item.textContent?.toLowerCase().includes('residential')) {
                            item.click();
                            return item.textContent?.trim();
                        }
                    }
                    return null;
                }''')
                print(f'    Designation: {selected or "NOT SELECTED"}')
            else:
                print('    WARNING: Designation dropdown not found')
            await asyncio.sleep(1)

            # Step 5b: Fill date fields using keyboard input (PrimeNG calendars need actual typing)
            print('    Setting date filters...')

            # Find and fill Created After input
            after_input = await page.query_selector('input[placeholder="Created After"]')
            if after_input:
                await after_input.click()
                await asyncio.sleep(0.3)
                await after_input.click(click_count=3)  # Select all
                await page.keyboard.type(start_str, delay=50)
                await page.keyboard.press('Tab')  # Tab out to confirm
                await asyncio.sleep(0.5)
                print(f'    Created After ({start_str}): typed')
            else:
                print('    Created After: NOT FOUND')

            # Find and fill Created Before input
            before_input = await page.query_selector('input[placeholder="Created Before"]')
            if before_input:
                await before_input.click()
                await asyncio.sleep(0.3)
                await before_input.click(click_count=3)  # Select all
                await page.keyboard.type(end_str, delay=50)
                await page.keyboard.press('Tab')
                await asyncio.sleep(0.5)
                print(f'    Created Before ({end_str}): typed')
            else:
                print('    Created Before: NOT FOUND')

            # Click body to close any open date pickers
            await page.click('body')
            await asyncio.sleep(1)

            # Take screenshot before clicking search
            await page.screenshot(path=f'debug_html/mgo_{city_name.lower()}_before_search.png')

            # Set up API response capture BEFORE clicking search
            api_data = []
            api_calls_seen = []
            all_requests = []

            async def handle_response(response):
                url = response.url
                status = response.status

                # Track all requests for debugging
                if 'mgoconnect' in url and not any(ext in url for ext in ['.js', '.css', '.png', '.svg', '.woff']):
                    all_requests.append(f'{status} {url[:80]}')

                # Log all API calls for debugging
                if '/api/' in url:
                    api_calls_seen.append(url[:100])
                    if 'search' in url.lower() or 'project' in url.lower():
                        print(f'    [DEBUG] API: {url[:120]}')

                # Capture permit search results - try multiple patterns
                if any(pattern in url for pattern in ['/api/v3/cp/project/search', '/project/search', 'search-projects']):
                    if 'chart' not in url:
                        try:
                            data = await response.json()
                            if isinstance(data, dict):
                                # Try multiple keys for data array
                                items = data.get('data', data.get('results', data.get('items', [])))
                                count = len(items) if isinstance(items, list) else 0
                                total = data.get('totalRecords', data.get('total', data.get('count', '?')))
                                print(f'    [API] Captured {count} permits (total: {total}) from {url[:60]}')
                                if count > 0 and isinstance(items, list):
                                    api_data.extend(items)
                            elif isinstance(data, list):
                                print(f'    [API] Got list of {len(data)} items')
                                api_data.extend(data)
                        except Exception as e:
                            print(f'    [API] Error parsing JSON: {e}')

            page.on('response', handle_response)

            # Capture console errors for debugging
            console_errors = []
            page.on('console', lambda msg: console_errors.append(f'{msg.type}: {msg.text}') if msg.type == 'error' else None)

            # Click search button and capture API response
            print('    Clicking search button and capturing API response...')

            # First scroll to TOP to reset, then find and scroll to the Search button
            await page.evaluate('window.scrollTo(0, 0)')
            await asyncio.sleep(0.5)

            # Check ALL Search buttons BEFORE scrolling
            all_buttons_before = await page.evaluate('''() => {
                return Array.from(document.querySelectorAll('button'))
                    .filter(b => {
                        const text = (b.textContent || '').toLowerCase();
                        return text.includes('search') && !text.includes('address');
                    })
                    .map(b => {
                        const r = b.getBoundingClientRect();
                        return {
                            text: b.textContent?.trim(),
                            y: r.y,
                            height: r.height,
                            inViewport: r.y > 0 && r.y < window.innerHeight,
                            className: b.className.substring(0, 50)
                        };
                    });
            }''')
            print(f'    Found {len(all_buttons_before)} Search buttons BEFORE scroll:')
            for i, btn in enumerate(all_buttons_before):
                print(f'      {i}: "{btn["text"]}" y={btn["y"]:.1f} inViewport={btn["inViewport"]}')

            # Scroll to the Search button using block: center
            scroll_result = await page.evaluate('''() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const searchBtn = buttons.find(b => {
                    const text = (b.textContent || '').toLowerCase();
                    return text.includes('search') && !text.includes('address');
                });
                if (searchBtn) {
                    searchBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
                    const newRect = searchBtn.getBoundingClientRect();
                    return { found: true, y: newRect.y, text: searchBtn.textContent?.trim() };
                }
                return { found: false };
            }''')
            print(f'    Scroll result: {scroll_result}')
            await asyncio.sleep(1.0)

            # Check button position AFTER scrolling
            all_buttons_after = await page.evaluate('''() => {
                return Array.from(document.querySelectorAll('button'))
                    .filter(b => {
                        const text = (b.textContent || '').toLowerCase();
                        return text.includes('search') && !text.includes('address');
                    })
                    .map(b => {
                        const r = b.getBoundingClientRect();
                        return {
                            text: b.textContent?.trim(),
                            y: r.y,
                            height: r.height,
                            inViewport: r.y > 0 && r.y < window.innerHeight
                        };
                    });
            }''')
            print(f'    Search buttons AFTER scroll:')
            for i, btn in enumerate(all_buttons_after):
                print(f'      {i}: "{btn["text"]}" y={btn["y"]:.1f} inViewport={btn["inViewport"]}')

            # Define the click action - button should already be scrolled into view
            async def click_search():
                # Method 1: Use Playwright locator (button is already scrolled to center)
                try:
                    btn = page.locator('button:has-text("Search")').first
                    if await btn.is_visible():
                        await btn.click(timeout=5000)
                        return 'locator_click'
                except Exception as e:
                    print(f'      Locator click failed: {e}')

                # Method 2: Get button position and mouse.click
                box = await page.evaluate('''() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const searchBtn = buttons.find(b => {
                        const text = (b.textContent || '').toLowerCase();
                        return text.includes('search') && !text.includes('address');
                    });
                    if (searchBtn) {
                        const rect = searchBtn.getBoundingClientRect();
                        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
                    }
                    return null;
                }''')
                if box and box['y'] > 0:
                    print(f'      Clicking button at ({box["x"]:.1f}, {box["y"]:.1f})')
                    await page.mouse.click(box['x'], box['y'])
                    return 'mouse_click'

                # Method 3: Full pointer event sequence (PrimeNG uses PointerEvents)
                result = await page.evaluate('''() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const searchBtn = buttons.find(b => {
                        const text = (b.textContent || '').toLowerCase();
                        return text.includes('search') && !text.includes('address');
                    });
                    if (!searchBtn) return 'not_found';

                    const rect = searchBtn.getBoundingClientRect();
                    const x = rect.x + rect.width / 2;
                    const y = rect.y + rect.height / 2;

                    // Full event sequence like a real user click
                    const eventInit = {
                        view: window,
                        bubbles: true,
                        cancelable: true,
                        clientX: x,
                        clientY: y,
                        screenX: x,
                        screenY: y,
                        button: 0,
                        buttons: 1,
                        pointerId: 1,
                        pointerType: 'mouse',
                        isPrimary: true
                    };

                    // Dispatch full event sequence
                    searchBtn.dispatchEvent(new PointerEvent('pointerdown', eventInit));
                    searchBtn.dispatchEvent(new MouseEvent('mousedown', eventInit));
                    searchBtn.dispatchEvent(new PointerEvent('pointerup', eventInit));
                    searchBtn.dispatchEvent(new MouseEvent('mouseup', eventInit));
                    searchBtn.dispatchEvent(new MouseEvent('click', eventInit));

                    return 'full_event_sequence';
                }''')
                return result

            # Wait for API response while clicking
            try:
                async with page.expect_response(
                    lambda r: '/api/v3/cp/project/search-projects' in r.url and 'chart' not in r.url and r.status == 200,
                    timeout=30000
                ) as response_info:
                    await click_search()
                    print('    Search clicked, waiting for API response...')

                response = await response_info.value
                print(f'    Got API response: {response.url[:80]}')

                # Parse the response
                try:
                    data = await response.json()
                    if isinstance(data, dict):
                        items = data.get('data', [])
                        total = data.get('totalRecords', len(items))
                        print(f'    [API] *** GOT {len(items)} PERMITS *** (total: {total})')
                        if items:
                            api_data.extend(items)
                            # Show sample
                            sample = items[0]
                            print(f'    [API] Sample: {sample.get("projectNumber", "?")} | {sample.get("workType", "?")} | {sample.get("projectAddress", "?")}')
                    elif isinstance(data, list):
                        print(f'    [API] Got list of {len(data)} items')
                        api_data.extend(data)
                except Exception as e:
                    print(f'    [API] Error parsing response: {e}')

            except PlaywrightTimeout:
                print('    No API response within 30s timeout')
                # Check for console errors
                if console_errors:
                    print(f'    Console errors: {len(console_errors)}')
                    for err in console_errors[:5]:
                        print(f'      {err[:150]}')
            except Exception as e:
                print(f'    Error waiting for response: {e}')

            await asyncio.sleep(3)

            await page.screenshot(path=f'debug_html/mgo_{city_name.lower()}_results.png', full_page=True)

            # Debug: show all requests seen
            print(f'    [DEBUG] All requests: {len(all_requests)}')
            for req in all_requests[-15:]:
                print(f'      - {req}')
            print(f'    [DEBUG] API calls: {len(api_calls_seen)}')

            # Step 5: Extract permits
            print('\n[5] Extracting permits...')
            print(f'    API data captured: {len(api_data)}')

            # First try table extraction
            table_data = await page.evaluate('''() => {
                const results = [];
                const table = document.querySelector('p-table table, table.p-datatable-table, .p-datatable table');
                if (table) {
                    const rows = table.querySelectorAll('tbody tr');
                    for (const row of rows) {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 4) {
                            results.push({
                                permit_id: cells[0]?.textContent?.trim() || '',
                                project_name: cells[1]?.textContent?.trim() || '',
                                type: cells[2]?.textContent?.trim() || '',
                                status: cells[3]?.textContent?.trim() || '',
                                address: cells[4]?.textContent?.trim() || ''
                            });
                        }
                    }
                }
                return results;
            }''')

            print(f'    Table extraction: {len(table_data)} rows')

            # Try pagination to get more results
            page_num = 1
            while len(api_data) < target_count and page_num < 10:
                # Check if there's a next page button
                has_next = await page.evaluate('''() => {
                    const nextBtns = document.querySelectorAll('.p-paginator-next, button[aria-label="Next Page"]');
                    for (const btn of nextBtns) {
                        if (!btn.disabled && !btn.classList.contains('p-disabled')) {
                            btn.click();
                            return true;
                        }
                    }
                    return false;
                }''')

                if not has_next:
                    break

                page_num += 1
                print(f'    Loading page {page_num}...')
                await asyncio.sleep(5)  # Wait for next page to load

            if page_num > 1:
                print(f'    Loaded {page_num} pages, total API data: {len(api_data)}')

            # Use API data if available
            raw_permits = []
            if api_data:
                print(f'    Using {len(api_data)} permits from API response')
                for item in api_data:
                    permit = {
                        'permit_id': item.get('projectNumber') or item.get('projectID', ''),
                        'address': item.get('projectAddress', ''),
                        'type': item.get('workType', ''),
                        'designation': item.get('designation', ''),
                        'status': item.get('projectStatus', ''),
                        'date': item.get('dateCreated', ''),
                        'description': item.get('projectDescription') or item.get('projectName', ''),
                        'contractor': item.get('contractorName', '')
                    }
                    if permit['permit_id'] or permit['address']:
                        raw_permits.append(permit)
            elif table_data:
                for item in table_data:
                    if item.get('permit_id'):
                        raw_permits.append({
                            'permit_id': item['permit_id'],
                            'address': item.get('address', ''),
                            'type': item.get('type', ''),
                            'status': item.get('status', ''),
                            'description': item.get('project_name', ''),
                            'contractor': ''
                        })

            # Filter out garbage permit types
            valid_permits, filter_stats = filter_permits(raw_permits)

            if filter_stats['total_rejected'] > 0:
                print(f'    Filtered out {filter_stats["total_rejected"]}: '
                      f'{filter_stats["bad_type"]} bad type, '
                      f'{filter_stats["empty"]} empty')

            permits = valid_permits[:target_count]
            print(f'\n    Total permits after filtering: {len(permits)}')

        except Exception as e:
            print(f'\nFATAL ERROR: {e}')
            errors.append({'step': 'main', 'error': str(e)})
            await page.screenshot(path=f'debug_html/mgo_{city_name.lower()}_error.png', full_page=True)

        finally:
            await browser.close()

    # Save results
    output = {
        'source': city_name.lower(),
        'portal_type': 'MGO_Connect',
        'jid': MGO_CITIES.get(city_name),
        'scraped_at': datetime.now().isoformat(),
        'target_count': target_count,
        'actual_count': len(permits),
        'with_contractor': len([p for p in permits if p.get('contractor')]),
        'errors': errors,
        'permits': permits[:target_count]
    }

    output_file = f'{city_name.lower()}_raw.json'
    Path(output_file).write_text(json.dumps(output, indent=2))

    print('\n' + '=' * 50)
    print('SUMMARY')
    print('=' * 50)
    print(f'City: {city_name}')
    print(f'Permits scraped: {output["actual_count"]}')
    print(f'With contractor: {output["with_contractor"]}')
    print(f'Errors: {len(errors)}')
    print(f'Output: {output_file}')

    if errors:
        print('\nERRORS:')
        for e in errors:
            print(f'  - {e["step"]}: {e["error"]}')

    if permits:
        print('\nSAMPLE PERMITS:')
        for p in permits[:5]:
            print(f'  {p["permit_id"]} | {p.get("type", "unknown")} | {p.get("address", "no address")}')

    return output


if __name__ == '__main__':
    city_arg = sys.argv[1] if len(sys.argv) > 1 else 'Irving'
    count_arg = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    asyncio.run(scrape(city_arg, count_arg))
