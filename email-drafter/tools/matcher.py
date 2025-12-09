#!/usr/bin/env python3
"""
Email Drafter Matcher - Preprocessor Script

Joins lead data with property values, matches contractors to leads by
geography and trade, calculates dynamic stats, outputs enriched JSON.

Usage:
    python matcher.py --trade pool --limit 20
    python matcher.py --trade roofing --limit 50
    python matcher.py  # All trades, no limit
"""

import argparse
import csv
import json
import re
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from statistics import mean

# Paths
BASE_DIR = Path(__file__).parent.parent.parent
EXPORTS_DIR = BASE_DIR / "exports"
OUTPUT_DIR = Path(__file__).parent.parent
LEADS_CSV = EXPORTS_DIR / "leads.csv"
TRACERFY_CSV = EXPORTS_DIR / "homeowner_leads_tracerfy_deduped.csv"
SENT_HISTORY = OUTPUT_DIR / "sent_history.json"

# Contractor files by trade
CONTRACTOR_FILES = {
    "pool": EXPORTS_DIR / "contractors_pool_emails.csv",
    "patio": EXPORTS_DIR / "contractors_patio-covers_emails.csv",
    "shades": EXPORTS_DIR / "contractors_motorized-shades_emails.csv",
    "general": EXPORTS_DIR / "contractors_with_emails.csv",
}

# Metro Clusters (DFW area)
CLUSTERS = {
    "north": ["plano", "frisco", "mckinney", "allen", "prosper", "the colony", "celina", "anna"],
    "east": ["dallas", "richardson", "garland", "mesquite", "rowlett", "rockwall", "wylie", "sachse"],
    "west": ["fort worth", "arlington", "grand prairie", "irving", "hurst", "euless", "bedford", "mansfield"],
    "south": ["cedar hill", "duncanville", "desoto", "lancaster", "midlothian", "waxahachie", "red oak"],
    "central": ["carrollton", "lewisville", "flower mound", "coppell", "farmers branch", "addison", "denton"],
    "premium": ["southlake", "westlake", "highland park", "university park", "colleyville", "keller", "trophy club"],
}

# Reverse lookup: city -> cluster
CITY_TO_CLUSTER = {}
for cluster, cities in CLUSTERS.items():
    for city in cities:
        CITY_TO_CLUSTER[city] = cluster

# Lead type to trade mapping
LEAD_TYPE_TO_TRADE = {
    "pool": ["pool", "spa", "swimming"],
    "roofing": ["roof", "roofing", "hail", "shingle"],
    "patio": ["patio", "remodel", "addition", "deck", "pergola", "outdoor"],
    "fence": ["fence", "fencing"],
    "hvac": ["hvac", "mechanical", "ac", "heating", "cooling"],
    "general": ["residential", "new construction", "building", "other"],
}

# Luxury threshold
LUXURY_VALUE_THRESHOLD = 1_000_000


def normalize_city(city: str) -> str:
    """Normalize city name for matching."""
    if not city:
        return ""
    return city.lower().strip()


def get_cluster(city: str) -> str:
    """Get metro cluster for a city."""
    normalized = normalize_city(city)
    return CITY_TO_CLUSTER.get(normalized, "other")


def is_premium_city(city: str) -> bool:
    """Check if city is in the premium cluster."""
    return get_cluster(city) == "premium"


def parse_money(value: str) -> int:
    """Parse money string like '$1,234,567' to int."""
    if not value:
        return 0
    cleaned = re.sub(r"[^\d]", "", str(value))
    return int(cleaned) if cleaned else 0


def match_trade(lead_type: str, target_trade: str) -> bool:
    """Check if a lead type matches the target trade."""
    if not lead_type:
        return False
    lead_lower = lead_type.lower()
    keywords = LEAD_TYPE_TO_TRADE.get(target_trade, [])
    return any(kw in lead_lower for kw in keywords)


