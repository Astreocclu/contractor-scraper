# Source Quality Hardening Plan (80/20)

**Date:** 2026-02-20
**Goal:** Get 20% of sources delivering 80% of signal, with full review text, to unblock Swiss scoring for roofing launch vertical.
**Scope:** ~541 roofing pool contractors + pipeline hardening for all future batches.
**Budget:** $30-50 DataForSEO (upgrade confirmed), 19K Serper credits, $0 for Reddit/liens.

---

## Executive Summary

The pipeline has 38 sources but most are noise. Only 16-19% of scored contractors have actual Google review text. Placeholder sources (facebook, thumbtack, porch, buildzoom) pollute evidence context. Court records are unreliable (9-66% across counties) and signal value is questionable. This plan cuts to the 6 source groups that matter, fixes review text collection via DataForSEO, promotes Reddit (free, less bots, real homeowner discussions), and hardens the pipeline so every future batch auto-collects quality data.

**Estimated total: ~$10 DataForSEO + ~3,500 Serper credits. Saves $40/mo (Apify cancellation).**

---

## The 80/20 Source Map

| Priority | Source Group | Signal % | Provider | Cost/Contractor | Status |
|----------|-------------|----------|----------|-----------------|--------|
| P0 | Google Reviews (full text) | ~40% | DataForSEO | ~$0.008 | Needs remediation at scale |
| P1 | BBB complaints + accreditation | ~15% | Serper + bbb.py detail | ~1 Serper credit | Needs `--with-details` enforcement |
| P2 | Reddit (search + RSS monitoring) | ~12% | Serper + RSS feeds (FREE) | ~3 Serper credits | Massively underused (14% -> target 60%+) |
| P3 | Yelp reviews (full text) | ~10% | DataForSEO Yelp endpoint | ~$0.004 | NEW - needs integration |
| P4 | County liens | ~8% | Playwright scrapers | $0 | Working (keep as-is) |
| P5 | TX SOS + Franchise Tax | ~5% | API (free) | $0 | Working |
| P6 | News + OSHA/EPA | ~5% | Serper | ~3 Serper credits | Working |
| SUPP | Angi/Houzz (metadata only) | ~3% | Serper | ~1 Serper credit | Keep ratings, skip text |
| SUPP | Court records | ~2% | Serper | ~4 Serper credits | Demote to supplementary - unreliable, low signal |
| KILL | facebook, thumbtack, porch, buildzoom, homeadvisor, open_corporates, trustpilot, glassdoor, indeed, nextdoor, youtube | 0% | N/A | N/A | Demote to `not_useful` |

**Court records decision:** Demoted from critical to supplementary. Reasons:
1. Tarrant County: 9% success rate. Dallas: 66%. Collin: 62%. Denton: 54%. Unreliable.
2. Serper site-search of court portals is fragile - these portals are often not indexed by Google.
3. Signal is questionable - a lawsuit existing doesn't tell you who was right. County liens (mechanic's liens, tax liens) are much stronger signal because they represent concrete financial actions.
4. Not worth engineering effort to fix when Reddit and reviews deliver clearer signal.

**Reddit rationale:** Promoted from P5 to P2. Reasons:
1. FREE - RSS feeds cost nothing, Serper credits are cheap.
2. Less bots than review platforms - real homeowner discussions.
3. Reddit RSS infrastructure already exists (Python feedparser + cron plan from Dec 2025, n8n workflow plan).
4. Monitors 9 subreddits: r/dallas, r/fortworth, r/dfw, r/homeimprovement, r/homeowners, r/Contractors, r/RoofingContractors, r/swimmingpools, r/landscaping.
5. Two channels: batch search (Serper, per-contractor) + continuous monitoring (RSS, catches things proactively).

---

## Phase 1: Foundation (Source Gate + Placeholder Demotion)

**Why first:** Everything downstream depends on the gate being quality-aware. Currently, the gate passes contractors with zero review text and placeholder "successes."

### Task 1.1: Placeholder Source Demotion

**File:** `services/collection_service.js`

Add a `DEMOTED_SOURCES` constant and skip these during collection:

