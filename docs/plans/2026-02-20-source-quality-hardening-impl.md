# Source Quality Hardening (80/20) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cut from 38 noisy sources to 6 high-signal groups with full review text, unblocking Swiss scoring for roofing launch.

**Architecture:** Centralized source tier config (`config/source_tiers.js`) controls what gets collected, gated, and scored. DataForSEO handles Google + Yelp review text. Reddit gets promoted with multi-query Serper + RSS monitor. Placeholder sources demoted. Court records demoted to supplementary. Quality gate checks text content, not just HTTP status.

**Tech Stack:** Node.js, DataForSEO API (Google Reviews + Yelp Reviews), Serper API, Python (feedparser for Reddit RSS, httpx for BBB), PostgreSQL.

**Architecture doc:** `docs/plans/2026-02-20-source-quality-hardening.md`

---

## Task 1: Create Source Tier Configuration

**Files:**
- Create: `config/source_tiers.js`
- Test: `tests/test_source_tiers.js`

**Step 1: Write the test**

Create `tests/test_source_tiers.js`:

```javascript
#!/usr/bin/env node
/**
 * Tests for source tier configuration.
 * Run: node tests/test_source_tiers.js
 */

const tiers = require('../config/source_tiers');

// All tier arrays exist
console.assert(Array.isArray(tiers.critical), 'critical must be an array');
console.assert(Array.isArray(tiers.important), 'important must be an array');
console.assert(Array.isArray(tiers.supplementary), 'supplementary must be an array');
console.assert(Array.isArray(tiers.demoted), 'demoted must be an array');

// Critical sources present
console.assert(tiers.critical.includes('google_maps_local'), 'google_maps_local must be critical');
console.assert(tiers.critical.includes('bbb'), 'bbb must be critical');
console.assert(tiers.critical.includes('county_liens'), 'county_liens must be critical');
console.assert(tiers.critical.includes('reddit'), 'reddit must be critical');

// Demoted sources present
console.assert(tiers.demoted.includes('facebook'), 'facebook must be demoted');
console.assert(tiers.demoted.includes('thumbtack'), 'thumbtack must be demoted');
console.assert(tiers.demoted.includes('porch'), 'porch must be demoted');
console.assert(tiers.demoted.includes('buildzoom'), 'buildzoom must be demoted');
console.assert(tiers.demoted.includes('youtube'), 'youtube must be demoted');
console.assert(tiers.demoted.includes('nextdoor_search'), 'nextdoor_search must be demoted');

// Court records are supplementary (NOT critical)
console.assert(tiers.supplementary.includes('court_records'), 'court_records must be supplementary');
console.assert(!tiers.critical.includes('court_records'), 'court_records must NOT be critical');

// No source appears in multiple tiers
const all = [...tiers.critical, ...tiers.important, ...tiers.supplementary, ...tiers.demoted];
const unique = new Set(all);
console.assert(all.length === unique.size, `Duplicate source found! ${all.length} total vs ${unique.size} unique`);

// Helper functions
console.assert(typeof tiers.isDemoted === 'function', 'isDemoted must be a function');
console.assert(tiers.isDemoted('facebook') === true, 'facebook should be demoted');
console.assert(tiers.isDemoted('bbb') === false, 'bbb should NOT be demoted');

console.assert(typeof tiers.isCritical === 'function', 'isCritical must be a function');
console.assert(tiers.isCritical('google_maps_local') === true, 'google_maps_local should be critical');
console.assert(tiers.isCritical('youtube') === false, 'youtube should NOT be critical');

console.log('✅ All source tier tests passed');
```

**Step 2: Run the test to verify it fails**

```bash
cd /home/astre/command-center/src/greenlit/auditor && node tests/test_source_tiers.js
```

Expected: `Cannot find module '../config/source_tiers'`

**Step 3: Create the implementation**

Create `config/source_tiers.js`:

```javascript
/**
 * Source Tier Configuration
 *
 * Central registry for all data source classifications.
 * Used by collection, gate verification, and scoring context.
 *
 * Tiers:
 *   critical     - Must be present and pass quality gate. Pipeline blocks without these.
 *   important    - Collected and scored, but pipeline doesn't block if missing.
 *   supplementary - Collected when available, included in scoring but never gated.
 *   demoted      - Skipped during collection. Existing DB rows excluded from scoring.
 */

const critical = [
  'google_maps_local',
  'bbb',
  'county_liens',
  'tx_franchise',
  'reddit'
];

const important = [
  'yelp', 'yelp_yahoo',
  'google_news', 'local_news',
  'osha', 'epa_echo',
  'angi', 'houzz',
  'google_maps_hq', 'google_maps_listed',
  'tx_sos_search', 'tx_ag_complaints'
];

const supplementary = [
  'court_records',
  'dallas_court', 'tarrant_court', 'collin_court', 'denton_court',
  'court_listener',
  'website', 'website_warranty'
];

const demoted = [
  'facebook', 'thumbtack', 'porch', 'buildzoom',
  'homeadvisor', 'open_corporates', 'trustpilot',
  'glassdoor', 'indeed', 'nextdoor_search', 'youtube'
];

const _demotedSet = new Set(demoted);
const _criticalSet = new Set(critical);
const _importantSet = new Set(important);

module.exports = {
  critical,
  important,
  supplementary,
  demoted,
  isDemoted: (source) => _demotedSet.has(source),
  isCritical: (source) => _criticalSet.has(source),
  isImportant: (source) => _importantSet.has(source),
  isActive: (source) => !_demotedSet.has(source)
};
```

**Step 4: Run the test to verify it passes**

```bash
cd /home/astre/command-center/src/greenlit/auditor && node tests/test_source_tiers.js
```

Expected: `✅ All source tier tests passed`

**Step 5: Commit**

