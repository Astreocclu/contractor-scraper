# Forensic Information Vectors
## 56 Data Sources for Contractor Vetting

*Created: December 2025*

---

## Overview

These are ALL identified sources for forensic contractor auditing. Organized by acquisition difficulty to inform build order.

**Legend:**
- 🟢 = Perplexity/AI can likely find
- 🟡 = May need dedicated scraper
- 🔴 = Requires paid API or manual process

---

## TIER 1: Easy to Automate (API or Simple Scrape)

| # | Source | Data Points | Method | AI? |
|---|--------|-------------|--------|-----|
| 1 | Google Business Profile | Reviews, rating, photos, Q&A, responses, hours | Google Places API / SerpAPI | 🟢 |
| 2 | Yelp | Reviews, rating, attributes, response rate | Yelp Fusion API / scrape | 🟢 |
| 3 | BBB | Rating (A+ to F), complaints, accreditation | Scrape bbb.org | 🟢 |
| 4 | Facebook Business | Reviews, rating, engagement, response time | Graph API / scrape | 🟢 |
| 5 | Texas Secretary of State | Entity status, formation date, agent, officers | sos.state.tx.us | 🟡 |
| 6 | TDLR (TX License Board) | License #, status, expiration, disciplinary | tdlr.texas.gov | 🟡 |
| 7 | LinkedIn Company | Employee count, hires, postings, turnover | Scrape / API | 🟢 |
| 8 | Glassdoor | Employee reviews, CEO approval, salary | Scrape | 🟢 |
| 9 | Indeed Reviews | Employee satisfaction, management | Scrape | 🟢 |
| 10 | Google News | Media mentions, investigations | Google News API | 🟢 |
| 11 | Company Website | About, team, portfolio, contact, SSL | Direct scrape + analysis | 🟢 |
| 12 | Domain WHOIS | Registration date, registrant info | WHOIS API | 🟡 |

---

## TIER 2: Moderate Difficulty (Structured Scraping)

| # | Source | Data Points | Method | AI? |
|---|--------|-------------|--------|-----|
| 13 | County Court Records (Civil) | Lawsuits, judgments, amounts | County portals (varies) | 🟢 |
| 14 | Small Claims Court | Disputes, outcomes | County-specific | 🟡 |
| 15 | Mechanics Liens | Liens filed by/against contractor | County recorder | 🟡 |
| 16 | Building Permit Records | Volume, types, inspection pass rates | City/county portals | 🟡 |
| 17 | Code Enforcement | Violations, stop work orders | City records | 🟡 |
| 18 | Angi/HomeAdvisor | Reviews, verified status | Scrape (anti-bot) | 🟢 |
| 19 | Thumbtack | Reviews, badges, response time | Scrape | 🟢 |
| 20 | Houzz | Reviews, photos, badges | Scrape | 🟢 |
| 21 | Nextdoor | Neighborhood recommendations | Login wall - hard | 🔴 |
| 22 | Reddit | Mentions in local/home improvement subs | Reddit API | 🟢 |
| 23 | State Tax Lien Records | Tax liens against business | Varies by state | 🟡 |
| 24 | UCC Filings | Equipment liens (distress signal) | Secretary of State | 🟡 |
| 25 | PPP Loan Data | COVID loan amounts, forgiveness | SBA public dataset | 🟢 |

---

## TIER 3: Federated Search (Multiple Jurisdictions)

| # | Source | Data Points | Method | AI? |
|---|--------|-------------|--------|-----|
| 26 | PACER (Federal Courts) | Bankruptcy, federal lawsuits | PACER API ($0.10/page) | 🟡 |
| 27 | Multi-State License Check | License status in each state | Each state separately | 🟡 |
| 28 | Insurance Verification | GL, Workers Comp status | Certificate request | 🔴 |
| 29 | Surety Bond Status | Bond claims, amount | State board or carrier | 🟡 |
| 30 | OSHA Violations | Workplace safety violations | OSHA database | 🟢 |
| 31 | EPA Violations | Environmental enforcement | EPA ECHO database | 🟢 |
| 32 | State Attorney General | Consumer complaints filed | FOIA or public search | 🟡 |
| 33 | FTC Complaints | Federal consumer complaints | Limited public access | 🔴 |

---

## TIER 4: Social Listening (Pattern Detection)

