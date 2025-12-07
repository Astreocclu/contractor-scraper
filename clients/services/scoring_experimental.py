"""
Experimental Lead Scoring with DeepSeek AI

Uses the "Sales Director" prompt to score leads based on "Monetization Velocity" -
how quickly and profitably a lead can be sold to a contractor.

Scores 0-100:
  - Tier A (80-100): "Whales" - High Net Worth + High Intent
  - Tier B (50-79): Standard commodity jobs or mid-tier wealth
  - Tier C (0-49): Low value, old data, or Builder/Corporate owned
"""

import os
import json
import logging
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, asdict

from django.conf import settings

logger = logging.getLogger(__name__)


# Builder detection keywords
BUILDER_KEYWORDS = [
    "homes", "builders", "construction", "development", "developers",
    "lennar", "horton", "dr horton", "pulte", "kb home", "meritage",
    "weekley", "beazer", "ashton woods", "taylor morrison", "brightland",
    "toll brothers", "centex", "nvr", "ryan homes", "m/i homes"
]


@dataclass
class ScoringResult:
    """Result from the Sales Director AI scorer."""
    score: int
    tier: str  # A, B, or C
    reasoning: str
    ideal_contractor: str
    flags: List[str]
    raw_input: Dict[str, Any]
    chain_of_thought: str = ""  # DeepSeek reasoning model's thinking process
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


SALES_DIRECTOR_SYSTEM_PROMPT = """Role: You are an expert Sales Director for a high-end outdoor living construction platform. You analyze raw lead data to determine "Monetization Velocity" (how quickly and profitably this lead can be sold to a contractor).

The Objective: Score each lead from 0 to 100 based on the likelihood of a high-ticket sale ($20k+).

0-49 (Tier C): Low value, old data, or Volume Builder owned.
50-79 (Tier B): Standard commodity jobs (Roofs, Fences) or Mid-tier wealth or Investor-owned.
80-100 (Tier A): "Whales." High Net Worth + High Intent (Pools, Outdoor Living) + Fresh Data.

The Scoring Rubric (Mental Model):

1. HIERARCHY OF INTENT (Project Type):
   - Platinum (Base 90): Swimming Pools, Outdoor Kitchens, Cabanas, Room Additions.
   - Gold (Base 70): Patios, Decks, Pergolas, Custom New Construction (see rule 5).
   - Silver (Base 50): Roofs, Fences, Window Replacement. (Commodity).
   - Bronze (Base 20): Repairs, HVAC, Water Heaters.

2. WEALTH MULTIPLIER (CAD Data):
   - Total Value > $1.5M: +15 Points.
   - Total Value > $750k: +10 Points.
   - Total Value < $350k: -20 Points (Hard to sell luxury upgrades).

3. TIME DECAY:
   - Roofs/Fences: Radioactive decay. If > 14 days old, Score = Max 30.
   - Pools/Additions: Wine aging. < 60 days is perfect. > 120 days is too late.

4. ENTITY & LLC ANALYSIS (CRITICAL NUANCE):
   Do NOT auto-penalize "LLC" or "Inc". You must classify the entity:
   
   * TYPE A - Personal Asset Protection (Treat as HOMEOWNER, score normally):
     - Clues: "Smith Family LLC", "The Jones Trust", "Revocable Trust", "Family Holdings", "[lastname] Properties".
     - These are often wealthy individuals protecting assets. High-value leads.
   
   * TYPE B - Small Investor / Rental (Treat as B2B, PRICE SENSITIVE):
     - Clues: "Main St Rentals", "Properties LLC", "Capital Group", "Investments", "Holdings".
     - Score conservative (Max 60). They buy based on ROI, not luxury.
     - Apply -5 for absentee owner (harder to contact).
   
   * TYPE C - Volume Builder / Developer (UNRIPE / DEAD LEAD):
     - Clues: "Lennar", "DR Horton", "Pulte", "KB Home", "Homes of Texas", "Development Group", "Builders Inc".
     - Score < 20. We cannot sell to them. Must wait for them to sell the house.

5. NEW CONSTRUCTION CLASSIFICATION (IMPORTANT):
   "Residential new" or "new construction" permits require CAREFUL analysis:
   
   * CUSTOM HOME (Score as Gold, base 70):
     - Owner name is a PERSON (e.g., "FREEMAN, JAMES", "Smith, Robert").
     - This is someone building their dream home. Excellent lead for upgrades!
   
   * SPEC BUILD (Score < 20, dead lead):
     - Owner name is a BUILDER or LLC (e.g., "Lennar Homes", "ABC Builders LLC").
     - This is inventory for sale. Must wait until sold to end buyer.

Output Format (Strict JSON):
{
  "score": 92,
  "tier": "A",
  "step_by_step": "1. Project Type: Pool = Platinum (base 90). 2. Wealth: $850k > $750k = +10. 3. Time: 16 days old = perfect. 4. Entity: Personal name = homeowner. Final: 100, capped at 92.",
  "reasoning": "High-value pool permit in $850k home. Fresh lead, perfect timing for screen sales.",
  "ideal_contractor": "Screen/Patio",
  "flags": ["Luxury"]
}"""


