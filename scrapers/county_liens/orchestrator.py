"""
Lien scraper orchestration module.

Coordinates scraping across all counties and stores results in database.
Called by collection_service.js via Python subprocess.

Usage:
    python -m scrapers.county_liens.orchestrator --name "ABC Contractors LLC" [--owner "John Smith"]
    python -m scrapers.county_liens.orchestrator --contractor-id 123
"""

import asyncio
import argparse
import json
import logging
import os
import sys
from datetime import datetime
from typing import Optional

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from scrapers.county_liens.base import LienRecord, LIEN_SEVERITY
from scrapers.county_liens.entity_resolver import EntityResolver, generate_name_variations
from scrapers.county_liens.tarrant import TarrantCountyScraper
from scrapers.county_liens.dallas import DallasCountyScraper
from scrapers.county_liens.collin import CollinCountyScraper
from scrapers.county_liens.denton import DentonCountyScraper

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# County scraper mapping
SCRAPERS = {
    'tarrant': TarrantCountyScraper,
    'dallas': DallasCountyScraper,
    'collin': CollinCountyScraper,
    'denton': DentonCountyScraper,
}


async def scrape_single_county(
    county: str,
    name: str,
    max_retries: int = 3
) -> dict:
    """
    Scrape a single county for lien records.
    
    Args:
        county: County name (tarrant, dallas, collin, denton)
        name: Business or person name to search
        max_retries: Maximum retry attempts
        
    Returns:
        Dict with status and records
    """
    if county.lower() not in SCRAPERS:
        return {
            'county': county,
            'status': 'error',
            'error': f'Unknown county: {county}',
            'records': []
        }
    
    scraper_class = SCRAPERS[county.lower()]
    scraper = scraper_class()
    
    try:
        records = await scraper.search_with_retry(name, max_retries)
        return {
            'county': county,
            'status': 'success',
            'records': records,
            'count': len(records)
        }
    except Exception as e:
        logger.error(f"Error scraping {county}: {e}")
        return {
            'county': county,
            'status': 'error',
            'error': str(e),
            'records': []
        }


async def scrape_all_counties(
    name: str,
    owner_name: Optional[str] = None,
    counties: list[str] = None
) -> dict:
    """
    Scrape all (or specified) counties for lien records.
    
    Args:
        name: Business name to search
        owner_name: Optional owner/registered agent name
        counties: Optional list of specific counties (default: all)
        
    Returns:
        Dict with results from all counties
    """
    if counties is None:
        counties = list(SCRAPERS.keys())
    
    results = {
        'search_term': name,
        'owner_name': owner_name,
        'searched_at': datetime.now().isoformat(),
        'counties': {},
        'total_records': 0,
        'summary': {
            'active_liens': 0,
            'total_amount': 0,
            'by_type': {}
        }
    }
    
    # Generate name variations to search
    variations = generate_name_variations(name)
    if owner_name:
        variations.extend(generate_name_variations(owner_name))
    
    # Remove duplicates
    variations = list(dict.fromkeys(variations))
    
    logger.info(f"Searching for: {name} (variations: {len(variations)})")
    
    all_records = []
    seen_instruments = set()  # Dedupe by instrument number
    
    for county in counties:
        logger.info(f"Scraping {county.upper()} County...")
        
        county_records = []
        
        for variation in variations:
            result = await scrape_single_county(county, variation)
            
            if result['status'] == 'success':
                for record in result['records']:
                    # Dedupe by county + instrument number
                    key = f"{record['county']}:{record['instrument_number']}"
                    if key not in seen_instruments:
                        seen_instruments.add(key)
                        county_records.append(record)
            
            # Rate limit between variations
            await asyncio.sleep(1.0)
        
        results['counties'][county] = {
            'status': 'success' if county_records else 'no_results',
            'records': county_records,
            'count': len(county_records)
        }
        
        all_records.extend(county_records)
        
        # Rate limit between counties
        await asyncio.sleep(2.0)
    
    # Calculate summary
    results['total_records'] = len(all_records)
    
    for record in all_records:
        doc_type = record.get('document_type', 'UNKNOWN')
        
        # Count by type
        if doc_type not in results['summary']['by_type']:
            results['summary']['by_type'][doc_type] = 0
        results['summary']['by_type'][doc_type] += 1
        
        # Active liens (not releases)
        if doc_type != 'REL_LIEN':
            results['summary']['active_liens'] += 1
        
        # Sum amounts
        if record.get('amount'):
            results['summary']['total_amount'] += record['amount']
    
    return results


