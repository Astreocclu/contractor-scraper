"""
Gemini 3 Pro wrapper for browser-use

Implements BaseChatModel protocol with:
- Rate limiting (10s between requests, 10 req/min, 60s backoff)
- Vision support via Gemini 3 Pro Preview
"""

import asyncio
import base64
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TypeVar, overload

from google import genai
from google.genai import types

from browser_use.llm.base import BaseChatModel, ChatInvokeCompletion
from browser_use.llm.schema import SchemaOptimizer
from browser_use.llm.messages import BaseMessage, UserMessage, AssistantMessage, SystemMessage
from browser_use.llm import ContentImage, ContentText


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

    @property
    def model_name(self) -> str:
        """Compatibility shim for browser-use telemetry/event hooks."""
        return self.model

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
                    # Text content (robust to dicts and different message classes)
                    if isinstance(content, ContentText) or hasattr(content, "text") or isinstance(content, dict) and "text" in content:
                        text_val = content.text if hasattr(content, "text") else content.get("text") if isinstance(content, dict) else str(content)
                        if text_val:
                            parts.append(types.Part.from_text(text=text_val))
                        continue

                    # Image content (robust to dicts and different message classes)
                    if isinstance(content, ContentImage) or hasattr(content, "image_url") or isinstance(content, dict) and "image_url" in content:
                        # Handle base64 image (legacy) or image_url (current)
                        image_base64 = getattr(content, "image_base64", None)
                        image_url = getattr(content, "image_url", None)
                        media_type = getattr(content, "media_type", None)
                        if isinstance(content, dict):
                            image_url = content.get("image_url", image_url)
                            media_type = content.get("media_type", media_type)
                            image_base64 = content.get("image_base64", image_base64)

                        if image_base64:
                            image_data = base64.b64decode(image_base64)
                            parts.append(types.Part.from_bytes(
                                data=image_data,
                                mime_type=media_type or "image/png"
                            ))
                        elif image_url is not None:
                            url = getattr(image_url, "url", None) if not isinstance(image_url, str) else image_url
                            if url:
                                if url.startswith("data:"):
                                    header, b64_data = url.split(",", 1)
                                    mime_type = header.split(";")[0].replace("data:", "") or media_type or "image/png"
                                    image_data = base64.b64decode(b64_data)
                                    parts.append(types.Part.from_bytes(
                                        data=image_data,
                                        mime_type=mime_type
                                    ))
                                else:
                                    parts.append(types.Part.from_uri(
                                        file_uri=url,
                                        mime_type=media_type or "image/png"
                                    ))
                if parts:
                    contents.append(types.Content(role="user", parts=parts))
            elif isinstance(msg, AssistantMessage):
                parts = [types.Part.from_text(text=msg.content)]
                contents.append(types.Content(role="model", parts=parts))

        return system_instruction, contents

    @overload
    async def ainvoke(self, messages: list[BaseMessage], output_format: None = None) -> ChatInvokeCompletion[str]: ...

    @overload
    async def ainvoke(self, messages: list[BaseMessage], output_format: type[T]) -> ChatInvokeCompletion[T]: ...

    async def ainvoke(
        self,
        messages: list[BaseMessage],
        output_format: type[T] | None = None,
        session_id: str | None = None,
        **kwargs
    ) -> ChatInvokeCompletion[T] | ChatInvokeCompletion[str]:
        """
        Invoke Gemini with rate limiting and retry logic.
        """
        _ = session_id
        _ = kwargs
        await self._wait_for_rate_limit()

        system_instruction, contents = self._convert_messages(messages)
        if not contents:
            contents = [types.Content(role="user", parts=[types.Part.from_text(text="continue")])]

        for attempt in range(self.max_retries):
            try:
                if output_format is None:
                    response = await asyncio.to_thread(
                        self._client.models.generate_content,
                        model=self.model,
                        contents=contents,
                        config=types.GenerateContentConfig(
                            temperature=self.temperature,
                            system_instruction=system_instruction,
                        )
                    )
                else:
                    schema = SchemaOptimizer.create_gemini_optimized_schema(output_format)

                    def _strip_additional_props(obj):
                        if isinstance(obj, dict):
                            obj.pop("additionalProperties", None)
                            obj.pop("additional_properties", None)
                            for value in obj.values():
                                _strip_additional_props(value)
                        elif isinstance(obj, list):
                            for item in obj:
                                _strip_additional_props(item)

                    _strip_additional_props(schema)
                    response = await asyncio.to_thread(
                        self._client.models.generate_content,
                        model=self.model,
                        contents=contents,
                        config=types.GenerateContentConfig(
                            temperature=self.temperature,
                            system_instruction=system_instruction,
                            response_mime_type="application/json",
                            response_schema=schema,
                        )
                    )

                # Extract text response
                text = response.text if hasattr(response, 'text') else str(response)

                # Parse to output_format if specified
                if output_format is not None:
                    try:
                        parsed = output_format.model_validate_json(text)
                        return ChatInvokeCompletion(completion=parsed, usage=None)
                    except Exception:
                        try:
                            parsed_json = json.loads(text)
                            result = output_format(**parsed_json) if isinstance(parsed_json, dict) else parsed_json
                            return ChatInvokeCompletion(completion=result, usage=None)
                        except Exception:
                            return ChatInvokeCompletion(completion=text, usage=None)

                return ChatInvokeCompletion(completion=text, usage=None)

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
