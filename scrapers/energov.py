#!/usr/bin/env python3
"""
ENERGOV PERMIT SCRAPER (Playwright Python)
Portal: EnerGov Self-Service (Tyler Tech Angular SPA)
Covers: Southlake, Grand Prairie, Princeton, Colleyville, etc.

Usage:
  python scrapers/energov.py southlake 50
  python scrapers/energov.py grand_prairie 25
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
ENERGOV_CITIES = {
    'southlake': {
        'name': 'Southlake',
        'base_url': 'https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService',
    },
    'grand_prairie': {
        'name': 'Grand Prairie',
        'base_url': 'https://egov.gptx.org/EnerGov_Prod/SelfService',
    },
    'princeton': {
        'name': 'Princeton',
        'base_url': 'https://energov.cityofprinceton.com/EnerGov_Prod/SelfService',
    },
    'colleyville': {
        'name': 'Colleyville',
        'base_url': 'https://energov.cityofcolleyville.com/EnerGov_Prod/SelfService',
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
    """Scrape permits from EnerGov portal for a given city."""
    city_key = city_key.lower().replace(' ', '_')

    if city_key not in ENERGOV_CITIES:
        print(f'ERROR: Unknown city "{city_key}". Available: {", ".join(ENERGOV_CITIES.keys())}')
        sys.exit(1)

    city_config = ENERGOV_CITIES[city_key]
    city_name = city_config['name']
    base_url = city_config['base_url']

    print('=' * 50)
    print(f'{city_name.upper()} PERMIT SCRAPER (EnerGov)')
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
            print('[1] Loading search page...')
            await page.goto(f'{base_url}#/search?m=2', wait_until='networkidle', timeout=60000)
            await asyncio.sleep(5)

            Path('debug_html').mkdir(exist_ok=True)
            await page.screenshot(path=f'debug_html/{city_key}_p1.png')
            print('    OK - Page loaded')

            # Step 2: Click search
            print('[2] Clicking search button...')
            try:
                await page.click('#button-Search', timeout=5000)
                await asyncio.sleep(5)
                print('    OK - Search submitted')
            except PlaywrightTimeout:
                print('    WARN - Search button click failed, trying alternative...')
                await page.evaluate('''() => {
                    const buttons = document.querySelectorAll('button, input[type="submit"]');
                    for (const btn of buttons) {
                        if (btn.textContent?.toLowerCase().includes('search') || btn.value?.toLowerCase().includes('search')) {
                            btn.click();
                            return;
                        }
                    }
                }''')
                await asyncio.sleep(5)

            # Step 3: Sort by most recent
            print('[3] Sorting by finalized date (newest first)...')
            try:
                await page.select_option('#PermitCriteria_SortBy', 'string:FinalDate')
                await asyncio.sleep(1)
                await page.select_option('#SortAscending', 'boolean:false')
                await asyncio.sleep(4)
                print('    OK - Sorted')
            except Exception as e:
                print(f'    WARN - Sort failed: {e}')
                errors.append({'step': 'sort', 'error': str(e)})

            await page.screenshot(path=f'debug_html/{city_key}_results.png')

            # Step 4: Extract permits from search results
            page_num = 1
            while len(permits) < target_count:
                print(f'\n[4.{page_num}] Extracting page {page_num}...')

                html = clean_html(await page.content())

                extract_prompt = f'''Extract ALL permit records from this {city_name} EnerGov search results page.

There are divs with id="entityRecordDiv0" through "entityRecordDiv9" (10 permits per page).
Extract EVERY permit - do not skip any.

For EACH permit div, extract:
- permit_id: The permit number shown in the link
- address: Street address
- type: Permit type (Building, Pool, Fence, etc.)
- status: Status like "Closed", "Issued", "Active"
- applied_date: Application date
- issued_date: Issue date
- finalized_date: Finalized date
- description: Project description text
- detail_link: The href containing "#/permit/" and a GUID

Return JSON:
{{"permits": [{{"permit_id": "...", "address": "...", "type": "...", "status": "...", "applied_date": "...", "issued_date": "...", "finalized_date": "...", "description": "...", "detail_link": "..."}}], "count": 10}}

HTML:
{html[:120000]}'''

                response = await call_deepseek(extract_prompt)
                data = parse_json(response)

                if data and data.get('permits'):
                    valid_permits = [p for p in data['permits'] if p.get('permit_id') and len(p['permit_id']) > 3]
                    permits.extend(valid_permits)
                    print(f'    OK - Got {len(valid_permits)} valid permits ({len(permits)} cumulative)')
                else:
                    print('    WARN - No permits extracted')
                    print(f'    Response preview: {response[:200]}')
                    errors.append({'step': f'extract_page_{page_num}', 'error': 'No permits in response'})

                if len(permits) >= target_count:
                    break

                # Try next page
                next_page = page_num + 1
                print(f'    Looking for page {next_page}...')

                has_next = await page.evaluate(f'''(nextP) => {{
                    const allLinks = document.querySelectorAll('a');
                    for (const link of allLinks) {{
                        const text = link.textContent?.trim();
                        if (text === String(nextP) || (text === '>' && nextP > 1)) {{
                            link.click();
                            return true;
                        }}
                    }}
                    return false;
                }}''', next_page)

                if not has_next:
                    print('    No more pages available')
                    break

                print(f'    Navigating to page {next_page}...')
                await asyncio.sleep(4)
                page_num += 1

            # Step 5: Get contractor details from detail pages
            print(f'\n[5] Getting contractor details for {min(len(permits), target_count)} permits...')

            for i, permit in enumerate(permits[:target_count]):
                if not permit.get('detail_link'):
                    continue

                detail_url = f'{base_url}{permit["detail_link"]}'

                try:
                    await page.goto(detail_url, wait_until='networkidle', timeout=30000)
                    await asyncio.sleep(3)

                    html = clean_html(await page.content())

                    # Extract aria-label patterns for contractor info
                    aria_labels = re.findall(r'aria-label="(Type |Company |First Name |Last Name )[^"]*"', html)
                    valuation_matches = re.findall(r'\$[\d,]+\.\d{2}', html)

                    detail_prompt = f'''Extract contractor info from these aria-label attributes found on a permit page:

{chr(10).join(aria_labels[:20])}

Valuation amounts found: {', '.join(valuation_matches[:5])}

Parse the aria-labels to extract:
- contractor_company: Value after "Company "
- contractor_name: Combine First Name + Last Name values
- contractor_type: Value after "Type " (e.g., "Applicant", "Contractor")
- valuation: First dollar amount

Return JSON:
{{"contractor_company": "", "contractor_name": "", "contractor_type": "", "valuation": ""}}'''

                    response = await call_deepseek(detail_prompt)
                    data = parse_json(response)

                    if data:
                        permit['contractor_company'] = data.get('contractor_company', '')
                        permit['contractor_name'] = data.get('contractor_name', '')
                        permit['contractor_type'] = data.get('contractor_type', '')
                        permit['valuation'] = data.get('valuation', '')

                    contractor = permit.get('contractor_company') or permit.get('contractor_name') or '(none)'
                    print(f'    {i + 1}/{target_count}: {permit["permit_id"]} -> {contractor}')

                except Exception as e:
                    print(f'    {i + 1}/{target_count}: {permit["permit_id"]} -> ERROR: {e}')
                    errors.append({'step': f'detail_{permit["permit_id"]}', 'error': str(e)})

        except Exception as e:
            print(f'\nFATAL ERROR: {e}')
            errors.append({'step': 'main', 'error': str(e)})
            await page.screenshot(path=f'debug_html/{city_key}_error.png')

        finally:
            await browser.close()

    # Save results
    output = {
        'source': city_key,
        'portal_type': 'EnerGov',
        'scraped_at': datetime.now().isoformat(),
        'target_count': target_count,
        'actual_count': len(permits),
        'with_contractor': len([p for p in permits if p.get('contractor_company') or p.get('contractor_name')]),
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
    city_arg = sys.argv[1] if len(sys.argv) > 1 else 'southlake'
    count_arg = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    asyncio.run(scrape(city_arg, count_arg))
