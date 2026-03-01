# New Verticals Research Handoff - Auditor Implications

**Date:** 2026-02-08
**Source:** Researcher Agent (Billy Bob)
**Original Report:** `/home/astre/command-center/src/researcher/docs/new-verticals-analysis-2026-02-08.md`

---

## Executive Summary for Auditor Agent

The Researcher has identified 4 Tier 1 verticals and 6 Tier 2 verticals for Greenlit expansion. This document extracts the audit-relevant findings.

---

## Tier 1 Verticals Requiring Audit Capability

### 1. Foundation Repair (Score: 81/100) - **HIGHEST PRIORITY FOR AUDIT**

**Trust Gap Severity:** 25/25 (highest of any vertical)

**Why This Matters to Auditor:**
- **Texas has ZERO state licensing for foundation contractors**
- Companies pop up, change names, and disappear daily
- Workers often illegally classified as independent contractors with no insurance
- Warranties written to protect contractor, not homeowner
- This is where Greenlit's audit-and-guarantee model has the most differentiated value

**Scam Patterns to Detect:**
- Name changes to escape warranty obligations
- Independent contractor misclassification (no insurance)
- Warranty fine print that protects contractor, not homeowner
- Disappearing after deposit/payment

**Warranty Verification Approach:**
- "Lifetime" warranties are common but often pro-rated or non-transferable
- Best-in-class: Olshan offers transferable lifetime warranty
- Audit should verify warranty transferability and coverage scope

**Average Project Cost:** $4K-$15K

---

### 2. Outdoor Living (Score: 88/100)

**Trust Gap Severity:** 20/25

**Components:** Outdoor kitchens, patio covers, pergolas, fire pits

**Scam Patterns to Detect:**
- Multi-trade overlap creates confusion (general contractor, electrician, plumber, stone mason)
- Upfront payment demands on high-ticket projects ($15K-$80K)
- Warranty confusion across multiple subcontractors

**Warranty Verification Approach:**
- Stone/steel structures have strong warranties
- Need to verify separate warranties for: structure, appliances, electrical, plumbing
- Best-in-class: 10-25 year structural warranties

**Average Project Cost:** $15K-$80K

---

### 3. Artificial Turf (Score: 86/100)

**Trust Gap Severity:** 18/25

**Why Lower Trust Gap:**
- Relatively low complaint rates compared to other verticals
- Product warranties are strong and straightforward

**Scam Patterns to Detect:**
- Inferior materials substitution
- Poor drainage installation (causes pooling/failure)
- Warranty exclusions for installation defects

**Warranty Verification Approach:**
- 15-25 year manufacturer warranties are standard
- Best-in-class: Big Bully offers 25-year warranty
- Product doesn't degrade like organic materials
- Audit should verify manufacturer warranty is transferable

**Average Project Cost:** $8K-$25K

---

### 4. Exterior Painting (Score: 81/100)

**Trust Gap Severity:** 21/25

**Scam Patterns to Detect:**
- Paint quality bait-and-switch
- Incomplete surface prep (causes early failure)
- Disappearing after deposit
- Warranty exclusions for TX sun/heat damage

**Warranty Verification Approach:**
- Typical: 1-3 years
- Best-in-class: MTS offers 7-year warranty
- Paint degrades fast in TX sun/heat
- Warranties often exclude environmental damage
- Audit should verify warranty covers environmental degradation

**Average Project Cost:** $3K-$12K

---

## Tier 2 Verticals Requiring Audit Capability

### 5. Fencing (Score: 76/100)

**Trust Gap Severity:** 20/25

**Scam Patterns to Detect:**
- Low per-foot quotes with hidden upcharges
- Full payment demanded upfront
- Ghosting on warranty claims
- Material substitution (cheaper wood/vinyl)

**Warranty Verification Approach:**
- 1-5 years typical
- Limited lifetime on vinyl (but watch fine print)
- Wood fences degrade in TX climate
- Audit should verify materials match quote

**Average Project Cost:** $3K-$15K

---

### 6. Garage Doors (Score: 75/100)

**Trust Gap Severity:** 21/25

**Scam Patterns to Detect:**
- "Lifetime guarantee" traps (parts only, labor excluded)
- Rebuild package upselling (unnecessary full replacement)
- Emergency service price gouging
- Warranty exclusions for labor/installation

**Warranty Verification Approach:**
- Typical: 1-3 years labor, lifetime parts only
- Labor is almost always excluded from warranty
- Audit should flag when warranty doesn't cover labor

**Average Project Cost:** $1K-$5K

---

### 7. Concrete / Pavers / Driveways (Score: 76/100)

**Trust Gap Severity:** 16/25 (lower because material is durable)

**Scam Patterns to Detect:**
- Base preparation shortcuts (causes settling/cracking)
- Inferior concrete mix
- Poor drainage design

**Warranty Verification Approach:**
- 3-10 years typical
- Best-in-class: System Pavers offers 25-year workmanship warranty
- Stone doesn't degrade
- Audit should verify base preparation standards

**Average Project Cost:** $5K-$25K

---

### 8. Epoxy / Garage Makeovers (Score: 71/100)

**Trust Gap Severity:** 19/25

**Scam Patterns to Detect:**
- Companies change names to walk away from warranties
- "Lifetime warranties" pro-rated to worthlessness
- Poor surface prep (causes peeling/failure)