```javascript
const DEMOTED_SOURCES = new Set([
  'facebook', 'thumbtack', 'porch', 'buildzoom',
  'homeadvisor', 'open_corporates', 'trustpilot',
  'glassdoor', 'indeed', 'nextdoor_search', 'youtube'
]);
```

In the collection flow (`collectAllSources` or equivalent), skip any source in `DEMOTED_SOURCES`. Existing rows stay in the DB but are excluded from scoring context.

**File:** `bin/source_missing_from_manifest.js`

Update the verify logic to:
1. Ignore demoted sources when checking coverage
2. Never flag a demoted source as "missing"

**File:** `services/audit_agent.js` (or wherever scoring context is built)

Filter out demoted sources when building the evidence payload for DeepSeek/Claude scoring.

**Verification:**
```bash
# After implementation:
node bin/source_missing_from_manifest.js \
  --config=experiments/hybrid_100_roof_A/config/sample_100_group_roof_A.json \
  --verify-only
# Expected: No contractor flagged for missing facebook/thumbtack/porch/buildzoom
```

### Task 1.2: Quality-Aware Source Gate

**File:** `bin/source_missing_from_manifest.js`

Add a new `--quality-check` flag (default ON) that adds these checks:

```
google_review_text:
  rule: "Google review text quality"
  check: SELECT structured_data FROM contractor_raw_data
         WHERE contractor_id = ? AND source_name IN ('google_maps_local', 'google_maps_hq', 'google_maps_listed')
         AND fetch_status = 'success'
  pass_if: structured_data contains >=10 non-empty review texts
  warn_if: structured_data contains 5-9 non-empty review texts
  fail_if: structured_data contains <5 non-empty review texts OR review_count >= 50 but text < 5
```

This creates three tiers:
- **PASS**: >=10 non-empty review texts
- **WARN**: 5-9 texts (usable but not ideal)
- **FAIL**: <5 texts (needs remediation)

**New status field:** Add `quality_status` alongside `fetch_status`:
- `quality_status`: `high` (>=10 texts) | `medium` (5-9) | `low` (<5) | `none` (0)

**Verification:**
```bash
node bin/source_missing_from_manifest.js \
  --config=experiments/hybrid_100_roof_A/config/sample_100_group_roof_A.json \
  --verify-only --quality-check
# Expected: Report shows quality distribution across all contractors
```

### Task 1.3: Source Tier Configuration

**New file:** `config/source_tiers.js`

Centralize source classification:

```javascript
module.exports = {
  critical: ['google_maps_local', 'bbb', 'county_liens', 'tx_franchise', 'reddit'],
  important: ['yelp', 'yelp_yahoo', 'google_news', 'local_news', 'osha', 'epa_echo',
              'angi', 'houzz', 'google_maps_hq', 'google_maps_listed', 'tx_sos_search', 'tx_ag_complaints'],
  supplementary: ['court_records', 'dallas_court', 'tarrant_court', 'collin_court', 'denton_court',
                  'court_listener', 'website', 'website_warranty'],
  demoted: ['facebook', 'thumbtack', 'porch', 'buildzoom', 'homeadvisor',
            'open_corporates', 'trustpilot', 'glassdoor', 'indeed', 'nextdoor_search', 'youtube']
};
```

All collection, gate, and scoring code reads from this config. One place to add/remove/promote/demote sources.

**Note:** `court_records` moved from critical to supplementary. `reddit` moved from supplementary to critical.

### Task 1.4: Update Critical Source Gate Rules

**File:** `bin/source_missing_from_manifest.js`

Update `DEFAULT_REQUIRED_RULE_KEYS` to remove `court_records` and add `reddit`:

```javascript
const DEFAULT_REQUIRED_RULE_KEYS = [
  'google_presence',
  'bbb',
  'county_liens',
  'tx_franchise',
  'reddit'  // NEW - replaces court_records
];
```

Add Reddit rule to `BUILTIN_RULES`:
```javascript
reddit: {
  key: 'reddit',
  description: 'Reddit search present',
  allOf: ['reddit']
}
```

---

## Phase 2: Google Review Text Remediation (P0)

**Why:** 40% of total signal. Swiss scoring literally cannot resume without this.

