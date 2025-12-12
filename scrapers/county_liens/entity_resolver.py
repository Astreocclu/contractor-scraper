"""
Entity resolver for matching company/person names across records.

Handles name normalization and fuzzy matching to link lien records
to contractors in the database.
"""

import re
from typing import Optional
from dataclasses import dataclass

try:
    from fuzzywuzzy import fuzz
except ImportError:
    # Fallback if fuzzywuzzy not installed
    fuzz = None


@dataclass
class MatchResult:
    """Result of entity matching."""
    contractor_id: int
    contractor_name: str
    match_score: int  # 0-100
    match_type: str   # 'exact', 'fuzzy', 'owner'
    matched_name: str  # The name that was matched


class EntityResolver:
    """
    Resolve company name variations to canonical entities.
    
    Handles common business name variations:
    - LLC, Inc, Corp suffixes
    - DBA (doing business as)
    - Punctuation variations
    - Common abbreviations
    """
    
    # Patterns to normalize (regex, replacement)
    SUFFIX_PATTERNS = [
        # LLC variations
        (r',?\s*L\.?L\.?C\.?$', ' LLC'),
        (r',?\s*Limited\s+Liability\s+Company$', ' LLC'),
        
        # Inc variations
        (r',?\s*Inc\.?$', ' INC'),
        (r',?\s*Incorporated$', ' INC'),
        
        # Corp variations
        (r',?\s*Corp\.?$', ' CORP'),
        (r',?\s*Corporation$', ' CORP'),
        
        # Co variations
        (r',?\s*Co\.?$', ' CO'),
        (r',?\s*Company$', ' CO'),
        
        # DBA handling
        (r'\s+d/?b/?a\s+', ' DBA '),
        (r'\s+doing\s+business\s+as\s+', ' DBA '),
        
        # Ltd variations
        (r',?\s*Ltd\.?$', ' LTD'),
        (r',?\s*Limited$', ' LTD'),
    ]
    
    # Words to remove for core comparison
    NOISE_WORDS = {
        'THE', 'AND', 'OF', 'A', 'AN', 'IN', 'ON', 'AT', 'TO', 'FOR',
        'SERVICES', 'SERVICE', 'COMPANY', 'COMPANIES', 'GROUP', 'ENTERPRISES',
    }
    
    def __init__(self, threshold: int = 85):
        """
        Initialize resolver.
        
        Args:
            threshold: Minimum fuzzy match score (0-100) to consider a match
        """
        self.threshold = threshold
        
        if fuzz is None:
            raise ImportError(
                "fuzzywuzzy is required for entity resolution. "
                "Install with: pip install fuzzywuzzy python-Levenshtein"
            )
    
    def normalize_name(self, name: str) -> str:
        """
        Normalize company name for matching.
        
        Steps:
        1. Uppercase
        2. Normalize suffixes (LLC, Inc, etc.)
        3. Remove punctuation except essential
        4. Collapse whitespace
        
        Args:
            name: Raw company/person name
            
        Returns:
            Normalized name
        """
        if not name:
            return ""
        
        normalized = name.upper().strip()
        
        # Apply suffix normalizations
        for pattern, replacement in self.SUFFIX_PATTERNS:
            normalized = re.sub(pattern, replacement, normalized, flags=re.IGNORECASE)
        
        # Remove punctuation except ampersand (important in company names)
        normalized = re.sub(r'[^\w\s&]', '', normalized)
        
        # Collapse whitespace
        normalized = ' '.join(normalized.split())
        
        return normalized
    
    def extract_core_name(self, name: str) -> str:
        """
        Extract core business name without suffixes or noise words.
        
        Used for looser matching when exact match fails.
        """
        normalized = self.normalize_name(name)
        
        # Remove business entity suffixes
        for suffix in ['LLC', 'INC', 'CORP', 'CO', 'LTD']:
            normalized = re.sub(rf'\s+{suffix}$', '', normalized)
        
        # Remove DBA portion
        if ' DBA ' in normalized:
            normalized = normalized.split(' DBA ')[0]
        
        # Remove noise words (but keep if it's the only word)
        words = normalized.split()
        if len(words) > 1:
            words = [w for w in words if w not in self.NOISE_WORDS]
        
        return ' '.join(words)
    
    def match_contractor(
        self,
        lien_name: str,
        contractors: list[dict],
        include_owners: bool = True
    ) -> Optional[MatchResult]:
        """
        Match a lien grantee name to a contractor in database.
        
        Args:
            lien_name: Name from county record
            contractors: List of contractor dicts with 'id', 'name', and optional 'owner_name'
            include_owners: If True, also try matching against owner names
            
        Returns:
            MatchResult or None if no match above threshold
        """
        normalized_lien = self.normalize_name(lien_name)
        core_lien = self.extract_core_name(lien_name)
        
        best_match = None
        best_score = 0
        match_type = None
        matched_name = None
        
        for contractor in contractors:
            contractor_id = contractor.get('id')
            contractor_name = contractor.get('name', contractor.get('business_name', ''))
            owner_name = contractor.get('owner_name')
            
            # Skip if no name
            if not contractor_name:
                continue
            
            normalized_contractor = self.normalize_name(contractor_name)
            core_contractor = self.extract_core_name(contractor_name)
            
            # Try exact normalized match first
            if normalized_lien == normalized_contractor:
                return MatchResult(
                    contractor_id=contractor_id,
                    contractor_name=contractor_name,
                    match_score=100,
                    match_type='exact',
                    matched_name=lien_name
                )
            
            # Fuzzy match on full normalized name
            full_score = fuzz.ratio(normalized_lien, normalized_contractor)
            
            # Fuzzy match on core name (more lenient)
            core_score = fuzz.ratio(core_lien, core_contractor)
            
            # Token sort ratio (handles word order differences)
            token_score = fuzz.token_sort_ratio(normalized_lien, normalized_contractor)
            
            # Take best score
            company_score = max(full_score, core_score, token_score)
            
            if company_score > best_score:
                best_score = company_score
                best_match = contractor
                match_type = 'exact' if company_score >= 95 else 'fuzzy'
                matched_name = contractor_name
            
            # Try owner name match if enabled
            if include_owners and owner_name:
                normalized_owner = self.normalize_name(owner_name)
                owner_score = fuzz.ratio(normalized_lien, normalized_owner)
                
                # Also try partial match (owner name might be part of lien name)
                partial_score = fuzz.partial_ratio(normalized_owner, normalized_lien)
                
                owner_best = max(owner_score, partial_score)
                
                if owner_best > best_score:
                    best_score = owner_best
                    best_match = contractor
                    match_type = 'owner'
                    matched_name = owner_name
        
        # Return if above threshold
        if best_score >= self.threshold and best_match:
            return MatchResult(
                contractor_id=best_match.get('id'),
                contractor_name=best_match.get('name', best_match.get('business_name', '')),
                match_score=best_score,
                match_type=match_type,
                matched_name=matched_name
            )
        
        return None
    
    def find_all_matches(
        self,
        lien_name: str,
        contractors: list[dict],
        min_score: int = 70
    ) -> list[MatchResult]:
        """
        Find all potential matches for a lien name.
        
        Useful for manual review of ambiguous matches.
        
        Args:
            lien_name: Name from county record
            contractors: List of contractor dicts
            min_score: Minimum score to include
            
        Returns:
            List of MatchResult sorted by score descending
        """
        normalized_lien = self.normalize_name(lien_name)
        matches = []
        
        for contractor in contractors:
            contractor_id = contractor.get('id')
            contractor_name = contractor.get('name', contractor.get('business_name', ''))
            
            if not contractor_name:
                continue
            
            normalized_contractor = self.normalize_name(contractor_name)
            
            # Multiple scoring methods
            full_score = fuzz.ratio(normalized_lien, normalized_contractor)
            token_score = fuzz.token_sort_ratio(normalized_lien, normalized_contractor)
            partial_score = fuzz.partial_ratio(normalized_lien, normalized_contractor)
            
            best_score = max(full_score, token_score, partial_score)
            
            if best_score >= min_score:
                matches.append(MatchResult(
                    contractor_id=contractor_id,
                    contractor_name=contractor_name,
                    match_score=best_score,
                    match_type='exact' if best_score >= 95 else 'fuzzy',
                    matched_name=contractor_name
                ))
        
        # Sort by score descending
        matches.sort(key=lambda m: m.match_score, reverse=True)
        return matches


