"""
Tests for Experimental Lead Scoring System

Includes:
- Unit tests with mocked DeepSeek responses
- Integration test with real API (marked slow)
- Playwright visual verification for HTML reports
"""

import os
import json
import pytest
import tempfile
from unittest.mock import patch, MagicMock
from datetime import date, timedelta

# Add project to path
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Django setup
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'contractors.settings')
import django
django.setup()

from clients.services.scoring_experimental import (
    SalesDirectorScorer,
    ScoringResult,
    generate_html_report,
    BUILDER_KEYWORDS
)


# Test fixtures
SAMPLE_POOL_LEAD = {
    "project_description": "New Gunite Pool and Spa",
    "permit_date": (date.today() - timedelta(days=16)).isoformat(),
    "market_value": 850000,
    "owner_name": "John Doe",
    "lead_source": "Permit"
}

SAMPLE_ROOF_LEAD = {
    "project_description": "Re-Roof - Composition Shingles",
    "permit_date": (date.today() - timedelta(days=5)).isoformat(),
    "market_value": 450000,
    "owner_name": "Jane Smith",
    "lead_source": "Permit"
}

SAMPLE_BUILDER_LEAD = {
    "project_description": "New Residential Construction",
    "permit_date": (date.today() - timedelta(days=10)).isoformat(),
    "market_value": 600000,
    "owner_name": "Lennar Homes Texas LLC",
    "lead_source": "Permit"
}

SAMPLE_OLD_FENCE_LEAD = {
    "project_description": "Wood Fence 6ft",
    "permit_date": (date.today() - timedelta(days=45)).isoformat(),
    "market_value": 280000,
    "owner_name": "Bob Wilson",
    "lead_source": "Permit"
}


class TestBuilderDetection:
    """Tests for builder name detection."""
    
    def test_detects_lennar(self):
        scorer = SalesDirectorScorer()
        assert scorer._is_builder("Lennar Homes Texas LLC") is True
    
    def test_detects_dr_horton(self):
        scorer = SalesDirectorScorer()
        assert scorer._is_builder("D.R. Horton Inc") is True
    
    def test_detects_generic_builders(self):
        scorer = SalesDirectorScorer()
        assert scorer._is_builder("ABC Construction LLC") is True
        assert scorer._is_builder("Smith Builders Inc") is True
    
    def test_allows_regular_names(self):
        scorer = SalesDirectorScorer()
        assert scorer._is_builder("John Smith") is False
        assert scorer._is_builder("Mary Johnson") is False
    
    def test_handles_empty(self):
        scorer = SalesDirectorScorer()
        assert scorer._is_builder("") is False
        assert scorer._is_builder(None) is False


class TestFallbackScoring:
    """Tests for deterministic fallback scoring."""
    
    def test_pool_lead_high_score(self):
        scorer = SalesDirectorScorer()
        result = scorer._fallback_score(scorer._prepare_lead_data(SAMPLE_POOL_LEAD))
        
        assert result.tier == "A"
        assert result.score >= 80
        assert "Pool" in result.ideal_contractor or "Screen" in result.ideal_contractor
    
    def test_builder_lead_low_score(self):
        scorer = SalesDirectorScorer()
        result = scorer._fallback_score(scorer._prepare_lead_data(SAMPLE_BUILDER_LEAD))
        
        assert result.tier == "C"
        assert result.score == 10
        assert "Builder" in result.flags
    
    def test_old_fence_time_decay(self):
        scorer = SalesDirectorScorer()
        result = scorer._fallback_score(scorer._prepare_lead_data(SAMPLE_OLD_FENCE_LEAD))
        
        # Old fence should have decayed score
        assert result.score <= 30
        assert result.tier == "C"
    
    def test_fresh_roof_reasonable_score(self):
        scorer = SalesDirectorScorer()
        result = scorer._fallback_score(scorer._prepare_lead_data(SAMPLE_ROOF_LEAD))
        
        # Fresh roof in good property
        assert result.tier in ["B", "C"]
        assert 30 <= result.score <= 60
    
    def test_luxury_flag_on_high_value(self):
        high_value_lead = {**SAMPLE_POOL_LEAD, "market_value": 1500000}
        scorer = SalesDirectorScorer()
        result = scorer._fallback_score(scorer._prepare_lead_data(high_value_lead))
        
        assert "Luxury" in result.flags
    
    def test_low_value_penalty(self):
        low_value_lead = {**SAMPLE_POOL_LEAD, "market_value": 200000}
        scorer = SalesDirectorScorer()
        result = scorer._fallback_score(scorer._prepare_lead_data(low_value_lead))
        
        # Should still be decent due to pool, but lower
        assert result.score < scorer._fallback_score(scorer._prepare_lead_data(SAMPLE_POOL_LEAD)).score


