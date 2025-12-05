# Contractor Scraper - Error Log

## Format
| Date | Phase | Error | Resolution |
|------|-------|-------|------------|

## Errors

| 2024-12-02 | Phase 0 | PostgreSQL not installed - `createdb` command not found | Using SQLite fallback for dev. Install PostgreSQL for production. |
| 2024-12-02 | Scrape | Google Places API REQUEST_DENIED - Legacy API not enabled | Need to enable Places API in Google Cloud Console |
| 2024-12-02 | Audit | Gemini API 404 - gemini-1.5-flash model not found | Need to enable Generative Language API or use different model |
