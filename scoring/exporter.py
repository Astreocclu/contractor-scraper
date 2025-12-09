"""Export scored leads to tiered CSV files.

Structure:
/exports/
├── pool/
│   ├── tier_a.csv       # score >= 80
│   ├── tier_b.csv       # 50 <= score < 80
│   └── tier_c.csv       # score < 50
├── outdoor_living/
│   └── ...
├── roof/
│   └── ...
├── fence/
│   └── ...
├── other/
│   └── ...
└── flagged/
    └── needs_review.csv  # Passed filter but scored <30
"""

import os
import csv
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


def get_tier_from_score(score: int) -> str:
    """Map score to tier letter."""
    if score >= 80:
        return 'a'
    elif score >= 50:
        return 'b'
    else:
        return 'c'


def export_scored_leads(
    scored_leads: List[Any],
    output_dir: str = 'exports',
    timestamp_suffix: bool = True,
    include_flagged: bool = True
) -> Dict[str, int]:
    """
    Export leads to category/tier CSV files.
    
    Args:
        scored_leads: List of ScoringResult objects (or dicts with same fields)
        output_dir: Base output directory
        timestamp_suffix: If True, add timestamp to filenames
        include_flagged: If True, export <30 scores to flagged/needs_review.csv
    
    Returns:
        Dict mapping filepath to record count
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Timestamp for filenames
    ts = datetime.now().strftime('%Y%m%d_%H%M%S') if timestamp_suffix else ''
    
    # Group by category and tier
    groups: Dict[tuple, List] = {}
    flagged: List = []
    
    for lead in scored_leads:
        # Handle both ScoringResult objects and dicts
        if hasattr(lead, 'to_dict'):
            data = lead.to_dict()
            category = getattr(lead, 'ideal_contractor_type', 'other') or 'other'
            score = getattr(lead, 'score', 0)
        else:
            data = lead
            category = lead.get('ideal_contractor_type') or lead.get('category') or 'other'
            score = lead.get('score', 0)
        
        tier = get_tier_from_score(score)
        
        key = (category, tier)
        if key not in groups:
            groups[key] = []
        groups[key].append(data)
        
        # Flag for review if score < 30 but passed filters
        if score < 30 and include_flagged:
            flagged.append(data)
    
    # Define CSV field order
    csv_fields = [
        'lead_id', 'permit_id', 'city', 'property_address', 'owner_name',
        'project_description', 'market_value', 'days_old', 'is_absentee',
        'score', 'tier', 'reasoning', 'red_flags', 'ideal_contractor_type',
        'contact_priority', 'applicant_type', 'chain_of_thought', 'scored_at'
    ]
    
    export_counts = {}
    
    def write_csv_file(filepath: Path, leads_list: List[Dict]) -> int:
        """Write leads to a CSV file."""
        filepath.parent.mkdir(parents=True, exist_ok=True)
        
        with open(filepath, 'w', newline='', encoding='utf-8') as f:
            # Filter to only fields that exist in the data
            available_fields = []
            if leads_list:
                first = leads_list[0]
                available_fields = [f for f in csv_fields if f in first]
                # Add any extra fields not in our standard list
                extra = [k for k in first.keys() if k not in csv_fields]
                available_fields.extend(extra)
            
            writer = csv.DictWriter(f, fieldnames=available_fields, extrasaction='ignore')
            writer.writeheader()
            
            for lead_data in leads_list:
                # Flatten list fields
                row = {}
                for field in available_fields:
                    value = lead_data.get(field, '')
                    if isinstance(value, list):
                        value = '|'.join(str(v) for v in value)
                    elif isinstance(value, dict):
                        value = str(value)
                    row[field] = value
                writer.writerow(row)
        
        return len(leads_list)
    
    # Write category/tier files
    for (category, tier), leads_list in groups.items():
        if not leads_list:
            continue
        
        filename = f"tier_{tier}_{ts}.csv" if ts else f"tier_{tier}.csv"
        filepath = output_path / category / filename
        
        count = write_csv_file(filepath, leads_list)
        export_counts[str(filepath)] = count
        
        logger.info(f"Exported {count} {category} tier {tier.upper()} leads to {filepath}")
    
    # Write flagged file
    if flagged:
        filename = f"needs_review_{ts}.csv" if ts else "needs_review.csv"
        filepath = output_path / "flagged" / filename
        
        count = write_csv_file(filepath, flagged)
        export_counts[str(filepath)] = count
        
        logger.warning(f"Exported {count} flagged leads (score <30) to {filepath}")
    
    total = sum(export_counts.values())
    logger.info(f"Export complete: {total} leads to {len(export_counts)} files")
    
    return export_counts


def export_comparison_csv(
    traditional_scores: List[Dict],
    ai_scores: List[Dict],
    output_file: str = 'exports/score_comparison.csv'
) -> str:
    """
    Export side-by-side comparison of traditional vs AI scores.
    
    Args:
        traditional_scores: List of dicts with 'lead_id' and 'score'
        ai_scores: List of dicts with 'lead_id' and AI scoring fields
        output_file: Output path
    
    Returns:
        Path to created file
    """
    # Index by lead_id
    trad_by_id = {s.get('lead_id'): s for s in traditional_scores}
    ai_by_id = {s.get('lead_id'): s for s in ai_scores}
    
    # Merge
    all_ids = set(trad_by_id.keys()) | set(ai_by_id.keys())
    
    rows = []
    for lead_id in all_ids:
        trad = trad_by_id.get(lead_id, {})
        ai = ai_by_id.get(lead_id, {})
        
        row = {
            'lead_id': lead_id,
            'traditional_score': trad.get('score', ''),
            'traditional_tier': trad.get('tier', ''),
            'ai_score': ai.get('score', ''),
            'ai_tier': ai.get('tier', ''),
            'score_delta': '',
            'ai_reasoning': ai.get('reasoning', ''),
            'ai_applicant_type': ai.get('applicant_type', ''),
            'ai_red_flags': '|'.join(ai.get('red_flags', [])) if ai.get('red_flags') else '',
        }
        
        # Calculate delta if both scores exist
        if trad.get('score') is not None and ai.get('score') is not None:
            row['score_delta'] = ai.get('score', 0) - trad.get('score', 0)
        
        rows.append(row)
    
    # Sort by absolute delta (largest differences first)
    rows.sort(key=lambda r: abs(r.get('score_delta', 0) or 0), reverse=True)
    
    # Write CSV
    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    fields = [
        'lead_id', 'traditional_score', 'traditional_tier',
        'ai_score', 'ai_tier', 'score_delta',
        'ai_reasoning', 'ai_applicant_type', 'ai_red_flags'
    ]
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    
    logger.info(f"Exported {len(rows)} score comparisons to {output_file}")
    
    return str(output_path)
