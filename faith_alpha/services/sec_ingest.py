import hashlib
import logging
import os
import re
from datetime import date
from pathlib import Path
from typing import Iterable

import requests
try:
    from bs4 import BeautifulSoup
except ImportError:  # pragma: no cover - dependency fallback
    BeautifulSoup = None

from faith_alpha.models import Company, CompanyFiling
from faith_alpha.services.http_utils import (
    rate_limited_request,
    rate_limited_json,
    get_retry_session,
    with_progress,
)

logger = logging.getLogger(__name__)

SEC_TICKER_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
SEC_SUBMISSIONS_URL = 'https://data.sec.gov/submissions/CIK{cik}.json'
SEC_ARCHIVES_URL = 'https://www.sec.gov/Archives/edgar/data/{cik_int}/{accession}/{document}'
WIKI_SP500_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies'
STOOQ_SP500_URL = 'https://stooq.com/db/l/?g=spx&i=0'

DEFAULT_FORMS = ('10-K', 'DEF 14A')

DATA_DIR = Path(__file__).resolve().parent.parent / 'data'
TOP100_TICKERS_FILE = DATA_DIR / 'sp500_top_100_tickers.txt'
SP500_TICKERS_FILE = DATA_DIR / 'sp500_tickers.txt'


class SecClientError(RuntimeError):
    pass


def _sec_headers() -> dict:
    user_agent = os.getenv('SEC_USER_AGENT', 'ChristianAlphaMVP/0.2 (founder@local)')
    return {
        'User-Agent': user_agent,
        'Accept-Encoding': 'gzip, deflate',
    }


# Shared session for SEC requests
_sec_session = None


def _get_sec_session() -> requests.Session:
    """Get or create a shared session for SEC requests with retry logic."""
    global _sec_session
    if _sec_session is None:
        _sec_session = get_retry_session(retries=3, backoff_factor=1.0)
    return _sec_session


def _sec_get_json(url: str, timeout: int = 30) -> dict:
    """Fetch JSON from SEC API with rate limiting and retry."""
    return rate_limited_json(
        api_name='sec',
        url=url,
        session=_get_sec_session(),
        timeout=timeout,
        headers=_sec_headers(),
    )


def _parse_ticker_records(payload: dict) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]

    data = payload.get('data')
    fields = payload.get('fields')
    if isinstance(data, list) and isinstance(fields, list):
        records = []
        for row in data:
            if isinstance(row, list):
                record = {fields[i]: row[i] for i in range(min(len(fields), len(row)))}
                records.append(record)
        return records

    if isinstance(payload, dict):
        records = []
        for value in payload.values():
            if isinstance(value, dict):
                records.append(value)
        if records:
            return records

    return []


def _load_tickers_from_file(path: Path) -> list[str]:
    if not path.exists():
        return []
    tickers = []
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip().upper()
        if not line or line.startswith('#'):
            continue
        tickers.append(line)
    return tickers


def _write_tickers_file(path: Path, tickers: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(tickers), encoding='utf-8')


def _normalize_ticker_symbol(symbol: str) -> str:
    normalized = symbol.strip().upper().replace('.', '-').replace(' ', '')
    return normalized


def fetch_sp500_tickers_from_wikipedia() -> list[str]:
    headers = {
        'User-Agent': 'ChristianAlphaMVP/0.2 (+founder@local)',
    }
    response = requests.get(WIKI_SP500_URL, headers=headers, timeout=30)
    response.raise_for_status()

    tickers = []
    if BeautifulSoup is not None:
        soup = BeautifulSoup(response.text, 'html.parser')
        table = soup.find('table', {'id': 'constituents'})
        if table is None:
            raise SecClientError('Failed to locate S&P 500 constituents table on Wikipedia')

        for row in table.select('tbody tr'):
            cells = row.find_all('td')
            if not cells:
                continue
            symbol = cells[0].get_text(strip=True)
            if not symbol:
                continue
            tickers.append(_normalize_ticker_symbol(symbol))
    else:
        # Fallback parser for environments without BeautifulSoup.
        rows = re.findall(r'<tr>(.*?)</tr>', response.text, flags=re.IGNORECASE | re.DOTALL)
        for row in rows:
            match = re.search(r'<td[^>]*>(.*?)</td>', row, flags=re.IGNORECASE | re.DOTALL)
            if not match:
                continue
            symbol = re.sub(r'<[^>]+>', '', match.group(1)).strip()
            if not symbol:
                continue
            tickers.append(_normalize_ticker_symbol(symbol))

    deduped = sorted(set(tickers))
    if len(deduped) < 400:
        raise SecClientError('Unexpectedly low S&P 500 ticker count from Wikipedia scrape')
    return deduped