```bash
cd /home/astre/command-center/src/greenlit/auditor && git add config/source_tiers.js tests/test_source_tiers.js && git commit -m "feat: add centralized source tier configuration"
```

---

## Task 2: Wire Demotion Into Collection Pipeline

**Files:**
- Modify: `services/collection_service.js` (lines ~2694-2732)

**Context:** The collection pipeline iterates over `serperSources` at line 2694. We need to skip demoted sources there and in the Trustpilot block above it. The `SOURCES` constant at line 722 also needs annotation.

**Step 1: Add tier import at top of collection_service.js**

Near the other `require` statements at the top of `services/collection_service.js`, add:

```javascript
const sourceTiers = require('../config/source_tiers');
```

**Step 2: Filter the serperSources array**

At line ~2694 in `services/collection_service.js`, the `serperSources` array is:

```javascript
    const serperSources = [
      { key: 'homeadvisor', name: 'HomeAdvisor' },
      { key: 'glassdoor', name: 'Glassdoor' },
      { key: 'indeed', name: 'Indeed' },
      { key: 'reddit', name: 'Reddit' },
      { key: 'osha', name: 'OSHA' },
      { key: 'google_news', name: 'News' },
    ];
```

Replace with:

```javascript
    const serperSources = [
      { key: 'homeadvisor', name: 'HomeAdvisor' },
      { key: 'glassdoor', name: 'Glassdoor' },
      { key: 'indeed', name: 'Indeed' },
      { key: 'reddit', name: 'Reddit' },
      { key: 'osha', name: 'OSHA' },
      { key: 'google_news', name: 'News' },
    ].filter(s => !sourceTiers.isDemoted(s.key));
```

**Step 3: Skip Trustpilot collection (demoted)**

Find the Trustpilot block (around line ~2650). Wrap it with a demotion check. Before the `try {` for Trustpilot, add:

```javascript
    if (!sourceTiers.isDemoted('trustpilot')) {
```

And close the `}` after the Trustpilot `catch` block.

**Step 4: Skip demoted sources in Apify/fallback paths**

At line ~2373, the Apify fallback block starts with:
```javascript
        if (!gmapsLocalResult && USE_APIFY && APIFY_API_TOKEN) {
```

Add a comment marking this for removal in Task 10 (Apify cleanup). For now, leave it.

**Step 5: Verify by running a dry collection check**

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate && set -a && . ./.env && set +a
node -e "
  const sourceTiers = require('./config/source_tiers');
  const serperSources = [
    { key: 'homeadvisor' }, { key: 'glassdoor' }, { key: 'indeed' },
    { key: 'reddit' }, { key: 'osha' }, { key: 'google_news' }
  ].filter(s => !sourceTiers.isDemoted(s.key));
  console.log('Active serper sources:', serperSources.map(s => s.key));
  console.log('Expected: reddit, osha, google_news');
"
```

Expected: `Active serper sources: [ 'reddit', 'osha', 'google_news' ]`

**Step 6: Commit**

```bash
cd /home/astre/command-center/src/greenlit/auditor && git add services/collection_service.js && git commit -m "feat: skip demoted sources during collection using source tier config"
```

---

## Task 3: Update Source Gate (Remove Court Records, Add Reddit)

**Files:**
- Modify: `bin/source_missing_from_manifest.js` (lines ~39-73)

**Step 1: Update the default required rules**

In `bin/source_missing_from_manifest.js`, change `DEFAULT_REQUIRED_RULE_KEYS` (line ~67):

From:
```javascript
const DEFAULT_REQUIRED_RULE_KEYS = [
  'google_presence',
  'bbb',
  'court_records',
  'county_liens',
  'tx_franchise'
];
```

To:
```javascript
const DEFAULT_REQUIRED_RULE_KEYS = [
  'google_presence',
  'bbb',
  'county_liens',
  'tx_franchise',
  'reddit'
];
```

**Step 2: Add Reddit rule to BUILTIN_RULES**

In the `BUILTIN_RULES` object (line ~39), add after `tx_franchise`:

```javascript
  reddit: {
    key: 'reddit',
    description: 'Reddit search present',
    allOf: ['reddit']
  }
```

**Step 3: Verify the gate runs with the new rules**

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate && set -a && . ./.env && set +a
node bin/source_missing_from_manifest.js \
  --config=experiments/hybrid_100_roof_A/config/sample_100_group_roof_A.json \
  --verify-only 2>&1 | head -30
```

Expected: Gate no longer flags `court_records` as missing. May flag `reddit` for some contractors.

**Step 4: Commit**

```bash
cd /home/astre/command-center/src/greenlit/auditor && git add bin/source_missing_from_manifest.js && git commit -m "feat: update source gate - demote court_records, require reddit"
```

---

## Task 4: Add Quality-Aware Google Review Text Gate

**Files:**
- Create: `services/source_quality.js`
- Test: `tests/test_source_quality.js`

**Step 1: Write the test**

Create `tests/test_source_quality.js`:

