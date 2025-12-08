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
# URLs verified from docs/dfw-contractor-audit-v3-corrected.md
# Using direct search page URLs instead of welcome pages
ACCELA_CITIES = {
    'fort_worth': {
        'name': 'Fort Worth',
        'base_url': 'https://aca-prod.accela.com/CFW',
        # Development module has permits but also complaints - filtering handles it
        'search_path': '/Cap/CapHome.aspx?module=Development&TabName=Development',
        'module': 'Development',
    },
    'dallas': {
        'name': 'Dallas',
        'base_url': 'https://aca-prod.accela.com/DALLASTX',
        # DallasNow Building search (May 2025 migration)
        'search_path': '/Cap/CapHome.aspx?module=Building&TabName=Home',
        'module': 'Building',
    },
    'grand_prairie': {
        'name': 'Grand Prairie',
        'base_url': 'https://aca-prod.accela.com/GPTX',
        # Building permits search
        'search_path': '/Cap/CapHome.aspx?module=Building&TabName=Building',
        'module': 'Building',
    },
    # Richardson removed - their Accela URL returns 404
    # Richardson uses custom portal at cor.net (not Accela)
}

DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')

# Permit types we WANT (residential work)
VALID_PERMIT_TYPES = {
    'building', 'residential', 'roof', 'roofing', 'hvac', 'mechanical',
    'plumbing', 'electrical', 'foundation', 'addition', 'alteration',
    'renovation', 'remodel', 'new construction', 'solar', 'pv', 'photovoltaic',
    'fence', 'deck', 'patio', 'pool', 'spa', 'water heater', 'ac', 'air conditioning',
    'window', 'door', 'siding', 'insulation', 'driveway', 'garage', 'carport',
}

# Permit types to EXCLUDE (garbage)
EXCLUDED_PERMIT_TYPES = {
    'code enforcement', 'complaint', 'rental', 'license', 'garage sale',
    'pre-development', 'conference', 'sign', 'billboard', 'commercial',
    'environmental', 'health', 'zoning', 'variance', 'planning', 'subdivision',
    'right-of-way', 'row', 'encroachment', 'special event', 'food', 'alcohol',
}


def is_valid_permit_type(permit_type: str) -> bool:
    """Check if permit type is one we want (residential work)."""
    if not permit_type:
        return True

    permit_type_lower = permit_type.lower()

    for excluded in EXCLUDED_PERMIT_TYPES:
        if excluded in permit_type_lower:
            return False

    for valid in VALID_PERMIT_TYPES:
        if valid in permit_type_lower:
            return True

    return True


def is_within_date_range(date_str: str, months: int = 2) -> bool:
    """Check if date is within the last N months."""
    if not date_str:
        return True

    from datetime import timedelta

    formats = ['%m/%d/%Y', '%Y-%m-%d', '%m-%d-%Y', '%d/%m/%Y', '%m/%d/%y']
    parsed_date = None

    for fmt in formats:
        try:
            parsed_date = datetime.strptime(date_str.strip(), fmt)
            break
        except ValueError:
            continue

    if not parsed_date:
        return True

    cutoff = datetime.now() - timedelta(days=months * 30)
    return parsed_date >= cutoff


