# Contractor Database Analysis Report

**Date:** 2025-12-04
**Database:** db.sqlite3 (1MB)
**Project:** Contractor Scraper

---

## Executive Summary

| Metric | Value | Status |
|--------|-------|--------|
| **Total Leads** | 1,523 | Good volume |
| **Passing Threshold (50+)** | 0 (0%) | Critical - None pass |
| **Enriched** | 10 (0.7%) | Critical gap |
| **Audited** | 10 (0.7%) | Critical gap |
| **Average Trust Score** | 0.3 | Non-audited = 0 |
| **Top Score** | 48 | Just below threshold |

**Key Finding:** The database has strong raw lead data from Google Maps scraping (1,523 contractors), but nearly all are un-enriched and un-audited. Only 10 contractors have been through the enrichment/audit pipeline, and none have reached the passing threshold of 50.

---

## Lead Overview

### Total Counts

| Data Type | Count |
|-----------|-------|
| Contractors | 1,523 |
| Verticals | 4 |
| Audit Records | 20 |
| Red Flags | 0 |

### Verticals Breakdown

| Vertical | Contractors | % of Total |
|----------|-------------|------------|
| Patio Covers | 856 | 56.2% |
| Pool Enclosures | 519 | 34.1% |
| Motorized Shades | 390 | 25.6% |
| Pool Builders | 0 | 0% |

*Note: Contractors can belong to multiple verticals*

---

## Trust Score Analysis

### Score Distribution

| Score Range | Count | Percentage | Tier |
|-------------|-------|------------|------|
| 80-100 | 0 | 0% | Gold |
| 65-79 | 0 | 0% | Silver |
| 50-64 | 0 | 0% | Bronze (Pass) |
| 40-49 | 5 | 0.3% | Unranked |
| 20-39 | 5 | 0.3% | Unranked |
| 0-19 | 1,513 | 99.3% | Unranked |

### Current Tier Status

| Tier | Count | Percentage |
|------|-------|------------|
| Gold (80+) | 0 | 0% |
| Silver (65-79) | 0 | 0% |
| Bronze (50-64) | 0 | 0% |
| Unranked (<50) | 1,523 | 100% |

### Top 10 Scoring Contractors

| Rank | Business Name | City | Score | Google Rating | Reviews |
|------|---------------|------|-------|---------------|---------|
| 1 | Pulliam Pools | Fort Worth | 48 | 4.6 | 473 |
| 2 | Seahorse Pools & Spas | Fort Worth | 44 | 4.3 | 118 |
| 3 | Metroplex Pool | Fort Worth | 44 | 4.9 | 140 |
| 4 | J Caldwell Custom Pools | Fort Worth | 42 | 4.5 | 114 |
| 5 | Pool Quest | Fort Worth | 40 | 4.4 | 78 |
| 6 | TXPool | Fort Worth | 38 | 4.9 | 25 |
| 7 | Lone Star Patio North Texas | Fort Worth | 38 | 5.0 | 14 |
| 8 | Fort Worth Pool | Fort Worth | 38 | 4.6 | 22 |
| 9 | Puryear Custom Pools | Fort Worth | 37 | 4.5 | 387 |
| 10 | Southwest Enclosure Systems | Fort Worth | 31 | 5.0 | 1 |

---

## Enrichment Coverage

### Data Source Coverage

| Source | Has Data | Percentage | Status |
|--------|----------|------------|--------|
| **Google Place ID** | 1,523 | 100% | Complete |
| **Google Rating** | 1,484 | 97.4% | Excellent |
| **Google Review Count** | 1,484 | 97.4% | Excellent |
| **Google Reviews JSON** | 10 | 0.7% | Critical gap |
| **Yelp ID** | 0 | 0% | Not configured |
| **Yelp Rating** | 0 | 0% | Not configured |
| **BBB Rating** | 0 | 0% | Not configured |
| **BBB Accredited** | 0 | 0% | Not configured |
| **License Number** | 0 | 0% | Not implemented |

### Contact Information Coverage

| Field | Has Data | Percentage | Status |
|-------|----------|------------|--------|
| Address | 1,523 | 100% | Complete |
| Phone | 1,513 | 99.3% | Excellent |
| Website | 1,397 | 91.7% | Good |
| Email | 0 | 0% | Not scraped |

### Data Quality Assessment

| Quality Level | Description | Count |
|---------------|-------------|-------|
| Complete Google | Has place_id + rating + reviews | 1,484 (97.4%) |
| Has Contact | Has phone AND website | ~1,387 (91%) |
| Third-party Enriched | Has Yelp OR BBB OR License | 0 (0%) |
| AI Processed | Has AI summary | 10 (0.7%) |

---

## Auditing Status

### Pipeline Status

| Stage | Processed | Percentage |
|-------|-----------|------------|
| Scraped (Google) | 1,523 | 100% |
| Enriched (Yelp/BBB) | 10 | 0.7% |
| Audited (AI) | 10 | 0.7% |
| Passing | 0 | 0% |

### Audit Records Detail

| Metric | Value |
|--------|-------|
| Total Audit Records | 20 |
| Unique Contractors Audited | 10 |
| Average Audit Score | ~40 |
| Risk Level (all) | MODERATE |
| Recommendation (all) | VERIFY |
| Red Flags Found | 0 |

### Score Component Breakdown (Audited Contractors)

