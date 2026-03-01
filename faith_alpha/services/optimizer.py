from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from math import sqrt
from typing import Any

from faith_alpha.models import Company
from faith_alpha.services.scoring import compute_faith_alignment, normalize_profile


RISK_PROFILES = {
    'conservative': {
        'max_weight': 0.08,
        'quality_alpha': 1.5,
        'target_holdings': 30,
    },
    'moderate': {
        'max_weight': 0.12,
        'quality_alpha': 1.3,
        'target_holdings': 22,
    },
    'aggressive': {
        'max_weight': 0.18,
        'quality_alpha': 1.1,
        'target_holdings': 16,
    },
}

POSITIVE_PROFITABILITY_TERMS = [
    'operating income',
    'free cash flow',
    'gross margin',
    'return on equity',
    'profit margin',
    'share repurchase',
]

NEGATIVE_PROFITABILITY_TERMS = [
    'net loss',
    'operating loss',
    'impairment charge',
    'going concern',
    'restructuring charge',
]


@dataclass
class Candidate:
    company: Company
    sector: str
    alignment_score: int
    base_score: int
    confidence_score: int
    quality_score: float
    benchmark_weight: float


class PortfolioOptimizer:
    def build_portfolio(
        self,
        companies: list[Company],
        min_alignment_score: int = 70,
        profile_name: str = 'consensus',
        profile_overrides: dict[str, bool] | None = None,
        risk_tolerance: str = 'moderate',
        max_holdings: int = 25,
    ) -> dict[str, Any]:
        if not companies:
            return {
                'holdings': [],
                'summary': {
                    'message': 'No scored companies available.',
                },
            }

        risk_key = risk_tolerance if risk_tolerance in RISK_PROFILES else 'moderate'
        risk_config = RISK_PROFILES[risk_key]

        normalized_profile = normalize_profile(profile_name=profile_name, overrides=profile_overrides)

        universe_candidates = self._build_candidates(
            companies=companies,
            profile_name=profile_name,
            profile_overrides=profile_overrides,
        )
        if not universe_candidates:
            return {
                'holdings': [],
                'summary': {
                    'message': 'No candidates with faith screens available.',
                },
            }

        eligible = [c for c in universe_candidates if c.alignment_score >= min_alignment_score]
        if not eligible:
            return {
                'holdings': [],
                'summary': {
                    'message': 'No companies pass the selected faith threshold.',
                    'min_alignment_score': min_alignment_score,
                },
            }

        target_holdings = min(max_holdings, max(5, risk_config['target_holdings']))
        eligible = sorted(eligible, key=lambda c: (c.quality_score, c.alignment_score), reverse=True)

        selected = self._select_with_sector_balance(
            eligible=eligible,
            benchmark_targets=self._sector_targets(universe_candidates),
            target_holdings=min(target_holdings, len(eligible)),
        )

        benchmark_targets = self._sector_targets(universe_candidates)
        sector_allocations = self._allocate_by_sector(
            selected=selected,
            benchmark_targets=benchmark_targets,
        )

        weights = self._allocate_within_sector(
            selected=selected,
            sector_allocations=sector_allocations,
            alpha=risk_config['quality_alpha'],
        )

        feasible_max_weight = max(risk_config['max_weight'], 1.0 / max(1, len(selected)))
        weights = self._cap_and_redistribute(weights, max_weight=feasible_max_weight)
        weights = self._normalize(weights)

        sector_actual = self._sector_actual_weights(selected=selected, weights=weights)
        tracking_error_proxy = self._tracking_error_proxy(benchmark_targets, sector_actual)

        holdings = []
        for candidate in sorted(selected, key=lambda c: weights.get(c.company.ticker, 0.0), reverse=True):
            ticker = candidate.company.ticker
            weight = weights.get(ticker, 0.0)
            if weight <= 0:
                continue
            holdings.append(
                {
                    'ticker': ticker,
                    'name': candidate.company.name,
                    'sector': candidate.sector,
                    'weight': round(weight, 6),
                    'alignment_score': candidate.alignment_score,
                    'base_score': candidate.base_score,
                    'confidence_score': candidate.confidence_score,
                    'quality_score': round(candidate.quality_score, 2),
                    'rationale': self._holding_rationale(candidate.company),
                }
            )

        weighted_alignment = sum(h['weight'] * h['alignment_score'] for h in holdings)
        weighted_confidence = sum(h['weight'] * h['confidence_score'] for h in holdings)

        sector_summary = []
        for sector in sorted(set(benchmark_targets.keys()) | set(sector_actual.keys())):
            sector_summary.append(
                {
                    'sector': sector,
                    'benchmark_weight': round(benchmark_targets.get(sector, 0.0), 6),
                    'portfolio_weight': round(sector_actual.get(sector, 0.0), 6),
                    'difference': round(sector_actual.get(sector, 0.0) - benchmark_targets.get(sector, 0.0), 6),
                }
            )

        return {
            'profile': profile_name,
            'risk_tolerance': risk_key,
            'settings': {
                'min_alignment_score': min_alignment_score,
                'max_holdings': max_holdings,
                'max_weight_effective': round(feasible_max_weight, 6),
                'profile_toggles': normalized_profile,
            },
            'summary': {
                'universe_count': len(universe_candidates),
                'eligible_count': len(eligible),
                'selected_count': len(holdings),
                'weighted_alignment_score': round(weighted_alignment, 2),
                'weighted_confidence_score': round(weighted_confidence, 2),
                'tracking_error_proxy': round(tracking_error_proxy, 6),
            },
            'sector_summary': sector_summary,
            'holdings': holdings,
        }

    def _build_candidates(
        self,
        companies: list[Company],
        profile_name: str,
        profile_overrides: dict[str, bool] | None,
    ) -> list[Candidate]:
        candidates = []

        for company in companies:
            screen = getattr(company, 'faith_screen', None)
            if screen is None:
                continue

            categories = {}
            if isinstance(screen.raw_classification, dict):
                categories = screen.raw_classification.get('categories', {}) or {}

            if categories:
                breakdown = compute_faith_alignment(
                    category_findings=categories,
                    profile_name=profile_name,
                    profile_overrides=profile_overrides,
                )
                alignment_score = breakdown.alignment_score
                base_score = breakdown.base_score
                confidence_score = breakdown.confidence_score
            else:
                alignment_score = int(screen.alignment_score)
                base_score = int(screen.base_score)
                confidence_score = int(screen.confidence_score)

            sector = company.sector or 'Unknown'
            benchmark_weight = self._benchmark_weight(company)
            quality_score = self._quality_score(
                company=company,
                alignment_score=alignment_score,
                confidence_score=confidence_score,
            )

            candidates.append(
                Candidate(
                    company=company,
                    sector=sector,
                    alignment_score=alignment_score,
                    base_score=base_score,
                    confidence_score=confidence_score,
                    quality_score=quality_score,
                    benchmark_weight=benchmark_weight,
                )
            )

        return candidates

    def _benchmark_weight(self, company: Company) -> float:
        rank = company.market_cap_rank or 500
        try:
            rank_num = max(1, int(rank))
        except (TypeError, ValueError):
            rank_num = 500
        return 1.0 / sqrt(rank_num)

    def _quality_score(self, company: Company, alignment_score: int, confidence_score: int) -> float:
        filing_text = ' '.join(
            (f.content_text or '')[:8000]
            for f in company.filings.order_by('-filing_date')[:2]
        ).lower()

        positive_hits = sum(filing_text.count(term) for term in POSITIVE_PROFITABILITY_TERMS)
        negative_hits = sum(filing_text.count(term) for term in NEGATIVE_PROFITABILITY_TERMS)

        profitability_signal = max(0.0, min(100.0, 50.0 + positive_hits * 8.0 - negative_hits * 10.0))

        rank = company.market_cap_rank or 500
        try:
            rank_num = max(1, int(rank))
        except (TypeError, ValueError):
            rank_num = 500

        stability_signal = max(0.0, min(100.0, 100.0 - (rank_num - 1) * 0.2))

        score = (
            alignment_score * 0.45
            + confidence_score * 0.25
            + profitability_signal * 0.2
            + stability_signal * 0.1
        )
        return max(0.0, min(100.0, score))

    def _sector_targets(self, candidates: list[Candidate]) -> dict[str, float]:
        sector_totals = defaultdict(float)
        total = 0.0

        for candidate in candidates:
            sector_totals[candidate.sector] += candidate.benchmark_weight
            total += candidate.benchmark_weight

        if total <= 0:
            return {'Unknown': 1.0}

        return {sector: value / total for sector, value in sector_totals.items()}

    def _select_with_sector_balance(
        self,
        eligible: list[Candidate],
        benchmark_targets: dict[str, float],
        target_holdings: int,
    ) -> list[Candidate]:
        by_sector = defaultdict(list)
        for candidate in eligible:
            by_sector[candidate.sector].append(candidate)

        selected = []
        sector_quota = {}
        for sector, target in benchmark_targets.items():
            if sector not in by_sector:
                continue
            quota = max(1, int(round(target * target_holdings)))
            sector_quota[sector] = min(quota, len(by_sector[sector]))

        for sector, quota in sector_quota.items():
            selected.extend(by_sector[sector][:quota])

        if len(selected) < target_holdings:
            existing = {c.company.ticker for c in selected}
            for candidate in eligible:
                if candidate.company.ticker in existing:
                    continue
                selected.append(candidate)
                existing.add(candidate.company.ticker)
                if len(selected) >= target_holdings:
                    break

        return selected[:target_holdings]

    def _allocate_by_sector(self, selected: list[Candidate], benchmark_targets: dict[str, float]) -> dict[str, float]:
        sectors_present = {candidate.sector for candidate in selected}
        allocations = {sector: weight for sector, weight in benchmark_targets.items() if sector in sectors_present}

        allocated = sum(allocations.values())
        if allocated <= 0:
            equal = 1.0 / max(1, len(sectors_present))
            return {sector: equal for sector in sectors_present}

        if allocated < 1.0:
            remainder = 1.0 - allocated
            for sector in allocations.keys():
                allocations[sector] += remainder * (allocations[sector] / allocated)

        normalized_total = sum(allocations.values())
        return {sector: weight / normalized_total for sector, weight in allocations.items()}

    def _allocate_within_sector(
        self,
        selected: list[Candidate],
        sector_allocations: dict[str, float],
        alpha: float,
    ) -> dict[str, float]:
        by_sector = defaultdict(list)
        for candidate in selected:
            by_sector[candidate.sector].append(candidate)

        weights = {}
        for sector, candidates in by_sector.items():
            sector_weight = sector_allocations.get(sector, 0.0)
            if sector_weight <= 0:
                continue

            scores = [max(0.01, candidate.quality_score) ** alpha for candidate in candidates]
            total_score = sum(scores)
            if total_score <= 0:
                equal = sector_weight / len(candidates)
                for candidate in candidates:
                    weights[candidate.company.ticker] = equal
                continue

            for candidate, score in zip(candidates, scores):
                weights[candidate.company.ticker] = sector_weight * (score / total_score)

        return weights

    def _cap_and_redistribute(self, weights: dict[str, float], max_weight: float) -> dict[str, float]:
        weights = dict(weights)
        for _ in range(15):
            overweight = {ticker: w for ticker, w in weights.items() if w > max_weight}
            if not overweight:
                break

            excess = sum(w - max_weight for w in overweight.values())
            for ticker in overweight.keys():
                weights[ticker] = max_weight

            underweight = [ticker for ticker, w in weights.items() if w < max_weight - 1e-9]
            total_under = sum(weights[ticker] for ticker in underweight)
            if not underweight or total_under <= 0:
                equal_boost = excess / max(1, len(underweight))
                for ticker in underweight:
                    weights[ticker] += equal_boost
                continue

            for ticker in underweight:
                proportion = weights[ticker] / total_under
                weights[ticker] += excess * proportion

        return weights

    def _normalize(self, weights: dict[str, float]) -> dict[str, float]:
        total = sum(weights.values())
        if total <= 0:
            return weights
        return {ticker: w / total for ticker, w in weights.items()}

    def _sector_actual_weights(self, selected: list[Candidate], weights: dict[str, float]) -> dict[str, float]:
        by_sector = defaultdict(float)
        for candidate in selected:
            by_sector[candidate.sector] += weights.get(candidate.company.ticker, 0.0)
        return dict(by_sector)

    def _tracking_error_proxy(self, benchmark_targets: dict[str, float], sector_actual: dict[str, float]) -> float:
        sectors = set(benchmark_targets.keys()) | set(sector_actual.keys())
        return sqrt(
            sum((sector_actual.get(sector, 0.0) - benchmark_targets.get(sector, 0.0)) ** 2 for sector in sectors)
        )

    def _holding_rationale(self, company: Company) -> str:
        screen = getattr(company, 'faith_screen', None)
        categories = {}
        if screen and isinstance(screen.raw_classification, dict):
            categories = screen.raw_classification.get('categories', {}) or {}

        red_flags = []
        for category, finding in categories.items():
            if not isinstance(finding, dict):
                continue
            severity = int(finding.get('severity', 0) or 0)
            if severity >= 2:
                red_flags.append(category)

        if red_flags:
            return f"Include with caution: elevated exposure in {', '.join(red_flags[:3])}."
        return 'Selected for strong score under current faith screen and sector allocation constraints.'
