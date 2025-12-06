#!/usr/bin/env python3
"""
DFW Signal Engine - Parker County CAD Enrichment

Enriches permits from Parker County cities (Aledo, Weatherford, etc.)
using the Parker County Appraisal District API.

Parker CAD Website: https://www.parkercad.org/
API: Uses similar ArcGIS-based REST API as Tarrant CAD
"""

import sys
import re
import requests
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from datetime import datetime
from typing import Optional, Dict, List

from scripts.utils import (
    setup_logging, get_db_connection, normalize_address, rate_limit
)

# Parker CAD Configuration
# Note: Parker CAD may use a different API structure - this is a template
PARKER_CAD_URL = "https://www.parkercad.org"
PARKER_API_BASE = "https://gis.parkercad.org/arcgis/rest/services"

# Placeholder endpoint - needs to be discovered
SEARCH_ENDPOINT = f"{PARKER_API_BASE}/ParkerCAD/MapServer/0/query"

logger = setup_logging("enrich", "parker")


def search_property(address: str) -> Optional[Dict]:
    """
    Search Parker CAD for property by address.

    Note: This is a template - the actual API endpoint and parameters
    need to be discovered by exploring the Parker CAD website.
    """
    if not address:
        return None

    # Clean address for search
    search_addr = address.upper()
    # Remove city/state suffix
    search_addr = re.sub(r',?\s*(ALEDO|WEATHERFORD|WILLOW PARK).*$', '', search_addr, flags=re.I)
    search_addr = search_addr.strip()

    try:
        # Template query parameters (similar to Tarrant CAD)
        params = {
            "where": f"UPPER(SITUS_ADDRESS) LIKE '%{search_addr}%'",
            "outFields": "*",
            "returnGeometry": "false",
            "f": "json"
        }

        rate_limit()
        response = requests.get(SEARCH_ENDPOINT, params=params, timeout=30)
        response.raise_for_status()

        data = response.json()

        if data.get("features"):
            return data["features"][0]["attributes"]

    except requests.RequestException as e:
        logger.debug(f"API request failed: {e}")
    except Exception as e:
        logger.debug(f"Search error: {e}")

    return None


def extract_property_data(attributes: Dict) -> Dict:
    """Extract property data from Parker CAD response."""
    # Field names may vary - these are placeholders
    return {
        "owner_name": attributes.get("OWNER_NAME") or attributes.get("OWNER"),
        "mailing_address": attributes.get("MAIL_ADDRESS") or attributes.get("MAILING_ADDRESS"),
        "market_value": attributes.get("MARKET_VALUE") or attributes.get("APPRAISED_VALUE"),
        "year_built": attributes.get("YEAR_BUILT"),
        "square_feet": attributes.get("LIVING_AREA") or attributes.get("SQUARE_FEET"),
        "lot_acres": attributes.get("LAND_ACRES") or attributes.get("LOT_SIZE"),
        "legal_desc": attributes.get("LEGAL_DESC") or attributes.get("LEGAL"),
        "property_id": attributes.get("PROP_ID") or attributes.get("ACCOUNT_NUM"),
        "county": "parker"
    }


def is_absentee_owner(property_address: str, mailing_address: str) -> bool:
    """Check if owner is absentee (mailing != property address)."""
    if not mailing_address or not property_address:
        return False

    prop_norm = normalize_address(property_address)
    mail_norm = normalize_address(mailing_address)

    if not prop_norm or not mail_norm:
        return False

    # Simple comparison - could be improved with fuzzy matching
    return prop_norm[:20] != mail_norm[:20]


def enrich_parker_permits():
    """
    Enrich permits from Parker County cities.

    Note: This is a placeholder. Parker CAD API needs to be discovered
    and tested before this can work.
    """
    logger.info("Parker CAD enrichment is not yet implemented")
    logger.info("Parker County cities (Aledo, Weatherford, etc.) need manual API discovery")

    # Parker County cities
    parker_cities = ["aledo", "weatherford", "willow_park", "hudson_oaks"]

    with get_db_connection() as conn:
        # Check if we have any Parker County permits
        for city in parker_cities:
            cursor = conn.execute(
                "SELECT COUNT(*) FROM permits WHERE city = ?",
                (city,)
            )
            count = cursor.fetchone()[0]
            if count > 0:
                logger.info(f"Found {count} permits for {city} - needs enrichment")

    logger.info("To implement Parker CAD enrichment:")
    logger.info("1. Visit https://www.parkercad.org/")
    logger.info("2. Find their property search/GIS tool")
    logger.info("3. Discover the API endpoints using browser dev tools")
    logger.info("4. Update this script with correct endpoints and field names")


if __name__ == "__main__":
    enrich_parker_permits()