| Component | Max Points | Average Actual | Gap |
|-----------|------------|----------------|-----|
| Verification | 15 | 0.0 | -15 (no license/BBB data) |
| Reputation | 15 | 7.5 | -7.5 (only Google, no Yelp) |
| Credibility | 10 | 6.1 | -3.9 |
| Red Flag | 10 | 6.6 | -3.4 |
| Bonus | 5 | 0.7 | -4.3 |
| **Total** | **55** | **20.9** | **-34.1** |

---

## Geographic Distribution

### Top 20 Cities (DFW Metro)

| City | Contractors | % of Total |
|------|-------------|------------|
| Dallas | 77 | 5.1% |
| Fort Worth | 71 | 4.7% |
| Arlington | 57 | 3.7% |
| Plano | 54 | 3.5% |
| Frisco | 50 | 3.3% |
| Denton | 45 | 3.0% |
| Cleburne | 43 | 2.8% |
| Southlake | 42 | 2.8% |
| McKinney | 42 | 2.8% |
| Rockwall | 40 | 2.6% |
| Crowley | 39 | 2.6% |
| Colleyville | 36 | 2.4% |
| North Richland Hills | 34 | 2.2% |
| Keller | 32 | 2.1% |
| Grand Prairie | 32 | 2.1% |
| Waxahachie | 31 | 2.0% |
| Midlothian | 31 | 2.0% |
| Mansfield | 31 | 2.0% |
| Flower Mound | 31 | 2.0% |
| Grapevine | 30 | 2.0% |

**State:** 100% Texas

---

## Google Ratings Analysis

### Rating Distribution

| Rating Range | Count | Percentage | Quality |
|--------------|-------|------------|---------|
| 4.5 - 5.0 | 1,270 | 85.6% | Excellent |
| 4.0 - 4.49 | 197 | 13.3% | Good |
| 3.5 - 3.99 | 62 | 4.2% | Average |
| 3.0 - 3.49 | 29 | 2.0% | Below Average |
| < 3.0 | 18 | 1.2% | Poor |

*Note: Percentages calculated from 1,484 contractors with ratings*

### Review Volume Distribution

| Review Count | Contractors | Percentage |
|--------------|-------------|------------|
| 100+ reviews | 343 | 22.5% |
| 50-99 reviews | 279 | 18.3% |
| 20-49 reviews | 402 | 26.4% |
| 10-19 reviews | 202 | 13.3% |
| 1-9 reviews | 258 | 16.9% |
| 0 reviews | 39 | 2.6% |

---

## Critical Gaps & Issues

### 1. Enrichment Pipeline Not Running

**Issue:** 99.3% of contractors have never been enriched.

**Impact:**
- No Yelp data (0 contractors)
- No BBB data (0 contractors)
- No license verification (0 contractors)
- Scores stuck at 0

**Root Causes:**
- YELP_API_KEY not configured
- BBB scraping blocked/failing
- License verification not implemented

### 2. AI Audit Pipeline Stalled

**Issue:** Only 10 of 1,523 contractors have been audited.

**Impact:**
- 99.3% have trust_score = 0
- No AI summaries for discovery
- No risk assessments

### 3. Verification Score = 0

**Issue:** All audited contractors have verification_score = 0.

**Root Cause:**
- No BBB accreditation data
- No license verification
- Texas doesn't require licenses for these verticals

### 4. Pass Threshold Unreachable

**Issue:** Top score is 48, threshold is 50.

**Current Max Possible (without Yelp/BBB/License):**
- Reputation: ~10 pts (Google only)
- Credibility: ~8 pts (website + phone + sentiment)
- Red Flag: ~7 pts (no issues)
- Bonus: ~2 pts (100+ reviews)
- **Total: ~27-48 pts** (cannot reach 50)

---

## Recommendations

### Immediate Actions

1. **Configure Yelp API Key**
   - Free tier: 5,000 calls/day
   - Impact: +3-6 points per contractor
   - Sign up: https://www.yelp.com/developers

2. **Run Enrichment Pipeline**
   ```bash
   python manage.py enrich_contractors
   ```
   - Process all 1,523 contractors
   - Will populate Yelp data

3. **Run Audit Pipeline**
   ```bash
   python manage.py audit_contractors
   ```
   - Process all contractors
   - Generate AI summaries and scores

### Short-term Fixes

4. **Lower Pass Threshold to 40**
   - Current top score: 48
   - Would allow ~5 contractors to pass immediately
   - Consider tiered display without strict pass/fail

5. **Adjust Scoring Weights**
   - Reduce verification weight (since no licenses required)
   - Increase reputation weight for Google-only data

### Medium-term Improvements

6. **Fix BBB Integration**
   - Current scraping is blocked
   - Consider SerpAPI for BBB data (~$50/mo)

7. **Add More Review Data**
   - Google API returns max 5 reviews
   - SerpAPI can get 50+ reviews

---

## Summary Metrics

| Category | Status | Action Needed |
|----------|--------|---------------|
| Lead Volume | 1,523 leads | Good |
| Google Data | 97% complete | Good |
| Contact Data | 91% complete | Good |
| Yelp Enrichment | 0% | Configure API |
| BBB Enrichment | 0% | Fix scraper |
| License Data | 0% | Not required |
| AI Auditing | 0.7% | Run pipeline |
| Passing Leads | 0% | Lower threshold |

---

*Report generated: 2025-12-04*
