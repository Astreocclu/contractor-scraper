#!/usr/bin/env python3
"""
DFW Signal Engine - Lead Scoring

Scores leads based on permit type, property value, absentee status, and freshness.
"""

import sys
import json
import uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from datetime import date, datetime
from typing import Optional, Tuple, Dict, List, Any

from scripts.utils import (
    setup_logging, get_db_connection, normalize_address
)

# Scoring configuration (per LEAD_SCORING.md)
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

    # High priority - New construction (45 points)
    "residential new": 45,
    "new construction": 45,

    # Medium priority - Additions/Accessories (35-40 points)
    "residential accessory new": 40,  # Often pools/patios
    "residential accessory addition": 35,
    "residential addition": 35,
    "addition": 35,

    # Medium priority - Remodels (30 points)
    "residential remodel": 30,
    "remodel": 30,

    # Lower priority - Fence (15 points - security-conscious but limited scope)
    "fence": 15,

    # Fallback
    "other": 10
}

SUBTYPE_BONUSES = {
    "spa": 5,
    "water_feature": 3,
    "outdoor_kitchen": 5,
    "pergola": 3,
    "screen_enclosure": 10
}

logger = setup_logging("score", None)


def get_permit_score(permit_type: str, description: str = "") -> Tuple[int, str]:
    """
    Calculate permit type score.

    Returns (score, detected_type)
    """
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


def get_high_contrast_score(market_value: Optional[float],
                            neighborhood_median: Optional[float]) -> Tuple[int, float]:
    """
    Calculate high contrast score based on property value vs neighborhood.

    Returns (score, contrast_ratio)
    """
    if not market_value or not neighborhood_median or neighborhood_median <= 0:
        return 0, 0.0

    ratio = market_value / neighborhood_median

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
    """
    Calculate freshness score based on days since permit.

    Returns (score, tier, days)
    """
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


def get_tier(score: int) -> str:
    """Get lead tier based on score."""
    if score >= 80:
        return "A"
    elif score >= 60:
        return "B"
    elif score >= 40:
        return "C"
    else:
        return "D"


def score_lead(permit: Dict, property_data: Dict) -> Dict:
    """
    Score a single lead based on permit and property data.

    Returns a dict with score, breakdown, and tier.
    """
    breakdown = {}

    # 1. Permit type score (0-50)
    permit_score, lead_type = get_permit_score(
        permit.get("permit_type"),
        permit.get("description")
    )
    breakdown["permit_type"] = permit_score

    # 2. High contrast score (0-20)
    # For now, use a simple approach since we don't have neighborhood medians
    # We'll use property value tiers as a proxy
    market_value = property_data.get("market_value")
    contrast_score = 0
    contrast_ratio = 0.0

    if market_value:
        if market_value >= 1000000:
            contrast_score = 20
        elif market_value >= 750000:
            contrast_score = 15
        elif market_value >= 500000:
            contrast_score = 10
        elif market_value >= 350000:
            contrast_score = 5
        contrast_ratio = market_value / 350000 if market_value else 0  # Proxy ratio

    breakdown["high_contrast"] = contrast_score

    # 3. Absentee owner score (0-15)
    is_absentee = property_data.get("is_absentee", False)
    absentee_score = get_absentee_score(is_absentee)
    breakdown["absentee"] = absentee_score

    # 4. Freshness score (0-15)
    permit_date = permit.get("issued_date")
    if isinstance(permit_date, str):
        try:
            permit_date = datetime.fromisoformat(permit_date).date()
        except:
            permit_date = None

    freshness_score, freshness_tier, days_since = get_freshness_score(permit_date)
    breakdown["freshness"] = freshness_score

    # Total score
    total_score = sum(breakdown.values())
    tier = get_tier(total_score)

    return {
        "score": total_score,
        "breakdown": breakdown,
        "tier": tier,
        "lead_type": lead_type,
        "freshness_tier": freshness_tier,
        "days_since_permit": days_since,
        "is_high_contrast": contrast_score > 0,
        "contrast_ratio": contrast_ratio,
        "is_absentee": is_absentee,
        "permit_date": permit_date
    }