```javascript
#!/usr/bin/env node
/**
 * Tests for source quality assessment.
 * Run: node tests/test_source_quality.js
 */

const { assessGoogleReviewQuality } = require('../services/source_quality');

// Test with good data (>=10 non-empty reviews)
const good = assessGoogleReviewQuality({
  reviews: Array(15).fill(null).map((_, i) => ({ text: `Review ${i}`, rating: 5 })),
  review_count: 15
});
console.assert(good.quality === 'high', `Expected high, got ${good.quality}`);
console.assert(good.nonempty_count === 15, `Expected 15 nonempty, got ${good.nonempty_count}`);
console.assert(good.needs_remediation === false, 'Should not need remediation');

// Test with medium data (5-9 non-empty reviews)
const medium = assessGoogleReviewQuality({
  reviews: Array(7).fill(null).map((_, i) => ({ text: `Review ${i}`, rating: 4 })),
  review_count: 7
});
console.assert(medium.quality === 'medium', `Expected medium, got ${medium.quality}`);

// Test with low data (<5 non-empty reviews)
const low = assessGoogleReviewQuality({
  reviews: [{ text: 'Only one', rating: 5 }, { text: '', rating: 3 }],
  review_count: 50
});
console.assert(low.quality === 'low', `Expected low, got ${low.quality}`);
console.assert(low.needs_remediation === true, 'Should need remediation');
console.assert(low.nonempty_count === 1, `Expected 1 nonempty, got ${low.nonempty_count}`);

// Test with zero reviews
const none = assessGoogleReviewQuality({ reviews: [], review_count: 100 });
console.assert(none.quality === 'none', `Expected none, got ${none.quality}`);
console.assert(none.needs_remediation === true, 'Should need remediation');

// Test with null/missing reviews
const missing = assessGoogleReviewQuality({});
console.assert(missing.quality === 'none', `Expected none for missing, got ${missing.quality}`);

// Test critical mismatch: high review_count but zero text
const mismatch = assessGoogleReviewQuality({ reviews: [], review_count: 200 });
console.assert(mismatch.critical_mismatch === true, 'Should flag critical mismatch');

console.log('✅ All source quality tests passed');
```

**Step 2: Run the test to verify it fails**

```bash
cd /home/astre/command-center/src/greenlit/auditor && node tests/test_source_quality.js
```

Expected: `Cannot find module '../services/source_quality'`

**Step 3: Create the implementation**

Create `services/source_quality.js`:

```javascript
/**
 * Source Quality Assessment
 *
 * Evaluates evidence quality beyond binary found/not_found.
 * Used by source gate and batch quality reports.
 */

const REVIEW_TEXT_HIGH = 10;   // >=10 non-empty review texts = high quality
const REVIEW_TEXT_MEDIUM = 5;  // 5-9 = medium
const MISMATCH_THRESHOLD = 50; // review_count >= 50 but text < 5 = critical mismatch

/**
 * Assess Google review text quality from structured data.
 * @param {object} data - structured_data from google_maps_local/hq/listed
 * @returns {object} { quality, nonempty_count, total_count, needs_remediation, critical_mismatch }
 */
function assessGoogleReviewQuality(data) {
  const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
  const reviewCount = data?.review_count || 0;
  const nonemptyCount = reviews.filter(r => r && typeof r.text === 'string' && r.text.trim().length > 0).length;

  let quality;
  if (nonemptyCount >= REVIEW_TEXT_HIGH) {
    quality = 'high';
  } else if (nonemptyCount >= REVIEW_TEXT_MEDIUM) {
    quality = 'medium';
  } else if (nonemptyCount > 0) {
    quality = 'low';
  } else {
    quality = 'none';
  }

  const criticalMismatch = reviewCount >= MISMATCH_THRESHOLD && nonemptyCount < REVIEW_TEXT_MEDIUM;

  return {
    quality,
    nonempty_count: nonemptyCount,
    total_reviews: reviews.length,
    reported_count: reviewCount,
    needs_remediation: nonemptyCount < REVIEW_TEXT_HIGH,
    critical_mismatch: criticalMismatch
  };
}

module.exports = { assessGoogleReviewQuality, REVIEW_TEXT_HIGH, REVIEW_TEXT_MEDIUM };
```

**Step 4: Run the test to verify it passes**

```bash
cd /home/astre/command-center/src/greenlit/auditor && node tests/test_source_quality.js
```

Expected: `✅ All source quality tests passed`

**Step 5: Commit**

```bash
cd /home/astre/command-center/src/greenlit/auditor && git add services/source_quality.js tests/test_source_quality.js && git commit -m "feat: add source quality assessment for Google review text"
```

---

## Task 5: Run Google Review DataForSEO Remediation (Scored Cohort)

**Files:** None (execution only — uses existing `bin/apify_review_remediation.js`)

**Step 1: Run pilot batch of 10**

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate && set -a && . ./.env && set +a
node bin/apify_review_remediation.js --scope scored --batch-size 10 --limit 10 \
  --provider dataforseo --max-reviews 200 --min-nonempty 10
```

Expected: 10/10 pass (100%). If <90%, STOP and investigate before continuing.

**Step 2: Scale to batches of 25**

```bash
node bin/apify_review_remediation.js --scope scored --batch-size 25 --limit 100 \
  --provider dataforseo --max-reviews 200 --min-nonempty 10
```

Expected: ~96-100% pass rate per batch.

**Step 3: Run remaining (~640 left)**

```bash
node bin/apify_review_remediation.js --scope scored --batch-size 25 --limit 740 \
  --provider dataforseo --max-reviews 200 --min-nonempty 10
```

**Step 4: Verify remediation**

```bash
node bin/apify_review_remediation.js --scope scored --batch-size 10 --limit 10000 --dry-run
```

Expected: Candidates remaining should be <10% of original 740.

**Cost:** ~$5.55 (74K reviews at $0.075/1K).

**Note:** No commit — this is a data operation, not a code change.

---

## Task 6: Improve Reddit Search (Multi-Query Serper)

**Files:**
- Modify: `services/collection_service.js` (line ~530-544)
- Test: `tests/test_reddit_search.js`

**Step 1: Write the test**

Create `tests/test_reddit_search.js`:

```javascript
#!/usr/bin/env node
/**
 * Tests for improved Reddit search query builder.
 * Run: node tests/test_reddit_search.js
 */

const { buildRedditQueries } = require('../services/collection_service');

const queries = buildRedditQueries('Texas Vets Roofing', 'Fort Worth', 'TX');

console.assert(Array.isArray(queries), 'Should return array');
console.assert(queries.length === 3, `Expected 3 queries, got ${queries.length}`);

