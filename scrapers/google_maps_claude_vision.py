#!/usr/bin/env python3
"""
Google Maps Review Scraper using Playwright + Claude Vision API

Takes screenshots of Google Maps reviews and uses Claude's vision
capabilities to extract structured review data.

Usage:
  python3 scrapers/google_maps_claude_vision.py "Business Name" "City, State" [max_reviews]
"""

import asyncio
import base64
import json
import os
import re
import sys
import urllib.parse
from typing import Optional

import anthropic
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

try:
    from scrapers.utils import get_random_user_agent
except ImportError:
    from utils import get_random_user_agent


async def scrape_reviews(
    business_name: str,
    location: str = "Fort Worth, TX",
    max_reviews: int = 20
) -> dict:
    """
    Use Playwright + Claude Vision to navigate Google Maps and extract reviews.

    Args:
        business_name: Name of the business to search for
        location: City, State to search in
        max_reviews: Maximum number of reviews to extract

    Returns:
        dict with found, reviews, rating, review_count, etc.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {
            "found": False,
            "error": "ANTHROPIC_API_KEY not set",
            "reviews": [],
            "source": "claude_vision"
        }

    print(f"[Claude Vision] Searching for: {business_name} in {location}", file=sys.stderr)

    screenshots = []
    business_info = {"rating": None, "review_count": None, "name": None}

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-sandbox",
            ]
        )
        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent=get_random_user_agent(),
            locale="en-US",
        )
        page = await context.new_page()

        try:
            # Build search URL
            query = urllib.parse.quote(f"{business_name} {location}")
            search_url = f"https://www.google.com/maps/search/{query}"

            print(f"[Claude Vision] Navigating to Google Maps...", file=sys.stderr)
            await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(3)

            # Check for CAPTCHA
            page_text = await page.evaluate("() => document.body.innerText")
            if "unusual traffic" in page_text.lower():
                return {
                    "found": False,
                    "error": "CAPTCHA detected",
                    "reviews": [],
                    "source": "claude_vision"
                }

            # Helper to dismiss sign-in popups
            async def dismiss_popup():
                try:
                    # Use JavaScript to find and click Cancel button
                    dismissed = await page.evaluate("""() => {
                        // Look for Cancel button in sign-in dialog
                        const buttons = document.querySelectorAll('button, span, a, div');
                        for (const btn of buttons) {
                            if (btn.textContent.trim() === 'Cancel') {
                                btn.click();
                                return true;
                            }
                        }
                        // Also try pressing Escape via event
                        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', keyCode: 27}));
                        return false;
                    }""")
                    if dismissed:
                        await asyncio.sleep(0.5)
                        print(f"[Claude Vision] Dismissed sign-in popup", file=sys.stderr)
                        return True

                    # Backup: Press Escape key
                    await page.keyboard.press('Escape')
                    await asyncio.sleep(0.3)
                except Exception as e:
                    pass
                return False

            # Dismiss any initial popups
            await dismiss_popup()

            # Extract basic info from page
            rating_match = re.search(r'(\d\.\d)\s*[\(\[]?\s*(\d[\d,]*)\s*(?:reviews?|ratings?)?', page_text)
            if rating_match:
                business_info["rating"] = float(rating_match.group(1))
                business_info["review_count"] = int(rating_match.group(2).replace(',', ''))

            title = await page.title()
            if " - Google Maps" in title:
                business_info["name"] = title.replace(" - Google Maps", "").strip()

            # Click on business if we're on search results
            search_cards = await page.query_selector_all('[role="article"]')
            if len(search_cards) > 1:
                for card in search_cards[:3]:
                    try:
                        card_text = await card.inner_text()
                        name_words = business_name.lower().split()
                        if any(word in card_text.lower() for word in name_words[:2]):
                            await card.click()
                            await asyncio.sleep(2)
                            await dismiss_popup()  # Dismiss popup after clicking
                            await asyncio.sleep(1)
                            print(f"[Claude Vision] Clicked into business listing", file=sys.stderr)
                            break
                    except:
                        continue

            # Find and click Reviews tab/button
            print(f"[Claude Vision] Looking for Reviews tab...", file=sys.stderr)

            reviews_opened = False

            # Method 1: Click on stars/rating using aria-label (most reliable for Google Maps)
            try:
                # Look for the rating element with aria-label containing "stars"
                rating_el = await page.query_selector('[aria-label*="stars"], [role="img"][aria-label*="star"]')
                if rating_el:
                    box = await rating_el.bounding_box()
                    if box:
                        await page.mouse.click(box['x'] + box['width']/2, box['y'] + box['height']/2)
                        await asyncio.sleep(2)
                        await dismiss_popup()
                        reviews_opened = True
                        print(f"[Claude Vision] Clicked on star rating element", file=sys.stderr)
            except:
                pass

            # Method 1a: Look for and click on reviews count text (e.g., "387 reviews")
            if not reviews_opened:
                try:
                    reviews_link = await page.query_selector('[aria-label*="reviews"], button:has-text("reviews")')
                    if reviews_link:
                        await reviews_link.click()
                        await asyncio.sleep(2)
                        await dismiss_popup()
                        reviews_opened = True
                        print(f"[Claude Vision] Clicked on reviews link", file=sys.stderr)
                except:
                    pass

            # Method 1b: Click the small rating text near the title
            # NOTE: This might open a popup OR might just highlight the rating
            # Don't set reviews_opened here, let subsequent methods handle it
            if not reviews_opened:
                try:
                    # Find the rating badge/text that's clickable
                    clicked = await page.evaluate("""() => {
                        // Look for the clickable rating area - usually has role="button" or is a link
                        const ratingBtns = document.querySelectorAll('[role="button"], a');
                        for (const el of ratingBtns) {
                            const ariaLabel = el.getAttribute('aria-label') || '';
                            if (ariaLabel.includes('reviews') || ariaLabel.includes('stars')) {
                                el.click();
                                return 'aria: ' + ariaLabel;
                            }
                        }
                        return null;
                    }""")
                    if clicked:
                        await asyncio.sleep(2)
                        await dismiss_popup()
                        # Check if reviews panel actually opened (look for review elements)
                        has_reviews = await page.query_selector('[data-review-id], div.jftiEf, div.wiI7pd')
                        if has_reviews:
                            reviews_opened = True
                            print(f"[Claude Vision] Opened reviews via {clicked}", file=sys.stderr)
                        else:
                            print(f"[Claude Vision] Clicked {clicked} but reviews not visible yet", file=sys.stderr)
                except:
                    pass

            # Method 2: Click Reviews tab if visible (try Playwright locator with text)
            if not reviews_opened:
                try:
                    # Use locator to find Reviews text
                    reviews_tab = page.locator('button:has-text("Reviews"), [role="tab"]:has-text("Reviews")')
                    if await reviews_tab.count() > 0:
                        await reviews_tab.first.click()
                        await asyncio.sleep(2)
                        await dismiss_popup()
                        reviews_opened = True
                        print(f"[Claude Vision] Clicked Reviews tab via locator", file=sys.stderr)
                except:
                    pass

            # Method 2b: Try various selectors for Reviews tab
            if not reviews_opened:
                review_selectors = [
                    'button[aria-label*="Reviews"]',
                    'div[role="tab"][aria-label*="Reviews"]',
                    '[data-tab-id="2"]',
                    'button[aria-label*="review"]',
                ]
                for selector in review_selectors:
                    try:
                        btn = await page.query_selector(selector)
                        if btn:
                            await btn.click()
                            await asyncio.sleep(2)
                            await dismiss_popup()
                            reviews_opened = True
                            print(f"[Claude Vision] Opened reviews panel via {selector}", file=sys.stderr)
                            break
                    except:
                        continue

            # Method 3: Try clicking review count text directly
            if not reviews_opened:
                try:
                    await page.click('text=/\\d+\\s+reviews?/i')
                    await asyncio.sleep(2)
                    reviews_opened = True
                    print(f"[Claude Vision] Clicked reviews count text", file=sys.stderr)
                except:
                    pass

            # Method 4: Scroll the left panel to find reviews section
            if not reviews_opened:
                print(f"[Claude Vision] Scrolling left panel to find reviews...", file=sys.stderr)
                # Find the scrollable left panel
                left_panel = await page.query_selector('div[role="main"], div.m6QErb')
                if left_panel:
                    for _ in range(5):
                        await left_panel.evaluate('(el) => el.scrollBy(0, 300)')
                        await asyncio.sleep(0.5)
                        # Check if reviews are now visible
                        reviews_visible = await page.query_selector('[data-review-id], div.jftiEf')
                        if reviews_visible:
                            print(f"[Claude Vision] Found reviews after scrolling", file=sys.stderr)
                            reviews_opened = True
                            break
                else:
                    # Fallback to window scroll
                    for _ in range(3):
                        await page.evaluate('window.scrollBy(0, 400)')
                        await asyncio.sleep(0.5)

            # Dismiss any sign-in popups that appeared after clicking reviews
            await dismiss_popup()
            await asyncio.sleep(0.5)
            await dismiss_popup()  # Try twice in case one appears after dismissing

            # Find the scrollable container - prioritize the left panel
            scroll_container = None
            # First try to find the main scrollable panel in Google Maps
            scroll_selectors = [
                'div[role="main"]',  # Main container
                'div.m6QErb.DxyBCb.kA9KIf.dS8AEf',  # Reviews panel scrollable area
                'div.m6QErb.DxyBCb.kA9KIf',
                'div.m6QErb.DxyBCb',
                'div.m6QErb',  # Generic scrollable container
            ]
            for sel in scroll_selectors:
                try:
                    containers = await page.query_selector_all(sel)
                    for container in containers:
                        # Check if it's scrollable
                        is_scrollable = await container.evaluate('(el) => el.scrollHeight > el.clientHeight')
                        if is_scrollable:
                            scroll_container = container
                            print(f"[Claude Vision] Found scrollable container: {sel}", file=sys.stderr)
                            break
                    if scroll_container:
                        break
                except:
                    continue

            # Dismiss any lingering popups before scrolling
            await dismiss_popup()

            # Scroll down to find reviews section
            print(f"[Claude Vision] Scrolling to find reviews...", file=sys.stderr)
            for _ in range(4):
                if scroll_container:
                    await scroll_container.evaluate('(el) => el.scrollBy(0, 400)')
                else:
                    await page.evaluate('window.scrollBy(0, 400)')
                await asyncio.sleep(0.6)
                await dismiss_popup()

            # Scroll back to near top (but not all the way, reviews might be below fold)
            if scroll_container:
                await scroll_container.evaluate('(el) => el.scrollTo(0, 200)')
            await asyncio.sleep(0.5)
            await dismiss_popup()

            # Expand all "More" buttons to show full review text
            try:
                more_buttons = await page.query_selector_all('button.w8nwRe.kyuRq')
                for btn in more_buttons[:10]:
                    try:
                        await btn.click()
                        await asyncio.sleep(0.2)
                    except:
                        pass
                if more_buttons:
                    print(f"[Claude Vision] Expanded {len(more_buttons)} review texts", file=sys.stderr)
            except:
                pass

            # Final popup check before screenshots
            for _ in range(3):  # Try up to 3 times
                if await dismiss_popup():
                    await asyncio.sleep(0.5)
                else:
                    break

            # Take screenshots while scrolling - more screenshots, bigger scrolls
            num_screenshots = min(5, max(3, (max_reviews // 4) + 1))  # 3-5 screenshots
            scroll_distance = 700  # pixels per scroll
            print(f"[Claude Vision] Taking {num_screenshots} screenshots...", file=sys.stderr)

            for i in range(num_screenshots):
                # Expand any "More" buttons visible
                try:
                    more_btns = await page.query_selector_all('button.w8nwRe.kyuRq')
                    for btn in more_btns[:5]:
                        try:
                            await btn.click()
                        except:
                            pass
                except:
                    pass

                # Take screenshot
                screenshot_bytes = await page.screenshot(full_page=False)
                screenshot_b64 = base64.b64encode(screenshot_bytes).decode('utf-8')
                screenshots.append(screenshot_b64)

                # Debug: save screenshot to file
                debug_path = f"/tmp/gmaps_debug_{i}.png"
                with open(debug_path, 'wb') as f:
                    f.write(screenshot_bytes)
                print(f"[Claude Vision] Screenshot {i+1}/{num_screenshots} captured", file=sys.stderr)

                if i < num_screenshots - 1:
                    # Scroll down to next set of reviews
                    if scroll_container:
                        await scroll_container.evaluate(f'(el) => el.scrollBy(0, {scroll_distance})')
                    else:
                        await page.evaluate(f'window.scrollBy(0, {scroll_distance})')
                    await asyncio.sleep(1.2)  # Wait for content to load

        except PlaywrightTimeout as e:
            return {
                "found": False,
                "error": f"Timeout: {e}",
                "reviews": [],
                "source": "claude_vision"
            }
        except Exception as e:
            return {
                "found": False,
                "error": f"Browser error: {e}",
                "reviews": [],
                "source": "claude_vision"
            }
        finally:
            await browser.close()

    if not screenshots:
        return {
            "found": False,
            "error": "No screenshots captured",
            "reviews": [],
            "source": "claude_vision"
        }

    # Send screenshots to Claude Vision API
    print(f"[Claude Vision] Sending {len(screenshots)} screenshots to Claude API...", file=sys.stderr)

    try:
        client = anthropic.Anthropic(api_key=api_key)

        # Build message content with all screenshots
        content = []
        for i, screenshot in enumerate(screenshots):
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": screenshot
                }
            })

        content.append({
            "type": "text",
            "text": f"""Extract Google Maps business information and reviews for "{business_name}".

