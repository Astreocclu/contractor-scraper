"""
Django management command to enrich PERMITS with multi-county CAD data.

=============================================================================
DATA FLOW (DO NOT CHANGE WITHOUT UNDERSTANDING THIS):
=============================================================================

    PERMIT (scraped from city portals)
        ↓
    enrich_cad (THIS COMMAND) - looks up CAD data by address
        ↓
    PROPERTY (cache of CAD data: owner, market value, year built, etc.)
        ↓
    scoring_v2.py - scores permits using Property data
        ↓
    SCOREDLEAD (the sellable product)

IMPORTANT:
- This command works on PERMITS, not Leads or Properties directly
- Property is just a cache keyed by address - created/updated by this command
- The Lead model is LEGACY - use ScoredLead for scored/sellable leads
- If you break this flow, permits won't get enriched and scoring will fail

=============================================================================

Supports: Tarrant, Denton, Dallas, Collin counties

Usage:
    python manage.py enrich_cad --limit 10  # Test run
    python manage.py enrich_cad              # Full run
    python manage.py enrich_cad --retry-failed  # Retry previously failed
"""

import re
import time
import requests
from django.core.management.base import BaseCommand
from django.utils import timezone

from clients.models import Permit, Property


# =============================================================================
# COUNTY CONFIGURATIONS
# =============================================================================

COUNTY_CONFIGS = {
    'tarrant': {
        'name': 'Tarrant',
        'url': 'https://tad.newedgeservices.com/arcgis/rest/services/TAD/ParcelView/MapServer/1/query',
        'address_field': 'Situs_Addr',
        'fields': [
            "Situs_Addr", "Owner_Name", "Owner_Addr", "Owner_City", "Owner_Zip",
            "Total_Valu", "Land_Value", "Improvemen", "Year_Built", "Living_Are",
            "Land_Acres", "Account_Nu"
        ],
        'field_map': {
            'owner_name': 'Owner_Name',
            'situs_addr': 'Situs_Addr',
            'owner_addr': 'Owner_Addr',
            'owner_city': 'Owner_City',
            'owner_zip': 'Owner_Zip',
            'market_value': 'Total_Valu',
            'land_value': 'Land_Value',
            'improvement_value': 'Improvemen',
            'year_built': 'Year_Built',
            'square_feet': 'Living_Are',
            'lot_size': 'Land_Acres',
            'account_num': 'Account_Nu',
        }
    },
    'denton': {
        'name': 'Denton',
        'url': 'https://gis.dentoncounty.gov/arcgis/rest/services/CAD/MapServer/0/query',
        'address_field': 'situs_num',  # Need to combine situs_num + situs_street
        'fields': [
            "owner_name", "situs_num", "situs_street", "situs_street_sufix",
            "situs_city", "situs_zip", "addr_line1", "addr_city", "addr_zip",
            "cert_mkt_val", "main_imprv_val", "yr_blt", "living_area",
            "legal_acreage", "prop_id"
        ],
        'field_map': {
            'owner_name': 'owner_name',
            'situs_num': 'situs_num',
            'situs_street': 'situs_street',
            'situs_suffix': 'situs_street_sufix',
            'situs_city': 'situs_city',
            'situs_zip': 'situs_zip',
            'owner_addr': 'addr_line1',
            'owner_city': 'addr_city',
            'owner_zip': 'addr_zip',
            'market_value': 'cert_mkt_val',
            'improvement_value': 'main_imprv_val',
            'year_built': 'yr_blt',
            'square_feet': 'living_area',
            'lot_size': 'legal_acreage',
            'account_num': 'prop_id',
        }
    },
    'dallas': {
        'name': 'Dallas',
        'url': 'https://maps.dcad.org/prdwa/rest/services/Property/ParcelQuery/MapServer/4/query',
        'address_field': 'SITEADDRESS',
        'fields': [
            "OWNERNME1", "SITEADDRESS", "PSTLADDRESS", "PSTLCITY", "PSTLSTATE",
            "PSTLZIP5", "CNTASSDVAL", "LNDVALUE", "IMPVALUE", "RESYRBLT",
            "BLDGAREA", "PARCELID"
        ],
        'field_map': {
            'owner_name': 'OWNERNME1',
            'situs_addr': 'SITEADDRESS',
            'owner_addr': 'PSTLADDRESS',
            'owner_city': 'PSTLCITY',
            'owner_zip': 'PSTLZIP5',
            'market_value': 'CNTASSDVAL',
            'land_value': 'LNDVALUE',
            'improvement_value': 'IMPVALUE',
            'year_built': 'RESYRBLT',
            'square_feet': 'BLDGAREA',
            'account_num': 'PARCELID',
        }
    },
    'collin': {
        'name': 'Collin',
        'url': 'https://gismaps.cityofallen.org/arcgis/rest/services/ReferenceData/Collin_County_Appraisal_District_Parcels/MapServer/1/query',
        'address_field': 'GIS_DBO_AD_Entity_situs_num',  # Need to combine situs_num + situs_street
        'fields': [
            "GIS_DBO_AD_Entity_file_as_name", "GIS_DBO_AD_Entity_situs_num",
            "GIS_DBO_AD_Entity_situs_street", "GIS_DBO_AD_Entity_situs_display",
            "GIS_DBO_AD_Entity_addr_line1", "GIS_DBO_AD_Entity_addr_city",
            "GIS_DBO_AD_Entity_addr_state", "GIS_DBO_AD_Entity_addr_zip",
            "GIS_DBO_AD_Entity_cert_market", "GIS_DBO_AD_Entity_cert_land_hst",
            "GIS_DBO_AD_Entity_cert_imprv_hs", "GIS_DBO_AD_Entity_yr_blt",
            "GIS_DBO_AD_Entity_living_area", "GIS_DBO_AD_Entity_legal_acreage",
            "GIS_DBO_Parcel_PROP_ID"
        ],
        'field_map': {
            'owner_name': 'GIS_DBO_AD_Entity_file_as_name',
            'situs_num': 'GIS_DBO_AD_Entity_situs_num',
            'situs_street': 'GIS_DBO_AD_Entity_situs_street',
            'situs_addr': 'GIS_DBO_AD_Entity_situs_display',
            'owner_addr': 'GIS_DBO_AD_Entity_addr_line1',
            'owner_city': 'GIS_DBO_AD_Entity_addr_city',
            'owner_zip': 'GIS_DBO_AD_Entity_addr_zip',
            'market_value': 'GIS_DBO_AD_Entity_cert_market',
            'land_value': 'GIS_DBO_AD_Entity_cert_land_hst',
            'improvement_value': 'GIS_DBO_AD_Entity_cert_imprv_hs',
            'year_built': 'GIS_DBO_AD_Entity_yr_blt',
            'square_feet': 'GIS_DBO_AD_Entity_living_area',
            'lot_size': 'GIS_DBO_AD_Entity_legal_acreage',
            'account_num': 'GIS_DBO_Parcel_PROP_ID',
        }
    },
}