| # | Source | Data Points | Method | AI? |
|---|--------|-------------|--------|-----|
| 34 | Facebook Groups | Victim groups, contractor discussions | Search + manual | 🟢 |
| 35 | Twitter/X | Complaint mentions, company posts | X API / scrape | 🟢 |
| 36 | YouTube | Complaint videos, company content | YouTube API | 🟢 |
| 37 | TikTok | Contractor callouts | Limited API | 🟢 |
| 38 | Local TV Consumer Segments | CBS/NBC/ABC investigations | Google News + archives | 🟢 |
| 39 | Newspaper Archives | Local coverage | News API | 🟢 |
| 40 | Industry Forums | Trade discussions, warnings | Manual search | 🟡 |

---

## TIER 5: Premium/Paid Data

| # | Source | Data Points | Method | AI? |
|---|--------|-------------|--------|-----|
| 41 | D&B (Dun & Bradstreet) | Business credit, payment history | API (~$500/mo) | 🔴 |
| 42 | Experian Business | Credit report, risk score | API subscription | 🔴 |
| 43 | LexisNexis | Aggregated court records, reports | Enterprise sub | 🔴 |
| 44 | Clear/Thomson Reuters | Legal research, case law | Enterprise sub | 🔴 |
| 45 | CourtListener | Free legal research (federal + some state) | Free API | 🟢 |

---

## TIER 6: Manual/Verification

| # | Source | Data Points | Method | AI? |
|---|--------|-------------|--------|-----|
| 46 | Phone Verification | Does number work? Professional? | Twilio / manual call | 🔴 |
| 47 | Physical Address Check | Real office vs. mailbox? | Street View + verification | 🟡 |
| 48 | Supplier References | Do they pay suppliers? | Manual outreach | 🔴 |
| 49 | Subcontractor References | Treatment of subs | Manual outreach | 🔴 |
| 50 | Manufacturer Certifications | GAF Master Elite, etc. | Verify with manufacturer | 🔴 |
| 51 | Insurance Certificates | Request COI | Manual request | 🔴 |
| 52 | Portfolio Verification | Are before/after photos real? | Reverse image search | 🟢 |
| 53 | Warranty Status | Registered with manufacturers? | Manufacturer lookup | 🔴 |
| 54 | Association Memberships | NARI, NKBA, local HBA | Verify with association | 🔴 |
| 55 | Permit Cross-Reference | Do permits match claimed work? | Manual comparison | 🟡 |
| 56 | Owner Background | Criminal history, other businesses | Public records search | 🟡 |

---

## Summary by AI Accessibility

| Category | Count | Notes |
|----------|-------|-------|
| 🟢 Perplexity can find | 31 | ~55% - Test to confirm |
| 🟡 Need scrapers | 15 | ~27% - Build these |
| 🔴 Manual/Paid | 10 | ~18% - Phase 2 or skip |

---

## Priority Sources (Must Have for MVP)

These are non-negotiable for a useful Trust Score:

1. **TDLR License Status** - Is contractor legal?
2. **Google Reviews** - Public reputation
3. **Yelp Reviews** - More trustworthy reviews
4. **BBB Rating** - Complaint patterns
5. **Secretary of State** - Is business real?
6. **County Court Records** - Lawsuits/judgments
7. **Google News** - Investigations/coverage
8. **Facebook Groups** - Victim patterns

---

## Test Protocol

After running Perplexity test prompt:

1. Check each 🟢 source - did it actually find data?
2. Move confirmed misses from 🟢 to 🟡
3. Prioritize scraper builds for 🟡 sources
4. Evaluate whether 🔴 sources are worth the cost

---

## Texas-Specific Sources

For DFW launch, these are the key Texas portals:

| Source | URL | Data |
|--------|-----|------|
| TDLR | tdlr.texas.gov/LicenseSearch | License lookup |
| TX SOS | sos.state.tx.us | Business entities |
| TX Comptroller | comptroller.texas.gov | Tax permits, franchise tax |
| Tarrant County Courts | tarrantcounty.com/en/courts | Civil records |
| Dallas County Courts | dallascounty.org | Civil records |
| Collin County Courts | collincountytx.gov | Civil records |
| Denton County Courts | dentoncounty.gov | Civil records |

---

*Run the Perplexity test to validate which sources are AI-accessible.*
