# TODO

## Now (P0)
- [ ] **Batch Audit Scale-up** - Run audits for remaining contractors
  - Target: All contractors in database
  - Use fresh lien collection with direction fix
  - Monitor for patterns/issues

## Next (P1)
- [ ] **Clear stale lien cache** - Force re-collection for contractors with old lien data format
  - Old cache doesn't have `liens_by_contractor` / `liens_against_contractor` fields
  - Either reduce TTL or clear county_liens records older than 2025-12-14

## Later
- [ ] Add more review sources if needed
- [ ] Improve fuzzy name matching for liens (avoid matching "similar" business names)

---

## Completed (Archive)

See `docs/plans/` for detailed implementation history. Recent completions:

- V2 Consolidation (Dec 22, 2025) - Single pipeline, zero variance
- Score Variance Fix (Dec 14, 2025) - temperature: 0
- Lien Direction Fix (Dec 14, 2025) - BY vs AGAINST distinction
- PostgreSQL Migration (Dec 9, 2025)
- Full scraper integration (Dec 7-9, 2025)