def fetch_sp500_tickers_from_stooq() -> list[str]:
    headers = {
        'User-Agent': 'ChristianAlphaMVP/0.2 (+founder@local)',
    }
    response = requests.get(STOOQ_SP500_URL, headers=headers, timeout=30)
    response.raise_for_status()

    tickers = []
    for line in response.text.splitlines():
        symbol = line.strip().split(',')[0].strip()
        if not symbol:
            continue
        tickers.append(_normalize_ticker_symbol(symbol))

    deduped = sorted(set(tickers))
    if len(deduped) < 400:
        raise SecClientError('Unexpectedly low S&P 500 ticker count from Stooq scrape')
    return deduped


def load_seed_tickers(universe: str = 'top100') -> list[str]:
    universe = (universe or 'top100').strip().lower()

    if universe == 'top100':
        tickers = _load_tickers_from_file(TOP100_TICKERS_FILE)
        if not tickers:
            raise SecClientError(f'Seed ticker file missing: {TOP100_TICKERS_FILE}')
        return tickers

    if universe == 'sp500':
        tickers = _load_tickers_from_file(SP500_TICKERS_FILE)
        if tickers:
            return tickers

        try:
            tickers = fetch_sp500_tickers_from_wikipedia()
        except Exception:
            tickers = fetch_sp500_tickers_from_stooq()
        _write_tickers_file(SP500_TICKERS_FILE, tickers)
        return tickers

    raise SecClientError(f'Unsupported universe: {universe}')


def sync_companies_from_sec(
    limit: int = 100,
    tickers: Iterable[str] | None = None,
    universe: str = 'top100',
) -> list[Company]:
    payload = _sec_get_json(SEC_TICKER_URL)
    records = _parse_ticker_records(payload)

    by_ticker = {}
    for row in records:
        ticker = _normalize_ticker_symbol(str(row.get('ticker') or row.get('symbol') or ''))
        if ticker:
            by_ticker[ticker] = row

    requested_tickers = [_normalize_ticker_symbol(t) for t in (tickers or load_seed_tickers(universe=universe))]
    selected = requested_tickers[:limit]

    companies = []
    for rank, ticker in enumerate(selected, start=1):
        row = by_ticker.get(ticker)
        if not row:
            continue

        cik_int = row.get('cik') or row.get('cik_str') or row.get('cik_number') or ''
        try:
            cik = f"{int(cik_int):010d}"
        except (TypeError, ValueError):
            cik = ''

        company, _ = Company.objects.update_or_create(
            ticker=ticker,
            defaults={
                'cik': cik,
                'name': str(row.get('name') or row.get('title') or ticker),
                'exchange': str(row.get('exchange') or ''),
                'market_cap_rank': rank,
                'source_metadata': {
                    'sec_row': row,
                    'source': SEC_TICKER_URL,
                },
            },
        )
        companies.append(company)

    return companies


