# Faith Alpha Django App

`faith_alpha` is the Christian Alpha MVP backend module (week 1-3 scope).

## Components

- `models.py`
  - `Company` for stock universe metadata
  - `CompanyFiling` for SEC filing snapshots
  - `FaithScreen` for computed Faith Alignment Scores
- `services/sec_ingest.py`
  - SEC ticker universe pull
  - SEC submissions pull for `10-K` and `DEF 14A`
- `services/classifier.py`
  - DeepSeek structured classification with keyword fallback
- `services/scoring.py`
  - Faith Alignment Score formula with denominational toggles
- `services/pipeline.py`
  - End-to-end company scoring pipeline
- `services/policy_signals.py`
  - FEC + Senate LDA external signal ingestion
- `services/optimizer.py`
  - Sector-neutral faith portfolio recommendation engine
- `management/commands/run_faith_screen.py`
  - One command for ingest + external signals + score
- `urls.py` / `views.py`
  - API endpoints under `/api/faith/companies`

## Quick Run

```bash
./venv/bin/python manage.py migrate faith_alpha
./venv/bin/python manage.py run_faith_screen --limit 10 --universe sp500 --fetch-text --sync-signals --use-llm
```

## API

- `GET /api/faith/companies/`
- `GET /api/faith/companies/<TICKER>/`
- `GET /api/faith/companies/stats/`
- `GET /api/faith/companies/?source=lda`
- `POST /api/faith/companies/portfolio/`
- `POST /api/faith/companies/<TICKER>/rescore/`
