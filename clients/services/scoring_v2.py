"""
Lead Scoring V2 - AI-Powered Sales Director Scoring

Three-layer scoring system:
1. Layer 1: Pre-filter (discard junk before AI sees it)
2. Layer 2: AI Scoring (DeepSeek scores 0-100 with reasoning)
3. Layer 3: Export buckets by category and tier

Usage:
    from clients.services.scoring_v2 import score_leads, export_leads

    results = await score_leads(permits)
    export_leads(results, output_dir="exports/")
"""

import os
import re
import json
import csv
import asyncio
import random
import logging
from datetime import date, datetime
from django.utils import timezone
from pathlib import Path
from decimal import Decimal
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field, asdict

import aiohttp
from django.conf import settings

logger = logging.getLogger(__name__)


# =============================================================================
# PRODUCTION BUILDER DETECTION
# =============================================================================

PRODUCTION_BUILDERS = [
    # National builders
    "lennar", "dr horton", "d.r. horton", "pulte", "pultegroup", "kb home",
    "meritage", "toll brothers", "centex", "nvr", "ryan homes", "m/i homes",
    "taylor morrison", "beazer", "ashton woods", "weekley", "david weekley",
    "highland homes", "perry homes", "gehan", "tri pointe", "shea homes",
    "standard pacific", "ryland", "kb homes", "taylor morrison",

    # Texas regional builders
    "bloomfield homes", "history maker", "impression homes", "antares homes",
    "first texas", "grand homes", "plantation homes", "altura homes",
    "coventry homes", "newmark homes", "westin homes", "trendmaker",
    "saratoga homes", "chesmar", "sitterle", "empire communities",
    "mcguyer homebuilders", "stylecraft", "pacesetter", "dunhill",
    "brightland", "southgate", "chesmar homes", "trophy signature",

    # Builder indicators in names
    "homes llc", "homes inc", "homebuilders", "home builders",
    "development llc", "development inc", "developers llc",
    "builders llc", "builders inc", "construction llc",
    "communities llc", "communities inc", "residential llc",
]

PRODUCTION_BUILDER_PATTERNS = [
    r"\bhomes\s+(of|at|in)\s+",  # "Homes of Texas", "Homes at Cedar Park"
    r"\bhome\s+builders?\b",
    r"\bdevelopment\s+(group|corp|co)\b",
    r"\bbuilders?\s+(group|corp|co)\b",
    r"\bresidential\s+(group|corp|co)\b",
]


def is_production_builder(text: str) -> bool:
    """
    Check if text indicates a production builder.

    Returns True if:
    - Contains known production builder name
    - Matches production builder pattern
    """
    if not text:
        return False

    text_lower = text.lower().strip()

    # Check exact/partial matches
    for builder in PRODUCTION_BUILDERS:
        if builder in text_lower:
            return True

    # Check patterns
    for pattern in PRODUCTION_BUILDER_PATTERNS:
        if re.search(pattern, text_lower):
            return True

    return False


# =============================================================================
# JUNK PROJECT DETECTION
# =============================================================================

JUNK_PROJECTS = [
    # Low-value projects
    "shed", "storage building", "carport",

    # Repairs (not new construction) - NOTE: foundation/slab repair REMOVED - these are $15-40k jobs
    "fire repair", "fire damage",
    "storm damage", "hail damage", "water damage",

    # Maintenance/utilities (be specific to avoid false positives)
    "electrical panel", "water heater",
    "hvac replacement", "ac replacement", "furnace replacement",
    "sewer repair", "sewer replacement", "sewer line repair",

    # Demolition (be specific to avoid matching "tear down shingles")
    "demolition", "demo permit", "tear down house", "tear down building", "tear down structure",

    # Temporary
    "temporary", "temp permit", "construction trailer",

    # Signs
    "sign permit", "signage", "banner",

    # Commercial that's not useful
    "tenant finish", "tenant improvement", "ti permit",
]


def is_junk_project(description: str) -> bool:
    """Check if project description indicates a junk/low-value project."""
    if not description:
        return False

    desc_lower = description.lower()
    return any(junk in desc_lower for junk in JUNK_PROJECTS)


