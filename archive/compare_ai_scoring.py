#!/usr/bin/env python
"""
Compare New AI Scoring vs Existing Scores

Runs DeepSeek-powered AI scoring on contractors in parallel
and compares results with existing trust scores.
"""

import os
import sys
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional

import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

import requests
from contractors.models import Contractor

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

DEEPSEEK_API_BASE = "https://api.deepseek.com/v1"
MODEL = "deepseek-chat"


# AI Contractor Auditor prompt (inspired by the agentic audit system)
CONTRACTOR_AUDITOR_PROMPT = """You are a forensic contractor auditor analyzing contractor trust and reliability.

Score contractors from 0-100 based on trust, reliability, and risk level.

SCORING METHODOLOGY:
- 80-100 (TRUSTED): Excellent reputation, long history, no red flags, verified
- 65-79 (RECOMMENDED): Good standing, minor gaps, generally trustworthy
- 50-64 (VERIFY): Mixed signals, some concerns, recommend verification
- 35-49 (CAUTION): Multiple concerns, significant risk factors
- 0-34 (AVOID): Critical red flags, high risk, unreliable

FACTORS TO CONSIDER:
1. VERIFICATION (25 pts): Business presence, contact info, BBB status
   - Has address: +5
   - Has phone: +5
   - Has website (https): +5
   - BBB Accredited: +10

2. REPUTATION (35 pts): Ratings across platforms
   - Google 4.5+: +15, 4.0+: +10, 3.5+: +5
   - Yelp 4.0+: +10, 3.5+: +5
   - High review count (100+): +10

3. CREDIBILITY (20 pts): Track record
   - Years in business 10+: +10, 5+: +6, 2+: +3
   - BBB Rating A/A+: +10

4. RED FLAGS (20 pts penalty): Problems
   - BBB F rating: -15
   - High complaints: -10
   - Rating mismatch (Google vs Yelp): -5
   - No online presence: -10

OUTPUT FORMAT (strict JSON):
{
  "score": 72,
  "tier": "RECOMMENDED",
  "step_by_step": "1. Verification: Has address (+5), phone (+5), website (+5), not BBB accredited. Total: 15/25. 2. Reputation: Google 4.6 (+15), no Yelp. Total: 15/35...",
  "reasoning": "Solid contractor with good Google presence but limited verification data.",
  "red_flags": ["No Yelp presence", "Not BBB accredited"],
  "positives": ["Strong Google rating", "Established website"],
  "risk_level": "LOW"
}"""


@dataclass
class AIScoreResult:
    contractor_id: int
    business_name: str
    old_score: int
    new_score: int
    tier: str
    reasoning: str
    red_flags: List[str]
    positives: List[str]
    risk_level: str
    step_by_step: str
    score_diff: int
    error: Optional[str] = None


def get_deepseek_api_key() -> str:
    """Get API key from settings or environment."""
    from django.conf import settings
    key = getattr(settings, 'DEEPSEEK_API_KEY', None) or os.getenv('DEEPSEEK_API_KEY')
    if not key:
        raise ValueError("DEEPSEEK_API_KEY not configured")
    return key


def prepare_contractor_data(contractor: Contractor) -> Dict[str, Any]:
    """Prepare contractor data for AI analysis."""
    return {
        "business_name": contractor.business_name,
        "city": contractor.city,
        "state": contractor.state,
        "has_address": bool(contractor.address),
        "has_phone": bool(contractor.phone),
        "has_website": bool(contractor.website),
        "website_is_https": contractor.website.startswith("https") if contractor.website else False,
        "google_rating": float(contractor.google_rating) if contractor.google_rating else None,
        "google_review_count": contractor.google_review_count or 0,
        "yelp_rating": float(contractor.yelp_rating) if contractor.yelp_rating else None,
        "yelp_review_count": contractor.yelp_review_count or 0,
        "bbb_rating": contractor.bbb_rating,
        "bbb_accredited": contractor.bbb_accredited,
        "bbb_complaint_count": contractor.bbb_complaint_count or 0,
        "bbb_years_in_business": contractor.bbb_years_in_business,
        "current_trust_score": contractor.trust_score,
        "current_tier": contractor.tier,
    }


