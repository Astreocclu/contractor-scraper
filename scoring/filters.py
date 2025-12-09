"""Hard filters to discard junk leads before AI scoring."""

PRODUCTION_BUILDERS = {
    'lennar', 'dr horton', 'd.r. horton', 'pulte', 'perry homes',
    'meritage', 'toll brothers', 'kb home', 'taylor morrison',
    'ashton woods', 'highland homes', 'david weekley', 'tri pointe',
    'beazer', 'm/i homes', 'century communities', 'gehan', 'chesmar',
    'coventry', 'first texas', 'megatel', 'bloomfield', 'impression',
    'shaddock', 'grand homes', 'partners in building'
}

JUNK_CATEGORIES = {
    'shed', 'electrical_service', 'water_heater', 'fire_repair',
    'foundation_repair', 'demolition', 'mechanical'
}


def should_discard(lead: dict) -> tuple[bool, str]:
    """Returns (should_discard, reason)."""

    # Check owner name for builders
    owner = (lead.get('owner_name') or '').lower()
    for builder in PRODUCTION_BUILDERS:
        if builder in owner:
            return True, f"Production builder: {builder}"

    # Check project description for hidden builders (CRITICAL - builders hide here)
    project = (lead.get('project_description') or '').lower()
    for builder in PRODUCTION_BUILDERS:
        if builder in project:
            return True, f"Builder in project desc: {builder}"

    # Check category
    category = lead.get('category', '').lower()
    if category in JUNK_CATEGORIES:
        return True, f"Junk category: {category}"

    # Check age (90 day universal cutoff)
    days_old = lead.get('days_old', 0)
    if days_old > 90:
        return True, f"Too old: {days_old} days"

    # Check for completely empty leads
    if owner in ('unknown', '') and lead.get('market_value', 0) == 0:
        return True, "No owner AND no property value"

    return False, None


def get_freshness_penalty(category: str, days_old: int) -> int:
    """Return negative adjustment for stale leads."""
    thresholds = {
        'roof': 14,
        'mechanical': 7,
        'pool': 90,
        'outdoor_living': 45,
        'fence': 45,
    }
    max_age = thresholds.get(category, 60)

    if days_old > max_age:
        return -15
    elif days_old > max_age * 0.7:
        return -5
    return 0
