# Email Recovery Pipeline - Implementation Plan

**Date:** 2025-12-11
**Status:** Ready for Implementation
**Confidence:** 95% (Claude + Gemini agreed)

## Problem Statement

Google Places API was banned (caused $300 overcharge) but provided 90% of contractor emails. Current scrapers extract emails but don't propagate them to the main database.

## Root Cause Analysis

1. `google_maps.py` extracts emails → stored in `contractor_raw_data`
2. `website_scraper.js` exists but is **disconnected** from collection pipeline
3. `collection_service.js` never updates `contractors_contractor.email`
4. Result: Emails are found but never saved to usable location

## Solution Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Collection Pipeline                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Website Scraper (NEW)     2. Google Maps        3. BBB      │
│     ↓                            ↓                     ↓        │
│  [homepage + contact]        [listing text]        [profile]    │
│     ↓                            ↓                     ↓        │
│  ──────────────────────────────────────────────────────────     │
│                    contractor_raw_data                          │
│  ──────────────────────────────────────────────────────────     │
│                            ↓                                    │
│              promoteEmailsToMainRecord()                        │
│                            ↓                                    │
│              contractors_contractor.email                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Expected Hit Rates

| Source | Hit Rate | Notes |
|--------|----------|-------|
| Website Scraper | 40-50% | Visits homepage + contact page |
| Google Maps | 20-30% | Regex on listing text |
| BBB | 10-15% | Regex on profile page |
| **Combined** | **60-70%** | Some overlap |

---

## Implementation Tasks

### Task 1: Add Email Field to BBB Scraper

**File:** `scrapers/bbb.py`

**1.1 Update BBBResult dataclass**

```python
# Location: Line 48
@dataclass
class BBBResult:
    """BBB scrape result."""
    found: bool
    name: Optional[str] = None
    rating: Optional[str] = None
    accredited: bool = False
    profile_url: Optional[str] = None
    email: Optional[str] = None  # ADD THIS LINE
    years_in_business: Optional[int] = None
    # ... rest unchanged
```

**1.2 Add regex email extraction to `_fetch_profile_details`**

Find the function `_fetch_profile_details` and add email extraction after getting the HTML:

```python
async def _fetch_profile_details(client: httpx.AsyncClient, result: BBBResult) -> BBBResult:
    """Fetch additional details from the profile page."""
    if not result.profile_url:
        return result

    await rate_limiter.acquire("bbb.org")

    try:
        response = await client.get(result.profile_url, headers=get_headers(), follow_redirects=True)
        response.raise_for_status()

        html = clean_html(response.text)

        # === ADD EMAIL REGEX EXTRACTION START ===
        # 1. Look for mailto links (highest confidence)
        import re
        email_match = re.search(
            r'mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})',
            response.text,
            re.IGNORECASE
        )
        if email_match:
            result.email = email_match.group(1).strip().lower()
        else:
            # 2. Fallback: Search visible text for email pattern
            text_email = re.search(
                r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
                html
            )
            if text_email:
                candidate = text_email.group(0).strip().lower()
                # Filter junk domains
                junk = ['wix.com', 'squarespace.com', 'example.com', 'domain.com']
                if not any(j in candidate for j in junk):
                    result.email = candidate
        # === ADD EMAIL REGEX EXTRACTION END ===

        details = await _extract_profile_details(html)
        # ... rest of function unchanged
```

**1.3 Update `result_to_dict` to include email**

```python
def result_to_dict(result: BBBResult) -> dict:
    return {
        "found": result.found,
        "name": result.name,
        "rating": result.rating,
        "accredited": result.accredited,
        "profile_url": result.profile_url,
        "email": result.email,  # ADD THIS
        "years_in_business": result.years_in_business,
        # ... rest unchanged
    }
```

**1.4 Update cache get/set to include email**

In `scrape_bbb` where cache is read:
```python
return BBBResult(
    found=cached["found"],
    # ...
    email=cached.get("email"),  # ADD THIS
    # ...
)
```

In `_cache_result`:
```python
cache.set("bbb", cache_key, {
    "found": result.found,
    # ...
    "email": result.email,  # ADD THIS
    # ...
})
```

**Verification:**
```bash
cd /home/reid/testhome/contractor-auditor
python3 scrapers/bbb.py "Orange Elephant Roofing" "Fort Worth" "TX" --with-details
# Should show email field in output
```

---

### Task 2: Add CLI to Website Scraper

**File:** `scrapers/website_scraper.js`

**2.1 Append CLI interface at end of file**

```javascript
// ==========================================
// CLI Interface (append to end of file)
// ==========================================
if (require.main === module) {
  (async () => {
    const url = process.argv[2];
    if (!url) {
      console.log(JSON.stringify({ error: 'URL required as argument' }));
      process.exit(1);
    }

    const { chromium } = require('playwright');
    let browser;

    try {
      browser = await chromium.launch({ headless: true });
      const result = await scrapeEmailFromWebsite(url, {
        browser,
        timeout: 15000
      });
      console.log(JSON.stringify(result));
    } catch (err) {
      console.log(JSON.stringify({ error: err.message }));
    } finally {
      if (browser) await browser.close();
    }
  })();
}
```

**Verification:**
```bash
node scrapers/website_scraper.js "https://orangeelephantroofing.com"
# Should output: {"email":"info@orangeelephantroofing.com","source":"homepage","error":null}
```

---

### Task 3: Integrate Website Scraper into Collection Service

