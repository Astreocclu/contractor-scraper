from django.test import TestCase, SimpleTestCase

from contractors.models import Contractor, ContractorVerticalRating, PairwiseComparison, Vertical
from contractors.services.leaderboard import confidence_to_score, apply_pairwise_result


class LeaderboardMathTests(SimpleTestCase):
    def test_confidence_to_score_mapping(self):
        self.assertAlmostEqual(confidence_to_score(50), 0.5, places=6)
        self.assertAlmostEqual(confidence_to_score(70), 0.6154159924725771, places=6)
        self.assertAlmostEqual(confidence_to_score(90), 0.8498758636618491, places=6)


class EloUpdateTests(TestCase):
    def test_underdog_winner_increases_rating(self):
        vertical = Vertical.objects.create(name='Roofing', slug='roofing')
        contractor_a = Contractor.objects.create(business_name='Alpha Roofing', city='Austin')
        contractor_b = Contractor.objects.create(business_name='Bravo Roofing', city='Austin')

        ContractorVerticalRating.objects.create(
            contractor=contractor_a,
            vertical=vertical,
            rating=1400,
            rating_adj=1400,
            uncertainty=350,
            comparisons_count=0,
            status='PROVISIONAL',
        )
        ContractorVerticalRating.objects.create(
            contractor=contractor_b,
            vertical=vertical,
            rating=1600,
            rating_adj=1600,
            uncertainty=350,
            comparisons_count=0,
            status='PROVISIONAL',
        )

        comparison = PairwiseComparison.objects.create(
            vertical=vertical,
            contractor_a=contractor_a,
            contractor_b=contractor_b,
            status='PENDING',
        )

        apply_pairwise_result(comparison, winner=contractor_a, confidence=70, model_version='test')

        updated_a = ContractorVerticalRating.objects.get(contractor=contractor_a, vertical=vertical)
        updated_b = ContractorVerticalRating.objects.get(contractor=contractor_b, vertical=vertical)
        comparison.refresh_from_db()

        self.assertGreater(updated_a.rating, 1400)
        self.assertLess(updated_b.rating, 1600)
        self.assertEqual(comparison.status, 'COMPLETED')