def filter_permits(permits: list, date_months: int = 2) -> tuple[list, dict]:
    """Filter permits by type and date."""
    valid = []
    stats = {'bad_type': 0, 'old_date': 0, 'empty_addr': 0, 'total_rejected': 0}

    for p in permits:
        permit_type = p.get('type', '')
        date_str = p.get('date', '')
        address = p.get('address', '')

        if not is_valid_permit_type(permit_type):
            stats['bad_type'] += 1
            stats['total_rejected'] += 1
        elif not is_within_date_range(date_str, date_months):
            stats['old_date'] += 1
            stats['total_rejected'] += 1
        elif not address or 'undefined' in address.lower():
            stats['empty_addr'] += 1
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
    search_path = city_config.get('search_path', '/Default.aspx')
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
            # Step 1: Load Accela portal
            print('[1] Loading Accela portal...')
            search_url = f'{base_url}{search_path}'
            await page.goto(search_url, wait_until='networkidle', timeout=60000)
            await asyncio.sleep(3)

            Path('debug_html').mkdir(exist_ok=True)
            await page.screenshot(path=f'debug_html/{city_key}_step1.png')
            print(f'    OK - Page loaded: {page.url}')

            # Check if page loaded correctly
            if '404' in await page.title() or 'cannot be found' in await page.content():
                print('    ERROR - Page returned 404')
                errors.append({'step': 'load', 'error': 'Page 404'})
                raise Exception('Page 404')

            # Step 1b: If on Default.aspx/welcome page, navigate to search
            # Look for "Search Applications and Permits" or similar links
            if '/Default.aspx' in page.url or '/default.aspx' in page.url.lower():
                print('[1b] Navigating to permit search...')
                search_nav_clicked = await page.evaluate('''() => {
                    // Look for links containing "search" and "permit" or "application"
                    const links = document.querySelectorAll('a');
                    for (const link of links) {
                        const text = (link.textContent || '').toLowerCase();
                        if (text.includes('search') && (text.includes('permit') || text.includes('application'))) {
                            link.click();
                            return link.href || 'clicked';
                        }
                    }
                    // Look for Building/Development module links
                    for (const link of links) {
                        const text = (link.textContent || '').toLowerCase();
                        const href = (link.href || '').toLowerCase();
                        if (href.includes('caphome') || href.includes('module=building') || href.includes('module=development')) {
                            link.click();
                            return link.href || 'clicked';
                        }
                    }
                    return null;
                }''')

                if search_nav_clicked:
                    print(f'    Clicked link to search: {search_nav_clicked[:60]}...')
                    await asyncio.sleep(4)
                    await page.screenshot(path=f'debug_html/{city_key}_step1b.png')
                else:
                    print('    WARN - No navigation link found, staying on current page')

            # Step 2: Set date filters and search
            print('[2] Setting date filters and searching...')

            # Calculate date range - last 2 months
            from datetime import timedelta
            today = datetime.now()
            start_date = today - timedelta(days=60)
            start_str = start_date.strftime('%m/%d/%Y')
            end_str = today.strftime('%m/%d/%Y')

            # Try to fill date fields (Accela uses various field IDs)
            date_filled = await page.evaluate(f'''() => {{
                const startDate = '{start_str}';
                const endDate = '{end_str}';
                
                // Try common Accela date field IDs
                const startFields = [
                    'ctl00_PlaceHolderMain_generalSearchForm_txtGSStartDate',
                    'ctl00_PlaceHolderMain_txtGSStartDate'
                ];
                const endFields = [
                    'ctl00_PlaceHolderMain_generalSearchForm_txtGSEndDate',
                    'ctl00_PlaceHolderMain_txtGSEndDate'
                ];

                let filled = false;
                for (const id of startFields) {{
                    const el = document.getElementById(id);
                    if (el) {{
                        el.value = startDate;
                        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        filled = true;
                        break;
                    }}
                }}
                // Also try querySelector for more generic selectors
                if (!filled) {{
                    const startInput = document.querySelector('input[id*="StartDate"]');
                    if (startInput) {{
                        startInput.value = startDate;
                        startInput.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        filled = true;
                    }}
                }}
                
                for (const id of endFields) {{
                    const el = document.getElementById(id);
                    if (el) {{
                        el.value = endDate;
                        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        break;
                    }}
                }}
                const endInput = document.querySelector('input[id*="EndDate"]');
                if (endInput) {{
                    endInput.value = endDate;
                    endInput.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
                
                return filled;
            }}''')

            if date_filled:
                print(f'    Date range set: {start_str} to {end_str}')
            else:
                print('    WARN - Could not find date fields, searching without date filter')

            await asyncio.sleep(2)  # Give form time to update

            # Click search button
            search_selectors = [
                '#ctl00_PlaceHolderMain_btnNewSearch',
                '#ctl00_PlaceHolderMain_generalSearchForm_btnSearch',
                'input[id*="btnNewSearch"]',
                'input[id*="btnSearch"]',
                'input[value*="Search"]',
                'button:has-text("Search")',
                'a:has-text("Search")',
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
                clicked_js = await page.evaluate('''() => {
                    const elements = document.querySelectorAll('input[type="submit"], input[type="button"], button, a.ACA_LgButton');
                    for (const el of elements) {
                        const text = (el.value || el.textContent || '').toLowerCase();
                        if (text.includes('search') && !text.includes('clear') && !text.includes('new')) {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }''')
                if clicked_js:
                    print('    Clicked search via JS')
                else:
                    print('    WARN - No search button found')

            await asyncio.sleep(7)  # Wait longer for results
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
                    raw_permits = [p for p in data['permits'] if p.get('permit_id')]

                    # Filter by type, date, and address
                    valid_permits, filter_stats = filter_permits(raw_permits, date_months=2)

                    if filter_stats['total_rejected'] > 0:
                        print(f'    Filtered out {filter_stats["total_rejected"]}: '
                              f'{filter_stats["bad_type"]} bad type, '
                              f'{filter_stats["old_date"]} old, '
                              f'{filter_stats["empty_addr"]} bad address')

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
