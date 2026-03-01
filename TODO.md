# Contractor Auditor - Task Queue
Tags: [TODO] [AUDITOR] [OPERATIONS]
Tag-Stamped: 2026-02-19 09:34 CT by auditor (new)
Last-Updated: 2026-02-19 09:34 CT
Updated-By: auditor
Update-Summary: Synced tasks to DataForSEO-first remediation priorities

## P0 (critical)

- [ ] **Prove DataForSEO remediation pass yields ≥10 usable reviews per contractor**  
  Run `node bin/apify_review_remediation.js --scope scored --batch-size 10 --limit 25 --provider dataforseo` with dry-run + live phases until batch instrumentation shows 100% pass rates. [PROPOSED]

- [ ] **Demote placeholder source passes**  
  Update manifest + forensic doc so `facebook`, `thumbtack`, `porch`, `buildzoom` default to `not_useful` and pilot the revised gate. [PROPOSED]

- [ ] **Align court-record rule to 20/80 payload depth**  
  Document + implement partial vs substantial docket distinction so success requires real case details, not just HTTP 200. [PROPOSED]

## P1 (important)

- [ ] Resume `hybrid_100_roof_A` Swiss once remediation batches stay green and DeepSeek spend is approved. [PROPOSED]
- [ ] Add explicit telemetry for source-data utility (not just HTTP status) in batch summaries. [PROPOSED]
- [ ] Add targeted retries for slow county lien lookups, especially Collin. [PROPOSED]
- [ ] Add score penalties for closed Google listing status and low BBB grades. [PROPOSED]

## P2 (future)

- [ ] Plan vertical expansion implementation from research handoff: foundation repair, outdoor living, artificial turf, exterior painting, etc. [PROPOSED]
- [ ] Improve fuzzy name matching for liens and complaints. [PROPOSED]

## Completed

- [x] Run-100 canonical command lock added to runtime documentation.
- [x] Removed legacy V1 variance-prone flow; retained V2 deterministic baseline path.
- [x] Lien direction handling corrected (GRANTEE vs GRANTOR).
- [x] Batch runner shipped with state buckets and retry handling.
