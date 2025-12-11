# TODO

## Now (P0)
- [ ] **Data Quality Validation** - Spot-check audit results for accuracy
  - Verify passing contractors have good data
  - Verify flagged contractors have real issues

## Next (P1)
- [ ] **Batch Audit Scale-up** - Run audits for remaining contractors
  - Target: All contractors in database
  - Monitor for patterns/issues


## Later
- [ ] Batch audit remaining contractors
- [ ] Add more review sources if needed

## Done
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
