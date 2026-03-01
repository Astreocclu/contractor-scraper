BASE_CATEGORY_WEIGHTS = {
    'abortion': 35,
    'pornography': 30,
    'gambling': 20,
    'human_trafficking': 40,
    'embryonic_stem_cells': 25,
}

OPTIONAL_CATEGORY_WEIGHTS = {
    'alcohol': 12,
    'contraception': 10,
    'lgbtq_corporate_activism': 10,
    'tobacco': 15,
    'cannabis': 12,
    'defense': 8,
}

ALL_CATEGORY_WEIGHTS = {
    **BASE_CATEGORY_WEIGHTS,
    **OPTIONAL_CATEGORY_WEIGHTS,
}

SEVERITY_MULTIPLIERS = {
    0: 0.0,
    1: 0.25,
    2: 0.6,
    3: 1.0,
}

INVOLVEMENT_MULTIPLIERS = {
    'none': 0.0,
    'board_affiliation': 0.3,
    'corporate_donation': 0.45,
    'minor_revenue_exposure': 0.6,
    'primary_revenue_exposure': 1.0,
    'unclear': 0.2,
}

PROFILE_PRESETS = {
    'consensus': {
        'alcohol': False,
        'contraception': False,
        'lgbtq_corporate_activism': False,
        'tobacco': False,
        'cannabis': False,
        'defense': False,
    },
    'protestant_strict': {
        'alcohol': True,
        'contraception': True,
        'lgbtq_corporate_activism': True,
        'tobacco': True,
        'cannabis': True,
        'defense': False,
    },
    'catholic_permissive': {
        'alcohol': False,
        'contraception': False,
        'lgbtq_corporate_activism': True,
        'tobacco': True,
        'cannabis': True,
        'defense': False,
    },
}


def normalize_profile(profile_name='consensus', overrides=None):
    profile = PROFILE_PRESETS.get(profile_name, PROFILE_PRESETS['consensus']).copy()
    if overrides:
        for key, value in overrides.items():
            if key in profile:
                profile[key] = bool(value)
    return profile
