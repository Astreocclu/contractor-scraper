"""DeepSeek R1 reasoning model integration for lead scoring.

Uses the deepseek-reasoner model which provides chain-of-thought reasoning.

CRITICAL API RULES:
1. Always use model name `deepseek-reasoner` - enables chain-of-thought
2. Response has TWO content fields:
   - `reasoning_content` = The model's thinking process (log for debugging)
   - `content` = The final answer (parse for score)
3. Omit temperature, top_p, sampling parameters - reasoner ignores these
4. Use zero-shot prompting exclusively - few-shot degrades performance
5. Omit "think step by step" - R1 does this natively
"""

import os
import json
import logging
import time
from typing import Optional, Dict, Any, List, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from datetime import datetime

from openai import OpenAI

from .prompts import SCORING_PROMPT
from .filters import should_discard, get_freshness_penalty

logger = logging.getLogger(__name__)


@dataclass
class ScoringResult:
    """Result from DeepSeek R1 scoring."""
    score: int
    tier: str  # A, B, or C
    reasoning: str
    red_flags: List[str] = field(default_factory=list)
    ideal_contractor_type: str = "general"
    contact_priority: str = "medium"  # high, medium, low
    applicant_type: str = "unknown"  # homeowner, investor, custom_builder, unknown
    chain_of_thought: str = ""  # R1's reasoning_content
    
    # Metadata
    lead_id: Optional[str] = None
    tokens_used: Dict[str, int] = field(default_factory=dict)
    cost_usd: float = 0.0
    scored_at: datetime = field(default_factory=datetime.now)
    scoring_method: str = "ai"  # ai, fallback

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            **asdict(self),
            "scored_at": self.scored_at.isoformat() if self.scored_at else None,
        }


