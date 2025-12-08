#!/usr/bin/env python3
"""
MAGNETGOV PERMIT SCRAPER (Playwright Python)
Portal: MagnetGov 24/7 Government Portal
Covers: Mesquite TX (and other MagnetGov cities)

Usage:
  python scrapers/magnetgov.py mesquite 50
"""

import asyncio
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import httpx
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

# City configurations
MAGNETGOV_CITIES = {
    'mesquite': {
        'name': 'Mesquite',
        'state': 'TX',
        'base_url': 'https://mesquite.onlinegovt.com',
        'case_status_path': '/case_status/',
    },
    # Add other MagnetGov cities here as discovered
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


async def scrape(city_key: str, target_count: int = 50):
    """Scrape permits from MagnetGov portal for a given city."""
    city_key = city_key.lower().replace(' ', '_')

    if city_key not in MAGNETGOV_CITIES:
        print(f'ERROR: Unknown city "{city_key}". Available: {", ".join(MAGNETGOV_CITIES.keys())}')
        sys.exit(1)

    city_config = MAGNETGOV_CITIES[city_key]
    city_name = city_config['name']
    base_url = city_config['base_url']
    case_status_path = city_config['case_status_path']

    print('=' * 50)
    print(f'{city_name.upper()} PERMIT SCRAPER (MagnetGov)')
    print('=' * 50)
    print(f'Target: {target_count} permits')
    print(f'Time: {datetime.now().isoformat()}\n')

    if not DEEPSEEK_API_KEY:
        print('ERROR: DEEPSEEK_API_KEY not set')
        sys.exit(1)

    permits = []
    errors = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1280, 'height': 900})
        page = await context.new_page()

        try:
            # Step 1: Load case status page
            print('[1] Loading MagnetGov case status page...')
            await page.goto(f'{base_url}{case_status_path}', wait_until='load', timeout=60000)
            await asyncio.sleep(3)

            Path('debug_html').mkdir(exist_ok=True)
            await page.screenshot(path=f'debug_html/{city_key}_magnetgov_p1.png')
            print('    OK - Page loaded')

            # Step 2: Click Permits tab
            print('[2] Switching to Permits tab...')
            await page.click('a[href="#tabs-1"]', timeout=5000)
            await asyncio.sleep(2)
            print('    OK - Permits tab active')

            # Step 3: Set search criteria and submit
            print('[3] Setting search criteria (Status: Issued)...')
            await page.evaluate('''() => {
                const permitsTab = document.getElementById('tabs-1');
                if (permitsTab) {
                    const statusSelect = permitsTab.querySelector('select[name="status"]');
                    if (statusSelect) statusSelect.value = 'Issued';
                }
            }''')
            await asyncio.sleep(1)

            # Click search button in permits tab
            await page.evaluate('''() => {
                const permitsTab = document.getElementById('tabs-1');
                if (permitsTab) {
                    const btns = permitsTab.querySelectorAll('input[type="button"]');
                    for (const btn of btns) {
                        if (btn.value === 'Search') {
                            btn.click();
                            return;
                        }
                    }
                }
            }''')
            await asyncio.sleep(5)

            await page.screenshot(path=f'debug_html/{city_key}_magnetgov_results.png')
            print('    OK - Search submitted')

            # Step 4: Extract permits from results table
            print('[4] Extracting permit data...')

            # Get table data via JavaScript (more reliable than DeepSeek for structured tables)
            table_data = await page.evaluate('''() => {
                const permitsTab = document.getElementById('tabs-1');
                if (!permitsTab) return {error: 'tabs-1 not found'};

                // Find all rows in the visible table
                const rows = permitsTab.querySelectorAll('table tbody tr');
                const data = [];

                for (const row of rows) {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 5) {
                        data.push({
                            address: cells[0]?.textContent?.trim() || '',
                            apn: cells[1]?.textContent?.trim() || '',
                            owner_name: cells[2]?.textContent?.trim() || '',
                            permit_number: cells[3]?.textContent?.trim() || '',
                            permit_date: cells[4]?.textContent?.trim() || '',
                            lot_number: cells[5]?.textContent?.trim() || '',
                            contractor: cells[6]?.textContent?.trim() || '',
                        });
                    }
                }

                // Get total count from paging info
                const pagingInfo = permitsTab.querySelector('.dataTables_info');
                const totalMatch = pagingInfo?.textContent?.match(/of ([\d,]+) entries/);
                const total = totalMatch ? parseInt(totalMatch[1].replace(',', '')) : data.length;

                return {permits: data, total};
            }''')

            if table_data.get('permits'):
                permits = table_data['permits']
                total_available = table_data.get('total', len(permits))
                print(f'    OK - Got {len(permits)} permits (total available: {total_available})')
            else:
                print(f'    WARN - No permits extracted: {table_data}')
                errors.append({'step': 'extract', 'error': str(table_data)})

            # Step 5: Paginate if needed
            if len(permits) < target_count and len(permits) > 0:
                print(f'[5] Paginating to get more permits...')
                page_num = 2

                while len(permits) < target_count:
                    # Click next page
                    has_next = await page.evaluate('''() => {
                        const permitsTab = document.getElementById('tabs-1');
                        const nextBtn = permitsTab?.querySelector('.paginate_button.next:not(.disabled)');
                        if (nextBtn) {
                            nextBtn.click();
                            return true;
                        }
                        return false;
                    }''')

                    if not has_next:
                        print(f'    No more pages')
                        break

                    await asyncio.sleep(3)

                    # Extract this page
                    page_data = await page.evaluate('''() => {
                        const permitsTab = document.getElementById('tabs-1');
                        const rows = permitsTab?.querySelectorAll('table tbody tr') || [];
                        const data = [];
                        for (const row of rows) {
                            const cells = row.querySelectorAll('td');
                            if (cells.length >= 5) {
                                data.push({
                                    address: cells[0]?.textContent?.trim() || '',
                                    apn: cells[1]?.textContent?.trim() || '',
                                    owner_name: cells[2]?.textContent?.trim() || '',
                                    permit_number: cells[3]?.textContent?.trim() || '',
                                    permit_date: cells[4]?.textContent?.trim() || '',
                                    lot_number: cells[5]?.textContent?.trim() || '',
                                    contractor: cells[6]?.textContent?.trim() || '',
                                });
                            }
                        }
                        return data;
                    }''')

                    if page_data:
                        permits.extend(page_data)
                        print(f'    Page {page_num}: +{len(page_data)} permits ({len(permits)} total)')

                    page_num += 1
                    if page_num > 20:  # Safety limit
                        break

        except Exception as e:
            print(f'\nFATAL ERROR: {e}')
            errors.append({'step': 'main', 'error': str(e)})
            await page.screenshot(path=f'debug_html/{city_key}_magnetgov_error.png')

        finally:
            await browser.close()

    # Save results
    output = {
        'source': city_key,
        'portal_type': 'MagnetGov',
        'scraped_at': datetime.now().isoformat(),
        'target_count': target_count,
        'actual_count': len(permits),
        'with_contractor': len([p for p in permits if p.get('contractor')]),
        'errors': errors,
        'permits': permits[:target_count]
    }

    output_file = f'{city_key}_raw.json'
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
            addr = p.get('address', 'no address')[:40]
            pnum = p.get('permit_number', 'no number')
            print(f'  {pnum} | {addr}')

    return output


if __name__ == '__main__':
    city_arg = sys.argv[1] if len(sys.argv) > 1 else 'mesquite'
    count_arg = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    asyncio.run(scrape(city_arg, count_arg))
