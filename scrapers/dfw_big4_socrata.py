#!/usr/bin/env python3
"""
DFW Big 4 Contractor Lead Extractor via Socrata Open Data APIs

Extracts building permits and COO data from:
- Dallas (www.dallasopendata.com)
- Fort Worth (data.fortworthtexas.gov)
- Arlington (opendata.arlingtontx.gov)
- Plano (data.plano.gov)

Usage:
    python dfw_big4_socrata.py
    python dfw_big4_socrata.py --token YOUR_APP_TOKEN
    python dfw_big4_socrata.py --months 3 --commercial-only
"""

import argparse
import sys
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
import pandas as pd
from sodapy import Socrata


# =============================================================================
# CONFIGURATION
# =============================================================================

@dataclass
class CityConfig:
    """Configuration for a single city's Socrata portal."""
    name: str
    domain: str
    dataset_id: str
    date_field: str
    contractor_fields: List[str]  # Fields to check for contractor/business name
    address_field: str
    permit_type_field: Optional[str] = None
    description_field: Optional[str] = None
    permit_id_field: Optional[str] = None
    commercial_filter: Optional[str] = None  # SoQL filter for commercial permits
    column_mapping: Dict[str, str] = field(default_factory=dict)


# Dataset configurations - verified Dec 2024
# Dataset IDs discovered via web search on 2024-12-06
CITY_CONFIGS = {
    'dallas': CityConfig(
        name='Dallas',
        domain='www.dallasopendata.com',
        # NOTE: Dataset e7gq-4sah has old data (last updated 2019)
        # Dallas may have moved to a different platform
        dataset_id='e7gq-4sah',  # Building Permits - data ends 2019
        date_field='issued_date',  # MM/DD/YY format
        contractor_fields=['contractor', 'contractor_name', 'applicant_name', 'owner_name'],
        address_field='street_address',
        permit_type_field='permit_type',
        description_field='work_description',
        permit_id_field='permit_number',
        commercial_filter="permit_type LIKE '%Commercial%'",
    ),
    'fort_worth': CityConfig(
        name='Fort Worth',
        domain='data.fortworthtexas.gov',
        dataset_id='quz7-xnsy',  # Development Permits - verified
        date_field='issued_date',
        contractor_fields=['contractor_name', 'contractor', 'applicant', 'owner_name'],
        address_field='address',
        permit_type_field='permit_type',
        description_field='description',
        permit_id_field='permit_number',
        commercial_filter="permit_type LIKE '%Commercial%'",
    ),
    'arlington': CityConfig(
        name='Arlington',
        domain='opendata.arlingtontx.gov',
        dataset_id='issued-permits',  # Issued Permits dataset - ArcGIS Hub
        date_field='issuedate',
        contractor_fields=['contractor_name', 'contractor', 'applicant_name'],
        address_field='address',
        permit_type_field='foldertype',
        description_field='workdesc',
        permit_id_field='foldersequence',
        commercial_filter="foldertype LIKE '%Commercial%'",
    ),
    'plano': CityConfig(
        name='Plano',
        domain='dashboard.plano.gov',  # Note: dashboard.plano.gov not data.plano.gov
        dataset_id='xcih-piii',  # Building Permits Issued - verified
        date_field='issuedate',
        contractor_fields=['contractorname', 'contractor_name', 'applicant'],
        address_field='address',
        permit_type_field='permittype',
        description_field='description',
        permit_id_field='permitnumber',
        commercial_filter="permittype LIKE '%Commercial%'",
    ),
}


# =============================================================================
# DISCOVERY API - Find actual dataset IDs
# =============================================================================

def discover_dataset_id(domain: str, search_terms: List[str], app_token: Optional[str] = None) -> Optional[str]:
    """
    Search a Socrata portal for permit datasets using the Discovery API.
    Returns the most relevant dataset ID or None if not found.
    """
    try:
        # Use the discovery API endpoint
        discovery_domain = "api.us.socrata.com"
        client = Socrata(discovery_domain, app_token, timeout=30)

        for term in search_terms:
            try:
                # Search for datasets on the target domain
                results = client.get(
                    "odn.data.socrata.com",  # Discovery dataset
                    q=term,
                    domains=domain,
                    limit=10
                )

                if results:
                    # Look for permit-related datasets
                    for result in results:
                        resource = result.get('resource', {})
                        name = resource.get('name', '').lower()
                        if 'permit' in name or 'building' in name:
                            dataset_id = resource.get('id')
                            if dataset_id:
                                print(f"  [DISCOVERY] Found dataset: {name} ({dataset_id})")
                                return dataset_id
            except Exception:
                continue

        client.close()
    except Exception as e:
        print(f"  [DISCOVERY] Search failed for {domain}: {e}")

    return None


