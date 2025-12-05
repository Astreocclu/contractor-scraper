#!/usr/bin/env python3
"""
DFW Signal Engine - AI Permit Categorization

Uses DeepSeek (primary) or Google Gemini (fallback) to categorize permit descriptions into lead types.
"""

import sys
import os
import json
import re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from typing import Optional, Dict, List
from datetime import datetime

from scripts.utils import (
    setup_logging, get_db_connection, rate_limit
)

# Try to import OpenAI (for DeepSeek)
try:
    from openai import OpenAI
    DEEPSEEK_AVAILABLE = True
except ImportError:
    DEEPSEEK_AVAILABLE = False

# Try to import Gemini (fallback)
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

logger = setup_logging("categorize", None)

# Lead type categories
LEAD_TYPES = {
    "pool": "Swimming pool, spa, hot tub construction",
    "patio_enclosure": "Patio enclosure, screen room, sunroom",
    "outdoor_living": "Patio, deck, pergola, outdoor kitchen",
    "new_construction": "New home, new building",
    "addition": "Home addition, room addition",
    "remodel": "Major remodel, renovation",
    "fence": "Fence construction or repair",
    "other": "Other permit types"
}

# Keywords for rule-based fallback
KEYWORD_PATTERNS = {
    "pool": [r"pool", r"swim", r"spa", r"hot\s*tub"],
    "patio_enclosure": [r"screen\s*(enclosure|room|patio)", r"sunroom", r"patio\s*enclosure", r"screened"],
    "outdoor_living": [r"patio", r"deck", r"pergola", r"outdoor\s*kitchen", r"gazebo", r"arbor"],
    "fence": [r"fence", r"fencing"],
}


def init_deepseek() -> Optional[any]:
    """Initialize DeepSeek API (primary)."""
    if not DEEPSEEK_AVAILABLE:
        logger.warning("OpenAI package not available for DeepSeek")
        return None

    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        logger.warning("DEEPSEEK_API_KEY not set")
        return None

    try:
        client = OpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com"
        )
        return client
    except Exception as e:
        logger.error(f"Failed to init DeepSeek: {e}")
        return None


def init_gemini() -> Optional[any]:
    """Initialize Gemini API (fallback)."""
    if not GEMINI_AVAILABLE:
        logger.warning("Gemini not available")
        return None

    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("GOOGLE_API_KEY not set")
        return None

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-pro')
        return model
    except Exception as e:
        logger.error(f"Failed to init Gemini: {e}")
        return None


CATEGORIZATION_SYSTEM_PROMPT = """You are a building permit categorization assistant for a security screen company.
Categorize permit descriptions into lead types. Return ONLY valid JSON.

Lead types:
- pool: Swimming pool, spa, hot tub (highest priority - outdoor area needing screens)
- patio_enclosure: Screen room, sunroom, patio enclosure (direct match for screens)
- outdoor_living: Patio, deck, pergola, outdoor kitchen (likely screen customers)
- new_construction: New home (blank slate for screens)
- addition: Room addition (potential screen opportunity)
- remodel: Major renovation (potential screen opportunity)
- fence: Fence (security-conscious but limited screen potential)
- other: Anything else"""


def categorize_with_deepseek(client, descriptions: List[str]) -> List[Dict]:
    """
    Categorize permit descriptions using DeepSeek.

    Processes in batches for efficiency.
    """
    if not descriptions:
        return []

    user_prompt = f"""Categorize these building permit descriptions.

For each description, respond with JSON only:
{{"results": [{{"index": 0, "type": "pool", "subtypes": ["spa"], "confidence": 0.95}}, ...]}}

Descriptions:
{json.dumps([{"index": i, "desc": d} for i, d in enumerate(descriptions)])}"""

    try:
        rate_limit()
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": CATEGORIZATION_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=1500,
            temperature=0.2
        )

        text = response.choices[0].message.content
        result = json.loads(text)
        return result.get("results", [])
    except Exception as e:
        logger.error(f"DeepSeek error: {e}")

    return []


def categorize_with_gemini(model, descriptions: List[str]) -> List[Dict]:
    """
    Categorize permit descriptions using Gemini (fallback).

    Processes in batches for efficiency.
    """
    if not descriptions:
        return []

    prompt = f"""Categorize these building permit descriptions into lead types for a security screen company.

Lead types:
- pool: Swimming pool, spa, hot tub (highest priority - outdoor area needing screens)
- patio_enclosure: Screen room, sunroom, patio enclosure (direct match for screens)
- outdoor_living: Patio, deck, pergola, outdoor kitchen (likely screen customers)
- new_construction: New home (blank slate for screens)
- addition: Room addition (potential screen opportunity)
- remodel: Major renovation (potential screen opportunity)
- fence: Fence (security-conscious but limited screen potential)
- other: Anything else

For each description, respond with JSON only:
{{"results": [{{"index": 0, "type": "pool", "subtypes": ["spa"], "confidence": 0.95}}, ...]}}

Descriptions:
{json.dumps([{"index": i, "desc": d} for i, d in enumerate(descriptions)])}
"""

    try:
        rate_limit()
        response = model.generate_content(prompt)
        text = response.text

        # Extract JSON from response
        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            result = json.loads(json_match.group())
            return result.get("results", [])
    except Exception as e:
        logger.error(f"Gemini error: {e}")

    return []