def generate_name_variations(name: str) -> list[str]:
    """
    Generate common variations of a company name for searching.
    
    Args:
        name: Original company name
        
    Returns:
        List of name variations to try
    """
    variations = [name]  # Always include original
    
    resolver = EntityResolver.__new__(EntityResolver)  # Skip __init__ validation
    resolver.SUFFIX_PATTERNS = EntityResolver.SUFFIX_PATTERNS
    
    normalized = name.upper().strip()
    
    # Remove LLC/Inc/Corp and add variations
    base = re.sub(r',?\s*(LLC|INC|CORP|CO|LTD)\.?$', '', normalized, flags=re.IGNORECASE).strip()
    
    if base != normalized:
        variations.append(base)
        variations.append(f"{base} LLC")
        variations.append(f"{base}, LLC")
        variations.append(f"{base} INC")
        variations.append(f"{base} CORP")
    
    # Handle DBA
    if ' DBA ' in normalized.upper() or ' D/B/A ' in normalized.upper():
        parts = re.split(r'\s+d/?b/?a\s+', normalized, flags=re.IGNORECASE)
        variations.extend(parts)
    
    # Remove duplicates while preserving order
    seen = set()
    unique = []
    for v in variations:
        v_lower = v.lower().strip()
        if v_lower and v_lower not in seen:
            seen.add(v_lower)
            unique.append(v.strip())
    
    return unique