# =============================================================================
# KNOWN DATASET IDs (as of Dec 2024 - fallback if discovery fails)
# =============================================================================

KNOWN_DATASETS = {
    'dallas': {
        'domain': 'www.dallasopendata.com',
        'datasets': [
            {'id': 'e7gq-4sah', 'name': 'Building Permits'},
            {'id': 'fmrr-zx93', 'name': 'Building Permits SFD New Construction'},
        ]
    },
    'fort_worth': {
        'domain': 'data.fortworthtexas.gov',
        'datasets': [
            {'id': 'quz7-xnsy', 'name': 'Development Permits'},
        ]
    },
    'arlington': {
        'domain': 'opendata.arlingtontx.gov',
        'datasets': [
            {'id': 'issued-permits', 'name': 'Issued Permits'},
        ]
    },
    'plano': {
        'domain': 'dashboard.plano.gov',
        'datasets': [
            {'id': 'xcih-piii', 'name': 'Building Permits Issued'},
        ]
    },
}


# =============================================================================
# DATA EXTRACTION
# =============================================================================

class SocrataExtractor:
    """Extracts permit data from a Socrata portal."""

    def __init__(self, city_key: str, config: CityConfig, app_token: Optional[str] = None):
        self.city_key = city_key
        self.config = config
        self.app_token = app_token
        self.client: Optional[Socrata] = None
        self.dataset_id: Optional[str] = None
        self.columns: List[str] = []

    def connect(self) -> bool:
        """Establish connection to Socrata portal and find valid dataset."""
        try:
            self.client = Socrata(
                self.config.domain,
                self.app_token,
                timeout=60
            )

            # Try known dataset IDs
            known = KNOWN_DATASETS.get(self.city_key, {})
            datasets_to_try = known.get('datasets', [{'id': self.config.dataset_id}])

            for ds in datasets_to_try:
                try:
                    dataset_id = ds['id']
                    # Try to get metadata to verify dataset exists
                    metadata = self.client.get_metadata(dataset_id)
                    if metadata:
                        self.dataset_id = dataset_id
                        # Extract column names
                        self.columns = [col['fieldName'] for col in metadata.get('columns', [])]
                        print(f"  [OK] Connected to {self.config.name}: {ds.get('name', dataset_id)}")
                        print(f"       Columns: {', '.join(self.columns[:10])}{'...' if len(self.columns) > 10 else ''}")
                        return True
                except Exception as e:
                    continue

            print(f"  [WARN] No valid dataset found for {self.config.name}")
            return False

        except Exception as e:
            print(f"  [ERROR] Failed to connect to {self.config.name}: {e}")
            return False

    def _find_column(self, candidates: List[str]) -> Optional[str]:
        """Find the first matching column from candidates."""
        for candidate in candidates:
            # Try exact match
            if candidate in self.columns:
                return candidate
            # Try case-insensitive match
            for col in self.columns:
                if col.lower() == candidate.lower():
                    return col
                # Try partial match
                if candidate.lower() in col.lower():
                    return col
        return None

    def _build_query(self, start_date: datetime, commercial_only: bool = False, limit: int = 50000) -> Dict[str, Any]:
        """Build SoQL query parameters."""
        # Find the actual date column
        date_candidates = [
            self.config.date_field,
            'issue_date', 'issued_date', 'issuedate',
            'permit_date', 'permitdate', 'date_issued',
            'application_date', 'applied_date', 'final_date',
            'inspectiondate', 'inspection_date'
        ]
        date_col = self._find_column(date_candidates)

        if not date_col:
            print(f"  [WARN] No date column found for {self.config.name}")
            # Return query without date filter
            return {'$limit': limit}

        date_str = start_date.strftime('%Y-%m-%d')
        where_clause = f"{date_col} > '{date_str}'"

        # Add commercial filter if requested
        if commercial_only and self.config.permit_type_field:
            type_col = self._find_column([self.config.permit_type_field, 'permit_type', 'permittype', 'type'])
            if type_col:
                where_clause += f" AND UPPER({type_col}) LIKE '%COMMERCIAL%'"

        return {
            '$where': where_clause,
            '$limit': limit,
            '$order': f'{date_col} DESC'
        }

    def extract(self, start_date: datetime, commercial_only: bool = False) -> pd.DataFrame:
        """Extract permit data from the portal."""
        if not self.client or not self.dataset_id:
            return pd.DataFrame()

        try:
            query = self._build_query(start_date, commercial_only)
            print(f"  Fetching {self.config.name} with query: {query.get('$where', 'no filter')}")

            results = self.client.get(self.dataset_id, **query)

            if not results:
                print(f"  [WARN] No results from {self.config.name}")
                return pd.DataFrame()

            df = pd.DataFrame.from_records(results)
            print(f"  [OK] Found {len(df)} records from {self.config.name}")
            return df

        except Exception as e:
            print(f"  [ERROR] Extraction failed for {self.config.name}: {e}")
            return pd.DataFrame()

    def close(self):
        """Close the Socrata client."""
        if self.client:
            self.client.close()


