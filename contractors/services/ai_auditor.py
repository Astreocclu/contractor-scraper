import os
import json
import logging
from typing import List
from dataclasses import dataclass, field

from openai import OpenAI

logger = logging.getLogger(__name__)


@dataclass
class AuditResult:
    sentiment_score: int = 50
    fake_review_count: int = 0
    fake_review_indicators: List[str] = field(default_factory=list)
    common_complaints: List[str] = field(default_factory=list)
    common_praises: List[str] = field(default_factory=list)
    red_flags: List[str] = field(default_factory=list)
    summary: str = ""
    confidence: str = "low"
    yelp_vs_google_conflict: bool = False
    recommended_weight_adjustment: float = 1.0


class ContractorAuditor:
    """AI-powered contractor review analyzer using DeepSeek."""

    # Static system prompt - maximizes DeepSeek cache hits
    SYSTEM_PROMPT = """You are an expert contractor reputation analyst. Your job is to
analyze customer reviews and identify:

1. SENTIMENT: Overall customer satisfaction (0-100 scale)
2. FAKE REVIEWS: Patterns suggesting inauthentic reviews
3. RED FLAGS: Serious concerns about this contractor
4. CONFLICTS: When Google and Yelp reviews tell different stories

Fake review indicators to watch for:
- Generic praise without specifics ("Great job!", "Highly recommend!")
- Timing clusters (many 5-star reviews in same week)
- Reviewer profiles with no other reviews
- Overly perfect language or marketing-speak
- Reviews that read like ads
- Suspiciously similar phrasing across reviews

Red flags to identify:
- Safety concerns mentioned
- Contractor disappeared mid-project
- Threats or intimidation
- Bait-and-switch pricing
- Unlicensed work on licensed trades (electrical, plumbing)
- Property damage
- Repeated same complaint across multiple reviews

Source weighting guidance:
- Yelp reviews are generally MORE trustworthy (stricter fake filtering)
- Google reviews have more volume but more fakes
- If Yelp and Google disagree by 1+ stars, flag the conflict
- Weight recent reviews (last 12 months) higher than older ones

Return ONLY valid JSON matching this exact structure:
{
    "sentiment_score": <int 0-100>,
    "fake_review_count": <int>,
    "fake_review_indicators": [<string>, ...],
    "common_complaints": [<string>, ...],
    "common_praises": [<string>, ...],
    "red_flags": [<string>, ...],
    "summary": "<2-3 sentence summary>",
    "confidence": "<high|medium|low based on review volume>",
    "yelp_vs_google_conflict": <bool>,
    "source_analysis": {
        "google_avg_rating": <float or null>,
        "yelp_avg_rating": <float or null>,
        "google_fake_percentage": <int 0-100>,
        "yelp_fake_percentage": <int 0-100>
    },
    "recommended_weight_adjustment": <float 0.5-1.5, 1.0 = normal>
}

Set confidence based on review count:
- "high": 20+ reviews from multiple sources
- "medium": 10-19 reviews OR single source only
- "low": <10 reviews

The recommended_weight_adjustment should be:
- 1.5 if reviews are exceptionally detailed and consistent
- 1.0 for normal reviews
- 0.7 if many fake indicators found
- 0.5 if severe red flags or very few reviews"""

    def __init__(self):
        api_key = os.environ.get('DEEPSEEK_API_KEY')
        if not api_key:
            raise ValueError("DEEPSEEK_API_KEY not set in environment")

        self.client = OpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com"
        )

    def analyze_reviews(self, business_name: str, reviews: List[dict]) -> AuditResult:
        """
        Analyze contractor reviews for sentiment, fake indicators, and red flags.

        Args:
            business_name: Company name
            reviews: List of {"text": str, "rating": int, "date": str, "source": str}

        Returns:
            AuditResult with analysis data
        """
        result = AuditResult()

        if not reviews:
            result.summary = "No reviews available for analysis."
            return result

        # Separate reviews by source for conflict detection
        google_reviews = [r for r in reviews if r.get("source") == "google"]
        yelp_reviews = [r for r in reviews if r.get("source") == "yelp"]

        reviews_text = json.dumps(reviews, indent=2)

        user_prompt = f"""Analyze reviews for: {business_name}

Google reviews: {len(google_reviews)}
Yelp reviews: {len(yelp_reviews)}

Reviews data:
{reviews_text}"""

        try:
            response = self.client.chat.completions.create(
                model="deepseek-chat",
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                response_format={"type": "json_object"},
                max_tokens=1500,
                temperature=0.2  # Low temp for consistent analysis
            )

            data = json.loads(response.choices[0].message.content)

            result.sentiment_score = min(100, max(0, int(data.get('sentiment_score', 50))))
            result.fake_review_count = int(data.get('fake_review_count', 0))
            result.fake_review_indicators = data.get('fake_review_indicators', [])
            result.common_complaints = data.get('common_complaints', [])
            result.common_praises = data.get('common_praises', [])
            result.red_flags = data.get('red_flags', [])
            result.summary = data.get('summary', '')
            result.confidence = data.get('confidence', 'low')
            result.yelp_vs_google_conflict = data.get('yelp_vs_google_conflict', False)
            result.recommended_weight_adjustment = float(data.get('recommended_weight_adjustment', 1.0))

        except Exception as e:
            logger.error(f"DeepSeek audit failed for {business_name}: {e}")
            result.red_flags = [f"AI analysis failed: {str(e)}"]
            result.summary = "Unable to analyze reviews due to technical error."
            result.recommended_weight_adjustment = 0.5

        return result

    # Backward compatibility alias
    def audit(self, business_name: str, reviews: List[dict]) -> AuditResult:
        """Alias for analyze_reviews() - backward compatibility."""
        return self.analyze_reviews(business_name, reviews)


# Backward compatibility alias
AIAuditor = ContractorAuditor