def pair_liens_with_releases(records: list[dict]) -> list[dict]:
    """
    Match mechanic's liens with their releases.
    
    Returns records with has_release and release_date populated.
    """
    # Group by grantee
    by_grantee = {}
    for r in records:
        grantee = r.get('grantee', '').upper()
        if grantee not in by_grantee:
            by_grantee[grantee] = []
        by_grantee[grantee].append(r)
    
    # For each grantee, try to pair liens with releases
    for grantee, grantee_records in by_grantee.items():
        liens = [r for r in grantee_records if r['document_type'] == 'MECH_LIEN']
        releases = [r for r in grantee_records if r['document_type'] == 'REL_LIEN']
        
        # Simple pairing: match by similar grantor (creditor)
        for lien in liens:
            lien_grantor = lien.get('grantor', '').upper()
            
            for release in releases:
                release_grantor = release.get('grantor', '').upper()
                release_date = release.get('filing_date')
                
                # If same creditor released a lien after this was filed
                if (lien_grantor and release_grantor and 
                    lien_grantor in release_grantor or release_grantor in lien_grantor):
                    lien_date = lien.get('filing_date')
                    if lien_date and release_date and release_date >= lien_date:
                        lien['has_release'] = True
                        lien['release_date'] = release_date
                        # Calculate days to release
                        from datetime import datetime
                        try:
                            lien_dt = datetime.fromisoformat(lien_date)
                            release_dt = datetime.fromisoformat(release_date)
                            lien['days_to_release'] = (release_dt - lien_dt).days
                        except:
                            pass
                        break
    
    return records


def calculate_lien_score(records: list[dict]) -> dict:
    """
    Calculate a lien-based financial health score.
    
    Returns:
        Dict with score (0-10), deductions, and notes
    """
    score = 10
    notes = []
    
    # Filter to active liens only
    active_liens = [r for r in records if r['document_type'] != 'REL_LIEN' and not r.get('has_release')]
    resolved_liens = [r for r in records if r.get('has_release', False)]
    
    # Count by severity
    critical_count = len([r for r in active_liens if LIEN_SEVERITY.get(r['document_type']) == 'CRITICAL'])
    high_count = len([r for r in active_liens if LIEN_SEVERITY.get(r['document_type']) == 'HIGH'])
    
    # Deductions for active liens
    if critical_count >= 1:
        score -= 5
        notes.append(f"{critical_count} CRITICAL lien(s) (tax lien or judgment)")
    
    if high_count >= 3:
        score -= 5
        notes.append(f"{high_count} HIGH severity liens (pattern of non-payment)")
    elif high_count >= 1:
        score -= 3
        notes.append(f"{high_count} active mechanic's lien(s)")
    
    # Check for slow releases
    slow_releases = [r for r in resolved_liens if r.get('days_to_release', 0) > 90]
    if len(slow_releases) >= 2:
        score -= 2
        notes.append(f"{len(slow_releases)} liens took >90 days to resolve")
    
    # Total amount check
    total_active_amount = sum(r.get('amount', 0) or 0 for r in active_liens)
    if total_active_amount > 50000:
        score -= 2
        notes.append(f"Active liens total ${total_active_amount:,.2f}")
    
    return {
        'score': max(0, score),
        'max_score': 10,
        'active_liens': len(active_liens),
        'resolved_liens': len(resolved_liens),
        'total_active_amount': total_active_amount,
        'notes': notes
    }


async def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(description='Scrape county lien records')
    parser.add_argument('--name', '-n', required=True, help='Business name to search')
    parser.add_argument('--owner', '-o', help='Owner/registered agent name')
    parser.add_argument('--counties', '-c', nargs='+', choices=list(SCRAPERS.keys()),
                        help='Specific counties to search (default: all)')
    parser.add_argument('--output', '-O', help='Output JSON file path')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Run the scrape
    results = await scrape_all_counties(
        name=args.name,
        owner_name=args.owner,
        counties=args.counties
    )
    
    # Pair liens with releases
    all_records = []
    for county_data in results['counties'].values():
        all_records.extend(county_data.get('records', []))
    
    all_records = pair_liens_with_releases(all_records)
    
    # Calculate score
    lien_score = calculate_lien_score(all_records)
    results['lien_score'] = lien_score
    
    # Output
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        print(f"Results saved to {args.output}")
    else:
        # Print to stdout for collection_service.js to capture
        print(json.dumps(results, default=str))
    
    # Summary to stderr (for human viewing)
    print(f"\n=== LIEN SEARCH SUMMARY ===", file=sys.stderr)
    print(f"Search term: {args.name}", file=sys.stderr)
    print(f"Total records: {results['total_records']}", file=sys.stderr)
    print(f"Active liens: {lien_score['active_liens']}", file=sys.stderr)
    print(f"Lien Score: {lien_score['score']}/10", file=sys.stderr)
    if lien_score['notes']:
        print("Notes:", file=sys.stderr)
        for note in lien_score['notes']:
            print(f"  - {note}", file=sys.stderr)


if __name__ == '__main__':
    asyncio.run(main())