# =============================================================================
# LAYER 1: PRE-FILTER (should_discard)
# =============================================================================

@dataclass
class PermitData:
    """Normalized permit data for scoring."""
    permit_id: str
    city: str
    property_address: str
    owner_name: str = "Unknown"
    project_description: str = ""
    permit_type: str = ""
    market_value: float = 0.0
    is_absentee: bool = False
    issued_date: Optional[date] = None
    days_old: int = 0

    # Enriched fields
    county: str = ""
    year_built: Optional[int] = None
    square_feet: Optional[int] = None

    @classmethod
    def from_permit_model(cls, permit, property_obj=None) -> "PermitData":
        """Create PermitData from Django Permit and Property models."""
        days_old = 0
        if permit.issued_date:
            days_old = (date.today() - permit.issued_date).days

        data = cls(
            permit_id=permit.permit_id,
            city=permit.city,
            property_address=permit.property_address,
            owner_name=permit.applicant_name or "Unknown",
            project_description=permit.description or permit.permit_type or "",
            permit_type=permit.permit_type or "",
            issued_date=permit.issued_date,
            days_old=days_old,
        )

        if property_obj:
            data.owner_name = property_obj.owner_name or data.owner_name
            data.market_value = float(property_obj.market_value or 0)
            data.is_absentee = property_obj.is_absentee
            data.county = property_obj.county or ""
            data.year_built = property_obj.year_built
            data.square_feet = property_obj.square_feet

        return data


def should_discard(permit: PermitData) -> Tuple[bool, str]:
    """
    Returns (True, reason) if lead should be thrown out entirely.

    Filters:
    1. Production builders - they're building spec homes, not our customer
    2. Junk project types - low-value repairs, utilities, etc.
    3. Too old - stale leads have low conversion
    4. Zero data - can't contact or assess
    """
    # Production builders - gone
    if is_production_builder(permit.owner_name):
        return True, f"Production builder in owner: {permit.owner_name}"

    if is_production_builder(permit.project_description):
        return True, f"Production builder in description: {permit.project_description[:50]}"

    # Junk categories - gone
    if is_junk_project(permit.project_description):
        return True, f"Junk project type: {permit.project_description[:50]}"

    # Too old - gone (90 days max)
    if permit.days_old > 90:
        return True, f"Too old: {permit.days_old} days"

    # Zero data - gone (can't contact AND can't assess wealth)
    if permit.owner_name in ("Unknown", "", None) and permit.market_value == 0:
        return True, "No owner name AND no market value"

    return False, ""


# =============================================================================
# LAYER 2: AI SCORING
# =============================================================================

SALES_DIRECTOR_PROMPT_V2 = """You are a Sales Director scoring leads for a contractor lead marketplace in DFW (Dallas-Fort Worth).

YOUR BUYERS (contractors who will pay for these leads):
- Luxury outdoor: Pool builders, patio/outdoor living contractors, fence companies
- Home exterior: Roofers, concrete contractors, window/siding installers
- Home systems: HVAC contractors, plumbers, electricians
- Structural: Foundation repair specialists, custom home builders (NOT production builders)
- Commercial: Commercial HVAC, plumbing, electrical contractors

THEIR CUSTOMERS: Homeowners (or businesses) with money who want quality work

SCORE 0-100 BASED ON: "How quickly can a premium contractor monetize this lead?"

PRINCIPLES (not formulas):

1. APPLICANT TYPE MATTERS MOST
   - Homeowner doing their own permit = gold (active buyer)
   - Custom/boutique builder = okay (cross-sell other trades)
   - LLC/investor = depends on property value
   - Production builder in project_description = trash (should be filtered, score 0 if you see one)

2. FRESHNESS VARIES BY CATEGORY
   - Roof leads go stale in 2 weeks (emergency/insurance driven)
   - Foundation repair: 3-4 weeks (urgent but needs quotes)
   - HVAC replacement: 2-3 weeks (seasonal urgency)
   - Pool leads stay warm for 2 months (big decision, long planning)
   - Plumbing/electrical: 30 days (permitted = planned work, not emergency)
   - Everything else: 30 days is the line between warm and cool

3. WEALTH = WILLINGNESS TO PAY
   - $1M+ property = pays for quality, doesn't haggle
   - $500-750k = solid, will compare 2-3 quotes
   - <$400k in DFW = price shopping, low margin

4. ABSENTEE IS CONTEXTUAL
   - Absentee + high value = vacation home, wealthy
   - Absentee + low value = landlord, will choose cheapest

5. MISSING DATA = ASSUME THE WORST
   - Unknown owner = can't contact
   - $0 market value = can't assess wealth
   - Vague project description = unclear intent

6. PROJECT DESCRIPTION REVEALS TRUTH
   - Owner name looks personal but project_description has "Construction Corp" = BUILDER
   - "Custom Pools" in description = high intent, specific
   - Just an address in description = no information

OUTPUT FORMAT:
{
  "score": 0-100,
  "tier": "A" (80+) | "B" (50-79) | "C" (<50),
  "reasoning": "2-3 sentences explaining the score",
  "flags": ["list", "of", "concerns"],
  "ideal_contractor": "who should buy this lead",
  "contact_priority": "call" | "email" | "skip"
}

CALIBRATION:
- 90+: Call today, high close probability
- 70-89: Strong lead, standard follow-up
- 50-69: Worth working, needs qualification
- 30-49: Low priority, batch outreach only
- <30: Why did this pass the filter? Flag for review"""