**Warranty Verification Approach:**
- 5-15 years typical
- "Lifetime" warranties often pro-rated
- Audit should verify company longevity and warranty fine print

**Average Project Cost:** $2K-$6K

---

## Warranty Power Rankings (Audit Leverage)

Which verticals have guarantees strong enough for Greenlit to back?

| Rank | Vertical | Typical Warranty | Best-in-Class | Audit Leverage |
|------|----------|-----------------|---------------|----------------|
| 1 | **Artificial Turf** | 8-15 yrs | 25 yrs (Big Bully) | Excellent — product doesn't degrade |
| 2 | **Concrete/Pavers** | 3-10 yrs | 25 yrs (System Pavers) | Strong — material is literally stone |
| 3 | **Outdoor Living** | 5-10 yrs | 10-25 yrs (structures) | Strong — steel/stone structures |
| 4 | **Fencing** | 1-5 yrs | Limited lifetime (vinyl) | Moderate — wood fences degrade |
| 5 | **Exterior Painting** | 1-3 yrs | 7 yrs (MTS) | Weak — paint degrades in TX sun |
| 6 | **Foundation Repair** | "Lifetime" | Transferable lifetime (Olshan) | Tricky — warranties protect contractor |
| 7 | **Epoxy Floors** | 5-15 yrs | "Lifetime" (pro-rated) | Weak — fine print kills value |
| 8 | **Garage Doors** | 1-3 yrs labor | Lifetime parts only | Weak — labor excluded |

---

## New `lead_type` Values Needed

When these verticals are added to the system, these new permit categorization values will be needed:

- `outdoor_living` (outdoor kitchens, patio covers, pergolas)
- `turf` (artificial turf, lawn replacement)
- `painting` (exterior painting)
- `foundation` (foundation repair)
- `fencing` (fence installation/replacement)
- `garage_door` (garage door installation/replacement)
- `concrete_paving` (driveways, walkways, patios)
- `epoxy` (garage floors, epoxy coatings)

---

## Permit Type Mappings (for Gemini Categorization)

When Gemini categorizes permits, these new vertical mappings will need to be added:

**Outdoor Living:**
- Keywords: outdoor kitchen, patio cover, pergola, arbor, gazebo, outdoor fireplace, fire pit
- Permit types: Building Permit (structures), Electrical Permit (outdoor kitchen appliances), Plumbing Permit (outdoor sink/gas lines)

**Artificial Turf:**
- Keywords: turf, artificial grass, synthetic lawn, putting green
- Permit types: Rare (landscaping usually doesn't require permits)

**Exterior Painting:**
- Keywords: exterior paint, repaint, stucco repair, siding paint
- Permit types: Rare (cosmetic work usually doesn't require permits)

**Foundation Repair:**
- Keywords: foundation repair, pier, slab repair, mudjacking, leveling
- Permit types: Building Permit (structural work)

**Fencing:**
- Keywords: fence, privacy fence, iron fence, gate, retaining wall
- Permit types: Rare (some cities require permits for fences >6ft or in front yard)

**Garage Doors:**
- Keywords: garage door, overhead door, automatic door opener
- Permit types: Rare (replacement usually doesn't require permits; new installation might)

**Concrete/Pavers:**
- Keywords: driveway, patio, walkway, pavers, stamped concrete, decorative concrete
- Permit types: Building Permit (if structural), Grading Permit (if drainage changes)

**Epoxy:**
- Keywords: epoxy floor, garage floor coating, polyurea
- Permit types: None (cosmetic work)

---

## Priority Ordering for Implementation

Based on trust gap severity + audit differentiation value:

1. **Foundation Repair** — Highest unique value (no TX licensing = max trust gap)
2. **Fencing** — High scam rates, clear audit patterns
3. **Garage Doors** — High scam rates, warranty verification critical
4. **Outdoor Living** — High project value, multi-trade complexity
5. **Exterior Painting** — High volume, warranty verification needed
6. **Epoxy** — Name-change scams, warranty verification critical
7. **Artificial Turf** — Lower trust gap, but warranty verification adds value
8. **Concrete/Pavers** — Lower trust gap (durable material)

---

## Foundation Repair: The Regulatory Vacuum Opportunity

**Why Foundation Repair is Special:**

Texas has **zero state licensing** for foundation contractors. No certification, no state oversight. Companies can:
- Start business with no credentials
- Change names to escape warranty obligations
- Hire uninsured workers (misclassified as independent contractors)
- Write warranties that protect themselves, not homeowners

**This is where Greenlit becomes essential, not just useful.**

The trust gap is 25/25 — highest of any vertical. Homeowners are terrified. Your audit fills a regulatory vacuum.

**Audit strategy for foundation repair:**
- Verify company longevity (how long in business under current name?)
- Check for name changes (SOS filings, BBB history)
- Verify insurance coverage (general liability + workers comp)
- Audit warranty language (transferable? covers what? exclusions?)
- Check for liens/complaints (county records, BBB, TDLR)

---

## Next Steps

**Awaiting user instructions to begin implementation.**

When ready, the Auditor Agent will need to:
1. Add new audit categories for each vertical
2. Define scam pattern detection rules
3. Create warranty verification logic
4. Map permit types to new `lead_type` values
5. Update Gemini categorization prompts

**Note:** No code changes should be made until user provides implementation plan.
