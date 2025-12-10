"""
Unit tests for pair_liens_with_releases() function.

Tests that mechanic's liens are correctly matched with their releases
based on matching grantor (creditor) and dates.
"""

import sys
import os
import copy

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scrapers.county_liens.orchestrator import pair_liens_with_releases
from tests.fixtures.lien_scenarios import (
    SCENARIO_MATCHED_RELEASE,
    SCENARIO_ACTIVE_LIEN,
    SCENARIO_SLOW_RELEASE,
)


class TestPairLiensWithReleases:
    """Tests for the lien-release pairing logic."""

    def test_matches_lien_with_same_grantor_release(self):
        """Lien should be marked as released when same grantor files release."""
        records = copy.deepcopy(SCENARIO_MATCHED_RELEASE)

        result = pair_liens_with_releases(records)

        lien = next(r for r in result if r['document_type'] == 'MECH_LIEN')

        assert lien.get('has_release') is True
        assert lien.get('release_date') is not None

    def test_calculates_days_to_release(self):
        """Should calculate days between filing and release."""
        records = copy.deepcopy(SCENARIO_MATCHED_RELEASE)

        result = pair_liens_with_releases(records)

        lien = next(r for r in result if r['document_type'] == 'MECH_LIEN')

        # 100 days ago filed, 10 days ago released = 90 days to release
        assert lien.get('days_to_release') == 90

    def test_active_lien_not_marked_as_released(self):
        """Lien without matching release should not have has_release."""
        records = copy.deepcopy(SCENARIO_ACTIVE_LIEN)

        result = pair_liens_with_releases(records)

        lien = result[0]

        assert lien.get('has_release') is not True
        assert lien.get('release_date') is None

    def test_multiple_liens_paired_correctly(self):
        """Each lien should be paired with its own release."""
        records = copy.deepcopy(SCENARIO_SLOW_RELEASE)

        result = pair_liens_with_releases(records)

        liens = [r for r in result if r['document_type'] == 'MECH_LIEN']

        assert len(liens) == 2
        for lien in liens:
            assert lien.get('has_release') is True
            assert lien.get('days_to_release') == 190


if __name__ == '__main__':
    import pytest
    pytest.main([__file__, '-v'])