class DeepSeekScorer:
    """
    Lead scorer using DeepSeek R1 reasoning model.
    
    The R1 model provides chain-of-thought reasoning which improves
    scoring accuracy and provides transparent decision-making.
    """
    
    # Pricing per 1M tokens (as of Dec 2024)
    PRICE_INPUT = 0.00000055  # $0.55/1M input (cache miss)
    PRICE_OUTPUT = 0.00000219  # $2.19/1M output
    PRICE_REASONING = 0.00000219  # Same as output for reasoning tokens
    
    def __init__(self, api_key: str = None):
        """
        Initialize the DeepSeek scorer.
        
        Args:
            api_key: DeepSeek API key. If not provided, reads from
                     DEEPSEEK_API_KEY environment variable.
        """
        self.api_key = api_key or os.environ.get('DEEPSEEK_API_KEY')
        if not self.api_key:
            logger.warning("DEEPSEEK_API_KEY not set - will use fallback scoring")
            self.client = None
        else:
            self.client = OpenAI(
                api_key=self.api_key,
                base_url="https://api.deepseek.com"
            )
    
    def score_lead(self, lead: dict) -> ScoringResult:
        """
        Score a single lead using DeepSeek R1.
        
        Args:
            lead: Dictionary with lead data including:
                - owner_name: Property owner name
                - market_value: Property value in dollars
                - project_description: Permit description
                - category: Lead type (pool, roof, etc.)
                - permit_date: When permit was issued
                - days_old: Days since permit
                - city: City name
                - is_absentee: Whether owner is absentee
        
        Returns:
            ScoringResult with score, tier, reasoning, and metadata
        """
        lead_id = lead.get('id') or lead.get('lead_id') or lead.get('permit_id')
        
        # Check if we should use fallback
        if not self.client:
            return self._fallback_score(lead, lead_id)
        
        try:
            # Format the zero-shot prompt
            prompt = SCORING_PROMPT.format(
                owner_name=lead.get('owner_name', 'Unknown'),
                market_value=lead.get('market_value', 0),
                project_description=lead.get('project_description', 'Not provided'),
                category=lead.get('category', 'Unknown'),
                permit_date=lead.get('permit_date', 'Unknown'),
                days_old=lead.get('days_old', 0),
                city=lead.get('city', 'Unknown'),
                is_absentee=lead.get('is_absentee', False)
            )
            
            # Call DeepSeek R1 - NO temperature, NO system message for reasoner
            response = self.client.chat.completions.create(
                model="deepseek-reasoner",
                messages=[{"role": "user", "content": prompt}],
                stream=False
            )
            
            message = response.choices[0].message
            
            # Extract BOTH content fields
            reasoning_content = getattr(message, 'reasoning_content', '') or ''
            content = message.content or ''
            
            # Log reasoning for debugging
            if reasoning_content:
                logger.debug(f"Lead {lead_id} reasoning: {reasoning_content[:500]}...")
            
            # Calculate cost
            usage = response.usage
            tokens = {
                'prompt': usage.prompt_tokens,
                'completion': usage.completion_tokens,
            }
            
            # Try to get reasoning tokens if available
            if hasattr(usage, 'completion_tokens_details') and usage.completion_tokens_details:
                tokens['reasoning'] = getattr(usage.completion_tokens_details, 'reasoning_tokens', 0)
            
            cost = (
                tokens['prompt'] * self.PRICE_INPUT +
                tokens['completion'] * self.PRICE_OUTPUT
            )
            
            logger.info(f"Lead {lead_id}: {tokens['completion']} tokens, ${cost:.4f}")
            
            # Parse JSON response
            result = self._parse_response(content)
            
            if result is None:
                logger.warning(f"Failed to parse response for {lead_id}, using fallback")
                return self._fallback_score(lead, lead_id)
            
            # Determine tier from score
            score = result.get('score', 50)
            if score >= 80:
                tier = 'A'
            elif score >= 50:
                tier = 'B'
            else:
                tier = 'C'
            
            return ScoringResult(
                score=score,
                tier=result.get('tier', tier),
                reasoning=result.get('reasoning', ''),
                red_flags=result.get('red_flags', []),
                ideal_contractor_type=result.get('ideal_contractor_type', 'general'),
                contact_priority=result.get('contact_priority', 'medium'),
                applicant_type=result.get('applicant_type', 'unknown'),
                chain_of_thought=reasoning_content,
                lead_id=lead_id,
                tokens_used=tokens,
                cost_usd=cost,
                scoring_method='ai-r1'
            )
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error for lead {lead_id}: {e}")
            return self._fallback_score(lead, lead_id)
        except Exception as e:
            logger.error(f"DeepSeek API error for lead {lead_id}: {e}")
            return self._fallback_score(lead, lead_id)
    
    def _parse_response(self, response: str) -> Optional[Dict[str, Any]]:
        """
        Parse JSON from DeepSeek response.
        
        Handles markdown code blocks and extracts JSON object.
        DeepSeek sometimes embeds newlines within JSON strings, so we need
        to be careful about cleaning.
        """
        if not response:
            return None
        
        # Handle markdown code blocks
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            parts = response.split("```")
            if len(parts) >= 2:
                response = parts[1]
        
        # Find JSON object
        import re
        match = re.search(r'\{[\s\S]*\}', response)
        if match:
            json_str = match.group(0).strip()
            
            # Try to parse directly first
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                pass
            
            # Clean up common issues:
            # 1. Replace embedded newlines in string values with spaces
            # 2. Remove control characters
            cleaned = json_str
            cleaned = re.sub(r'(?<=[":a-zA-Z0-9.,])\n\s*(?=[a-zA-Z])', ' ', cleaned)
            cleaned = cleaned.replace('\r', ' ').replace('\t', ' ')
            
            try:
                return json.loads(cleaned)
            except json.JSONDecodeError as e:
                logger.debug(f"JSON parse failed after cleaning: {e}")
                
                # Last resort: try to extract key fields manually
                try:
                    score_match = re.search(r'"score"\s*:\s*(\d+)', json_str)
                    tier_match = re.search(r'"tier"\s*:\s*"([ABC])"', json_str)
                    reasoning_match = re.search(r'"reasoning"\s*:\s*"([^"]*)"', json_str)
                    
                    if score_match:
                        return {
                            'score': int(score_match.group(1)),
                            'tier': tier_match.group(1) if tier_match else None,
                            'reasoning': reasoning_match.group(1) if reasoning_match else '',
                            'red_flags': [],
                            'ideal_contractor_type': 'general',
                            'contact_priority': 'medium',
                            'applicant_type': 'unknown'
                        }
                except Exception:
                    pass
        
        return None
    
    def _fallback_score(self, lead: dict, lead_id: str = None) -> ScoringResult:
        """
        Deterministic fallback scoring when API is unavailable.
        
        Uses a simplified rubric based on the scoring principles.
        """
        desc = (lead.get('project_description', '') or '').lower()
        owner = (lead.get('owner_name', '') or '').lower()
        value = float(lead.get('market_value', 0) or 0)
        days_old = int(lead.get('days_old', 0) or 0)
        is_absentee = lead.get('is_absentee', False)
        category = lead.get('category', '').lower()
        
        # Start with base score
        base = 50
        flags = []
        
        # 1. Categorize by project type
        if any(kw in desc for kw in ['pool', 'swim', 'spa', 'hot tub']):
            base = 75
            contractor = 'pool'
        elif any(kw in desc for kw in ['patio', 'deck', 'pergola', 'outdoor kitchen', 'screen']):
            base = 65
            contractor = 'outdoor_living'
        elif any(kw in desc for kw in ['roof', 'roofing', 're-roof']):
            base = 55
            contractor = 'roof'
        elif any(kw in desc for kw in ['fence', 'fencing']):
            base = 50
            contractor = 'fence'
        else:
            base = 45
            contractor = 'general'
        
        # 2. Property value adjustment (DFW context)
        if value >= 1_500_000:
            base += 15
            flags.append("Luxury tier")
        elif value >= 1_000_000:
            base += 12
        elif value >= 750_000:
            base += 8
        elif value >= 550_000:
            base += 4
        elif value >= 400_000:
            base += 0
        elif value > 0:
            base -= 10
            flags.append("Budget segment")
        else:
            base -= 10
            flags.append("No value data")
        
        # 3. Freshness penalty
        freshness_adj = get_freshness_penalty(category or contractor, days_old)
        base += freshness_adj
        if freshness_adj < 0:
            flags.append(f"Aging ({days_old}d)")
        
        # 4. Absentee adjustment
        if is_absentee:
            if value >= 750_000:
                base += 5
                flags.append("Vacation home")
            elif value < 400_000:
                base -= 10
                flags.append("Landlord")
        
        # 5. Missing data penalties
        if owner in ('unknown', '', 'none'):
            base -= 10
            flags.append("Unknown owner")
        
        # 6. Applicant type detection
        applicant_type = 'homeowner'
        if any(ind in owner for ind in ['llc', 'inc', 'corp', 'ltd', 'company']):
            applicant_type = 'investor'
            base = min(base, 60)
            flags.append("LLC/Investor")
        elif any(ind in owner for ind in ['construction', 'builder', 'homes']):
            applicant_type = 'custom_builder'
            base = min(base, 50)
            flags.append("Builder")
        
        # Cap score
        score = max(0, min(100, base))
        
        # Determine tier
        if score >= 80:
            tier = 'A'
        elif score >= 50:
            tier = 'B'
        else:
            tier = 'C'
        
        # Contact priority
        if score >= 70:
            priority = 'high'
        elif score >= 40:
            priority = 'medium'
        else:
            priority = 'low'
        
        return ScoringResult(
            score=score,
            tier=tier,
            reasoning=f"Fallback: {contractor} project, ${value:,.0f} value, {days_old}d old",
            red_flags=flags,
            ideal_contractor_type=contractor,
            contact_priority=priority,
            applicant_type=applicant_type,
            chain_of_thought="",
            lead_id=lead_id,
            tokens_used={},
            cost_usd=0.0,
            scoring_method='fallback'
        )
    
    def score_batch(
        self,
        leads: List[dict],
        max_workers: int = 5,
        delay_seconds: float = 0.1
    ) -> Tuple[List[ScoringResult], Dict[str, Any]]:
        """
        Score multiple leads with rate limiting.
        
        Args:
            leads: List of lead dictionaries
            max_workers: Maximum concurrent API calls
            delay_seconds: Delay between API calls for rate limiting
        
        Returns:
            Tuple of (results list, stats dict)
        """
        results = []
        stats = {
            'total': len(leads),
            'scored': 0,
            'fallback': 0,
            'total_tokens': 0,
            'total_cost': 0.0,
        }
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(self.score_lead, lead): lead for lead in leads}
            
            for future in as_completed(futures):
                lead = futures[future]
                try:
                    result = future.result()
                    results.append(result)
                    
                    # Update stats
                    if result.scoring_method == 'fallback':
                        stats['fallback'] += 1
                    else:
                        stats['scored'] += 1
                        stats['total_tokens'] += sum(result.tokens_used.values())
                        stats['total_cost'] += result.cost_usd
                    
                except Exception as e:
                    lead_id = lead.get('id') or lead.get('lead_id')
                    logger.error(f"Failed to score lead {lead_id}: {e}")
                    results.append(self._fallback_score(lead, lead_id))
                    stats['fallback'] += 1
                
                # Rate limiting delay
                time.sleep(delay_seconds)
        
        logger.info(
            f"Batch complete: {stats['scored']} AI, {stats['fallback']} fallback, "
            f"${stats['total_cost']:.4f} total cost"
        )
        
        return results, stats
