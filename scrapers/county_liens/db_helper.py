"""
Helper to store lien records in Django database.

Called by the orchestrator to persist scraped lien records
and link them to contractors via entity matching.
"""

import os
import sys
import django

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from datetime import datetime
from decimal import Decimal
from contractors.models import Contractor, CountyLienRecord
from scrapers.county_liens.entity_resolver import EntityResolver


def store_lien_records(records: list[dict], contractor_id: int = None) -> dict:
    """
    Store scraped lien records in database.
    
    Args:
        records: List of lien record dicts from scraper
        contractor_id: Optional contractor ID to link to
        
    Returns:
        Dict with counts of stored/updated/skipped records
    """
    stored = 0
    updated = 0
    skipped = 0
    
    for record in records:
        try:
            # Check if already exists
            existing = CountyLienRecord.objects.filter(
                county=record['county'],
                instrument_number=record['instrument_number']
            ).first()
            
            if existing:
                # Update if we have new info (e.g., release)
                if contractor_id and not existing.matched_contractor_id:
                    existing.matched_contractor_id = contractor_id
                    existing.save()
                    updated += 1
                else:
                    skipped += 1
                continue
            
            # Parse date
            filing_date = record.get('filing_date')
            if isinstance(filing_date, str):
                filing_date = datetime.fromisoformat(filing_date).date()
            
            # Parse amount
            amount = record.get('amount')
            if amount and not isinstance(amount, Decimal):
                amount = Decimal(str(amount))
            
            # Create new record
            lien = CountyLienRecord(
                county=record['county'],
                instrument_number=record['instrument_number'],
                document_type=record['document_type'],
                grantor=record.get('grantor', ''),
                grantee=record.get('grantee', ''),
                filing_date=filing_date,
                amount=amount,
                source_url=record.get('source_url', ''),
                raw_data=record.get('raw_data', {}),
            )
            
            if contractor_id:
                lien.matched_contractor_id = contractor_id
                lien.match_confidence = 'exact'
            
            lien.save()
            stored += 1
            
        except Exception as e:
            print(f"Error storing lien: {e}")
            skipped += 1
    
    return {
        'stored': stored,
        'updated': updated,
        'skipped': skipped,
        'total': len(records)
    }


def link_liens_to_contractor(contractor_id: int, threshold: int = 85) -> dict:
    """
    Find and link unmatched lien records to a contractor.
    
    Args:
        contractor_id: Contractor ID to link to
        threshold: Fuzzy match threshold (0-100)
        
    Returns:
        Dict with counts of linked records
    """
    try:
        contractor = Contractor.objects.get(id=contractor_id)
    except Contractor.DoesNotExist:
        return {'error': f'Contractor {contractor_id} not found'}
    
    resolver = EntityResolver(threshold=threshold)
    
    # Get unmatched liens
    unmatched = CountyLienRecord.objects.filter(matched_contractor__isnull=True)
    
    linked = 0
    
    # Build contractor info for matching
    contractor_info = {
        'id': contractor.id,
        'name': contractor.business_name,
        'owner_name': None,  # Could be populated from TX SOS data
    }
    
    for lien in unmatched:
        # Try to match by grantee name
        match = resolver.match_contractor(lien.grantee, [contractor_info])
        
        if match:
            lien.matched_contractor = contractor
            lien.match_confidence = match.match_type
            lien.match_score = match.match_score
            lien.save()
            linked += 1
    
    return {
        'contractor_id': contractor_id,
        'contractor_name': contractor.business_name,
        'checked': unmatched.count(),
        'linked': linked
    }


def get_contractor_liens(contractor_id: int) -> dict:
    """
    Get all lien records for a contractor.
    
    Returns structured summary for audit.
    """
    liens = CountyLienRecord.objects.filter(matched_contractor_id=contractor_id)
    
    active = liens.filter(has_release=False).exclude(document_type='REL_LIEN')
    resolved = liens.filter(has_release=True)
    releases = liens.filter(document_type='REL_LIEN')
    
    total_active_amount = sum(l.amount or 0 for l in active)
    
    return {
        'total_records': liens.count(),
        'active_liens': active.count(),
        'resolved_liens': resolved.count(),
        'releases': releases.count(),
        'total_active_amount': float(total_active_amount),
        'by_type': {
            'MECH_LIEN': liens.filter(document_type='MECH_LIEN').count(),
            'ABS_JUDG': liens.filter(document_type='ABS_JUDG').count(),
            'FED_TAX_LIEN': liens.filter(document_type='FED_TAX_LIEN').count(),
            'STATE_TAX_LIEN': liens.filter(document_type='STATE_TAX_LIEN').count(),
        },
        'records': [
            {
                'type': l.document_type,
                'amount': float(l.amount) if l.amount else None,
                'filed': l.filing_date.isoformat() if l.filing_date else None,
                'creditor': l.grantor,
                'status': 'RELEASED' if l.has_release else 'ACTIVE',
                'county': l.county,
            }
            for l in active[:10]  # Limit to 10 for display
        ]
    }


if __name__ == '__main__':
    # Test
    import sys
    if len(sys.argv) > 1:
        contractor_id = int(sys.argv[1])
        result = get_contractor_liens(contractor_id)
        import json
        print(json.dumps(result, indent=2, default=str))
