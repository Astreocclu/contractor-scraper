"""
Tests for Lead Scoring System

Includes:
- Filter tests (builder detection, junk projects)
- DeepSeek scorer unit tests with mocked responses
- Integration test with real API (marked slow)
- Comparison mode tests
"""

import os
import json
import pytest
from unittest.mock import patch, MagicMock, Mock
from datetime import date, timedelta

# Add project to path
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Django setup
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()

from scoring.filters import should_discard, get_freshness_penalty, PRODUCTION_BUILDERS
from scoring.deepseek_scorer import DeepSeekScorer, ScoringResult
from scoring.exporter import export_scored_leads, get_tier_from_score


# ============================================================================
# Test Fixtures
# ============================================================================

SAMPLE_HOMEOWNER_POOL_LEAD = {
    'lead_id': 'test-001',
    'owner_name': 'John Smith',
    'market_value': 850000,
    'project_description': 'New Gunite Pool and Spa with Water Feature',
    'category': 'pool',
    'permit_date': (date.today() - timedelta(days=16)).isoformat(),
    'days_old': 16,
    'city': 'Southlake',
    'is_absentee': False,
}

SAMPLE_BUILDER_LEAD = {
    'lead_id': 'test-002',
    'owner_name': 'Lennar Homes Texas LLC',
    'market_value': 600000,
    'project_description': 'New Residential Construction',
    'category': 'new_construction',
    'permit_date': (date.today() - timedelta(days=10)).isoformat(),
    'days_old': 10,
    'city': 'Frisco',
    'is_absentee': False,
}

SAMPLE_HIDDEN_BUILDER_LEAD = {
    'lead_id': 'test-003',
    'owner_name': 'GUAJARDO, JORGE',  # Looks like homeowner
    'market_value': 500000,
    'project_description': 'Perry Homes - New Pool Construction',  # Builder hidden here!
    'category': 'pool',
    'permit_date': (date.today() - timedelta(days=5)).isoformat(),
    'days_old': 5,
    'city': 'Fort Worth',
    'is_absentee': False,
}

SAMPLE_OLD_FENCE_LEAD = {
    'lead_id': 'test-004',
    'owner_name': 'Bob Wilson',
    'market_value': 280000,
    'project_description': 'Wood Fence 6ft',
    'category': 'fence',
    'permit_date': (date.today() - timedelta(days=95)).isoformat(),
    'days_old': 95,
    'city': 'Dallas',
    'is_absentee': False,
}

SAMPLE_NO_DATA_LEAD = {
    'lead_id': 'test-005',
    'owner_name': 'Unknown',
    'market_value': 0,
    'project_description': 'Permit',
    'category': 'other',
    'days_old': 30,
    'city': 'Unknown',
    'is_absentee': False,
}

SAMPLE_ABSENTEE_LUXURY_LEAD = {
    'lead_id': 'test-006',
    'owner_name': 'Jane Doe',
    'market_value': 1200000,
    'project_description': 'Pool and Outdoor Kitchen',
    'category': 'pool',
    'permit_date': (date.today() - timedelta(days=20)).isoformat(),
    'days_old': 20,
    'city': 'Westlake',
    'is_absentee': True,  # Vacation home signal
}


# ============================================================================
# Filter Tests
# ============================================================================

class TestBuilderFilter:
    """Tests for production builder detection."""

    def test_catches_lennar_in_owner_name(self):
        """Should catch Lennar in owner name."""
        discard, reason = should_discard(SAMPLE_BUILDER_LEAD)
        assert discard is True
        assert 'lennar' in reason.lower()

    def test_catches_builder_in_project_description(self):
        """CRITICAL: Should catch builders hidden in project_description."""
        discard, reason = should_discard(SAMPLE_HIDDEN_BUILDER_LEAD)
        assert discard is True
        assert 'perry' in reason.lower() or 'project desc' in reason.lower()

    def test_allows_homeowner(self):
        """Should allow normal homeowner name."""
        discard, reason = should_discard(SAMPLE_HOMEOWNER_POOL_LEAD)
        assert discard is False

    def test_all_production_builders_checked(self):
        """Verify key builders are in the list."""
        builders_to_check = [
            'lennar', 'dr horton', 'pulte', 'perry homes', 'kb home',
            'toll brothers', 'meritage', 'ashton woods', 'david weekley'
        ]
        for builder in builders_to_check:
            assert builder in PRODUCTION_BUILDERS, f"Missing builder: {builder}"

    def test_builder_detection_case_insensitive(self):
        """Builder detection should be case-insensitive."""
        lead = {**SAMPLE_HOMEOWNER_POOL_LEAD, 'owner_name': 'LENNAR HOMES LLC'}
        discard, _ = should_discard(lead)
        assert discard is True


class TestJunkFilter:
    """Tests for junk project filtering."""

    def test_too_old_discarded(self):
        """Should discard leads over 90 days old."""
        discard, reason = should_discard(SAMPLE_OLD_FENCE_LEAD)
        assert discard is True
        assert 'old' in reason.lower()

    def test_no_data_discarded(self):
        """Should discard leads with no owner AND no value."""
        discard, reason = should_discard(SAMPLE_NO_DATA_LEAD)
        assert discard is True
        assert 'owner' in reason.lower() or 'value' in reason.lower()

    def test_fresh_lead_allowed(self):
        """Fresh lead with data should pass."""
        discard, _ = should_discard(SAMPLE_HOMEOWNER_POOL_LEAD)
        assert discard is False


