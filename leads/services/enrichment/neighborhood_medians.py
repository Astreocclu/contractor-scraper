#!/usr/bin/env python3
"""
DFW Signal Engine - Neighborhood Median Calculator

Calculates median property values by ZIP code for high-contrast lead scoring.
"""

import sys
import re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from typing import Dict, List, Optional
from statistics import median

from scripts.utils import setup_logging, get_db_connection

logger = setup_logging("medians", None)


def extract_zip_code(address: str) -> Optional[str]:
    """Extract ZIP code from address string."""
    if not address:
        return None

    # Try various patterns
    patterns = [
        r'TX\s*(\d{5})',           # "Fort Worth TX 76107"
        r',\s*(\d{5})',             # ", 76107"
        r'\s(\d{5})(?:\s|$|-)',     # " 76107 " or " 76107-1234"
    ]

    for pattern in patterns:
        match = re.search(pattern, address, re.IGNORECASE)
        if match:
            return match.group(1)

    return None


def calculate_neighborhood_medians() -> Dict[str, float]:
    """
    Calculate median property values by ZIP code.

    Returns dict of {zip_code: median_value}
    """
    logger.info("Calculating neighborhood medians...")

    # Collect property values by ZIP from properties table directly
    zip_values: Dict[str, List[float]] = {}

    with get_db_connection() as conn:
        # Get properties with market values
        # Use fuzzy matching: property address should be a substring of permit address
        # This handles cases where property has "123 MAIN ST" and permit has "123 MAIN ST, FORT WORTH TX 76107"
        cursor = conn.execute("""
            SELECT DISTINCT
                p.property_address,
                pr.market_value
            FROM permits p
            INNER JOIN properties pr
                ON (
                    p.property_address_normalized = pr.property_address_normalized
                    OR UPPER(p.property_address_normalized) LIKE UPPER(pr.property_address_normalized) || '%'
                    OR UPPER(p.property_address_normalized) LIKE '%' || UPPER(pr.property_address_normalized) || '%'
                )
            WHERE pr.market_value IS NOT NULL AND pr.market_value > 0
              AND p.property_address LIKE '%TX%'
        """)

        for row in cursor:
            address, market_value = row
            zip_code = extract_zip_code(address)

            if zip_code and market_value:
                if zip_code not in zip_values:
                    zip_values[zip_code] = []
                # Avoid duplicate values from multiple permits matching same property
                if float(market_value) not in zip_values[zip_code]:
                    zip_values[zip_code].append(float(market_value))
                    logger.debug(f"  Added {address} -> ZIP {zip_code}: ${market_value:,.0f}")

    # Calculate medians
    medians = {}
    for zip_code, values in zip_values.items():
        if len(values) >= 3:  # Need at least 3 properties for meaningful median
            medians[zip_code] = median(values)
            logger.info(f"  ZIP {zip_code}: median ${medians[zip_code]:,.0f} ({len(values)} properties)")
        else:
            logger.debug(f"  ZIP {zip_code}: skipped (only {len(values)} properties)")

    logger.info(f"Calculated medians for {len(medians)} ZIP codes")
    return medians


def save_neighborhood_medians(medians: Dict[str, float]):
    """Save neighborhood medians to database."""
    with get_db_connection() as conn:
        # Create table if not exists
        conn.execute("""
            CREATE TABLE IF NOT EXISTS neighborhood_medians (
                zip_code TEXT PRIMARY KEY,
                median_value REAL,
                property_count INTEGER,
                updated_at TEXT
            )
        """)

        # Clear existing data
        conn.execute("DELETE FROM neighborhood_medians")

        # Insert new medians
        from datetime import datetime
        for zip_code, median_value in medians.items():
            conn.execute("""
                INSERT INTO neighborhood_medians (zip_code, median_value, updated_at)
                VALUES (?, ?, ?)
            """, (zip_code, median_value, datetime.now().isoformat()))

        conn.commit()

    logger.info(f"Saved {len(medians)} neighborhood medians to database")