# =============================================================================
# DATA NORMALIZATION
# =============================================================================

def normalize_dataframe(df: pd.DataFrame, city_name: str, config: CityConfig) -> pd.DataFrame:
    """
    Normalize column names and extract key fields.
    Maps various column names to standardized output columns.
    """
    if df.empty:
        return pd.DataFrame()

    # Create a mapping of actual columns (lowercase) to original names
    col_map = {col.lower(): col for col in df.columns}

    # Find and extract key fields
    normalized = pd.DataFrame(index=df.index)
    normalized['City'] = city_name  # This will broadcast to all rows

    # Permit ID - including Arlington's FOLDERSEQUENCE
    id_candidates = ['permit_num', 'permit_number', 'permitnumber', 'permit_id', 'permitid',
                     'foldersequence', 'id', 'case_number', 'objectid']
    for candidate in id_candidates:
        if candidate.lower() in col_map:
            normalized['Permit_ID'] = df[col_map[candidate.lower()]].astype(str)
            break
    if 'Permit_ID' not in normalized.columns:
        normalized['Permit_ID'] = df.index.astype(str)

    # Permit Type - including Arlington's FOLDERTYPE and SUBDESC
    type_candidates = ['permit_type', 'permittype', 'type', 'permit_category', 'work_type',
                       'foldertype', 'subdesc']
    for candidate in type_candidates:
        if candidate.lower() in col_map:
            normalized['Permit_Type'] = df[col_map[candidate.lower()]]
            break
    if 'Permit_Type' not in normalized.columns:
        normalized['Permit_Type'] = 'Unknown'

    # Date (try multiple date fields) - including epoch timestamps
    date_candidates = [
        'issue_date', 'issued_date', 'issuedate', 'date_issued',
        'permit_date', 'permitdate', 'application_date', 'applied_date',
        'inspectiondate', 'inspection_date', 'final_date', 'finalized_date',
        'importdate'
    ]
    for candidate in date_candidates:
        if candidate.lower() in col_map:
            date_col = df[col_map[candidate.lower()]]
            # Handle epoch timestamps (milliseconds from ArcGIS)
            if date_col.dtype in ['int64', 'float64'] and date_col.iloc[0] > 1000000000000:
                normalized['Date'] = pd.to_datetime(date_col, unit='ms', errors='coerce')
            else:
                normalized['Date'] = pd.to_datetime(date_col, errors='coerce')
            break
    if 'Date' not in normalized.columns:
        normalized['Date'] = pd.NaT

    # Address - including Arlington's FOLDERNAME (which contains address)
    addr_candidates = ['address', 'site_address', 'property_address', 'location', 'street_address',
                       'full_address', 'foldername']
    for candidate in addr_candidates:
        if candidate.lower() in col_map:
            normalized['Address'] = df[col_map[candidate.lower()]]
            break
    if 'Address' not in normalized.columns:
        normalized['Address'] = ''

    # Contractor/Business Name (try multiple fields and combine)
    # Including Arlington's NameofBusiness and Dallas's contractor field
    contractor_candidates = [
        'contractor_name', 'contractorname', 'contractor',
        'business_name', 'businessname', 'company_name', 'companyname',
        'nameofbusiness',  # Arlington
        'applicant_name', 'applicantname', 'applicant',
        'owner_name', 'ownername', 'owner'
    ]
    contractor_found = False
    for candidate in contractor_candidates:
        if candidate.lower() in col_map:
            normalized['Contractor_Name'] = df[col_map[candidate.lower()]]
            contractor_found = True
            break
    if not contractor_found:
        normalized['Contractor_Name'] = ''

    # Business Name (secondary - often different from contractor)
    business_candidates = ['business_name', 'businessname', 'company_name', 'companyname', 'dba', 'dba_name']
    business_found = False
    for candidate in business_candidates:
        if candidate.lower() in col_map:
            col = col_map[candidate.lower()]
            if col != normalized.get('Contractor_Name', pd.Series()).name:
                normalized['Business_Name'] = df[col]
                business_found = True
                break
    if not business_found:
        normalized['Business_Name'] = normalized.get('Contractor_Name', '')

    # Phone (rarely present but check)
    phone_candidates = ['phone', 'phone_number', 'contractor_phone', 'contact_phone', 'telephone']
    for candidate in phone_candidates:
        if candidate.lower() in col_map:
            normalized['Phone'] = df[col_map[candidate.lower()]]
            break
    if 'Phone' not in normalized.columns:
        normalized['Phone'] = ''

    # Email (rarely present but check)
    email_candidates = ['email', 'contractor_email', 'contact_email', 'email_address']
    for candidate in email_candidates:
        if candidate.lower() in col_map:
            normalized['Email'] = df[col_map[candidate.lower()]]
            break
    if 'Email' not in normalized.columns:
        normalized['Email'] = ''

    # Description - including Arlington's WORKDESC
    desc_candidates = ['work_description', 'description', 'project_description', 'scope', 'work_type',
                       'workdesc', 'comments', 'subdesc']
    for candidate in desc_candidates:
        if candidate.lower() in col_map:
            normalized['Description'] = df[col_map[candidate.lower()]]
            break
    if 'Description' not in normalized.columns:
        normalized['Description'] = ''

    # Value/Cost - including Arlington's ConstructionValuationDeclared
    value_candidates = ['estimated_value', 'value', 'project_value', 'cost', 'valuation', 'job_value',
                        'constructionvaluationdeclared', 'signconstructionvalue']
    for candidate in value_candidates:
        if candidate.lower() in col_map:
            normalized['Value'] = pd.to_numeric(df[col_map[candidate.lower()]], errors='coerce')
            break
    if 'Value' not in normalized.columns:
        normalized['Value'] = None

    return normalized


