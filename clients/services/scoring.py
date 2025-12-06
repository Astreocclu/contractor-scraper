"""
Lead Scoring Service

Scores leads based on permit type, property value, absentee status, and freshness.
"""

import logging
from datetime import date
from typing import Tuple, Optional
from decimal import Decimal

from django.utils import timezone

from clients.models import Permit, Property, Lead

logger = logging.getLogger(__name__)


# Scoring configuration
PERMIT_TYPE_SCORES = {
    # High priority - Pool permits (50 points)
    "pool": 50,
    "pool/spa": 50,
    "swimming pool": 50,
    "spa": 50,

    # High priority - Outdoor living (40-45 points)
    "patio enclosure": 45,
    "patio": 40,
    "deck": 40,
    "patio/deck": 40,

    # High priority - New construction (45 points)
    "residential new": 45,
    "new construction": 45,

    # Medium priority - Additions/Accessories (35-40 points)
    "residential accessory new": 40,
    "residential accessory addition": 35,
    "residential addition": 35,
    "addition": 35,

    # Medium priority - Remodels (30 points)
    "residential remodel": 30,
    "remodel": 30,
    "commercial new": 30,
    "commercial addition": 30,
    "commercial remodel": 25,

    # Lower priority - Fence (15 points - security-conscious)
    "fence": 15,
    "pool barrier": 40,  # Pool barrier means pool construction

    # Fallback
    "other": 10
}


def get_permit_score(permit_type: str, description: str = "") -> Tuple[int, str]:
    """Calculate permit type score. Returns (score, detected_type)."""
    if not permit_type:
        return 10, "other"

    permit_type_lower = permit_type.lower()

    # Check for exact matches first
    for type_name, score in PERMIT_TYPE_SCORES.items():
        if type_name in permit_type_lower:
            return min(score, 50), type_name

    # Check description for pool keywords
    desc_lower = (description or "").lower()
    if "pool" in desc_lower or "swim" in desc_lower:
        return 50, "pool"
    if "patio" in desc_lower or "deck" in desc_lower:
        return 40, "patio"

    return 10, "other"


def get_high_contrast_score(market_value: Optional[Decimal],
                            neighborhood_median: Optional[Decimal]) -> Tuple[int, float]:
    """Calculate high contrast score. Returns (score, contrast_ratio)."""
    if not market_value or not neighborhood_median or neighborhood_median <= 0:
        return 0, 0.0

    ratio = float(market_value / neighborhood_median)

    if ratio >= 2.0:
        return 20, ratio
    elif ratio >= 1.75:
        return 15, ratio
    elif ratio >= 1.5:
        return 10, ratio
    elif ratio >= 1.25:
        return 5, ratio
    else:
        return 0, ratio


def get_absentee_score(is_absentee: bool) -> int:
    """Calculate absentee owner score."""
    return 15 if is_absentee else 0


def get_freshness_score(permit_date: Optional[date]) -> Tuple[int, str, int]:
    """Calculate freshness score. Returns (score, tier, days)."""
    if not permit_date:
        return 5, "unknown", 0

    days = (date.today() - permit_date).days

    if days <= 14:
        return 15, "hot", days
    elif days <= 30:
        return 12, "warm", days
    elif days <= 45:
        return 8, "moderate", days
    elif days <= 60:
        return 5, "cool", days
    elif days <= 90:
        return 2, "cold", days
    else:
        return 0, "stale", days


def get_tier(score: float) -> str:
    """Get lead tier based on score."""
    if score >= 80:
        return "A"
    elif score >= 60:
        return "B"
    elif score >= 40:
        return "C"
    else:
        return "D"


def score_lead(permit: Permit, prop: Optional[Property] = None) -> Lead:
    """
    Score a single permit and create/update a lead.

    Args:
        permit: The permit to score
        prop: Optional enriched property data

    Returns:
        The created or updated Lead
    """
    # Calculate component scores
    permit_score, lead_type = get_permit_score(permit.permit_type, permit.description)

    # Property-based scores
    contrast_score = 0
    contrast_ratio = 0.0
    absentee_score = 0
    is_absentee = False
    is_high_contrast = False

    if prop:
        contrast_score, contrast_ratio = get_high_contrast_score(
            prop.market_value, prop.neighborhood_median
        )
        absentee_score = get_absentee_score(prop.is_absentee)
        is_absentee = prop.is_absentee
        is_high_contrast = contrast_ratio >= 1.5

    # Freshness score
    freshness_score, freshness_tier, days_since = get_freshness_score(permit.issued_date)

    # Total score
    total_score = permit_score + contrast_score + absentee_score + freshness_score

    # Get tier
    tier = get_tier(total_score)

    # Build score breakdown
    score_breakdown = {
        "permit": permit_score,
        "permit_type": lead_type,
        "contrast": contrast_score,
        "absentee": absentee_score,
        "freshness": freshness_score,
        "total": total_score
    }

    # Generate lead ID
    lead_id = f"{permit.city}_{permit.permit_id}"

    # Get or create property for the lead
    property_address = permit.property_address
    if not prop:
        prop, _ = Property.objects.get_or_create(
            property_address=property_address,
            defaults={'enrichment_status': 'pending'}
        )

    # Create or update lead
    lead, created = Lead.objects.update_or_create(
        lead_id=lead_id,
        defaults={
            'property': prop,
            'lead_type': lead_type,
            'is_high_contrast': is_high_contrast,
            'contrast_ratio': contrast_ratio,
            'is_absentee': is_absentee,
            'score': total_score,
            'score_breakdown': score_breakdown,
            'tier': tier,
            'permit_date': permit.issued_date,
            'days_since_permit': days_since,
            'freshness_tier': freshness_tier,
        }
    )

    action = "Created" if created else "Updated"
    logger.debug(f"{action} lead {lead_id}: score={total_score}, tier={tier}")

    return lead


def score_all_permits(limit: int = None) -> int:
    """
    Score all permits and create/update leads.

    Args:
        limit: Optional limit on number of permits to process

    Returns:
        Number of leads created/updated
    """
    permits = Permit.objects.all()
    if limit:
        permits = permits[:limit]

    count = 0
    for permit in permits:
        try:
            # Try to find enriched property data
            try:
                prop = Property.objects.get(
                    property_address__iexact=permit.property_address
                )
            except Property.DoesNotExist:
                prop = None

            score_lead(permit, prop)
            count += 1

        except Exception as e:
            logger.error(f"Error scoring permit {permit.permit_id}: {e}")

    logger.info(f"Scored {count} permits")
    return count
