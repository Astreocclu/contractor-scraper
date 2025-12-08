"""
DeepSeek API client for data extraction.

Used by scrapers to extract structured data from HTML.
"""

import os
import logging
from typing import Optional

import httpx

try:
    from scrapers.utils import parse_json
except ImportError:
    from utils import parse_json

logger = logging.getLogger(__name__)

DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY')
DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"


class DeepSeekError(Exception):
    """DeepSeek API error."""
    pass


async def call_deepseek(
    prompt: str,
    max_tokens: int = 4000,
    temperature: float = 0.1,
    timeout: float = 60.0
) -> str:
    """
    Call DeepSeek API for text completion.

    Args:
        prompt: The prompt to send
        max_tokens: Maximum tokens in response
        temperature: Sampling temperature (lower = more deterministic)
        timeout: Request timeout in seconds

    Returns:
        Response text content

    Raises:
        DeepSeekError: If API key not set or API call fails
    """
    if not DEEPSEEK_API_KEY:
        raise DeepSeekError("DEEPSEEK_API_KEY not set in environment")

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(
                DEEPSEEK_API_URL,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {DEEPSEEK_API_KEY}'
                },
                json={
                    'model': 'deepseek-chat',
                    'messages': [{'role': 'user', 'content': prompt}],
                    'temperature': temperature,
                    'max_tokens': max_tokens
                }
            )
            response.raise_for_status()
            data = response.json()
            return data.get('choices', [{}])[0].get('message', {}).get('content', '')

        except httpx.HTTPStatusError as e:
            logger.error(f"DeepSeek API error: {e.response.status_code}")
            raise DeepSeekError(f"API error: {e.response.status_code}")
        except Exception as e:
            logger.error(f"DeepSeek request failed: {e}")
            raise DeepSeekError(f"Request failed: {e}")


async def extract_json(
    prompt: str,
    max_tokens: int = 4000,
    timeout: float = 60.0
) -> Optional[dict]:
    """
    Call DeepSeek and parse JSON from response.

    Convenience wrapper that handles JSON extraction from
    markdown code blocks and raw JSON.

    Args:
        prompt: The prompt (should ask for JSON response)
        max_tokens: Maximum tokens
        timeout: Request timeout

    Returns:
        Parsed JSON dict or None if parsing fails
    """
    response = await call_deepseek(prompt, max_tokens=max_tokens, timeout=timeout)
    return parse_json(response)


async def extract_structured_data(
    html: str,
    extraction_prompt: str,
    max_html_chars: int = 100000,
    max_tokens: int = 4000
) -> Optional[dict]:
    """
    Extract structured data from HTML using DeepSeek.

    Args:
        html: HTML content (will be truncated if too long)
        extraction_prompt: Instructions for what to extract
        max_html_chars: Maximum HTML characters to send
        max_tokens: Maximum response tokens

    Returns:
        Extracted data as dict, or None if extraction fails
    """
    # Truncate HTML if needed
    if len(html) > max_html_chars:
        html = html[:max_html_chars] + "\n... [truncated]"

    full_prompt = f"""{extraction_prompt}

HTML:
{html}"""

    return await extract_json(full_prompt, max_tokens=max_tokens)