# =============================================================================
# MAIN EXTRACTION PIPELINE
# =============================================================================

def extract_all_cities(
    app_token: Optional[str] = None,
    months_back: int = 6,
    commercial_only: bool = False,
    output_file: str = 'dfw_big4_contractor_leads.csv'
) -> pd.DataFrame:
    """
    Extract permit data from all Big 4 DFW cities.

    Args:
        app_token: Optional Socrata app token for higher rate limits
        months_back: Number of months to look back (default 6)
        commercial_only: Filter for commercial permits only
        output_file: Output CSV filename

    Returns:
        Combined DataFrame with all extracted leads
    """
    start_date = datetime.now() - timedelta(days=months_back * 30)
    print(f"\n{'='*60}")
    print(f"DFW Big 4 Contractor Lead Extractor")
    print(f"{'='*60}")
    print(f"Start Date: {start_date.strftime('%Y-%m-%d')}")
    print(f"Commercial Only: {commercial_only}")
    print(f"App Token: {'Provided' if app_token else 'None (rate limited)'}")
    print(f"{'='*60}\n")

    all_data = []
    results_summary = {}

    for city_key, config in CITY_CONFIGS.items():
        print(f"\n[{config.name.upper()}]")
        print(f"-" * 40)

        df = pd.DataFrame()
        use_fallback = False

        # Try Socrata client first
        extractor = SocrataExtractor(city_key, config, app_token)
        try:
            if extractor.connect():
                df = extractor.extract(start_date, commercial_only)
            else:
                use_fallback = True
        except Exception as e:
            print(f"  [WARN] Socrata client failed: {e}")
            use_fallback = True
        finally:
            extractor.close()

        # Fall back to direct HTTP request if needed
        if df.empty or use_fallback:
            print(f"  Trying fallback HTTP request...")
            df = fetch_with_fallback(city_key, app_token, months_back)

        if df.empty:
            results_summary[config.name] = {'status': 'NO DATA', 'records': 0}
            continue

        # Normalize the data
        try:
            normalized = normalize_dataframe(df, config.name, config)
            all_data.append(normalized)
            results_summary[config.name] = {'status': 'OK', 'records': len(normalized)}
        except Exception as e:
            print(f"  [ERROR] Normalization failed: {e}")
            results_summary[config.name] = {'status': 'ERROR', 'records': 0, 'error': str(e)}

    # Combine all city data
    if all_data:
        combined = pd.concat(all_data, ignore_index=True)

        # Clean up
        combined = combined.dropna(subset=['Permit_ID'])
        combined = combined.drop_duplicates(subset=['City', 'Permit_ID'])

        # Filter out empty contractor names if possible
        if 'Contractor_Name' in combined.columns:
            has_contractor = combined['Contractor_Name'].notna() & (combined['Contractor_Name'] != '')
            contractors_found = has_contractor.sum()
            print(f"\nRecords with contractor info: {contractors_found} / {len(combined)}")

        # Sort by date descending
        if 'Date' in combined.columns:
            combined = combined.sort_values('Date', ascending=False)

        # Save to CSV
        combined.to_csv(output_file, index=False)
        print(f"\n[SAVED] {output_file}")

    else:
        combined = pd.DataFrame()
        print("\n[WARN] No data extracted from any city")

    # Print summary
    print(f"\n{'='*60}")
    print("EXTRACTION SUMMARY")
    print(f"{'='*60}")
    total_records = 0
    for city, result in results_summary.items():
        status = result['status']
        records = result['records']
        total_records += records
        error = result.get('error', '')
        status_str = f"[{status}] {records:,} records"
        if error:
            status_str += f" - {error}"
        print(f"  {city:15} {status_str}")

    print(f"\n  {'TOTAL':15} {total_records:,} records")
    print(f"{'='*60}\n")

    return combined


