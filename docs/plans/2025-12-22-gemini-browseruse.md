# Gemini 3 Pro for browser-use Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace DeepSeek with Gemini 3 Pro Preview in browser-use scraper, enable vision mode, add generous rate limiting.

**Architecture:** Create `ChatGemini` wrapper implementing browser-use's `BaseChatModel` protocol, using `google-genai` SDK.

**Tech Stack:** Python 3.11, browser-use 0.11.1, google-genai SDK

---

## Task 1: Create ChatGemini Wrapper Class

**Files:**
- Create: `scrapers/llm_gemini.py`

**Step 1: Create the wrapper file**

Create `scrapers/llm_gemini.py`:

```python
"""
Gemini 3 Pro wrapper for browser-use

Implements BaseChatModel protocol with:
- Rate limiting (10s between requests, 10 req/min, 60s backoff)
- Vision support via Gemini 3 Pro Preview
"""

import asyncio
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TypeVar, overload

from google import genai
from google.genai import types

from browser_use.llm.base import BaseChatModel, ChatInvokeCompletion
from browser_use.llm.messages import BaseMessage, UserMessage, AssistantMessage, SystemMessage
from browser_use.llm.views import ContentImage, ContentText


T = TypeVar('T')


# Global rate limiting state
_request_timestamps: list[datetime] = []
_last_request_time: datetime | None = None
_rate_limit_lock = asyncio.Lock()


@dataclass
class ChatGemini:
    """
    Gemini 3 Pro wrapper implementing browser-use BaseChatModel protocol.

    Features:
    - Native vision support (use_vision=True compatible)
    - Generous rate limiting (10s interval, 10 RPM, 60s backoff)
    - Automatic retry on 429 errors
    """

    model: str = "gemini-3-pro-preview"
    api_key: str | None = None
    temperature: float = 0.1
    max_retries: int = 3
    min_interval: float = 10.0  # 10 seconds between requests
    max_per_minute: int = 10    # Max 10 requests per minute
    backoff_seconds: float = 60.0  # 60 second backoff on 429

    _client: genai.Client = field(init=False, repr=False)

    def __post_init__(self):
        key = self.api_key or os.environ.get("GOOGLE_API_KEY")
        if not key:
            raise ValueError("GOOGLE_API_KEY not set")
        self._client = genai.Client(api_key=key)

    @property
    def provider(self) -> str:
        return "google"

    @property
    def name(self) -> str:
        return f"gemini/{self.model}"

    async def _wait_for_rate_limit(self) -> None:
        """Enforce rate limiting before making a request."""
        global _request_timestamps, _last_request_time

        async with _rate_limit_lock:
            now = datetime.now()

            # Enforce minimum interval between requests
            if _last_request_time:
                elapsed = (now - _last_request_time).total_seconds()
                if elapsed < self.min_interval:
                    wait_time = self.min_interval - elapsed
                    print(f"[Gemini] Rate limit: waiting {wait_time:.1f}s", file=sys.stderr)
                    await asyncio.sleep(wait_time)
                    now = datetime.now()

            # Enforce max requests per minute
            minute_ago = now - timedelta(minutes=1)
            _request_timestamps = [ts for ts in _request_timestamps if ts > minute_ago]

            if len(_request_timestamps) >= self.max_per_minute:
                oldest = min(_request_timestamps)
                wait_time = 60 - (now - oldest).total_seconds()
                if wait_time > 0:
                    print(f"[Gemini] Rate limit: {self.max_per_minute} RPM hit, waiting {wait_time:.1f}s", file=sys.stderr)
                    await asyncio.sleep(wait_time)
                    now = datetime.now()

            # Record this request
            _request_timestamps.append(now)
            _last_request_time = now

    def _convert_messages(self, messages: list[BaseMessage]) -> tuple[str | None, list[types.Content]]:
        """Convert browser-use messages to Gemini format."""
        system_instruction = None
        contents = []

        for msg in messages:
            if isinstance(msg, SystemMessage):
                # Gemini handles system messages separately
                system_instruction = msg.content
            elif isinstance(msg, UserMessage):
                parts = []
                for content in msg.content:
                    if isinstance(content, ContentText):
                        parts.append(types.Part.from_text(content.text))
                    elif isinstance(content, ContentImage):
                        # Handle base64 image
                        if content.image_base64:
                            parts.append(types.Part.from_bytes(
                                data=content.image_base64,
                                mime_type=content.media_type or "image/png"
                            ))
                contents.append(types.Content(role="user", parts=parts))
            elif isinstance(msg, AssistantMessage):
                parts = [types.Part.from_text(msg.content)]
                contents.append(types.Content(role="model", parts=parts))

        return system_instruction, contents

    @overload
    async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

    @overload
    async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

    async def ainvoke(
        self,
        messages: list[BaseMessage],
        output_format: type[T] | None = None
    ) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
        """
        Invoke Gemini with rate limiting and retry logic.
        """
        await self._wait_for_rate_limit()

        system_instruction, contents = self._convert_messages(messages)

        for attempt in range(self.max_retries):
            try:
                response = await asyncio.to_thread(
                    self._client.models.generate_content,
                    model=self.model,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        temperature=self.temperature,
                        system_instruction=system_instruction,
                    )
                )

                # Extract text response
                text = response.text if hasattr(response, 'text') else str(response)

                # Parse to output_format if specified
                if output_format is not None:
                    # Try to parse as the expected type
                    try:
                        import json
                        parsed = json.loads(text)
                        result = output_format(**parsed) if isinstance(parsed, dict) else parsed
                        return ChatInvokeCompletion(content=result)
                    except Exception:
                        return ChatInvokeCompletion(content=text)

                return ChatInvokeCompletion(content=text)

            except Exception as e:
                error_str = str(e).lower()
                if "429" in error_str or "rate" in error_str or "quota" in error_str:
                    if attempt < self.max_retries - 1:
                        backoff = self.backoff_seconds * (2 ** attempt)
                        print(f"[Gemini] 429 error, backing off {backoff}s (attempt {attempt + 1}/{self.max_retries})", file=sys.stderr)
                        await asyncio.sleep(backoff)
                        continue
                raise

        raise Exception(f"Failed after {self.max_retries} attempts")
```