class TestFreshnessPenalty:
    """Tests for category-specific freshness thresholds."""

    def test_roof_stale_after_14_days(self):
        """Roof leads should be penalized after 14 days."""
        penalty = get_freshness_penalty('roof', 20)
        assert penalty < 0

    def test_pool_fresh_at_60_days(self):
        """Pool leads should still be OK at 60 days."""
        penalty = get_freshness_penalty('pool', 60)
        assert penalty == 0

    def test_pool_stale_after_90_days(self):
        """Pool leads should be penalized after 90 days."""
        penalty = get_freshness_penalty('pool', 100)
        assert penalty < 0

    def test_fence_thresholds(self):
        """Fence uses 45 day threshold."""
        assert get_freshness_penalty('fence', 30) == 0
        assert get_freshness_penalty('fence', 50) < 0


# ============================================================================
# DeepSeek Scorer Tests
# ============================================================================

class TestDeepSeekScorer:
    """Tests for DeepSeek R1 integration."""

    @patch.dict(os.environ, {'DEEPSEEK_API_KEY': ''}, clear=False)
    def test_fallback_when_no_api_key(self):
        """Should use fallback scoring without API key."""
        # Force recreate scorer without cached API key
        scorer = DeepSeekScorer(api_key='')
        result = scorer.score_lead(SAMPLE_HOMEOWNER_POOL_LEAD)
        
        assert result.scoring_method == 'fallback'
        assert 0 <= result.score <= 100
        assert result.tier in ['A', 'B', 'C']

    def test_fallback_pool_lead_high_score(self):
        """Pool lead should score high in fallback."""
        scorer = DeepSeekScorer(api_key=None)
        result = scorer._fallback_score(SAMPLE_HOMEOWNER_POOL_LEAD, 'test')
        
        assert result.score >= 70
        assert result.ideal_contractor_type == 'pool'

    def test_fallback_low_value_penalty(self):
        """Low value property should be penalized."""
        scorer = DeepSeekScorer(api_key=None)
        low_value = {**SAMPLE_HOMEOWNER_POOL_LEAD, 'market_value': 200000}
        high_value = {**SAMPLE_HOMEOWNER_POOL_LEAD, 'market_value': 1500000}
        
        low_result = scorer._fallback_score(low_value, 'test-low')
        high_result = scorer._fallback_score(high_value, 'test-high')
        
        assert high_result.score > low_result.score

    def test_fallback_absentee_vacation_home_bonus(self):
        """Absentee + high value should get bonus."""
        scorer = DeepSeekScorer(api_key=None)
        result = scorer._fallback_score(SAMPLE_ABSENTEE_LUXURY_LEAD, 'test')
        
        assert 'Vacation home' in result.red_flags

    def test_fallback_llc_detection(self):
        """Should detect LLC/investor applicants."""
        scorer = DeepSeekScorer(api_key=None)
        llc_lead = {**SAMPLE_HOMEOWNER_POOL_LEAD, 'owner_name': 'Smith Properties LLC'}
        result = scorer._fallback_score(llc_lead, 'test')
        
        assert result.applicant_type == 'investor'
        assert result.score <= 60  # Capped

    @patch('scoring.deepseek_scorer.OpenAI')
    def test_successful_api_call(self, mock_openai_class):
        """Test successful DeepSeek R1 API response parsing."""
        # Mock the API response
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        
        mock_response = MagicMock()
        mock_message = MagicMock()
        mock_message.content = json.dumps({
            'score': 92,
            'tier': 'A',
            'reasoning': 'High-value pool permit in premium suburb.',
            'red_flags': [],
            'ideal_contractor_type': 'pool',
            'contact_priority': 'high',
            'applicant_type': 'homeowner'
        })
        mock_message.reasoning_content = 'The owner appears to be a homeowner...'
        mock_response.choices = [MagicMock(message=mock_message)]
        mock_response.usage = MagicMock(
            prompt_tokens=500,
            completion_tokens=200,
            completion_tokens_details=None
        )
        mock_client.chat.completions.create.return_value = mock_response
        
        scorer = DeepSeekScorer(api_key='test-key')
        result = scorer.score_lead(SAMPLE_HOMEOWNER_POOL_LEAD)
        
        assert result.score == 92
        assert result.tier == 'A'
        assert 'high-value' in result.reasoning.lower()
        assert result.chain_of_thought == 'The owner appears to be a homeowner...'
        assert result.scoring_method == 'ai-r1'

    @patch('scoring.deepseek_scorer.OpenAI')
    def test_handles_markdown_json(self, mock_openai_class):
        """Should parse JSON wrapped in markdown code blocks."""
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        
        mock_message = MagicMock()
        mock_message.content = '```json\n{"score": 75, "tier": "B", "reasoning": "Test", "red_flags": [], "ideal_contractor_type": "pool", "contact_priority": "medium", "applicant_type": "homeowner"}\n```'
        mock_message.reasoning_content = ''
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=mock_message)]
        mock_response.usage = MagicMock(
            prompt_tokens=100,
            completion_tokens=50,
            completion_tokens_details=None
        )
        mock_client.chat.completions.create.return_value = mock_response
        
        scorer = DeepSeekScorer(api_key='test-key')
        result = scorer.score_lead(SAMPLE_HOMEOWNER_POOL_LEAD)
        
        assert result.score == 75
        assert result.tier == 'B'

    @patch('scoring.deepseek_scorer.OpenAI')
    def test_fallback_on_api_error(self, mock_openai_class):
        """Should use fallback when API fails."""
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        mock_client.chat.completions.create.side_effect = Exception('API error')
        
        scorer = DeepSeekScorer(api_key='test-key')
        result = scorer.score_lead(SAMPLE_HOMEOWNER_POOL_LEAD)
        
        assert result.scoring_method == 'fallback'
        assert 0 <= result.score <= 100

    @patch('scoring.deepseek_scorer.OpenAI')
    def test_json_parse_error_fallback(self, mock_openai_class):
        """Should fallback on invalid JSON response."""
        mock_client = MagicMock()
        mock_openai_class.return_value = mock_client
        
        mock_message = MagicMock()
        mock_message.content = 'This is not valid JSON at all'
        mock_message.reasoning_content = ''
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=mock_message)]
        mock_response.usage = MagicMock(
            prompt_tokens=100,
            completion_tokens=50,
            completion_tokens_details=None
        )
        mock_client.chat.completions.create.return_value = mock_response
        
        scorer = DeepSeekScorer(api_key='test-key')
        result = scorer.score_lead(SAMPLE_HOMEOWNER_POOL_LEAD)
        
        assert result.scoring_method == 'fallback'


