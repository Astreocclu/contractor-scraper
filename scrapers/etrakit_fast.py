#!/usr/bin/env python3
"""
FAST eTRAKiT PERMIT SCRAPER - DOM extraction (no LLM)
Extracts directly from page structure, much faster than LLM approach.

Usage:
  python scrapers/etrakit_fast.py frisco 5000
"""

import asyncio
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

ETRAKIT_CITIES = {
    'frisco': {
        'name': 'Frisco',
        'base_url': 'https://etrakit.friscotexas.gov',
        'search_path': '/etrakit/Search/permit.aspx',
    },
}


async def extract_permits_from_page(page) -> list:
    """Extract permits directly from DOM - no LLM needed."""
    return await page.evaluate('''() => {
        const permits = [];
        const rows = document.querySelectorAll('tr.rgRow, tr.rgAltRow');

        for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 4) continue;

            // Extract text from cells
            const cellTexts = Array.from(cells).map(c => c.innerText.trim());

            // Find permit ID (B25-XXXXX pattern)
            let permit_id = null;
            let address = null;
            let permit_type = null;
            let status = null;
            let date = null;
            let description = null;

            for (const text of cellTexts) {
                if (/^[A-Z]\d{2}-\d{5}$/.test(text)) {
                    permit_id = text;
                } else if (/^\d+\s+[A-Z]/.test(text) && text.length > 10) {
                    address = text;
                } else if (/^(Building|Electrical|Plumbing|Mechanical|Roofing|Pool|Demolition|Fire|HVAC|Gas|Irrigation)/i.test(text)) {
                    permit_type = text;
                } else if (/^(Issued|Active|Final|Expired|Closed|Pending|Approved|Void)/i.test(text)) {
                    status = text;
                } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
                    if (!date) date = text;
                }
            }

            // Also try to get permit_id from link
            const link = row.querySelector('a');
            if (link && !permit_id) {
                const linkText = link.innerText.trim();
                if (/^[A-Z]\d{2}-\d{5}$/.test(linkText)) {
                    permit_id = linkText;
                }
            }

            if (permit_id) {
                permits.push({
                    permit_id: permit_id,
                    address: address || '',
                    type: permit_type || '',
                    status: status || '',
                    date: date || '',
                    raw_cells: cellTexts.slice(0, 6)  // Keep raw data for debugging
                });
            }
        }

        return permits;
    }''')


async def scrape_fast(city_key: str, target_count: int = 1000):
    """Fast scrape using DOM extraction, multiple year prefixes."""
    city_key = city_key.lower()
    if city_key not in ETRAKIT_CITIES:
        print(f'ERROR: Unknown city. Available: {list(ETRAKIT_CITIES.keys())}')
        sys.exit(1)

    config = ETRAKIT_CITIES[city_key]
    base_url = config['base_url']
    search_path = config['search_path']

    print('=' * 60)
    print(f'{config["name"].upper()} FAST PERMIT SCRAPER')
    print('=' * 60)
    print(f'Target: {target_count} permits')
    print(f'Time: {datetime.now().isoformat()}\n')

    all_permits = []
    errors = []

    # Search multiple year prefixes to get more permits
    # B = Building permits, years 25, 24, 23, 22, 21, 20
    prefixes = ['B25', 'B24', 'B23', 'B22', 'B21', 'B20', 'B19']

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1280, 'height': 900})
        page = await context.new_page()

        try:
            for prefix in prefixes:
                if len(all_permits) >= target_count:
                    break

                print(f'\n[{prefix}] Searching prefix "{prefix}"...')

                # Load search page
                await page.goto(f'{base_url}{search_path}', wait_until='networkidle', timeout=60000)
                await asyncio.sleep(2)

                # Fill search
                await page.fill('#cplMain_txtSearchString', prefix)
                await asyncio.sleep(0.5)

                # Click search
                await page.click('input[id*="btnSearch"]')
                await asyncio.sleep(4)

                # Get page count
                page_info = await page.evaluate('''() => {
                    const span = document.querySelector('span.font12.italic');
                    if (span) {
                        const match = span.textContent.match(/page (\d+) of (\d+)/);
                        if (match) return {current: parseInt(match[1]), total: parseInt(match[2])};
                    }
                    return {current: 1, total: 1};
                }''')

                print(f'    Found {page_info["total"]} pages')

                # Extract all pages for this prefix
                page_num = 1
                prefix_permits = []

                while page_num <= page_info['total'] and len(all_permits) + len(prefix_permits) < target_count:
                    permits = await extract_permits_from_page(page)
                    prefix_permits.extend(permits)

                    if page_num % 10 == 0 or page_num == 1:
                        print(f'    Page {page_num}/{page_info["total"]}: +{len(permits)} permits ({len(prefix_permits)} from {prefix})')

                    if page_num >= page_info['total']:
                        break

                    # Click next
                    has_next = await page.evaluate('''() => {
                        const nextBtn = document.querySelector('input.NextPage:not([disabled])');
                        if (nextBtn) { nextBtn.click(); return true; }
                        return false;
                    }''')

                    if not has_next:
                        break

                    await asyncio.sleep(2)
                    page_num += 1

                print(f'    {prefix}: Got {len(prefix_permits)} permits')
                all_permits.extend(prefix_permits)

        except Exception as e:
            print(f'\nERROR: {e}')
            errors.append(str(e))
            await page.screenshot(path='debug_html/frisco_fast_error.png')

        finally:
            await browser.close()

    # Deduplicate by permit_id
    seen = set()
    unique_permits = []
    for p in all_permits:
        if p['permit_id'] not in seen:
            seen.add(p['permit_id'])
            unique_permits.append(p)

    print(f'\n{"=" * 60}')
    print(f'Total collected: {len(all_permits)}')
    print(f'After dedup: {len(unique_permits)}')

    # Save results
    output = {
        'source': city_key,
        'portal_type': 'eTRAKiT',
        'scraped_at': datetime.now().isoformat(),
        'target_count': target_count,
        'actual_count': len(unique_permits),
        'errors': errors,
        'permits': unique_permits[:target_count]
    }

    output_file = f'{city_key}_raw.json'
    Path(output_file).write_text(json.dumps(output, indent=2))
    print(f'Saved to: {output_file}')

    # Sample
    print('\nSAMPLE:')
    for p in unique_permits[:5]:
        print(f'  {p["permit_id"]} | {p.get("type", "?")} | {p.get("address", "?")[:40]}')

    return output


if __name__ == '__main__':
    city = sys.argv[1] if len(sys.argv) > 1 else 'frisco'
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
    asyncio.run(scrape_fast(city, count))