**Step 2: Verify syntax**

```bash
python3.11 -m py_compile scrapers/llm_gemini.py
```

Expected: No output (success)

**Step 3: Commit**

```bash
git add scrapers/llm_gemini.py
git commit -m "feat: add ChatGemini wrapper for browser-use

- Implements BaseChatModel protocol for browser-use
- Uses google-genai SDK with gemini-3-pro-preview
- Rate limiting: 10s interval, 10 RPM max, 60s backoff
- Vision support via native Gemini multimodal"
```

---

## Task 2: Update google_maps_browseruse.py

**Files:**
- Modify: `scrapers/google_maps_browseruse.py`

**Step 1: Update imports**

Replace the imports section:

```python
#!/usr/bin/env python3.11
"""
Google Maps Review Scraper using browser-use + Gemini 3 Pro
Uses vision mode for better accuracy

Usage:
  python3.11 scrapers/google_maps_browseruse.py "Business Name" "City, State" [max_reviews]
"""

import asyncio
import json
import os
import re
import sys
from typing import Optional

# browser-use imports
from browser_use import Agent

# Local Gemini wrapper with rate limiting
from llm_gemini import ChatGemini
```

**Step 2: Update the scrape_reviews function**

Replace the LLM configuration and agent setup:

```python
async def scrape_reviews(
    business_name: str,
    location: str = "Fort Worth, TX",
    max_reviews: int = 20
) -> dict:
    """
    Use browser-use + Gemini 3 Pro to navigate Google Maps and extract reviews.
    Vision mode enabled for better element detection.
    """

    # Check for API key
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return {
            "found": False,
            "error": "GOOGLE_API_KEY not set",
            "reviews": [],
            "source": "browser_use_gemini"
        }

    # Configure Gemini 3 Pro with vision support
    llm = ChatGemini(
        model="gemini-3-pro-preview",
        api_key=api_key,
        temperature=0.1,
        min_interval=10.0,     # 10s between requests
        max_per_minute=10,     # Max 10 RPM
        backoff_seconds=60.0,  # 60s backoff on 429
    )

    # Task with vision-aware instructions
    task = f"""
TASK: Find and extract Google Maps reviews for "{business_name}" in "{location}".

VISUAL NAVIGATION:
1. Go to https://www.google.com/maps
2. Search for "{business_name} {location}"
3. LOOK at the search results - click the one matching the business name
4. Find the Reviews section (look for star icons and review count)
5. Scroll to load reviews

EXTRACTION (up to {max_reviews} reviews):
For each review, extract:
- Full review text (click "More" if truncated)
- Star rating (count filled stars, 1-5)
- Reviewer name
- Date (e.g., "2 months ago")

Also extract:
- Overall rating (e.g., 4.5)
- Total review count

OUTPUT FORMAT (JSON only):
{{
  "business_name": "...",
  "rating": 4.5,
  "review_count": 123,
  "reviews": [
    {{"text": "...", "rating": 5, "author": "...", "date": "..."}}
  ]
}}
"""

    try:
        print(f"[browser-use+Gemini] Starting for: {business_name}", file=sys.stderr)

        agent = Agent(
            task=task,
            llm=llm,
            use_vision=True,   # ENABLED - Gemini has native vision
            headless=True,
            max_steps=15,
        )

        result = await agent.run()
        parsed = parse_agent_result(result)

        if parsed and parsed.get("reviews"):
            print(f"[browser-use+Gemini] Extracted {len(parsed['reviews'])} reviews", file=sys.stderr)
            return {
                "found": True,
                "name": parsed.get("business_name", business_name),
                "rating": parsed.get("rating"),
                "review_count": parsed.get("review_count") or len(parsed["reviews"]),
                "reviews": parsed["reviews"][:max_reviews],
                "source": "browser_use_gemini",
                "error": None
            }
        else:
            return {
                "found": True if parsed else False,
                "name": parsed.get("business_name") if parsed else None,
                "rating": parsed.get("rating") if parsed else None,
                "review_count": parsed.get("review_count") if parsed else None,
                "error": "No reviews extracted" if not parsed else None,
                "reviews": [],
                "source": "browser_use_gemini"
            }

    except Exception as e:
        print(f"[browser-use+Gemini] Error: {e}", file=sys.stderr)
        return {
            "found": False,
            "error": str(e),
            "reviews": [],
            "source": "browser_use_gemini"
        }
```