@dataclass
class ScoredLead:
    """Result from AI scoring."""
    permit: PermitData
    score: int
    tier: str  # A, B, C, or RETRY
    reasoning: str
    flags: List[str] = field(default_factory=list)
    ideal_contractor: str = ""
    contact_priority: str = "email"  # call, email, skip
    category: str = "other"  # pool, hvac, roof, concrete, etc.
    trade_group: str = "other"  # luxury_outdoor, home_systems, commercial, etc.
    chain_of_thought: str = ""  # DeepSeek reasoner's thinking process

    # Metadata
    scored_at: datetime = field(default_factory=timezone.now)
    scoring_method: str = "ai"  # ai, ai-reasoner, pending_retry

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            **asdict(self.permit),
            "score": self.score,
            "tier": self.tier,
            "reasoning": self.reasoning,
            "chain_of_thought": self.chain_of_thought,
            "flags": self.flags,
            "ideal_contractor": self.ideal_contractor,
            "contact_priority": self.contact_priority,
            "category": self.category,
            "trade_group": self.trade_group,
            "scored_at": self.scored_at.isoformat(),
            "scoring_method": self.scoring_method,
        }


# =============================================================================
# CATEGORY & TRADE GROUP DEFINITIONS
# =============================================================================

TRADE_GROUPS = {
    # Luxury outdoor - current buyers
    "pool": "luxury_outdoor",
    "outdoor_living": "luxury_outdoor",
    "fence": "luxury_outdoor",

    # Home exterior
    "roof": "home_exterior",
    "siding": "home_exterior",
    "windows": "home_exterior",
    "garage_door": "home_exterior",
    "concrete": "home_exterior",
    "painting": "home_exterior",

    # Home systems
    "hvac": "home_systems",
    "plumbing": "home_systems",
    "electrical": "home_systems",
    "solar": "home_systems",
    "insulation": "home_systems",

    # Structural
    "foundation": "structural",
    "addition": "structural",
    "new_construction": "structural",
    "remodel": "structural",

    # Commercial (same trades, different buyers)
    "commercial_pool": "commercial",
    "commercial_roof": "commercial",
    "commercial_hvac": "commercial",
    "commercial_plumbing": "commercial",
    "commercial_electrical": "commercial",
    "tenant_improvement": "commercial",

    # Unsellable
    "demolition": "unsellable",
    "temporary": "unsellable",
    "signage": "unsellable",

    # Catch-all
    "other": "other",
}

