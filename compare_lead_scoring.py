#!/usr/bin/env python
"""
Compare New AI Lead Scoring vs Existing Scores

Uses the SalesDirectorScorer from scoring_experimental.py to rescore
leads in parallel and compare with existing scores.
"""

import os
import sys
import json
from datetime import date
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional

import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from clients.models import Lead, Property, Permit
from clients.services.scoring_experimental import SalesDirectorScorer, ScoringResult

import logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)


@dataclass
class LeadComparisonResult:
    lead_id: str
    owner_name: str
    project_description: str
    market_value: float
    permit_date: str
    old_score: float
    old_tier: str
    new_score: int
    new_tier: str
    score_diff: float
    reasoning: str
    ideal_contractor: str
    flags: List[str]
    chain_of_thought: str
    error: Optional[str] = None


def get_lead_data(lead: Lead) -> Dict[str, Any]:
    """Prepare lead data for AI scoring."""
    prop = lead.property

    # Get permit data
    permits = Permit.objects.filter(property_address=prop.property_address).order_by('-issued_date')
    permit = permits.first()

    return {
        "lead_id": lead.lead_id,
        "project_description": permit.description if permit else lead.lead_type or "Unknown",
        "permit_type": permit.permit_type if permit else None,
        "permit_date": str(permit.issued_date) if permit and permit.issued_date else None,
        "issued_date": permit.issued_date if permit else None,
        "market_value": float(prop.market_value) if prop.market_value else 0,
        "total_value": float(prop.market_value) if prop.market_value else 0,
        "owner_name": prop.owner_name or "Unknown",
        "owner": prop.owner_name or "Unknown",
        "is_absentee": lead.is_absentee or prop.is_absentee,
        "lead_source": "Permit",
        "old_score": lead.score,
        "old_tier": lead.tier,
    }


def score_lead(lead: Lead, scorer: SalesDirectorScorer) -> LeadComparisonResult:
    """Score a single lead using AI."""
    try:
        lead_data = get_lead_data(lead)

        # Call the AI scorer
        result = scorer.score_lead(lead_data, use_fallback_on_error=False)

        return LeadComparisonResult(
            lead_id=lead.lead_id[:12],
            owner_name=(lead_data["owner_name"] or "Unknown")[:30],
            project_description=(lead_data["project_description"] or "Unknown")[:40],
            market_value=lead_data["market_value"],
            permit_date=lead_data["permit_date"] or "Unknown",
            old_score=lead_data["old_score"],
            old_tier=lead_data["old_tier"],
            new_score=result.score,
            new_tier=result.tier,
            score_diff=result.score - lead_data["old_score"],
            reasoning=result.reasoning,
            ideal_contractor=result.ideal_contractor,
            flags=result.flags,
            chain_of_thought=result.chain_of_thought,
            error=None
        )
    except Exception as e:
        logger.error(f"Failed to score lead {lead.lead_id}: {e}")
        lead_data = get_lead_data(lead)
        return LeadComparisonResult(
            lead_id=lead.lead_id[:12],
            owner_name=(lead_data["owner_name"] or "Unknown")[:30],
            project_description=(lead_data["project_description"] or "Unknown")[:40],
            market_value=lead_data["market_value"],
            permit_date=lead_data["permit_date"] or "Unknown",
            old_score=lead_data["old_score"],
            old_tier=lead_data["old_tier"],
            new_score=0,
            new_tier="ERROR",
            score_diff=0,
            reasoning="",
            ideal_contractor="",
            flags=[],
            chain_of_thought="",
            error=str(e)
        )