// First query: exact name + DFW context
console.assert(queries[0].includes('site:reddit.com'), 'Q1 should be reddit-scoped');
console.assert(queries[0].includes('"Texas Vets Roofing"'), 'Q1 should have exact business name');
console.assert(queries[0].includes('Fort Worth') || queries[0].includes('DFW'), 'Q1 should have location');

// Second query: name in industry subreddits
console.assert(queries[1].includes('reddit.com/r/'), 'Q2 should target specific subreddits');
console.assert(queries[1].includes('"Texas Vets Roofing"'), 'Q2 should have exact business name');

// Third query: broader category search
console.assert(queries[2].includes('site:reddit.com'), 'Q3 should be reddit-scoped');
console.assert(queries[2].includes('roofing') || queries[2].includes('review') || queries[2].includes('complaint'), 'Q3 should have category terms');

console.log('✅ All Reddit search tests passed');
```

**Step 2: Run the test to verify it fails**

```bash
cd /home/astre/command-center/src/greenlit/auditor && node tests/test_reddit_search.js
```

Expected: `buildRedditQueries is not a function`

**Step 3: Add the implementation**

In `services/collection_service.js`, after the `buildSerperQuery` function (line ~544), add:

```javascript
/**
 * Build multiple Reddit search queries for higher coverage.
 * Returns 3 queries: local context, subreddit-targeted, and broad catch.
 */
function buildRedditQueries(businessName, city, state) {
  return [
    `site:reddit.com "${businessName}" (${city} OR DFW OR "Dallas Fort Worth")`,
    `site:reddit.com/r/roofing OR site:reddit.com/r/homeimprovement OR site:reddit.com/r/homeowners "${businessName}"`,
    `site:reddit.com "${businessName}" roofing review OR complaint OR experience OR recommend`
  ];
}
```

Then update the `module.exports` at the bottom of the file to include `buildRedditQueries`.

Also update `buildSerperQuery` to no longer handle reddit (it'll be handled separately):

In the `queries` object inside `buildSerperQuery`, change:
```javascript
    reddit: `site:reddit.com "${businessName}" ${city}`,
```
to:
```javascript
    // reddit: handled by buildRedditQueries() multi-query strategy
```

**Step 4: Update the Serper collection loop to use multi-query for Reddit**

In the collection loop (line ~2703), before the `for (const { key, name } of serperSources)` loop, add special handling for Reddit:

```javascript
    // Reddit: multi-query strategy for higher coverage
    log('\n  Fetching Reddit mentions (multi-query)...');
    try {
      const redditQueries = buildRedditQueries(contractor.name, contractor.city, contractor.state);
      const allRedditResults = [];
      const seenUrls = new Set();

      for (const query of redditQueries) {
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, num: 10 })
        });
        if (!res.ok) continue;
        const data = await res.json();
        const organic = data.organic || [];
        for (const r of organic) {
          if (r.link && !seenUrls.has(r.link)) {
            seenUrls.add(r.link);
            const subredditMatch = r.link.match(/reddit\.com\/r\/([^/]+)/);
            allRedditResults.push({
              title: r.title,
              snippet: r.snippet,
              url: r.link,
              subreddit: subredditMatch ? `r/${subredditMatch[1]}` : null,
              date: r.date || null
            });
          }
        }
      }

      const redditData = {
        source: 'reddit',
        url: allRedditResults[0]?.url || `https://reddit.com/search?q=${encodeURIComponent(contractor.name)}`,
        status: allRedditResults.length > 0 ? 'success' : 'not_found',
        text: JSON.stringify({ results: allRedditResults, query_count: redditQueries.length }, null, 2),
        structured: { found: allRedditResults.length > 0, results: allRedditResults, result_count: allRedditResults.length }
      };
      await this.storeRawData(contractorId, 'reddit', redditData);
      await this.logCollectionRequest(contractorId, 'reddit', 'initial', 'Multi-query Reddit search');
      results.push(redditData);

      if (allRedditResults.length > 0) {
        success(`    Reddit: ${allRedditResults.length} mention(s) across ${redditQueries.length} queries`);
      } else {
        warn(`    Reddit: No mentions found`);
      }
    } catch (err) {
      if (isSourceFundingError(err)) throw err;
      warn(`    Reddit: Error - ${err.message}`);
    }
```

Then remove `{ key: 'reddit', name: 'Reddit' }` from the `serperSources` array (since Reddit is now handled separately above).

**Step 5: Run the test to verify it passes**

```bash
cd /home/astre/command-center/src/greenlit/auditor && node tests/test_reddit_search.js
```

Expected: `✅ All Reddit search tests passed`

**Step 6: Commit**

```bash
cd /home/astre/command-center/src/greenlit/auditor && git add services/collection_service.js tests/test_reddit_search.js && git commit -m "feat: multi-query Reddit search for higher coverage"
```

---

## Task 7: Create Reddit RSS Monitor

**Files:**
- Create: `scripts/reddit_rss_monitor.py`
- Create: `scripts/run_reddit_monitor.sh`

**Reference:** `docs/plans/archive/2025-12-13-reddit-rss-monitor-python.md`

**Step 1: Install feedparser**

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate && pip install feedparser
```

**Step 2: Create the monitor script**

Create `scripts/reddit_rss_monitor.py`:

```python
#!/usr/bin/env python3
"""
Reddit RSS Monitor for contractor mentions.

Polls subreddit RSS feeds for keyword matches and contractor name mentions.
Stores matches in contractor_raw_data as 'reddit_rss' source.
Run via cron every 15 minutes.

Usage:
  python scripts/reddit_rss_monitor.py              # dry run (print matches)
  python scripts/reddit_rss_monitor.py --store      # store matches to DB
  python scripts/reddit_rss_monitor.py --list-subs  # show monitored subreddits
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import feedparser

SUBREDDITS = [
    "dallas", "fortworth", "dfw",
    "homeimprovement", "homeowners",
    "Contractors", "RoofingContractors",
    "swimmingpools", "landscaping", "roofing"
]

KEYWORDS = [
    "roofing contractor", "roofer", "roofing company",
    "storm damage", "hail damage", "insurance claim",
    "looking for contractor", "need a roofer", "recommend",
    "avoid", "scam", "rip off", "terrible", "nightmare",
    "pool builder", "pool contractor"
]

SEEN_FILE = Path(__file__).parent.parent / "data" / "reddit_rss_seen.json"


def load_seen():
    if SEEN_FILE.exists():
        return set(json.loads(SEEN_FILE.read_text()))
    return set()


def save_seen(seen):
    SEEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    # Keep last 5000 entries to prevent unbounded growth
    SEEN_FILE.write_text(json.dumps(list(seen)[-5000:]))


def matches_keywords(text):
    text_lower = text.lower()
    return [kw for kw in KEYWORDS if kw.lower() in text_lower]


def fetch_feeds():
    results = []
    seen = load_seen()

    for sub in SUBREDDITS:
        try:
            feed = feedparser.parse(f"https://www.reddit.com/r/{sub}/new/.rss")
            for entry in feed.entries:
                if entry.id in seen:
                    continue
                seen.add(entry.id)

                combined = f"{entry.title} {getattr(entry, 'summary', '')}"
                matched = matches_keywords(combined)
                if matched:
                    results.append({
                        "subreddit": f"r/{sub}",
                        "title": entry.title,
                        "url": entry.link,
                        "snippet": getattr(entry, "summary", "")[:500],
                        "matched_keywords": matched,
                        "published": getattr(entry, "published", None),
                        "fetched_at": datetime.now(timezone.utc).isoformat()
                    })
        except Exception as e:
            print(f"[WARN] r/{sub}: {e}", file=sys.stderr)

    save_seen(seen)
    return results


def main():
    parser = argparse.ArgumentParser(description="Reddit RSS Monitor")
    parser.add_argument("--store", action="store_true", help="Store matches to DB")
    parser.add_argument("--list-subs", action="store_true", help="List monitored subreddits")
    args = parser.parse_args()

    if args.list_subs:
        for sub in SUBREDDITS:
            print(f"r/{sub}")
        return

    results = fetch_feeds()

    if not results:
        print("No new keyword matches found.")
        return

    for r in results:
        print(f"[{r['subreddit']}] {r['title']}")
        print(f"  Keywords: {', '.join(r['matched_keywords'])}")
        print(f"  URL: {r['url']}")
        print()

    print(f"Total: {len(results)} new matches")


if __name__ == "__main__":
    main()
```

**Step 3: Create the cron wrapper**

Create `scripts/run_reddit_monitor.sh`:

```bash
#!/bin/bash
cd "$(dirname "$0")/.."
source venv/bin/activate
set -a && . ./.env && set +a
python scripts/reddit_rss_monitor.py "$@"
```

```bash
chmod +x /home/astre/command-center/src/greenlit/auditor/scripts/run_reddit_monitor.sh
```

**Step 4: Test the script**

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate
python scripts/reddit_rss_monitor.py --list-subs
python scripts/reddit_rss_monitor.py
```

Expected: Lists subreddits, then prints any keyword matches from recent posts.

**Step 5: Commit**

```bash
cd /home/astre/command-center/src/greenlit/auditor && git add scripts/reddit_rss_monitor.py scripts/run_reddit_monitor.sh && git commit -m "feat: add Reddit RSS monitor for contractor mention detection"
```

**Step 6: Set up cron (user action)**

```bash
(crontab -l 2>/dev/null; echo "*/15 * * * * /home/astre/command-center/src/greenlit/auditor/scripts/run_reddit_monitor.sh >> /home/astre/command-center/src/greenlit/auditor/logs/reddit_rss.log 2>&1") | crontab -
```

---

## Task 8: DataForSEO Yelp Reviews Integration

**Files:**
- Create: `services/dataforseo_yelp_service.js`
- Test: `tests/test_dataforseo_yelp.js`

**Step 1: Write the test**

Create `tests/test_dataforseo_yelp.js`:

```javascript
#!/usr/bin/env node
/**
 * DataForSEO Yelp Reviews - Unit + Live Test
 * Run: node tests/test_dataforseo_yelp.js
 * Live: node tests/test_dataforseo_yelp.js --live
 */

const path = require('path');
const fs = require('fs');

// Load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const { transformYelpReview, extractYelpAlias } = require('../services/dataforseo_yelp_service');

// Test transform
const raw = {
  review_text: 'Great roofing work!',
  rating: { value: 5 },
  time_ago: '2 months ago',
  profile_name: 'Jane D.',
  profile_url: 'https://www.yelp.com/user_details?userid=abc123'
};

const transformed = transformYelpReview(raw);
console.assert(transformed.text === 'Great roofing work!', 'text should match');
console.assert(transformed.rating === 5, 'rating should be 5');
console.assert(transformed.reviewer_name === 'Jane D.', 'reviewer_name should match');
console.assert(transformed.source === 'yelp', 'source should be yelp');
console.assert(transformed.provider === 'dataforseo', 'provider should be dataforseo');

// Test alias extraction
console.assert(
  extractYelpAlias('https://www.yelp.com/biz/texas-vets-roofing-fort-worth') === 'texas-vets-roofing-fort-worth',
  'Should extract alias from Yelp URL'
);
console.assert(
  extractYelpAlias('https://www.yelp.com/biz/abc-roofing-dallas-2') === 'abc-roofing-dallas-2',
  'Should extract alias with trailing number'
);
console.assert(extractYelpAlias('https://google.com') === null, 'Should return null for non-Yelp URL');
console.assert(extractYelpAlias(null) === null, 'Should return null for null');

console.log('✅ All Yelp transform + alias tests passed');

