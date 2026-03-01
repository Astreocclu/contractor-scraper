# Christian Alpha Experiment (Week 1-3 MVP)

This experiment reuses the TrustHome ingestion/scoring pattern for Biblically Responsible Investing (BRI):

1. SEC ingest for a stock universe (default top 100 S&P tickers)
2. Filing collection (`10-K`, `DEF 14A`)
3. Faith-alignment classification (DeepSeek when available, keyword fallback otherwise)
4. Composite Faith Alignment Score (0-100)
5. Sector-neutral portfolio recommendation with risk constraints
6. DRF endpoints for frontend consumption

## Run

```bash
cd /home/astre/command-center/src/greenlit/auditor
./venv/bin/python manage.py migrate
./venv/bin/python manage.py run_faith_screen --limit 25 --universe sp500 --fetch-text --sync-signals --use-llm
./venv/bin/python manage.py runserver 0.0.0.0:8002
```

## API

- `GET /api/faith/companies/?min_score=70`
- `GET /api/faith/companies/AAPL/`
- `GET /api/faith/companies/stats/`
- Scenario scoring example:
  - `GET /api/faith/companies/?profile=protestant_strict&alcohol=true&defense=false`
- Signal filter example:
  - `GET /api/faith/companies/?source=lda`
- Portfolio recommendation:
  - `POST /api/faith/companies/portfolio/` with JSON body `{ \"profile\": \"consensus\", \"risk_tolerance\": \"moderate\", \"min_alignment_score\": 70, \"max_holdings\": 20 }`
- Recompute one company:
  - `POST /api/faith/companies/AAPL/rescore/` with JSON body `{ \"sync_signals\": true, \"use_llm\": false }`

## Notes

- SEC requests require a user agent. Set `SEC_USER_AGENT` if needed.
- FEC enrichment requires `FEC_API_KEY`.
- Senate LDA enrichment can run without token for limited queries; set `LDA_API_KEY` if available.
- LLM scoring uses existing `DEEPSEEK_API_KEY`; if absent, fallback classifier is deterministic keyword-based.
- This is intentionally optimized for speed-to-demo, not production-grade financial advice.