def score_lead_with_median(permit: Dict, property_data: Dict) -> Dict:
    """
    Score a lead using real neighborhood median for high-contrast calculation.
    """
    breakdown = {}

    # 1. Permit type score (0-50)
    permit_score, lead_type = get_permit_score(
        permit.get("permit_type"),
        permit.get("description")
    )
    breakdown["permit_type"] = permit_score

    # 2. High contrast score using real neighborhood median (0-20)
    market_value = property_data.get("market_value")
    neighborhood_median = property_data.get("neighborhood_median")

    contrast_score, contrast_ratio = get_high_contrast_score(market_value, neighborhood_median)
    breakdown["high_contrast"] = contrast_score

    # 3. Absentee owner score (0-15)
    is_absentee = property_data.get("is_absentee", False)
    absentee_score = get_absentee_score(is_absentee)
    breakdown["absentee"] = absentee_score

    # 4. Freshness score (0-15)
    permit_date = permit.get("issued_date")
    if isinstance(permit_date, str):
        try:
            permit_date = datetime.fromisoformat(permit_date).date()
        except:
            permit_date = None

    freshness_score, freshness_tier, days_since = get_freshness_score(permit_date)
    breakdown["freshness"] = freshness_score

    # 5. Multiple permits bonus (0-5)
    permit_count = permit.get("permit_count", 1)
    if permit_count >= 3:
        breakdown["multi_permit"] = 5
    elif permit_count >= 2:
        breakdown["multi_permit"] = 2

    # Total score
    total_score = sum(breakdown.values())
    tier = get_tier(total_score)

    return {
        "score": total_score,
        "breakdown": breakdown,
        "tier": tier,
        "lead_type": lead_type,
        "freshness_tier": freshness_tier,
        "days_since_permit": days_since,
        "is_high_contrast": contrast_score > 0,
        "contrast_ratio": contrast_ratio,
        "is_absentee": is_absentee,
        "permit_date": permit_date,
        "permit_count": permit_count,
        "all_permit_types": permit.get("all_permit_types", [])
    }


def get_neighborhood_median(conn, property_address: str) -> Optional[float]:
    """Get neighborhood median for a property based on ZIP code."""
    import re
    # Extract ZIP code from address
    patterns = [
        r'TX\s*(\d{5})',
        r',\s*(\d{5})',
        r'\s(\d{5})(?:\s|$|-)',
    ]
    for pattern in patterns:
        match = re.search(pattern, property_address, re.IGNORECASE)
        if match:
            zip_code = match.group(1)
            cursor = conn.execute(
                "SELECT median_value FROM neighborhood_medians WHERE zip_code = ?",
                (zip_code,)
            )
            row = cursor.fetchone()
            if row:
                return row[0]
    return None


def deduplicate_permits(permits: List[Dict]) -> Dict[str, Dict]:
    """
    Deduplicate permits by property address.

    For each property, keeps the most recent permit and combines permit types.
    Returns dict of {normalized_address: merged_permit_data}
    """
    from collections import defaultdict

    # Group by normalized address
    address_groups = defaultdict(list)
    for permit in permits:
        addr_norm = normalize_address(permit.get("property_address", ""))
        if addr_norm:
            address_groups[addr_norm].append(permit)

    # Merge each group
    deduplicated = {}
    for addr_norm, group in address_groups.items():
        if not group:
            continue

        # Sort by date (most recent first)
        def get_date(p):
            d = p.get("issued_date")
            if isinstance(d, str):
                try:
                    return datetime.fromisoformat(d).date()
                except:
                    return date.min
            return d if d else date.min

        group.sort(key=get_date, reverse=True)

        # Use most recent permit as base
        merged = group[0].copy()

        # Collect all permit types
        permit_types = list(set(p.get("permit_type", "") for p in group if p.get("permit_type")))
        merged["all_permit_types"] = permit_types
        merged["permit_count"] = len(group)

        # Check if any permit is a pool
        for p in group:
            ptype = (p.get("permit_type") or "").lower()
            desc = (p.get("description") or "").lower()
            if "pool" in ptype or "pool" in desc or "spa" in ptype or "swim" in desc:
                merged["permit_type"] = "pool"  # Elevate to pool type
                break

        deduplicated[addr_norm] = merged

    return deduplicated


def extract_street_key(address: str) -> str:
    """Extract a simple street key for fuzzy matching (number + street name)."""
    import re
    if not address:
        return ""
    # Normalize
    addr = address.upper().strip()
    # Extract street number and name
    match = re.match(r'^(\d+)\s+([A-Z]+(?:\s+[A-Z]+)?)', addr)
    if match:
        return f"{match.group(1)} {match.group(2)}"
    return addr[:30]