# Keywords for category detection (order matters - first match wins)
CATEGORY_KEYWORDS = {
    # Pool
    "pool": ["pool", "swim", "spa", "hot tub", "gunite", "fiberglass pool"],

    # Outdoor living
    "outdoor_living": ["patio", "deck", "pergola", "outdoor kitchen", "cabana",
                       "gazebo", "arbor", "screen enclosure", "lanai", "covered patio",
                       "shade structure", "pavilion", "outdoor living"],

    # Fence
    "fence": ["fence", "fencing", "privacy fence", "iron fence", "wood fence"],

    # Roof
    "roof": ["roof", "roofing", "re-roof", "reroof", "shingle", "metal roof"],

    # Siding/exterior
    "siding": ["siding", "hardie", "stucco", "exterior finish"],
    "windows": ["window", "door replacement", "sliding door", "french door"],
    "garage_door": ["garage door", "overhead door"],
    "painting": ["exterior paint", "house painting"],

    # Concrete/hardscape
    "concrete": ["driveway", "sidewalk", "concrete", "flatwork", "stamped concrete",
                 "pavers", "hardscape"],

    # HVAC
    "hvac": ["hvac", "air condition", "ac unit", "furnace", "heat pump", "ductwork",
             "mini split", "a/c", "heating", "cooling system", "condenser"],

    # Plumbing
    "plumbing": ["plumb", "water heater", "tankless", "water line", "sewer",
                 "gas line", "repipe", "water service", "drain", "fixture"],

    # Electrical
    "electrical": ["electric", "panel", "outlet", "circuit", "wire", "meter",
                   "service upgrade", "ev charger", "generator", "lighting"],

    # Solar
    "solar": ["solar", "photovoltaic", "pv system", "battery storage"],

    # Insulation
    "insulation": ["insulation", "radiant barrier", "weatherization"],

    # Foundation
    "foundation": ["foundation", "pier", "underpinning", "slab repair",
                   "leveling", "structural repair"],

    # New construction / addition
    "new_construction": ["new home", "new construction", "new sfd", "new sfr",
                         "custom home", "spec home", "build house"],
    "addition": ["addition", "room addition", "add on", "extend", "expansion"],

    # Remodel
    "remodel": ["remodel", "renovation", "kitchen remodel", "bath remodel",
                "interior finish", "gut rehab"],

    # Tenant improvement (commercial)
    "tenant_improvement": ["tenant", "ti permit", "buildout", "commercial interior"],

    # Unsellable
    "demolition": ["demo", "demolition", "tear down", "raze"],
    "temporary": ["temporary", "temp permit", "construction trailer"],
    "signage": ["sign permit", "signage", "banner", "monument sign"],
}

# Commercial indicators
COMMERCIAL_INDICATORS = [
    "commercial", "office", "retail", "restaurant", "hotel", "motel",
    "warehouse", "industrial", "tenant", "suite", "unit #", "shopping",
    "plaza", "center", "mall", "store", "business", "corp", "inc.",
    "llc", "ltd", "church", "school", "hospital", "medical", "clinic"
]


def is_commercial_property(permit: PermitData) -> bool:
    """Detect if permit is for commercial property."""
    text = f"{permit.project_description} {permit.owner_name} {permit.property_address}".lower()

    # Check for commercial indicators
    for indicator in COMMERCIAL_INDICATORS:
        if indicator in text:
            return True

    return False


def categorize_permit(permit: PermitData) -> str:
    """
    Categorize permit into trade bucket.

    Returns category string (e.g., 'pool', 'hvac', 'roof').
    Use get_trade_group() to get the group (e.g., 'luxury_outdoor', 'home_systems').
    """
    desc = (permit.project_description + " " + permit.permit_type).lower()
    is_commercial = is_commercial_property(permit)

    # Check each category's keywords (order matters)
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(kw in desc for kw in keywords):
            # Prefix commercial categories
            if is_commercial and category in ["pool", "roof", "hvac", "plumbing", "electrical"]:
                return f"commercial_{category}"
            return category

    return "other"


def get_trade_group(category: str) -> str:
    """Get the trade group for a category."""
    return TRADE_GROUPS.get(category, "other")