def categorize_with_rules(description: str) -> Dict:
    """
    Categorize permit description using keyword rules.

    Fallback when Gemini is not available.
    """
    if not description:
        return {"type": "other", "subtypes": [], "confidence": 0.5}

    desc_lower = description.lower()
    subtypes = []

    # Check each category
    for lead_type, patterns in KEYWORD_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, desc_lower):
                # Detect subtypes
                if lead_type == "pool":
                    if re.search(r"spa", desc_lower):
                        subtypes.append("spa")
                    if re.search(r"water\s*feature", desc_lower):
                        subtypes.append("water_feature")

                return {
                    "type": lead_type,
                    "subtypes": subtypes,
                    "confidence": 0.8
                }

    return {"type": "other", "subtypes": [], "confidence": 0.5}


def categorize_permits(batch_size: int = 10):
    """
    Categorize all uncategorized permits.

    Priority: DeepSeek > Gemini > Rules
    """
    logger.info("Starting permit categorization...")

    # Initialize AI clients (DeepSeek primary, Gemini fallback)
    deepseek_client = init_deepseek()
    gemini_model = init_gemini() if not deepseek_client else None

    use_deepseek = deepseek_client is not None
    use_gemini = gemini_model is not None and not use_deepseek

    if use_deepseek:
        ai_engine = "DeepSeek"
    elif use_gemini:
        ai_engine = "Gemini"
    else:
        ai_engine = "rules"

    with get_db_connection() as conn:
        # Get uncategorized permits
        cursor = conn.execute("""
            SELECT permit_id, city, description, permit_type
            FROM permits
            WHERE lead_type IS NULL OR lead_type = ''
            LIMIT 1000
        """)
        permits = cursor.fetchall()

    if not permits:
        logger.info("No permits to categorize")
        return

    logger.info(f"Categorizing {len(permits)} permits (using {ai_engine})")

    categorized = 0

    if use_deepseek or use_gemini:
        # Process in batches with AI
        for i in range(0, len(permits), batch_size):
            batch = permits[i:i+batch_size]
            descriptions = [p[2] or p[3] for p in batch]  # Use description or permit_type

            if use_deepseek:
                results = categorize_with_deepseek(deepseek_client, descriptions)
            else:
                results = categorize_with_gemini(gemini_model, descriptions)

            with get_db_connection() as conn:
                for j, result in enumerate(results):
                    if j < len(batch):
                        permit_id = batch[j][0]
                        city = batch[j][1]
                        conn.execute("""
                            UPDATE permits SET
                                lead_type = ?,
                                lead_subtypes = ?,
                                categorization_confidence = ?
                            WHERE permit_id = ? AND city = ?
                        """, (
                            result.get("type", "other"),
                            json.dumps(result.get("subtypes", [])),
                            result.get("confidence", 0.5),
                            permit_id, city
                        ))
                        categorized += 1
                conn.commit()

            logger.info(f"Categorized {min(i+batch_size, len(permits))}/{len(permits)}")

    else:
        # Process with rules (faster)
        with get_db_connection() as conn:
            for permit in permits:
                permit_id, city, description, permit_type = permit
                desc = description or permit_type

                result = categorize_with_rules(desc)

                conn.execute("""
                    UPDATE permits SET
                        lead_type = ?,
                        lead_subtypes = ?,
                        categorization_confidence = ?
                    WHERE permit_id = ? AND city = ?
                """, (
                    result["type"],
                    json.dumps(result["subtypes"]),
                    result["confidence"],
                    permit_id, city
                ))
                categorized += 1

            conn.commit()

    logger.info(f"Categorization complete: {categorized} permits")

    # Print summary
    with get_db_connection() as conn:
        cursor = conn.execute("""
            SELECT lead_type, COUNT(*) as count
            FROM permits
            WHERE lead_type IS NOT NULL
            GROUP BY lead_type
            ORDER BY count DESC
        """)
        print("\n=== Categorization Summary ===")
        for row in cursor:
            print(f"  {row[0]}: {row[1]}")


if __name__ == "__main__":
    categorize_permits()
