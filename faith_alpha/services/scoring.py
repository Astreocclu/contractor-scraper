from dataclasses import dataclass
from typing import Dict, Any

from .constants import (
    ALL_CATEGORY_WEIGHTS,
    BASE_CATEGORY_WEIGHTS,
    OPTIONAL_CATEGORY_WEIGHTS,
    SEVERITY_MULTIPLIERS,
    INVOLVEMENT_MULTIPLIERS,
    normalize_profile,
)


@dataclass
class FaithScoreBreakdown:
    alignment_score: int
    base_score: int
    confidence_score: int
    deductions: Dict[str, float]
    included_optional_categories: Dict[str, bool]


def _safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_finding(finding: Dict[str, Any]) -> Dict[str, Any]:
    severity = _safe_int(finding.get('severity', 0))
    if severity < 0:
        severity = 0
    if severity > 3:
        severity = 3

    involvement = str(finding.get('involvement', 'none')).strip().lower()
    if involvement not in INVOLVEMENT_MULTIPLIERS:
        involvement = 'unclear' if severity > 0 else 'none'

    confidence = _safe_int(finding.get('confidence', 70))
    if confidence < 0:
        confidence = 0
    if confidence > 100:
        confidence = 100

    return {
        'severity': severity,
        'involvement': involvement,
        'confidence': confidence,
        'evidence': finding.get('evidence', []),
    }


def compute_faith_alignment(
    category_findings: Dict[str, Dict[str, Any]],
    profile_name: str = 'consensus',
    profile_overrides: Dict[str, bool] | None = None,
) -> FaithScoreBreakdown:
    profile = normalize_profile(profile_name=profile_name, overrides=profile_overrides)

    deductions: Dict[str, float] = {}
    confidence_points = []

    for category, weight in ALL_CATEGORY_WEIGHTS.items():
        finding = _normalize_finding(category_findings.get(category, {}))
        include_optional = category in BASE_CATEGORY_WEIGHTS or profile.get(category, False)

        if not include_optional:
            deductions[category] = 0.0
            confidence_points.append(finding['confidence'])
            continue

        severity_mult = SEVERITY_MULTIPLIERS.get(finding['severity'], 0.0)
        involvement_mult = INVOLVEMENT_MULTIPLIERS.get(finding['involvement'], 0.0)
        raw_deduction = weight * max(severity_mult, involvement_mult)
        deductions[category] = round(raw_deduction, 2)
        confidence_points.append(finding['confidence'])

    total_deduction = sum(deductions.values())
    alignment_score = max(0, min(100, int(round(100 - total_deduction))))

    base_deduction = sum(deductions[c] for c in BASE_CATEGORY_WEIGHTS.keys())
    base_score = max(0, min(100, int(round(100 - base_deduction))))

    if confidence_points:
        confidence_score = int(round(sum(confidence_points) / len(confidence_points)))
    else:
        confidence_score = 0

    return FaithScoreBreakdown(
        alignment_score=alignment_score,
        base_score=base_score,
        confidence_score=confidence_score,
        deductions=deductions,
        included_optional_categories={k: bool(v) for k, v in profile.items()},
    )


def parse_profile_overrides_from_query(params):
    overrides = {}
    for category in OPTIONAL_CATEGORY_WEIGHTS.keys():
        raw = params.get(category)
        if raw is None:
            continue
        lowered = str(raw).strip().lower()
        overrides[category] = lowered in {'1', 'true', 'yes', 'on'}
    return overrides