# Zip code to county mapping (DFW area)
ZIP_TO_COUNTY = {
    # Tarrant County
    '76101': 'tarrant', '76102': 'tarrant', '76103': 'tarrant', '76104': 'tarrant',
    '76105': 'tarrant', '76106': 'tarrant', '76107': 'tarrant', '76108': 'tarrant',
    '76109': 'tarrant', '76110': 'tarrant', '76111': 'tarrant', '76112': 'tarrant',
    '76113': 'tarrant', '76114': 'tarrant', '76115': 'tarrant', '76116': 'tarrant',
    '76117': 'tarrant', '76118': 'tarrant', '76119': 'tarrant', '76120': 'tarrant',
    '76121': 'tarrant', '76122': 'tarrant', '76123': 'tarrant', '76124': 'tarrant',
    '76126': 'tarrant', '76127': 'tarrant', '76129': 'tarrant', '76130': 'tarrant',
    '76131': 'tarrant', '76132': 'tarrant', '76133': 'tarrant', '76134': 'tarrant',
    '76135': 'tarrant', '76136': 'tarrant', '76137': 'tarrant', '76140': 'tarrant',
    '76148': 'tarrant', '76155': 'tarrant', '76161': 'tarrant', '76162': 'tarrant',
    '76163': 'tarrant', '76164': 'tarrant', '76166': 'tarrant', '76177': 'tarrant',
    '76179': 'tarrant', '76180': 'tarrant', '76181': 'tarrant', '76182': 'tarrant',
    '76185': 'tarrant', '76191': 'tarrant', '76192': 'tarrant', '76193': 'tarrant',
    '76195': 'tarrant', '76196': 'tarrant', '76197': 'tarrant', '76198': 'tarrant',
    '76199': 'tarrant', '76244': 'tarrant', '76248': 'tarrant',
    # North Richland Hills, Hurst, Bedford, Euless, Grapevine, Colleyville, Southlake
    '76021': 'tarrant', '76022': 'tarrant', '76034': 'tarrant', '76039': 'tarrant',
    '76040': 'tarrant', '76051': 'tarrant', '76053': 'tarrant', '76054': 'tarrant',
    '76092': 'tarrant', '76094': 'tarrant', '76095': 'tarrant', '76099': 'tarrant',
    # Arlington, Mansfield
    '76001': 'tarrant', '76002': 'tarrant', '76003': 'tarrant', '76004': 'tarrant',
    '76005': 'tarrant', '76006': 'tarrant', '76010': 'tarrant', '76011': 'tarrant',
    '76012': 'tarrant', '76013': 'tarrant', '76014': 'tarrant', '76015': 'tarrant',
    '76016': 'tarrant', '76017': 'tarrant', '76018': 'tarrant', '76019': 'tarrant',
    '76060': 'tarrant', '76063': 'tarrant',

    # Denton County
    '76201': 'denton', '76202': 'denton', '76203': 'denton', '76204': 'denton',
    '76205': 'denton', '76206': 'denton', '76207': 'denton', '76208': 'denton',
    '76209': 'denton', '76210': 'denton', '76226': 'denton', '76227': 'denton',
    '76234': 'denton', '76247': 'denton', '76249': 'denton', '76258': 'denton',
    '76259': 'denton', '76262': 'denton', '76266': 'denton', '76272': 'denton',
    # Lewisville, Flower Mound, Highland Village, The Colony, Little Elm
    '75006': 'denton', '75007': 'denton', '75010': 'denton', '75019': 'denton',
    '75022': 'denton', '75027': 'denton', '75028': 'denton', '75029': 'denton',
    '75034': 'denton', '75056': 'denton', '75057': 'denton', '75065': 'denton',
    '75067': 'denton', '75068': 'denton', '75077': 'denton',
    # Frisco (split between Denton/Collin), Aubrey, Pilot Point, Sanger
    '75033': 'denton', '75034': 'denton', '75035': 'denton', '75036': 'denton',
    '76023': 'denton', '76052': 'denton', '76078': 'denton',

    # Dallas County
    '75201': 'dallas', '75202': 'dallas', '75203': 'dallas', '75204': 'dallas',
    '75205': 'dallas', '75206': 'dallas', '75207': 'dallas', '75208': 'dallas',
    '75209': 'dallas', '75210': 'dallas', '75211': 'dallas', '75212': 'dallas',
    '75214': 'dallas', '75215': 'dallas', '75216': 'dallas', '75217': 'dallas',
    '75218': 'dallas', '75219': 'dallas', '75220': 'dallas', '75221': 'dallas',
    '75222': 'dallas', '75223': 'dallas', '75224': 'dallas', '75225': 'dallas',
    '75226': 'dallas', '75227': 'dallas', '75228': 'dallas', '75229': 'dallas',
    '75230': 'dallas', '75231': 'dallas', '75232': 'dallas', '75233': 'dallas',
    '75234': 'dallas', '75235': 'dallas', '75236': 'dallas', '75237': 'dallas',
    '75238': 'dallas', '75239': 'dallas', '75240': 'dallas', '75241': 'dallas',
    '75242': 'dallas', '75243': 'dallas', '75244': 'dallas', '75246': 'dallas',
    '75247': 'dallas', '75248': 'dallas', '75249': 'dallas', '75250': 'dallas',
    '75251': 'dallas', '75252': 'dallas', '75253': 'dallas', '75254': 'dallas',
    # Irving, Grand Prairie, Mesquite, Garland (partial)
    '75038': 'dallas', '75039': 'dallas', '75060': 'dallas', '75061': 'dallas',
    '75062': 'dallas', '75063': 'dallas', '75050': 'dallas', '75051': 'dallas',
    '75052': 'dallas', '75053': 'dallas', '75054': 'dallas', '75149': 'dallas',
    '75150': 'dallas', '75180': 'dallas', '75181': 'dallas', '75182': 'dallas',

    # Collin County (Allen, McKinney, Plano, Frisco, etc.)
    '75002': 'collin', '75009': 'collin', '75013': 'collin', '75023': 'collin',
    '75024': 'collin', '75025': 'collin', '75026': 'collin', '75030': 'collin',
    '75034': 'collin', '75035': 'collin', '75048': 'collin', '75069': 'collin',
    '75070': 'collin', '75071': 'collin', '75072': 'collin', '75074': 'collin',
    '75075': 'collin', '75078': 'collin', '75080': 'collin', '75081': 'collin',
    '75082': 'collin', '75086': 'collin', '75087': 'collin', '75093': 'collin',
    '75094': 'collin', '75097': 'collin', '75098': 'collin', '75121': 'collin',
    '75164': 'collin', '75166': 'collin', '75173': 'collin', '75407': 'collin',
    '75409': 'collin', '75424': 'collin', '75442': 'collin', '75454': 'collin',

    # Parker County (Aledo, Weatherford) - no API, will be skipped
    '76008': 'parker', '76087': 'parker', '76085': 'parker', '76086': 'parker',
    '76088': 'parker',

    # Johnson County (Crowley, Burleson area) - no API, will be skipped
    '76028': 'johnson', '76036': 'johnson', '76058': 'johnson', '76031': 'johnson',
    '76044': 'johnson', '76050': 'johnson', '76059': 'johnson', '76093': 'johnson',
    '76097': 'johnson',
}