class SalesDirectorScorer:
    """
    AI-powered lead scorer using DeepSeek.
    Implements the "Sales Director" scoring methodology.
    """
    
    DEEPSEEK_API_BASE = "https://api.deepseek.com/v1"
    MODEL = "deepseek-chat"  # Using chat model (reasoner API too slow)
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or getattr(settings, 'DEEPSEEK_API_KEY', None) or os.getenv('DEEPSEEK_API_KEY')
        if not self.api_key:
            logger.warning("No DeepSeek API key configured")
    
    def _is_builder(self, owner_name: str) -> bool:
        """Quick heuristic check for builder names."""
        if not owner_name:
            return False
        owner_lower = owner_name.lower()
        return any(keyword in owner_lower for keyword in BUILDER_KEYWORDS)
    
    def _calculate_days_old(self, permit_date: Any) -> int:
        """Calculate days since permit was issued."""
        if not permit_date:
            return 999  # Very old
        
        if isinstance(permit_date, str):
            try:
                permit_date = datetime.strptime(permit_date, "%Y-%m-%d").date()
            except ValueError:
                return 999
        elif isinstance(permit_date, datetime):
            permit_date = permit_date.date()
        
        return (date.today() - permit_date).days
    
    def _prepare_lead_data(self, lead: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare lead data for the AI prompt."""
        # Normalize field names
        return {
            "project_description": lead.get("project_description") or lead.get("description") or lead.get("permit_type", "Unknown"),
            "permit_date": str(lead.get("permit_date") or lead.get("issued_date", "")),
            "market_value": float(lead.get("market_value") or lead.get("total_value") or 0),
            "owner_name": lead.get("owner_name") or lead.get("owner", "Unknown"),
            "lead_source": lead.get("lead_source", "Permit"),
            "days_old": self._calculate_days_old(lead.get("permit_date") or lead.get("issued_date")),
            "is_absentee": lead.get("is_absentee", False),
        }
    
    def _call_deepseek(self, prompt: str) -> tuple:
        """
        Call DeepSeek Chat API.
        Returns (content, reasoning) tuple where reasoning may be empty.
        """
        import requests
        
        if not self.api_key:
            raise ValueError("DeepSeek API key not configured")
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.MODEL,
            "messages": [
                {"role": "system", "content": SALES_DIRECTOR_SYSTEM_PROMPT},
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 1000,
            "temperature": 0.3
        }
        
        try:
            response = requests.post(
                f"{self.DEEPSEEK_API_BASE}/chat/completions",
                headers=headers,
                json=payload,
                timeout=60
            )
            response.raise_for_status()
            
            data = response.json()
            message = data["choices"][0]["message"]
            content = message.get("content", "")
            # For chat model, step_by_step reasoning is in the JSON content itself
            reasoning = message.get("reasoning_content", "")  # Only present in reasoner model
            
            return content, reasoning
            
        except requests.exceptions.RequestException as e:
            logger.error(f"DeepSeek API error: {e}")
            raise
    
    def _parse_response(self, response: str) -> Dict[str, Any]:
        """Parse JSON from DeepSeek response."""
        # Handle markdown code blocks
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            response = response.split("```")[1].split("```")[0]
        
        # Find JSON object
        match = re.search(r'\{[\s\S]*\}', response)
        if match:
            response = match.group(0)
        
        return json.loads(response.strip())
    
    def _fallback_score(self, lead_data: Dict[str, Any]) -> ScoringResult:
        """
        Fallback deterministic scoring when API fails.
        Uses simplified version of the rubric.
        """
        desc = (lead_data.get("project_description") or "").lower()
        value = lead_data.get("market_value", 0)
        owner = lead_data.get("owner_name", "")
        days_old = lead_data.get("days_old", 999)
        
        # Builder trap
        if self._is_builder(owner):
            return ScoringResult(
                score=10,
                tier="C",
                reasoning="Builder/Corporate owner detected - not a retail homeowner",
                ideal_contractor="Skip",
                flags=["Builder"],
                raw_input=lead_data
            )
        
        # Base score from project type
        if any(kw in desc for kw in ["pool", "swim", "spa", "outdoor kitchen", "cabana"]):
            base = 90
            contractor = "Pool/Screen"
        elif any(kw in desc for kw in ["patio", "deck", "pergola"]):
            base = 70
            contractor = "Patio/Deck"
        elif any(kw in desc for kw in ["roof", "fence", "window"]):
            base = 50
            contractor = "Roofing/Fence"
            # Time decay for commodity jobs
            if days_old > 14:
                base = min(base, 30)
        else:
            base = 20
            contractor = "General"
        
        # Wealth multiplier
        if value > 1_500_000:
            base += 15
        elif value > 750_000:
            base += 10
        elif value < 350_000:
            base -= 20
        
        # Cap and tier
        score = max(0, min(100, base))
        if score >= 80:
            tier = "A"
        elif score >= 50:
            tier = "B"
        else:
            tier = "C"
        
        flags = []
        if value > 1_000_000:
            flags.append("Luxury")
        if days_old <= 14:
            flags.append("Hot")
        
        return ScoringResult(
            score=score,
            tier=tier,
            reasoning=f"Fallback scoring: {desc[:50]}... | ${value:,.0f} | {days_old} days old",
            ideal_contractor=contractor,
            flags=flags,
            raw_input=lead_data
        )
    
    def score_lead(self, lead: Dict[str, Any], use_fallback_on_error: bool = True) -> ScoringResult:
        """
        Score a single lead using the Sales Director AI with reasoning.
        
        Args:
            lead: Dictionary with lead data
            use_fallback_on_error: If True, use deterministic fallback on API errors
            
        Returns:
            ScoringResult with score, tier, reasoning, chain_of_thought, etc.
        """
        lead_data = self._prepare_lead_data(lead)
        
        # Note: We let the AI decide about builders now - no hard-coded trap
        
        try:
            prompt = f"Score this lead:\n\n{json.dumps(lead_data, indent=2)}"
            content, chain_of_thought = self._call_deepseek(prompt)
            result = self._parse_response(content)
            
            return ScoringResult(
                score=result.get("score", 50),
                tier=result.get("tier", "B"),
                reasoning=result.get("reasoning", "No reasoning provided"),
                ideal_contractor=result.get("ideal_contractor", "Unknown"),
                flags=result.get("flags", []),
                raw_input=lead_data,
                # Use step_by_step from JSON, or API reasoning_content if available
                chain_of_thought=result.get("step_by_step", "") or chain_of_thought
            )
            
        except Exception as e:
            logger.warning(f"DeepSeek scoring failed, using fallback: {e}")
            if use_fallback_on_error:
                return self._fallback_score(lead_data)
            raise
    
    def score_batch(self, leads: List[Dict[str, Any]], use_fallback_on_error: bool = True) -> List[ScoringResult]:
        """
        Score multiple leads.
        
        Args:
            leads: List of lead dictionaries
            use_fallback_on_error: If True, use fallback for failed leads
            
        Returns:
            List of ScoringResult objects
        """
        results = []
        for lead in leads:
            try:
                result = self.score_lead(lead, use_fallback_on_error)
                results.append(result)
            except Exception as e:
                logger.error(f"Failed to score lead: {e}")
                # Create error result
                results.append(ScoringResult(
                    score=0,
                    tier="C",
                    reasoning=f"Scoring error: {str(e)}",
                    ideal_contractor="Unknown",
                    flags=["Error"],
                    raw_input=lead
                ))
        
        return results


def generate_html_report(results: List[ScoringResult], title: str = "Lead Scoring Report") -> str:
    """
    Generate an HTML report for Playwright rendering.
    
    Args:
        results: List of ScoringResult objects
        title: Report title
        
    Returns:
        HTML string
    """
    tier_colors = {
        "A": "#22c55e",  # green
        "B": "#eab308",  # yellow
        "C": "#ef4444",  # red
    }
    
    rows = ""
    for i, r in enumerate(results, 1):
        color = tier_colors.get(r.tier, "#gray")
        flags_html = " ".join(f'<span class="flag">{f}</span>' for f in r.flags)
        
        rows += f"""
        <tr>
            <td>{i}</td>
            <td style="background-color: {color}; color: white; font-weight: bold;">{r.tier}</td>
            <td><strong>{r.score}</strong></td>
            <td>{r.raw_input.get('project_description', 'Unknown')[:40]}</td>
            <td>${r.raw_input.get('market_value', 0):,.0f}</td>
            <td>{r.raw_input.get('days_old', '?')} days</td>
            <td>{r.ideal_contractor}</td>
            <td>{r.reasoning[:60]}...</td>
            <td>{flags_html}</td>
        </tr>
        """
    
    html = f"""<!DOCTYPE html>
<html>
<head>
    <title>{title}</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; background: #1a1a2e; color: #eee; }}
        h1 {{ color: #00d4ff; }}
        table {{ border-collapse: collapse; width: 100%; margin-top: 20px; }}
        th, td {{ border: 1px solid #333; padding: 10px; text-align: left; }}
        th {{ background: #16213e; color: #00d4ff; }}
        tr:nth-child(even) {{ background: #1f2937; }}
        tr:hover {{ background: #374151; }}
        .flag {{ background: #6366f1; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-right: 4px; }}
        .summary {{ display: flex; gap: 20px; margin-top: 20px; }}
        .stat {{ background: #16213e; padding: 15px 25px; border-radius: 8px; text-align: center; }}
        .stat-value {{ font-size: 36px; font-weight: bold; color: #00d4ff; }}
        .stat-label {{ color: #888; margin-top: 5px; }}
    </style>
</head>
<body>
    <h1>🎯 {title}</h1>
    <p>Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
    
    <div class="summary">
        <div class="stat">
            <div class="stat-value">{len(results)}</div>
            <div class="stat-label">Total Leads</div>
        </div>
        <div class="stat">
            <div class="stat-value">{sum(1 for r in results if r.tier == 'A')}</div>
            <div class="stat-label">Tier A (Whales)</div>
        </div>
        <div class="stat">
            <div class="stat-value">{sum(1 for r in results if r.tier == 'B')}</div>
            <div class="stat-label">Tier B</div>
        </div>
        <div class="stat">
            <div class="stat-value">{sum(1 for r in results if r.tier == 'C')}</div>
            <div class="stat-label">Tier C</div>
        </div>
        <div class="stat">
            <div class="stat-value">{sum(r.score for r in results) // max(len(results), 1)}</div>
            <div class="stat-label">Avg Score</div>
        </div>
    </div>
    
    <table>
        <thead>
            <tr>
                <th>#</th>
                <th>Tier</th>
                <th>Score</th>
                <th>Project</th>
                <th>Value</th>
                <th>Age</th>
                <th>Ideal Contractor</th>
                <th>Reasoning</th>
                <th>Flags</th>
            </tr>
        </thead>
        <tbody>
            {rows}
        </tbody>
    </table>
</body>
</html>"""
    
    return html
