"""
Contractor deduplication service.
Identifies and merges duplicate contractor records.
"""

import re
import logging
from difflib import SequenceMatcher
from typing import List, Tuple

logger = logging.getLogger(__name__)


def find_duplicates(contractors: list) -> List[dict]:
    """
    Find likely duplicate contractors.

    Args:
        contractors: List of Contractor model instances

    Returns:
        List of potential duplicates:
        {
            "contractor_a_id": int,
            "contractor_b_id": int,
            "contractor_a_name": str,
            "contractor_b_name": str,
            "confidence": int (0-100),
            "reasons": list[str]
        }
    """
    duplicates = []

    for i, c1 in enumerate(contractors):
        for c2 in contractors[i + 1:]:
            confidence, reasons = _calculate_duplicate_confidence(c1, c2)

            if confidence >= 50:
                duplicates.append({
                    "contractor_a_id": c1.id,
                    "contractor_b_id": c2.id,
                    "contractor_a_name": c1.business_name,
                    "contractor_b_name": c2.business_name,
                    "confidence": confidence,
                    "reasons": reasons
                })

    # Sort by confidence descending
    duplicates.sort(key=lambda x: x["confidence"], reverse=True)
    return duplicates


def _calculate_duplicate_confidence(c1, c2) -> Tuple[int, List[str]]:
    """Calculate confidence that two contractors are duplicates."""
    confidence = 0
    reasons = []

    # Phone match = very strong signal
    if c1.phone and c2.phone:
        phone1 = _normalize_phone(c1.phone)
        phone2 = _normalize_phone(c2.phone)
        if phone1 and phone2 and phone1 == phone2:
            confidence += 50
            reasons.append("Same phone number")

    # Address match = strong signal
    if c1.address and c2.address:
        addr_sim = _text_similarity(c1.address, c2.address)
        if addr_sim > 0.9:
            confidence += 40
            reasons.append(f"Same address ({addr_sim:.0%} match)")
        elif addr_sim > 0.7:
            confidence += 20
            reasons.append(f"Similar address ({addr_sim:.0%} match)")

    # Name similarity
    name_sim = _name_similarity(c1.business_name, c2.business_name)
    if name_sim > 0.9:
        confidence += 35
        reasons.append(f"Very similar name ({name_sim:.0%} match)")
    elif name_sim > 0.7:
        confidence += 20
        reasons.append(f"Similar name ({name_sim:.0%} match)")

    # Same owner (if known)
    owner1 = getattr(c1, 'bbb_owner_name', None)
    owner2 = getattr(c2, 'bbb_owner_name', None)
    if owner1 and owner2:
        if _name_similarity(owner1, owner2) > 0.9:
            confidence += 60
            reasons.append("Same owner name")

    # Same website domain
    if c1.website and c2.website:
        if _same_domain(c1.website, c2.website):
            confidence += 45
            reasons.append("Same website domain")

    # Same Google Place ID (definite duplicate)
    if c1.google_place_id and c2.google_place_id:
        if c1.google_place_id == c2.google_place_id:
            confidence = 100
            reasons = ["Same Google Place ID - definite duplicate"]

    # Same Yelp ID (definite duplicate)
    if c1.yelp_id and c2.yelp_id:
        if c1.yelp_id == c2.yelp_id:
            confidence = 100
            reasons = ["Same Yelp ID - definite duplicate"]

    # Cap at 100
    confidence = min(100, confidence)

    return confidence, reasons


def _normalize_phone(phone: str) -> str:
    """Strip phone to digits only, return last 10 digits."""
    if not phone:
        return ""
    digits = re.sub(r'\D', '', phone)
    return digits[-10:] if len(digits) >= 10 else digits


def _text_similarity(text1: str, text2: str) -> float:
    """Generic text similarity using SequenceMatcher."""
    if not text1 or not text2:
        return 0.0
    t1 = text1.lower().strip()
    t2 = text2.lower().strip()
    return SequenceMatcher(None, t1, t2).ratio()


def _name_similarity(name1: str, name2: str) -> float:
    """Business name similarity with common suffix removal."""
    if not name1 or not name2:
        return 0.0

    def normalize(s):
        s = s.lower()
        for suffix in ['llc', 'inc', 'corp', 'co', 'company', 'services', 'service',
                       'contracting', 'construction', 'builders', 'building']:
            s = s.replace(suffix, '')
        s = re.sub(r'[^\w\s]', '', s)  # Remove punctuation
        return ' '.join(s.split())  # Normalize whitespace

    return SequenceMatcher(None, normalize(name1), normalize(name2)).ratio()


def _same_domain(url1: str, url2: str) -> bool:
    """Check if two URLs are from the same domain."""
    if not url1 or not url2:
        return False

    def extract_domain(url):
        url = url.lower().replace('https://', '').replace('http://', '')
        url = url.replace('www.', '')
        return url.split('/')[0]

    return extract_domain(url1) == extract_domain(url2)


def merge_contractors(primary_id: int, secondary_id: int, model_class):
    """
    Merge secondary contractor into primary.
    Keeps primary, deletes secondary, preserves unique data.

    Args:
        primary_id: ID of contractor to keep
        secondary_id: ID of contractor to merge and delete
        model_class: The Contractor model class

    Returns:
        dict with merge results
    """
    try:
        primary = model_class.objects.get(id=primary_id)
        secondary = model_class.objects.get(id=secondary_id)
    except model_class.DoesNotExist as e:
        return {"success": False, "error": str(e)}

    merged_fields = []

    # Fields to potentially merge (copy from secondary if primary is empty)
    fields_to_merge = [
        'phone', 'email', 'website', 'address', 'zip_code',
        'google_place_id', 'google_rating', 'google_review_count',
        'yelp_id', 'yelp_rating', 'yelp_review_count',
        'bbb_rating', 'bbb_accredited', 'bbb_complaint_count', 'bbb_years_in_business', 'bbb_url',
    ]

    for field in fields_to_merge:
        primary_val = getattr(primary, field, None)
        secondary_val = getattr(secondary, field, None)

        # If primary is empty/None/0 and secondary has a value, copy it
        if not primary_val and secondary_val:
            setattr(primary, field, secondary_val)
            merged_fields.append(field)

    # Merge reviews JSON if both have them
    if secondary.google_reviews_json:
        existing_reviews = primary.google_reviews_json or []
        new_reviews = secondary.google_reviews_json or []
        # Dedupe by text content
        existing_texts = {r.get('text', '')[:100] for r in existing_reviews}
        for review in new_reviews:
            if review.get('text', '')[:100] not in existing_texts:
                existing_reviews.append(review)
        primary.google_reviews_json = existing_reviews
        merged_fields.append('google_reviews_json')

    # Take higher scores
    if secondary.trust_score > primary.trust_score:
        primary.trust_score = secondary.trust_score
        merged_fields.append('trust_score')

    # Update audits to point to primary
    if hasattr(secondary, 'audits'):
        secondary.audits.all().update(contractor=primary)
        merged_fields.append('audits')

    # Save primary and delete secondary
    primary.save()

    # Log the merge
    logger.info(f"Merged contractor {secondary_id} ({secondary.business_name}) "
                f"into {primary_id} ({primary.business_name}). "
                f"Fields merged: {merged_fields}")

    secondary_name = secondary.business_name
    secondary.delete()

    return {
        "success": True,
        "primary_id": primary_id,
        "secondary_id": secondary_id,
        "secondary_name": secondary_name,
        "merged_fields": merged_fields
    }