# City to county mapping (for when address lacks zip code)
CITY_TO_COUNTY = {
    # Collin County cities
    'frisco': 'collin',
    'allen': 'collin',
    'mckinney': 'collin',
    'plano': 'collin',
    'prosper': 'collin',
    'celina': 'collin',
    'anna': 'collin',
    'princeton': 'collin',
    'melissa': 'collin',
    'fairview': 'collin',
    'lucas': 'collin',
    'murphy': 'collin',
    'wylie': 'collin',  # split with Dallas county
    'sachse': 'collin',  # split with Dallas county

    # Denton County cities
    'denton': 'denton',
    'lewisville': 'denton',
    'flower mound': 'denton',
    'highland village': 'denton',
    'the colony': 'denton',
    'little elm': 'denton',
    'corinth': 'denton',
    'aubrey': 'denton',
    'pilot point': 'denton',
    'sanger': 'denton',
    'argyle': 'denton',
    'bartonville': 'denton',
    'trophy club': 'denton',

    # Tarrant County cities
    'fort worth': 'tarrant',
    'arlington': 'tarrant',
    'north richland hills': 'tarrant',
    'hurst': 'tarrant',
    'bedford': 'tarrant',
    'euless': 'tarrant',
    'grapevine': 'tarrant',
    'colleyville': 'tarrant',
    'southlake': 'tarrant',
    'keller': 'tarrant',
    'watauga': 'tarrant',
    'haltom city': 'tarrant',
    'richland hills': 'tarrant',
    'mansfield': 'tarrant',

    # Dallas County cities
    'dallas': 'dallas',
    'irving': 'dallas',
    'grand prairie': 'dallas',
    'mesquite': 'dallas',
    'garland': 'dallas',
    'richardson': 'dallas',
    'carrollton': 'dallas',
    'farmers branch': 'dallas',
    'coppell': 'dallas',
    'desoto': 'dallas',
    'duncanville': 'dallas',
    'cedar hill': 'dallas',
    'lancaster': 'dallas',
    'rowlett': 'dallas',
}


