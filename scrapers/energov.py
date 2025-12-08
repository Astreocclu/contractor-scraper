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
# EnerGov Self-Service portals (Tyler Technologies)
# URL pattern: {base_url}#/search?m=2 for permit search
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
    'desoto': {
        'name': 'DeSoto',
        # New Tyler-hosted EnerGov CSS portal (Sept 2025)
        'base_url': 'https://cityofdesototx-energovweb.tylerhost.net/apps/selfservice',
    },
    'mckinney': {
        'name': 'McKinney',
        # EnerGov for building permits (ROWay is separate for right-of-way only)
        'base_url': 'https://egov.mckinneytexas.org/EnerGov_Prod/SelfService',
    },
    'allen': {
        'name': 'Allen',
        # EnerGov CSS - high income market ($85k median)
        'base_url': 'https://energovweb.cityofallen.org/EnerGov/SelfService',
    },
    'farmers_branch': {
        'name': 'Farmers Branch',
        'base_url': 'https://egselfservice.farmersbranchtx.gov/EnerGov_Prod/SelfService',
    },
    'keller': {
        'name': 'Keller',
        # New Tyler-hosted EnerGov CSS portal (migrated from eTRAKiT Dec 2025)
        # Uses different URL structure: /apps/selfservice/{tenant}#/search
        'base_url': 'https://cityofkellertx-energovweb.tylerhost.net/apps/selfservice/cityofkellertxprod',
        'tyler_css': True,  # Flag for Tyler CSS variant (simpler search UI)
    },
    'mesquite': {
        'name': 'Mesquite',
        # EnerGov CSS portal (NOT MagnetGov - that's Mesquite NV!)
        'base_url': 'https://energov.cityofmesquite.com/selfservice',
        'tyler_css': True,
    },
    'grand_prairie_energov': {
        'name': 'Grand Prairie',
        # EnerGov CSS portal (migrated from Accela late 2024)
        'base_url': 'https://egov.gptx.org/EnerGov_Prod/SelfService',
        'tyler_css': False,  # Uses traditional EnerGov
    },
    # NOT EnerGov - different systems:
    # - Grapevine: MyGov (mygov.us)
    # - Richardson: CSS/Tyler (cor.net)
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


def is_valid_permit_type(permit_type: str) -> bool:
    """Check if permit type is one we want (residential work)."""
    if not permit_type:
        return True  # Don't exclude if no type specified

    permit_type_lower = permit_type.lower()

    # Check exclusions first
    for excluded in EXCLUDED_PERMIT_TYPES:
        if excluded in permit_type_lower:
            return False

    # If it matches a valid type, definitely include
    for valid in VALID_PERMIT_TYPES:
        if valid in permit_type_lower:
            return True

    # Default: include if not explicitly excluded (might be a variant we haven't seen)
    return True


def is_within_date_range(date_str: str, months: int = 2) -> bool:
    """Check if date is within the last N months."""
    if not date_str:
        return True  # Don't exclude if no date

    from datetime import timedelta

    # Try various date formats
    formats = ['%m/%d/%Y', '%Y-%m-%d', '%m-%d-%Y', '%d/%m/%Y', '%m/%d/%y']
    parsed_date = None

    for fmt in formats:
        try:
            parsed_date = datetime.strptime(date_str.strip(), fmt)
            break
        except ValueError:
            continue

    if not parsed_date:
        return True  # Don't exclude if can't parse

    cutoff = datetime.now() - timedelta(days=months * 30)
    return parsed_date >= cutoff


def is_hallucinated_permit(permit: dict) -> bool:
    """Detect likely hallucinated/placeholder permit data from LLM.

    Returns True if the permit looks fake/generated rather than real scraped data.
    """
    permit_id = permit.get('permit_id', '')
    address = permit.get('address', '')

    # Pattern 1: Generic PERMIT-YYYY-NNNNN format (not used by real EnerGov systems)
    if re.match(r'^PERMIT-\d{4}-\d{4,5}$', permit_id, re.IGNORECASE):
        return True

    # Pattern 2: Placeholder addresses
    placeholder_addresses = [
        '123 main st', '123 main street', '456 oak st', '789 elm st',
        '100 test st', '1234 sample', 'n/a', 'unknown', 'address'
    ]
    if address.lower().strip() in placeholder_addresses:
        return True

    # Pattern 3: Too-perfect sequential numbers (1234-2024, 1235-2024, 1236-2024)
    if re.match(r'^\d{4}-\d{4}$', permit_id):
        return True

    # Pattern 4: Very short/suspiciously simple IDs
    if len(permit_id) < 5 or permit_id.lower() in ['n/a', 'none', 'null', 'permit']:
        return True

    # Pattern 5: Contains explicit placeholder text
    if 'example' in permit_id.lower() or 'sample' in permit_id.lower():
        return True

    return False