def score_all_leads():
    """Score all enriched permits and create leads with deduplication."""
    logger.info("Starting lead scoring with deduplication...")

    with get_db_connection() as conn:
        # First, load all enriched properties into a lookup by street key
        logger.info("Loading enriched property data...")
        prop_cursor = conn.execute("""
            SELECT property_address, owner_name, mailing_address, market_value,
                   is_absentee, year_built, square_feet, county
            FROM properties
            WHERE enrichment_status = 'success' AND market_value > 0
        """)

        property_by_street = {}
        for row in prop_cursor:
            street_key = extract_street_key(row[0])
            if street_key and street_key not in property_by_street:
                property_by_street[street_key] = {
                    "owner_name": row[1],
                    "mailing_address": row[2],
                    "market_value": row[3],
                    "is_absentee": row[4],
                    "year_built": row[5],
                    "square_feet": row[6],
                    "county": row[7]
                }
        logger.info(f"Loaded {len(property_by_street)} enriched properties")

        # Get all permits
        cursor = conn.execute("""
            SELECT
                p.permit_id,
                p.city,
                p.property_address,
                p.permit_type,
                p.description,
                p.issued_date
            FROM permits p
        """)

        rows = cursor.fetchall()
        logger.info(f"Found {len(rows)} permits to score")

        # Convert to list of dicts for deduplication
        permits_list = []
        property_lookup = {}
        matched_count = 0

        for row in rows:
            permit = {
                "permit_id": row[0],
                "city": row[1],
                "property_address": row[2],
                "permit_type": row[3],
                "description": row[4],
                "issued_date": row[5]
            }
            permits_list.append(permit)

            # Match to enriched property using street key
            addr_norm = normalize_address(row[2] or "")
            street_key = extract_street_key(row[2] or "")

            if addr_norm and addr_norm not in property_lookup:
                # Try to find matching property by street key
                prop_data = property_by_street.get(street_key, {})
                if prop_data:
                    matched_count += 1
                property_lookup[addr_norm] = prop_data

        logger.info(f"Matched {matched_count} permits to enriched properties")

        # Deduplicate permits
        deduplicated = deduplicate_permits(permits_list)
        logger.info(f"After deduplication: {len(deduplicated)} unique properties (from {len(permits_list)} permits)")

        scored_count = 0
        for addr_norm, permit in deduplicated.items():
            property_data = property_lookup.get(addr_norm, {})

            # Get neighborhood median for high-contrast scoring
            neighborhood_median = get_neighborhood_median(conn, permit.get("property_address", ""))
            property_data["neighborhood_median"] = neighborhood_median

            # Score the lead
            result = score_lead_with_median(permit, property_data)

            # Check if lead already exists
            existing = conn.execute("""
                SELECT lead_id FROM leads
                WHERE property_address = ?
            """, (permit["property_address"],)).fetchone()

            if existing:
                # Update existing lead
                conn.execute("""
                    UPDATE leads SET
                        lead_type = ?,
                        score = ?,
                        score_breakdown = ?,
                        tier = ?,
                        freshness_tier = ?,
                        days_since_permit = ?,
                        is_high_contrast = ?,
                        contrast_ratio = ?,
                        is_absentee = ?,
                        permit_date = ?,
                        updated_at = ?
                    WHERE property_address = ?
                """, (
                    result["lead_type"],
                    result["score"],
                    json.dumps(result["breakdown"]),
                    result["tier"],
                    result["freshness_tier"],
                    result["days_since_permit"],
                    result["is_high_contrast"],
                    result["contrast_ratio"],
                    result["is_absentee"],
                    result["permit_date"].isoformat() if result["permit_date"] else None,
                    datetime.now().isoformat(),
                    permit["property_address"]
                ))
            else:
                # Create new lead
                lead_id = str(uuid.uuid4())[:8]
                conn.execute("""
                    INSERT INTO leads (
                        lead_id, property_address, lead_type, score, score_breakdown,
                        tier, freshness_tier, days_since_permit, is_high_contrast,
                        contrast_ratio, is_absentee, permit_date, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
                """, (
                    lead_id,
                    permit["property_address"],
                    result["lead_type"],
                    result["score"],
                    json.dumps(result["breakdown"]),
                    result["tier"],
                    result["freshness_tier"],
                    result["days_since_permit"],
                    result["is_high_contrast"],
                    result["contrast_ratio"],
                    result["is_absentee"],
                    result["permit_date"].isoformat() if result["permit_date"] else None
                ))

            scored_count += 1

        conn.commit()

    logger.info(f"Scored {scored_count} leads")

    # Print summary
    print_score_summary()


def print_score_summary():
    """Print a summary of scored leads."""
    with get_db_connection() as conn:
        # Get counts by tier
        cursor = conn.execute("""
            SELECT tier, COUNT(*) as count, AVG(score) as avg_score
            FROM leads
            GROUP BY tier
            ORDER BY tier
        """)

        print("\n=== Lead Score Summary ===")
        print(f"{'Tier':<6} {'Count':<8} {'Avg Score':<10}")
        print("-" * 30)

        total = 0
        for row in cursor:
            tier, count, avg = row
            print(f"{tier:<6} {count:<8} {avg:.1f}")
            total += count

        print("-" * 30)
        print(f"Total: {total} leads")

        # Top leads
        cursor = conn.execute("""
            SELECT l.property_address, l.score, l.tier, l.lead_type,
                   l.freshness_tier, p.owner_name, p.market_value
            FROM leads l
            LEFT JOIN properties p ON l.property_address = p.property_address
            ORDER BY l.score DESC
            LIMIT 10
        """)

        print("\n=== Top 10 Leads ===")
        for row in cursor:
            addr, score, tier, lead_type, fresh, owner, value = row
            value_str = f"${value:,.0f}" if value else "N/A"
            print(f"[{tier}] {score}: {addr[:40]:<40} ({lead_type}, {fresh}, {value_str})")


if __name__ == "__main__":
    score_all_leads()
