import logging
import os
import re
from decimal import Decimal, InvalidOperation
from typing import Any

import requests
from django.conf import settings

from faith_alpha.models import Company, CompanySignal
from faith_alpha.services.http_utils import (
    rate_limited_json,
    get_retry_session,
)

logger = logging.getLogger(__name__)


class ExternalSignalSyncService:
    FEC_BASE_URL = 'https://api.open.fec.gov/v1'
    LDA_BASE_URL = 'https://lda.senate.gov/api/v1'

    def __init__(self, session: requests.Session | None = None):
        self.session = session or get_retry_session(retries=3, backoff_factor=1.0)
        self.fec_api_key = getattr(settings, 'FEC_API_KEY', None) or os.getenv('FEC_API_KEY')
        self.lda_api_key = getattr(settings, 'LDA_API_KEY', None) or os.getenv('LDA_API_KEY')

    def sync_company(self, company: Company, cycle: int = 2024, filing_year: int = 2024, limit: int = 5) -> dict[str, int]:
        counts = {'fec': 0, 'lda': 0}

        if self.fec_api_key:
            try:
                counts['fec'] = self._sync_fec(company=company, cycle=cycle, limit=limit)
            except requests.RequestException as exc:
                logger.warning('FEC sync failed for %s: %s', company.ticker, exc)
        else:
            logger.info('Skipping FEC sync for %s because FEC_API_KEY is missing', company.ticker)

        try:
            counts['lda'] = self._sync_lda(company=company, filing_year=filing_year, limit=limit)
        except requests.RequestException as exc:
            logger.warning('LDA sync failed for %s: %s', company.ticker, exc)

        return counts

    def _sync_fec(self, company: Company, cycle: int, limit: int) -> int:
        query = self._normalized_query_name(company.name)
        params = {
            'api_key': self.fec_api_key,
            'q': f'{query} PAC',
            'committee_type': 'Q',
            'per_page': max(1, min(limit, 20)),
            'sort': '-name',
        }
        payload = self._get_json(f'{self.FEC_BASE_URL}/committees/', params=params, headers={}, api_name='fec')
        committees = payload.get('results', [])
        created = 0

        for committee in committees[:limit]:
            committee_id = str(committee.get('committee_id') or '').strip()
            if not committee_id:
                continue

            totals = self._fetch_fec_totals(committee_id=committee_id, cycle=cycle)
            disbursements = self._to_decimal(totals.get('disbursements'))
            receipts = self._to_decimal(totals.get('receipts'))

            evidence = (
                f"FEC committee {committee.get('name', '')} reported "
                f"disbursements={disbursements or Decimal('0')} and receipts={receipts or Decimal('0')} "
                f"for cycle {cycle}."
            )

            self._upsert_signal(
                company=company,
                source=CompanySignal.SOURCE_FEC,
                signal_type='pac_disbursements',
                external_id=f'{committee_id}:{cycle}',
                title=str(committee.get('name') or committee_id),
                amount_usd=disbursements,
                cycle_or_year=cycle,
                evidence_text=evidence,
                metadata={
                    'committee': committee,
                    'totals': totals,
                },
            )
            created += 1

        return created

    def _fetch_fec_totals(self, committee_id: str, cycle: int) -> dict[str, Any]:
        params = {
            'api_key': self.fec_api_key,
            'cycle': cycle,
            'per_page': 1,
        }
        payload = self._get_json(
            f'{self.FEC_BASE_URL}/committee/{committee_id}/totals/',
            params=params,
            headers={},
            api_name='fec',
        )
        results = payload.get('results', [])
        if not results:
            return {}
        return results[0]

    def _sync_lda(self, company: Company, filing_year: int, limit: int) -> int:
        params = {
            'client_name': company.name,
            'filing_year': filing_year,
            'page_size': max(1, min(limit, 50)),
        }
        headers = {
            'Accept': 'application/json',
            'User-Agent': 'ChristianAlphaMVP/0.2 founder@local',
        }
        if self.lda_api_key:
            headers['Authorization'] = f'Token {self.lda_api_key}'

        payload = self._get_json(f'{self.LDA_BASE_URL}/filings/', params=params, headers=headers, api_name='lda')
        filings = payload.get('results', [])
        created = 0

        for filing in filings[:limit]:
            filing_id = str(
                filing.get('filing_uuid')
                or filing.get('filing_id')
                or filing.get('id')
                or ''
            ).strip()
            if not filing_id:
                continue

            client_name = self._safe_get(filing, 'client', 'name') or filing.get('client_name') or company.name
            registrant_name = self._safe_get(filing, 'registrant', 'name') or filing.get('registrant_name') or ''
            income = self._to_decimal(
                filing.get('income')
                or filing.get('income_amount')
                or filing.get('amount')
                or filing.get('lobbying_income')
            )
            issues = filing.get('specific_issues') or filing.get('general_issue_code_display') or ''
            if isinstance(issues, list):
                issues = '; '.join(str(i) for i in issues[:3])

            cycle_or_year = filing.get('filing_year') or filing_year
            try:
                cycle_or_year = int(cycle_or_year)
            except (TypeError, ValueError):
                cycle_or_year = filing_year

            evidence = (
                f"LDA filing for client '{client_name}' using registrant '{registrant_name}'. "
                f"Reported income={income or Decimal('0')} in {cycle_or_year}. "
                f"Issues: {issues}".strip()
            )

            self._upsert_signal(
                company=company,
                source=CompanySignal.SOURCE_LDA,
                signal_type='lobbying_activity',
                external_id=filing_id,
                title=f"Lobbying filing {filing_id}",
                amount_usd=income,
                cycle_or_year=cycle_or_year,
                evidence_text=evidence,
                metadata={
                    'filing': filing,
                },
            )
            created += 1

        return created

    def _upsert_signal(
        self,
        company: Company,
        source: str,
        signal_type: str,
        external_id: str,
        title: str,
        amount_usd: Decimal | None,
        cycle_or_year: int | None,
        evidence_text: str,
        metadata: dict[str, Any],
    ) -> CompanySignal:
        signal, _ = CompanySignal.objects.update_or_create(
            company=company,
            source=source,
            signal_type=signal_type,
            external_id=external_id,
            defaults={
                'title': title[:255],
                'amount_usd': amount_usd,
                'cycle_or_year': cycle_or_year,
                'evidence_text': evidence_text[:2000],
                'metadata': metadata,
            },
        )
        return signal

    def _get_json(
        self,
        url: str,
        params: dict[str, Any],
        headers: dict[str, str],
        api_name: str = 'default',
    ) -> dict[str, Any]:
        """Fetch JSON with rate limiting and retry logic."""
        return rate_limited_json(
            api_name=api_name,
            url=url,
            session=self.session,
            timeout=30,
            params=params,
            headers=headers,
        )

    @staticmethod
    def _to_decimal(value: Any) -> Decimal | None:
        if value is None or value == '':
            return None
        try:
            if isinstance(value, str):
                cleaned = re.sub(r'[^0-9.\-]', '', value)
                if cleaned == '':
                    return None
                return Decimal(cleaned)
            return Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            return None

    @staticmethod
    def _normalized_query_name(name: str) -> str:
        cleaned = re.sub(r'\b(inc|inc\.|corp|corporation|co|co\.|llc|ltd|plc)\b', '', name, flags=re.IGNORECASE)
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        return cleaned or name

    @staticmethod
    def _safe_get(payload: dict[str, Any], parent_key: str, child_key: str) -> Any:
        parent = payload.get(parent_key)
        if isinstance(parent, dict):
            return parent.get(child_key)
        return None
