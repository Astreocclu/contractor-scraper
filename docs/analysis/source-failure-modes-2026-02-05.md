# Source Failure Modes & Remediation Guide
Updated: 2026-02-05

Coverage data: `logs/pool_100_source_coverage_2026-02-05.json`
Ranking: `docs/analysis/source-ranking-2026-02-03.md`

---

## Quick Reference

| Status | Meaning | Action |
|--------|---------|--------|
| success | Data retrieved | None |
| not_found | No records exist | Expected for many sources |
| error | Scraper/API failure | Investigate + remediate |

**Error-prone sources (pool-100):** county_liens (49→0 after 600s fix), website (6), website_warranty (2), epa_echo (1)

---

## MUST Bucket (Importance >= 85, Readiness >= 70)

### County Liens (Tarrant/Dallas/Collin/Denton)
**Success: 10% | Errors: 56%**

| Failure Mode | Symptoms | Remediation |
|--------------|----------|-------------|
| Timeout | `Command timed out after Xms` | Increase `COUNTY_LIENS_TIMEOUT_MS` (600000 works for slowest) |
| Portal down | `Navigation timeout` or `net::ERR_*` | Retry later; portals have maintenance windows |
| Name mismatch | Success but 0 liens | Normal - most contractors have no liens |
| Rate limiting | Repeated failures same session | Add delays between contractors |

**Code:** `scrapers/county_liens/*.py`, `services/collection_service.js:250-320`

**Timeout hierarchy:**
1. `options.timeoutMs` (per-call)
2. `COUNTY_LIENS_TIMEOUT_MS` env var
3. Default: 300000ms (5 min)
4. Clamp: 60000-600000ms
5. Retry on timeout: 180000ms

**Current status (02-05):** Overnight refresh completed 48/48 with 600s timeout. All not_found (legitimate - no liens against these contractors).

---

### TX SOS Search
**Success: 100% | Errors: 0%**

No failures observed. Serper-based search is stable.

---

### BBB (Primary)
**Success: 58% | Errors: 0%**

| Failure Mode | Symptoms | Remediation |
|--------------|----------|-------------|
| Not accredited | `not_found` | Expected - many contractors aren't BBB members |
| Name variations | `not_found` despite existing | Try LLC/Inc suffixes in search |

**Code:** `collection_service.js` (Serper), `scrapers/bbb.py` (detail fallback)

---

### Google Maps Local
**Success: 100% | Errors: 0%**

No failures observed. Tiered search with fallbacks is robust.

**Fallback chain:**
1. Serper Google Maps search
2. SerpAPI Places
3. Claude Vision (if enabled)
4. Apify (if enabled)

---

## SHOULD Bucket (Importance >= 70, Readiness >= 55)

### Court Records (Dallas/Tarrant/Collin/Denton)
**Dallas: 66% | Tarrant: 9% | Collin: 62% | Denton: 54% | Errors: 0%**

| Failure Mode | Symptoms | Remediation |
|--------------|----------|-------------|
| Name mismatch | `not_found` | Normal - exact name matching |
| Tarrant low hit rate | 9% success | Tarrant portal may use different name format |

**Code:** `collection_service.js` (Serper site-scoped search)

**Note:** Low Tarrant success rate needs investigation. May need alternate search strategy.

---

### Court Records (Generic Playwright)
**Success: 0% | Errors: 0%**

| Failure Mode | Symptoms | Remediation |
|--------------|----------|-------------|
| All not_found | 99/99 not_found | Scraper may be misconfigured or deprecated |

**Code:** `scrapers/court_scraper.js`

**TODO:** Verify this scraper is still needed or can be removed.

---

### Yelp (Primary + Yahoo Fallback)
**Primary: 57% | Yahoo: 79% | Errors: 0%**

| Failure Mode | Symptoms | Remediation |
|--------------|----------|-------------|
| No Yelp presence | `not_found` | Normal - not all contractors on Yelp |
| Serper miss | Primary fails | Yahoo fallback catches ~22% more |

**Code:** `collection_service.js`, `scrapers/yelp.py`

---

### Angi
**Success: 30% | Errors: 0%**