// Live test (only with --live flag)
if (process.argv.includes('--live')) {
  const { fetchYelpReviews } = require('../services/dataforseo_yelp_service');
  (async () => {
    console.log('\nLive test: fetching Yelp reviews...');
    const result = await fetchYelpReviews({ alias: 'texas-vets-roofing-fort-worth', maxReviews: 10 });
    console.log(`Found: ${result.found}, Reviews: ${result.reviews?.length || 0}`);
    if (result.reviews?.length > 0) {
      console.log(`Sample: "${result.reviews[0].text?.slice(0, 80)}..."`);
    }
    console.log('✅ Live Yelp test passed');
  })().catch(err => {
    console.error('Live test failed:', err.message);
    process.exit(1);
  });
}
```

**Step 2: Run the test to verify it fails**

```bash
cd /home/astre/command-center/src/greenlit/auditor && node tests/test_dataforseo_yelp.js
```

Expected: `Cannot find module '../services/dataforseo_yelp_service'`

**Step 3: Create the implementation**

Create `services/dataforseo_yelp_service.js`:

```javascript
/**
 * DataForSEO Yelp Reviews Service
 *
 * Fetches Yelp review text via DataForSEO Business Data API.
 * Endpoint: POST /v3/business_data/yelp/reviews/task_post
 * Billing: per 10 reviews returned.
 * Docs: https://docs.dataforseo.com/v3/business_data/yelp/reviews/
 */

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3';
const HTTP_TIMEOUT_MS = Math.max(5000, parseInt(process.env.DATAFORSEO_HTTP_TIMEOUT_MS || '45000', 10));

const POLL_INTERVAL_MS = 15000;
const MAX_POLL_TIME_MS = 1200000;

async function fetchWithTimeout(url, options = {}, timeoutMs = HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`DataForSEO Yelp request timeout after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getAuthHeader() {
  if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) {
    throw new Error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set');
  }
  return `Basic ${Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64')}`;
}

/**
 * Extract Yelp alias from a Yelp URL.
 * @param {string} url - e.g. "https://www.yelp.com/biz/texas-vets-roofing-fort-worth"
 * @returns {string|null} - e.g. "texas-vets-roofing-fort-worth"
 */
function extractYelpAlias(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/yelp\.com\/biz\/([\w-]+)/);
  return match ? match[1] : null;
}

async function postYelpReviewTask({ alias, depth = 50, sort_by = 'newest' }) {
  const taskData = { alias, depth, sort_by };

  const response = await fetchWithTimeout(`${DATAFORSEO_API_BASE}/business_data/yelp/reviews/task_post`, {
    method: 'POST',
    headers: { 'Authorization': getAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify([taskData])
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DataForSEO Yelp task_post failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (data.status_code !== 20000) throw new Error(`DataForSEO API error: ${data.status_message}`);

  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20100) throw new Error(`DataForSEO task error: ${task?.status_message || 'Unknown'}`);

  return { id: task.id, cost: data.cost };
}

async function pollAndGetYelpResults(taskId) {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    const readyResponse = await fetchWithTimeout(`${DATAFORSEO_API_BASE}/business_data/yelp/reviews/tasks_ready`, {
      headers: { 'Authorization': getAuthHeader() }
    });
    if (!readyResponse.ok) continue;

    const readyData = await readyResponse.json();
    const readyTasks = readyData.tasks?.[0]?.result || [];
    if (!readyTasks.some(t => t.id === taskId)) continue;

    const resultResponse = await fetchWithTimeout(`${DATAFORSEO_API_BASE}/business_data/yelp/reviews/task_get/${taskId}`, {
      headers: { 'Authorization': getAuthHeader() }
    });
    if (!resultResponse.ok) throw new Error(`DataForSEO Yelp task_get failed (${resultResponse.status})`);

    const resultData = await resultResponse.json();
    if (resultData.status_code !== 20000) throw new Error(`DataForSEO Yelp results error: ${resultData.status_message}`);

    return resultData.tasks?.[0];
  }

  throw new Error(`DataForSEO Yelp task ${taskId} timed out after ${MAX_POLL_TIME_MS / 1000}s`);
}

function transformYelpReview(raw) {
  return {
    text: raw.review_text || null,
    rating: raw.rating?.value || null,
    reviewer_name: raw.profile_name || null,
    reviewer_url: raw.profile_url || null,
    time_ago: raw.time_ago || null,
    timestamp: raw.timestamp || null,
    source: 'yelp',
    provider: 'dataforseo'
  };
}

/**
 * Fetch Yelp reviews for a business.
 * @param {object} params
 * @param {string} params.alias - Yelp business alias
 * @param {number} [params.maxReviews=50] - Max reviews to fetch
 * @returns {Promise<object>} { found, reviews, review_count, alias }
 */
async function fetchYelpReviews({ alias, maxReviews = 50 }) {
  if (!alias) return { found: false, reviews: [], review_count: 0, error: 'No alias provided' };

  const task = await postYelpReviewTask({ alias, depth: maxReviews });
  console.log(`    [DataForSEO Yelp] Task posted: ${task.id} (cost: ${task.cost})`);

  const result = await pollAndGetYelpResults(task.id);
  const items = result?.result?.[0]?.items || [];

  const reviews = items.map(transformYelpReview);
  const nonempty = reviews.filter(r => r.text && r.text.trim().length > 0);

  return {
    found: reviews.length > 0,
    reviews,
    review_count: result?.result?.[0]?.reviews_count || reviews.length,
    nonempty_count: nonempty.length,
    alias,
    provider: 'dataforseo'
  };
}

module.exports = { postYelpReviewTask, pollAndGetYelpResults, transformYelpReview, fetchYelpReviews, extractYelpAlias };
```

**Step 4: Run the test to verify it passes**

```bash
cd /home/astre/command-center/src/greenlit/auditor && node tests/test_dataforseo_yelp.js
```

Expected: `✅ All Yelp transform + alias tests passed`

**Step 5: Run the live test (requires DataForSEO credentials)**

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate && set -a && . ./.env && set +a
node tests/test_dataforseo_yelp.js --live
```

Expected: Returns Yelp reviews for Texas Vets Roofing.

**Step 6: Commit**

```bash
cd /home/astre/command-center/src/greenlit/auditor && git add services/dataforseo_yelp_service.js tests/test_dataforseo_yelp.js && git commit -m "feat: add DataForSEO Yelp reviews integration"
```

---

## Task 9: Wire Yelp Reviews Into Collection Pipeline

**Files:**
- Modify: `services/collection_service.js`

**Step 1: Add import**

Near the top of `services/collection_service.js`, add:

```javascript
const { fetchYelpReviews, extractYelpAlias } = require('./dataforseo_yelp_service');
```

**Step 2: Add Yelp review enrichment**

Find the Yelp Yahoo fallback block (around line ~2600 where `yelp_yahoo` is stored). After both Yelp sources (Serper + Yahoo) are collected, add:

```javascript
      // Yelp review text enrichment via DataForSEO
      try {
        const existingYelpRows = results.filter(r => (r.source === 'yelp' || r.source === 'yelp_yahoo') && r.status === 'success');
        let alias = null;
        for (const row of existingYelpRows) {
          const url = row.structured?.yelp_url || row.structured?.url || row.url;
          alias = extractYelpAlias(url);
          if (alias) break;
        }

        if (alias) {
          log(`    Fetching Yelp review text via DataForSEO (alias: ${alias})...`);
          const yelpReviews = await fetchYelpReviews({ alias, maxReviews: 50 });
          if (yelpReviews.found && yelpReviews.reviews.length > 0) {
            // Merge review text into the yelp source row
            const yelpEnriched = {
              source: 'yelp',
              url: `https://www.yelp.com/biz/${alias}`,
              status: 'success',
              text: JSON.stringify(yelpReviews, null, 2),
              structured: yelpReviews
            };
            await this.storeRawData(contractorId, 'yelp', yelpEnriched);
            success(`    Yelp reviews: ${yelpReviews.nonempty_count} texts from ${yelpReviews.review_count} total`);
          }
        }
      } catch (yelpErr) {
        if (isSourceFundingError(yelpErr)) throw yelpErr;
        warn(`    Yelp DataForSEO enrichment failed: ${yelpErr.message}`);
      }
