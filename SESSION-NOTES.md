# Session Notes - Contractor Auditor

---

## Session: 2025-12-12 - Batch Audit Scaling to 1000+ Contractors

### Context
- User wanted to scale contractor auditor from single audits to batch processing 1000+ contractors
- Starting state: Individual audits working but used blocking `execSync` calls preventing parallelism
- Goals: Identify and fix reliability issues, create batch runner with state persistence

### Work Completed

**Phase 1: Initial Testing (10 audits)**
- Ran 10 full collection + audit cycles to identify issues
- Results: Scores ranged 16-90/100, identified 8 reliability problems
- Changed RECOMMENDED threshold from 70+ to 80+ in `services/audit_agent_v2.js`

**Phase 2: Implementation Plan via Gemini Collaboration**
- Used `/geminiplan` for iterative planning (3 rounds to 95% confidence)
- Created detailed plan: `docs/plans/2025-12-12-scale-to-1000-audits.md`

**Phase 3: Subagent-Driven Implementation (8 tasks completed)**

| Task | File | Description |
|------|------|-------------|
| 1 | `services/async_command.js` | NEW: Async spawn wrapper replacing execSync |
| 2 | `services/cost_tracker.js` | NEW: API cost tracking with JSON-L logging |
| 3 | `services/rate_limiter.js` | NEW: Token bucket rate limiting |
| 4 | `services/collection_service.js` | Converted 4 execSync calls to async |
| 5 | `services/review_analyzer.js` | Added 4-tier JSON extraction fallback |
| 6 | `scrapers/website_scraper.js` | Added `safeEval()` retry wrapper |
| 7 | `scrapers/serp_rating.py` | Increased Houzz timeout 15s→30s |
| 8 | `batch_audit_runner.js` | NEW: Batch orchestration with concurrency |

**Phase 4: Integration Testing & Bug Fix**
- Discovered critical bug: DB pool closed after first audit in batch mode
- Fixed by adding `batchMode` option to `runForensicAudit()` in `services/orchestrator.js`
- Verified: 5/5 audits completed successfully with parallelism

**Phase 5: Sequential Mode with Review Analysis Tracking (In Progress)**
- User requested blocking (sequential) execution instead of parallel
- Added `needsReviewAnalysis` bucket for contractors where review analysis fails
- New CLI commands: `--status`, `--retry-review`

### Files Modified/Created

**New Files:**
- `services/async_command.js` - Async subprocess runner (88 lines)
- `services/cost_tracker.js` - API cost tracking (57 lines)
- `services/rate_limiter.js` - Token bucket rate limiter (56 lines)
- `batch_audit_runner.js` - Batch orchestration (395 lines)
- `docs/plans/2025-12-12-scale-to-1000-audits.md` - Implementation plan

**Modified Files:**
- `services/audit_agent_v2.js` - Line 187: Changed threshold `<= 80` to `< 80`
- `services/collection_service.js` - Converted execSync to async spawn
- `services/review_analyzer.js` - Added `extractJSON()` with 4 fallback tiers
- `services/orchestrator.js` - Added `batchMode` option for pool lifecycle
- `scrapers/website_scraper.js` - Added `safeEval()` retry wrapper
- `scrapers/serp_rating.py` - Houzz timeout increase

### Current State
- **Batch Runner**: Working in sequential mode with state persistence
- **Review Analysis Tracking**: Contractors failing review analysis go to separate bucket
- **Last Test**: 5/5 contractors completed, all tracked correctly
- **Integration Test Interrupted**: Test with 2 contractors was interrupted mid-collection

**State Buckets in `batch_progress.json`:**
- `completed` - Audits with successful review analysis
- `needsReviewAnalysis` - Audits where review analysis failed (can retry)
- `failed` - Audits that threw errors
- `pending` - Queued contractors

### Next Steps
1. Run a clean sequential batch test (`--limit 10`) to verify full flow
2. Test `--retry-review` command to re-run review analysis on failed contractors
3. Scale up to 100+ audits once verified
4. Consider re-enabling parallelism as optional `--parallel` flag

