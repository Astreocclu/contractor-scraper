#!/usr/bin/env python3
"""
ACCELA PERMIT SCRAPER (Playwright Python)
Portal: Accela Citizen Access
Covers: Fort Worth, Dallas, Richardson

Usage:
  python scrapers/accela.py fort_worth 50
  python scrapers/accela.py dallas 25
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
ACCELA_CITIES = {
    'fort_worth': {
        'name': 'Fort Worth',
        'base_url': 'https://aca-prod.accela.com/CFW',
        'module': 'Building',
    },
    'dallas': {
        'name': 'Dallas',
        'base_url': 'https://aca-prod.accela.com/DALLASTX',
        'module': 'Building',
    },
    'richardson': {
        'name': 'Richardson',
        'base_url': 'https://aca-prod.accela.com/RICHARDSON',
        'module': 'Building',
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


def clean_html(html: str) -> str:
    """Remove scripts, styles, and normalize whitespace."""
    html = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'<!--[\s\S]*?-->', '', html)
    html = re.sub(r'<svg[^>]*>[\s\S]*?</svg>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'\s+', ' ', html)
    return html


async def scrape(city_key: str, target_count: int = 50):
    """Scrape permits from Accela portal for a given city."""
    city_key = city_key.lower().replace(' ', '_')

    if city_key not in ACCELA_CITIES:
        print(f'ERROR: Unknown city "{city_key}". Available: {", ".join(ACCELA_CITIES.keys())}')
        sys.exit(1)

    city_config = ACCELA_CITIES[city_key]
    city_name = city_config['name']
    base_url = city_config['base_url']
    module = city_config['module']

    print('=' * 50)
    print(f'{city_name.upper()} PERMIT SCRAPER (Accela)')
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
            # Step 1: Load search page
            print('[1] Loading Accela portal...')
            search_url = f'{base_url}/Cap/CapHome.aspx?module={module}&TabName={module}'
            await page.goto(search_url, wait_until='networkidle', timeout=60000)
            await asyncio.sleep(3)

            Path('debug_html').mkdir(exist_ok=True)
            await page.screenshot(path=f'debug_html/{city_key}_p1.png')
            print(f'    OK - Page loaded: {page.url}')

            # Check if page loaded correctly
            if '404' in await page.title() or 'cannot be found' in await page.content():
                print('    ERROR - Page returned 404')
                errors.append({'step': 'load', 'error': 'Page 404'})
                raise Exception('Page 404')

            # Step 2: Click search button
            print('[2] Submitting search...')
            search_selectors = [
                '#ctl00_PlaceHolderMain_btnNewSearch',
                'input[value*="Search"]',
                'button:has-text("Search")',
                '#ctl00_PlaceHolderMain_generalSearchForm_btnSearch',
            ]

            clicked = False
            for selector in search_selectors:
                try:
                    await page.click(selector, timeout=3000)
                    clicked = True
                    print(f'    OK - Clicked search: {selector}')
                    break
                except PlaywrightTimeout:
                    continue

            if not clicked:
                # Try clicking any button with "Search" text
                await page.evaluate('''() => {
                    const inputs = document.querySelectorAll('input[type="submit"], input[type="button"], button');
                    for (const inp of inputs) {
                        if ((inp.value || inp.textContent || '').toLowerCase().includes('search')) {
                            inp.click();
                            return true;
                        }
                    }
                    return false;
                }''')
                print('    Clicked search via JS')

            await asyncio.sleep(5)
            await page.screenshot(path=f'debug_html/{city_key}_results.png')

            # Step 3: Extract permits from search results
            page_num = 1
            while len(permits) < target_count:
                print(f'\n[3.{page_num}] Extracting page {page_num}...')

                html = clean_html(await page.content())
                Path(f'debug_html/{city_key}_p{page_num}.html').write_text(await page.content())

                extract_prompt = f'''Extract ALL permit records from this {city_name} Accela search results page.

Look for a table or grid of permit records. For each permit, extract:
- permit_id: The permit/record number (e.g., "BLD-2024-12345")
- address: Property address
- type: Permit type (Building, Electrical, Plumbing, etc.)
- status: Status (Issued, Active, Complete, etc.)
- date: Date (application date, issue date, or finalized date)
- description: Project description
- contractor: Contractor name if visible

Return JSON:
{{"permits": [{{"permit_id": "...", "address": "...", "type": "...", "status": "...", "date": "...", "description": "...", "contractor": "..."}}], "has_next_page": true/false, "total_rows": <number or null>}}

HTML:
{html[:120000]}'''

                response = await call_deepseek(extract_prompt)
                data = parse_json(response)

                if data and data.get('permits'):
                    valid_permits = [p for p in data['permits'] if p.get('permit_id')]
                    permits.extend(valid_permits)
                    print(f'    OK - Got {len(valid_permits)} valid permits ({len(permits)} cumulative)')

                    if data.get('total_rows'):
                        print(f'    Total available: {data["total_rows"]}')
                else:
                    print('    WARN - No permits extracted')
                    print(f'    Response preview: {response[:200]}')
                    errors.append({'step': f'extract_page_{page_num}', 'error': 'No permits in response'})
                    break

                if len(permits) >= target_count:
                    break

                # Try next page - Accela uses various pagination patterns
                has_next = data.get('has_next_page', False)
                if not has_next:
                    # Check for pagination links
                    has_next = await page.evaluate('''() => {
                        const nextLinks = document.querySelectorAll('a[href*="Page$Next"], .aca_pagination a:last-child, a:has-text("Next")');
                        for (const link of nextLinks) {
                            if (!link.classList.contains('ACA_Disabled') && link.offsetParent !== null) {
                                link.click();
                                return true;
                            }
                        }
                        return false;
                    }''')

                if not has_next:
                    print('    No more pages available')
                    break

                print(f'    Navigating to page {page_num + 1}...')
                await asyncio.sleep(4)
                page_num += 1

            # Step 4: Get additional details if needed
            if permits and any(not p.get('contractor') for p in permits):
                print(f'\n[4] Checking for contractor details...')
                # For Accela, contractor info is often in the search results
                # Detail page scraping would be similar to EnerGov

        except Exception as e:
            print(f'\nFATAL ERROR: {e}')
            errors.append({'step': 'main', 'error': str(e)})
            await page.screenshot(path=f'debug_html/{city_key}_error.png')

        finally:
            await browser.close()

    # Save results
    output = {
        'source': city_key,
        'portal_type': 'Accela',
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
    city_arg = sys.argv[1] if len(sys.argv) > 1 else 'fort_worth'
    count_arg = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    asyncio.run(scrape(city_arg, count_arg))
