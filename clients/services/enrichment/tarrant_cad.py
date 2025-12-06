#!/usr/bin/env python3
"""
DFW Signal Engine - Tarrant CAD Enrichment

Enriches permit data with property information from Tarrant County Appraisal District
via ArcGIS REST API.
"""

import sys
import re
import json
import requests
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from datetime import datetime
from typing import Optional, List, Dict, Any

from scripts.utils import (
    PropertyData, rate_limit, setup_logging, save_property,
    normalize_address, get_db_connection, DATA_DIR
)

# Configuration
COUNTY = "tarrant"
# Primary endpoint: TAD ParcelView (has full property data)
ARCGIS_URL = "https://tad.newedgeservices.com/arcgis/rest/services/TAD/ParcelView/MapServer/1/query"

# Fields to request from ArcGIS (TAD ParcelView field names)
OUT_FIELDS = [
    "Situs_Addr", "Owner_Name", "Owner_Addr", "Owner_City", "Owner_Zip",
    "Total_Valu", "Land_Value", "Improvemen", "Year_Built", "Living_Are", "Land_Acres",
    "City", "Account_Nu", "Swimming_P", "Property_C"
]

logger = setup_logging("enrich", COUNTY)


def extract_address_parts(address: str) -> Dict[str, str]:
    """Extract house number and street name from an address."""
    if not address:
        return {}

    # Clean up address
    addr = address.upper().strip()

    # Remove city, state, zip if present
    addr = re.sub(r',\s*(FORT WORTH|TX|TEXAS|\d{5}).*$', '', addr, flags=re.I)

    # Remove unit/apt numbers
    addr = re.sub(r'\s+(APT|UNIT|STE|SUITE|#)\s*\S*', '', addr)

    # Try to extract house number and street
    match = re.match(r'^(\d+)\s+(.+)$', addr.strip())
    if match:
        house_num = match.group(1)
        street = match.group(2).strip()
        return {"house_num": house_num, "street": street}

    return {}


def query_property(address: str) -> Optional[Dict[str, Any]]:
    """
    Query the ArcGIS API for a property by address.

    Returns the first matching property or None.
    """
    parts = extract_address_parts(address)
    if not parts.get("house_num") or not parts.get("street"):
        logger.warning(f"Could not parse address: {address}")
        return None

    # Build query - search for properties with matching house number
    # and street name containing our search term
    house_num = parts["house_num"]
    street = parts["street"]

    # Extract just the main street name (remove ST, AVE, DR etc)
    street_core = re.sub(r'\s+(ST|AVE|DR|RD|LN|CT|BLVD|WAY|PL|CIR|PKWY|HWY).*$', '', street)
    street_core = street_core.strip()

    if len(street_core) < 3:
        street_core = street

    # Query with LIKE on Situs_Addr (TAD ParcelView field name)
    where_clause = f"Situs_Addr LIKE '{house_num} %{street_core}%'"

    params = {
        "where": where_clause,
        "outFields": ",".join(OUT_FIELDS),
        "f": "json",
        "resultRecordCount": 10
    }

    try:
        rate_limit()
        response = requests.get(ARCGIS_URL, params=params, timeout=30)
        response.raise_for_status()

        data = response.json()
        features = data.get("features", [])

        if not features:
            logger.debug(f"No results for: {address}")
            return None

        # If multiple results, try to find best match
        if len(features) > 1:
            # Try exact house number match
            for f in features:
                situs = f["attributes"].get("Situs_Addr", "")
                if situs.upper().startswith(f"{house_num} "):
                    return f["attributes"]

        # Return first result
        return features[0]["attributes"]

    except requests.RequestException as e:
        logger.error(f"API error for {address}: {e}")
        return None
    except (KeyError, json.JSONDecodeError) as e:
        logger.error(f"Parse error for {address}: {e}")
        return None


