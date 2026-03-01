from typing import Iterable

from faith_alpha.models import Company, CompanySignal, FaithScreen
from faith_alpha.services.classifier import CATEGORY_KEYWORDS, FaithClassifier
from faith_alpha.services.constants import BASE_CATEGORY_WEIGHTS
from faith_alpha.services.scoring import compute_faith_alignment


def _extract_keyword_snippets(text: str, window: int = 140) -> list[str]:
    lowered = text.lower()
    snippets = []
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            idx = lowered.find(keyword)
            if idx == -1:
                continue
            start = max(0, idx - window)
            end = min(len(text), idx + len(keyword) + window)
            snippet = text[start:end].strip().replace('\\n', ' ')
            if snippet and snippet not in snippets:
                snippets.append(f"[{category}] {snippet}")
            if len(snippets) >= 12:
                return snippets
    return snippets


def _build_text_chunks(company: Company) -> list[str]:
    chunks = []

    if company.sector or company.industry:
        chunks.append(f"Sector: {company.sector}. Industry: {company.industry}.")

    for filing in company.filings.order_by('-filing_date')[:3]:
        header = f"{filing.form_type} {filing.filing_date or ''}"
        body = filing.content_text or ''
        if not body:
            body = filing.primary_document or ''
        chunks.append(f"{header}: {body}")

    for signal in company.signals.order_by('-cycle_or_year', '-amount_usd', '-retrieved_at')[:8]:
        amount = signal.amount_usd if signal.amount_usd is not None else 'unknown'
        chunks.append(
            f"External signal ({signal.source}/{signal.signal_type}, {signal.cycle_or_year or 'n/a'}): "
            f"{signal.title}. Amount: {amount}. Evidence: {signal.evidence_text}"
        )

    if not chunks:
        chunks.append(company.name)

    joined = '\\n\\n'.join(chunks)
    snippets = _extract_keyword_snippets(joined)
    if snippets:
        chunks.append('Focused evidence snippets:\\n' + '\\n'.join(snippets))

    return chunks


def score_company(
    company: Company,
    classifier: FaithClassifier | None = None,
    use_llm: bool = True,
    profile_name: str = 'consensus',
    profile_overrides: dict | None = None,
) -> FaithScreen:
    classifier = classifier or FaithClassifier()
    text_chunks = _build_text_chunks(company)

    classification = classifier.classify(
        company_name=company.name,
        ticker=company.ticker,
        text_chunks=text_chunks,
        use_llm=use_llm,
    )

    categories = classification.get('categories', {})
    breakdown = compute_faith_alignment(
        category_findings=categories,
        profile_name=profile_name,
        profile_overrides=profile_overrides,
    )

    base_findings = {
        key: categories.get(key, {})
        for key in BASE_CATEGORY_WEIGHTS.keys()
    }

    screen, _ = FaithScreen.objects.update_or_create(
        company=company,
        defaults={
            'alignment_score': breakdown.alignment_score,
            'base_score': breakdown.base_score,
            'confidence_score': breakdown.confidence_score,
            'pipeline_version': 'v0.1',
            'llm_provider': classification.get('llm_provider', ''),
            'llm_model': classification.get('llm_model', ''),
            'base_findings': base_findings,
            'category_details': {
                'deductions': breakdown.deductions,
                'included_optional_categories': breakdown.included_optional_categories,
            },
            'summary': classification.get('summary', ''),
            'raw_classification': classification,
        },
    )

    return screen


def score_companies(
    companies: Iterable[Company],
    use_llm: bool = True,
    profile_name: str = 'consensus',
    profile_overrides: dict | None = None,
) -> list[FaithScreen]:
    classifier = FaithClassifier()
    screens = []

    for company in companies:
        screens.append(
            score_company(
                company=company,
                classifier=classifier,
                use_llm=use_llm,
                profile_name=profile_name,
                profile_overrides=profile_overrides,
            )
        )

    return screens