def get_neighborhood_median(zip_code: str) -> Optional[float]:
    """Get the median value for a ZIP code."""
    with get_db_connection() as conn:
        cursor = conn.execute("""
            SELECT median_value FROM neighborhood_medians WHERE zip_code = ?
        """, (zip_code,))
        row = cursor.fetchone()
        return row[0] if row else None


def update_lead_contrast_scores():
    """
    Update lead scores with actual high-contrast calculations.

    Uses neighborhood medians to calculate contrast ratio and update scores.
    """
    logger.info("Updating lead contrast scores...")

    with get_db_connection() as conn:
        # Get leads with property data
        cursor = conn.execute("""
            SELECT
                l.lead_id,
                l.property_address,
                l.score,
                l.score_breakdown,
                p.property_address,
                pr.market_value
            FROM leads l
            LEFT JOIN permits p ON l.property_address = p.property_address
            LEFT JOIN properties pr ON p.property_address_normalized = pr.property_address_normalized
            WHERE pr.market_value IS NOT NULL AND pr.market_value > 0
        """)

        updated = 0
        for row in cursor:
            lead_id, lead_addr, current_score, breakdown, permit_addr, market_value = row

            # Get ZIP code from permit address
            zip_code = extract_zip_code(permit_addr)
            if not zip_code:
                continue

            # Get neighborhood median
            neighborhood_median = get_neighborhood_median(zip_code)
            if not neighborhood_median or neighborhood_median <= 0:
                continue

            # Calculate contrast ratio
            contrast_ratio = market_value / neighborhood_median

            # Calculate high contrast score (0-20 points)
            if contrast_ratio >= 2.0:
                contrast_score = 20
            elif contrast_ratio >= 1.75:
                contrast_score = 15
            elif contrast_ratio >= 1.5:
                contrast_score = 10
            elif contrast_ratio >= 1.25:
                contrast_score = 5
            else:
                contrast_score = 0

            # Update breakdown
            import json
            try:
                breakdown_dict = json.loads(breakdown) if breakdown else {}
            except:
                breakdown_dict = {}

            old_contrast = breakdown_dict.get("high_contrast", 0)
            breakdown_dict["high_contrast"] = contrast_score

            # Recalculate total score
            new_score = sum(breakdown_dict.values())

            # Determine tier
            if new_score >= 80:
                tier = "A"
            elif new_score >= 60:
                tier = "B"
            elif new_score >= 40:
                tier = "C"
            else:
                tier = "D"

            # Update lead
            conn.execute("""
                UPDATE leads SET
                    score = ?,
                    score_breakdown = ?,
                    tier = ?,
                    contrast_ratio = ?,
                    is_high_contrast = ?
                WHERE lead_id = ?
            """, (
                new_score,
                json.dumps(breakdown_dict),
                tier,
                contrast_ratio,
                contrast_score > 0,
                lead_id
            ))

            if contrast_score != old_contrast:
                updated += 1

        conn.commit()

    logger.info(f"Updated contrast scores for {updated} leads")


def main():
    """Calculate neighborhood medians and update lead scores."""
    # Calculate and save medians
    medians = calculate_neighborhood_medians()
    save_neighborhood_medians(medians)

    # Update lead scores with actual contrast ratios
    update_lead_contrast_scores()

    # Print summary
    print("\n=== Neighborhood Median Summary ===")
    print(f"{'ZIP Code':<10} {'Median Value':<15}")
    print("-" * 30)

    sorted_medians = sorted(medians.items(), key=lambda x: -x[1])
    for zip_code, median_value in sorted_medians[:15]:
        print(f"{zip_code:<10} ${median_value:>12,.0f}")

    if len(medians) > 15:
        print(f"... and {len(medians) - 15} more ZIP codes")


if __name__ == "__main__":
    main()