class DeepSeekScorerV2:
    """
    AI scorer using DeepSeek with the Sales Director v2 prompt.
    Supports async batch processing.

    Can use either:
    - deepseek-chat: Fast, standard model
    - deepseek-reasoner: Slower but includes chain-of-thought reasoning
    """

    API_BASE = "https://api.deepseek.com/v1"
    MODEL_CHAT = "deepseek-chat"
    MODEL_REASONER = "deepseek-reasoner"

    def __init__(self, api_key: str = None, use_reasoner: bool = False):
        self.api_key = api_key or getattr(settings, 'DEEPSEEK_API_KEY', None) or os.getenv('DEEPSEEK_API_KEY')
        self.use_reasoner = use_reasoner
        self.model = self.MODEL_REASONER if use_reasoner else self.MODEL_CHAT
        if not self.api_key:
            logger.error("No DeepSeek API key configured - scoring will fail")

    async def score_single(self, permit: PermitData, session: aiohttp.ClientSession) -> ScoredLead:
        """Score a single permit using AI."""
        if not self.api_key:
            raise ValueError("DeepSeek API key not configured. Set DEEPSEEK_API_KEY environment variable.")

        try:
            lead_data = {
                "project_description": permit.project_description,
                "permit_type": permit.permit_type,
                "owner_name": permit.owner_name,
                "market_value": permit.market_value,
                "days_old": permit.days_old,
                "is_absentee": permit.is_absentee,
                "city": permit.city,
            }

            prompt = f"Score this lead:\n\n{json.dumps(lead_data, indent=2)}"

            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }

            # Build payload - reasoner model doesn't support system messages or temperature
            if self.use_reasoner:
                # Reasoner: combine system prompt into user message
                combined_prompt = f"{SALES_DIRECTOR_PROMPT_V2}\n\n---\n\n{prompt}"
                payload = {
                    "model": self.model,
                    "messages": [
                        {"role": "user", "content": combined_prompt}
                    ],
                    "max_tokens": 8000,  # Reasoner needs more tokens for thinking
                }
            else:
                # Chat model: standard format
                payload = {
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": SALES_DIRECTOR_PROMPT_V2},
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": 500,
                    "temperature": 0.3
                }

            async with session.post(
                f"{self.API_BASE}/chat/completions",
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=180)  # Increased for reasoner model
            ) as response:
                response.raise_for_status()
                data = await response.json()

                message = data["choices"][0]["message"]
                content = message.get("content", "")

                # Capture reasoning_content from reasoner model
                chain_of_thought = message.get("reasoning_content", "")

                result = self._parse_response(content)

                category = categorize_permit(permit)
                return ScoredLead(
                    permit=permit,
                    score=result.get("score", 50),
                    tier=result.get("tier", "B"),
                    reasoning=result.get("reasoning", ""),
                    chain_of_thought=chain_of_thought,
                    flags=result.get("flags", []),
                    ideal_contractor=result.get("ideal_contractor", ""),
                    contact_priority=result.get("contact_priority", "email"),
                    category=category,
                    trade_group=get_trade_group(category),
                    scoring_method="ai-reasoner" if self.use_reasoner else "ai"
                )

        except asyncio.TimeoutError:
            logger.warning(f"AI scoring timed out for {permit.permit_id} (>180s)")
            return self._mark_for_retry(permit, "Timeout: DeepSeek API took longer than 180s")
        except aiohttp.ClientError as e:
            logger.warning(f"AI scoring network error for {permit.permit_id}: {type(e).__name__}")
            return self._mark_for_retry(permit, f"Network error: {type(e).__name__}")
        except json.JSONDecodeError as e:
            logger.warning(f"AI scoring JSON parse error for {permit.permit_id}: {e}")
            return self._mark_for_retry(permit, f"JSON parse error: {str(e)[:50]}")
        except Exception as e:
            error_msg = str(e) or type(e).__name__  # Fallback to type name if str is empty
            logger.warning(f"AI scoring failed for {permit.permit_id}: {error_msg}")
            return self._mark_for_retry(permit, error_msg)

    def _parse_response(self, response: str) -> Dict[str, Any]:
        """Parse JSON from AI response."""
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

    def _mark_for_retry(self, permit: PermitData, error: str) -> ScoredLead:
        """
        Mark a lead for retry when API fails.

        Instead of using the broken fallback scorer, we flag these leads
        to be retried later when the API is available.
        """
        category = categorize_permit(permit)

        return ScoredLead(
            permit=permit,
            score=-1,  # Sentinel value indicating not scored
            tier="RETRY",  # Special tier for retry queue
            reasoning=f"API failed: {error[:100]}",
            chain_of_thought="",
            flags=["PENDING_RETRY", f"ERROR: {error[:50]}"],
            ideal_contractor="",
            contact_priority="skip",  # Don't contact until scored
            category=category,
            trade_group=get_trade_group(category),
            scoring_method="pending_retry"
        )

    async def score_batch(
        self,
        permits: List[PermitData],
        max_concurrent: int = 10,
        max_retries: int = 3
    ) -> List[ScoredLead]:
        """
        Score multiple permits in parallel with rate limiting and retry logic.

        Args:
            permits: List of permits to score
            max_concurrent: Max concurrent API calls
            max_retries: Max retry attempts for transient failures

        Returns:
            List of ScoredLead objects
        """
        semaphore = asyncio.Semaphore(max_concurrent)

        async def score_with_retry(permit: PermitData, session: aiohttp.ClientSession):
            """Score with exponential backoff retry for transient failures."""
            async with semaphore:
                for attempt in range(max_retries):
                    # Small delay for rate limiting
                    await asyncio.sleep(0.1)

                    result = await self.score_single(permit, session)

                    # If not a retry-able failure, return immediately
                    if result.tier != "RETRY":
                        return result

                    # Check if it's a transient error worth retrying
                    if attempt < max_retries - 1:
                        wait = (2 ** attempt) + random.uniform(0, 1)
                        logger.info(f"Retrying {permit.permit_id} in {wait:.1f}s (attempt {attempt + 1}/{max_retries})")
                        await asyncio.sleep(wait)

                # All retries exhausted
                return self._mark_for_retry(permit, f"Max retries ({max_retries}) exceeded")

        async with aiohttp.ClientSession() as session:
            tasks = [score_with_retry(p, session) for p in permits]
            results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle any exceptions that escaped
        scored = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                error_msg = str(result) or type(result).__name__
                logger.error(f"Scoring failed for permit {permits[i].permit_id}: {error_msg}")
                scored.append(self._mark_for_retry(permits[i], error_msg))
            else:
                scored.append(result)

        return scored