### Notes

**Key Bug Fixed - Database Pool Closure:**
- `services/orchestrator.js` called `db.close()` in `finally` block
- In batch mode, this killed the shared pool after first audit
- Fix: Pass `batchMode: true`, skip `db.close()` when true

**Review Analysis Failure Causes:**
- DeepSeek sometimes returns prose instead of JSON
- 4-tier fallback helps but doesn't catch all cases
- Separate bucket allows targeted retry

**Scoring Threshold Change:**
```javascript
// services/audit_agent_v2.js line 187
// OLD: enforcedScore <= 80 ? 'VERIFY' : 'RECOMMENDED'
// NEW: enforcedScore < 80 ? 'VERIFY' : 'RECOMMENDED'
// Effect: 80+ is now RECOMMENDED (was 81+)
```

### Key Files
- `batch_audit_runner.js` - Main batch entry point
- `services/orchestrator.js` - Core audit orchestration (batchMode flag)
- `services/async_command.js` - Async subprocess wrapper
- `services/review_analyzer.js` - DeepSeek review analysis with JSON fallback
- `batch_progress.json` - State persistence file
- `docs/plans/2025-12-12-scale-to-1000-audits.md` - Full implementation plan

### Relevant Commands
```bash
# Run batch audit (sequential)
cd /home/reid/testhome/contractor-auditor
export $(cat .env | grep -v "^#" | xargs)
node batch_audit_runner.js --reset --limit 10

# Check batch status
node batch_audit_runner.js --status

# Retry failed review analysis
node batch_audit_runner.js --retry-review

# Resume interrupted batch
node batch_audit_runner.js --resume

# Single audit (for debugging)
node run_audit.js --id 123
```

---

## Session: 2025-12-11 - Email Collection Investigation + Tracerfy Integration

### Context
- User wanted to check if new contractors in the database had emails collected
- Goal: Understand email collection pipeline and fill gaps for ~1,800 contractors without emails
- Starting state: 2,529 contractors, only 679 (26.8%) had emails

### Work Completed

**Phase 1: Email Scraper Exploration**
- Tested existing `scrape_emails.py` (requests-based) - 5% hit rate (1/20)
- Upgraded to Playwright-based scraper - 15% hit rate (3/20)
- Tested archived DeepSeek email scraper - 5% hit rate (1/20)
- Conclusion: Website scraping has low yield due to JS-rendered content and contact forms

**Phase 2: Tracerfy Integration (NEW)**
- Created `scripts/tracerfy_enrich.py` - full skip tracing integration
- Ported address normalization from permit-scraper's `score_leads.py`:
  - Extracts embedded city/state/zip from addresses
  - Standardizes street suffixes (Street→ST, Avenue→AVE)
  - Standardizes directionals (North→N, etc.)
  - Extracts unit/apt/suite numbers
- Added TRACERFY_API_KEY to `.env`
- Ran on 120 contractors: 4 emails found (~3% hit rate)
- Tracerfy API had issues with large batches (503 errors, None queue_id for >100 records)

**Phase 3: Email Gap Analysis**
- Discovered email is NEVER collected in discovery pipeline
- `discover_contractors.py` saves: address, phone, website, google_place_id, rating - NO EMAIL
- `contractor_discovery.py` scraper doesn't fetch email either
- Contractors WITH email: IDs 1-1521 (median 748) - older imports
- Contractors WITHOUT email: IDs up to 3448 (median 1612) - newer discoveries

**Deleted Files:**
- `contractors/management/commands/scrape_emails.py` (Playwright version)
- `scrape_emails.js` (DeepSeek version)
- `_archive/scrape_emails_deepseek.js` (SQLite version)

### Files Modified/Created
- `scripts/tracerfy_enrich.py` - NEW: Tracerfy skip tracing integration with smart address normalization
- `.env` - Added TRACERFY_API_KEY

