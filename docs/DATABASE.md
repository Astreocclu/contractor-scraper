# Contractor Auditor - Database Reference

**Updated:** 2026-01-09
**Database:** PostgreSQL `contractors_dev`

---

## Connection

```bash
export DATABASE_URL=postgresql://contractors_user:localdev123@localhost/contractors_dev
```

---

## Core Tables

### contractors_contractor

Master contractor data.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| business_name | VARCHAR | Company name |
| slug | VARCHAR | URL-friendly identifier |
| city, state, zip_code | VARCHAR | Location |
| phone, email, website | VARCHAR | Contact info |
| google_place_id | VARCHAR | Google Maps ID |
| google_rating | DECIMAL | 0-5 star rating |
| google_review_count | INTEGER | Number of reviews |
| trust_score | INTEGER | 0-100 audit score |
| last_audit_at | TIMESTAMP | Most recent audit |

### contractor_raw_data

Cached scraper results (TTL-based).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| contractor_id | INTEGER | FK to contractor |
| source_name | VARCHAR | 'bbb', 'yelp', 'google_maps', etc. |
| source_url | TEXT | URL scraped |
| raw_text | TEXT | Extracted content |
| structured_data | JSONB | Parsed data |
| fetch_status | VARCHAR | 'success', 'blocked', 'not_found', 'error' |
| fetched_at | TIMESTAMP | When scraped |
| expires_at | TIMESTAMP | Cache expiry |

### audit_records

Audit results with reasoning trace.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| contractor_id | INTEGER | FK to contractor |
| audit_version | INTEGER | 1=legacy, 4=dialectic |
| trust_score | INTEGER | 0-100 final score |
| risk_level | VARCHAR | CRITICAL/SEVERE/MODERATE/LOW/TRUSTED |
| recommendation | VARCHAR | AVOID/CAUTION/VERIFY/RECOMMENDED |
| reasoning_trace | TEXT | Full LLM reasoning (JSON for dialectic) |
| red_flags | JSONB | Array of issues found |
| positive_signals | JSONB | Array of good signals |
| collection_rounds | INTEGER | Data collection iterations |
| total_cost | DECIMAL | API costs |
| created_at | TIMESTAMP | Audit start |
| finalized_at | TIMESTAMP | Audit complete |

### county_lien_records

Lien search results from Texas counties.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| contractor_id | INTEGER | FK to contractor |
| county | VARCHAR | 'tarrant', 'collin', 'dallas', 'denton' |
| liens_by_contractor | INTEGER | Liens filed BY contractor (positive) |
| liens_against_contractor | INTEGER | Liens filed AGAINST contractor (negative) |
| raw_results | JSONB | Full search results |
| searched_at | TIMESTAMP | When searched |

### collection_log

Scraping activity audit trail.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| contractor_id | INTEGER | FK to contractor |
| source_name | VARCHAR | Source scraped |
| requested_by | VARCHAR | 'initial', 'audit_agent', 'manual' |
| request_reason | TEXT | Why requested |
| status | VARCHAR | 'pending', 'success', 'failed' |
| started_at | TIMESTAMP | Start time |
| completed_at | TIMESTAMP | End time |
| error_message | TEXT | Error if failed |

---

## Audit Versions

| Version | Mode | Description |
|---------|------|-------------|
| 1 | Legacy | Old V1 agent with tools |
| 2 | Standard | V2 single-pass, no tools |
| 3 | (unused) | - |
| 4 | Dialectic | 3-persona adversarial |

Query dialectic audits:
```sql
SELECT * FROM audit_records WHERE audit_version = 4;
```

---

## Useful Queries

**Contractors needing audit:**
```sql
SELECT id, business_name, city
FROM contractors_contractor
WHERE trust_score IS NULL
   OR last_audit_at < NOW() - INTERVAL '30 days'
LIMIT 100;
```

**Audit success rate:**
```sql
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN trust_score >= 70 THEN 1 END) as recommended,
  ROUND(COUNT(CASE WHEN trust_score >= 70 THEN 1 END) * 100.0 / COUNT(*), 1) as pct
FROM audit_records
WHERE audit_version = 4;
```

**Stale cache (needs re-scrape):**
```sql
SELECT contractor_id, source_name, expires_at
FROM contractor_raw_data
WHERE expires_at < NOW()
ORDER BY expires_at;
```

---

## Django Models

Located in `contractors/models.py`:

| Model | Table |
|-------|-------|
| Vertical | contractors_vertical |
| Contractor | contractors_contractor |
| ContractorAudit | contractors_contractoraudit |
| RedFlag | contractors_redflag |
