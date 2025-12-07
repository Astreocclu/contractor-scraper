#!/usr/bin/env python3
"""
MGO CONNECT PERMIT SCRAPER (Playwright Python)
Portal: My Government Online (MGO Connect)
Covers: Irving, Lewisville, Denton, Cedar Hill, and more DFW cities

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
MGO_CITIES = {
    'Irving': 245,
    'Lewisville': 325,
    'Duncanville': 0,
    'Celina': 0,
    'Lucas': 0,
    'PilotPoint': 0,
    'Pilot Point': 0,
    'VanAlstyne': 0,
    'Van Alstyne': 0,
    'Georgetown': 0,
    'Temple': 0,
    'Killeen': 0,
    'SanMarcos': 0,
    'San Marcos': 0,
    'Amarillo': 0,
    'WichitaFalls': 0,
    'Wichita Falls': 0,
}

DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')
MGO_EMAIL = os.getenv('MGO_EMAIL')
MGO_PASSWORD = os.getenv('MGO_PASSWORD')


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

            # Calculate date range - 4 weeks back
            today = datetime.now()
            start_date = today - timedelta(weeks=4)
            start_str = start_date.strftime('%m/%d/%Y')
            end_str = today.strftime('%m/%d/%Y')
            print(f'    Date range: {start_str} to {end_str} (4 weeks)')

            # Select Designation: Residential
            print('    Selecting Designation: Residential...')
            await page.evaluate('''() => {
                const dropdowns = document.querySelectorAll('.p-dropdown');
                for (const dd of dropdowns) {
                    const label = dd.querySelector('.p-dropdown-label');
                    if (label && (label.textContent?.includes('Select Designation') || label.getAttribute('aria-label')?.includes('Designation'))) {
                        dd.click();
                        return { opened: true };
                    }
                }
                return { opened: false };
            }''')
            await asyncio.sleep(1)
            await page.keyboard.type('Residential', delay=50)
            await asyncio.sleep(0.5)
            await page.evaluate('''() => {
                const items = document.querySelectorAll('.p-dropdown-item, li[role="option"]');
                for (const item of items) {
                    if (item.textContent?.toLowerCase().includes('residential')) {
                        item.click();
                        return true;
                    }
                }
                return false;
            }''')
            await asyncio.sleep(1)

            # Fill date fields
            print('    Setting date filters...')
            after_input = await page.query_selector('input[placeholder="Created After"]')
            if after_input:
                await after_input.click()
                await asyncio.sleep(0.3)
                await after_input.click(click_count=3)  # Select all
                await page.keyboard.type(start_str, delay=50)
                await page.keyboard.press('Tab')
                print(f'    Created After ({start_str}): typed')

            before_input = await page.query_selector('input[placeholder="Created Before"]')
            if before_input:
                await before_input.click()
                await asyncio.sleep(0.3)
                await before_input.click(click_count=3)
                await page.keyboard.type(end_str, delay=50)
                await page.keyboard.press('Tab')
                print(f'    Created Before ({end_str}): typed')

            await asyncio.sleep(1)

            # Set up API response capture
            api_data = []

            async def handle_response(response):
                if '/api/v3/cp/project/search-projects' in response.url and 'chart' not in response.url:
                    try:
                        data = await response.json()
                        if isinstance(data, dict) and 'data' in data:
                            api_data.extend(data['data'])
                            print(f'    [API] Captured {len(data["data"])} permits')
                    except Exception:
                        pass

            page.on('response', handle_response)

            # Click search
            print('    Clicking search...')
            await page.evaluate('''() => {
                const buttons = document.querySelectorAll('button, input[type="submit"]');
                for (const btn of buttons) {
                    const text = (btn.textContent || btn.value || '').toLowerCase();
                    if (text.includes('search') || text.includes('find') || text.includes('submit')) {
                        btn.click();
                        return;
                    }
                }
            }''')

            await asyncio.sleep(5)

            await page.screenshot(path=f'debug_html/mgo_{city_name.lower()}_results.png', full_page=True)

            # Step 5: Extract permits
            print('\n[5] Extracting permits...')

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

            # Use API data if available
            if api_data:
                print(f'    Using {len(api_data)} permits from API response')
                for item in api_data[:target_count]:
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
                        permits.append(permit)
            elif table_data:
                for item in table_data[:target_count]:
                    if item.get('permit_id'):
                        permits.append({
                            'permit_id': item['permit_id'],
                            'address': item.get('address', ''),
                            'type': item.get('type', ''),
                            'status': item.get('status', ''),
                            'description': item.get('project_name', ''),
                            'contractor': ''
                        })

            print(f'\n    Total permits extracted: {len(permits)}')

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