### Task 2.1: Run DataForSEO Remediation on Roofing Cohort

The remediation pipeline already exists (`bin/apify_review_remediation.js` + `services/collection_service.js:remediateGoogleReviewsWithDataForSEO`). It just needs to run.

**Execution plan (strict batches of 25):**

```bash
source venv/bin/activate && set -a && . ./.env && set +a

# Batch 1: Test with 10
node bin/apify_review_remediation.js --scope scored --batch-size 10 --limit 10 \
  --provider dataforseo --max-reviews 200 --min-nonempty 10

# If 100% pass: scale to 25 per batch
node bin/apify_review_remediation.js --scope scored --batch-size 25 --limit 100 \
  --provider dataforseo --max-reviews 200 --min-nonempty 10

# Continue until all ~740 remediation candidates are processed
node bin/apify_review_remediation.js --scope scored --batch-size 25 --limit 740 \
  --provider dataforseo --max-reviews 200 --min-nonempty 10
```

**Cost estimate:** 740 contractors x ~100 reviews avg = ~74,000 reviews. At $0.075/1,000 = **~$5.55**.

**Stop condition:** Any batch below 90% pass rate triggers investigation before continuing.

### Task 2.2: Integrate DataForSEO into Standard Collection Pipeline

**File:** `services/collection_service.js`

The `remediateGoogleReviewsWithDataForSEO` call at line ~2415 already runs during collection. Ensure it:
1. Always fires when Google presence is found (not just on remediation trigger)
2. Uses `depth: 200` by default for standard collection
3. Stores full review payload with text in `structured_data`

**Verification:**
```bash
# Run single collection on a new contractor
node bin/run_collect.js --id <new_contractor_id>
# Verify: structured_data.reviews contains >=10 non-empty text entries
```

### Task 2.3: Remove Apify Dependency

**Files to modify:**
- `services/apify_service.js` - Mark deprecated, add warning log
- `services/collection_service.js` - Remove all Apify fallback paths
- `bin/apify_review_remediation.js` - Remove Apify provider option, rename to `bin/review_remediation.js`
- `.env` - Note `APIFY_API_TOKEN` can be removed after Apify subscription canceled

Add deprecation header to apify_service.js:
```javascript
// DEPRECATED (2026-02-20): Apify subscription canceled.
// DataForSEO is the only review lane. This file retained for reference only.
```

---

## Phase 3: Reddit Enhancement (P2)

**Why:** ~12% of signal. FREE. Less bot manipulation than review platforms. Real homeowner discussions. Existing RSS infrastructure ready to activate.

### Task 3.1: Improved Reddit Serper Search (Per-Contractor Batch Audit)

**File:** `services/collection_service.js` (buildSerperQuery function, line ~532)

Current query: `site:reddit.com "${businessName}" ${city}`

Problem: Too restrictive. Misses discussions that mention the company without exact name match, or discussions in relevant subreddits.

**New multi-query strategy:**

```javascript
reddit: [
  // Primary: exact name in DFW context
  `site:reddit.com "${businessName}" (${city} OR DFW OR "Dallas Fort Worth")`,
  // Secondary: name in roofing/home subreddits (vertical-specific)
  `site:reddit.com/r/roofing OR site:reddit.com/r/homeimprovement "${businessName}"`,
  // Tertiary: broader catch with category context
  `site:reddit.com "${businessName}" roofing review OR complaint OR experience OR recommend`
]
```

Run up to 3 Serper queries per contractor (costs 3 credits total). Merge and deduplicate results.

### Task 3.2: Reddit Content Extraction + Structured Storage

Current flow stores just the Serper search result snippets. Enhance:

```javascript
// For each Reddit result from Serper:
{
  title: result.title,
  snippet: result.snippet,     // This IS the review text for Reddit
  url: result.link,
  subreddit: extractSubreddit(result.link),  // e.g., "r/roofing"
  date: result.date || null,
  source_query: queryUsed       // Track which query found it
}
```

Serper snippets contain 150-300 chars of actual post/comment text - sufficient for trust scoring.

### Task 3.3: Activate Reddit RSS Monitor (Continuous Monitoring)

