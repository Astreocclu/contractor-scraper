"""
Unit tests for calculate_lien_score() function.

Tests the scoring algorithm that assigns 0-10 score based on:
- CRITICAL liens (tax, judgment): -5 points
- HIGH severity liens (3+): -5 points
- HIGH severity liens (1-2): -3 points
- Slow releases (2+ over 90 days): -2 points
- High total amount (>$50k): -2 points
"""

import sys
import os
import copy

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scrapers.county_liens.orchestrator import pair_liens_with_releases, calculate_lien_score
from tests.fixtures.lien_scenarios import (
    SCENARIO_CLEAN,
    SCENARIO_ACTIVE_LIEN,
    SCENARIO_TAX_LIEN,
    SCENARIO_JUDGMENT,
    SCENARIO_HIGH_RISK,
    SCENARIO_SLOW_RELEASE,
    SCENARIO_HIGH_AMOUNT,
    SCENARIO_ONLY_RELEASES,
    SCENARIO_MATCHED_RELEASE,
)


class TestCalculateLienScore:
    """Tests for the lien scoring algorithm."""

    def test_clean_contractor_gets_perfect_score(self):
        """No liens = 10/10 score."""
        result = calculate_lien_score(SCENARIO_CLEAN)

        assert result['score'] == 10
        assert result['max_score'] == 10
        assert result['active_liens'] == 0
        assert len(result['notes']) == 0

    def test_single_active_lien_deducts_3_points(self):
        """One active mechanic's lien = 7/10."""
        records = copy.deepcopy(SCENARIO_ACTIVE_LIEN)

        result = calculate_lien_score(records)

        assert result['score'] == 7
        assert result['active_liens'] == 1
        assert "active mechanic's lien" in result['notes'][0].lower()

    def test_critical_tax_lien_deducts_5_points(self):
        """Federal tax lien = 5/10 (CRITICAL severity)."""
        records = copy.deepcopy(SCENARIO_TAX_LIEN)

        result = calculate_lien_score(records)

        assert result['score'] == 5
        assert "CRITICAL" in result['notes'][0]

    def test_judgment_is_critical_severity(self):
        """Abstract of judgment = 5/10 (CRITICAL severity)."""
        records = copy.deepcopy(SCENARIO_JUDGMENT)

        result = calculate_lien_score(records)

        assert result['score'] == 5
        assert "CRITICAL" in result['notes'][0]

    def test_three_plus_liens_is_high_severity_pattern(self):
        """3+ active liens = 5/10 (pattern of non-payment)."""
        records = copy.deepcopy(SCENARIO_HIGH_RISK)

        result = calculate_lien_score(records)

        assert result['score'] == 5
        assert result['active_liens'] == 3

    def test_slow_releases_deduct_2_points(self):
        """2+ liens taking >90 days to resolve = -2 points."""
        records = copy.deepcopy(SCENARIO_SLOW_RELEASE)
        records = pair_liens_with_releases(records)

        result = calculate_lien_score(records)

        assert result['score'] == 8
        assert ">90 days" in result['notes'][0]

    def test_high_total_amount_deducts_2_points(self):
        """Active liens totaling >$50k = additional -2 points."""
        records = copy.deepcopy(SCENARIO_HIGH_AMOUNT)

        result = calculate_lien_score(records)

        assert result['score'] == 5  # 10 - 3 (lien) - 2 (amount)
        assert result['total_active_amount'] == 60000.00

    def test_only_releases_dont_count_as_active(self):
        """Release documents shouldn't count as active liens."""
        records = copy.deepcopy(SCENARIO_ONLY_RELEASES)

        result = calculate_lien_score(records)

        assert result['score'] == 10
        assert result['active_liens'] == 0

    def test_resolved_liens_dont_count_as_active(self):
        """Liens with has_release=True shouldn't count as active."""
        records = copy.deepcopy(SCENARIO_MATCHED_RELEASE)
        records = pair_liens_with_releases(records)

        result = calculate_lien_score(records)

        assert result['score'] == 10
        assert result['active_liens'] == 0
        assert result['resolved_liens'] == 1

    def test_score_never_goes_below_zero(self):
        """Score should floor at 0 even with multiple penalties."""
        records = [
            {
                'county': 'tarrant',
                'instrument_number': 'T1',
                'document_type': 'FED_TAX_LIEN',
                'grantor': 'IRS',
                'grantee': 'BAD CO',
                'filing_date': '2024-01-01',
                'amount': 100000.00
            },
            {
                'county': 'tarrant',
                'instrument_number': 'L1',
                'document_type': 'MECH_LIEN',
                'grantor': 'A',
                'grantee': 'BAD CO',
                'filing_date': '2024-01-01',
                'amount': 10000.00
            },
            {
                'county': 'tarrant',
                'instrument_number': 'L2',
                'document_type': 'MECH_LIEN',
                'grantor': 'B',
                'grantee': 'BAD CO',
                'filing_date': '2024-01-01',
                'amount': 10000.00
            },
            {
                'county': 'tarrant',
                'instrument_number': 'L3',
                'document_type': 'MECH_LIEN',
                'grantor': 'C',
                'grantee': 'BAD CO',
                'filing_date': '2024-01-01',
                'amount': 10000.00
            },
        ]

        result = calculate_lien_score(records)

        assert result['score'] >= 0


if __name__ == '__main__':
    import pytest
    pytest.main([__file__, '-v'])
