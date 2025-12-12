# scrapers/county_liens/__init__.py
"""
County lien scrapers for Texas DFW Metroplex counties.

Usage:
    from scrapers.county_liens import scrape_all_counties, scrape_county
    
    # Scrape all counties for a contractor
    results = await scrape_all_counties("ABC Contractors LLC", "Fort Worth", "TX")
    
    # Scrape single county
    results = await scrape_county("tarrant", "ABC Contractors LLC")
"""

from .base import (
    BaseCountyLienScraper,
    LienRecord,
    LienScraperError,
    CountyPortalUnavailable,
    RateLimitExceeded,
)
from .entity_resolver import EntityResolver

__all__ = [
    'BaseCountyLienScraper',
    'LienRecord',
    'LienScraperError',
    'CountyPortalUnavailable',
    'RateLimitExceeded',
    'EntityResolver',
    'scrape_all_counties',
    'scrape_county',
]


async def scrape_county(county: str, name: str, search_variations: bool = True) -> list[dict]:
    """
    Scrape a single county for lien records.
    
    Args:
        county: County name (tarrant, dallas, collin, denton)
        name: Business or person name to search
        search_variations: If True, try common name variations
        
    Returns:
        List of lien record dicts
    """
    scrapers = {
        'tarrant': 'tarrant.TarrantCountyScraper',
        'dallas': 'dallas.DallasCountyScraper', 
        'collin': 'collin.CollinCountyScraper',
        'denton': 'denton.DentonCountyScraper',
    }
    
    if county.lower() not in scrapers:
        raise ValueError(f"Unknown county: {county}. Supported: {list(scrapers.keys())}")
    
    module_name, class_name = scrapers[county.lower()].split('.')
    module = __import__(f'scrapers.county_liens.{module_name}', fromlist=[class_name])
    scraper_class = getattr(module, class_name)
    
    scraper = scraper_class()
    return await scraper.search_with_retry(name)


async def scrape_all_counties(
    name: str,
    city: str = None,
    state: str = "TX",
    owner_name: str = None
) -> dict:
    """
    Scrape all supported counties for lien records.
    
    Args:
        name: Business name to search
        city: City (used to prioritize relevant counties)
        state: State (TX only supported)
        owner_name: Optional owner/registered agent name
        
    Returns:
        Dict with county names as keys and result lists as values
    """
    import asyncio
    
    counties = ['tarrant', 'dallas', 'collin', 'denton']
    results = {}
    
    # Search company name in all counties
    for county in counties:
        try:
            records = await scrape_county(county, name)
            results[county] = records
        except Exception as e:
            results[county] = {'error': str(e), 'records': []}
        
        # Rate limit between counties
        await asyncio.sleep(1.0)
    
    # If owner name provided, search that too
    if owner_name and owner_name.lower() != name.lower():
        for county in counties:
            try:
                owner_records = await scrape_county(county, owner_name)
                if county in results and isinstance(results[county], list):
                    results[county].extend(owner_records)
                elif county in results and 'records' in results[county]:
                    results[county]['records'].extend(owner_records)
            except Exception:
                pass
            await asyncio.sleep(1.0)
    
    return results