ALWAYS extract (these should be visible):
- Business name (from the page header)
- Star rating (e.g., 4.5 - look for the stars near the business name)
- Review count if shown (e.g., "(123)" or "123 reviews" near the stars)

For each review visible, extract:
1. Full review text (the actual customer review content)
2. Star rating (1-5 stars)
3. Reviewer name
4. Date (e.g., "2 months ago")

NOTE: Google Maps may show "limited view" for non-logged-in users. If you see:
- "You're seeing a limited view of Google Maps"
- No reviews tab or individual reviews visible
Still extract the business name, star rating, and any review count shown.

Return ONLY valid JSON in this exact format:
{{
  "business_name": "Name from page",
  "rating": 4.5,
  "review_count": 123,
  "reviews": [
    {{"text": "Full review text...", "rating": 5, "author": "John D.", "date": "2 months ago"}}
  ],
  "limited_view": false
}}

Set "limited_view": true if you see the limited view message and no reviews are visible.
If no reviews visible, return empty reviews array but STILL include rating.
Maximum {max_reviews} reviews. Return ONLY the JSON."""
        })

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{"role": "user", "content": content}]
        )

        # Parse Claude's response
        response_text = response.content[0].text
        print(f"[Claude Vision] Got response from Claude", file=sys.stderr)

        # Extract JSON from response
        parsed = parse_claude_response(response_text)

        if parsed:
            reviews = parsed.get("reviews", [])
            rating = parsed.get("rating") or business_info.get("rating")
            limited_view = parsed.get("limited_view", False)

            if reviews:
                print(f"[Claude Vision] Extracted {len(reviews)} reviews", file=sys.stderr)
            elif limited_view:
                print(f"[Claude Vision] Limited view detected - rating only", file=sys.stderr)
            else:
                print(f"[Claude Vision] No reviews found in screenshots", file=sys.stderr)

            return {
                "found": True if rating else False,
                "name": parsed.get("business_name") or business_info.get("name"),
                "rating": rating,
                "review_count": parsed.get("review_count") or business_info.get("review_count") or (len(reviews) if reviews else None),
                "reviews": reviews[:max_reviews] if reviews else [],
                "source": "claude_vision",
                "limited_view": limited_view,
                "error": "Limited view - reviews hidden" if limited_view and not reviews else None
            }
        else:
            return {
                "found": business_info.get("rating") is not None,
                "name": business_info.get("name"),
                "rating": business_info.get("rating"),
                "review_count": business_info.get("review_count"),
                "reviews": [],
                "source": "claude_vision",
                "error": "Failed to parse Claude response"
            }

    except anthropic.APIError as e:
        return {
            "found": False,
            "error": f"Claude API error: {e}",
            "reviews": [],
            "source": "claude_vision"
        }
    except Exception as e:
        return {
            "found": False,
            "error": f"Extraction error: {e}",
            "reviews": [],
            "source": "claude_vision"
        }


def parse_claude_response(response_text: str) -> Optional[dict]:
    """Parse JSON from Claude's response."""
    if not response_text:
        return None

    # Try direct JSON parse
    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON block in response
    try:
        # Look for JSON with reviews array
        json_match = re.search(r'\{[\s\S]*"reviews"\s*:\s*\[[\s\S]*\][\s\S]*\}', response_text)
        if json_match:
            return json.loads(json_match.group())
    except json.JSONDecodeError:
        pass

    # Try markdown code block
    try:
        code_match = re.search(r'```(?:json)?\s*(\{[\s\S]*?\})\s*```', response_text)
        if code_match:
            return json.loads(code_match.group(1))
    except json.JSONDecodeError:
        pass

    return None


async def main():
    if len(sys.argv) < 2:
        print("Usage: python3 google_maps_claude_vision.py 'Business Name' ['City, State'] [max_reviews]")
        sys.exit(1)

    business_name = sys.argv[1]
    location = sys.argv[2] if len(sys.argv) > 2 else "Fort Worth, TX"
    max_reviews = int(sys.argv[3]) if len(sys.argv) > 3 else 20

    result = await scrape_reviews(business_name, location, max_reviews)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