**Step 3: Verify syntax**

```bash
python3.11 -m py_compile scrapers/google_maps_browseruse.py
```

**Step 4: Commit**

```bash
git add scrapers/google_maps_browseruse.py
git commit -m "feat: switch browser-use from DeepSeek to Gemini 3 Pro

- Use ChatGemini wrapper with vision support
- Enable use_vision=True for screenshot-based navigation
- Rate limiting: 10s interval, 10 RPM, 60s backoff
- Update source tag to 'browser_use_gemini'"
```

---

## Task 3: Add GOOGLE_API_KEY to Environment

**Files:**
- Modify: `.env`

**Step 1: Add the API key**

Add to `.env`:

```bash
# Gemini 3 Pro for browser-use vision
GOOGLE_API_KEY=<your-google-api-key>
```

**Step 2: Verify .env is gitignored**

```bash
grep -q "^\.env$" .gitignore && echo "OK: .env is gitignored" || echo "WARNING: add .env to .gitignore"
```

**Step 3: No commit (secrets file)**

---

## Task 4: Test the Integration

**Step 1: Quick import test**

```bash
cd /home/reid/testhome/contractor-auditor
python3.11 -c "
from scrapers.llm_gemini import ChatGemini
llm = ChatGemini()
print(f'Provider: {llm.provider}')
print(f'Model: {llm.model}')
print('ChatGemini initialized successfully')
"
```

Expected: Provider: google, Model: gemini-3-pro-preview

**Step 2: Run scraper test**

```bash
cd /home/reid/testhome/contractor-auditor
export GOOGLE_API_KEY=<your-google-api-key>
python3.11 scrapers/google_maps_browseruse.py "Claffey Pools" "Dallas, TX" 5 2>&1 | head -50
```

Expected: Scraper runs with vision, extracts reviews

**Step 3: Verify rate limiting**

```bash
# Run twice quickly - second should wait 10s
time python3.11 -c "
import asyncio
from scrapers.llm_gemini import ChatGemini
from browser_use.llm.messages import UserMessage
from browser_use.llm.views import ContentText

async def test():
    llm = ChatGemini()
    msg = UserMessage(content=[ContentText(text='Say hello')])

    print('Request 1...')
    await llm.ainvoke([msg])
    print('Request 2 (should wait 10s)...')
    await llm.ainvoke([msg])
    print('Done')

asyncio.run(test())
"
```

Expected: ~10 second gap between requests

---

## Task 5: Update Documentation

**Files:**
- Modify: `scrapers/README.md` (if exists)
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md**

Add to the scrapers section:

```markdown
### browser-use + Gemini 3 Pro
- `scrapers/google_maps_browseruse.py` - Vision-based Google Maps scraper
- Uses `scrapers/llm_gemini.py` - ChatGemini wrapper with rate limiting
- Requires: `GOOGLE_API_KEY` environment variable
- Rate limits: 10s between requests, 10 req/min, 60s backoff on 429
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Gemini browser-use integration notes"
```

---

## Summary

| Task | What Changes | Risk |
|------|--------------|------|
| 1 | Create ChatGemini wrapper | MEDIUM - new code |
| 2 | Update google_maps_browseruse.py | LOW - swap LLM |
| 3 | Add API key to .env | LOW |
| 4 | Test integration | N/A |
| 5 | Update docs | TRIVIAL |

**Total tasks:** 5
**Estimated risk:** LOW-MEDIUM

**Key files:**
- NEW: `scrapers/llm_gemini.py`
- MODIFIED: `scrapers/google_maps_browseruse.py`
- MODIFIED: `.env`

Sources:
- [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3)
- [Gemini 3 Pro on Vertex AI](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro)