**File:** `services/collection_service.js`

**3.1 Add `scrapeWebsiteEmail` method to CollectionService class**

```javascript
/**
 * Scrape email from contractor website using Playwright
 * @param {string} url - Website URL
 * @returns {Promise<{email: string|null, source: string|null, error: string|null}>}
 */
async scrapeWebsiteEmail(url) {
  if (!url) return { email: null, source: null, error: 'No URL' };

  log(`  Fetching email from website...`);

  const scriptPath = path.join(SCRAPERS_DIR, 'website_scraper.js');
  const cmd = `node "${scriptPath}" "${url}"`;

  try {
    const output = execSync(cmd, {
      timeout: 30000,  // 30s total timeout
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const result = JSON.parse(output.trim());

    if (result.email) {
      success(`    Website email: ${result.email} (${result.source})`);
    } else if (result.error) {
      warn(`    Website scraper error: ${result.error}`);
    } else {
      log(`    No email found on website`);
    }

    return result;
  } catch (err) {
    warn(`    Website scraper failed: ${err.message.split('\n')[0]}`);
    return { email: null, source: null, error: err.message };
  }
}
```

**3.2 Add `promoteEmailsToMainRecord` method**

```javascript
/**
 * Promote discovered emails from raw_data to main contractor record
 * Priority: website > google_maps > bbb
 */
async promoteEmailsToMainRecord(contractorId) {
  // 1. Check if contractor already has email
  const existing = await this.db.exec(`
    SELECT email FROM contractors_contractor WHERE id = ?
  `, [contractorId]);

  if (existing[0]?.email) {
    log(`    Contractor already has email: ${existing[0].email}`);
    return;
  }

  // 2. Get emails from raw data (priority order)
  const sources = ['website', 'google_maps_local', 'google_maps_hq', 'google_maps', 'bbb'];

  for (const sourceName of sources) {
    const rows = await this.db.exec(`
      SELECT structured_data
      FROM contractor_raw_data
      WHERE contractor_id = ? AND source_name = ?
    `, [contractorId, sourceName]);

    if (rows.length > 0 && rows[0].structured_data) {
      try {
        const data = JSON.parse(rows[0].structured_data);
        if (data.email) {
          // Update main record
          await this.db.run(`
            UPDATE contractors_contractor
            SET email = ?
            WHERE id = ?
          `, [data.email, contractorId]);

          success(`    Promoted email to main record: ${data.email} (from ${sourceName})`);
          return;
        }
      } catch (e) {
        // JSON parse error, continue to next source
      }
    }
  }

  log(`    No email found in any source to promote`);
}
```

**3.3 Update `runInitialCollection` to call website scraper**

Find `runInitialCollection` method. After building URLs, add website scraping:

```javascript
async runInitialCollection(contractorId, contractor) {
  log('\n📥 Running initial collection...');

  const results = [];
  const urls = this.buildUrls(contractor);

  // === ADD WEBSITE EMAIL SCRAPING (insert after urls are built) ===
  if (urls.website) {
    log('\n  Scraping website for email...');
    const emailResult = await this.scrapeWebsiteEmail(urls.website);
    const emailData = {
      source: 'website',
      url: urls.website,
      status: emailResult.email ? 'success' : (emailResult.error ? 'error' : 'not_found'),
      text: JSON.stringify(emailResult),
      structured: emailResult
    };
    await this.storeRawData(contractorId, 'website', emailData);
    await this.logCollectionRequest(contractorId, 'website', 'initial', 'Email extraction');
    results.push(emailData);
  }
  // === END WEBSITE EMAIL SCRAPING ===

  // ... rest of existing collection code ...
```

**3.4 At end of `runInitialCollection`, add promotion**

```javascript
  // ... existing code at end of runInitialCollection ...

  const successCount = results.filter(r => r.status === 'success').length;
  log(`\n✓ Collected ${successCount}/${results.length} sources`);

  // === ADD EMAIL PROMOTION (before return) ===
  log('\n📧 Promoting emails to main record...');
  await this.promoteEmailsToMainRecord(contractorId);
  // === END EMAIL PROMOTION ===

  return results;
}
```

---

### Task 4: Test the Pipeline

**4.1 Test on single contractor**

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a

# Run collection on a test contractor
node run_audit.js --id 1524 --collect-only

# Verify email was saved
psql contractors_dev -c "SELECT id, business_name, email FROM contractors_contractor WHERE id = 1524"
```

**4.2 Run backfill for existing contractors**

```bash
# Use existing backfill script for contractors with websites but no email
node scrapers/backfill_emails.js --limit 10 --dry-run

# If dry run looks good, run for real
node scrapers/backfill_emails.js --limit 100
```

---

## Verification Checklist

- [ ] BBB scraper extracts email from profile pages
- [ ] Website scraper CLI works standalone
- [ ] Collection service calls website scraper
- [ ] Emails are stored in contractor_raw_data
- [ ] Emails are promoted to contractors_contractor.email
- [ ] Test contractor has email populated after collection
- [ ] Backfill script updates existing records

## Rollback Plan

If issues occur:
1. Revert changes to `collection_service.js` (remove website scraping + promotion)
2. BBB and website_scraper changes are additive, safe to leave

## Future Improvements

1. Add phone number extraction (same pattern)
2. Add Angi/Yelp email extraction if available in snippets
3. Consider Hunter.io API for enterprise email enrichment
