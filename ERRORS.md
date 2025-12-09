# Contractor Scraper - Error Log

## Format
| Date | Phase | Error | Resolution |
|------|-------|-------|------------|

## Critical Architecture Mistakes (DO NOT REPEAT)

### 2025-12-08: Enrichment worked on Leads instead of Permits

**What happened:** `enrich_cad.py` was querying `Lead.objects.all()` and enriching Properties via Lead→Property FK. This meant:
- Properties without Leads were NEVER enriched (49% of data stuck as "pending")
- 1,914 orphan Properties accumulated (no matching Permit)
- Scoring failed silently because CAD data was missing

**Root cause:** Confusion about data flow. Someone thought enrichment should work on Leads.

**The correct flow is:**
```
PERMIT (scraped) → enrich address → PROPERTY (CAD cache) → score → SCOREDLEAD (sellable)
```

**Fix:** Changed `enrich_cad.py` to work on `Permit.objects.all()` and create/update Property records.

**Lesson:** The business logic is: **Permits are the input, ScoredLeads are the output.** Property is just a cache of CAD data keyed by address. Lead model is legacy - use ScoredLead.

---

## Disabled Data Sources

| Source | Status | Date | Notes |
|--------|--------|------|-------|
| Yelp | DISABLED | 2025-12-08 | Do not factor into scoring. Do not penalize for missing Yelp data. |
| BBB | BLOCKED | 2025-12-07 | Anti-scraping measures. Do not penalize for missing BBB data. |

---

## Errors

| 2024-12-02 | Phase 0 | PostgreSQL not installed - `createdb` command not found | Using SQLite fallback for dev. Install PostgreSQL for production. |
| 2024-12-02 | Scrape | Google Places API REQUEST_DENIED - Legacy API not enabled | Need to enable Places API in Google Cloud Console |
| 2024-12-02 | Audit | Gemini API 404 - gemini-1.5-flash model not found | Need to enable Generative Language API or use different model |
| 2025-12-08 | Audit | Only 4 contractors showing despite 116 qualified | `passes_threshold` not updated when `trust_score` changes via `.update()`. Must call `.save()` or use signal. See `docs/ISSUE_4_CONTRACTORS_SHOWING.md` |