def call_deepseek(api_key: str, contractor_data: Dict[str, Any]) -> Dict[str, Any]:
    """Call DeepSeek API to score a contractor."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": CONTRACTOR_AUDITOR_PROMPT},
            {"role": "user", "content": f"Analyze and score this contractor:\n\n{json.dumps(contractor_data, indent=2)}"}
        ],
        "max_tokens": 1500,
        "temperature": 0.2
    }

    response = requests.post(
        f"{DEEPSEEK_API_BASE}/chat/completions",
        headers=headers,
        json=payload,
        timeout=60
    )
    response.raise_for_status()

    data = response.json()
    content = data["choices"][0]["message"]["content"]

    # Parse JSON from response
    if "```json" in content:
        content = content.split("```json")[1].split("```")[0]
    elif "```" in content:
        content = content.split("```")[1].split("```")[0]

    match = re.search(r'\{[\s\S]*\}', content)
    if match:
        content = match.group(0)

    return json.loads(content.strip())


def score_contractor(contractor: Contractor, api_key: str) -> AIScoreResult:
    """Score a single contractor using AI."""
    try:
        data = prepare_contractor_data(contractor)
        result = call_deepseek(api_key, data)

        new_score = result.get("score", 50)

        return AIScoreResult(
            contractor_id=contractor.id,
            business_name=contractor.business_name,
            old_score=contractor.trust_score,
            new_score=new_score,
            tier=result.get("tier", "UNKNOWN"),
            reasoning=result.get("reasoning", ""),
            red_flags=result.get("red_flags", []),
            positives=result.get("positives", []),
            risk_level=result.get("risk_level", "UNKNOWN"),
            step_by_step=result.get("step_by_step", ""),
            score_diff=new_score - contractor.trust_score,
            error=None
        )
    except Exception as e:
        logger.error(f"Failed to score {contractor.business_name}: {e}")
        return AIScoreResult(
            contractor_id=contractor.id,
            business_name=contractor.business_name,
            old_score=contractor.trust_score,
            new_score=0,
            tier="ERROR",
            reasoning="",
            red_flags=[],
            positives=[],
            risk_level="UNKNOWN",
            step_by_step="",
            score_diff=0,
            error=str(e)
        )


def run_parallel_scoring(contractors: List[Contractor], api_key: str, max_workers: int = 5) -> List[AIScoreResult]:
    """Score multiple contractors in parallel."""
    results = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_contractor = {
            executor.submit(score_contractor, c, api_key): c
            for c in contractors
        }

        for i, future in enumerate(as_completed(future_to_contractor), 1):
            contractor = future_to_contractor[future]
            try:
                result = future.result()
                results.append(result)
                status = "OK" if not result.error else "ERROR"
                diff_str = f"+{result.score_diff}" if result.score_diff > 0 else str(result.score_diff)
                logger.info(f"[{i}/{len(contractors)}] {contractor.business_name}: {result.old_score} -> {result.new_score} ({diff_str}) [{status}]")
            except Exception as e:
                logger.error(f"[{i}/{len(contractors)}] {contractor.business_name}: FAILED - {e}")

    return results


def generate_comparison_report(results: List[AIScoreResult]) -> str:
    """Generate a comparison report."""
    successful = [r for r in results if not r.error]
    failed = [r for r in results if r.error]

    if not successful:
        return "No successful scorings to compare."

    # Calculate statistics
    avg_old = sum(r.old_score for r in successful) / len(successful)
    avg_new = sum(r.new_score for r in successful) / len(successful)
    avg_diff = sum(r.score_diff for r in successful) / len(successful)

    higher = [r for r in successful if r.score_diff > 0]
    lower = [r for r in successful if r.score_diff < 0]
    same = [r for r in successful if r.score_diff == 0]

    lines = [
        "=" * 80,
        "AI SCORING COMPARISON REPORT",
        "=" * 80,
        "",
        f"Total Contractors Scored: {len(results)}",
        f"Successful: {len(successful)} | Failed: {len(failed)}",
        "",
        "SCORE STATISTICS:",
        f"  Average Old Score: {avg_old:.1f}",
        f"  Average New Score: {avg_new:.1f}",
        f"  Average Difference: {avg_diff:+.1f}",
        "",
        f"Score Changes:",
        f"  Higher (AI scored higher): {len(higher)}",
        f"  Lower (AI scored lower): {len(lower)}",
        f"  Same: {len(same)}",
        "",
        "-" * 80,
        "DETAILED RESULTS (sorted by score difference):",
        "-" * 80,
    ]

    # Sort by score difference
    sorted_results = sorted(successful, key=lambda r: r.score_diff, reverse=True)

    for r in sorted_results:
        diff_str = f"+{r.score_diff}" if r.score_diff >= 0 else str(r.score_diff)
        lines.append("")
        lines.append(f"{r.business_name}")
        lines.append(f"  Old: {r.old_score} -> New: {r.new_score} ({diff_str})")
        lines.append(f"  Tier: {r.tier} | Risk: {r.risk_level}")
        lines.append(f"  Reasoning: {r.reasoning[:100]}...")
        if r.red_flags:
            lines.append(f"  Red Flags: {', '.join(r.red_flags[:3])}")
        if r.positives:
            lines.append(f"  Positives: {', '.join(r.positives[:3])}")

    if failed:
        lines.append("")
        lines.append("-" * 80)
        lines.append("FAILED SCORINGS:")
        lines.append("-" * 80)
        for r in failed:
            lines.append(f"  {r.business_name}: {r.error}")

    lines.append("")
    lines.append("=" * 80)

    return "\n".join(lines)


def main():
    print("\n" + "=" * 60)
    print("   AI CONTRACTOR SCORING COMPARISON")
    print("=" * 60 + "\n")

    # Load environment
    from dotenv import load_dotenv
    load_dotenv()

    try:
        api_key = get_deepseek_api_key()
        print("DeepSeek API key loaded")
    except ValueError as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    # Get contractors with existing scores
    contractors = list(Contractor.objects.filter(trust_score__gt=0).order_by('-trust_score')[:20])
    print(f"Found {len(contractors)} contractors with scores > 0")

    if not contractors:
        print("No contractors found with scores")
        sys.exit(1)

    print(f"\nScoring {len(contractors)} contractors in parallel (5 workers)...\n")

    # Run parallel scoring
    results = run_parallel_scoring(contractors, api_key, max_workers=5)

    # Generate report
    report = generate_comparison_report(results)
    print("\n" + report)

    # Save results to JSON
    output_file = "scoring_comparison.json"
    with open(output_file, "w") as f:
        json.dump([asdict(r) for r in results], f, indent=2)
    print(f"\nDetailed results saved to: {output_file}")


if __name__ == "__main__":
    main()
