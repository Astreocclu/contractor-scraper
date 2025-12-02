from dataclasses import dataclass, field
from typing import Dict

PASS_THRESHOLD = 80


@dataclass
class ScoreBreakdown:
    verification: int = 0
    reputation: int = 0
    credibility: int = 0
    red_flags: int = 0
    bonus: int = 0
    total_raw: int = 0
    total_normalized: int = 0
    passes: bool = False
    details: Dict = field(default_factory=dict)


class TrustScoreCalculator:
    MAX_TOTAL = 52

    def calculate(self, contractor, audit_result=None) -> ScoreBreakdown:
        b = ScoreBreakdown()

        # Verification (max 15)
        if contractor.license_status == 'Active':
            b.verification += 8
        if contractor.bbb_accredited:
            b.verification += 4
        if (contractor.bbb_years_in_business or 0) >= 5:
            b.verification += 3
        b.verification = min(15, b.verification)

        # Reputation (max 15)
        if contractor.google_rating:
            rating = float(contractor.google_rating)
            if rating >= 4.5:
                b.reputation += 6
            elif rating >= 4.0:
                b.reputation += 5
            elif rating >= 3.5:
                b.reputation += 3

        if (contractor.google_review_count or 0) >= 100:
            b.reputation += 3
        elif (contractor.google_review_count or 0) >= 50:
            b.reputation += 2

        if contractor.yelp_rating and contractor.yelp_rating >= 4.0:
            b.reputation += 3

        bbb_pts = {'A+': 2, 'A': 2, 'A-': 1, 'B+': 1, 'B': 1}.get(contractor.bbb_rating, 0)
        b.reputation += bbb_pts
        b.reputation = min(15, b.reputation)

        # Credibility (max 10)
        if contractor.website:
            b.credibility += 2
        if contractor.phone:
            b.credibility += 1
        if audit_result and audit_result.sentiment_score >= 80:
            b.credibility += 4
        elif audit_result and audit_result.sentiment_score >= 60:
            b.credibility += 3
        if (contractor.bbb_years_in_business or 0) >= 5 and (contractor.google_review_count or 0) >= 50:
            b.credibility += 3
        b.credibility = min(10, b.credibility)

        # Red flags (max 7 - points for ABSENCE)
        b.red_flags = 7
        if contractor.license_status in ['Expired', 'Suspended']:
            b.red_flags -= 2
        if (contractor.bbb_complaint_count or 0) >= 5:
            b.red_flags -= 2
        if audit_result and len(audit_result.red_flags) > 0:
            b.red_flags -= min(2, len(audit_result.red_flags))
        b.red_flags = max(0, b.red_flags)

        # Bonus (max 5)
        if contractor.bbb_accredited:
            b.bonus += 2
        total_reviews = (contractor.google_review_count or 0) + (contractor.yelp_review_count or 0)
        if total_reviews >= 200:
            b.bonus += 2
        elif total_reviews >= 100:
            b.bonus += 1
        if contractor.is_claimed:
            b.bonus += 1
        b.bonus = min(5, b.bonus)

        # Total
        b.total_raw = b.verification + b.reputation + b.credibility + b.red_flags + b.bonus
        b.total_normalized = round((b.total_raw / self.MAX_TOTAL) * 100)
        b.total_normalized = max(0, min(100, b.total_normalized))
        b.passes = b.total_normalized >= PASS_THRESHOLD

        return b