def get_county_from_city(city):
    """Get county from city name."""
    if not city:
        return None
    return CITY_TO_COUNTY.get(city.lower().strip())


def get_county_from_zip(address):
    """Extract zip code and determine county."""
    if not address:
        return None
    # Look for 5-digit zip at end of address (after state abbreviation)
    # Handles: "Fort Worth TX 76052" or "Fort Worth, TX 76052-1234"
    match = re.search(r'\b(TX|TEXAS)\s+(\d{5})(?:-\d{4})?(?:\s|$)', address, re.I)
    if match:
        zip_code = match.group(2)
        return ZIP_TO_COUNTY.get(zip_code)
    # Fallback: last 5-digit sequence in address
    matches = re.findall(r'(\d{5})', address)
    if matches:
        zip_code = matches[-1]  # Take the LAST 5-digit number (likely zip)
        return ZIP_TO_COUNTY.get(zip_code)
    return None


def normalize_address(address):
    """Normalize address for comparison."""
    if not address:
        return ""
    addr = address.upper()
    addr = re.sub(r'[^\w\s]', '', addr)
    addr = re.sub(r'\s+', ' ', addr)
    return addr.strip()


def extract_street_address(full_address):
    """
    Extract just the street address from a full address.
    Input: "5429 HUNTLY DR, Fort Worth TX 76109"
    Output: "5429 HUNTLY DR"
    """
    if not full_address:
        return None

    # Remove everything after comma
    if ',' in full_address:
        full_address = full_address.split(',')[0]

    # Remove city/state/zip if no comma
    # Match common DFW cities followed by TX/state/zip
    dfw_cities = (
        r'Fort Worth|Dallas|Arlington|Irving|Plano|Garland|Frisco|McKinney|'
        r'Denton|Lewisville|Allen|Carrollton|Richardson|Mesquite|Grand Prairie|'
        r'Keller|Southlake|Grapevine|Flower Mound|Euless|Bedford|Hurst|'
        r'Colleyville|Coppell|Rowlett|Wylie|Murphy|Sachse|Lucas|Prosper|'
        r'Celina|Anna|Princeton|Melissa|Fairview|Highland Village|The Colony'
    )
    full_address = re.sub(rf'\s+({dfw_cities}|TX|TEXAS|\d{{5}}).*$', '', full_address, flags=re.I)

    return full_address.strip()


def parse_address_for_query(address):
    """
    Parse address into house number and street name for CAD query.
    Returns (house_num, street_core) or (None, None) if can't parse.
    """
    street_addr = extract_street_address(address)
    if not street_addr:
        return None, None

    # Clean up
    street_addr = street_addr.upper().strip()

    # Remove unit/apt numbers
    street_addr = re.sub(r'\s+(APT|UNIT|STE|SUITE|#)\s*\S*', '', street_addr)

    # Extract house number and street
    match = re.match(r'^(\d+)\s+(.+)$', street_addr)
    if not match:
        return None, None

    house_num = match.group(1)
    street = match.group(2).strip()

    # Extract core street name (remove ST, AVE, DR, etc. for broader matching)
    street_core = re.sub(r'\s+(ST|AVE|DR|RD|LN|CT|BLVD|WAY|PL|CIR|PKWY|HWY|TRAIL|TRL|DRIVE|STREET|AVENUE|ROAD|LANE|COURT)\.?$', '', street, flags=re.I)
    street_core = street_core.strip()

    # If we stripped too much, use original
    if len(street_core) < 3:
        street_core = street

    return house_num, street_core