**Existing plans:** `docs/plans/archive/2025-12-13-reddit-rss-monitor-python.md`

The Python feedparser approach is simplest. Adapt it for the auditor:

**File:** `scripts/reddit_rss_monitor.py` (new, based on existing plan)

```python
SUBREDDITS = [
    # DFW Local
    "dallas", "fortworth", "dfw",
    # Homeowner help
    "homeimprovement", "homeowners",
    # Industry
    "Contractors", "RoofingContractors",
    # Verticals
    "swimmingpools", "landscaping", "roofing"
]

KEYWORDS = [
    # Contractor mentions (match against our DB)
    # Dynamic: loaded from contractor names in DB
    # Static: pain point keywords
    "roofing contractor", "roofer recommend", "avoid", "scam",
    "storm damage", "insurance claim", "hail damage",
    "looking for contractor", "need a roofer"
]
```

**Two modes:**
1. **Keyword monitor** (existing plan): Watches for pain-point keywords, sends Discord alerts for sales opportunities.
2. **Contractor name monitor** (NEW): Cross-references new Reddit posts against contractor names in our DB. If a contractor we track gets mentioned, store the post as evidence and flag for audit review.

**Cron:** `*/15 * * * *` - Every 15 minutes.

**Storage:** New Reddit mentions get written to `contractor_raw_data` table under `reddit_rss` source name, alongside the existing `reddit` Serper search results.

### Task 3.4: Reddit Signal in Scoring Context

When building scoring context, include Reddit data with subreddit context:

```
Reddit mentions (3 found):
- r/roofing (2024-11): "Used [company] for storm damage repair. They were great..."
- r/dallas (2024-08): "Anyone used [company]? Got a quote for $12K..."
- r/homeimprovement (2024-06): "Avoid [company], they left debris everywhere..."
```

The LLM scorer naturally handles sentiment analysis. Just present the data.

**Cost estimate:** Serper: 3 credits/contractor x 541 = **~1,623 credits** (from 19K). RSS: **$0** (free feeds, local cron).

---

## Phase 4: Yelp Review Text via DataForSEO (P3)

**Why:** ~10% of signal. Cross-platform review validation catches gaming (contractors who buy Google reviews but have bad Yelp reviews). Yelp's review filter is itself a signal about review authenticity.

### Task 4.1: DataForSEO Yelp Reviews Integration

