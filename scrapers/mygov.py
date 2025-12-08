#!/usr/bin/env python3
"""
MYGOV PERMIT SCRAPER (Playwright Python)
Portal: MyGov (public.mygov.us / web.mygov.us)
Covers: Rowlett, Grapevine, Lancaster, Watauga (DFW cities)

Usage:
  python scrapers/mygov.py Rowlett 50
  python scrapers/mygov.py Grapevine 25
  python scrapers/mygov.py Lancaster 50
"""

import asyncio
import json
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

import httpx
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

# City configurations
# URL format varies by city
MYGOV_CITIES = {
    # web.mygov.us format
    'Rowlett': {
        'base_url': 'https://web.mygov.us',
        'login_url': 'https://web.mygov.us/authentication/login/',
        'search_url': 'https://web.mygov.us/permits/search/',
        'requires_login': False,
        'state': 'TX'
    },
    # public.mygov.us format
    'Grapevine': {
        'base_url': 'https://public.mygov.us',
        'login_url': 'https://public.mygov.us/authentication/login/',
        'search_url': 'https://public.mygov.us/grapevine_tx/permits/search/',
        'requires_login': False,
        'state': 'TX'
    },
    'Lancaster': {
        'base_url': 'https://public.mygov.us',
        'login_url': 'https://public.mygov.us/authentication/login/',
        'search_url': 'https://public.mygov.us/lancaster_tx/permits/search/',
        'requires_login': False,
        'state': 'TX'
    },
    'Watauga': {
        'base_url': 'https://public.mygov.us',
        'login_url': 'https://public.mygov.us/authentication/login/',
        'search_url': 'https://public.mygov.us/watauga_tx/permits/search/',
        'requires_login': False,
        'state': 'TX'
    },
}

DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')


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

    match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text) or re.search(r'(\{[\s\S]*\})', text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    return None


async def find_permit_search(page, city_config: dict) -> bool:
    """Navigate to permit search page."""
    # First try direct URL
    search_url = city_config.get('search_url')
    if search_url:
        print(f'    Trying direct URL: {search_url}')
        try:
            await page.goto(search_url, wait_until='load', timeout=30000)
            await asyncio.sleep(3)

            # Check if we landed on a search page
            content = await page.content()
            if 'search' in content.lower() or 'permit' in content.lower():
                print(f'    Found search page at: {page.url}')
                return True
        except Exception as e:
            print(f'    Direct URL failed: {e}')

    # Try to find permit search link on main page
    print('    Looking for permit search link...')
    base_url = city_config.get('base_url')
    await page.goto(base_url, wait_until='load', timeout=30000)
    await asyncio.sleep(3)

    # Look for permit-related links
    permit_link = await page.evaluate('''() => {
        const links = document.querySelectorAll('a');
        for (const link of links) {
            const text = (link.textContent || '').toLowerCase();
            const href = link.href || '';
            if (text.includes('permit') && (text.includes('search') || text.includes('find') || text.includes('lookup'))) {
                return { href: link.href, text: link.textContent };
            }
        }
        // Second pass - just look for "permits"
        for (const link of links) {
            const text = (link.textContent || '').toLowerCase();
            if (text.includes('permit') && !text.includes('apply')) {
                return { href: link.href, text: link.textContent };
            }
        }
        return null;
    }''')

    if permit_link:
        print(f'    Found link: {permit_link["text"]} -> {permit_link["href"]}')
        await page.goto(permit_link['href'], wait_until='load', timeout=30000)
        await asyncio.sleep(3)
        return True

    return False


async def extract_permits_from_page(page) -> list[dict]:
    """Extract permits from current page."""
    permits = []

    # Try table extraction first
    table_data = await page.evaluate('''() => {
        const results = [];

        // Look for data tables
        const tables = document.querySelectorAll('table, .data-table, .permit-list');
        for (const table of tables) {
            const rows = table.querySelectorAll('tr, .row, .permit-row');
            for (const row of rows) {
                const cells = row.querySelectorAll('td, .cell, .field');
                if (cells.length >= 3) {
                    results.push({
                        permit_id: cells[0]?.textContent?.trim() || '',
                        type: cells[1]?.textContent?.trim() || '',
                        address: cells[2]?.textContent?.trim() || '',
                        status: cells[3]?.textContent?.trim() || '',
                        date: cells[4]?.textContent?.trim() || ''
                    });
                }
            }
        }

        // Also try card/list view
        const cards = document.querySelectorAll('.permit-card, .permit-item, [data-permit]');
        for (const card of cards) {
            const permitId = card.querySelector('.permit-number, .permit-id, [data-permit-id]')?.textContent?.trim();
            const address = card.querySelector('.address, .property-address')?.textContent?.trim();
            const type = card.querySelector('.permit-type, .type')?.textContent?.trim();
            const status = card.querySelector('.status, .permit-status')?.textContent?.trim();

            if (permitId || address) {
                results.push({
                    permit_id: permitId || '',
                    address: address || '',
                    type: type || '',
                    status: status || ''
                });
            }
        }

        return results;
    }''')

    if table_data:
        permits.extend([p for p in table_data if p.get('permit_id') or p.get('address')])

    return permits


async def scrape(city_name: str, target_count: int = 50):
    """Scrape permits from MyGov for a given city."""
    print('=' * 50)
    print(f'MYGOV SCRAPER - {city_name.upper()}')
    print('=' * 50)
    print(f'Target: {target_count} permits')
    print(f'Time: {datetime.now().isoformat()}\n')

    # Validate inputs
    if not DEEPSEEK_API_KEY:
        print('ERROR: DEEPSEEK_API_KEY not set')
        sys.exit(1)

    city_config = MYGOV_CITIES.get(city_name)
    if city_config is None:
        print(f'ERROR: Unknown city "{city_name}". Available: {", ".join(MYGOV_CITIES.keys())}')
        sys.exit(1)

    permits = []
    errors = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 900},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        page = await context.new_page()

        try:
            # Step 1: Navigate to permit search
            print('\n[1] Finding permit search page...')
            found_search = await find_permit_search(page, city_config)

            if not found_search:
                print('    Could not find permit search page')
                # Try alternative URLs
                alternative_urls = [
                    f"{city_config['base_url']}/permits/",
                    f"{city_config['base_url']}/{city_name.lower()}_tx/permits/",
                    f"{city_config['base_url']}/permit-search/",
                ]
                for alt_url in alternative_urls:
                    print(f'    Trying: {alt_url}')
                    try:
                        await page.goto(alt_url, wait_until='load', timeout=15000)
                        await asyncio.sleep(2)
                        if 'permit' in (await page.content()).lower():
                            found_search = True
                            print(f'    Found at: {page.url}')
                            break
                    except:
                        continue

            # Take screenshot of current page
            Path('debug_html').mkdir(exist_ok=True)
            await page.screenshot(path=f'debug_html/mygov_{city_name.lower()}_search.png', full_page=True)
            print(f'    Current URL: {page.url}')

            # Step 2: Fill search criteria
            print('\n[2] Filling search criteria...')

            # Calculate date range - 12 weeks back
            today = datetime.now()
            start_date = today - timedelta(weeks=12)
            start_str = start_date.strftime('%m/%d/%Y')
            end_str = today.strftime('%m/%d/%Y')
            print(f'    Date range: {start_str} to {end_str}')

            # Try to find and fill date fields
            date_filled = False
            date_selectors = [
                'input[name*="date"]',
                'input[type="date"]',
                'input[placeholder*="date"]',
                '#start_date, #end_date',
                'input[name*="from"], input[name*="to"]'
            ]

            for selector in date_selectors:
                try:
                    inputs = await page.query_selector_all(selector)
                    if len(inputs) >= 2:
                        await inputs[0].fill(start_str)
                        await inputs[1].fill(end_str)
                        date_filled = True
                        print(f'    Filled date fields using: {selector}')
                        break
                    elif len(inputs) == 1:
                        await inputs[0].fill(start_str)
                        date_filled = True
                except:
                    continue

            # Try to select permit type if dropdown exists
            type_selected = await page.evaluate('''() => {
                const selects = document.querySelectorAll('select');
                for (const select of selects) {
                    const name = (select.name || select.id || '').toLowerCase();
                    if (name.includes('type') || name.includes('category')) {
                        // Look for residential option
                        for (const opt of select.options) {
                            if (opt.text.toLowerCase().includes('residential') || opt.text.toLowerCase().includes('all')) {
                                select.value = opt.value;
                                return { selected: true, value: opt.text };
                            }
                        }
                    }
                }
                return { selected: false };
            }''')

            if type_selected.get('selected'):
                print(f'    Selected type: {type_selected["value"]}')

            # Set up API response capture
            api_permits = []

            async def handle_response(response):
                if 'permit' in response.url.lower() and response.status == 200:
                    try:
                        content_type = response.headers.get('content-type', '')
                        if 'json' in content_type:
                            data = await response.json()
                            if isinstance(data, list):
                                api_permits.extend(data)
                                print(f'    [API] Captured {len(data)} permits')
                            elif isinstance(data, dict) and 'data' in data:
                                api_permits.extend(data['data'])
                                print(f'    [API] Captured {len(data["data"])} permits')
                            elif isinstance(data, dict) and 'permits' in data:
                                api_permits.extend(data['permits'])
                                print(f'    [API] Captured {len(data["permits"])} permits')
                    except:
                        pass

            page.on('response', handle_response)

            # Step 3: Submit search
            print('\n[3] Submitting search...')

            # Click search button
            search_clicked = await page.evaluate('''() => {
                const buttons = document.querySelectorAll('button, input[type="submit"], a.btn');
                for (const btn of buttons) {
                    const text = (btn.textContent || btn.value || '').toLowerCase();
                    if (text.includes('search') || text.includes('find') || text.includes('submit')) {
                        btn.click();
                        return { clicked: true, text: btn.textContent || btn.value };
                    }
                }
                // Try form submit
                const forms = document.querySelectorAll('form');
                for (const form of forms) {
                    if (form.action && form.action.includes('permit')) {
                        form.submit();
                        return { clicked: true, text: 'form submit' };
                    }
                }
                return { clicked: false };
            }''')

            if search_clicked.get('clicked'):
                print(f'    Clicked: {search_clicked["text"]}')
            else:
                print('    No search button found, trying Enter key...')
                await page.keyboard.press('Enter')

            await asyncio.sleep(10)  # Wait for results

            await page.screenshot(path=f'debug_html/mygov_{city_name.lower()}_results.png', full_page=True)

            # Step 4: Extract permits
            print('\n[4] Extracting permits...')

            # Use API data if captured
            if api_permits:
                print(f'    Using {len(api_permits)} permits from API')
                for item in api_permits[:target_count]:
                    permit = {
                        'permit_id': item.get('permit_number') or item.get('permitNumber') or item.get('id', ''),
                        'address': item.get('address') or item.get('property_address', ''),
                        'type': item.get('permit_type') or item.get('type', ''),
                        'status': item.get('status', ''),
                        'date': item.get('issue_date') or item.get('date', ''),
                        'contractor': item.get('contractor_name') or item.get('contractor', '')
                    }
                    if permit['permit_id'] or permit['address']:
                        permits.append(permit)
            else:
                # Fall back to HTML extraction
                page_permits = await extract_permits_from_page(page)
                print(f'    HTML extraction: {len(page_permits)} permits')
                permits.extend(page_permits[:target_count])

            # Try pagination
            page_num = 1
            while len(permits) < target_count and page_num < 10:
                has_next = await page.evaluate('''() => {
                    const nextBtns = document.querySelectorAll('a.next, .pagination .next, [rel="next"], .next-page, [aria-label="Next"]');
                    for (const btn of nextBtns) {
                        if (!btn.disabled && btn.offsetParent !== null) {
                            btn.click();
                            return true;
                        }
                    }
                    // Also try finding buttons with "Next" text
                    const buttons = document.querySelectorAll('button, a');
                    for (const btn of buttons) {
                        if (btn.textContent && btn.textContent.trim().toLowerCase() === 'next') {
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
                await asyncio.sleep(5)

                more_permits = await extract_permits_from_page(page)
                permits.extend(more_permits)

            print(f'\n    Total permits extracted: {len(permits)}')

        except Exception as e:
            print(f'\nFATAL ERROR: {e}')
            import traceback
            traceback.print_exc()
            errors.append({'step': 'main', 'error': str(e)})
            await page.screenshot(path=f'debug_html/mygov_{city_name.lower()}_error.png', full_page=True)

        finally:
            await browser.close()

    # Save results
    output = {
        'source': city_name.lower(),
        'portal_type': 'MyGov',
        'config': {k: v for k, v in city_config.items() if k != 'password'},
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
            print(f'  {p.get("permit_id", "N/A")} | {p.get("type", "unknown")} | {p.get("address", "no address")}')

    return output


if __name__ == '__main__':
    city_arg = sys.argv[1] if len(sys.argv) > 1 else 'Rowlett'
    count_arg = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    asyncio.run(scrape(city_arg, count_arg))
