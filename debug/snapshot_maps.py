#!/usr/bin/env python3
"""
Debug script to capture Google Maps DOM structure for offline selector development.

Usage:
    python debug/snapshot_maps.py "Claffey Pools" "Southlake, TX"
    python debug/snapshot_maps.py "Orange Elephant Roofing" "Fort Worth, TX" --reviews
"""

import asyncio
import sys
import urllib.parse
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright
from playwright_stealth import Stealth


async def take_snapshot(business_name: str, location: str, open_reviews: bool = False):
    """Capture screenshots and HTML at each step of the Google Maps flow."""

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = business_name.lower().replace(" ", "_")[:20]

    print(f"[Snapshot] Target: {business_name} in {location}")
    print(f"[Snapshot] Output prefix: debug/{slug}_{timestamp}_*")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,  # Always visible for debugging
            args=["--disable-blink-features=AutomationControlled"]
        )

        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
        )

        page = await context.new_page()
        stealth = Stealth()
        await stealth.apply_stealth_async(page)

        try:
            # Step 1: Search
            query = urllib.parse.quote(f"{business_name} {location}")
            url = f"https://www.google.com/maps/search/{query}"
            print(f"[Step 1] Navigating to: {url}")

            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(3)

            await page.screenshot(path=f"debug/{slug}_{timestamp}_1_search.png")
            print(f"[Step 1] Screenshot saved")

            # Step 2: Check for CAPTCHA
            page_text = await page.evaluate("document.body.innerText")
            if "unusual traffic" in page_text.lower() or "robot" in page_text.lower():
                print("[WARNING] CAPTCHA detected!")
                await page.screenshot(path=f"debug/{slug}_{timestamp}_CAPTCHA.png")
                return

            # Step 3: Click first result if we're on a list
            try:
                cards = await page.query_selector_all('[role="article"]')
                if len(cards) > 1:
                    print(f"[Step 2] Found {len(cards)} results, clicking first match...")
                    for card in cards[:3]:
                        text = await card.inner_text()
                        if business_name.split()[0].lower() in text.lower():
                            await card.click()
                            await asyncio.sleep(2)
                            break
            except Exception as e:
                print(f"[Step 2] Click failed: {e}")

            await page.screenshot(path=f"debug/{slug}_{timestamp}_2_business.png")
            print(f"[Step 2] Business page screenshot saved")

            # Step 4: Open reviews panel if requested
            if open_reviews:
                print("[Step 3] Opening reviews panel...")

                # Try multiple selectors for the reviews button
                review_buttons = [
                    'button[aria-label*="Reviews"]',
                    'div[role="tab"][aria-label*="Reviews"]',
                    'button:has-text("Reviews")',
                    '[data-tab-id="2"]',  # Sometimes reviews tab is index 2
                ]

                opened = False
                for selector in review_buttons:
                    try:
                        btn = await page.query_selector(selector)
                        if btn:
                            await btn.click()
                            await asyncio.sleep(2)
                            opened = True
                            print(f"[Step 3] Clicked: {selector}")
                            break
                    except:
                        continue

                if not opened:
                    # Try clicking the star rating/review count
                    try:
                        await page.click('[aria-label*="reviews"]')
                        await asyncio.sleep(2)
                        opened = True
                    except:
                        print("[Step 3] Could not open reviews panel")

                await page.screenshot(path=f"debug/{slug}_{timestamp}_3_reviews.png")
                print(f"[Step 3] Reviews panel screenshot saved")

                # Step 5: Scroll to load more reviews
                print("[Step 4] Scrolling to load reviews...")
                for i in range(3):
                    await page.mouse.wheel(0, 2000)
                    await asyncio.sleep(1.5)

                await page.screenshot(path=f"debug/{slug}_{timestamp}_4_scrolled.png")
                print(f"[Step 4] Scrolled reviews screenshot saved")

            # Step 6: Save HTML
            html = await page.content()
            html_path = f"debug/{slug}_{timestamp}_page.html"
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(html)
            print(f"[Final] HTML saved to {html_path}")

            # Step 7: Analyze DOM structure
            print("\n[Analysis] Review element selectors:")

            # Check what selectors work
            selectors_to_test = [
                ('div[data-review-id]', 'Primary review container'),
                ('div[role="article"]', 'Article role fallback'),
                ('.jftiEf', 'Obfuscated class (fragile)'),
                ('button[aria-label*="Photo of"]', 'Author button'),
                ('[role="img"][aria-label*="stars"]', 'Star rating'),
                ('.wiI7pd', 'Review text class (fragile)'),
                ('.rsqaWe', 'Date class (fragile)'),
                ('button:has-text("More")', 'Expand button'),
            ]

            for selector, description in selectors_to_test:
                try:
                    elements = await page.query_selector_all(selector)
                    count = len(elements)
                    status = "FOUND" if count > 0 else "NOT FOUND"
                    print(f"  {status}: {selector} ({count}) - {description}")
                except:
                    print(f"  ERROR: {selector}")

            print("\n[Done] Review the screenshots and HTML to verify selectors.")

            # Keep browser open for manual inspection
            print("\n[Waiting] Press Ctrl+C to close browser...")
            await asyncio.sleep(300)  # 5 minutes

        except KeyboardInterrupt:
            print("\n[Closing]")
        except Exception as e:
            print(f"[Error] {e}")
            await page.screenshot(path=f"debug/{slug}_{timestamp}_error.png")
        finally:
            await browser.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python debug/snapshot_maps.py <business_name> [location] [--reviews]")
        print("Example: python debug/snapshot_maps.py 'Claffey Pools' 'Southlake, TX' --reviews")
        sys.exit(1)

    business_name = sys.argv[1]
    location = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else "Fort Worth, TX"
    open_reviews = "--reviews" in sys.argv

    asyncio.run(take_snapshot(business_name, location, open_reviews))