**DataForSEO Yelp Reviews API:**
- Endpoint: `POST /v3/business_data/yelp/reviews/task_post`
- Identifier: `alias` (extracted from Yelp URL, e.g., `texas-vets-roofing-fort-worth`)
- Pricing: ~$0.00075 per 10 reviews (standard queue). Billed per 10 reviews returned.
- Depth: request 50 reviews per contractor (most won't have more)

**New file:** `services/dataforseo_yelp_service.js`

Pattern matches existing `dataforseo_service.js`:

```javascript
// Core functions:
async function postYelpReviewTask({ alias, depth = 50, sort_by = 'newest' })
async function pollAndGetYelpResults(taskId)
function transformYelpReview(dfsReview)
async function fetchYelpReviews({ alias, maxReviews = 50 })
```

**Key fields from DataForSEO Yelp response:**
- `review_text` - Full review content
- `rating.value` - Star rating (1-5)
- `time_ago` / `timestamp` - Review date
- `profile_name` - Reviewer name
- `profile_url` - Reviewer profile URL

### Task 4.2: Yelp Alias Resolver

**File:** `services/collection_service.js`

Extract the Yelp alias from existing data:

```javascript
function extractYelpAlias(contractor, existingData) {
  // 1. Check if we already have a Yelp URL from prior collection
  const yelpRow = existingData.find(r => r.source_name === 'yelp' && r.fetch_status === 'success');
  if (yelpRow?.structured_data?.url) {
    const match = yelpRow.structured_data.url.match(/yelp\.com\/biz\/([\w-]+)/);
    if (match) return match[1];
  }

  // 2. Check yelp_yahoo fallback data
  const yahooRow = existingData.find(r => r.source_name === 'yelp_yahoo');
  if (yahooRow?.structured_data?.yelp_url) {
    const match = yahooRow.structured_data.yelp_url.match(/yelp\.com\/biz\/([\w-]+)/);
    if (match) return match[1];
  }

  // 3. No alias available - Yelp not found for this contractor
  return null;
}
```

### Task 4.3: Wire into Collection Pipeline

**File:** `services/collection_service.js`

After Yelp metadata collection succeeds (Serper or Yahoo fallback), if we have a `yelp_alias`:
1. Call DataForSEO Yelp Reviews API
2. Store review text in `structured_data.reviews`
3. Update `yelp` source row with enriched data

```javascript
// After yelp metadata collection
const yelpAlias = extractYelpAlias(contractor, existingRows);
if (yelpAlias) {
  const yelpReviews = await fetchYelpReviews({ alias: yelpAlias, maxReviews: 50 });
  // Merge reviews into yelp source data and store
}
```

**Cost estimate:** ~57% of contractors have Yelp presence. 541 x 0.57 = ~308 contractors. At 50 reviews avg, ~15,400 reviews. At $0.075/1,000 = **~$1.16**.

**Verification:**
```bash
node -e "
  const { fetchYelpReviews } = require('./services/dataforseo_yelp_service');
  fetchYelpReviews({ alias: 'texas-vets-roofing-fort-worth' }).then(r => console.log(JSON.stringify(r, null, 2)));
"
```

---

## Phase 5: BBB Complaint Text Hardening (P1)

**Why:** 15% of signal. BBB already has a detail scraper that captures complaint text - just need to ensure it runs consistently.

### Task 5.1: Enforce Detail Scraping in Pipeline

**File:** `services/collection_service.js`

Find where `bbb.py` is called and ensure `--with-details` is always passed. The BBBComplaint dataclass already has a `description` field - we just need to make sure the detail scraper fires.

Check current call and ensure:
```javascript
// Must always include --with-details:
scraperArgs = [scraperPath, businessName, city, state, '--with-details'];
```

### Task 5.2: Verify Complaint Text Storage

Run the BBB scraper on a known-problematic contractor and verify:
1. `structured_data.complaints` array is populated
2. Each complaint has a non-empty `description` field
3. The complaint text is included in the scoring context

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate
python scrapers/bbb.py "Some Roofing Company" "Fort Worth" "TX" --with-details
```

### Task 5.3: BBB Quality Gate

Add to the quality check in Phase 1.2:

```
bbb_detail:
  rule: "BBB complaint detail quality"
  check: If BBB source is success AND complaint_count > 0, complaints array must have descriptions
  warn_if: complaint_count > 0 but complaints array empty or descriptions blank
```

**Cost:** $0 additional (BBB scraper uses httpx, not paid API).

---

## Phase 6: Pipeline Integration (All Phases Merged)

**Why:** Make sure every future batch auto-collects quality data from day one.

### Task 6.1: Collection Order Update

**File:** `services/collection_service.js`

New collection order reflecting 80/20 priorities:

```
1. Google Maps presence (Serper) → DataForSEO Google reviews (auto-enrich)
2. BBB (Serper + detail scraper with --with-details)
3. Reddit (3-query Serper strategy)
4. Yelp (Serper → alias → DataForSEO Yelp reviews)
5. County liens (Playwright scrapers - 4 DFW counties)
6. TX SOS + Franchise Tax (API)
7. News + OSHA + EPA (Serper)
8. Angi + Houzz (Serper, metadata only)
9. Court records (Serper, supplementary - runs but not gated)
```

Skip all demoted sources.

### Task 6.2: Batch Pipeline Quality Report

**New file:** `bin/batch_quality_report.js`

After any batch collection completes, generate a quality report:

```
=== Batch Quality Report ===
Contractors: 100
Google reviews >= 10 texts: 87/100 (87%)
Google reviews >= 20 texts: 62/100 (62%)
BBB with complaint text: 45/100 (45% - 55% had no BBB presence)
Reddit mentions found: 52/100 (52%)
Yelp review text: 48/100 (48%)
County liens coverage: 95/100 (95%)

Quality gate: PASS (87% Google text coverage > 80% threshold)
```

### Task 6.3: Scoring Context Builder Update

**File:** `services/audit_agent.js` or wherever the LLM scoring prompt is built

Ensure the evidence payload sent to DeepSeek/Claude includes:
1. Google review texts (full, up to 200)
2. BBB complaint descriptions (full text)
3. Reddit mentions (Serper snippets + RSS captures, with subreddit context)
4. Yelp review texts (up to 50)
5. County lien findings
6. Business legitimacy data (TX SOS, franchise)
7. News mentions
8. Court records (supplementary - included when present but not required)
9. **Explicitly excludes** all demoted sources

---

## Phase 7: Cancel Apify + Cleanup

### Task 7.1: Cancel Apify Subscription
- Cancel $40/mo Apify subscription (user action on host machine)
- Remove `APIFY_API_TOKEN` from `.env`

### Task 7.2: Code Cleanup
- Deprecate `services/apify_service.js` with header comment
- Remove Apify fallback paths from `collection_service.js`
- Rename `bin/apify_review_remediation.js` → `bin/review_remediation.js`
- Update `docs/SOURCES.md` to reflect new source tiers and court demotion

---

## Cost Summary

| Item | Cost | Notes |
|------|------|-------|
| DataForSEO Google reviews (740 remediation) | ~$5.55 | 74K reviews at $0.075/1K |
| DataForSEO Google reviews (new batches, ~441 remaining roofing) | ~$3.31 | 44K reviews |
| DataForSEO Yelp reviews (all roofing) | ~$1.16 | 15K reviews |
| Serper credits (Reddit 3-query + existing) | ~3,500 credits | From 19K remaining |
| Reddit RSS monitoring | $0 | Free RSS feeds, local cron |
| Apify subscription cancelled | **-$40/mo saved** | |
| **Total one-time** | **~$10** | |
| **Monthly savings** | **$40/mo** | Apify cancellation |

---

## Implementation Order (Critical Path)

```
Day 1: Phase 1 (gate + demotion + source tiers + court demotion) ← UNBLOCKS EVERYTHING
Day 1-2: Phase 2 Tasks 2.1-2.2 (Google remediation) ← UNBLOCKS SWISS
Day 2: Phase 5 (BBB detail enforcement)
Day 3: Phase 3 (Reddit: Serper multi-query + RSS monitor activation)
Day 3-4: Phase 4 (Yelp DataForSEO integration)
Day 4: Phase 6 (pipeline integration + quality report)
Day 5: Phase 7 (Apify cleanup) + Phase 2 Task 2.3 (remove Apify code)
```

**Swiss scoring can resume after Day 2** (Phase 1 + Phase 2 complete).

---

## Success Criteria

| Metric | Current | Target | Verification |
|--------|---------|--------|--------------|
| Google review text >= 10 | 213/879 (24%) | >80% of scored | Quality gate report |
| Placeholder sources in scoring | 4 sources | 0 | Source tier check |
| Reddit coverage (Serper) | 14% | >50% | Coverage report |
| Reddit RSS monitor | Not active | Running 15-min cron | `crontab -l` |
| Yelp review TEXT | 0% | >40% (of those with Yelp) | Coverage report |
| BBB complaint TEXT | Unknown | 100% (of those with BBB) | Quality gate |
| Active source groups | 38 | 6 critical + 2 supplementary | Source tier config |
| Court records | Critical (gated) | Supplementary (not gated) | Source tier config |
| Monthly subscription cost | $40 (Apify) | $0 | Cancel confirmation |

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| DataForSEO Yelp pricing higher than estimated | Medium | Low ($1-5 difference) | Test with 10 contractors first |
| Reddit Serper coverage stays below 50% | Medium | Low | RSS monitor fills gap proactively; Reddit is free to keep trying |
| DataForSEO rate limits during bulk remediation | Low | Medium | Batch with delays; standard queue is throttled anyway |
| BBB detail scraper blocked by rate limiting | Low | Medium | Add delays between requests; httpx already has backoff |
| DataForSEO Yelp alias resolution fails for some contractors | Medium | Low | Fall back to metadata-only for those contractors |