def load_leads() -> dict:
    """Load leads.csv and return dict keyed by property_id."""
    leads = {}
    with open(LEADS_CSV, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            prop_id = row.get("property_id", "").strip()
            if prop_id:
                leads[prop_id] = {
                    "lead_id": row.get("lead_id", ""),
                    "lead_type": row.get("lead_type", ""),
                    "tier": row.get("tier", ""),
                    "permit_date": row.get("permit_date", ""),
                    "is_absentee": row.get("is_absentee", "0") == "1",
                    "days_since_permit": int(row.get("days_since_permit", 999) or 999),
                }
    print(f"Loaded {len(leads)} leads from leads.csv")
    return leads


def load_tracerfy() -> dict:
    """Load tracerfy CSV and return dict keyed by property address."""
    tracerfy = {}
    with open(TRACERFY_CSV, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            prop_addr = row.get("Property Address", "").strip()
            if prop_addr:
                # Extract city from property address (format: "123 Main St, City TX")
                city_match = re.search(r",\s*([^,]+?)\s+TX", prop_addr)
                city = city_match.group(1) if city_match else row.get("City", "")

                tracerfy[prop_addr] = {
                    "first_name": row.get("First Name", ""),
                    "last_name": row.get("Last Name", ""),
                    "mailing_address": row.get("Address", ""),
                    "mailing_city": row.get("City", ""),
                    "property_address": prop_addr,
                    "property_city": city,
                    "market_value": parse_money(row.get("Market Value", "0")),
                    "lead_types": row.get("Lead Types", ""),
                }
    print(f"Loaded {len(tracerfy)} properties from tracerfy CSV")
    return tracerfy


def join_data(leads: dict, tracerfy: dict) -> list:
    """Join leads with tracerfy data on property address."""
    joined = []
    matched = 0

    for prop_id, lead_data in leads.items():
        # Try to find matching tracerfy record
        tracerfy_data = tracerfy.get(prop_id)

        if tracerfy_data:
            matched += 1
            combined = {**lead_data, **tracerfy_data}
            joined.append(combined)
        else:
            # Still include lead, just without value data
            lead_data["property_address"] = prop_id
            lead_data["market_value"] = 0
            lead_data["property_city"] = ""
            # Try to extract city from property_id
            city_match = re.search(r",\s*([^,]+?)\s+TX", prop_id)
            if city_match:
                lead_data["property_city"] = city_match.group(1)
            joined.append(lead_data)

    print(f"Joined {matched} leads with tracerfy data ({len(joined)} total)")
    return joined


def load_contractors(trade: str) -> list:
    """Load contractors for a specific trade."""
    csv_file = CONTRACTOR_FILES.get(trade, CONTRACTOR_FILES["general"])

    if not csv_file.exists():
        print(f"Warning: {csv_file} not found")
        return []

    contractors = []
    with open(csv_file, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            email = row.get("email", "").strip()
            if not email or "@" not in email:
                continue

            contractors.append({
                "business_name": row.get("business_name", ""),
                "email": email,
                "city": row.get("city", ""),
                "cluster": get_cluster(row.get("city", "")),
                "trade": trade,
                "google_rating": float(row.get("google_rating", 0) or 0),
                "google_review_count": int(row.get("google_review_count", 0) or 0),
            })

    print(f"Loaded {len(contractors)} contractors for trade '{trade}'")
    return contractors


def load_sent_history() -> dict:
    """Load sent history to prevent duplicate sends."""
    if SENT_HISTORY.exists():
        with open(SENT_HISTORY, "r") as f:
            return json.load(f)
    return {}


def calculate_stats(leads: list) -> dict:
    """Calculate aggregate stats for a set of leads."""
    if not leads:
        return {"lead_count": 0, "hot_count": 0, "avg_value": 0, "high_value_count": 0, "absentee_pct": 0}

    values = [l.get("market_value", 0) for l in leads if l.get("market_value", 0) > 0]
    hot = [l for l in leads if l.get("days_since_permit", 999) <= 30]
    high_value = [l for l in leads if l.get("market_value", 0) >= LUXURY_VALUE_THRESHOLD]
    absentee = [l for l in leads if l.get("is_absentee")]

    return {
        "lead_count": len(leads),
        "hot_count": len(hot),
        "avg_value": int(mean(values)) if values else 0,
        "high_value_count": len(high_value),
        "absentee_pct": int(len(absentee) / len(leads) * 100) if leads else 0,
    }


def match_leads_to_contractor(contractor: dict, all_leads: list, trade: str, contractor_index: int = 0) -> list:
    """Find leads matching a contractor by trade and geography.

    Uses contractor_index to rotate through leads so each contractor gets different samples.
    """
    contractor_cluster = contractor.get("cluster", "other")
    is_premium = contractor_cluster == "premium"

    # Filter by trade
    trade_leads = [l for l in all_leads if match_trade(l.get("lead_type", "") or l.get("lead_types", ""), trade)]

    if not trade_leads:
        # Fallback: use all leads if no trade match
        trade_leads = all_leads

    if is_premium:
        # Premium contractors see all leads, sorted by value (highest first)
        sorted_leads = sorted(trade_leads, key=lambda x: x.get("market_value", 0), reverse=True)
        # Rotate based on contractor index
        start_idx = (contractor_index * 3) % max(len(sorted_leads), 1)
        rotated = sorted_leads[start_idx:] + sorted_leads[:start_idx]
        return rotated[:5]
    else:
        # Standard contractors: same cluster + luxury overlay
        cluster_leads = [l for l in trade_leads if get_cluster(l.get("property_city", "")) == contractor_cluster]
        luxury_leads = [l for l in trade_leads if l.get("market_value", 0) >= LUXURY_VALUE_THRESHOLD]

        # Sort by value
        cluster_leads = sorted(cluster_leads, key=lambda x: x.get("market_value", 0), reverse=True)
        luxury_leads = sorted(luxury_leads, key=lambda x: x.get("market_value", 0), reverse=True)

        # Rotate based on contractor index to give each contractor different leads
        if cluster_leads:
            start_idx = (contractor_index * 2) % len(cluster_leads)
            cluster_leads = cluster_leads[start_idx:] + cluster_leads[:start_idx]
        if luxury_leads:
            start_idx = (contractor_index) % len(luxury_leads)
            luxury_leads = luxury_leads[start_idx:] + luxury_leads[:start_idx]

        # Combine and dedupe
        combined = []
        seen_addresses = set()

        # First add cluster leads
        for lead in cluster_leads[:3]:
            addr = lead.get("property_address", "")
            if addr not in seen_addresses:
                combined.append(lead)
                seen_addresses.add(addr)

        # Then add luxury leads
        for lead in luxury_leads[:2]:
            addr = lead.get("property_address", "")
            if addr not in seen_addresses:
                combined.append(lead)
                seen_addresses.add(addr)

        return combined


def format_sample_leads(leads: list) -> list:
    """Format leads for JSON output."""
    samples = []
    for lead in leads[:3]:
        samples.append({
            "address": lead.get("property_address", ""),
            "city": lead.get("property_city", ""),
            "value": lead.get("market_value", 0),
            "permit_date": lead.get("permit_date", ""),
            "lead_id": lead.get("lead_id", ""),
        })
    return samples


def generate_enriched_json(trade: str, limit: int = None) -> list:
    """Generate enriched JSON for a specific trade."""
    # Load all data
    leads_data = load_leads()
    tracerfy_data = load_tracerfy()
    all_leads = join_data(leads_data, tracerfy_data)
    contractors = load_contractors(trade)
    sent_history = load_sent_history()

    # Filter leads by trade for stats
    trade_leads = [l for l in all_leads if match_trade(l.get("lead_type", "") or l.get("lead_types", ""), trade)]
    overall_stats = calculate_stats(trade_leads)

    print(f"\nTrade '{trade}' stats:")
    print(f"  Total matching leads: {overall_stats['lead_count']}")
    print(f"  Hot leads (30 days): {overall_stats['hot_count']}")
    print(f"  Avg value: ${overall_stats['avg_value']:,}")
    print(f"  High value ($1M+): {overall_stats['high_value_count']}")

    enriched = []
    skipped_no_leads = 0
    skipped_sent = 0

    for idx, contractor in enumerate(contractors):
        email = contractor["email"]

        # Check sent history
        if email in sent_history:
            skipped_sent += 1
            continue

        # Match leads (pass index for rotation)
        matched_leads = match_leads_to_contractor(contractor, all_leads, trade, contractor_index=idx)

        # Skip if <2 leads
        if len(matched_leads) < 2:
            skipped_no_leads += 1
            continue

        # Calculate contractor-specific stats
        stats = calculate_stats(matched_leads)
        stats["overall_lead_count"] = overall_stats["lead_count"]
        stats["overall_hot_count"] = overall_stats["hot_count"]

        enriched.append({
            "contractor_email": email,
            "business_name": contractor["business_name"],
            "city": contractor["city"],
            "cluster": contractor["cluster"],
            "trade": trade,
            "google_rating": contractor["google_rating"],
            "stats": stats,
            "sample_leads": format_sample_leads(matched_leads),
        })

    print(f"\nResults:")
    print(f"  Contractors processed: {len(contractors)}")
    print(f"  Skipped (already sent): {skipped_sent}")
    print(f"  Skipped (<2 leads): {skipped_no_leads}")
    print(f"  Ready for drafts: {len(enriched)}")

    # Apply limit
    if limit and len(enriched) > limit:
        enriched = enriched[:limit]
        print(f"  Limited to: {limit}")

    return enriched


def main():
    parser = argparse.ArgumentParser(description="Generate enriched leads JSON for email drafter")
    parser.add_argument("--trade", type=str, default="pool", choices=["pool", "patio", "shades", "roofing", "general"],
                        help="Trade to process (default: pool)")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of contractors")
    parser.add_argument("--output", type=str, default=None, help="Output file path")
    args = parser.parse_args()

    print(f"\n{'='*50}")
    print(f"  EMAIL DRAFTER MATCHER")
    print(f"  Trade: {args.trade}")
    print(f"  Limit: {args.limit or 'None'}")
    print(f"{'='*50}\n")

    enriched = generate_enriched_json(args.trade, args.limit)

    # Output
    output_file = args.output or (OUTPUT_DIR / "leads_enriched.json")
    with open(output_file, "w") as f:
        json.dump(enriched, f, indent=2)

    print(f"\nOutput written to: {output_file}")
    print(f"Run 'node index.js' to create drafts.\n")


if __name__ == "__main__":
    main()
