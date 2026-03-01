import math

from django.db import transaction
from django.utils import timezone

from contractors.models import ContractorVerticalRating, PairwiseComparison, RatingHistory


def confidence_to_score(confidence):
    c = max(50.0, min(100.0, float(confidence)))
    x = (c - 50.0) / 50.0
    return 0.5 + 0.5 * (x ** 1.6)


def expected_score(rating_a, rating_b):
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))


def _k_factor(comparisons_count):
    return 40.0 if comparisons_count < 10 else 32.0


def _next_uncertainty(comparisons_count):
    return 350.0 / math.sqrt(max(1, comparisons_count))


def _status_for_count(current_status, comparisons_count):
    if current_status == 'STALE':
        return current_status
    return 'RANKED' if comparisons_count >= 10 else 'PROVISIONAL'


def apply_pairwise_result(comparison, winner, confidence, model_version=''):
    # Assumption: missing confidence defaults to neutral (50).
    if confidence is None:
        confidence = 50

    if comparison.status == 'COMPLETED':
        raise ValueError('Comparison already completed.')

    if winner not in (comparison.contractor_a, comparison.contractor_b):
        raise ValueError('Winner must be one of the comparison contractors.')

    with transaction.atomic():
        rating_a, _ = ContractorVerticalRating.objects.get_or_create(
            contractor=comparison.contractor_a,
            vertical=comparison.vertical,
            defaults={
                'rating': 1500,
                'rating_adj': 1500,
                'uncertainty': 350,
                'comparisons_count': 0,
                'status': 'PROVISIONAL',
            },
        )
        rating_b, _ = ContractorVerticalRating.objects.get_or_create(
            contractor=comparison.contractor_b,
            vertical=comparison.vertical,
            defaults={
                'rating': 1500,
                'rating_adj': 1500,
                'uncertainty': 350,
                'comparisons_count': 0,
                'status': 'PROVISIONAL',
            },
        )

        expected_a = expected_score(rating_a.rating, rating_b.rating)
        expected_b = 1.0 - expected_a
        s_winner = confidence_to_score(confidence)

        if winner == comparison.contractor_a:
            score_a = s_winner
            score_b = 1.0 - s_winner
        else:
            score_a = 1.0 - s_winner
            score_b = s_winner

        k_a = _k_factor(rating_a.comparisons_count)
        k_b = _k_factor(rating_b.comparisons_count)

        delta_a = k_a * (score_a - expected_a)
        delta_b = k_b * (score_b - expected_b)

        rating_a.rating += delta_a
        rating_b.rating += delta_b

        rating_a.comparisons_count += 1
        rating_b.comparisons_count += 1

        rating_a.uncertainty = _next_uncertainty(rating_a.comparisons_count)
        rating_b.uncertainty = _next_uncertainty(rating_b.comparisons_count)

        rating_a.rating_adj = rating_a.rating - 0.7 * rating_a.uncertainty
        rating_b.rating_adj = rating_b.rating - 0.7 * rating_b.uncertainty

        now = timezone.now()
        rating_a.last_compared_at = now
        rating_b.last_compared_at = now
        rating_a.status = _status_for_count(rating_a.status, rating_a.comparisons_count)
        rating_b.status = _status_for_count(rating_b.status, rating_b.comparisons_count)
        rating_a.save()
        rating_b.save()

        comparison.winner = winner
        comparison.confidence = int(confidence)
        comparison.s_winner = s_winner
        comparison.expected_a = expected_a
        comparison.expected_b = expected_b
        comparison.delta_a = delta_a
        comparison.delta_b = delta_b
        comparison.model_version = model_version
        comparison.status = 'COMPLETED'
        comparison.save()

        RatingHistory.objects.create(
            contractor_vertical_rating=rating_a,
            rating=rating_a.rating,
            rating_adj=rating_a.rating_adj,
            uncertainty=rating_a.uncertainty,
            comparisons_count=rating_a.comparisons_count,
            source_comparison=comparison,
        )
        RatingHistory.objects.create(
            contractor_vertical_rating=rating_b,
            rating=rating_b.rating,
            rating_adj=rating_b.rating_adj,
            uncertainty=rating_b.uncertainty,
            comparisons_count=rating_b.comparisons_count,
            source_comparison=comparison,
        )

    return comparison
