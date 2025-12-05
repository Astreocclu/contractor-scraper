"""
Contractor Trust Scoring System

Based on ACTUALLY AVAILABLE data for Texas pool/patio/shade contractors.
Texas does NOT require general contractor licenses for these trades.
"""

from dataclasses import dataclass, field
from typing import Dict, List

# Maximum points per category
MAX_VERIFICATION = 12
MAX_REPUTATION = 20
MAX_CREDIBILITY = 12
MAX_RED_FLAGS = 8
MAX_TOTAL = MAX_VERIFICATION + MAX_REPUTATION + MAX_CREDIBILITY + MAX_RED_FLAGS  # 52

# Thresholds
PASS_THRESHOLD = 50  # Bronze tier - shows on platform
SILVER_THRESHOLD = 65
GOLD_THRESHOLD = 80


@dataclass
class ScoreBreakdown:
    """Detailed breakdown of trust score calculation."""
    verification: int = 0
    reputation: int = 0
    credibility: int = 0
    red_flags: int = 0
    total_raw: int = 0
    total_normalized: int = 0
    tier: str = "unranked"
    passes: bool = False
    details: Dict = field(default_factory=dict)
    flags: List[str] = field(default_factory=list)


class TrustScoreCalculator:
    """
    Calculate trust score based on available data.

    No license verification - Texas doesn't require licenses for
    pool enclosures, patio covers, or motorized shades.
    """

    MAX_TOTAL = MAX_TOTAL

    def calculate(self, contractor, audit_result=None) -> ScoreBreakdown:
        """
        Calculate trust score for a contractor.

        Args:
            contractor: Contractor model instance
            audit_result: AuditResult from AI auditor (optional)

        Returns:
            ScoreBreakdown with all scoring details
        """
        b = ScoreBreakdown()

        # ===== VERIFICATION (12 pts) =====
        # Physical address (3 pts)
        if contractor.address:
            b.verification += 3
            b.details["has_address"] = 3

        # Working phone (2 pts)
        if contractor.phone:
            b.verification += 2
            b.details["has_phone"] = 2

        # Professional website (3 pts)
        if contractor.website:
            b.verification += 2
            b.details["has_website"] = 2
            # SSL check would go here if implemented
            if contractor.website and contractor.website.startswith("https"):
                b.verification += 1
                b.details["website_ssl"] = 1

        # BBB accredited (4 pts)
        if contractor.bbb_accredited:
            b.verification += 4
            b.details["bbb_accredited"] = 4

        b.verification = min(MAX_VERIFICATION, b.verification)

        # ===== REPUTATION (20 pts) =====
        # Google rating (5 pts max)
        google_rating = float(contractor.google_rating or 0)
        if google_rating >= 4.8:
            b.reputation += 5
            b.details["google_rating"] = 5
        elif google_rating >= 4.5:
            b.reputation += 4
            b.details["google_rating"] = 4
        elif google_rating >= 4.0:
            b.reputation += 3
            b.details["google_rating"] = 3
        elif google_rating >= 3.5:
            b.reputation += 2
            b.details["google_rating"] = 2
        elif google_rating >= 3.0:
            b.reputation += 1
            b.details["google_rating"] = 1

        # Google review count (3 pts max)
        google_count = contractor.google_review_count or 0
        if google_count >= 100:
            b.reputation += 3
            b.details["google_volume"] = 3
        elif google_count >= 50:
            b.reputation += 2
            b.details["google_volume"] = 2
        elif google_count >= 20:
            b.reputation += 1
            b.details["google_volume"] = 1

        # Yelp rating (6 pts max) - WEIGHTED HIGHER (more trustworthy)
        yelp_rating = float(contractor.yelp_rating or 0)
        if yelp_rating >= 4.5:
            b.reputation += 6
            b.details["yelp_rating"] = 6
        elif yelp_rating >= 4.0:
            b.reputation += 5
            b.details["yelp_rating"] = 5
        elif yelp_rating >= 3.5:
            b.reputation += 3
            b.details["yelp_rating"] = 3
        elif yelp_rating >= 3.0:
            b.reputation += 1
            b.details["yelp_rating"] = 1

        # Yelp review count (2 pts max)
        yelp_count = contractor.yelp_review_count or 0
        if yelp_count >= 30:
            b.reputation += 2
            b.details["yelp_volume"] = 2
        elif yelp_count >= 10:
            b.reputation += 1
            b.details["yelp_volume"] = 1

        # AI sentiment bonus (4 pts max)
        sentiment = audit_result.sentiment_score if audit_result else 50
        if sentiment >= 85:
            b.reputation += 4
            b.details["ai_sentiment"] = 4
        elif sentiment >= 70:
            b.reputation += 2
            b.details["ai_sentiment"] = 2
        elif sentiment < 40:
            b.reputation -= 2
            b.details["ai_sentiment"] = -2
            b.flags.append("Low AI sentiment score")

        b.reputation = min(MAX_REPUTATION, max(0, b.reputation))

        # ===== CREDIBILITY (12 pts) =====
        # Years in business (4 pts max)
        years = contractor.bbb_years_in_business or 0
        if years >= 10:
            b.credibility += 4
            b.details["years_in_business"] = 4
        elif years >= 5:
            b.credibility += 3
            b.details["years_in_business"] = 3
        elif years >= 2:
            b.credibility += 2
            b.details["years_in_business"] = 2
        elif years >= 1:
            b.credibility += 1
            b.details["years_in_business"] = 1

        # Permit history - BuildZoom (5 pts max) - placeholder for future
        permits = getattr(contractor, 'permit_count', 0) or 0
        if permits >= 20:
            b.credibility += 5
            b.details["permit_history"] = 5
        elif permits >= 10:
            b.credibility += 4
            b.details["permit_history"] = 4
        elif permits >= 5:
            b.credibility += 3
            b.details["permit_history"] = 3
        elif permits >= 1:
            b.credibility += 2
            b.details["permit_history"] = 2

        # Owner identifiable (3 pts) - placeholder for future
        owner_name = getattr(contractor, 'bbb_owner_name', None)
        if owner_name:
            b.credibility += 3
            b.details["owner_known"] = 3

        b.credibility = min(MAX_CREDIBILITY, b.credibility)

        # ===== RED FLAG ABSENCE (8 pts) =====
        b.red_flags = 8  # Start with full points, subtract for issues

        # BBB complaints (2 pts at risk)
        complaints = contractor.bbb_complaint_count or 0
        if complaints == 0:
            b.details["no_bbb_complaints"] = 2
        elif complaints <= 2:
            b.red_flags -= 1
            b.details["few_bbb_complaints"] = 1
        else:
            b.red_flags -= 2
            b.details["many_bbb_complaints"] = 0
            b.flags.append(f"{complaints} BBB complaints in 3 years")

        # AI-detected fake reviews (3 pts at risk)
        fake_count = audit_result.fake_review_count if audit_result else 0
        if fake_count == 0:
            b.details["no_fake_reviews"] = 3
        elif fake_count <= 2:
            b.red_flags -= 1
            b.details["few_fake_reviews"] = 2
            b.flags.append(f"{fake_count} suspected fake reviews")
        else:
            b.red_flags -= 3
            b.details["many_fake_reviews"] = 0
            b.flags.append(f"{fake_count} suspected fake reviews - MAJOR CONCERN")

        # AI-detected red flags (3 pts at risk)
        ai_red_flags = audit_result.red_flags if audit_result else []
        if len(ai_red_flags) == 0:
            b.details["no_ai_red_flags"] = 3
        elif len(ai_red_flags) <= 2:
            b.red_flags -= 1
            b.details["few_ai_red_flags"] = 2
            b.flags.extend(ai_red_flags[:2])
        else:
            b.red_flags -= 3
            b.details["many_ai_red_flags"] = 0
            b.flags.extend(ai_red_flags)

        b.red_flags = max(0, b.red_flags)

        # ===== MODIFIERS =====
        # Source conflict warning
        if audit_result and getattr(audit_result, 'yelp_vs_google_conflict', False):
            b.flags.append("Google and Yelp ratings disagree significantly")

        # Low confidence warning
        if audit_result and getattr(audit_result, 'confidence', 'low') == "low":
            b.flags.append("Low confidence - insufficient review data")

        # ===== CALCULATE TOTALS =====
        b.total_raw = b.verification + b.reputation + b.credibility + b.red_flags

        # Apply AI weight adjustment if extreme
        weight = getattr(audit_result, 'recommended_weight_adjustment', 1.0) if audit_result else 1.0
        if weight != 1.0:
            b.total_raw = int(b.total_raw * weight)

        # Normalize to 0-100
        b.total_normalized = round((b.total_raw / self.MAX_TOTAL) * 100)
        b.total_normalized = max(0, min(100, b.total_normalized))

        # Determine tier
        if b.total_normalized >= GOLD_THRESHOLD:
            b.tier = "gold"
        elif b.total_normalized >= SILVER_THRESHOLD:
            b.tier = "silver"
        elif b.total_normalized >= PASS_THRESHOLD:
            b.tier = "bronze"
        else:
            b.tier = "unranked"

        b.passes = b.total_normalized >= PASS_THRESHOLD

        return b


def calculate_trust_score(contractor_data: dict, audit_data: dict) -> dict:
    """
    Functional interface for trust score calculation.

    Args:
        contractor_data: Dict with contractor fields
        audit_data: Dict with audit result fields

    Returns:
        Dict with score breakdown
    """
    # Create mock objects for the class-based calculator
    class MockContractor:
        pass

    class MockAudit:
        pass

    c = MockContractor()
    for k, v in contractor_data.items():
        setattr(c, k, v)

    a = MockAudit()
    for k, v in audit_data.items():
        setattr(a, k, v)

    calc = TrustScoreCalculator()
    result = calc.calculate(c, a)

    return {
        "total_score": result.total_normalized,
        "tier": result.tier,
        "verification_score": result.verification,
        "reputation_score": result.reputation,
        "credibility_score": result.credibility,
        "red_flag_score": result.red_flags,
        "breakdown": result.details,
        "flags": result.flags,
        "max_possible": MAX_TOTAL,
        "raw_score": result.total_raw,
        "passes": result.passes
    }