# =============================================================================
# LAYER 3: MAIN PIPELINE
# =============================================================================

@dataclass
class ScoringStats:
    """Statistics from a scoring run."""
    total_input: int = 0
    discarded: int = 0
    scored: int = 0
    tier_a: int = 0
    tier_b: int = 0
    tier_c: int = 0
    pending_retry: int = 0  # Failed API calls flagged for retry
    flagged_for_review: int = 0
    discard_reasons: Dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


async def score_leads(
    permits: List[PermitData],
    max_concurrent: int = 5,
    api_key: str = None,
    use_reasoner: bool = False
) -> Tuple[List[ScoredLead], ScoringStats]:
    """
    Main scoring pipeline.

    Steps:
    1. Filter out junk (should_discard)
    2. Categorize for export buckets
    3. AI score in parallel batches
    4. Sanity check (flag low scores)

    Args:
        permits: List of PermitData to score
        max_concurrent: Max concurrent API calls
        api_key: Optional DeepSeek API key
        use_reasoner: Use DeepSeek reasoner model with chain-of-thought

    Returns:
        Tuple of (scored_leads, stats)
    """
    stats = ScoringStats(total_input=len(permits))

    # Step 1: Filter
    valid_permits = []
    for permit in permits:
        discard, reason = should_discard(permit)
        if discard:
            stats.discarded += 1
            # Track discard reasons
            reason_key = reason.split(":")[0] if ":" in reason else reason
            stats.discard_reasons[reason_key] = stats.discard_reasons.get(reason_key, 0) + 1
            logger.debug(f"Discarded {permit.permit_id}: {reason}")
        else:
            valid_permits.append(permit)

    logger.info(f"Filtered: {stats.discarded} discarded, {len(valid_permits)} valid")

    if not valid_permits:
        return [], stats

    # Step 2 & 3: AI Score (categorization happens during scoring)
    scorer = DeepSeekScorerV2(api_key=api_key, use_reasoner=use_reasoner)
    scored_leads = await scorer.score_batch(valid_permits, max_concurrent=max_concurrent)

    stats.scored = len(scored_leads)

    # Step 4: Sanity check and tier counts
    for lead in scored_leads:
        if lead.tier == "RETRY":
            stats.pending_retry += 1
        elif lead.tier == "A":
            stats.tier_a += 1
        elif lead.tier == "B":
            stats.tier_b += 1
        else:
            stats.tier_c += 1

        # Flag for review if score < 30 but passed filter (exclude retries)
        if lead.score >= 0 and lead.score < 30:
            lead.flags.append("REVIEW: Low score but passed filter")
            stats.flagged_for_review += 1

    logger.info(f"Scored: A={stats.tier_a}, B={stats.tier_b}, C={stats.tier_c}, retry={stats.pending_retry}, flagged={stats.flagged_for_review}")

    return scored_leads, stats


