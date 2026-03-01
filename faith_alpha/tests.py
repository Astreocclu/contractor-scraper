from django.test import TestCase
from rest_framework.test import APIClient

from faith_alpha.models import Company, CompanyFiling, CompanySignal, FaithScreen
from faith_alpha.services.classifier import FaithClassifier
from faith_alpha.services.optimizer import PortfolioOptimizer
from faith_alpha.services.pipeline import score_company
from faith_alpha.services.policy_signals import ExternalSignalSyncService
from faith_alpha.services.scoring import compute_faith_alignment


class FaithScoringTests(TestCase):
    def test_base_consensus_deductions_reduce_score(self):
        findings = {
            'abortion': {'severity': 3, 'involvement': 'primary_revenue_exposure', 'confidence': 90},
            'gambling': {'severity': 2, 'involvement': 'minor_revenue_exposure', 'confidence': 80},
        }

        breakdown = compute_faith_alignment(findings, profile_name='consensus')

        self.assertLess(breakdown.alignment_score, 100)
        self.assertLess(breakdown.base_score, 100)
        self.assertGreaterEqual(breakdown.confidence_score, 70)

    def test_optional_category_toggles_change_score(self):
        findings = {
            'alcohol': {'severity': 3, 'involvement': 'primary_revenue_exposure', 'confidence': 70},
        }

        base = compute_faith_alignment(findings, profile_name='consensus')
        strict = compute_faith_alignment(findings, profile_name='protestant_strict')

        self.assertEqual(base.alignment_score, 100)
        self.assertLess(strict.alignment_score, base.alignment_score)


class FaithClassifierTests(TestCase):
    def test_keyword_fallback_detects_gambling(self):
        classifier = FaithClassifier()

        result = classifier.classify(
            company_name='Acme Gaming',
            ticker='ACME',
            text_chunks=['The company runs a casino and online betting products.'],
            use_llm=False,
        )

        self.assertEqual(result['method'], 'keyword_fallback')
        self.assertEqual(result['categories']['gambling']['severity'], 3)