def generate_address_variants(address):
    """
    Generate progressively simpler address variants for retry.
    
    Example: "5429 HUNTLY DR, Fort Worth TX 76109"
    Yields:
      1. "5429 HUNTLY DR" (original, cleaned)
      2. "5429 HUNTLY" (strip street type)
      3. If has directional: same without N/S/E/W
    
    Example: "1234 N MAIN ST APT 5, Dallas TX 75201"
    Yields:
      1. "1234 N MAIN ST" (original, no apt)
      2. "1234 N MAIN" (strip suffix)
      3. "1234 MAIN" (strip directional)
    """
    if not address:
        return
    
    # Clean address - extract street portion
    street_addr = extract_street_address(address)
    if not street_addr:
        return
    
    street_addr = street_addr.upper().strip()
    
    # Remove unit/apt/suite numbers first
    street_addr = re.sub(r'\s+(APT|UNIT|STE|SUITE|#)\s*\S*', '', street_addr, flags=re.I)
    street_addr = street_addr.strip()
    
    # Pattern for street suffixes
    STREET_SUFFIXES = r'(DR|DRIVE|ST|STREET|AVE|AVENUE|BLVD|BOULEVARD|LN|LANE|CT|COURT|CIR|CIRCLE|RD|ROAD|PL|PLACE|WAY|PKWY|PARKWAY|HWY|HIGHWAY|TRAIL|TRL|TERR|TERRACE)\.?'
    
    # Pattern for directionals (beginning or end of street name)
    DIRECTIONALS = r'(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)'
    
    # Variant 1: Original cleaned address (with street suffix)
    yield street_addr
    
    # Variant 2: Strip street suffix
    addr_no_suffix = re.sub(rf'\s+{STREET_SUFFIXES}$', '', street_addr, flags=re.I).strip()
    if addr_no_suffix != street_addr and len(addr_no_suffix) > 3:
        yield addr_no_suffix
    
    # Variant 3: Also remove directional prefix (e.g., "1234 N MAIN" -> "1234 MAIN")
    # Check if there's a directional after the house number
    match = re.match(rf'^(\d+)\s+{DIRECTIONALS}\s+(.+)$', addr_no_suffix, flags=re.I)
    if match:
        house_num = match.group(1)
        street_name = match.group(3)  # Skip the directional
        addr_no_direction = f"{house_num} {street_name}".strip()
        if addr_no_direction != addr_no_suffix:
            yield addr_no_direction
    
    # Variant 4: Check for trailing directional (less common but happens)
    # e.g., "1234 MAIN ST N" -> "1234 MAIN"
    match = re.match(rf'^(\d+)\s+(.+?)\s+{DIRECTIONALS}$', addr_no_suffix, flags=re.I)
    if match:
        house_num = match.group(1)
        street_name = match.group(2)
        addr_no_direction = f"{house_num} {street_name}".strip()
        if addr_no_direction != addr_no_suffix:
            yield addr_no_direction


def query_tarrant_cad_single(address, house_num, street_core, timeout=30):
    """
    Query Tarrant CAD ArcGIS API for property data using specific address parts.
    Returns dict with property data or None if not found.
    """
    # Build query: Situs_Addr LIKE '5429 %HUNTLY%'
    where_clause = f"Situs_Addr LIKE '{house_num} %{street_core}%'"

    params = {
        "where": where_clause,
        "outFields": ",".join(OUT_FIELDS),
        "f": "json",
        "resultRecordCount": 10
    }

    try:
        response = requests.get(ARCGIS_URL, params=params, timeout=timeout)
        response.raise_for_status()

        data = response.json()
        features = data.get("features", [])

        if not features:
            return None

        # If multiple results, find best match by house number
        if len(features) > 1:
            for f in features:
                situs = f["attributes"].get("Situs_Addr", "")
                if situs and situs.upper().startswith(f"{house_num} "):
                    return f["attributes"]

        # Return first result
        return features[0]["attributes"]

    except requests.RequestException as e:
        raise Exception(f"API request failed: {e}")
    except (KeyError, ValueError) as e:
        raise Exception(f"Failed to parse response: {e}")


def query_tarrant_cad_with_retry(address, timeout=30):
    """
    Try progressively simpler address variants until one succeeds.
    Returns (cad_data, variant_used) or (None, None) if all fail.
    """
    tried_queries = set()  # Avoid duplicate queries
    
    for variant in generate_address_variants(address):
        house_num, street_core = parse_address_for_query(variant)
        if not house_num or not street_core:
            continue
        
        # Create a query key to avoid duplicate API calls
        query_key = f"{house_num}|{street_core}"
        if query_key in tried_queries:
            continue
        tried_queries.add(query_key)
        
        try:
            result = query_tarrant_cad_single(variant, house_num, street_core, timeout)
            if result:
                return result, variant
        except Exception:
            # Continue to next variant on error
            pass
    
    return None, None