def run_parallel_scoring(leads: List[Lead], scorer: SalesDirectorScorer, max_workers: int = 5) -> List[LeadComparisonResult]:
    """Score multiple leads in parallel."""
    results = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_lead = {
            executor.submit(score_lead, lead, scorer): lead
            for lead in leads
        }

        for i, future in enumerate(as_completed(future_to_lead), 1):
            lead = future_to_lead[future]
            try:
                result = future.result()
                results.append(result)
                status = "OK" if not result.error else "ERROR"
                diff_str = f"+{result.score_diff:.0f}" if result.score_diff > 0 else f"{result.score_diff:.0f}"
                logger.info(f"[{i}/{len(leads)}] {result.owner_name[:20]}: {result.old_score:.0f} -> {result.new_score} ({diff_str}) [{status}]")
            except Exception as e:
                logger.error(f"[{i}/{len(leads)}] Lead {lead.lead_id}: FAILED - {e}")

    return results


def generate_comparison_report(results: List[LeadComparisonResult]) -> str:
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

    # Tier changes
    tier_changes = sum(1 for r in successful if r.old_tier != r.new_tier)

    lines = [
        "=" * 90,
        "LEAD SCORING COMPARISON: Existing Scores vs SalesDirectorScorer AI",
        "=" * 90,
        "",
        f"Total Leads Scored: {len(results)}",
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
        f"  Tier Changes: {tier_changes}",
        "",
        "-" * 90,
        "DETAILED RESULTS (sorted by score difference):",
        "-" * 90,
    ]

    # Sort by score difference
    sorted_results = sorted(successful, key=lambda r: r.score_diff, reverse=True)

    for r in sorted_results:
        diff_str = f"+{r.score_diff:.0f}" if r.score_diff >= 0 else f"{r.score_diff:.0f}"
        tier_change = f"{r.old_tier}->{r.new_tier}" if r.old_tier != r.new_tier else r.old_tier
        lines.append("")
        lines.append(f"{r.owner_name} | ${r.market_value:,.0f}")
        lines.append(f"  Project: {r.project_description}")
        lines.append(f"  Score: {r.old_score:.0f} -> {r.new_score} ({diff_str}) | Tier: {tier_change}")
        lines.append(f"  Ideal Contractor: {r.ideal_contractor}")
        lines.append(f"  AI Reasoning: {r.reasoning[:80]}...")
        if r.flags:
            lines.append(f"  Flags: {', '.join(r.flags)}")

    if failed:
        lines.append("")
        lines.append("-" * 90)
        lines.append("FAILED SCORINGS:")
        lines.append("-" * 90)
        for r in failed:
            lines.append(f"  {r.lead_id}: {r.error}")

    lines.append("")
    lines.append("=" * 90)

    return "\n".join(lines)


def main():
    print("\n" + "=" * 70)
    print("   LEAD SCORING COMPARISON: Existing vs SalesDirectorScorer AI")
    print("=" * 70 + "\n")

    # Load environment
    from dotenv import load_dotenv
    load_dotenv()

    # Initialize scorer
    try:
        scorer = SalesDirectorScorer()
        if not scorer.api_key:
            print("ERROR: DeepSeek API key not configured")
            sys.exit(1)
        print("DeepSeek API key loaded")
    except Exception as e:
        print(f"ERROR initializing scorer: {e}")
        sys.exit(1)

    # Get a mix of leads from different tiers
    leads = []
    for tier in ['A', 'B', 'C']:
        tier_leads = list(Lead.objects.filter(
            tier=tier,
            score__isnull=False
        ).select_related('property').order_by('?')[:17])  # Random sample - 17 per tier = ~50 total
        leads.extend(tier_leads)
        print(f"  Tier {tier}: {len(tier_leads)} leads")

    print(f"\nTotal leads to score: {len(leads)}")

    if not leads:
        print("No leads found with scores")
        sys.exit(1)

    print(f"\nScoring {len(leads)} leads in parallel (5 workers)...\n")

    # Run parallel scoring
    results = run_parallel_scoring(leads, scorer, max_workers=5)

    # Generate report
    report = generate_comparison_report(results)
    print("\n" + report)

    # Save results to JSON
    output_file = "lead_scoring_comparison.json"
    with open(output_file, "w") as f:
        json.dump([asdict(r) for r in results], f, indent=2, default=str)
    print(f"\nDetailed results saved to: {output_file}")


if __name__ == "__main__":
    main()