def filter_permits(permits: list, date_months: int = 2) -> tuple[list, dict]:
    """Filter permits by type, date, and hallucination detection.

    Returns (valid_permits, rejection_stats).
    """
    valid = []
    stats = {'hallucinated': 0, 'bad_type': 0, 'old_date': 0, 'total_rejected': 0}

    for p in permits:
        permit_type = p.get('type') or p.get('permit_type', '')
        date_str = p.get('date') or p.get('applied_date') or p.get('finalized_date', '')

        if is_hallucinated_permit(p):
            stats['hallucinated'] += 1
            stats['total_rejected'] += 1
        elif not is_valid_permit_type(permit_type):
            stats['bad_type'] += 1
            stats['total_rejected'] += 1
        elif not is_within_date_range(date_str, date_months):
            stats['old_date'] += 1
            stats['total_rejected'] += 1
        else:
            valid.append(p)

    return valid, stats


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
        browser = await p.chromium.launch(
            headless=True,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-first-run',
                '--disable-dev-shm-usage',
            ]
        )
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 900},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        )
        page = await context.new_page()

        is_tyler_css = city_config.get('tyler_css', False)

        try:
            # Step 1: Load search page
            print('[1] Loading search page...')
            if is_tyler_css:
                # Tyler CSS: Go directly to search URL (hash routing works on initial load)
                search_url = f'{base_url}#/search'
                await page.goto(search_url, wait_until='load', timeout=60000)
            else:
                # Traditional EnerGov: Load home, find search link, navigate
                await page.goto(base_url, wait_until='load', timeout=60000)
                await asyncio.sleep(3)

                # Check if we're on home page (has "Search Public Records" link)
                search_link_clicked = await page.evaluate('''() => {
                    const links = document.querySelectorAll('a, div[onclick], span[onclick]');
                    for (const el of links) {
                        const text = el.textContent?.toLowerCase() || '';
                        if (text.includes('search public') || text.includes('search permit') ||
                            text.includes('permit search')) {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }''')

                if search_link_clicked:
                    print('    Clicked "Search Public Records" link')
                    await asyncio.sleep(4)

                # Now try hash navigation if not already on search page
                current_url = page.url
                if '#/search' not in current_url:
                    await page.evaluate("window.location.hash = '#/search?m=2'")
                    await asyncio.sleep(3)
            await asyncio.sleep(5)

            Path('debug_html').mkdir(exist_ok=True)
            await page.screenshot(path=f'debug_html/{city_key}_p1.png')
            print('    OK - Page loaded')

            # Step 2: Select module and submit search
            print('[2] Selecting module and submitting search...')
            if is_tyler_css:
                # Tyler CSS - MUST select Building/Permit module BEFORE searching
                # Otherwise defaults to Code Enforcement or Rental
                print('    Selecting Building Permit module...')

                # Try to find and select module dropdown/tabs
                module_selected = await page.evaluate('''() => {
                    // Method 1: Look for module dropdown
                    const moduleSelect = document.querySelector('select[id*="module" i], select[id*="Module" i], select[name*="module" i]');
                    if (moduleSelect) {
                        for (const opt of moduleSelect.options) {
                            const text = opt.text.toLowerCase();
                            // Must contain 'permit', avoid 'code' or 'enforcement'
                            if (text.includes('permit') && !text.includes('code')) {
                                moduleSelect.value = opt.value;
                                moduleSelect.dispatchEvent(new Event('change', { bubbles: true }));
                                return 'dropdown: ' + opt.text;
                            }
                        }
                    }

                    // Method 2: Look for module tabs/links - prefer 'permit' over 'building'
                    const tabs = document.querySelectorAll('a, button, .nav-link, [role="tab"]');
                    let buildingTab = null;  // Fallback option

                    for (const tab of tabs) {
                        const text = (tab.textContent || '').toLowerCase().trim();

                        // Skip unwanted modules
                        if (text.includes('code') || text.includes('enforcement') ||
                            text.includes('rental') || text.includes('license')) {
                            continue;
                        }

                        // Best match: contains 'permit'
                        if (text.includes('permit')) {
                            tab.click();
                            return 'tab: ' + tab.textContent;
                        }

                        // Second best: 'building' without 'code'
                        if (text.includes('building') && !text.includes('code') && !buildingTab) {
                            buildingTab = tab;
                        }
                    }

                    // Use building tab as fallback
                    if (buildingTab) {
                        buildingTab.click();
                        return 'tab: ' + buildingTab.textContent;
                    }

                    // Method 3: Look for category checkboxes
                    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
                    for (const cb of checkboxes) {
                        const label = cb.closest('label')?.textContent || cb.nextSibling?.textContent || '';
                        const labelLower = label.toLowerCase();
                        if (labelLower.includes('permit') && !labelLower.includes('code')) {
                            if (!cb.checked) cb.click();
                            return 'checkbox: ' + label;
                        }
                    }

                    return null;
                }''')

                if module_selected:
                    print(f'    Selected: {module_selected}')
                    await asyncio.sleep(2)
                else:
                    print('    WARN - Could not find Building module selector')

                # Now submit search
                try:
                    await page.click('button:has-text("Search")', timeout=5000)
                    await asyncio.sleep(5)
                    print('    OK - Search submitted (Tyler CSS)')

                    # Additional filter by Permit type in results sidebar if available
                    print('    Checking for Permit filter in results...')
                    try:
                        # Look for Building Permit specifically, not just "Permit"
                        filter_clicked = await page.evaluate('''() => {
                            const links = document.querySelectorAll('a, button');
                            for (const link of links) {
                                const text = (link.textContent || '').toLowerCase();
                                // Prefer "Building" or "Building Permit", avoid "Rental" or "Code"
                                if ((text.includes('building') || text === 'permit') &&
                                    !text.includes('rental') && !text.includes('code')) {
                                    link.click();
                                    return link.textContent;
                                }
                            }
                            return null;
                        }''')
                        if filter_clicked:
                            await asyncio.sleep(3)
                            print(f'    OK - Filtered to: {filter_clicked}')
                    except Exception:
                        pass

                    # Try to sort by date (newest first) - Tyler CSS defaults to oldest-first
                    print('    Sorting by date (newest first)...')
                    await asyncio.sleep(2)
                    sorted_by_date = await page.evaluate('''() => {
                        // Method 1: Click on Date column header (click twice for descending)
                        const headers = document.querySelectorAll('th, .sort-header, thead td, [data-sort], [class*="sortable"]');
                        for (const h of headers) {
                            const text = (h.textContent || '').toLowerCase().trim();
                            if (text.includes('date') || text.includes('opened') || text.includes('closed') ||
                                text.includes('finalized') || text.includes('issued')) {
                                // Click once for ascending, twice for descending (newest first)
                                h.click();
                                return 'header_click_1: ' + text;
                            }
                        }

                        // Method 2: Look for sort dropdown/select
                        const sortSelects = document.querySelectorAll('select[id*="sort" i], select[class*="sort" i]');
                        for (const sel of sortSelects) {
                            for (const opt of sel.options) {
                                const optText = opt.text.toLowerCase();
                                if (optText.includes('date') && optText.includes('desc')) {
                                    sel.value = opt.value;
                                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                                    return 'dropdown: ' + opt.text;
                                }
                            }
                        }

                        return null;
                    }''')

                    if sorted_by_date:
                        print(f'    Sorted: {sorted_by_date}')
                        # If header click, click again for descending order
                        if sorted_by_date.startswith('header_click_1'):
                            await asyncio.sleep(1)
                            await page.evaluate('''() => {
                                const headers = document.querySelectorAll('th, .sort-header, thead td, [data-sort]');
                                for (const h of headers) {
                                    const text = (h.textContent || '').toLowerCase().trim();
                                    if (text.includes('date') || text.includes('opened') || text.includes('closed')) {
                                        h.click();
                                        return true;
                                    }
                                }
                                return false;
                            }''')
                            print('    (clicked again for descending)')
                        await asyncio.sleep(3)
                    else:
                        print('    WARN - Could not find sort control')

                except PlaywrightTimeout:
                    # Try alternative selectors
                    await page.evaluate('''() => {
                        const btns = document.querySelectorAll('button');
                        for (const btn of btns) {
                            if (btn.textContent?.includes('Search')) { btn.click(); return; }
                        }
                    }''')
                    await asyncio.sleep(5)
            else:
                # Traditional EnerGov - click search button
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

            # Step 3: Sort by most recent (skip for Tyler CSS - uses different UI)
            if not is_tyler_css:
                print('[3] Sorting by finalized date (newest first)...')
                try:
                    # Check if sort dropdown exists first (with short timeout)
                    sort_dropdown = await page.query_selector('#PermitCriteria_SortBy')
                    if sort_dropdown:
                        await page.select_option('#PermitCriteria_SortBy', 'string:FinalDate', timeout=5000)
                        await asyncio.sleep(1)
                        await page.select_option('#SortAscending', 'boolean:false', timeout=5000)
                        await asyncio.sleep(4)
                        print('    OK - Sorted')
                    else:
                        # Try alternative sort via clicking column header
                        print('    WARN - Sort dropdown not found, trying column header...')
                        sorted_via_header = await page.evaluate('''() => {
                            const headers = document.querySelectorAll('th, .sort-header, [data-sort]');
                            for (const h of headers) {
                                if (h.textContent?.toLowerCase().includes('date') ||
                                    h.textContent?.toLowerCase().includes('finalized')) {
                                    h.click();
                                    return true;
                                }
                            }
                            return false;
                        }''')
                        if sorted_via_header:
                            await asyncio.sleep(3)
                            print('    OK - Sorted via column header')
                        else:
                            print('    WARN - Could not sort, using default order')
                except PlaywrightTimeout:
                    print('    WARN - Sort timed out, continuing without sort')
                except Exception as e:
                    print(f'    WARN - Sort failed: {str(e)[:100]}')
                    errors.append({'step': 'sort', 'error': str(e)[:200]})
            else:
                print('[3] Tyler CSS - sorting handled by portal')

            await page.screenshot(path=f'debug_html/{city_key}_results.png')

            # Step 4: Extract permits from search results
            page_num = 1
            consecutive_empty = 0
            while len(permits) < target_count:
                print(f'\n[4.{page_num}] Extracting page {page_num}...')

                # PRE-VALIDATION: Check if page has actual permit data before calling LLM
                has_data = await page.evaluate('''() => {
                    const body = document.body.innerText;
                    // Look for signs of actual permit data
                    const hasPermitIds = /[A-Z]{2,}-\d{4}-\d{3,}|BP-\d{4}|BLD-\d{4}|PERMIT-\d+/i.test(body);
                    const hasAddresses = /\d+\s+[A-Z][a-z]+\s+(ST|AVE|DR|RD|BLVD|LN|CT|WAY|PL)/i.test(body);
                    const hasResults = /result|record|permit|found/i.test(body);
                    const rowCount = document.querySelectorAll('tr, .result-item, .record, [id*="entityRecordDiv"]').length;
                    return {
                        hasPermitIds: hasPermitIds,
                        hasAddresses: hasAddresses,
                        hasResults: hasResults,
                        rowCount: rowCount,
                        bodyLen: body.length
                    };
                }''')

                print(f'    Pre-check: rows={has_data["rowCount"]}, hasIds={has_data["hasPermitIds"]}, hasAddr={has_data["hasAddresses"]}')

                # Skip LLM if page clearly has no data
                if has_data['rowCount'] < 2 and not has_data['hasPermitIds'] and has_data['bodyLen'] < 1000:
                    print('    SKIP - Page appears empty, no data to extract')
                    consecutive_empty += 1
                    if consecutive_empty >= 2:
                        print('    Stopping - multiple empty pages')
                        break
                    # Try next page anyway
                    page_num += 1
                    continue

                consecutive_empty = 0
                html = clean_html(await page.content())

                if is_tyler_css:
                    # Tyler CSS format - records show as list with Code Case Number, Type, Status, etc.
                    extract_prompt = f'''Extract ALL permit/case records from this {city_name} Tyler CSS search results page.

Records are displayed as a list. Each record shows:
- Code Case Number or Permit Number (like "EH-2504-0008", "BP-2024-1234")
- Type (Building, Permit, Code Enforcement, etc.)
- Status (Closed, Active, Issued, etc.)
- Opened Date / Closed Date
- Address
- Main Parcel
- Description

Extract each visible record. For EACH record:
- permit_id: The case/permit number
- address: Street address
- type: Record type
- status: Status
- applied_date: Opened Date
- finalized_date: Closed Date
- description: Description text

Return JSON:
{{"permits": [{{"permit_id": "...", "address": "...", "type": "...", "status": "...", "applied_date": "...", "finalized_date": "...", "description": "..."}}], "count": <number>}}

HTML:
{html[:120000]}'''
                else:
                    # Traditional EnerGov format
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
                    raw_permits = [p for p in data['permits'] if p.get('permit_id') and len(p['permit_id']) > 3]

                    # POST-VALIDATION: Filter by type, date, and hallucination
                    # Tyler CSS portals can't sort by date, so use longer window (12 months)
                    date_window = 12 if is_tyler_css else 2
                    valid_permits, filter_stats = filter_permits(raw_permits, date_months=date_window)

                    if filter_stats['total_rejected'] > 0:
                        print(f'    Filtered out {filter_stats["total_rejected"]}: '
                              f'{filter_stats["bad_type"]} bad type, '
                              f'{filter_stats["old_date"]} old, '
                              f'{filter_stats["hallucinated"]} hallucinated')

                    if valid_permits:
                        permits.extend(valid_permits)
                        print(f'    OK - Got {len(valid_permits)} valid permits ({len(permits)} cumulative)')
                    else:
                        print('    WARN - All permits filtered out')
                        errors.append({'step': f'extract_page_{page_num}', 'error': f'All {len(raw_permits)} permits filtered out'})
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
                    await page.goto(detail_url, wait_until='load', timeout=30000)
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
