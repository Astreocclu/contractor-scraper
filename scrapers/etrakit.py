#!/usr/bin/env python3
"""
eTRAKiT PERMIT SCRAPER (Playwright Python)
Portal: eTRAKiT (CentralSquare Technologies)
Covers: Frisco, Plano (high-income DFW markets)

Tech: ASP.NET WebForms with __doPostBack
- Similar architecture to Accela
- No login required for permit search
- Postback-based pagination

Usage:
  python scrapers/etrakit.py frisco 50
  python scrapers/etrakit.py plano 25
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
# eTRAKiT portals - CentralSquare (formerly Superion)
ETRAKIT_CITIES = {
    'frisco': {
        'name': 'Frisco',
        'base_url': 'https://etrakit.friscotexas.gov',
        'search_path': '/etrakit/Search/permit.aspx',
        'login_required': False,  # Public search available
    },
    'plano': {
        'name': 'Plano',
        'base_url': 'https://trakit.plano.gov',
        'search_path': '/etrakit_prod/Search/permit.aspx',
        'login_required': True,  # TODO: Requires login - need credentials
    },
    # Keller migrated from eTRAKiT to "Enterprise Permitting & Licensing" (EnerGov CSS)
    # New URL: https://www.cityofkeller.com/css -> energovweb.cityofkeller.com
    # Use energov.py instead
    # Additional eTRAKiT cities can be added here
    # Pattern: {city}.gov domain with /etrakit/ or /etrakit_prod/ path
}

DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')

# Permit types to EXCLUDE (garbage)
EXCLUDED_PERMIT_TYPES = {
    'code enforcement', 'complaint', 'rental', 'license', 'garage sale',
    'pre-development', 'conference', 'sign', 'billboard',
    'environmental', 'health', 'zoning', 'variance', 'planning', 'subdivision',
    'right-of-way', 'row', 'encroachment', 'special event', 'food', 'alcohol',
}

# Permit ID prefix mappings (eTRAKiT convention)
# Note: Frisco search results don't show type column, so we infer from prefix
PERMIT_PREFIXES = {
    'B': 'Building',      # High value - includes pools, roofs, additions
    'R': 'Roofing',       # High value
    'E': 'Electrical',    # Medium value - includes solar
    'M': 'Mechanical',    # Medium value - HVAC
    'P': 'Plumbing',      # LOW value - skip by default (water heaters, not pools)
    'F': 'Fire',          # Low value
    'D': 'Demolition',    # Low value
}

# Default prefixes to search (high-value only)
DEFAULT_PREFIXES = ['B', 'R', 'E', 'M']


def infer_type_from_prefix(permit_id: str) -> str:
    """Infer permit type from ID prefix (e.g., B25-00001 -> Building)."""
    if not permit_id:
        return 'Unknown'
    # Extract first letter(s) before the year digits
    prefix = permit_id[0].upper() if permit_id else ''
    return PERMIT_PREFIXES.get(prefix, 'Unknown')


def infer_type_from_contractor(contractor: str) -> str | None:
    """Infer permit type from contractor name keywords."""
    if not contractor:
        return None
    contractor_lower = contractor.lower()

    # High-confidence keyword matches
    if any(kw in contractor_lower for kw in ['pool', 'swim', 'aqua']):
        return 'Pool'
    if any(kw in contractor_lower for kw in ['roof', 'shingle']):
        return 'Roofing'
    if any(kw in contractor_lower for kw in ['solar', 'photovoltaic', 'pv ']):
        return 'Solar'
    if any(kw in contractor_lower for kw in ['fence', 'fencing']):
        return 'Fence'
    if any(kw in contractor_lower for kw in ['hvac', 'air condition', 'heating', 'cooling']):
        return 'HVAC'

    return None


def is_valid_permit_type(permit_type: str) -> bool:
    """Check if permit type is one we want (not garbage)."""
    if not permit_type:
        return True  # Include if no type specified

    permit_type_lower = permit_type.lower()

    for excluded in EXCLUDED_PERMIT_TYPES:
        if excluded in permit_type_lower:
            return False

    return True


def filter_permits(permits: list) -> tuple[list, dict]:
    """Filter out garbage permit types and add inferred types."""
    valid = []
    stats = {'bad_type': 0, 'empty': 0, 'total_rejected': 0, 'types_inferred': 0}

    for p in permits:
        permit_type = p.get('type', '')
        permit_id = p.get('permit_id', '')

        if not permit_id:
            stats['empty'] += 1
            stats['total_rejected'] += 1
        elif not is_valid_permit_type(permit_type):
            stats['bad_type'] += 1
            stats['total_rejected'] += 1
        else:
            # Infer type if missing (Frisco doesn't show type in search results)
            if not permit_type:
                # First try contractor name (more specific)
                contractor = p.get('contractor', '')
                inferred = infer_type_from_contractor(contractor)
                if inferred:
                    p['type'] = inferred
                    p['type_source'] = 'contractor'
                else:
                    # Fall back to permit ID prefix
                    p['type'] = infer_type_from_prefix(permit_id)
                    p['type_source'] = 'prefix'
                stats['types_inferred'] += 1
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


async def scrape(city_key: str, target_count: int = 50, prefix: str = 'B'):
    """Scrape permits from eTRAKiT portal for a given city.

    Args:
        city_key: City identifier (e.g., 'frisco', 'plano')
        target_count: Number of permits to scrape
        prefix: Permit ID prefix to search (B=Building, R=Roofing, E=Electrical, M=Mechanical)
    """
    city_key = city_key.lower().replace(' ', '_')

    if city_key not in ETRAKIT_CITIES:
        print(f'ERROR: Unknown city "{city_key}". Available: {", ".join(ETRAKIT_CITIES.keys())}')
        sys.exit(1)

    city_config = ETRAKIT_CITIES[city_key]
    city_name = city_config['name']
    base_url = city_config['base_url']
    search_path = city_config['search_path']

    print('=' * 50)
    print(f'{city_name.upper()} PERMIT SCRAPER (eTRAKiT)')
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
            print('[1] Loading eTRAKiT search page...')
            search_url = f'{base_url}{search_path}'
            await page.goto(search_url, wait_until='networkidle', timeout=60000)
            await asyncio.sleep(3)

            Path('debug_html').mkdir(exist_ok=True)
            await page.screenshot(path=f'debug_html/{city_key}_etrakit_step1.png')
            print(f'    OK - Page loaded: {page.url}')

            # Step 2: Configure search for recent permits
            print('[2] Configuring search criteria...')

            # eTRAKiT requires a search value - use wildcard or activity number pattern
            # Search by Activity Number with wildcard pattern for current year
            search_configured = await page.evaluate('''() => {
                // Find the "Search By" dropdown and select Activity Number or Permit Number
                const searchByDropdown = document.getElementById('cplMain_ddSearchBy');
                if (searchByDropdown) {
                    // Try to find Activity Number or Permit Number option
                    for (const opt of searchByDropdown.options) {
                        const text = opt.textContent.toLowerCase();
                        if (text.includes('activity') || text.includes('permit no')) {
                            searchByDropdown.value = opt.value;
                            searchByDropdown.dispatchEvent(new Event('change', { bubbles: true }));
                            return 'searchBy: ' + opt.textContent;
                        }
                    }
                }
                return null;
            }''')

            if search_configured:
                print(f'    {search_configured}')

            await asyncio.sleep(1)

            # Set search operator to "Starts With" or "Contains"
            operator_set = await page.evaluate('''() => {
                const operDropdown = document.getElementById('cplMain_ddSearchOper');
                if (operDropdown) {
                    for (const opt of operDropdown.options) {
                        const text = opt.textContent.toLowerCase();
                        if (text.includes('start') || text.includes('begin')) {
                            operDropdown.value = opt.value;
                            return 'operator: ' + opt.textContent;
                        }
                    }
                }
                return null;
            }''')

            if operator_set:
                print(f'    {operator_set}')

            # Enter search value - use prefix + current year (e.g., "B25" for Building 2025)
            # eTRAKiT systems use format like B25-xxxxx, R25-xxxxx, E25-xxxxx
            current_year = datetime.now().strftime('%y')  # "25" for 2025
            search_value = f'{prefix.upper()}{current_year}'
            permit_type_name = PERMIT_PREFIXES.get(prefix.upper(), 'Unknown')

            search_input = await page.query_selector('#cplMain_txtSearchString')
            if search_input:
                await search_input.fill(search_value)
                print(f'    Search value: {search_value} ({permit_type_name} permits)')
            else:
                print('    WARN - Could not find search input')

            await asyncio.sleep(1)

            # Step 3: Submit search
            print('[3] Submitting search...')

            # eTRAKiT uses ASP.NET postback buttons
            search_selectors = [
                'input[id*="btnSearch"]',
                'input[value*="Search"]',
                'input[type="submit"]',
                '#btnSearch',
                'a[id*="btnSearch"]',
            ]

            clicked = False
            for selector in search_selectors:
                try:
                    await page.click(selector, timeout=3000)
                    clicked = True
                    print(f'    OK - Clicked: {selector}')
                    break
                except PlaywrightTimeout:
                    continue

            if not clicked:
                # Try JavaScript click
                clicked_js = await page.evaluate('''() => {
                    const elements = document.querySelectorAll('input[type="submit"], input[type="button"], a.button');
                    for (const el of elements) {
                        const text = (el.value || el.textContent || '').toLowerCase();
                        if (text.includes('search') && !text.includes('clear')) {
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

            await asyncio.sleep(5)
            await page.screenshot(path=f'debug_html/{city_key}_etrakit_results.png')

            # Step 4: Extract permits from results
            page_num = 1
            while len(permits) < target_count:
                print(f'\n[4.{page_num}] Extracting page {page_num}...')

                html = clean_html(await page.content())
                Path(f'debug_html/{city_key}_etrakit_p{page_num}.html').write_text(await page.content())

                extract_prompt = f'''Extract ALL permit records from this {city_name} eTRAKiT search results page.

eTRAKiT displays permits in a grid/table format. For each permit row, extract:
- permit_id: The permit number (e.g., "B24-12345", "BLDG-2024-001234")
- address: Property address
- type: Permit type (Building, Electrical, Plumbing, Mechanical, Roofing, Pool, etc.)
- status: Status (Issued, Active, Final, Expired, etc.)
- date: Application date, issue date, or finalized date
- description: Project description or work type
- contractor: Contractor name if visible
- owner: Property owner if visible

Return JSON:
{{"permits": [{{"permit_id": "...", "address": "...", "type": "...", "status": "...", "date": "...", "description": "...", "contractor": "...", "owner": "..."}}], "has_next_page": true/false, "total_results": <number or null>}}

HTML:
{html[:120000]}'''

                response = await call_deepseek(extract_prompt)
                data = parse_json(response)

                if data and data.get('permits'):
                    raw_permits = [p for p in data['permits'] if p.get('permit_id')]
                    valid_permits, filter_stats = filter_permits(raw_permits)
                    permits.extend(valid_permits)

                    if filter_stats['total_rejected'] > 0:
                        print(f'    Filtered out {filter_stats["total_rejected"]}: '
                              f'{filter_stats["bad_type"]} bad type, '
                              f'{filter_stats["empty"]} empty')
                    if filter_stats.get('types_inferred', 0) > 0:
                        print(f'    Inferred types for {filter_stats["types_inferred"]} permits')
                    print(f'    OK - Got {len(valid_permits)} valid permits ({len(permits)} cumulative)')

                    if data.get('total_results'):
                        print(f'    Total available: {data["total_results"]}')
                else:
                    print('    WARN - No permits extracted')
                    print(f'    Response preview: {response[:200]}')
                    errors.append({'step': f'extract_page_{page_num}', 'error': 'No permits in response'})
                    break

                if len(permits) >= target_count:
                    break

                # Try pagination - eTRAKiT uses postback for paging
                # Capture ViewState before clicking Next (to detect when page updates)
                old_viewstate = await page.evaluate('''() => {
                    const vs = document.getElementById("__VIEWSTATE");
                    return vs ? vs.value.slice(0, 100) : null;
                }''')

                # DeepSeek's has_next_page is just a hint - we still need to click!
                # Always try to click the Next button regardless of DeepSeek's response
                has_next = await page.evaluate('''() => {
                    // Method 1: Find Next button by class (preferred)
                    const nextBtn = document.querySelector('input.NextPage:not(.aspNetDisabled), input.PagerButton.NextPage:not([disabled])');
                    if (nextBtn) {
                        nextBtn.click();
                        return true;
                    }

                    // Method 2: Find by ID pattern
                    const nextById = document.querySelector('input[id*="btnPageNext"]:not([disabled])');
                    if (nextById) {
                        nextById.click();
                        return true;
                    }

                    // Method 3: Call changePage directly if function exists
                    if (typeof changePage === 'function') {
                        changePage('next');
                        return true;
                    }

                    // Method 4: Fallback to anchor tags with __doPostBack
                    const links = document.querySelectorAll('a');
                    for (const link of links) {
                        const text = (link.textContent || '').toLowerCase().trim();
                        const href = link.href || '';
                        if ((text === 'next' || text === '>') && href.includes('__doPostBack')) {
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

                # Wait for ViewState to change (indicates postback completed)
                if old_viewstate:
                    try:
                        await page.wait_for_function(
                            f'''() => {{
                                const vs = document.getElementById("__VIEWSTATE");
                                return vs && vs.value.slice(0, 100) !== "{old_viewstate}";
                            }}''',
                            timeout=30000
                        )
                        print(f'    ViewState updated - page loaded')
                    except PlaywrightTimeout:
                        print(f'    WARN - ViewState unchanged after 30s, continuing anyway')
                        await asyncio.sleep(5)
                else:
                    # Fallback to fixed delay if no ViewState found
                    await asyncio.sleep(5)

                page_num += 1

            # Step 5: Get contractor details from detail pages (optional)
            print(f'\n[5] Checking for additional contractor details...')
            # eTRAKiT often shows contractor info in search results
            # Detail page scraping can be added if needed

        except Exception as e:
            print(f'\nFATAL ERROR: {e}')
            errors.append({'step': 'main', 'error': str(e)})
            await page.screenshot(path=f'debug_html/{city_key}_etrakit_error.png')

        finally:
            await browser.close()

    # Save results
    output = {
        'source': city_key,
        'portal_type': 'eTRAKiT',
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
            print(f'  {p["permit_id"]} | {p.get("type", "unknown")} | {p.get("address", "no address")}')

    return output


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Scrape permits from eTRAKiT portals')
    parser.add_argument('city', nargs='?', default='frisco', help='City to scrape (frisco, plano)')
    parser.add_argument('count', nargs='?', type=int, default=50, help='Number of permits to scrape')
    parser.add_argument('--prefix', '-p', default='B',
                        help=f'Permit ID prefix to search. Options: {", ".join(PERMIT_PREFIXES.keys())}. Default: B')
    parser.add_argument('--all-prefixes', action='store_true',
                        help=f'Search all default prefixes: {DEFAULT_PREFIXES}')

    args = parser.parse_args()

    if args.all_prefixes:
        # Run multiple searches for each prefix
        print(f'Running multi-prefix search: {DEFAULT_PREFIXES}')
        all_permits = []
        for pfx in DEFAULT_PREFIXES:
            print(f'\n{"="*60}')
            print(f'SEARCHING PREFIX: {pfx} ({PERMIT_PREFIXES.get(pfx, "Unknown")})')
            print('='*60)
            result = asyncio.run(scrape(args.city, args.count, pfx))
            all_permits.extend(result.get('permits', []))
        print(f'\n\nTOTAL PERMITS ACROSS ALL PREFIXES: {len(all_permits)}')
    else:
        asyncio.run(scrape(args.city, args.count, args.prefix))
