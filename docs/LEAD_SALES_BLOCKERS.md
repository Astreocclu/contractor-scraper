# What's Blocking Lead Sales to Contractors

**Date:** 2025-12-07
**Analysis Method:** Claude + Gemini iterative brainstorming

---

## Executive Summary

The codebase has strong permit scraping and contractor auditing systems, but **critical data is missing**. Before any product decisions can be made, we need to answer: **What percentage of permits are homeowner-pulled vs contractor-pulled?**

### ANSWER: 46% Are Homeowner-Pulled (Real Leads)

Cross-referencing permits with CAD owner data (1,756 permits analyzed):

| Category | Count | % | Meaning |
|----------|-------|---|---------|
| Owner is PERSON + NO contractor | 808 | **46.0%** | **PRIMARY LEADS** |
| Owner is BUSINESS (builder/investor) | 581 | 33.1% | Not leads (new construction) |
| Unknown/unclear | 365 | 20.8% | Need manual review |
| Person + has contractor | 2 | 0.1% | Contractor-pulled |

**You have ~800 actual primary contractor leads in your database RIGHT NOW.**

The "downstream leads" pivot is WRONG. These homeowners are permitting BEFORE hiring.

---

## The Core Product: Primary Contractor Leads

### What We Have (Corrected Analysis)

The "permit paradox" (permits = closed deals) only applies to **contractor-pulled permits**.

**Homeowner-pulled permits ARE leads:**
- Homeowner is doing their own permitting BEFORE hiring
- They need a contractor to do the actual work
- This is 46% of our inventory (~800 leads)

### Product Definition

| Segment | % of Data | Product | Buyer |
|---------|-----------|---------|-------|
| **Homeowner-pulled** | 46% | Primary contractor leads | GCs, specialty contractors |
| Builder/investor | 33% | Market intel OR downstream | Competitors, sub-contractors |
| Unknown | 21% | Needs classification | TBD |

**Primary product:** Sell homeowner-pulled permits to contractors who do that type of work.

---

## Actual Blockers (Priority Order)

### 1. Product Definition (SOLVED)

**Status:** Defined
**Product:** Homeowner-pulled permits = primary contractor leads

- **Who is the buyer?** GCs and specialty contractors (roofers, HVAC, etc.)
- **What are they buying?** Homeowner contact info for properties with active permits
- **Price point:** $25-50 per lead (validate with calls)
- **Inventory:** ~800 leads ready now

### 2. No Contact Information (CRITICAL)

**Status:** Missing
**Impact:** Lead value = $0

| What We Have | What Contractors Want |
|--------------|----------------------|
| Address (123 Main St) | Phone number to call NOW |
| Permit details | SMS-ready contact |
| Property data | Direct line to homeowner |

**Solution Required:** Skip tracing API integration
- Options: batchskiptracing, idiodata, Twilio Lookup
- Converts address → homeowner cell phone
- Without this, there is no product

### 3. Delivery Mechanism (HIGH)

**Status:** Static CSV exports only
**Impact:** No real-time value

Contractors don't browse websites. They're in trucks.

**What They Want:**
- Push notification: "New lead in Plano. $50. Click to buy."
- Auto-email/SMS on new permits
- Instant gratification

**NOT Needed:**
- E-commerce storefront
- Complex subscription management
- Trust Score filtering (irrelevant for buyers)

### 4. Payment (MEDIUM)

**Status:** Non-existent
**Impact:** Can't collect money

**Simple Solution:**
- Stripe payment link
- Manual invoice
- Credit card auth form

**NOT Needed:**
- Complex billing system
- Subscription tiers
- Account management portal

---

## What We Over-Engineered (Stop Working On)

### Trust Scores for Buyers

- Trust Scores help **homeowners** trust contractors
- **Irrelevant** for selling TO contractors
- Low-trust contractors are often MORE desperate = better buyers
- Stop filtering buyers—if they have a credit card, sell to them

### ContractorResolver / FK Issues

- The permit-string-to-contractor-entity issue is a 2-hour fuzzywuzzy script
- Don't block sales over database normalization
- This is trivial, not "Critical Infrastructure"

### Yelp/BBB Data Quality

- This improves Trust Scores, which don't matter for buyers
- A contractor with 0 reviews and bad Yelp = desperate customer
- Stop trying to "fix" the data enrichment pipeline

---

## Critical Risks (Even If Tech Works)

### 1. Legal/Compliance (TCPA Trap)

- You cannot skip-trace homeowners and sell their cell phones for cold-calling
- TCPA + Do Not Call Registry create serious liability
- If contractor spams a litigious homeowner, you (data provider) may be liable

**Mitigation:**
- Sell "mailing lists" not "call lists"
- Scrub against DNC registry
- Or: Only sell to contractors with existing customer relationship

### 2. Data Freshness (Time Lag)

- City permits are often delayed days/weeks
- By the time you see the pool permit, homeowner may have signed maintenance contract
- Validate: Ask maintenance companies "How often do builders lock in maintenance upfront?"

### 3. Bundling Problem