```

**Step 3: Verify with a single contractor**

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate && set -a && . ./.env && set +a
# Pick a contractor ID that has Yelp presence
node bin/run_collect.js --id <some_contractor_id>
```

Check logs for "Yelp reviews: X texts from Y total" line.

**Step 4: Commit**

```bash
cd /home/astre/command-center/src/greenlit/auditor && git add services/collection_service.js && git commit -m "feat: wire DataForSEO Yelp review text into collection pipeline"
```

---

## Task 10: Deprecate Apify + Cleanup

**Files:**
- Modify: `services/apify_service.js` (add deprecation header)
- Modify: `services/collection_service.js` (remove Apify fallback paths)

**Step 1: Add deprecation header to apify_service.js**

Add at the very top of `services/apify_service.js`:

```javascript
// ============================================================
// DEPRECATED (2026-02-20): Apify subscription canceled.
// DataForSEO is the only review lane (Google + Yelp).
// This file is retained for reference only. Do not import.
// ============================================================
```

**Step 2: Remove Apify fallback from collection pipeline**

In `services/collection_service.js`, find the Apify fallback block (around line ~2373):

```javascript
        // FALLBACK: Apify (if enabled and previous methods failed)
        if (!gmapsLocalResult && USE_APIFY && APIFY_API_TOKEN) {
```

Replace the entire `if` block (through its `catch`) with a comment:

```javascript
        // Apify fallback removed (2026-02-20). DataForSEO handles all review text.
```

**Step 3: Verify no import errors**

```bash
cd /home/astre/command-center/src/greenlit/auditor
node -e "require('./services/collection_service'); console.log('Import OK')"
```

Expected: `Import OK`

**Step 4: Commit**

```bash
cd /home/astre/command-center/src/greenlit/auditor && git add services/apify_service.js services/collection_service.js && git commit -m "chore: deprecate Apify, remove fallback from collection pipeline"
```

**Step 5: User action — cancel Apify subscription**

Go to https://console.apify.com/billing and cancel the $40/mo subscription.

---

## Task 11: Create Batch Quality Report

**Files:**
- Create: `bin/batch_quality_report.js`

**Step 1: Create the script**

Create `bin/batch_quality_report.js`:

```javascript
#!/usr/bin/env node
/**
 * Batch Quality Report
 *
 * Generates a quality summary for a set of contractors from a manifest.
 * Shows coverage and quality metrics for high-signal sources.
 *
 * Usage:
 *   node bin/batch_quality_report.js --config=path/to/sample.json
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db_pg');
const { assessGoogleReviewQuality } = require('../services/source_quality');
const sourceTiers = require('../config/source_tiers');

const args = process.argv.slice(2);
const configArg = args.find(a => a.startsWith('--config='));

if (!configArg) {
  console.log('Usage: node bin/batch_quality_report.js --config=path/to/sample.json');
  process.exit(1);
}

const configPath = configArg.split('=')[1];

async function main() {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const contractors = config.contractors || config.sample || config;
  const total = contractors.length;

  console.log(`\n=== Batch Quality Report ===`);
  console.log(`Contractors: ${total}`);
  console.log(`Config: ${configPath}\n`);

  let googleHigh = 0, googleMedium = 0, googleLow = 0, googleNone = 0;
  let bbbWithText = 0, bbbPresent = 0;
  let redditFound = 0;
  let yelpWithText = 0, yelpPresent = 0;
  let liensPresent = 0;

  for (const c of contractors) {
    const id = c.id || c.contractor_id;
    const rows = await db.exec(
      `SELECT source_name, fetch_status, structured_data FROM contractor_raw_data WHERE contractor_id = $1`,
      [id]
    );

    // Google review quality
    const googleRow = rows.find(r => ['google_maps_local', 'google_maps_hq', 'google_maps_listed'].includes(r.source_name) && r.fetch_status === 'success');
    if (googleRow) {
      let data = googleRow.structured_data;
      if (typeof data === 'string') try { data = JSON.parse(data); } catch {}
      const quality = assessGoogleReviewQuality(data);
      if (quality.quality === 'high') googleHigh++;
      else if (quality.quality === 'medium') googleMedium++;
      else if (quality.quality === 'low') googleLow++;
      else googleNone++;
    } else {
      googleNone++;
    }

    // BBB
    const bbbRow = rows.find(r => r.source_name === 'bbb' && r.fetch_status === 'success');
    if (bbbRow) {
      bbbPresent++;
      let data = bbbRow.structured_data;
      if (typeof data === 'string') try { data = JSON.parse(data); } catch {}
      if (data?.complaints?.length > 0 && data.complaints.some(c => c.description)) bbbWithText++;
    }

    // Reddit
    const redditRow = rows.find(r => r.source_name === 'reddit' && r.fetch_status === 'success');
    if (redditRow) redditFound++;

    // Yelp
    const yelpRow = rows.find(r => ['yelp', 'yelp_yahoo'].includes(r.source_name) && r.fetch_status === 'success');
    if (yelpRow) {
      yelpPresent++;
      let data = yelpRow.structured_data;
      if (typeof data === 'string') try { data = JSON.parse(data); } catch {}
      if (data?.reviews?.length > 0) yelpWithText++;
    }

    // County liens
    const liensRow = rows.find(r => r.source_name === 'county_liens');
    if (liensRow) liensPresent++;
  }

  console.log(`Google reviews >= 10 texts (high):  ${googleHigh}/${total} (${pct(googleHigh, total)})`);
  console.log(`Google reviews 5-9 texts (medium):  ${googleMedium}/${total} (${pct(googleMedium, total)})`);
  console.log(`Google reviews < 5 texts (low):     ${googleLow}/${total} (${pct(googleLow, total)})`);
  console.log(`Google reviews no text (none):      ${googleNone}/${total} (${pct(googleNone, total)})`);
  console.log();
  console.log(`BBB present:           ${bbbPresent}/${total} (${pct(bbbPresent, total)})`);
  console.log(`BBB with complaint text: ${bbbWithText}/${bbbPresent || 1} (of those with BBB)`);
  console.log(`Reddit mentions found: ${redditFound}/${total} (${pct(redditFound, total)})`);
  console.log(`Yelp present:          ${yelpPresent}/${total} (${pct(yelpPresent, total)})`);
  console.log(`Yelp with review text: ${yelpWithText}/${yelpPresent || 1} (of those with Yelp)`);
  console.log(`County liens coverage: ${liensPresent}/${total} (${pct(liensPresent, total)})`);
  console.log();

  const passThreshold = 0.80;
  const googleTextPct = googleHigh / total;
  const gate = googleTextPct >= passThreshold ? 'PASS' : 'FAIL';
  console.log(`Quality gate: ${gate} (${pct(googleHigh, total)} Google text >= 10 vs ${passThreshold * 100}% threshold)`);

  await db.close();
}

function pct(n, total) {
  return total > 0 ? `${Math.round(n / total * 100)}%` : '0%';
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Test it**

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate && set -a && . ./.env && set +a
node bin/batch_quality_report.js --config=experiments/hybrid_100_roof_A/config/sample_100_group_roof_A.json
```

Expected: Quality report showing current coverage metrics.

**Step 3: Commit**

```bash
cd /home/astre/command-center/src/greenlit/auditor && git add bin/batch_quality_report.js && git commit -m "feat: add batch quality report for source coverage metrics"
```

---

## Task 12: Update Documentation

**Files:**
- Modify: `docs/SOURCES.md`
- Modify: `state/current.md`

**Step 1: Update SOURCES.md**

Add a "Source Tiers" section at the top of `docs/SOURCES.md` reflecting the 80/20 configuration. Note court records demotion, Reddit promotion, Apify deprecation.

**Step 2: Update state/current.md**

Update current phase from "SOURCE-READINESS 20/80" to reflect completed work. Update batch status, remove resolved blockers.

**Step 3: Commit**

```bash
cd /home/astre/command-center/src/greenlit/auditor && git add docs/SOURCES.md state/current.md && git commit -m "docs: update sources and state to reflect 80/20 source hardening"
```

---

## Execution Summary

| Task | What | Depends On | Est. Time |
|------|------|-----------|-----------|
| 1 | Source tier config | None | 10 min |
| 2 | Wire demotion into collection | Task 1 | 15 min |
| 3 | Update source gate rules | Task 1 | 10 min |
| 4 | Quality-aware review gate | None | 15 min |
| 5 | Run DataForSEO Google remediation | Tasks 1-4 | 30-60 min (waiting) |
| 6 | Reddit multi-query search | Task 1 | 20 min |
| 7 | Reddit RSS monitor | None | 15 min |
| 8 | DataForSEO Yelp integration | None | 20 min |
| 9 | Wire Yelp into collection | Tasks 2, 8 | 15 min |
| 10 | Deprecate Apify | Tasks 2, 9 | 10 min |
| 11 | Batch quality report | Tasks 1, 4 | 15 min |
| 12 | Update docs | All | 10 min |

**Parallel-safe groups:**
- Group A (independent): Tasks 1, 4, 7, 8
- Group B (needs Task 1): Tasks 2, 3
- Group C (needs Tasks 1+2): Tasks 6, 9
- Group D (needs data): Task 5
- Group E (cleanup): Tasks 10, 11, 12