| Failure Mode | Symptoms | Remediation |
|--------------|----------|-------------|
| No Angi presence | `not_found` | Normal - Angi is opt-in platform |

**Code:** `collection_service.js` (Serper rating extraction)

**Note:** 30% is expected. Angi requires paid contractor subscription.

---

### Houzz
**Success: 25% | Errors: 0%**

| Failure Mode | Symptoms | Remediation |
|--------------|----------|-------------|
| No Houzz presence | `not_found` | Normal - Houzz is specialty platform |

**Code:** `collection_service.js` (Serper rating extraction)

**Note:** 25% is expected. Houzz is design/remodel focused.

---

### OSHA
**Success: 13% | Errors: 0%**

| Failure Mode | Symptoms | Remediation |
|--------------|----------|-------------|
| No violations | `not_found` | Good! No OSHA issues |
| Name mismatch | `not_found` | Try registered entity name |

**Code:** `collection_service.js` (Serper site:osha.gov)

**Note:** Low success = good news (no violations). 13% have OSHA records.

---

### CourtListener (Federal)
**Success: 0% | Total: 0**

| Failure Mode | Symptoms | Remediation |
|--------------|----------|-------------|
| Missing API key | No rows at all | Set `COURTLISTENER_API_KEY` |

**Code:** `services/api_sources.js`

**TODO:** Obtain CourtListener API key for federal court coverage.

---

## NICE Bucket (Everything Else)

### TX Franchise Tax (Deprioritized 02/05)
**Success: 39% | Errors: 0%**

| Failure Mode | Symptoms | Remediation |
|--------------|----------|-------------|
| Name mismatch | `not_found` | Normal - entity may be registered under different name |
| API rate limit | `429` or connection refused | Add backoff; batch slower |

**Code:** `services/api_sources.js`

**Note:** Moved to Nice bucket 02/05 - not critical for contractor trust scoring. 39% success rate is expected since many contractors use DBAs or aren't registered entities.

---

### OpenCorporates
**Success: 0% | Errors: 0%**

| Failure Mode | Symptoms | Remediation |
|--------------|----------|-------------|
| API limitations | All not_found | Free tier may be exhausted or rate-limited |

**Code:** `services/api_sources.js`

**Note:** Consider if worth keeping - TX SOS provides similar data.

---

### Website/Warranty Scraping
**Website: 84% | Warranty: 57% | Errors: 6+2**

| Failure Mode | Symptoms | Remediation |
|--------------|----------|-------------|
| Navigation timeout | `Timeout waiting for navigation` | Site slow or blocking |
| SSL errors | `net::ERR_CERT_*` | Site has cert issues |
| Blocked | `403` or captcha | Site has bot protection |

**Code:** `collection_service.js:1050-1120`

---

### TDLR
**Success: 0% | Total: 1**

Removed from collection - unreliable scraper. Legacy rows only.

---

## Error Patterns by Root Cause

### Timeout Issues
**Sources:** county_liens, website, website_warranty

**Fix:**
- Increase timeout in env or per-call
- Add retry logic (county_liens has this)
- Run slow sources in overnight batches

### Rate Limiting
**Sources:** tx_franchise, open_corporates, serper-based sources

**Fix:**
- Add delays between requests
- Batch by city to spread load
- Respect 429 responses with exponential backoff

### Name Matching
**Sources:** All court/lien sources, TX Franchise, BBB

**Fix:**
- Try registered entity name vs DBA
- Try with/without LLC/Inc suffix
- Fuzzy matching (not implemented)

### Missing API Keys
**Sources:** court_listener

**Fix:**
- Obtain and set `COURTLISTENER_API_KEY`

---

## Monitoring Recommendations

1. **Daily:** Check overnight refresh logs for new error patterns
2. **Weekly:** Regenerate coverage JSON and compare trends
3. **Monthly:** Review "Nice" bucket sources for removal candidates

---

## Source Health Commands

```bash
# Regenerate coverage report
node scripts/generate_source_coverage.js

# Single source refresh
node bin/run_collect.js --id <contractor_id> --source <source_name>

# Batch liens refresh (use 600s timeout)
COUNTY_LIENS_TIMEOUT_MS=600000 node scripts/run_pool_liens_refresh.js
```