- Primary contractors often do downstream work OR have kickback deals
- Pool builder may already have maintenance partner
- Target trades that GCs hate: specialized landscaping, sod, fence repair after damage

---

## Validation Plan (DO THIS FIRST)

**Do not build anything else until this test is complete.**

### Manual "Wizard of Oz" Test

1. **Pick scope:** Southlake + Pool Maintenance (one city, one trade)

2. **Manual scrape:** Get 10 recent pool permits from Southlake
   ```bash
   python scrapers/energov.py southlake 10
   ```

3. **Manual enrich:** Use TruePeopleSearch or Whitepages to find homeowner phones
   - Free/cheap tools work for 10 addresses
   - Don't build skip-trace integration yet

4. **Manual sell:** Call 5 pool cleaning/maintenance companies
   - Script: "I have 10 homeowners in Southlake whose pools are finishing construction. Want their numbers for $50?"

5. **Evaluate response:**
   - **If they buy:** Build automation
   - **If they don't:** You saved weeks of engineering

---

## Current System Status (For Reference)

### What's Working

| Component | Status | Notes |
|-----------|--------|-------|
| Permit scrapers | Working | EnerGov, MGO, eTRAKiT, Accela |
| Lead scoring | Working | AI-powered Tier A-D |
| Contractor auditing | Working | Trust scores, red flags |
| Database | Working | 1,500+ permits scraped |

### What's NOT Working (But Doesn't Matter Yet)

| Component | Status | Why It Doesn't Matter |
|-----------|--------|----------------------|
| Yelp/BBB enrichment | Blocked | Trust scores irrelevant for buyers |
| ContractorResolver | Missing | 2-hour script when needed |
| Storefront | Missing | Over-engineering |
| Skip tracing | Missing | **This actually matters—but validate first** |

---

## Decision: What to Do Monday

### Critical Question: ANSWERED

**46% of permits are homeowner-pulled = ~800 primary leads ready now.**

This was determined by cross-referencing permits with CAD owner data:
- If CAD owner is a PERSON name (e.g., "SMITH, JOHN") AND no contractor → homeowner-pulled
- If CAD owner is a BUSINESS (e.g., "BEAZER HOMES LP") → builder/investor, not a lead

### Actual Blockers (Revised)

| Blocker | Status | Fix |
|---------|--------|-----|
| Product definition | **SOLVED** | Primary leads to GCs |
| Phone numbers | **MISSING** | Skip trace integration |
| Delivery mechanism | **MISSING** | Email/SMS alerts |
| Payment | **MISSING** | Stripe link |

### STOP Working On
1. Trust Score improvements (irrelevant for buyers)
2. Yelp/BBB scraper fixes (irrelevant for buyers)
3. ContractorResolver architecture (trivial when needed)
4. ~~Downstream leads pivot~~ (WRONG - we have primary leads)

### Validation Test (Revised)

1. **Export 10 homeowner-pulled permits** (PERSON owner + no contractor)
2. **Skip trace manually** - use TruePeopleSearch/Whitepages for phone numbers
3. **Call 5 contractors** who do that permit type (roofing, HVAC, etc.)
4. **Script:** "I have 10 homeowners in [city] who just pulled [permit type] permits. Want their contact info for $50?"

### Current Inventory

```
Total permits with CAD data: 1,756
Homeowner-pulled (primary leads): 808 (46%)
Builder/investor (not leads): 581 (33%)
Unknown: 365 (21%)
```

---

---

## Data We Have vs Need (Final Analysis)

### What We HAVE (1,243 Homeowner Leads)

| Field | Coverage | Example |
|-------|----------|---------|
| owner_name | **100%** | "KIRCHNER, CHRISTOPHER" |
| property_address | **100%** | "1209 Perd, Westlake TX" |
| mailing_address | **100%** | "1209 PEDERNALAS TRL, ROANOKE, TX 76262" |
| market_value | **100%** | $6,172,060 |
| permit_type | varies | Building, Pool, etc. |

**High-value inventory:** Top leads include $6M, $4M, $3M+ properties.

### What We NEED

| Field | Status | Solution |
|-------|--------|----------|
| Phone number | **MISSING** | Skip trace API |
| Email | **MISSING** | Skip trace API |
| DNC scrub | **MISSING** | Required for compliance |

### Skip Trace Options

| Provider | Cost/Record | Notes |
|----------|-------------|-------|
| BatchSkipTracing | ~$0.15 | Batch upload |
| PropStream | ~$0.10 | Real estate focused |
| TruePeopleSearch | Free | Manual, slow |

### Validation-First Plan (Recommended)

1. **Call 5 contractors TODAY** (use contractors.csv)
   - Script: "I have 20 homeowners in [City] who pulled permits this week. Want their info for $X?"

2. **If interest:** Manually skip trace 20 leads via TruePeopleSearch

3. **If they pay:** Integrate skip trace API for scale

4. **Legal note:** Scrub against DNC before selling phone numbers

---

*Document created through Claude + Gemini iterative brainstorming*
*Corrected after CAD cross-reference showed 46% homeowner-pulled permits*
*Final data verification: 1,243 leads with 100% owner name coverage*