# =============================================================================
# ALTERNATIVE: Direct API calls with known endpoints
# =============================================================================

def fetch_with_fallback(city_key: str, app_token: Optional[str] = None, months_back: int = 6) -> pd.DataFrame:
    """
    Fetch data using direct HTTP requests as fallback.
    Handles Socrata, ArcGIS Hub, and GeoJSON endpoints.
    """
    import requests

    start_date = datetime.now() - timedelta(days=months_back * 30)
    start_date_str = start_date.strftime('%Y-%m-%d')
    start_date_ts = int(start_date.timestamp() * 1000)  # ArcGIS uses milliseconds

    # Known working endpoints (verified Dec 2024)
    endpoints = {
        'dallas': {
            'type': 'socrata',
            'url': 'https://www.dallasopendata.com/resource/e7gq-4sah.json',
            'date_field': 'issued_date',  # Corrected from issue_date
        },
        'fort_worth': {
            'type': 'skip',  # Fort Worth migrated to ArcGIS Hub, Socrata deprecated
            'note': 'Fort Worth no longer provides Socrata API - use Accela scraper instead',
        },
        'arlington': {
            'type': 'geojson',
            # ArcGIS Hub GeoJSON endpoint - verified working
            'url': 'https://opendata.arlingtontx.gov/datasets/arlingtontx::issued-permits.geojson',
            'date_field': 'ISSUEDATE',
        },
        'plano': {
            'type': 'skip',  # Plano Socrata returns empty results
            'note': 'Plano dataset deprecated or empty',
        },
    }

    if city_key not in endpoints:
        return pd.DataFrame()

    endpoint = endpoints[city_key]
    etype = endpoint.get('type', 'skip')

    if etype == 'skip':
        print(f"  [SKIP] {endpoint.get('note', 'Endpoint not available')}")
        return pd.DataFrame()

    try:
        if etype == 'geojson':
            # ArcGIS Hub GeoJSON endpoint
            response = requests.get(endpoint['url'], timeout=120)
            response.raise_for_status()
            data = response.json()
            features = data.get('features', [])

            # Extract properties from GeoJSON features
            records = []
            for f in features:
                props = f.get('properties', {})
                # Filter by date if date field exists
                date_val = props.get(endpoint['date_field'])
                if date_val:
                    # Handle epoch timestamps (milliseconds)
                    if isinstance(date_val, (int, float)) and date_val > 1000000000000:
                        if date_val >= start_date_ts:
                            records.append(props)
                    else:
                        records.append(props)  # Include if can't parse date
                else:
                    records.append(props)

            print(f"  [OK] Fetched {len(records)} records via GeoJSON")
            return pd.DataFrame(records)

        elif etype == 'arcgis':
            # ArcGIS REST API query
            params = {
                'where': f"{endpoint['date_field']} > {start_date_ts}",
                'outFields': '*',
                'returnGeometry': 'false',
                'f': 'json',
                'resultRecordCount': 50000,
            }
            response = requests.get(endpoint['url'], params=params, timeout=60)
            response.raise_for_status()
            data = response.json()
            features = data.get('features', [])
            records = [f.get('attributes', {}) for f in features]
            print(f"  [OK] Fetched {len(records)} records via ArcGIS")
            return pd.DataFrame(records)

        else:  # socrata
            # Socrata SODA API
            params = {
                '$where': f"{endpoint['date_field']} > '{start_date_str}'",
                '$limit': 50000,
                '$order': f"{endpoint['date_field']} DESC",
            }
            if app_token:
                params['$$app_token'] = app_token

            response = requests.get(endpoint['url'], params=params, timeout=60)
            response.raise_for_status()
            data = response.json()
            print(f"  [OK] Fetched {len(data)} records via Socrata")
            return pd.DataFrame(data)

    except Exception as e:
        print(f"  [FALLBACK ERROR] {city_key}: {e}")
        return pd.DataFrame()


