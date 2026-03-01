# Contractor Auditor - Error Log

## Format
| Date | Phase | Error | Resolution |

## Current Known Issues

| Date | Phase | Error | Resolution |
|------|-------|-------|------------|
| 2026-02-17 | Source collection | `google_maps_local` returns many zero-text review-success rows | Enforce minimum review-text coverage checks before moving into review analysis or Swiss |
| 2026-02-17 | Source validation | Placeholder pages for `facebook`, `thumbtack`, `porch`, `buildzoom` marked as success | Add content quality checks for login/not-found placeholder payloads |
| 2026-02-17 | Pipeline ops | DeepSeek credits exhausted during `hybrid_100_roof_A` Swiss (`402 Insufficient Balance`) | Pause batch progression for `roof_A`; resume only after funding |
| 2026-02-17 | Data collection | Collin county lien lookups can timeout under load | Use targeted single-county retries; avoid broad reruns |

## Critical architecture mistakes (historical)

### Google Places API - BANNED
**What happened:** Google Places API caused a real overcharge.

**Fix:** Use Playwright scraping for Google Maps. Do not enable Google Places API.

## Resolved Issues

| Date | Issue | Resolution |
|------|-------|------------|
| 2026-02-14 | Source gate bypass | Restored strict source-first invariant and blocking behavior |
| 2026-02-14 | Score variance at temp 0.1 | Set `temperature: 0` on scoring path |
| 2025-12-14 | Liens filed BY contractor treated as red flags | Added lien direction handling (GRANTEE vs GRANTOR) |
| 2025-12-14 | `calculate_lien_score()` lacked direction fields | Added `liens_by_contractor` / `liens_against_contractor` |
| 2025-12-09 | Trustpilot matching errors | Switched to domain-specific URL validation |
| 2025-12-09 | Review analyzer JSON parse failures | Added multi-tier JSON parser fallback |
| 2025-12-08 | Discovery `passes_threshold` blocked valid records | Fixed threshold handling in `orchestrator.js` |
| 2025-12-07 | County portal access failures | Updated `*.tx.publicsearch.us` crawler URLs |