class TestDeepSeekScoring:
    """Tests for DeepSeek API integration."""
    
    @patch('clients.services.scoring_experimental.requests.post')
    def test_successful_api_call(self, mock_post):
        """Test successful DeepSeek API response parsing."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "score": 92,
                        "tier": "A",
                        "reasoning": "High-value pool permit in $850k home. Perfect timing.",
                        "ideal_contractor": "Screen/Patio",
                        "flags": ["Luxury", "Hot"]
                    })
                }
            }]
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response
        
        scorer = SalesDirectorScorer(api_key="test-key")
        result = scorer.score_lead(SAMPLE_POOL_LEAD)
        
        assert result.score == 92
        assert result.tier == "A"
        assert "pool" in result.reasoning.lower()
    
    @patch('clients.services.scoring_experimental.requests.post')
    def test_handles_markdown_json(self, mock_post):
        """Test parsing JSON wrapped in markdown code blocks."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{
                "message": {
                    "content": "```json\n{\"score\": 75, \"tier\": \"B\", \"reasoning\": \"Test\", \"ideal_contractor\": \"Patio\", \"flags\": []}\n```"
                }
            }]
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response
        
        scorer = SalesDirectorScorer(api_key="test-key")
        result = scorer.score_lead(SAMPLE_ROOF_LEAD)
        
        assert result.score == 75
        assert result.tier == "B"
    
    @patch('clients.services.scoring_experimental.requests.post')
    def test_fallback_on_api_error(self, mock_post):
        """Test fallback scoring when API fails."""
        mock_post.side_effect = Exception("API unavailable")
        
        scorer = SalesDirectorScorer(api_key="test-key")
        result = scorer.score_lead(SAMPLE_POOL_LEAD, use_fallback_on_error=True)
        
        # Should still get a valid result from fallback
        assert result.score >= 0
        assert result.tier in ["A", "B", "C"]
        assert "Fallback" in result.reasoning
    
    def test_builder_short_circuit(self):
        """Test that builders are caught before API call."""
        scorer = SalesDirectorScorer()  # No API key needed
        result = scorer.score_lead(SAMPLE_BUILDER_LEAD)
        
        assert result.score == 10
        assert result.tier == "C"
        assert "Builder" in result.flags


class TestBatchScoring:
    """Tests for batch scoring."""
    
    @patch('clients.services.scoring_experimental.requests.post')
    def test_batch_scoring(self, mock_post):
        """Test scoring multiple leads."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "score": 70,
                        "tier": "B",
                        "reasoning": "Standard lead",
                        "ideal_contractor": "General",
                        "flags": []
                    })
                }
            }]
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response
        
        scorer = SalesDirectorScorer(api_key="test-key")
        results = scorer.score_batch([SAMPLE_POOL_LEAD, SAMPLE_ROOF_LEAD])
        
        assert len(results) == 2
        assert all(isinstance(r, ScoringResult) for r in results)


class TestHTMLReport:
    """Tests for HTML report generation."""
    
    def test_generates_valid_html(self):
        """Test that HTML report is valid."""
        results = [
            ScoringResult(
                score=92, tier="A",
                reasoning="Test whale",
                ideal_contractor="Pool",
                flags=["Luxury"],
                raw_input=SAMPLE_POOL_LEAD
            ),
            ScoringResult(
                score=45, tier="C",
                reasoning="Test low value",
                ideal_contractor="Skip",
                flags=["Builder"],
                raw_input=SAMPLE_BUILDER_LEAD
            ),
        ]
        
        html = generate_html_report(results, title="Test Report")
        
        assert "<!DOCTYPE html>" in html
        assert "Test Report" in html
        assert "Tier A" in html or "tier" in html.lower()
        assert "92" in html  # Score
        assert "Luxury" in html  # Flag
    
    def test_calculates_stats(self):
        """Test that summary stats are calculated."""
        results = [
            ScoringResult(score=90, tier="A", reasoning="", ideal_contractor="", flags=[], raw_input={}),
            ScoringResult(score=60, tier="B", reasoning="", ideal_contractor="", flags=[], raw_input={}),
            ScoringResult(score=30, tier="C", reasoning="", ideal_contractor="", flags=[], raw_input={}),
        ]
        
        html = generate_html_report(results)
        
        # Should show tier counts
        assert "1" in html  # At least one tier A
        assert "60" in html  # Average score


@pytest.mark.slow
class TestIntegration:
    """Integration tests with real DeepSeek API.
    
    Run with: pytest -v -k integration --slow
    Requires DEEPSEEK_API_KEY in environment.
    """
    
    @pytest.mark.skipif(
        not os.getenv('DEEPSEEK_API_KEY'),
        reason="DEEPSEEK_API_KEY not set"
    )
    def test_real_api_call(self):
        """Test actual DeepSeek API call."""
        scorer = SalesDirectorScorer()
        result = scorer.score_lead(SAMPLE_POOL_LEAD)
        
        assert 0 <= result.score <= 100
        assert result.tier in ["A", "B", "C"]
        assert len(result.reasoning) > 10
        assert result.ideal_contractor


@pytest.mark.slow
class TestPlaywrightReport:
    """Playwright visual tests for HTML reports.
    
    Run with: pytest -v -k playwright --slow
    Requires playwright and browsers installed.
    """
    
    @pytest.mark.skipif(
        not os.getenv('PLAYWRIGHT_BROWSERS_PATH', ''),
        reason="Playwright not configured"
    )
    def test_report_renders_correctly(self):
        """Test that HTML report renders in browser."""
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            pytest.skip("Playwright not installed")
        
        # Generate report
        results = [
            ScoringResult(
                score=92, tier="A",
                reasoning="High-value pool permit",
                ideal_contractor="Screen/Patio",
                flags=["Luxury", "Hot"],
                raw_input=SAMPLE_POOL_LEAD
            ),
        ]
        html = generate_html_report(results, title="Playwright Test Report")
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False) as f:
            f.write(html)
            filepath = f.name
        
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()
                page.goto(f'file://{filepath}')
                
                # Verify key elements
                assert page.title() == "Playwright Test Report"
                assert page.locator("text=Tier A").count() > 0
                assert page.locator("text=92").count() > 0
                
                # Take screenshot
                screenshot_path = filepath.replace('.html', '.png')
                page.screenshot(path=screenshot_path)
                
                browser.close()
        finally:
            os.unlink(filepath)


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