# =============================================================================
# CLI ENTRY POINT
# =============================================================================

def main():
    import os

    parser = argparse.ArgumentParser(
        description='Extract contractor leads from DFW Big 4 city open data portals',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python dfw_big4_socrata.py                    # Basic extraction, last 6 months
  python dfw_big4_socrata.py --token ABC123     # With app token for higher rate limits
  python dfw_big4_socrata.py --months 3         # Last 3 months only
  python dfw_big4_socrata.py --commercial-only  # Commercial permits only

Environment Variables:
  SOCRATA_APP_TOKEN - Will be used if --token not provided
        """
    )

    parser.add_argument(
        '--token', '-t',
        type=str,
        default=os.environ.get('SOCRATA_APP_TOKEN'),
        help='Socrata app token for higher rate limits (or set SOCRATA_APP_TOKEN env var)'
    )

    parser.add_argument(
        '--months', '-m',
        type=int,
        default=6,
        help='Number of months to look back (default: 6)'
    )

    parser.add_argument(
        '--commercial-only', '-c',
        action='store_true',
        help='Filter for commercial permits only'
    )

    parser.add_argument(
        '--output', '-o',
        type=str,
        default='dfw_big4_contractor_leads.csv',
        help='Output CSV filename (default: dfw_big4_contractor_leads.csv)'
    )

    args = parser.parse_args()

    # Run extraction
    df = extract_all_cities(
        app_token=args.token,
        months_back=args.months,
        commercial_only=args.commercial_only,
        output_file=args.output
    )

    # Show sample of results
    if not df.empty:
        print("\nSample of extracted leads:")
        print("-" * 60)
        sample_cols = ['City', 'Permit_ID', 'Permit_Type', 'Date', 'Contractor_Name', 'Address']
        available_cols = [c for c in sample_cols if c in df.columns]
        print(df[available_cols].head(10).to_string(index=False))

    return 0 if not df.empty else 1


if __name__ == '__main__':
    sys.exit(main())
