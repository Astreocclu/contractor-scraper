import os
import json
import logging
from typing import List
from dataclasses import dataclass, field

import google.generativeai as genai

logger = logging.getLogger(__name__)


@dataclass
class AuditResult:
    sentiment_score: int = 50
    fake_review_count: int = 0
    red_flags: List[str] = field(default_factory=list)
    summary: str = ""


class AIAuditor:
    def __init__(self):
        api_key = os.environ.get('GOOGLE_API_KEY')
        if not api_key:
            raise ValueError("GOOGLE_API_KEY required")
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-1.5-flash')

    def audit(self, business_name: str, reviews: List[dict]) -> AuditResult:
        result = AuditResult()
        if not reviews:
            result.summary = "No reviews available."
            return result

        review_text = "\n".join([
            f"- {r.get('rating', '?')}/5: {r.get('text', '')[:200]}"
            for r in reviews[:30]
        ])

        prompt = f"""Analyze reviews for "{business_name}":

{review_text}

Return ONLY JSON:
{{
    "sentiment_score": <0-100>,
    "fake_review_count": <number>,
    "red_flags": [<list of serious concerns>],
    "summary": "<2 sentence summary>"
}}"""

        try:
            response = self.model.generate_content(prompt)
            text = response.text.strip()
            if text.startswith('```'):
                text = text.split('```')[1].replace('json', '').strip()

            data = json.loads(text)
            result.sentiment_score = min(100, max(0, int(data.get('sentiment_score', 50))))
            result.fake_review_count = int(data.get('fake_review_count', 0))
            result.red_flags = data.get('red_flags', [])
            result.summary = data.get('summary', '')
        except Exception as e:
            logger.error(f"AI audit failed: {e}")
            result.summary = "Analysis failed."

        return result