def enrich_property(address: str) -> Optional[PropertyData]:
    """
    Enrich a single property address with CAD data.

    Returns PropertyData or None if not found.
    """
    cad_data = query_property(address)

    if not cad_data:
        return None

    # Build mailing address (TAD ParcelView field names)
    owner_addr = (cad_data.get("Owner_Addr") or "").strip()
    owner_city = (cad_data.get("Owner_City") or "").strip()
    owner_zip = (cad_data.get("Owner_Zip") or "").strip()
    mailing_address = f"{owner_addr}, {owner_city} {owner_zip}".strip(", ")

    # Detect absentee owner
    situs = normalize_address(cad_data.get("Situs_Addr", ""))
    mailing_norm = normalize_address(mailing_address)
    is_absentee = situs != mailing_norm if mailing_norm else False

    # Parse values (TAD returns them as strings with padding)
    def parse_value(val):
        if not val:
            return None
        try:
            return float(str(val).strip())
        except (ValueError, TypeError):
            return None

    def parse_int(val):
        if not val:
            return None
        try:
            return int(str(val).strip())
        except (ValueError, TypeError):
            return None

    return PropertyData(
        property_address=cad_data.get("Situs_Addr", address),
        cad_account_id=cad_data.get("Account_Nu"),
        county=COUNTY,
        owner_name=(cad_data.get("Owner_Name") or "").strip(),
        mailing_address=mailing_address if mailing_address else None,
        market_value=parse_value(cad_data.get("Total_Valu")),
        land_value=parse_value(cad_data.get("Land_Value")),
        improvement_value=parse_value(cad_data.get("Improvemen")),
        year_built=parse_int(cad_data.get("Year_Built")),
        square_feet=parse_int(cad_data.get("Living_Are")),
        lot_size=parse_value(cad_data.get("Land_Acres")),
        property_type=cad_data.get("Property_C"),
        neighborhood_code=None,  # TAD doesn't expose this in the public API
        is_absentee=is_absentee,
        homestead_exempt=False  # Would need additional lookup
    )


def get_unenriched_permits() -> List[Dict[str, Any]]:
    """Get permits that haven't been enriched yet."""
    with get_db_connection() as conn:
        cursor = conn.execute("""
            SELECT DISTINCT p.property_address, p.city
            FROM permits p
            LEFT JOIN properties pr ON p.property_address_normalized = pr.property_address_normalized
            WHERE pr.property_address IS NULL
            AND p.city IN (
                SELECT DISTINCT city FROM permits
                WHERE city IN ('fort_worth', 'southlake', 'keller', 'colleyville',
                              'grapevine', 'north_richland_hills', 'westlake')
            )
            LIMIT 500
        """)
        return [{"address": row[0], "city": row[1]} for row in cursor.fetchall()]


def enrich_all_permits():
    """Enrich all unenriched permits with CAD data."""
    permits = get_unenriched_permits()

    if not permits:
        logger.info("No unenriched permits found")
        return

    logger.info(f"Enriching {len(permits)} permits...")

    success_count = 0
    fail_count = 0

    for i, permit in enumerate(permits):
        address = permit["address"]
        logger.info(f"[{i+1}/{len(permits)}] Enriching: {address}")

        try:
            prop_data = enrich_property(address)

            if prop_data:
                save_property(prop_data)
                success_count += 1
                logger.info(f"  -> {prop_data.owner_name}, ${prop_data.market_value:,.0f}" if prop_data.market_value else f"  -> {prop_data.owner_name}")
            else:
                fail_count += 1
                logger.info(f"  -> Not found in CAD")

                # Save a placeholder to avoid re-trying
                placeholder = PropertyData(
                    property_address=address,
                    county=COUNTY
                )
                # Mark as failed enrichment
                with get_db_connection() as conn:
                    conn.execute("""
                        INSERT OR REPLACE INTO properties (
                            property_address, property_address_normalized,
                            county, enrichment_status, enriched_at
                        ) VALUES (?, ?, ?, 'failed', ?)
                    """, (address, normalize_address(address), COUNTY, datetime.now().isoformat()))
                    conn.commit()

        except Exception as e:
            logger.error(f"  -> Error: {e}")
            fail_count += 1

    logger.info(f"Enrichment complete: {success_count} success, {fail_count} failed")


def enrich_single_address(address: str):
    """Enrich a single address (for testing)."""
    logger.info(f"Enriching single address: {address}")

    prop = enrich_property(address)
    if prop:
        print(f"\nProperty: {prop.property_address}")
        print(f"Owner: {prop.owner_name}")
        print(f"Mailing: {prop.mailing_address}")
        print(f"Market Value: ${prop.market_value:,.0f}" if prop.market_value else "Market Value: N/A")
        print(f"Year Built: {prop.year_built}")
        print(f"Sq Ft: {prop.square_feet}")
        print(f"Absentee Owner: {prop.is_absentee}")
    else:
        print("Property not found in CAD")

    return prop


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Tarrant CAD Enrichment")
    parser.add_argument("--address", help="Single address to test")
    parser.add_argument("--all", action="store_true", help="Enrich all unenriched permits")
    args = parser.parse_args()

    if args.address:
        enrich_single_address(args.address)
    elif args.all:
        enrich_all_permits()
    else:
        # Default: run enrichment on all unenriched permits
        enrich_all_permits()
