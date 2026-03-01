import json
import logging
from typing import Dict, Any, Iterable

from shared.deepseek import DeepSeekClient

from .constants import ALL_CATEGORY_WEIGHTS

logger = logging.getLogger(__name__)


CATEGORY_KEYWORDS = {
    'abortion': [
        'abortion',
        'planned parenthood',
        'reproductive health',
    ],
    'pornography': [
        'pornography',
        'adult entertainment',
        'explicit content',
    ],
    'gambling': [
        'casino',
        'sports betting',
        'online betting',
        'lottery',
        'gambling',
    ],
    'human_trafficking': [
        'human trafficking',
        'forced labor',
        'modern slavery',
    ],
    'embryonic_stem_cells': [
        'embryonic stem cell',
        'embryo research',
    ],
    'alcohol': [
        'beer',
        'wine',
        'spirits',
        'alcohol',
        'distillery',
    ],
    'contraception': [
        'contraception',
        'birth control',
    ],
    'lgbtq_corporate_activism': [
        'pride month',
        'lgbtq',
        'gender transition',
    ],
    'tobacco': [
        'tobacco',
        'cigarette',
        'nicotine',
        'vape',
    ],
    'cannabis': [
        'cannabis',
        'marijuana',
        'thc',
        'hemp',
    ],
    'defense': [
        'missile',
        'defense contract',
        'weapons system',
        'munitions',
    ],
}


PRIMARY_EXPOSURE_HINTS = {
    'gambling': ['casino', 'sports betting', 'online betting'],
    'pornography': ['adult entertainment', 'pornography'],
    'alcohol': ['beer', 'wine', 'spirits', 'distillery'],
    'tobacco': ['tobacco', 'cigarette', 'nicotine', 'vape'],
    'cannabis': ['cannabis', 'marijuana', 'thc'],
    'defense': ['missile', 'munitions', 'weapons system'],
    'abortion': ['abortion'],
    'embryonic_stem_cells': ['embryonic stem cell', 'embryo research'],
    'human_trafficking': ['human trafficking', 'forced labor', 'modern slavery'],
    'contraception': ['contraception', 'birth control'],
    'lgbtq_corporate_activism': ['pride month', 'lgbtq', 'gender transition'],
}


class FaithClassifier:
    def __init__(self, client=None):
        self.client = client or DeepSeekClient()

    def classify(
        self,
        company_name: str,
        ticker: str,
        text_chunks: Iterable[str],
        use_llm: bool = True,
    ) -> Dict[str, Any]:
        corpus = self._build_corpus(company_name, ticker, text_chunks)

        if use_llm and self.client.api_key:
            try:
                llm_result = self._classify_with_llm(company_name=company_name, ticker=ticker, corpus=corpus)
                if llm_result:
                    return llm_result
            except Exception as exc:  # pragma: no cover - defensive path for flaky upstream APIs
                logger.warning('LLM classification failed for %s (%s): %s', ticker, company_name, exc)

        return self._classify_with_keywords(corpus)

    def _build_corpus(self, company_name: str, ticker: str, text_chunks: Iterable[str]) -> str:
        lines = [f"Company: {company_name} ({ticker})"]
        for chunk in text_chunks:
            if not chunk:
                continue
            lines.append(str(chunk).strip())
        corpus = '\n\n'.join(lines)
        return corpus[:25000]

    def _classify_with_llm(self, company_name: str, ticker: str, corpus: str) -> Dict[str, Any]:
        schema_example = {
            'categories': {
                category: {
                    'severity': 0,
                    'involvement': 'none',
                    'confidence': 75,
                    'evidence': [],
                }
                for category in ALL_CATEGORY_WEIGHTS.keys()
            },
            'summary': 'short rationale',
        }

        system_prompt = (
            'You are a financial ethics analyst. '
            'Classify company involvement for Biblically Responsible Investing screens. '
            'Return only valid JSON. Use severity 0-3 where 0=none, 1=affiliation/donation, '
            '2=minor revenue exposure, 3=primary revenue exposure. '
            'Use involvement values only from: '
            'none, board_affiliation, corporate_donation, minor_revenue_exposure, '
            'primary_revenue_exposure, unclear.'
        )

        prompt = (
            f"Analyze this company for Christian ethical risk categories.\n\n"
            f"Ticker: {ticker}\n"
            f"Company: {company_name}\n\n"
            f"Text corpus:\n{corpus}\n\n"
            f"Required JSON schema:\n{json.dumps(schema_example, indent=2)}"
        )

        parsed = self.client.analyze_json(prompt=prompt, system_prompt=system_prompt)
        categories = parsed.get('categories') if isinstance(parsed, dict) else None
        if not isinstance(categories, dict):
            return {}

        normalized = self._normalize_categories(categories)
        return {
            'method': 'llm',
            'llm_provider': 'deepseek',
            'llm_model': self.client.MODEL,
            'categories': normalized,
            'summary': parsed.get('summary', ''),
        }

    def _classify_with_keywords(self, corpus: str) -> Dict[str, Any]:
        lowered = corpus.lower()
        categories = {}

        for category in ALL_CATEGORY_WEIGHTS.keys():
            keywords = CATEGORY_KEYWORDS.get(category, [])
            matched = [kw for kw in keywords if kw in lowered]

            if not matched:
                categories[category] = {
                    'severity': 0,
                    'involvement': 'none',
                    'confidence': 70,
                    'evidence': [],
                }
                continue

            primary_hits = [kw for kw in PRIMARY_EXPOSURE_HINTS.get(category, []) if kw in lowered]
            if primary_hits:
                severity = 3
                involvement = 'primary_revenue_exposure'
            elif len(matched) >= 2:
                severity = 2
                involvement = 'minor_revenue_exposure'
            else:
                severity = 1
                involvement = 'corporate_donation'

            evidence = matched[:3]
            categories[category] = {
                'severity': severity,
                'involvement': involvement,
                'confidence': 55,
                'evidence': evidence,
            }

        return {
            'method': 'keyword_fallback',
            'llm_provider': '',
            'llm_model': '',
            'categories': categories,
            'summary': 'Keyword fallback used because LLM was unavailable or disabled.',
        }

    def _normalize_categories(self, categories: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        normalized = {}
        for category in ALL_CATEGORY_WEIGHTS.keys():
            raw = categories.get(category, {}) if isinstance(categories, dict) else {}
            severity = raw.get('severity', 0)
            try:
                severity = int(severity)
            except (TypeError, ValueError):
                severity = 0
            severity = max(0, min(3, severity))

            involvement = str(raw.get('involvement', 'none')).strip().lower()
            if involvement not in {
                'none',
                'board_affiliation',
                'corporate_donation',
                'minor_revenue_exposure',
                'primary_revenue_exposure',
                'unclear',
            }:
                involvement = 'unclear' if severity > 0 else 'none'

            confidence = raw.get('confidence', 70)
            try:
                confidence = int(confidence)
            except (TypeError, ValueError):
                confidence = 70
            confidence = max(0, min(100, confidence))

            evidence = raw.get('evidence', [])
            if isinstance(evidence, str):
                evidence = [evidence]
            if not isinstance(evidence, list):
                evidence = []

            normalized[category] = {
                'severity': severity,
                'involvement': involvement,
                'confidence': confidence,
                'evidence': evidence[:3],
            }

        return normalized
