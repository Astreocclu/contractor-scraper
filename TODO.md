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

## Done
- [x] **Score Variance Fix** (Dec 14, 2025)
  - Set `temperature: 0` in all audit agents (was 0.1)
  - Reduced variance from 29 points to 2 points across 5 runs
- [x] **Lien Direction Fix** (Dec 14, 2025)
  - Updated prompt to correctly interpret liens filed BY vs AGAINST contractor
  - Fixed `calculate_lien_score()` to categorize by GRANTEE/GRANTOR matching
  - Liens filed BY contractor (collecting payment) = neutral, not red flag
- [x] **Data Quality Validation** (Dec 14, 2025)
  - Spot-checked 5 gold tier contractors with fresh lien collection
  - All 5 scored appropriately (78-95 range)
  - Lien direction fix verified working end-to-end
- [x] **Trustpilot Direct URL Check** (Dec 9, 2025)
  - Fixed wrong company matching by using direct domain lookup
  - `scrapers/trustpilot.py` now checks `trustpilot.com/review/{domain}`
- [x] **Migrate SQLite → PostgreSQL** (Dec 9, 2025)
  - Successfully migrated schema and data (including audit_records)
  - Updated Node.js services (orchestrator, collection, audit agents) to use `node-pg`
  - Fixed unique constraint issues and verified data integrity
- [x] **JSON Parse Error Fixed** (Dec 9, 2025)
  - `services/review_analyzer.js` no longer crashes on malformed responses
- [x] **Batch Audit Validation** (Dec 8, 2025)
  - Ran 20 contractor audits to validate scoring logic
  - Confirmed: Rating conflict detection working
  - Confirmed: High scores for good contractors (88-92 range)
  - Confirmed: Missing data no longer penalized
- [x] **Scraper Integration Complete** (Dec 7, 2025)
  - Yahoo Yelp scraper wired into `collection_service.js`
  - Google Maps `max_reviews` set to 20
  - Python scrapers wired into audit pipeline
  - SERP rating (Angi/Trustpilot/Houzz) wired
- [x] **Yelp Yahoo Workaround** (Dec 7, 2025)
  - `scrapers/yelp.py` - Added `scrape_yelp_via_yahoo()` function
  - Bypasses DataDome via Yahoo Search rich snippets
- [x] **BBB Scraper Working** (Dec 7, 2025)
  - `scrapers/bbb.py` - Python httpx scraper
  - Gets rating, accreditation, complaints, years in business
- [x] Agentic audit v2 architecture
- [x] BBB parser (catches F ratings LLM missed)
- [x] Score enforcement in code (caps CRITICAL at 15)
- [x] Review analyzer (fake detection)
- [x] Insurance confidence scoring
- [x] Orange Elephant test case validated (15/100 CRITICAL)
