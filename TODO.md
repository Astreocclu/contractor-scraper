# TODO

## Now (P0 - Causing False Negatives)
- [ ] **Fix Trustpilot SERP pulling wrong companies** - `scrapers/serp_rating.py`
  - ~8/20 contractors had wrong Trustpilot data (allstarpros.com, urbanadventurequest.com, etc.)
  - Contractor 5 got 56 score (false negative) due to wrong Trustpilot match
  - Need stricter name matching or domain verification
  - See: `docs/SESSION_2025-12-08_batch_audit_results.md`

## Next (P1)
- [ ] **Data Sourcing** - Run `batch_collect.js` for existing contractors
  - Target: 100 contractors with low data freshness
  - Source: BBB, Google Maps, Yahoo/Yelp
- [ ] **Fix Trustpilot SERP pulling wrong companies** - `scrapers/serp_rating.py`
  - ~8/20 contractors had wrong Trustpilot data
  - Needs stricter name matching
- [ ] **Fix local Google Maps score prioritization** - `services/audit_agent.js`
- [ ] **Fix review analysis JSON parse error** - `services/review_analyzer.js`

## Later
- [ ] **Migrate SQLite → PostgreSQL** - `docs/POSTGRESQL_MIGRATION_PLAN.md`
  - Enables parallel audit workers (SQLite locks on writes)
  - Required for 1000+ contractor scaling
  - Ready to execute: 4 phases, ~4-5 hours total
  - Trigger: After Boss deal response
- [ ] Batch audit remaining 1,500+ contractors
- [ ] Build permit cross-reference (claims vs actual volume)

## Done
- [x] **Scraper Testing & Debugging** (Dec 8, 2025)
  - [x] Tested all permit scrapers, documented results
  - [x] 4,994 permits collected from 6 working cities
  - [x] Fixed EnerGov sort timeout, added Grand Prairie config
  - [x] Created `citizen_self_service.py` for McKinney/Southlake (needs more work)
  - [x] Identified: Colleyville SSL broken, Denton not on MGO, Duncanville needs license
  - [x] See: `docs/SESSION_2025-12-08_scraper_debugging.md`
- [x] **Batch Audit Validation** (Dec 8, 2025)
  - [x] Ran 20 contractor audits to validate scoring logic
  - [x] Confirmed: Rating conflict detection working (caught 3 bad contractors)
  - [x] Confirmed: High scores for good contractors (88-92 range)
  - [x] Confirmed: Missing data no longer penalized
  - [x] Identified 3 bugs to fix (Trustpilot matching, local scores, JSON parse)
  - [x] See: `docs/SESSION_2025-12-08_batch_audit_results.md`
- [x] **Scraper Integration Complete** (Dec 7, 2025)
  - [x] Yahoo Yelp scraper wired into `collection_service.js` (line 71-73, 834-858)
  - [x] Google Maps `max_reviews` set to 20 (line 64-65)
  - [x] Python scrapers wired into audit pipeline (`runInitialCollection`)
  - [x] SERP rating (Angi/Trustpilot/Houzz) wired (line 860-893)
- [x] **Yelp Yahoo Workaround** (Dec 7, 2025)
  - [x] `scrapers/yelp.py` - Added `scrape_yelp_via_yahoo()` function
  - [x] Bypasses DataDome via Yahoo Search rich snippets
  - [x] Extracts: rating (X.X/5), review count, Yelp URL
  - [x] Tested: Orange Elephant = 1.9/5 (10 reviews) - WORKING!
  - [x] Added `--yahoo` and `--with-fallback` CLI flags
  - [x] Added Trustpilot to sources config
  - [x] Updated `review_analyzer.js` to check yelp_yahoo, trustpilot, angi, houzz
  - [x] See: `docs/SESSION_2025-12-07_fake_review_yelp_yahoo.md`
- [x] **Municipality Expansion** (Dec 7, 2025)
  - [x] `scrapers/etrakit.py` - NEW scraper for Frisco (4,311 permits found!)
  - [x] Added DeSoto to EnerGov config
  - [x] Added Denton, Cedar Hill, Duncanville JIDs to MGO Connect
  - [x] Updated scrapers/README.md with full coverage matrix
- [x] **Scraper Migration Phase 1-6** (Dec 7, 2025)
  - [x] `scrapers/utils.py` - rate limiting, caching, retry
  - [x] `scrapers/deepseek.py` - API wrapper
  - [x] `scrapers/tdlr.py` - TDLR license lookup (Playwright)
  - [x] `scrapers/yelp.py` - Yelp reviews (LIMITED - DataDome blocks)
  - [x] `scrapers/bbb.py` - BBB ratings (httpx, Tier 1)
  - [x] `scrapers/contractor_scraper.py` - orchestrator
  - [x] Tested: Orange Elephant (F rating), Berkeys (A+, 2 licenses)
- [x] Agentic audit v2 architecture
- [x] BBB parser (catches F ratings LLM missed)
- [x] Score enforcement in code (caps CRITICAL at 15)
- [x] Review analyzer (fake detection)
- [x] Insurance confidence scoring
- [x] Orange Elephant test case validated (15/100 CRITICAL)
