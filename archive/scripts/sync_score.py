#!/usr/bin/env python3
"""
Sync lead scoring script - bypasses async issues.
Run with: python3 scripts/sync_score.py --limit 500
"""
import os
import sys
import json
import time
import argparse

# Django setup
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

import requests
from clients.models import Permit, Property, ScoredLead
from clients.services.scoring_v2 import (
    should_discard, PermitData, SALES_DIRECTOR_PROMPT_V2,
    categorize_permit, get_trade_group
)


def get_enriched_data(permit):
    """Look up Property by address to get enriched CAD data."""
    prop = None
    if permit.property_address_normalized:
        prop = Property.objects.filter(
            property_address_normalized=permit.property_address_normalized
        ).first()
    if not prop and permit.property_address:
        prop = Property.objects.filter(property_address=permit.property_address).first()

    if prop:
        # Convert Decimal to float for JSON serialization
        mv = float(prop.market_value) if prop.market_value else None
        return prop.owner_name or '', mv, prop.is_absentee
    return '', None, None


def score_permits(limit=500, delay=0.15):
    api_key = os.environ.get('DEEPSEEK_API_KEY')
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY not set")
        return

    # Get unscored permits
    permits = Permit.objects.exclude(scored_lead__isnull=False).order_by('-issued_date')[:limit]
    print(f"Found {len(permits)} unscored permits")

    # Filter
    valid_permits = []
    discard_reasons = {}

    for p in permits:
        # Get enriched data from Property table
        owner_name, market_value, is_absentee = get_enriched_data(p)

        pd = PermitData(
            permit_id=str(p.id),
            property_address=p.property_address or '',
            city=p.city or '',
            permit_type=p.permit_type or '',
            project_description=p.description or '',
            issued_date=str(p.issued_date) if p.issued_date else '',
            owner_name=owner_name,
            market_value=market_value,
        )
        discard, reason = should_discard(pd)
        if discard:
            key = reason.split(":")[0]
            discard_reasons[key] = discard_reasons.get(key, 0) + 1
        else:
            valid_permits.append((p, pd))

    print(f"Valid: {len(valid_permits)}, Discarded: {len(permits) - len(valid_permits)}")
    print(f"Discard reasons: {discard_reasons}")

    if not valid_permits:
        print("No valid permits to score")
        return

    # Score
    scored = 0
    errors = 0
    tier_counts = {'A': 0, 'B': 0, 'C': 0}

    for i, (permit, pd) in enumerate(valid_permits):
        lead_data = {
            'project_description': pd.project_description,
            'permit_type': pd.permit_type,
            'owner_name': pd.owner_name,
            'market_value': pd.market_value,
            'city': pd.city,
        }
        prompt = f'Score this lead:\n\n{json.dumps(lead_data, indent=2)}'

        try:
            resp = requests.post(
                'https://api.deepseek.com/chat/completions',
                headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
                json={
                    'model': 'deepseek-chat',
                    'messages': [
                        {'role': 'system', 'content': SALES_DIRECTOR_PROMPT_V2},
                        {'role': 'user', 'content': prompt}
                    ],
                    'max_tokens': 500,
                    'temperature': 0.3
                },
                timeout=60
            )

            if resp.status_code == 200:
                data = resp.json()
                content = data['choices'][0]['message']['content']

                try:
                    result = json.loads(content)
                    score = result.get('score', 50)
                    tier = result.get('tier', 'B')
                    reasoning = result.get('reasoning', '')
                    flags = result.get('flags', [])
                    ideal = result.get('ideal_contractor', '')
                    priority = result.get('contact_priority', 'email')

                    category = categorize_permit(pd)
                    trade_group = get_trade_group(category)

                    ScoredLead.objects.update_or_create(
                        permit=permit,
                        defaults={
                            'score': score,
                            'tier': tier,
                            'category': category,
                            'trade_group': trade_group,
                            'reasoning': reasoning,
                            'flags': flags,
                            'ideal_contractor': ideal[:200] if ideal else '',
                            'contact_priority': priority,
                            'scoring_method': 'ai-sync',
                        }
                    )

                    scored += 1
                    tier_counts[tier] = tier_counts.get(tier, 0) + 1

                    if (i + 1) % 10 == 0:
                        print(f"Progress: {i+1}/{len(valid_permits)} | A:{tier_counts['A']} B:{tier_counts['B']} C:{tier_counts['C']}", flush=True)

                except json.JSONDecodeError:
                    print(f"JSON parse error for permit {permit.id}")
                    errors += 1
            else:
                print(f"API error {resp.status_code}")
                errors += 1

            time.sleep(delay)

        except Exception as e:
            print(f"Error: {e}")
            errors += 1

    print(f"\n=== RESULTS ===")
    print(f"Scored: {scored}")
    print(f"Errors: {errors}")
    print(f"Tiers: A={tier_counts['A']}, B={tier_counts['B']}, C={tier_counts['C']}")
    print(f"Total in DB: {ScoredLead.objects.count()}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=500, help='Max permits to process')
    parser.add_argument('--delay', type=float, default=0.15, help='Delay between API calls')
    args = parser.parse_args()

    score_permits(limit=args.limit, delay=args.delay)