def _strip_html(raw: str) -> str:
    no_script = re.sub(r'<script[\\s\\S]*?</script>', ' ', raw, flags=re.IGNORECASE)
    no_style = re.sub(r'<style[\\s\\S]*?</style>', ' ', no_script, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', no_style)
    text = re.sub(r'\\s+', ' ', text)
    return text.strip()


def _fetch_filing_text(url: str, max_chars: int = 25000) -> str:
    """Fetch filing text from SEC EDGAR with rate limiting and retry."""
    response = rate_limited_request(
        api_name='sec',
        method='GET',
        url=url,
        session=_get_sec_session(),
        timeout=60,  # Longer timeout for large filings
        headers=_sec_headers(),
    )
    response.raise_for_status()
    text = response.text or ''
    if '<html' in text.lower():
        text = _strip_html(text)
    return text[:max_chars]


def _sector_from_sic(sic_code: str | None) -> str:
    if not sic_code:
        return ''
    try:
        code = int(sic_code)
    except (TypeError, ValueError):
        return ''

    lead = code // 100
    if 1 <= lead <= 9:
        return 'Agriculture/Forestry/Fishing'
    if 10 <= lead <= 14:
        return 'Mining'
    if 20 <= lead <= 39:
        return 'Manufacturing'
    if 40 <= lead <= 49:
        return 'Transportation/Utilities'
    if 50 <= lead <= 51:
        return 'Wholesale Trade'
    if 52 <= lead <= 59:
        return 'Retail Trade'
    if 60 <= lead <= 67:
        return 'Finance/Insurance/Real Estate'
    if 70 <= lead <= 89:
        return 'Services'
    if 91 <= lead <= 99:
        return 'Public Administration'
    return ''


def _update_company_profile_from_submission(company: Company, payload: dict) -> None:
    updated_fields = []

    sic = payload.get('sic')
    sic_description = payload.get('sicDescription')

    if sic and str(sic) != company.sic_code:
        company.sic_code = str(sic)
        updated_fields.append('sic_code')

    if sic_description and str(sic_description) != company.sic_description:
        company.sic_description = str(sic_description)
        updated_fields.append('sic_description')

    inferred_sector = _sector_from_sic(company.sic_code)
    if inferred_sector and inferred_sector != company.sector:
        company.sector = inferred_sector
        updated_fields.append('sector')

    if company.sic_description and company.sic_description != company.industry:
        company.industry = company.sic_description
        updated_fields.append('industry')

    if updated_fields:
        company.save(update_fields=updated_fields + ['updated_at'])


def sync_company_filings(
    company: Company,
    forms: Iterable[str] = DEFAULT_FORMS,
    fetch_text: bool = False,
    max_chars: int = 25000,
) -> list[CompanyFiling]:
    if not company.cik:
        return []

    form_set = {f.upper() for f in forms}
    payload = _sec_get_json(SEC_SUBMISSIONS_URL.format(cik=company.cik))
    _update_company_profile_from_submission(company=company, payload=payload)

    recent = payload.get('filings', {}).get('recent', {})

    forms_list = recent.get('form') or []
    accessions = recent.get('accessionNumber') or []
    filing_dates = recent.get('filingDate') or []
    primary_docs = recent.get('primaryDocument') or []

    latest_by_form = {}
    for idx, form in enumerate(forms_list):
        form_norm = str(form).upper()
        if form_norm not in form_set:
            continue
        if form_norm in latest_by_form:
            continue

        accession = accessions[idx] if idx < len(accessions) else ''
        filing_date = filing_dates[idx] if idx < len(filing_dates) else ''
        primary_doc = primary_docs[idx] if idx < len(primary_docs) else ''

        latest_by_form[form_norm] = {
            'accession': accession,
            'filing_date': filing_date,
            'primary_doc': primary_doc,
        }

    saved = []
    cik_int = str(int(company.cik)) if company.cik.isdigit() else company.cik.lstrip('0')

    for form, item in latest_by_form.items():
        accession = str(item.get('accession') or '').strip()
        primary_doc = str(item.get('primary_doc') or '').strip()
        if not accession:
            continue

        clean_accession = accession.replace('-', '')
        source_url = SEC_ARCHIVES_URL.format(
            cik_int=cik_int,
            accession=clean_accession,
            document=primary_doc,
        ) if primary_doc else ''

        content_text = ''
        if fetch_text and source_url:
            try:
                content_text = _fetch_filing_text(source_url, max_chars=max_chars)
            except requests.RequestException:
                content_text = ''

        filing_date_value = None
        filing_date_raw = str(item.get('filing_date') or '').strip()
        if filing_date_raw:
            try:
                filing_date_value = date.fromisoformat(filing_date_raw)
            except ValueError:
                filing_date_value = None

        defaults = {
            'filing_date': filing_date_value,
            'primary_document': primary_doc,
            'source_url': source_url,
            'content_text': content_text,
            'content_hash': hashlib.sha256(content_text.encode('utf-8')).hexdigest() if content_text else '',
            'source_metadata': {
                'source': 'sec_submissions',
            },
        }

        filing, _ = CompanyFiling.objects.update_or_create(
            company=company,
            form_type=form if form in {'10-K', 'DEF 14A'} else CompanyFiling.FORM_OTHER,
            accession_number=accession,
            defaults=defaults,
        )
        saved.append(filing)

    return saved


def run_ingestion(
    limit: int = 100,
    tickers: Iterable[str] | None = None,
    forms: Iterable[str] = DEFAULT_FORMS,
    fetch_text: bool = False,
    max_chars: int = 25000,
    universe: str = 'top100',
) -> dict:
    logger.info('Starting SEC ingestion: limit=%d, universe=%s, fetch_text=%s', limit, universe, fetch_text)

    companies = sync_companies_from_sec(limit=limit, tickers=tickers, universe=universe)
    logger.info('Synced %d companies from SEC', len(companies))

    filings_saved = 0
    log_progress = with_progress(companies, desc='Syncing filings', log_every=10)

    for idx, company in enumerate(companies):
        try:
            filings = sync_company_filings(
                company=company,
                forms=forms,
                fetch_text=fetch_text,
                max_chars=max_chars,
            )
            filings_saved += len(filings)
            log_progress(idx, company)
        except Exception as e:
            logger.error('Failed to sync filings for %s: %s', company.ticker, e)
            continue

    logger.info('Ingestion complete: %d companies, %d filings', len(companies), filings_saved)

    return {
        'companies': len(companies),
        'filings_saved': filings_saved,
        'forms': list(forms),
        'fetch_text': fetch_text,
        'universe': universe,
    }