def query_county_cad(address, county, timeout=30):
    """
    Query a county's CAD ArcGIS API for property data.
    Returns (normalized_data, county_name) or (None, None) if not found.
    """
    if county not in COUNTY_CONFIGS:
        return None, None

    config = COUNTY_CONFIGS[county]
    house_num, street_core = parse_address_for_query(address)
    if not house_num or not street_core:
        return None, None

    # Build query based on county
    if county == 'tarrant':
        where_clause = f"Situs_Addr LIKE '{house_num} %{street_core}%'"
    elif county == 'denton':
        # Denton uses separate situs_num and situs_street fields
        where_clause = f"situs_num = '{house_num}' AND situs_street LIKE '%{street_core}%'"
    elif county == 'dallas':
        where_clause = f"SITEADDRESS LIKE '{house_num} %{street_core}%'"
    elif county == 'collin':
        # Collin uses separate situs_num and situs_street fields with long prefixed names
        where_clause = f"GIS_DBO_AD_Entity_situs_num = '{house_num}' AND GIS_DBO_AD_Entity_situs_street LIKE '%{street_core}%'"
    else:
        return None, None

    params = {
        "where": where_clause,
        "outFields": ",".join(config['fields']),
        "f": "json",
        "resultRecordCount": 10
    }

    try:
        response = requests.get(config['url'], params=params, timeout=timeout)
        response.raise_for_status()

        data = response.json()
        features = data.get("features", [])

        if not features:
            return None, None

        # Get the best matching result
        raw_data = features[0]["attributes"]

        # Normalize data to common format using field_map
        fm = config['field_map']

        # Build situs address (varies by county)
        if county == 'denton':
            situs_num = raw_data.get(fm.get('situs_num', ''), '') or ''
            situs_street = raw_data.get(fm.get('situs_street', ''), '') or ''
            situs_suffix = raw_data.get(fm.get('situs_suffix', ''), '') or ''
            situs_addr = f"{situs_num} {situs_street} {situs_suffix}".strip()
        elif county == 'collin':
            # Collin has situs_display as full address, but also separate fields
            situs_addr = raw_data.get(fm.get('situs_addr', ''), '') or ''
            if not situs_addr:
                situs_num = raw_data.get(fm.get('situs_num', ''), '') or ''
                situs_street = raw_data.get(fm.get('situs_street', ''), '') or ''
                situs_addr = f"{situs_num} {situs_street}".strip()
        else:
            situs_addr = raw_data.get(fm.get('situs_addr', ''), '') or ''

        normalized = {
            'owner_name': raw_data.get(fm.get('owner_name', ''), ''),
            'situs_addr': situs_addr,
            'owner_addr': raw_data.get(fm.get('owner_addr', ''), ''),
            'owner_city': raw_data.get(fm.get('owner_city', ''), ''),
            'owner_zip': raw_data.get(fm.get('owner_zip', ''), ''),
            'market_value': raw_data.get(fm.get('market_value', '')),
            'land_value': raw_data.get(fm.get('land_value', '')),
            'improvement_value': raw_data.get(fm.get('improvement_value', '')),
            'year_built': raw_data.get(fm.get('year_built', '')),
            'square_feet': raw_data.get(fm.get('square_feet', '')),
            'lot_size': raw_data.get(fm.get('lot_size', '')),
            'account_num': raw_data.get(fm.get('account_num', '')),
        }

        return normalized, config['name']

    except requests.RequestException as e:
        raise Exception(f"API request failed for {config['name']}: {e}")
    except (KeyError, ValueError) as e:
        raise Exception(f"Failed to parse {config['name']} response: {e}")


def query_cad_with_retry(address, county, timeout=30):
    """
    Try progressively simpler address variants until one succeeds.
    Returns (normalized_data, county_name, variant_used) or (None, None, None) if all fail.
    """
    tried_queries = set()

    for variant in generate_address_variants(address):
        house_num, street_core = parse_address_for_query(variant)
        if not house_num or not street_core:
            continue

        query_key = f"{house_num}|{street_core}"
        if query_key in tried_queries:
            continue
        tried_queries.add(query_key)

        try:
            result, county_name = query_county_cad(variant, county, timeout)
            if result:
                return result, county_name, variant
        except Exception:
            pass

    return None, None, None


def query_cad_multi_county(address, timeout=30):
    """
    Try to find property in multiple counties.
    First tries the county based on zip code, then falls back to others.
    Returns (normalized_data, county_name, variant_used) or (None, None, None).
    """
    # Determine primary county from zip
    primary_county = get_county_from_zip(address)

    # Counties with working APIs
    supported_counties = ['tarrant', 'denton', 'dallas', 'collin']

    # If we know the county and it's supported, try it first
    if primary_county and primary_county in supported_counties:
        result, county_name, variant = query_cad_with_retry(address, primary_county, timeout)
        if result:
            return result, county_name, variant

    # If primary county failed or isn't supported, try others
    for county in supported_counties:
        if county == primary_county:
            continue  # Already tried
        result, county_name, variant = query_cad_with_retry(address, county, timeout)
        if result:
            return result, county_name, variant

    return None, None, None