# ============================================================================
# Exporter Tests
# ============================================================================

class TestExporter:
    """Tests for CSV export functionality."""

    def test_tier_mapping(self):
        """Verify score to tier mapping."""
        assert get_tier_from_score(95) == 'a'
        assert get_tier_from_score(80) == 'a'
        assert get_tier_from_score(79) == 'b'
        assert get_tier_from_score(50) == 'b'
        assert get_tier_from_score(49) == 'c'
        assert get_tier_from_score(0) == 'c'

    def test_export_creates_directories(self, tmp_path):
        """Should create category directories."""
        results = [
            ScoringResult(
                score=90, tier='A', reasoning='Test',
                ideal_contractor_type='pool',
                red_flags=[], lead_id='test-001'
            ),
            ScoringResult(
                score=60, tier='B', reasoning='Test',
                ideal_contractor_type='roof',
                red_flags=[], lead_id='test-002'
            ),
        ]
        
        counts = export_scored_leads(results, output_dir=str(tmp_path), timestamp_suffix=False)
        
        assert (tmp_path / 'pool').exists()
        assert (tmp_path / 'roof').exists()
        assert len(counts) >= 2

    def test_flagged_leads_exported(self, tmp_path):
        """Low score leads should be flagged."""
        results = [
            ScoringResult(
                score=25, tier='C', reasoning='Low quality',
                ideal_contractor_type='other',
                red_flags=['LOW_SCORE'], lead_id='test-flagged'
            ),
        ]
        
        counts = export_scored_leads(results, output_dir=str(tmp_path), timestamp_suffix=False)
        
        assert (tmp_path / 'flagged').exists()


# ============================================================================
# Integration Test (requires API key)
# ============================================================================

@pytest.mark.slow
class TestIntegration:
    """Integration tests with real DeepSeek API."""

    @pytest.mark.skipif(
        not os.getenv('DEEPSEEK_API_KEY'),
        reason='DEEPSEEK_API_KEY not set'
    )
    def test_real_api_call(self):
        """Test actual DeepSeek R1 API call."""
        scorer = DeepSeekScorer()
        result = scorer.score_lead(SAMPLE_HOMEOWNER_POOL_LEAD)
        
        assert 0 <= result.score <= 100
        assert result.tier in ['A', 'B', 'C']
        assert len(result.reasoning) > 10
        assert result.ideal_contractor_type
        assert result.scoring_method == 'ai-r1'
        
        # Should have chain of thought from R1
        # Note: reasoning_content may be empty in some cases
        print(f"Score: {result.score}, Tier: {result.tier}")
        print(f"Reasoning: {result.reasoning}")
        print(f"Cost: ${result.cost_usd:.4f}")

    @pytest.mark.skipif(
        not os.getenv('DEEPSEEK_API_KEY'),
        reason='DEEPSEEK_API_KEY not set'
    )
    def test_cost_tracking(self):
        """Verify cost tracking is reasonable."""
        scorer = DeepSeekScorer()
        result = scorer.score_lead(SAMPLE_HOMEOWNER_POOL_LEAD)
        
        # Expected: ~$0.01-0.02 per lead
        assert result.cost_usd < 0.05, f"Cost too high: ${result.cost_usd}"
        assert result.tokens_used.get('prompt', 0) > 0


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