### Current State
- **Email Coverage**: 679/2,529 contractors (26.8%)
- **Tracerfy**: Working but API unstable for large batches; found 4 personal emails from 120 lookups
- **Discovery Pipeline**: Does NOT collect email - this is the root cause of the gap
- **99.8%** of contractors have Google Place IDs but no email enrichment occurs

**Email Breakdown:**
- 679 total emails
- 79.5% business domains (info@, sales@, etc.)
- 20.5% personal domains (gmail, yahoo, etc.)
- Some junk: godaddy.combookingsmy, mysite.com

**Tracerfy Results (Personal Emails Found):**
- courtcaldwell@icloud.com (J Caldwell Custom Pools)
- ashlyn.riley@excite.com (Fort Worth Pool)
- danny.archie@yahoo.com (JETT Aquatics Inc.)
- rodwhiddoninsurance@gmail.com (Heeler Construction)

### Next Steps
1. **Fix root cause**: Add email collection to discovery pipeline using Google Places API
   - Cost: ~$17 per 1,000 Place Details requests
   - 1,844 contractors need enrichment → ~$31 total
2. **Alternative**: Use business email finder APIs (Prospeo, Hunter.io) with free tiers
3. **Tracerfy**: Useful for personal owner emails as escalation path, but 3% hit rate and API instability

### Notes

**Key Discovery - Why Emails Stopped:**
- The 679 existing emails came from an earlier import/process (IDs 1-1521)
- Discovery pipeline was built WITHOUT email collection
- Google Maps scraper doesn't expose email; need Google Places API (Place Details endpoint)

**Tracerfy Insights:**
- Returns PERSONAL emails tied to commercial addresses (skip tracing)
- $0.009/lookup but only ~3% return usable emails
- API struggles with batches >100 (returns None for queue_id)
- B2B version exists at $0.10/match (pay-per-success) via FastAppend

**Business vs Personal Email Trade-off:**
- Business emails (info@) - expected channel, often ignored
- Personal emails (gmail, icloud) - direct to owner, better conversion but feels invasive

### Key Files
- `scripts/tracerfy_enrich.py` - Tracerfy enrichment with address normalization
- `contractors/management/commands/discover_contractors.py` - Discovery command (needs email added)
- `scrapers/contractor_discovery.py` - Google Maps scraper (no email)
- `contractors/models.py` - Contractor model with email field

### Relevant Commands
```bash
# Run Tracerfy enrichment
python3 scripts/tracerfy_enrich.py --limit 20        # Test batch
python3 scripts/tracerfy_enrich.py --dry-run         # Preview CSV

# Check email stats
python3 -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from contractors.models import Contractor
from django.db.models import Q
total = Contractor.objects.count()
with_email = Contractor.objects.exclude(Q(email__isnull=True) | Q(email='')).count()
print(f'Emails: {with_email}/{total} ({with_email/total*100:.1f}%)')
"
```

---

## Session: 2025-12-11 - County Lien Scrapers Fixed + Google Review Scraper Complete

### Context
- User needed to fix broken Texas county lien portal scrapers (Tarrant, Collin, Dallas)
- User wanted to build custom Playwright scraper for Google Reviews (Google API banned after $300 overcharge)
- Starting state: County scrapers returning empty results, Google review "scraper" only captured 4 listing metadata snippets

### Work Completed

**Phase 1: County Lien Scrapers (ALL FIXED)**
- Fixed Tarrant, Collin, Dallas scrapers - root cause was outdated URLs (portals moved to `*.tx.publicsearch.us`)
- Added proper wait times for Collin County (~8s for loading skeletons)
- Fixed document type normalization for "MECHANICS LIEN & AFFIDAVIT" variant
- All three counties now working: Tarrant (48), Collin (50), Dallas (942) records

**Phase 2: Google Review Scraper (COMPLETE)**
- Updated `scrapers/google_maps.py` (~600 lines) with:
  - playwright-stealth integration
  - CAPTCHA detection (`_is_captcha()` function)
  - Robust selectors: `div[data-review-id]`, `button[aria-label*="Photo of"]`
  - Scroll-based review extraction with deduplication
  - "More" button expansion for truncated reviews
  - Step 0 fix: Detects search results page and clicks into business detail