def normalize_street_suffix(addr):
    """Normalize street suffixes for comparison."""
    if not addr:
        return ''
    addr = addr.upper()
    # Normalize common suffixes
    replacements = [
        ('STREET', 'ST'), ('DRIVE', 'DR'), ('AVENUE', 'AVE'), ('ROAD', 'RD'),
        ('LANE', 'LN'), ('COURT', 'CT'), ('CIRCLE', 'CIR'), ('BOULEVARD', 'BLVD'),
        ('PLACE', 'PL'), ('TERRACE', 'TER'), ('TRAIL', 'TRL'), ('PARKWAY', 'PKWY'),
        ('HIGHWAY', 'HWY'), ('WAY', 'WY'),
    ]
    for full, abbr in replacements:
        addr = re.sub(rf'\b{full}\b', abbr, addr)
    return addr


def extract_street_for_comparison(addr):
    """
    Extract just street address for comparison (house number + street name).
    Handles: "123 MAIN ST, FORT WORTH TX" -> "123 MAIN ST"
    Also handles directional prefixes like "836 S HAVENWOOD LN" vs "836 HAVENWOOD LN S"
    """
    if not addr:
        return ''

    # First split on comma to get just the street portion (before city)
    street = addr.upper().split(',')[0].strip()

    # Remove unit/apt designators
    street = re.sub(r'\s*(#|UNIT|APT|STE|SUITE|BLDG)\s*\w*', '', street)

    # Normalize street suffixes
    street = normalize_street_suffix(street)

    # Remove all punctuation for final comparison
    street = re.sub(r'[^\w\s]', '', street)
    street = re.sub(r'\s+', ' ', street).strip()

    # Extract components: house number and street words
    parts = street.split()
    if not parts:
        return ''

    # Get house number (first part, usually numeric)
    house_num = parts[0] if parts else ''

    # Get street name words, normalizing directional position
    # "S HAVENWOOD LN" and "HAVENWOOD LN S" should match
    street_words = parts[1:] if len(parts) > 1 else []

    # Remove directionals from their position and sort remaining words
    directionals = {'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'NORTH', 'SOUTH', 'EAST', 'WEST'}
    has_directional = any(w in directionals for w in street_words)
    core_words = [w for w in street_words if w not in directionals]

    # Return house number + sorted core street words (directional-independent)
    return f"{house_num} {' '.join(core_words)}"


def is_absentee_owner(situs_addr, mailing_addr):
    """Check if owner is absentee (mailing address differs from property)."""
    if not situs_addr or not mailing_addr:
        return False

    situs_street = extract_street_for_comparison(situs_addr)
    mailing_street = extract_street_for_comparison(mailing_addr)

    if not situs_street or not mailing_street:
        return False

    # Compare the normalized street portions
    return situs_street != mailing_street


class Command(BaseCommand):
    help = 'Enrich A/B leads with multi-county CAD property data (Tarrant, Denton, Dallas)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit',
            type=int,
            default=None,
            help='Limit number of leads to process (for testing)'
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='Re-enrich even if already enriched'
        )
        parser.add_argument(
            '--retry-failed',
            action='store_true',
            help='Retry previously failed enrichments'
        )
        parser.add_argument(
            '--delay',
            type=float,
            default=1.0,
            help='Delay between API requests in seconds (default: 1.0)'
        )

    def handle(self, *args, **options):
        limit = options['limit']
        force = options['force']
        retry_failed = options['retry_failed']
        delay = options['delay']

        self.stdout.write(self.style.HTTP_INFO('=== MULTI-COUNTY CAD ENRICHMENT ==='))
        self.stdout.write(f'Supported counties: Tarrant, Denton, Dallas, Collin\n')

        # Work on Permits - create/update Property records with CAD data
        permits = Permit.objects.all()

        if force:
            pass  # Process all
        elif retry_failed:
            # Only retry permits whose Property failed enrichment
            failed_addrs = Property.objects.filter(enrichment_status='failed').values_list('property_address', flat=True)
            permits = permits.filter(property_address__in=list(failed_addrs))
        else:
            # Only process permits that don't have successfully enriched Property
            success_addrs = Property.objects.filter(enrichment_status='success').values_list('property_address', flat=True)
            permits = permits.exclude(property_address__in=list(success_addrs))

        if limit:
            permits = permits[:limit]

        total = permits.count()
        self.stdout.write(f'Found {total} permits to enrich\n')

        if total == 0:
            self.stdout.write('No permits need enrichment. Use --force to re-enrich or --retry-failed.\n')
            return

        success_count = 0
        fail_count = 0
        skip_count = 0
        county_counts = {}

        for i, permit in enumerate(permits, 1):
            address = permit.property_address

            # Get or create Property record for this address
            prop, created = Property.objects.get_or_create(
                property_address=address,
                defaults={'enrichment_status': 'pending'}
            )

            # Skip if already enriched (unless --force)
            if not force and prop.enrichment_status == 'success':
                skip_count += 1
                continue

            # Detect county for display - try zip first, then city
            detected_county = get_county_from_zip(address)
            if not detected_county:
                detected_county = get_county_from_city(permit.city)
            county_display = detected_county.upper() if detected_county else '???'

            self.stdout.write(f'\n[{i}/{total}] [{county_display}] {address}')

            # Check if county is unsupported
            if detected_county and detected_county not in COUNTY_CONFIGS:
                self.stdout.write(self.style.WARNING(f'  -> No API for {detected_county.title()} County, skipping'))
                skip_count += 1
                continue

            # Parse address
            house_num, street_core = parse_address_for_query(address)
            if not house_num:
                self.stdout.write(self.style.WARNING(f'  -> Cannot parse address, skipping'))
                skip_count += 1
                continue

            try:
                # Query CAD with multi-county support
                cad_data, county_name, variant_used = query_cad_multi_county(address)

                if not cad_data:
                    variants = list(generate_address_variants(address))
                    self.stdout.write(self.style.WARNING(f'  -> Not found in any CAD'))
                    if len(variants) > 1:
                        self.stdout.write(f'     Tried variants: {variants}')
                    prop.enrichment_status = 'failed'
                    prop.enriched_at = timezone.now()
                    prop.save()
                    fail_count += 1
                    time.sleep(delay)
                    continue

                # Log match info
                original_clean = extract_street_address(address)
                if original_clean and variant_used and variant_used.upper() != original_clean.upper():
                    self.stdout.write(f'     (matched via variant: "{variant_used}")')

                # Parse values helper functions
                def parse_float(val):
                    if val is None:
                        return None
                    try:
                        return float(str(val).strip())
                    except (ValueError, TypeError):
                        return None

                def parse_int(val):
                    if val is None:
                        return None
                    try:
                        return int(float(str(val).strip()))
                    except (ValueError, TypeError):
                        return None

                # Extract normalized data
                owner_name = (cad_data.get('owner_name') or '').strip()
                market_value = parse_float(cad_data.get('market_value'))
                land_value = parse_float(cad_data.get('land_value'))
                improvement_value = parse_float(cad_data.get('improvement_value'))
                year_built = parse_int(cad_data.get('year_built'))
                square_feet = parse_int(cad_data.get('square_feet'))
                lot_size = parse_float(cad_data.get('lot_size'))
                situs_addr = cad_data.get('situs_addr', '')
                account_num = cad_data.get('account_num')

                # Build mailing address
                owner_addr = (cad_data.get('owner_addr') or '').strip()
                owner_city = (cad_data.get('owner_city') or '').strip()
                owner_zip = (cad_data.get('owner_zip') or '').strip()
                mailing_address = f"{owner_addr}, {owner_city} {owner_zip}".strip(", ")

                # Detect absentee owner
                # Only calculate if we have a street address to compare
                # (Denton CAD doesn't return mailing street addresses)
                if owner_addr:
                    absentee = is_absentee_owner(situs_addr, mailing_address)
                else:
                    absentee = None  # Can't determine without mailing street address

                # Update property
                prop.owner_name = owner_name
                prop.mailing_address = mailing_address if mailing_address else None
                prop.market_value = market_value
                prop.land_value = land_value
                prop.improvement_value = improvement_value
                prop.year_built = year_built
                prop.square_feet = square_feet
                prop.lot_size = lot_size
                prop.cad_account_id = account_num
                prop.county = county_name.lower()
                prop.is_absentee = absentee
                prop.enrichment_status = 'success'
                prop.enriched_at = timezone.now()
                prop.save()

                # Track county stats
                county_counts[county_name] = county_counts.get(county_name, 0) + 1

                # Format output
                value_str = f"${market_value:,.0f}" if market_value else "N/A"
                absentee_str = " [ABSENTEE]" if absentee else ""
                self.stdout.write(self.style.SUCCESS(
                    f'  -> [{county_name}] Owner: {owner_name} | Value: {value_str}{absentee_str}'
                ))

                success_count += 1

            except Exception as e:
                self.stdout.write(self.style.ERROR(f'  -> Error: {e}'))
                prop.enrichment_status = 'failed'
                prop.enriched_at = timezone.now()
                prop.save()
                fail_count += 1

            # Rate limit
            time.sleep(delay)

        # Summary
        self.stdout.write('\n' + '='*50)
        self.stdout.write(self.style.SUCCESS(f'Success: {success_count}'))
        self.stdout.write(self.style.WARNING(f'Failed: {fail_count}'))
        self.stdout.write(f'Skipped: {skip_count}')
        self.stdout.write(f'Total: {success_count + fail_count + skip_count}')

        if county_counts:
            self.stdout.write('\nBy County:')
            for county, count in sorted(county_counts.items()):
                self.stdout.write(f'  {county}: {count}')

        if success_count > 0:
            self.stdout.write(self.style.SUCCESS(
                f'\nRun "python manage.py score_leads" to update lead scores with new property data'
            ))
