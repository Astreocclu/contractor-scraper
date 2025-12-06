# Data & Matching Questions - Answers

Generated: 2025-12-06

---

## 1. What tables/databases exist?

### Databases

| Database | Location | Purpose |
|----------|----------|---------|
| Contractors DB | `/home/reid/testhome/contractors/db.sqlite3` | Main system - contractors + permits + leads |
| Scraper DB | `/home/reid/Scraper/data/leads.db` | Legacy/duplicate - same data synced |

**Note:** The contractors DB has the leads/permits tables integrated. Both DBs appear to have the same data (2,724 permits).

### Tables in Contractors DB

**Core Business:**
- `contractors_contractor` - Contractor profiles (1,525 total)
- `contractors_vertical` - Service categories
- `contractors_contractor_verticals` - Many-to-many relationship
- `contractors_contractoraudit` - Trust score audits

**Leads/Permits (clients app):**
- `leads_permit` - Raw permit data (2,724 total)
- `leads_property` - Enriched property data from CAD
- `leads_lead` - Scored leads ready for outreach (1,996 total)
- `leads_neighborhoodmedian` - Pre-calculated medians for scoring
- `leads_scraperrun` - Scraper execution history

**Audit System:**
- `audit_records` - DeepSeek agent audit history
- `collection_log` - Puppeteer scraping log
- `contractor_raw_data` - Cached source data

---

## 2. What vertical categories exist?

### Contractors DB - Verticals

| ID | Name | Slug |
|----|------|------|
| 1 | Pool | pool |
| 2 | Patio Covers | patio-covers |
| 3 | Motorized Shades | motorized-shades |

### Permits/Leads - Categories (lead_type)

| Lead Type | Count | Notes |
|-----------|-------|-------|
| other | 1,165 | Uncategorized |
| residential remodel | 190 | General remodels |
| residential new | 189 | New construction |
| residential addition | 142 | Home additions |
| residential accessory new | 135 | Detached structures |
| pool | 77 | **Matches contractor vertical** |
| fence | 74 | No matching contractor vertical |
| residential accessory addition | 19 | |
| patio | 5 | **Partial match to Patio Covers** |
| patio_enclosure | 3 | **Partial match** |
| outdoor_living | 39 | **Partial match** |
| None/uncategorized | 1,914+ | Needs AI categorization |

### Data Quality Assessment

| Database | Verticals | Status |
|----------|-----------|--------|
| Contractors | Pool, Patio Covers, Motorized Shades | **Clean** - well-defined |
| Permits/Leads | Mix of pool, patio, outdoor_living, other | **Messy** - 70%+ uncategorized or "other" |

---

## 3. Volume per Vertical

### Contractors

| Vertical | Total | With Email |
|----------|-------|------------|
| Pool | 519 | 233 (45%) |
| Patio Covers | 856 | 378 (44%) |
| Motorized Shades | 390 | 173 (44%) |
| **TOTAL** | **1,525** | **670 (44%)** |

**Note:** 199 contractors do multiple verticals (see multi-vertical section below).

### Permits (Last 30 Days)

| Lead Type | Count |
|-----------|-------|
| pool | 18 |
| outdoor_living/patio | 9 |
| fence | 9 |
| patio_enclosure | 3 |
| other/uncategorized | 590 |

### Leads by Tier

| Lead Type | Total | Tier A | Tier B |
|-----------|-------|--------|--------|
| pool | 77 | 8 | 35 |
| patio | 5 | 0 | 0 |
| residential remodel | 190 | 9 | 133 |
| residential new | 189 | 2 | 168 |
| other | 1,165 | 0 | 0 |

---

## 4. Match Logic - Should contractors only get leads for their vertical?

### Current Situation

Many contractors do multiple services:

| Example | Verticals |
|---------|-----------|
| Lone Star Patio North Texas | Pool, Patio Covers, Motorized Shades |
| Allied Outdoor Solutions | Pool, Patio Covers, Motorized Shades |
| TCP Custom Outdoor Living | Pool, Patio Covers |
| DFW Outdoor Design & Construction | Pool, Patio Covers, Motorized Shades |

**Total multi-vertical contractors: 199** (13% of total)

### Recommendation

**Offer both options:**

1. **Strict matching** (default): Pool contractor → pool permits only
2. **Expanded matching** (opt-in): Pool contractor can also receive "outdoor_living" leads if they request

**Mapping:**
| Contractor Vertical | Permit Lead Types |
|--------------------|-------------------|
| Pool | pool |
| Patio Covers | patio, patio_enclosure, outdoor_living |
| Motorized Shades | (skip - SPF conflict) |

---

## 5. What fields make an email compelling?

### Available Data Points

**From Permits:**
- Lead count per vertical (last 30 days)
- Cities covered
- Permit date range

**From Properties:**
- Market value (from CAD enrichment)
- Neighborhood median
- Is absentee owner (investment property signal)
- Year built
- Square footage

**From Leads:**
- Tier (A/B/C/D)
- Freshness (hot/warm/moderate/cool/cold)
- Score
- High contrast flag (value >> neighborhood median)

### Suggested Email Fields

```
Subject: {X} new pool permits in {City} - Tier A leads available

Body:
- {X} pool permits from the last 30 days
- {Y} are Tier A (high-value, recent)
- Average property value: ${avg_value}
- Cities: {Southlake, Colleyville, Westlake}
- {Z} are absentee owners (investor-owned)

CTA: View leads / Claim your territory
```

---

## 6 & 7. SPF Conflict & Exit

**Status:** Unknown/TBD

**Safe Default Approach:**
1. **Skip motorized shades entirely** for now
2. Only email contractors tagged as **Pool** or **Patio Covers**
3. If a contractor does multiple verticals including motorized shades, still safe to email about pool/patio leads

**What this means:**
- 390 motorized shade-only contractors → skip
- 199 multi-vertical contractors → email about pool/patio only
- Revisit once SPF situation is clear

---

## Summary of Data Gaps

| Gap | Impact | Fix |
|-----|--------|-----|
| 70%+ permits uncategorized | Can't match to contractors | Run DeepSeek categorization |
| No "motorized shade" permit type | Can't serve that vertical | May not matter if SPF conflict |
| Lead tiers mostly empty for non-pool | B2B emails less compelling | Score more lead types |
| SPF rules unclear | Risk of conflict | Clarify with Reid |

---

## Next Steps

1. **Run AI categorization** on uncategorized permits (70%+ are "other")
2. **Build lead-to-contractor matching** — Pool & Patio only (skip motorized shades)
3. **Draft email template** with compelling fields
4. **Revisit motorized shades** once SPF situation is clear