# =============================================================================
# LAYER 4: EXPORT
# =============================================================================

def export_leads(
    leads: List[ScoredLead],
    output_dir: str = "exports",
    include_flagged: bool = True
) -> Dict[str, int]:
    """
    Export scored leads to CSV files organized by trade group, category, and tier.

    Structure:
    exports/
    ├── luxury_outdoor/
    │   ├── pool/
    │   │   ├── tier_a.csv
    │   │   ├── tier_b.csv
    │   │   └── tier_c.csv
    │   ├── outdoor_living/
    │   └── fence/
    ├── home_exterior/
    │   ├── roof/
    │   ├── concrete/
    │   └── windows/
    ├── home_systems/
    │   ├── hvac/
    │   ├── plumbing/
    │   └── electrical/
    ├── commercial/
    │   ├── commercial_hvac/
    │   └── ...
    ├── flagged/
    │   └── needs_review.csv
    └── pending_retry/
        └── retry_queue.csv

    Returns:
        Dict mapping file paths to record counts
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Group by trade_group -> category -> tier
    buckets: Dict[str, Dict[str, Dict[str, List[ScoredLead]]]] = {}
    flagged: List[ScoredLead] = []
    pending_retry: List[ScoredLead] = []

    for lead in leads:
        trade_group = lead.trade_group
        category = lead.category
        tier = lead.tier.lower()

        # Handle retry leads separately
        if tier == "retry":
            pending_retry.append(lead)
            continue

        # Initialize nested dicts
        if trade_group not in buckets:
            buckets[trade_group] = {}
        if category not in buckets[trade_group]:
            buckets[trade_group][category] = {"a": [], "b": [], "c": []}

        buckets[trade_group][category][tier].append(lead)

        # Collect flagged leads
        if any("REVIEW" in flag for flag in lead.flags):
            flagged.append(lead)

    # Export CSVs
    counts = {}

    csv_fields = [
        "permit_id", "city", "property_address", "owner_name",
        "project_description", "market_value", "days_old", "is_absentee",
        "score", "tier", "trade_group", "category", "reasoning",
        "ideal_contractor", "contact_priority", "flags", "scored_at"
    ]

    def write_csv(filepath: Path, leads_list: List[ScoredLead]):
        """Write leads to CSV file."""
        filepath.parent.mkdir(parents=True, exist_ok=True)

        with open(filepath, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=csv_fields)
            writer.writeheader()

            for lead in leads_list:
                row = {
                    "permit_id": lead.permit.permit_id,
                    "city": lead.permit.city,
                    "property_address": lead.permit.property_address,
                    "owner_name": lead.permit.owner_name,
                    "project_description": lead.permit.project_description,
                    "market_value": lead.permit.market_value,
                    "days_old": lead.permit.days_old,
                    "is_absentee": lead.permit.is_absentee,
                    "score": lead.score,
                    "tier": lead.tier,
                    "trade_group": lead.trade_group,
                    "category": lead.category,
                    "reasoning": lead.reasoning,
                    "ideal_contractor": lead.ideal_contractor,
                    "contact_priority": lead.contact_priority,
                    "flags": "|".join(lead.flags),
                    "scored_at": lead.scored_at.isoformat(),
                }
                writer.writerow(row)

        return len(leads_list)

    # Write trade_group/category/tier buckets
    for trade_group, categories in buckets.items():
        for category, tiers in categories.items():
            for tier, tier_leads in tiers.items():
                if tier_leads:
                    filepath = output_path / trade_group / category / f"tier_{tier}.csv"
                    count = write_csv(filepath, tier_leads)
                    counts[str(filepath)] = count

    # Write flagged
    if include_flagged and flagged:
        filepath = output_path / "flagged" / "needs_review.csv"
        count = write_csv(filepath, flagged)
        counts[str(filepath)] = count

    # Write pending retry (failed API calls to retry later)
    if pending_retry:
        filepath = output_path / "pending_retry" / "retry_queue.csv"
        count = write_csv(filepath, pending_retry)
        counts[str(filepath)] = count

    logger.info(f"Exported {sum(counts.values())} leads to {len(counts)} files")

    return counts


# =============================================================================
# SYNC WRAPPER
# =============================================================================

def score_leads_sync(
    permits: List[PermitData],
    max_concurrent: int = 10,
    api_key: str = None,
    use_reasoner: bool = False
) -> Tuple[List[ScoredLead], ScoringStats]:
    """
    Synchronous wrapper for score_leads.
    Use this in Django management commands.
    """
    return asyncio.run(score_leads(permits, max_concurrent, api_key, use_reasoner))


# =============================================================================
# DATABASE STORAGE
# =============================================================================

def save_scored_leads_to_db(
    leads: List[ScoredLead],
    permit_lookup: Dict[str, Any] = None
) -> Dict[str, int]:
    """
    Save scored leads to the Django database.

    Args:
        leads: List of ScoredLead dataclass objects
        permit_lookup: Optional dict mapping permit_id to Permit model instances

    Returns:
        Dict with counts: {'created': N, 'updated': N, 'skipped': N}
    """
    from clients.models import Permit, Property, ScoredLead as ScoredLeadModel

    counts = {'created': 0, 'updated': 0, 'skipped': 0, 'errors': 0}

    for lead in leads:
        try:
            # Get the Permit model instance
            if permit_lookup and lead.permit.permit_id in permit_lookup:
                permit_obj = permit_lookup[lead.permit.permit_id]
            else:
                try:
                    permit_obj = Permit.objects.get(
                        permit_id=lead.permit.permit_id,
                        city=lead.permit.city
                    )
                except Permit.DoesNotExist:
                    logger.warning(f"Permit not found: {lead.permit.permit_id} in {lead.permit.city}")
                    counts['skipped'] += 1
                    continue

            # Try to get Property for CAD data
            property_obj = None
            if permit_obj.property_address_normalized:
                property_obj = Property.objects.filter(
                    property_address_normalized=permit_obj.property_address_normalized
                ).first()

            # Prepare flags as list (in case it's a string)
            flags = lead.flags if isinstance(lead.flags, list) else [lead.flags]

            # Create or update ScoredLead
            scored_lead, created = ScoredLeadModel.objects.update_or_create(
                permit=permit_obj,
                defaults={
                    'cad_property': property_obj,
                    'category': lead.category,
                    'trade_group': lead.trade_group,
                    'is_commercial': lead.category.startswith('commercial_'),
                    'score': lead.score,
                    'tier': lead.tier,
                    'reasoning': lead.reasoning,
                    'chain_of_thought': lead.chain_of_thought or '',
                    'flags': flags,
                    'ideal_contractor': lead.ideal_contractor or '',
                    'contact_priority': lead.contact_priority or 'email',
                    'scoring_method': lead.scoring_method,
                    'scored_at': lead.scored_at,
                }
            )

            if created:
                counts['created'] += 1
            else:
                counts['updated'] += 1

        except Exception as e:
            logger.error(f"Error saving lead {lead.permit.permit_id}: {e}")
            counts['errors'] += 1

    logger.info(f"Database save: created={counts['created']}, updated={counts['updated']}, "
                f"skipped={counts['skipped']}, errors={counts['errors']}")

    return counts
