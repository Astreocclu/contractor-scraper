"""
Shared DeepSeek AI client for both contractors and clients apps.

Usage:
    from shared.deepseek import DeepSeekClient

    client = DeepSeekClient()
    response = client.analyze("Analyze this text...")
"""

import os
import json
import logging
from typing import Optional, Dict, Any

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class DeepSeekClient:
    """
    Client for DeepSeek API.
    Used by both contractors (review analysis) and clients (permit categorization).
    """

    BASE_URL = "https://api.deepseek.com/v1"
    MODEL = "deepseek-chat"

    def __init__(self, api_key: str = None):
        self.api_key = api_key or getattr(settings, 'DEEPSEEK_API_KEY', None) or os.getenv('DEEPSEEK_API_KEY')
        if not self.api_key:
            logger.warning("No DeepSeek API key configured")

    def _make_request(self, messages: list, max_tokens: int = 1000, temperature: float = 0.3) -> Optional[str]:
        """Make a request to the DeepSeek API."""
        if not self.api_key:
            raise ValueError("DeepSeek API key not configured")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": self.MODEL,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature
        }

        try:
            response = requests.post(
                f"{self.BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
                timeout=60
            )
            response.raise_for_status()

            data = response.json()
            return data["choices"][0]["message"]["content"]

        except requests.exceptions.RequestException as e:
            logger.error(f"DeepSeek API error: {e}")
            raise

    def analyze(self, prompt: str, system_prompt: str = None) -> str:
        """
        Send a prompt to DeepSeek and get a response.

        Args:
            prompt: The user prompt
            system_prompt: Optional system prompt for context

        Returns:
            The response text
        """
        messages = []

        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        messages.append({"role": "user", "content": prompt})

        return self._make_request(messages)

    def analyze_json(self, prompt: str, system_prompt: str = None) -> Dict[str, Any]:
        """
        Send a prompt and parse the JSON response.

        Args:
            prompt: The user prompt (should request JSON output)
            system_prompt: Optional system prompt

        Returns:
            Parsed JSON response
        """
        response = self.analyze(prompt, system_prompt)

        # Try to extract JSON from the response
        try:
            # Handle markdown code blocks
            if "```json" in response:
                response = response.split("```json")[1].split("```")[0]
            elif "```" in response:
                response = response.split("```")[1].split("```")[0]

            return json.loads(response.strip())

        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse JSON response: {e}")
            return {"raw_response": response, "parse_error": str(e)}

    def categorize_permit(self, description: str) -> Dict[str, Any]:
        """
        Categorize a permit based on its description.
        Used by clients app for permit categorization.

        Returns:
            {
                "type": "pool" | "patio" | "new_construction" | ...,
                "subtypes": ["spa", "water_feature", ...],
                "confidence": 0.0-1.0
            }
        """
        system_prompt = """You are a permit categorization expert.
Analyze the permit description and categorize it.
Return ONLY valid JSON with this structure:
{
    "type": "pool" | "patio" | "deck" | "new_construction" | "addition" | "remodel" | "fence" | "other",
    "subtypes": ["optional", "subtypes"],
    "confidence": 0.0-1.0
}"""

        prompt = f"Categorize this permit:\n\n{description}"

        return self.analyze_json(prompt, system_prompt)

    def analyze_reviews(self, reviews: list) -> Dict[str, Any]:
        """
        Analyze contractor reviews for sentiment and red flags.
        Used by contractors app for review analysis.

        Returns:
            {
                "sentiment_score": 0-100,
                "fake_review_risk": 0.0-1.0,
                "red_flags": [...],
                "common_praises": [...],
                "common_complaints": [...]
            }
        """
        system_prompt = """You are a review analysis expert.
Analyze these contractor reviews for:
1. Overall sentiment (0-100)
2. Signs of fake reviews
3. Red flags (safety, quality, reliability issues)
4. Common praises
5. Common complaints

Return ONLY valid JSON."""

        reviews_text = "\n\n".join([f"Review: {r}" for r in reviews[:20]])
        prompt = f"Analyze these contractor reviews:\n\n{reviews_text}"

        return self.analyze_json(prompt, system_prompt)


# Singleton instance for convenience
_client = None


def get_client() -> DeepSeekClient:
    """Get or create a singleton DeepSeek client."""
    global _client
    if _client is None:
        _client = DeepSeekClient()
    return _client