- Created `debug/snapshot_maps.py` for visual debugging (120 lines)

**Phase 3: Pipeline Integration (FIXED)**
- Traced batch_collect.js integration issue
- Root cause: Stale disk cache (`scrapers/.scraper_cache/`) had old Dec 10th data
- Fix: Deleted stale cache file, fresh scrape populated correct data
- Verified: 20 real reviews now stored in database with author names, dates, ratings

### Files Modified/Created
- `scrapers/google_maps.py` - Major update: stealth, CAPTCHA, review extraction
- `scrapers/county_liens/tarrant.py` - URL fix to publicsearch.us
- `scrapers/county_liens/collin.py` - URL fix + wait time increase
- `scrapers/county_liens/dallas.py` - URL fix + selector updates
- `scrapers/county_liens/base.py` - Added "MECHANICS LIEN & AFFIDAVIT" to doc type mappings
- `debug/snapshot_maps.py` - NEW: Visual debugging script for Google Maps

### Current State
- **County Lien Scrapers**: ALL WORKING - Tarrant, Collin, Dallas returning correct records
- **Google Review Scraper**: WORKING - Extracts real reviews with text, author, date, rating
- **batch_collect.js Pipeline**: WORKING - Stores real reviews in ContractorRawData
- **Database verified**: 20 real reviews for Claffey Pools (Christi Merkle, fabfikes, Dave Brillhart, etc.)

### Next Steps
1. Consider clearing ALL old google_maps cache files to ensure fresh data for other contractors
2. Monitor for CAPTCHA blocks during high-volume scraping
3. Optional: Increase `max_reviews` from 20 to 50 for more comprehensive pattern analysis
4. Test review_analyzer.js with the new real review data

### Notes

**Critical Discovery - Stale Cache Bug:**
- Node's `execSync()` spawns fresh Python process each time
- Fresh processes read from DISK cache, not in-memory
- Old cache file at `scrapers/.scraper_cache/10c94150094d5f0e.json` had Dec 10th listing metadata
- Fix: Delete stale cache files or run with `--no-cache` to refresh

**Cache Key Format:**
```
source:identifier -> SHA256[:16] -> .json file
google_maps:claffey pools:dallas, tx -> 10c94150094d5f0e.json
```

**Google Maps Scraper Selectors (working as of Dec 2025):**
- Reviews panel: `button[aria-label*="Reviews"]`
- Review items: `div[data-review-id]` (primary), `div[role="article"]` (fallback)
- Author: `button[aria-label^="Photo of"]` - extract name by removing prefix
- Rating: `span[role="img"][aria-label*="stars"]` - parse first digit
- Text: `.wiI7pd` class
- Scrollable container: `div.m6QErb.DxyBCb[role="main"]`

**Test Commands:**
```bash
# Test Google review scraper
python3 scrapers/google_maps.py "Claffey Pools" "Dallas, TX" --max-reviews 20 --json

# Test county lien scraper
python3 -m scrapers.county_liens.orchestrator --name "Claffey Pools"

# Run batch collection
node batch_collect.js --id 39 --force
```

### Key Files
- `scrapers/google_maps.py` - Main Google Maps/Reviews scraper
- `scrapers/county_liens/orchestrator.py` - Coordinates all county searches
- `services/collection_service.js` - Main collection pipeline (calls Python scrapers)
- `services/review_analyzer.js` - DeepSeek analysis of review authenticity
- `scrapers/.scraper_cache/` - Disk cache directory (check for stale files)
- `scrapers/utils.py` - ScraperCache class with TTL management

### Test Contractor
- **Claffey Pools (ID: 39)** - Southlake, TX
  - Google: 4.9 rating, 707 reviews
  - BBB: A+ rating
  - Liens: 120 records (113 active = CRITICAL)
  - Good test case: High reviews + high liens reveals payment pattern concerns