class FaithApiTests(TestCase):
    def test_company_list_returns_faith_score(self):
        company = Company.objects.create(ticker='AAPL', name='Apple Inc.', cik='0000320193')
        FaithScreen.objects.create(
            company=company,
            alignment_score=88,
            base_score=90,
            confidence_score=76,
            raw_classification={
                'categories': {
                    'alcohol': {
                        'severity': 3,
                        'involvement': 'primary_revenue_exposure',
                        'confidence': 75,
                        'evidence': ['beer'],
                    }
                }
            },
        )

        client = APIClient()
        response = client.get('/api/faith/companies/?profile=protestant_strict')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 1)
        row = response.data['results'][0]
        self.assertEqual(row['ticker'], 'AAPL')
        self.assertIn('faith_screen', row)
        self.assertIn('scenario', row['faith_screen'])

    def test_stats_exposes_signal_coverage(self):
        company = Company.objects.create(ticker='AAPL', name='Apple Inc.', cik='0000320193')
        FaithScreen.objects.create(company=company, alignment_score=80, base_score=85, confidence_score=70)
        CompanySignal.objects.create(
            company=company,
            source='lda',
            signal_type='lobbying_activity',
            external_id='f1',
            title='LDA',
            cycle_or_year=2024,
        )

        client = APIClient()
        response = client.get('/api/faith/companies/stats/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('signal_coverage', response.data)
        self.assertGreaterEqual(response.data['signal_coverage']['lda_companies'], 1)


class ExternalSignalSyncTests(TestCase):
    def test_sync_company_stores_fec_and_lda_signals(self):
        company = Company.objects.create(ticker='AAPL', name='Apple Inc.', cik='0000320193')
        service = ExternalSignalSyncService()
        service.fec_api_key = 'test'

        def fake_get_json(url, params, headers):
            if url.endswith('/committees/'):
                return {
                    'results': [
                        {'committee_id': 'C123', 'name': 'APPLE INC PAC'},
                    ]
                }
            if '/committee/C123/totals/' in url:
                return {
                    'results': [
                        {'disbursements': '120000', 'receipts': '150000'},
                    ]
                }
            if url.endswith('/filings/'):
                return {
                    'results': [
                        {
                            'filing_uuid': 'FILING-001',
                            'client': {'name': 'Apple Inc.'},
                            'registrant': {'name': 'Lobby Group'},
                            'income': '$420000',
                            'filing_year': 2024,
                            'specific_issues': 'Tax and trade policy',
                        }
                    ]
                }
            raise AssertionError(f'Unexpected URL: {url}')

        service._get_json = fake_get_json
        counts = service.sync_company(company=company, cycle=2024, filing_year=2024, limit=3)

        self.assertEqual(counts['fec'], 1)
        self.assertEqual(counts['lda'], 1)
        self.assertEqual(CompanySignal.objects.filter(company=company).count(), 2)
        self.assertTrue(CompanySignal.objects.filter(company=company, source='fec').exists())
        self.assertTrue(CompanySignal.objects.filter(company=company, source='lda').exists())


class FaithPipelineSignalTests(TestCase):
    def test_score_uses_filing_and_signal_evidence(self):
        company = Company.objects.create(ticker='BETZ', name='Betting Co', cik='0000000001')
        CompanyFiling.objects.create(
            company=company,
            form_type='10-K',
            accession_number='0000001-24-000001',
            source_url='https://example.com/filing',
            content_text='Our core products include online betting and casino operations.',
        )
        CompanySignal.objects.create(
            company=company,
            source='lda',
            signal_type='lobbying_activity',
            external_id='LDA-1',
            title='Lobbying filing',
            evidence_text='Engaged in sports betting market access lobbying.',
            cycle_or_year=2024,
        )

        screen = score_company(company=company, use_llm=False, profile_name='consensus')

        self.assertLess(screen.alignment_score, 100)
        self.assertEqual(screen.raw_classification['method'], 'keyword_fallback')
        self.assertEqual(screen.raw_classification['categories']['gambling']['severity'], 3)

    def test_company_detail_includes_signals(self):
        company = Company.objects.create(ticker='AAPL', name='Apple Inc.', cik='0000320193')
        FaithScreen.objects.create(company=company, alignment_score=91, base_score=95, confidence_score=80)
        CompanySignal.objects.create(
            company=company,
            source='fec',
            signal_type='pac_disbursements',
            external_id='C123:2024',
            title='APPLE INC PAC',
            amount_usd='1000.00',
            cycle_or_year=2024,
            evidence_text='FEC committee report.',
        )

        client = APIClient()
        response = client.get('/api/faith/companies/AAPL/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('signals', response.data)
        self.assertEqual(len(response.data['signals']), 1)


class PortfolioOptimizerTests(TestCase):
    def setUp(self):
        companies = [
            ('AAPL', 'Apple Inc.', 'Manufacturing', 1, 95),
            ('MSFT', 'Microsoft Corp.', 'Services', 2, 93),
            ('JPM', 'JPMorgan Chase', 'Finance/Insurance/Real Estate', 3, 89),
            ('PG', 'Procter & Gamble', 'Manufacturing', 4, 88),
            ('V', 'Visa Inc.', 'Finance/Insurance/Real Estate', 5, 92),
            ('NVDA', 'NVIDIA Corp.', 'Manufacturing', 6, 90),
        ]
        for ticker, name, sector, rank, score in companies:
            company = Company.objects.create(
                ticker=ticker,
                name=name,
                sector=sector,
                market_cap_rank=rank,
                cik='0000000001',
            )
            CompanyFiling.objects.create(
                company=company,
                form_type='10-K',
                accession_number=f'{ticker}-10k',
                source_url='https://example.com',
                content_text='Strong operating income and free cash flow with improved gross margin.',
            )
            FaithScreen.objects.create(
                company=company,
                alignment_score=score,
                base_score=score,
                confidence_score=80,
                raw_classification={'categories': {}},
            )

    def test_optimizer_returns_normalized_weights(self):
        companies = list(
            Company.objects.filter(faith_screen__isnull=False)
            .select_related('faith_screen')
            .prefetch_related('filings', 'signals')
        )
        optimizer = PortfolioOptimizer()
        result = optimizer.build_portfolio(
            companies=companies,
            min_alignment_score=85,
            profile_name='consensus',
            risk_tolerance='moderate',
            max_holdings=5,
        )

        self.assertIn('holdings', result)
        self.assertGreater(len(result['holdings']), 0)

        total_weight = sum(h['weight'] for h in result['holdings'])
        self.assertAlmostEqual(total_weight, 1.0, places=5)
        self.assertTrue(all(h['alignment_score'] >= 85 for h in result['holdings']))

    def test_portfolio_endpoint_returns_recommendation(self):
        client = APIClient()
        response = client.post(
            '/api/faith/companies/portfolio/',
            {
                'profile': 'consensus',
                'risk_tolerance': 'conservative',
                'min_alignment_score': 85,
                'max_holdings': 4,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('summary', response.data)
        self.assertIn('holdings', response.data)
        self.assertGreater(len(response.data['holdings']), 0)
