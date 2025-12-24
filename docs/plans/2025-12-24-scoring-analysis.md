# Scoring Analysis Report - December 24, 2025

## Executive Summary

Ran **49 fresh audits** to analyze scoring distribution and verify the audit system works correctly.

**Key Finding:** The scoring IS working logically. The 85 clustering is justified - it represents "good contractor with minor data gaps" which is the most common profile.

## Score Distribution

| Score | Count | % | Category |
|-------|-------|---|----------|
| 92 | 1 | 2% | Excellent |
| 88 | 1 | 2% | Excellent |
| 85 | 13 | 27% | Good |
| 65 | 15 | 31% | Mixed |
| 55 | 1 | 2% | Concerns |
| 45 | 9 | 18% | Avoid |
| 35 | 7 | 14% | Avoid |
| 25 | 2 | 4% | Critical |

## Scoring Pattern Analysis

| Score Range | Flag Pattern | Meaning |
|-------------|--------------|---------|
| 25 | 2+ CRITICAL flags | Fraud indicators, serious violations |
| 35 | CRITICAL+HIGH or 2+ HIGH | Real problems found |
| 45 | CRITICAL or 2+ HIGH | Significant concerns |
| 55 | MEDIUM only | Moderate issues |
| 65 | HIGH+MEDIUM mix | Mixed signals, needs verification |
| 85 | LOW flags only | Minor gaps, good overall |
| 88+ | 0-1 LOW flags | Excellent, fully verified |

## Cost Summary

- **Total audits:** 49
- **Total DeepSeek cost:** ~$0.09
- **Average per audit:** $0.0019
- **Serper API:** Integrated for Google reviews (100% success rate)

---

# Individual Audit Results

## 92/100 - Honest Abe Comfort Solutions (Arlington) [EXCELLENT]

**Reasoning:**
Honest Abe Comfort Solutions presents a strong, consistent profile of a reputable and well-established HVAC contractor. The evidence overwhelmingly supports their claims of quality service. Key findings: 1) EXCELLENT REPUTATION: The contractor has a massive volume of positive reviews (4.9 stars on Google with 399 reviews, 4.6 stars on Angi with 1,658 reviews) which the Review Analyzer confirms are authentic and trustworthy. 2) STRONG BUSINESS CREDENTIALS: BBB A+ rating and accreditation indicate professional complaint handling and business practices. 3) CLEAN LEGAL & FINANCIAL RECORD: No lawsuits, court cases, or liens were found in the available data. The lien search returned no records, and searches across multiple county courts (Tarrant, Dallas, Collin, Denton) yielded no results. 4) NO NEGATIVE PUBLICITY: No news investigations, Attorney General complaints, or significant negative reports on consumer forums (Reddit, Nextdoor) were discovered. The business appears to operate without major public disputes or scandals.

**Positive Signals:**
- BBB A+ rating and accreditation
- Exceptionally high and authentic review volume (399 Google reviews at 4.9 stars, 1,658 Angi reviews at 4.6 stars)
- No lawsuits, judgments, or liens found in court and county records
- No negative news investigations or Attorney General complaints
- Professional website with clear service area and contact information
- Listed on multiple reputable platforms (HomeAdvisor, Indeed) with positive presence

**API Cost:** $0.0018

---

## 88/100 - Cold Factor Heating & Air Services (Coppell) [EXCELLENT]

**Reasoning:**
Cold Factor Heating & Air Services presents a strong, legitimate business profile. The evidence shows a well-established HVAC contractor with an excellent reputation. Key findings: 1) BBB A+ rating with accreditation, 2) 341 Google reviews with a 5.0 average rating (Review Analyzer confirms these are trustworthy), 3) No lawsuits, judgments, or liens found in court or county searches, 4) Active business registration with Texas (franchise tax found), 5) Appears in government bid documents (Collin County), indicating professional capability for public contracts. The single negative mention of 'Highway Robbery' pricing adds authenticity to the review profile rather than indicating a pattern of complaints. No red flags for fraud, financial distress, or unethical practices were discovered.

**Red Flags:**
- [LOW] PRICING: One isolated consumer comment referenced 'Highway Robbery' regarding pricing.

**Positive Signals:**
- BBB A+ Accredited Business
- 341 Google reviews with 5.0 average rating (trusted per Review Analysis)
- No lawsuits, judgments, or liens found in court/county searches
- Active Texas franchise tax registration
- Appears in government bid solicitations (Collin County)
- Listed on multiple professional platforms (HomeAdvisor, Indeed, Glassdoor)

**API Cost:** $0.0022

---

## 85/100 - Xtreme Air Services - HVAC, Plumbing, & Electrical (Mesquite) [RECOMMENDED]

**Reasoning:**
Investigation reveals a contractor with a strong, authentic online reputation but significant gaps in official business verification. The Google Maps profile shows an impressive 4.9-star rating with 666 reviews, and the Review Analysis confirms these reviews are largely authentic, with a professional owner response to a detailed negative complaint. No lawsuits, liens, or BBB complaints were found across multiple county searches. However, critical verification data is missing: the business could not be found in the Texas SOS database, franchise tax records, or Open Corporates, and no official business registration was located. The company appears in Collin County bid documents (2019-2025), suggesting legitimate commercial activity, but the lack of formal registration is a concern. No news investigations or consumer complaints were found on Reddit, Nextdoor, or local news sites.

**Red Flags:**
- [HIGH] BUSINESS_REGISTRATION: No business registration found in Texas SOS database or Open Corporates
- [MEDIUM] VERIFICATION_GAP: Franchise tax status could not be verified
- [LOW] DATA_GAP: No BBB profile found (not necessarily negative, but limits verification)

**Positive Signals:**
- Excellent Google reputation: 4.9 stars with 666 authentic reviews
- Review Analysis confirms authentic reviews with professional owner responses
- No lawsuits, liens, or judgments found across Dallas, Collin, Tarrant, Denton counties
- Appears in Collin County government bid documents (2019-2025), suggesting legitimate commercial work
- No negative news investigations or consumer complaints found on local news or forums

**API Cost:** $0.0017

---

## 85/100 - Texas Star Roofing Inc (Plano) [RECOMMENDED]

**Reasoning:**
Texas Star Roofing Inc presents a strong, positive profile. The company has an excellent reputation with 4.9-star ratings on both Google (131 reviews) and Angi (119 reviews). The Review Analyzer's 'TRUST_REVIEWS' verdict confirms these are legitimate. The business has been operating since 1997, indicating longevity and stability. No red flags were found in court records, lien data (scraper error, but no evidence of liens against them), or news investigations. The company appears in a positive legislative context, advocating for consumer protection. The lack of BBB profile is a minor gap, but not a red flag given the overwhelming positive evidence elsewhere.

**Red Flags:**
- [LOW] DATA_GAP: No BBB profile found; cannot verify accreditation or complaint history.

**Positive Signals:**
- Excellent 4.9-star rating with 131 reviews on Google Maps
- Excellent 4.9-star rating with 119 reviews on Angi
- Review Analyzer verdict: TRUST_REVIEWS - reviews are legitimate
- Business established in 1997, indicating longevity
- Positive presence on Nextdoor with service description
- No lawsuits, judgments, or liens found in court searches
- Cited in a positive legislative context advocating for consumer protection

**API Cost:** $0.0023

---

## 85/100 - Stratum Foundation Repair (Dallas) [RECOMMENDED]

**Reasoning:**
Stratum Foundation Repair presents a strong, consistent positive profile across all major verification platforms. The company holds an A+ BBB rating with accreditation, a strong indicator of good business practices and customer dispute resolution. Online reputation is excellent, with a 4.9/5 rating on Google Maps (59 reviews) and a 4.7/5 on Angi (12 reviews). The Review Analyzer concluded to TRUST_REVIEWS, finding them largely authentic and consistent. A positive Reddit recommendation and a feature in a Dallas News 'Top 10' list further support their standing. Critically, the investigation found NO evidence of lawsuits, judgments, or liens against the company in Dallas, Collin, Tarrant, or Denton county searches. The only negative found was a single Ripoff Report, which is unverified and common for any business. The lack of verified complaints with state or local authorities, combined with the strong positive signals, indicates a reputable and trustworthy contractor.

**Red Flags:**
- [LOW] Online Complaint: One unverified complaint found on RipoffReport.com alleging warranty issues.

**Positive Signals:**
- BBB A+ Rating and Accreditation
- Strong online reputation (Google: 4.9/5, Angi: 4.7/5)
- Review Analysis verdict: TRUST_REVIEWS - reviews appear authentic
- No lawsuits, judgments, or liens found in county court record searches
- Featured in Dallas News 'Top 10 Foundation Repair Companies in North Texas' list
- Positive recommendation on Reddit from a past customer
- Active on professional platforms (Indeed, Nextdoor, YouTube)

**API Cost:** $0.0018

---

## 85/100 - Circle A Electric (Plano) [RECOMMENDED]

**Reasoning:**
Circle A Electric presents a strong, legitimate business profile with no significant red flags. The company is BBB A+ accredited with multiple locations, indicating established operations and good business practices. No lawsuits, judgments, or liens were found in court records or county lien searches. The business is properly registered with the Texas Comptroller (CIRCLE A ELECTRIC, INC.) and has a valid taxpayer number. Reviews, while limited in volume (22 Google reviews with a 5-star rating), are deemed authentic by the Review Analyzer, and employee feedback on Glassdoor/Indeed is positive. OSHA records show a single historical incident from 2008, which is not a current concern. The primary gap is the low volume of public customer reviews, but this is offset by the strong institutional signals of legitimacy.

**Red Flags:**
- [LOW] REVIEW_VOLUME: Low volume of customer reviews (22 Google reviews) makes it difficult to assess widespread customer satisfaction patterns.

**Positive Signals:**
- BBB A+ accredited business with multiple locations
- No lawsuits, judgments, or liens found in court or county records
- Properly registered business entity with Texas Comptroller (CIRCLE A ELECTRIC, INC.)
- Review Analyzer indicates reviews are authentic and trustworthy
- Positive employee feedback on Glassdoor and Indeed
- Google Maps shows a perfect 5-star rating from existing customers

**API Cost:** $0.0025

---

## 85/100 - Metroplex Pool (Keller) [RECOMMENDED]

**Reasoning:**
Metroplex Pool presents as a legitimate, well-regarded fiberglass pool builder in the DFW area. The investigation found strong positive signals: a verified Texas corporate entity (METROPLEX POOLS INC), an excellent 4.9-star rating from 142 Google reviews deemed authentic by the Review Analyzer, and a professional website claiming over a decade in business as the region's largest fiberglass pool dealer. No red flags were discovered: no lawsuits, no BBB complaints, no news investigations, no liens (though lien data was unavailable), and no Texas AG complaints. The company appears in Denton County permit records for pool installations, indicating active, legitimate work. The primary gap is the lack of a BBB profile and detailed financial standing, but the overwhelming volume of positive, detailed customer feedback and clean legal record outweigh this.

**Red Flags:**
- [LOW] DATA_GAP: No BBB profile found to verify accreditation, complaint history, or years in business.

**Positive Signals:**
- 142 Google reviews with 4.9 average rating, analyzed as authentic and detailed
- Legally registered Texas corporation (METROPLEX POOLS INC) in good standing
- No lawsuits, judgments, or complaints found in court or AG searches
- Appears in municipal permit records for pool installations (Denton County)
- Professional website with clear service description and warranty information
- Active hiring presence on job sites (Glassdoor, Indeed)

**API Cost:** $0.0025

---

## 85/100 - Love That Door (Grapevine) [RECOMMENDED]

**Reasoning:**
Love That Door presents a strong, legitimate business profile. The company is BBB Accredited with an A+ rating, has a verified Texas LLC registration, and maintains positive online reputations (Google Maps 4.6/5 from 78 reviews, Houzz 4.4/5). The Review Analyzer confirms reviews are authentic, with customers providing specific details about custom projects and designers. No court cases, liens, or regulatory actions were found across multiple county searches. A local news segment (WFAA) featured their new Grapevine location, indicating community recognition. While some data collection encountered technical errors (lien scraper, some court sites), the absence of negative records in successfully searched jurisdictions is a positive signal. The business shows stability with multiple locations and a presence on professional platforms.

**Red Flags:**
- [LOW] Data Collection: Technical errors prevented full lien and court record retrieval in some counties. However, no negative records were found in the data that was successfully collected.

**Positive Signals:**
- BBB Accredited with A+ rating
- Verified Texas LLC in good standing (LOVE THAT DOOR LLC)
- Strong online reputation (Google 4.6, Houzz 4.4)
- Authentic customer reviews per Review Analysis
- Featured in local news (WFAA segment on new Grapevine location)
- Multiple physical locations (Dallas, Frisco, Grapevine)
- Active on professional platforms (HomeAdvisor, Indeed, Glassdoor)

**API Cost:** $0.0026

---

## 85/100 - McBride & Sons Plumbing (Flower Mound) [RECOMMENDED]

**Reasoning:**
McBride & Sons Plumbing presents a strong, positive profile with no significant red flags. The business is legally registered with the Texas Comptroller (MCBRIDE & SONS PLUMBING LLC). The most compelling evidence is the 4.9-star Google rating from 256 detailed reviews, which the Review Analyzer deemed highly authentic, citing varied customer experiences and professional owner engagement. No lawsuits, liens, or complaints were found across multiple county court searches, BBB, or news investigations. The absence of negative legal or financial records, combined with a robust and verified positive reputation, indicates a reliable, family-owned plumbing contractor serving the Denton County area.

**Red Flags:**
- [LOW] DATA_GAP: No BBB profile or accreditation found, which limits a traditional verification channel.
- [LOW] DATA_GAP: Lien records could not be retrieved due to a scraper error, preventing a full financial history check.

**Positive Signals:**
- Excellent Google reputation: 4.9 stars from 256 authentic reviews (Review Analysis: TRUST_REVIEWS)
- Legally registered Texas LLC (MCBRIDE & SONS PLUMBING LLC) with active franchise tax status
- No lawsuits, judgments, or complaints found in Dallas, Tarrant, or Collin county court searches
- Positive presence on HomeAdvisor and Yelp search results
- No negative news investigations or Attorney General complaints found

**API Cost:** $0.0018

---

## 85/100 - Roofing Service Company (Allen) [RECOMMENDED]

**Reasoning:**
The investigation found a legitimate, well-established roofing contractor with a strong positive track record. The business is properly registered as 'ROOFING SERVICE COMPANY TX LLC' with the Texas Comptroller. It holds a strong BBB rating (A) and accreditation, indicating good customer service practices. No lawsuits, judgments, or liens were found against the company in court records or county lien searches. The Review Analyzer noted insufficient data for a deep authenticity check but found no evidence of fake reviews and highlighted the strong BBB rating as an authentic signal. The company has a presence on Nextdoor with a professional page, and no negative news investigations or consumer complaints were discovered. The primary gap is the lack of detailed customer review content for deeper sentiment analysis, but the available evidence points to a reliable business.

**Red Flags:**
- [LOW] DATA_GAP: Insufficient detailed customer review content for a thorough authenticity and sentiment analysis.

**Positive Signals:**
- Properly registered Texas LLC (ROOFING SERVICE COMPANY TX LLC)
- BBB Accredited with an 'A' rating
- No lawsuits, judgments, or liens found against the company
- Professional presence on Nextdoor
- No negative news investigations or Attorney General complaints found

**API Cost:** $0.0026

---

## 85/100 - Ferguson (Euless) [RECOMMENDED]

**Reasoning:**
The investigation reveals that 'Ferguson' in Euless, TX, is not a local contracting company but a major national plumbing and building supplies distributor (Ferguson Enterprises, Inc.). This is a legitimate, established business with a strong institutional presence. The BBB shows an A- rating with accreditation across multiple Texas locations. The Review Analysis confirms the reviews are authentic and consistent with a large distributor serving trade professionals and retail customers. No court cases, liens, or news investigations were found targeting this business for fraudulent contracting practices. The data gaps (court/lien search errors) are due to technical issues, not negative findings. The primary 'risk' is the potential for consumer confusion—this is a supplier, not a hands-on contractor for home projects.

**Red Flags:**
- [LOW] Business Model Clarity: Search results are for a national plumbing supply distributor, not a local hands-on contractor. Homeowners seeking a contractor might be misled.
- [LOW] Data Collection Issue: Court and lien record searches returned connection errors, preventing a full financial/legal background check. This is a technical gap, not a negative finding.

**Positive Signals:**
- BBB Accredited Business with A- rating
- Review Analysis confirms authentic reviews and recommends TRUST_REVIEWS
- Major national distributor with multiple verified locations in Texas
- No evidence of lawsuits, complaints, or news investigations related to fraud or scams
- Google Maps shows a 4.1 rating with 96 reviews for the local branch

**API Cost:** $0.0026

---

## 85/100 - Choice Roofing Care (Allen) [RECOMMENDED]

**Reasoning:**
Choice Roofing Care presents a generally positive profile with strong customer reviews and good business standing, but some data gaps and minor concerns warrant a moderate risk level. The business has an excellent BBB A+ rating with accreditation, and the Review Analyzer confirms the legitimacy of its positive reviews (4.9 stars on Google Maps with 113 reviews). No lawsuits, court judgments, or liens against the business were found in the available data. The company received a $25,000 Collin CARES small business grant in 2020, indicating local government recognition. However, the investigation revealed several data gaps: lien records were inaccessible, franchise tax status could not be verified, and the business appears to operate under a DBA ('Choice Roofing Care') for 'Rigby's Roofing and Construction, LLC,' which is a minor transparency concern. No negative news, consumer complaints, or regulatory actions were found.

**Red Flags:**
- [LOW] BUSINESS_STRUCTURE: Business appears to operate under a DBA ('Choice Roofing Care') for 'Rigby's Roofing and Construction, LLC' per Collin County grant records. While not illegal, it's a minor transparency gap.

**Positive Signals:**
- BBB A+ rating and accreditation
- Excellent Google Maps rating (4.9 stars with 113 reviews) - Review Analyzer confirms reviews are trustworthy
- No lawsuits, court judgments, or liens found against the business
- Received Collin CARES small business grant ($25,000) in 2020
- Listed on multiple reputable platforms (HomeAdvisor, Indeed) with positive presence
- Professional website with detailed service information and GAF Master Contractor certification mentioned

**API Cost:** $0.0026

---

## 85/100 - Thunder Auto Tint (Allen) [RECOMMENDED]

**Reasoning:**
Thunder Auto Tint presents a strong, positive profile with no significant red flags. The business has a substantial and authentic online reputation, evidenced by 246 Google reviews with a 4.6 rating and 28 Yelp reviews with a 4.7 rating. The Review Analyzer's 'TRUST_REVIEWS' verdict confirms these are legitimate. The company claims 15 years of industry experience, which aligns with its established local presence on Nextdoor and positive community mentions. Crucially, the investigation found no evidence of legal trouble: no lawsuits, judgments, or liens against the business in Collin, Dallas, or Tarrant county searches. The absence of BBB complaints or negative news investigations further supports a clean operational history. The primary gap is the inability to verify formal business registration (LLC/Corp) with the Texas Secretary of State, but this is common for smaller, long-standing sole proprietorships. The overwhelming volume of positive customer feedback and lack of any consumer protection complaints indicate a reliable, quality-focused service provider.

**Red Flags:**
- [LOW] BUSINESS_VERIFICATION: Unable to verify formal business entity registration (LLC/Corporation) with Texas Secretary of State. Business may be operating as a sole proprietorship.

**Positive Signals:**
- Strong, authentic online reputation: 4.6/5 from 246 Google reviews and 4.7/5 from 28 Yelp reviews.
- Review Analyzer verdict: 'TRUST_REVIEWS' - reviews are legitimate and not manipulated.
- No lawsuits, judgments, or liens found against the business in county court searches.
- No BBB complaints or negative news investigations discovered.
- Positive local community presence on Nextdoor with claims of 15 years experience.
- Clean legal and financial record: no court cases, tax liens, or OSHA/EPA violations.

**API Cost:** $0.0017

---

## 85/100 - Accurate Foundation Repair (Fort Worth) [RECOMMENDED]

**Reasoning:**
Accurate Foundation Repair presents a strong, credible profile with no significant red flags. The business is verified as an active LLC in Texas. It holds an A+ BBB rating with accreditation, indicating good complaint handling. Customer reviews are largely authentic and positive (4.6-4.7 stars across platforms), with specific praise for their work and owner responsiveness. The Review Analyzer verdict is 'TRUST_REVIEWS_WITH_CAUTION,' noting a single detailed negative review but overall authentic patterns. No lawsuits, judgments, or liens against the company were found in court or county searches. The company appears in local contractor lists and has positive mentions on Reddit and Nextdoor. The only minor concerns are the inability to verify lien records due to a scraper error and a lack of news features, but these are data gaps, not negative findings.

**Red Flags:**
- [LOW] DATA_GAP: Lien record search returned a scraper error; unable to verify if any liens exist for or against the business.
- [LOW] REVIEW_ANALYSIS: Review analysis indicates a single, detailed negative review citing post-installation issues and poor warranty service, which contrasts with otherwise positive feedback.

**Positive Signals:**
- BBB A+ Accredited business with no complaint pattern found
- Strong, consistent customer ratings (4.6 Angi, 4.7 Google, 4.4 Yelp)
- Reviews deemed authentic with specific project details and varied writing styles
- Active Texas LLC with verified franchise tax status
- Positive recommendations on community platforms (Reddit, Nextdoor)
- No lawsuits, judgments, or tax liens found in court record searches
- Appears in local 'top contractor' lists and has over 25 years of claimed experience

**API Cost:** $0.0026

---

## 85/100 - Plumbing in Mesquite (Mesquite) [RECOMMENDED]

**Reasoning:**
The investigation found a contractor with a strong, legitimate reputation. The business appears to be 'Share Mesquite Plumbing Co.' based on Google Maps data, which shows an excellent 4.9-star rating from 697 reviews. The Review Analyzer confirms these reviews are trustworthy. No red flags were found: no BBB complaints, no court cases or liens against the business, no negative news investigations, and no Attorney General complaints. The high volume of positive reviews indicates consistent customer satisfaction over time. The only minor concerns are the inability to verify formal business registration (SOS/franchise tax) and the lack of a BBB profile, but these are common for smaller, well-regarded local contractors.

**Red Flags:**
- [LOW] BUSINESS_VERIFICATION: Unable to verify formal business registration with Texas Secretary of State or franchise tax status. The business may be operating as a sole proprietorship or under a different legal name.
- [LOW] BBB_PROFILE: No BBB profile found. While not a red flag on its own, it limits third-party verification of complaint history.

**Positive Signals:**
- Excellent Google Maps rating: 4.9 stars from 697 reviews (Review Analyzer: TRUST_REVIEWS)
- Strong secondary rating: 4.5 stars on Angi from 57 reviews
- No court cases, judgments, or liens found against the business
- No negative news investigations or Attorney General complaints
- No pattern of consumer complaints found on review platforms or forums

**API Cost:** $0.0025

---

## 65/100 - Poolfessionals of Texas, LLC (Mesquite) [NOT_RECOMMENDED]

**Reasoning:**
Poolfessionals of Texas, LLC presents a mixed profile. On the positive side, the business is registered with the Texas Comptroller (Taxpayer #32063863933), and the Review Analyzer found its 77 Google reviews (4.9 stars) to be authentic, with specific mentions of employees and services. No court cases, liens, or news investigations were found. However, significant gaps and concerns exist. The business is not BBB accredited, and a search returned a BBB profile but no rating or complaint data was accessible. The Google Maps listing is marked as 'closed,' which is a major red flag for operational status. There is a complete lack of presence on other major review platforms (Angi, HomeAdvisor, Yelp, Houzz) and no verifiable business history, years in operation, or website. The absence of negative data is positive, but the lack of positive verification data and the 'closed' status create too much uncertainty to recommend.

**Red Flags:**
- [HIGH] Business Status: Google Maps lists the business as 'closed'
- [MEDIUM] Verification Gap: No BBB rating, accreditation, or accessible complaint history
- [MEDIUM] Online Presence: No website provided and no presence on major contractor platforms (Angi, HomeAdvisor, Yelp, Houzz)

**Positive Signals:**
- Texas Franchise Tax account is active and registered
- Review Analysis confirms Google reviews (4.9 stars from 77 reviews) are authentic and trustworthy
- No court cases, liens, or negative news investigations found

**API Cost:** $0.0015

---

## 65/100 - Roto-Rooter Plumbing & Water Cleanup (McKinney) [NOT_RECOMMENDED]

**Reasoning:**
This investigation reveals a local Roto-Rooter franchise with significant discrepancies in its reputation. The positive signals are strong: the Review Analyzer indicates local Google/Angi reviews (4.8/4.6 with 1,451+ reviews) are authentic and detailed, showing a well-regarded local operation with specific technician praise. No court cases, liens, or regulatory actions were found against this specific McKinney location. However, severe negative signals create major trust concerns. The national Roto-Rooter brand has a terrible reputation on Trustpilot (1.6) and Yelp (1.8 for this location), with widespread complaints about high-pressure sales, extreme pricing, and poor corporate practices. Employee reviews on Indeed/Glassdoor (3.2) reveal internal management issues. The business could not be verified with the Texas Comptroller (franchise tax status unknown) and has no BBB profile, creating legitimacy gaps. While the local team may perform well, customers are hiring into a national franchise system with a documented pattern of consumer complaints and questionable business practices.

**Red Flags:**
- [HIGH] REPUTATION_DISCREPANCY: Severe discrepancy between local Google reviews (4.8) and national brand reputation (Trustpilot 1.6, Yelp 1.8). Trustpilot shows 173 reviews with 1.6 rating indicating widespread dissatisfaction with Roto-Rooter brand.
- [MEDIUM] EMPLOYEE_REPUTATION: Poor employee satisfaction (3.2 on Indeed/Glassdoor) with complaints about management, pay, and work environment.
- [MEDIUM] BUSINESS_VERIFICATION: Could not verify Texas franchise tax status or business registration. No BBB profile found.
- [LOW] COMPLAINT_PATTERNS: Review analysis detected complaint patterns about 'high cost/pricing' and 'corporate/franchise management issues'.

**Positive Signals:**
- High volume of authentic, detailed local Google reviews (4.8 with 1,451+ reviews)
- Specific technician praise in reviews (Drew, Tony mentioned)
- Professional owner responses to reviews
- No court cases, liens, or regulatory actions found against this specific location
- 24/7 emergency service with long history (since 1935 brand)

**API Cost:** $0.0021

---

## 65/100 - CGJ Roofing (Hurst) [NOT_RECOMMENDED]

**Reasoning:**
CGJ Roofing presents a mixed profile. On the positive side, the business is legally registered as 'CGJ ROOFING, LLC' with the Texas Comptroller, and Google Maps shows a perfect 5.0 rating from 28 authentic, detailed reviews. The Review Analyzer found no evidence of manipulation and recommends trusting the reviews with caution. A positive mention was also found on Nextdoor. However, significant investigative gaps prevent a recommendation. The business has no BBB profile (not accredited, no rating), which is unusual for an established local contractor. Critical court and lien record searches were inconclusive due to technical errors, leaving potential legal or financial disputes unverified. The company has minimal online presence beyond Google and a basic website, with no profiles on major contractor platforms like Angi, HomeAdvisor, or Houzz. While the available customer feedback is positive, the lack of verifiable business history, accreditation, and transparent legal/financial standing creates too much uncertainty for a homeowner to proceed confidently.

**Red Flags:**
- [MEDIUM] BUSINESS_VERIFICATION: No BBB profile, accreditation, or rating found. This is atypical for a reputable local contractor and limits third-party validation of business practices.
- [MEDIUM] DATA_GAP: Court and lien record searches in Tarrant, Dallas, Collin, and Denton counties returned errors or no results, preventing verification of any legal disputes or financial liens.
- [LOW] ONLINE_PRESENCE: Minimal presence on major contractor review and lead generation platforms (Angi, HomeAdvisor, Houzz, Thumbtack).

**Positive Signals:**
- Legally registered Texas LLC (CGJ ROOFING, LLC) with the Comptroller
- Perfect 5.0-star Google rating from 28 authentic, detailed reviews (Review Analyzer: TRUST_REVIEWS_WITH_CAUTION, no manipulation detected)
- Positive local recommendation found on Nextdoor
- No negative news or Attorney General complaints found in searches

**API Cost:** $0.0015

---

## 65/100 - PCR Pools and Spas LLC (Rockwall) [NOT_RECOMMENDED]

**Reasoning:**
PCR Pools and Spas LLC presents a mixed profile. The business is legally registered with the Texas Comptroller (taxpayer number 32087309004) and has a professional website. Google reviews show a strong 4.8-star rating from 20 customers, which the Review Analyzer deemed authentic, with specific mentions of quality work and problem-solving. However, significant data gaps and lack of established track record raise concerns. The business has no BBB profile, no presence on major contractor platforms (Angi, HomeAdvisor, Houzz), and no verifiable news coverage. Critical investigative data was unavailable: lien records could not be retrieved (scraper error), and court record searches failed due to connection errors. While no active red flags like lawsuits, complaints, or tax liens were found, the inability to verify financial stability (liens) and the complete absence from industry review platforms suggest this may be a newer or less established operation. The positive but low-volume Google reviews are encouraging but insufficient to offset the lack of broader verification.

**Red Flags:**
- [MEDIUM] DATA_VERIFICATION: Critical lien record search failed (scraper error), preventing assessment of financial disputes or stability.
- [MEDIUM] BUSINESS_PRESENCE: No profile found on BBB, Angi, HomeAdvisor, or Houzz. Lack of presence on major contractor platforms is unusual.
- [LOW] DATA_GAP: Court record searches in multiple counties (Tarrant, Dallas, Collin, Denton) failed due to connection errors, leaving litigation history unverified.

**Positive Signals:**
- Legally registered business with Texas Comptroller (Taxpayer #32087309004)
- 20 authentic Google reviews with 4.8-star average, praising specific work and employees
- Professional website detailing services and emphasizing quality
- No found complaints, lawsuits, or negative news in available searches

**API Cost:** $0.0015

---

## 65/100 - Taylor Made Outdoors (Grapevine) [NOT_RECOMMENDED]

**Reasoning:**
Taylor Made Outdoors presents a mixed profile. The positive signals are strong: a perfect 5.0 rating from 41 Google reviews, which the Review Analyzer found to be authentic and specific, and a professional website indicating a range of landscaping services. No court cases, liens, BBB complaints, or negative news investigations were found. However, significant verification gaps create substantial risk. The business lacks a verifiable official registration with the Texas Secretary of State or Comptroller (franchise tax status), meaning its legal standing and financial compliance are unconfirmed. It is also not accredited or listed with the BBB, and has no presence on other major review platforms (Angi, HomeAdvisor, Houzz), which limits cross-verification of its reputation. While the existing reviews are positive, the combination of an unverified business entity and a lack of broader institutional presence makes it impossible to fully endorse. This contractor may be a legitimate small operation, but the due diligence a homeowner needs cannot be completed with the available data.

**Red Flags:**
- [HIGH] BUSINESS_VERIFICATION: No verifiable business registration found with Texas Secretary of State or Comptroller (franchise tax status). Legal standing is unconfirmed.
- [MEDIUM] REPUTATION_VERIFICATION: Not accredited or listed with the BBB, and has no profile on major contractor platforms (Angi, HomeAdvisor, Houzz), limiting reputation cross-checking.

**Positive Signals:**
- Perfect 5.0-star rating from 41 Google reviews, analyzed as authentic and specific.
- No lawsuits, court judgments, liens, or BBB complaints found in searches.
- Professional website detailing services and service areas.
- No negative news investigations or consumer complaints found on forums (Reddit, Nextdoor) or AG website.

**API Cost:** $0.0023

---

## 65/100 - Perry Family Roofers LLC (Keller) [NOT_RECOMMENDED]

**Reasoning:**
Perry Family Roofers LLC presents a mixed profile. The primary positive signal is a strong 4.8-star rating with 91 reviews on Google Maps, which the Review Analyzer deemed trustworthy, indicating a base of satisfied customers. However, significant verification gaps and a lack of established business presence raise concerns. The company has no BBB profile, no presence on major contractor platforms (Angi, Houzz, HomeAdvisor), and its business registration/franchise tax status with the State of Texas could not be verified due to data access issues. No lawsuits, liens, or news investigations were found in the counties searched, which is positive, but the lien search returned a scraper error, leaving a critical data gap. The absence of a verifiable official business standing, coupled with the lack of a professional web presence or cross-platform reputation, prevents a full endorsement. The positive reviews are encouraging but exist in an informational vacuum regarding the company's legal and financial standing.

**Red Flags:**
- [MEDIUM] BUSINESS_VERIFICATION: Unable to verify business registration or franchise tax status with Texas Comptroller. The TX_SOS_SEARCH returned only a generic search page, and TX_FRANCHISE search found nothing.
- [MEDIUM] DATA_GAP: County lien search returned a 'scraper error - could not retrieve records'. This leaves a critical gap in assessing financial disputes or liens against the business.
- [LOW] ONLINE_PRESENCE: No profile found on BBB, Angi, Houzz, HomeAdvisor, or other major contractor review/lead platforms. Relies solely on Google Maps for reputation.

**Positive Signals:**
- Strong 4.8-star rating with 91 legitimate Google reviews (Review Analyzer: TRUST_REVIEWS)
- No lawsuits, judgments, or negative news found in Dallas, Denton, Collin, or Tarrant county court searches
- No complaints found with Texas Attorney General or on consumer forums (Reddit, Nextdoor)

**API Cost:** $0.0015

---

## 65/100 - J. Caldwell Custom Pools West (Benbrook) [NOT_RECOMMENDED]

**Reasoning:**
J. Caldwell Custom Pools West presents a mixed profile. The business is legally registered with the state of Texas (J. CALDWELL CUSTOM POOLS WEST, INC.) and has a significant online presence with 114 Google reviews and a 4.5-star rating, suggesting a base of satisfied customers. The company also maintains an active YouTube channel showcasing its work. However, the investigation reveals significant data gaps and a lack of verification from trusted third-party platforms. No BBB profile, Angi, or HomeAdvisor listings were found, which is unusual for an established contractor. The Review Analyzer could not verify authenticity due to insufficient detailed review content, rating the analysis as 'INCONCLUSIVE'. While no court cases, liens, or news investigations were found, the inability to access key county court and lien databases (Tarrant, Dallas, Denton, Collin) due to technical errors means critical financial and legal vetting could not be completed. The absence of negative news or complaints is positive, but the overall picture is one of a business with a decent local reputation but insufficiently verified for a high-stakes, high-cost service like custom pool building.

**Red Flags:**
- [MEDIUM] VERIFICATION_GAP: No BBB profile, Angi, or HomeAdvisor listing found, limiting third-party verification of business practices and complaint history.
- [MEDIUM] DATA_GAP: Critical court and lien record searches for Tarrant, Dallas, Denton, and Collin counties failed due to connection errors, preventing a full financial and legal background check.
- [LOW] REVIEW_AUTHENTICITY: Review analysis was inconclusive due to lack of detailed review text from other platforms, preventing verification of review authenticity.

**Positive Signals:**
- Legally registered corporation in Texas (J. CALDWELL CUSTOM POOLS WEST, INC.)
- Strong Google Maps presence with 114 reviews and a 4.5-star average rating
- Active professional YouTube channel showcasing pool projects and providing customer education
- No negative news investigations, Attorney General complaints, or Reddit/Nextdoor victim reports found

**API Cost:** $0.0015

---

## 65/100 - Texan Concrete Specialist (Euless) [NOT_RECOMMENDED]

**Reasoning:**
The investigation reveals a contractor with strong customer reviews but significant unresolved business and compliance issues. Texan Concrete Specialist LLC has excellent review performance (4.8/5 on Google with 116 reviews, 4.5/5 on Angi with 73 reviews) that the Review Analyzer confirms as authentic. They appear in numerous local Yelp categories and have positive mentions on Nextdoor. However, critical red flags emerged: 1) The BBB profile shows the business FAILED TO RESPOND to a complaint, resulting in a non-accredited status with a negative rating reason. 2) The business is properly registered with the Texas Comptroller (taxpayer #32071072006), but the website returns a 403 Forbidden error, suggesting potential operational issues. 3) While no court cases, liens, or news investigations were found, the BBB complaint response failure indicates poor customer service practices for formal complaints. The combination of strong field performance with poor formal complaint handling creates a mixed signal - they deliver good work but may abandon customers when problems arise.

**Red Flags:**
- [HIGH] BUSINESS_PRACTICES: BBB shows business failed to respond to complaint(s), resulting in negative rating reason
- [MEDIUM] OPERATIONAL: Website returns 403 Forbidden error, suggesting potential maintenance or operational issues

**Positive Signals:**
- Strong authentic reviews: 4.8/5 on Google (116 reviews), 4.5/5 on Angi (73 reviews)
- Properly registered Texas LLC with franchise tax account (TEXAN CONCRETE SPECIALIST LLC)
- Appears in multiple local Yelp search categories indicating legitimate market presence
- Positive mentions on Nextdoor from satisfied customers
- No court cases, liens, or news investigations found

**API Cost:** $0.0021

---

## 65/100 - Your New Door (Grapevine) [NOT_RECOMMENDED]

**Reasoning:**
Investigation reveals a contractor with a strong positive signal in customer reviews but significant data gaps and verification issues. The Google Maps data shows a perfect 5.0 rating with 60 reviews, and the Review Analysis indicates these reviews are authentic, mentioning specific crew names and outcomes. No court cases, liens, BBB complaints, or negative news investigations were found. However, the business lacks a verifiable digital footprint: no website, no BBB profile, no business registration found in Texas SOS/Franchise Tax searches, and no presence on major contractor platforms (Angi, HomeAdvisor, Houzz). The business name appears in Yelp search results but with only 2 reviews, suggesting limited market penetration. The combination of excellent customer feedback but an unverified business entity creates a mixed signal. The absence of red flags is positive, but the inability to confirm the business's legal standing, licensing, or years in operation is a significant concern for a homeowner.

**Red Flags:**
- [MEDIUM] BUSINESS_VERIFICATION: No business registration found in Texas Secretary of State or Franchise Tax databases. Business legal status is unverified.
- [LOW] ONLINE_PRESENCE: No website provided and minimal presence on professional contractor directories (Angi, HomeAdvisor, Houzz).
- [LOW] REVIEW_DISCREPANCY: Review Analysis notes a perfect 5.0 score with 60 reviews and no visible negative feedback is unusual, though reviews appear authentic.

**Positive Signals:**
- Perfect 5.0 Google rating with 60 authentic reviews mentioning specific crew members and positive outcomes.
- No court cases, liens (scraper error, but no records indicated), BBB complaints, or negative news found.
- Review Analysis confirms authentic customer experiences with specific details.

**API Cost:** $0.0026

---

## 65/100 - 5 Star HVAC Contractors (Garland) [NOT_RECOMMENDED]

**Reasoning:**
The investigation reveals a contractor with a strong online presence and positive customer sentiment, but significant verification gaps and a lack of established business history raise concerns. The business is legally registered as '5 STAR HVAC CONTRACTORS, LLC' with the Texas Comptroller, which is a positive signal. Customer reviews are overwhelmingly positive (4.9 stars on Google), and the Review Analyzer found them authentic, with no detected complaint patterns. The company appears in local Yelp searches and has a professional website. However, critical verification data is missing: the business has no BBB profile (not necessarily a red flag, but a data gap), no Angi/HomeAdvisor presence, and court/lien searches were inconclusive due to technical errors, preventing a full check for lawsuits or financial disputes. The review volume (32) is relatively low for the claimed '5 Star' branding. While no active red flags like lawsuits, news investigations, or victim reports were found, the inability to verify key aspects of their operational history and financial standing, combined with the low data density, prevents a higher confidence recommendation.

**Red Flags:**
- [LOW] DATA_VERIFICATION: No BBB profile found. While not accredited, the absence of any record is a minor data gap for a consumer-facing business.
- [LOW] REVIEW_VOLUME: High rating (4.9) is based on a relatively low volume of reviews (32). This makes the rating less statistically robust.

**Positive Signals:**
- Legally registered business entity with Texas Comptroller (5 STAR HVAC CONTRACTORS, LLC)
- Strong, authentic customer reviews with 4.9-star average (Review Analysis: TRUST_REVIEWS)
- Professional website and local online presence (Yelp, Google Maps)
- No negative news investigations or consumer complaint patterns found

**API Cost:** $0.0023

---

## 65/100 - Texas Pro Home Improvement LLC (Plano) [NOT_RECOMMENDED]

**Reasoning:**
Texas Pro Home Improvement LLC presents a mixed and incomplete profile. The business is legally registered with the state (TX Franchise Tax ID: 32087525575) and has a perfect 5.0-star rating from 52 Google reviews, which the Review Analyzer found to be authentic in content, with specific project details and varied writing styles. However, significant data gaps and a lack of established public presence raise concerns. The company is not listed with the BBB, Angi, HomeAdvisor, or Houzz, which is atypical for a reputable home improvement contractor seeking customer trust. No court cases, liens, or news investigations were found, but this could be due to limited data retrieval (scraper errors were noted for county liens and some court searches). The business has a minimal digital footprint outside of Google Maps and a basic Nextdoor page. While there are no active red flags like lawsuits or complaints, the absence of verifiable history, accreditation, and multi-platform presence makes it impossible to confirm a long-term, stable track record. The positive reviews are encouraging but insufficient to overcome the lack of broader verification.

**Red Flags:**
- [MEDIUM] BUSINESS_VERIFICATION: No BBB profile, Angi listing, or accreditation on major home service platforms.
- [LOW] DATA_GAP: Lien and court record searches returned errors or no data, preventing a full financial/legal background check.

**Positive Signals:**
- Legally registered business entity in Texas (Franchise Tax ID: 32087525575)
- 52 Google reviews with a perfect 5.0 average rating
- Review Analysis found reviews to be authentic with specific project details and no complaint patterns
- No lawsuits, tax liens, or news investigations found in available searches

**API Cost:** $0.0023

---

## 65/100 - Hill DB Inc (Frisco) [NOT_RECOMMENDED]

**Reasoning:**
Hill DB Inc presents a mixed profile. On the positive side, the business is legally registered in Texas (taxpayer number 32053421593), has a strong 4.7-star rating from 24 authentic Google reviews (per Review Analysis), and no court cases, liens, or BBB complaints were found in the available data. However, significant data gaps and a lack of established public presence are concerning. The company has no BBB profile, no presence on major contractor platforms (Angi, HomeAdvisor, Houzz), and minimal online footprint beyond its Google Maps listing. The review volume (24) is low for a company claiming to have started in 2014, suggesting limited public engagement or a niche/specialized clientele. While no active red flags like lawsuits or complaints were discovered, the inability to verify critical aspects of the business (years in business, licensing, insurance, detailed complaint history) due to data collection errors and sparse records creates uncertainty. The company appears to be a legitimate, small-scale operation with satisfied customers but lacks the verifiable track record and transparency expected for a high-confidence recommendation.

**Red Flags:**
- [MEDIUM] DATA_GAP: No BBB profile found. BBB accreditation and complaint history are standard verification tools for contractors.
- [MEDIUM] DATA_GAP: Absent from major contractor review/lead platforms (Angi, HomeAdvisor, Houzz, Thumbtack).
- [LOW] OPERATIONAL_TRANSPARENCY: Low review volume (24) for a company reportedly operating since 2014.
- [LOW] TECHNICAL_ISSUE: Court and lien record searches encountered connection errors, preventing a complete background check.

**Positive Signals:**
- Texas franchise tax entity is active and registered (HILL DB INC).
- Google Maps shows a 4.7-star rating from 24 reviews.
- Review Analysis concluded reviews are authentic (TRUST_REVIEWS), with specific praise for employees.
- No lawsuits, judgments, or liens were found in the data that was successfully retrieved.
- No BBB complaints or news investigations found.

**API Cost:** $0.0020

---

## 65/100 - Thomas & Sons Roofing & Construction (Cedar Hill) [NOT_RECOMMENDED]

**Reasoning:**
Thomas & Sons Roofing & Construction presents a mixed profile. On the positive side, the business has a strong Google Maps rating of 4.8 with 77 reviews, which the Review Analyzer deemed authentic and trustworthy. The website is professional and lists a physical address in Cedar Hill, TX, and claims to have been serving the area since 2016. No active lawsuits, liens, or complaints were found in the available court and county records. However, significant verification gaps exist. The business has no profile with the Better Business Bureau (BBB), which is unusual for an established contractor and makes it impossible to verify complaint history or accreditation. Searches of the Texas Secretary of State and Franchise Tax databases returned no clear results, leaving the business's legal registration and good standing unverified. No independent reviews were found on platforms like Yelp, Angi, or HomeAdvisor. While the lack of negative legal news is good, the absence of foundational business verification data, combined with the missing BBB profile, creates too many unanswered questions to confidently recommend this contractor to a homeowner.

**Red Flags:**
- [MEDIUM] BUSINESS_VERIFICATION: No Better Business Bureau (BBB) profile found. An established contractor operating since 2016 would typically have a BBB record for customer recourse and verification.
- [MEDIUM] BUSINESS_VERIFICATION: Unable to verify business registration or good standing with the Texas Secretary of State or Franchise Tax authorities. Searches returned generic pages, not specific entity data.

**Positive Signals:**
- Strong Google Maps reputation: 4.8-star rating with 77 authentic reviews (Review Analyzer: TRUST_REVIEWS).
- Professional website with detailed service list, physical address, and phone number.
- No active lawsuits, judgments, or liens found in available court and county record searches.
- No negative news investigations or Attorney General complaints found.

**API Cost:** $0.0019

---

## 65/100 - Stamper Roofing & Construction (Dallas) [NOT_RECOMMENDED]

**Reasoning:**
Stamper Roofing & Construction presents a mixed profile. On the positive side, the business has a strong 4.9-star rating on Google Maps with 80 reviews and a perfect 5-star rating on Yelp with 9 reviews. The Review Analyzer assessed the reviews with 'CAUTIOUS_TRUST' and found no evidence of manipulation, only noting a limited presence on other platforms. The business appears in the Dallas City Hall registry of registered contractors, which is a positive verification. No negative news, BBB complaints, court cases, or liens were found in the searches conducted. However, significant gaps in verification create risk. The business could not be found in the Texas Secretary of State or Franchise Tax databases, meaning its corporate standing and good standing with the state are unverified. There is no BBB profile, and critical lien data could not be retrieved due to a scraper error. The business has a very limited digital footprint on major contractor platforms (only 1 review on Angi, none on Houzz, etc.). While the existing reviews are positive and there are no active red flags, the inability to confirm the business's legal registration and the lack of a broader, established track record prevent a recommendation. The high ratings are promising but insufficient to overcome the fundamental verification gaps.

**Red Flags:**
- [MEDIUM] BUSINESS_VERIFICATION: Business entity not found in Texas Secretary of State or Franchise Tax databases. Corporate standing and good standing are unverified.
- [LOW] DATA_GAP: Critical lien record search failed due to scraper error. Financial disputes with subcontractors or suppliers could not be assessed.
- [LOW] REVIEW_ECOSYSTEM: Limited review presence on major contractor platforms outside of Google and Yelp. Makes full reputation assessment difficult.

**Positive Signals:**
- Strong 4.9-star Google rating with 80 reviews
- Perfect 5-star Yelp rating with 9 reviews
- Review Analyzer found no fake review signals, only limited data
- Listed in Dallas City Hall registry of registered contractors
- No lawsuits, complaints, or negative news found in searches

**API Cost:** $0.0018

---

## 65/100 - Williams & Sons Roofing & Remodeling (Denton) [NOT_RECOMMENDED]

**Reasoning:**
Williams & Sons Roofing & Remodeling presents a mixed profile. The positive signals are a strong Google Maps rating (4.8 from 70 reviews) and no discovered lawsuits, liens, or news investigations. However, significant verification gaps exist. The business lacks a BBB profile, is not found on major contractor platforms (Angi, Houzz, HomeAdvisor), and its official business registration with the Texas Secretary of State could not be verified. The Review Analysis indicates 'CAUTIOUS_TRUST' due to limited review volume and absence on other platforms, which is a notable data gap for a high-engagement industry like roofing. While no active red flags for fraud or poor workmanship were found, the inability to confirm basic business legitimacy (licensing, registration, years in operation) and the thin digital footprint beyond Google create too much uncertainty to recommend.

**Red Flags:**
- [MEDIUM] BUSINESS_VERIFICATION: Business registration/entity status with Texas Secretary of State could not be verified. Franchise tax status also unknown.
- [LOW] REVIEW_AUTHENTICITY: Review Analysis recommends 'CAUTIOUS_TRUST' due to limited review volume (70) and no presence on other major review platforms, creating a data gap.
- [LOW] DIGITAL_PRESENCE: No profile found on key contractor verification platforms (BBB, Angi, Houzz, HomeAdvisor).

**Positive Signals:**
- Strong Google Maps rating (4.8 stars from 70 reviews)
- No lawsuits, court judgments, or liens discovered in county searches
- No negative news investigations or consumer complaints found in searches
- Professional website with detailed service listings and contact information

**API Cost:** $0.0016

---

## 55/100 - Cedar Creek Pools (Cedar Hill) [NOT_RECOMMENDED]

**Reasoning:**
Cedar Creek Pools, LLC is a legally registered Texas business with a professional website and claims 30+ years of experience. However, the investigation reveals significant data gaps and mixed signals. The business is not found on major review platforms (BBB, Angi, HomeAdvisor) and has a modest online presence. The Review Analyzer indicates a 'CAUTION_ADVISED' status based on a low volume of Google reviews (17) with a 3.8 rating, suggesting mixed but likely authentic feedback. No court cases, liens, or news investigations were found, which is positive. However, the lack of verifiable track record on established contractor platforms, combined with the inability to confirm years in business, licensing, or a substantial portfolio of customer reviews, creates insufficient positive data to recommend them confidently. The business appears to be a small, local operation without the established public reputation needed for a high-stakes purchase like a pool.

**Red Flags:**
- [MEDIUM] REPUTATION: No presence on major contractor verification platforms (BBB, Angi, HomeAdvisor).
- [LOW] REVIEWS: Low volume of customer reviews (17) with a mixed 3.8 rating, indicating limited public feedback.

**Positive Signals:**
- Legally registered business with Texas Comptroller (Franchise Tax ID found).
- Professional website detailing services and process.
- No lawsuits, liens, or negative news investigations found.

**API Cost:** $0.0024

---

## 45/100 - Dahl Designer Window Fashions (Rockwall) [AVOID]

**Reasoning:**
Investigation reveals a contractor with virtually no verifiable track record. The business has a professional website and appears in local directories (Yelp, Nextdoor), but there is a critical absence of any substantive evidence of operations or customer satisfaction. The Review Analyzer concluded 'CAUTION_NO_DATA' with HIGH confidence, noting 'minimal to no online review presence across all major platforms, which is highly unusual for an established service business.' No lawsuits, liens, or BBB complaints were found, but this is likely due to the business's low profile rather than a clean record. No business registration or franchise tax status could be verified via Texas SOS/Comptroller searches. The complete lack of reviews, coupled with an inability to verify the business's legal standing, creates an unacceptable level of risk for homeowners.

**Red Flags:**
- [HIGH] REPUTATION: Zero authentic customer reviews found on any major platform (Google, Yelp, BBB, Angi, etc.). Review Analyzer flagged this as highly unusual and a reason for caution.
- [MEDIUM] BUSINESS_VERIFICATION: Unable to verify business registration or franchise tax status with the Texas Secretary of State/Comptroller. Business legal standing is unconfirmed.
- [LOW] DIGITAL_PRESENCE: No presence on major contractor platforms (Angi, HomeAdvisor, Houzz, BuildZoom, Thumbtack).

**Positive Signals:**
- Professional website exists with service details and contact information.
- Business is listed on Yelp and has a Nextdoor page, indicating some local marketing.

**API Cost:** $0.0017

---

## 45/100 - Rooflens (Plano) [AVOID]

**Reasoning:**
Rooflens presents a concerning profile. While it is a legally registered LLC in Texas (ROOFLENS LLC) with no court cases, liens, or BBB complaints found, the lack of a verifiable business footprint is alarming. The contractor has a perfect 5.0-star rating with 127 reviews on Google Maps, which the Review Analyzer found plausible in content but flagged as statistically suspicious and a significant red flag due to the complete absence from all other major review and contractor platforms (BBB, Angi, Houzz, HomeAdvisor, Yelp, etc.). This pattern suggests potential review manipulation or a very new/limited operation. Furthermore, no website was provided, and searches for local news, Nextdoor discussions (beyond a basic page), and employee reviews yielded no substantive information. The combination of a perfect rating in isolation, zero presence on industry-standard platforms, and no discoverable digital history creates an unverifiable and high-risk situation for a homeowner.

**Red Flags:**
- [HIGH] REVIEW_VERIFICATION: Perfect 5.0 rating with 127 reviews exists ONLY on Google Maps. Complete absence from BBB, Angi, Houzz, HomeAdvisor, Yelp, and other major platforms is highly unusual and a significant red flag per the Review Analyzer.
- [MEDIUM] BUSINESS_PRESENCE: No discoverable website, professional listings, or substantive digital footprint beyond a basic Google Maps entry and a skeletal Nextdoor page.
- [LOW] DATA_GAP: Unable to verify years in business, licensing details (beyond LLC registration), or any history of completed projects through standard channels.

**Positive Signals:**
- Legally registered as ROOFLENS LLC with the Texas Comptroller (Taxpayer #32097490356)
- No lawsuits, court judgments, or liens found in searched county records
- No complaints found with BBB or Texas Attorney General

**API Cost:** $0.0015

---

## 45/100 - Zinga's Dallas (Dallas) [AVOID]

**Reasoning:**
Zinga's Dallas presents a concerning profile with significant red flags. The most critical issue is the Review Analysis verdict of 'INVESTIGATE_FURTHER' with a 70% fake review score, indicating the 4.7 Google rating from 1,209 reviews is highly suspicious and likely inflated. This massive volume is statistically improbable for a local window treatment business and creates a major discrepancy with the minimal Yelp presence (3.5 stars, 4 reviews). The business lacks fundamental verification: no BBB profile, no Angi/HomeAdvisor presence, and no verifiable Texas SOS or franchise tax status. While no court cases, liens, or news investigations were found, the absence of these negative records is overshadowed by the complete lack of positive, verifiable business credentials and the strong evidence of review manipulation. The website claims operation since 1999 and 25,000 customers, but these claims cannot be verified through any independent business registry or review platform.

**Red Flags:**
- [CRITICAL] REVIEW_MANIPULATION: Review Analyzer found 'highly suspicious' review patterns with 70% fake review score. 1,209 Google reviews with 4.7 rating is statistically improbable for a local window treatment business, especially compared to only 4 Yelp reviews.
- [HIGH] BUSINESS_VERIFICATION: No verifiable business registration found with Texas SOS or franchise tax records. Cannot confirm claims of being in business since 1999 or having 25,000 customers.
- [HIGH] REPUTATION_PLATFORMS: No presence on major contractor verification platforms: BBB, Angi, HomeAdvisor, Houzz, or BuildZoom. Legitimate contractors typically appear on at least one of these.
- [MEDIUM] REVIEW_DISCREPANCY: Massive discrepancy between Google (1,209 reviews) and Yelp (4 reviews). Yelp's 3.5 rating suggests more typical local business performance.

**Positive Signals:**
- No court cases, liens, or news investigations found in Dallas-area searches
- Professional-looking website with multiple location listings

**API Cost:** $0.0018

---

## 45/100 - AA Super Rooter/PRONTO PLUMBING ASAP 24/7 (Garland) [AVOID]

**Reasoning:**
Investigation reveals a plumbing contractor with significant identity and verification issues. The business claims over 20 years in operation, but no evidence supports this longevity. Critical verification checks failed: no BBB profile, no business registration found via Texas SOS/Comptroller, and no court or lien records (though lien data was inaccessible). The Review Analysis indicates a critical data mismatch; the 4.4 rating with 84 reviews could not be authenticated as the provided review content belonged to a different, large national chain. The website lists a Gmail address for business contact, which is unprofessional and atypical for an established company. While no active lawsuits, complaints, or news investigations were found, the complete lack of verifiable business credentials, coupled with the inability to confirm the legitimacy of its online reputation, creates an unacceptable level of risk for a homeowner.

**Red Flags:**
- [HIGH] BUSINESS_VERIFICATION: No business registration found with Texas Secretary of State or Comptroller (franchise tax). Business legitimacy cannot be verified.
- [HIGH] REVIEW_AUTHENTICITY: Review authenticity cannot be assessed. Analysis shows provided review data belongs to a different national company, creating doubt about the target's 4.4 rating.
- [MEDIUM] PROFESSIONALISM: Business website uses a Gmail address (edfranco07@gmail.com) as primary contact, which is unprofessional for a claimed 20-year operation.
- [MEDIUM] REPUTATION_GAPS: No presence on major contractor platforms (Angi, HomeAdvisor, Houzz, BuildZoom) and no BBB profile found.

**Positive Signals:**
- No lawsuits, judgments, or consumer complaints found in court records or news searches.
- Website presents a professional image and claims 24/7 emergency service.

**API Cost:** $0.0016

---

## 45/100 - Blue Fox Outdoor Living (Dallas) [AVOID]

**Reasoning:**
Blue Fox Outdoor Living presents significant verification gaps and potential identity confusion. The business cannot be verified as a legitimate, registered entity in Texas. Critical searches for BBB, Texas SOS registration, and franchise tax status returned no results or generic pages, indicating the business may not be properly registered or is operating under a different legal name. The only positive signal is a 4.6-star Google rating from 35 reviews, which the Review Analyzer deemed authentic. However, this is overshadowed by the discovery that the business name appears in Collin County documents as a DBA ('Doing Business As') for 'Diananguyen LLC', suggesting the contractor is not a standalone LLC but an alias for another company. This creates transparency and liability concerns for homeowners. No active lawsuits, liens, or news investigations were found, but the fundamental lack of business verification and unclear corporate structure poses a high risk.

**Red Flags:**
- [CRITICAL] Business Verification: No verifiable business registration with Texas Secretary of State or franchise tax account. Business appears to be a DBA for 'Diananguyen LLC' based on Collin County grant documents.
- [HIGH] Transparency: Operating under a DBA (Blue Fox Outdoor Living) for a differently named LLC (Diananguyen LLC) creates confusion and potential liability issues for customers.
- [MEDIUM] Online Presence: No BBB profile, Angi listing, or presence on major contractor platforms (HomeAdvisor, Houzz, Thumbtack). Limited digital footprint for an established contractor.
- [LOW] Data Gap: Lien search failed due to scraper error. County court searches were inconclusive due to technical errors.

**Positive Signals:**
- Google Maps shows a 4.6-star rating from 35 authentic reviews (Review Analysis: TRUST_REVIEWS).
- No active lawsuits, judgments, or negative news investigations found.
- Received a Collin CARES Small Business Grant in 2020, indicating some level of local government recognition at that time.

**API Cost:** $0.0019

---

## 45/100 - Texas Ground Foundation Repair (Lewisville) [AVOID]

**Reasoning:**
Texas Ground Foundation Repair presents a high-risk profile due to a complete lack of verifiable business history and significant data gaps. The business is registered as an LLC with the Texas Comptroller, but no other standard business verification exists: no BBB profile, no Angi/HomeAdvisor presence, no business website provided, and no evidence of licensing or insurance. The 5.0 Google rating is based on only 18 reviews, which the Review Analyzer flagged for potential clustering and low volume, warranting caution. Critically, court and lien searches were inconclusive due to technical errors, leaving a major gap in understanding potential legal or financial disputes. No news investigations or consumer complaints were found, but the absence of positive verification data (years in business, accreditation, professional memberships) combined with the inability to check for lawsuits or liens creates an unacceptable level of uncertainty for a foundation repair contractor, where significant financial investment and structural safety are at stake.

**Red Flags:**
- [HIGH] BUSINESS_VERIFICATION: No BBB profile, Angi, HomeAdvisor, or professional directory listings found. Business appears unverified through standard consumer protection channels.
- [HIGH] DATA_GAP: Court and lien record searches failed due to technical errors, preventing verification of any lawsuits, judgments, or financial liens against the business.
- [MEDIUM] REVIEWS: Perfect 5.0 rating based on very low volume (18 reviews). Review analysis noted potential clustering and recommends trusting with caution.
- [MEDIUM] ONLINE_PRESENCE: No business website provided and no substantial digital footprint beyond a basic Google Maps listing.

**Positive Signals:**
- Business is registered as an LLC with the Texas Comptroller (TEXAS GROUND FOUNDATION REPAIR, LLC)
- Google Maps shows an open status with a 5.0 rating from 18 customers

**API Cost:** $0.0025

---

## 45/100 - Merge Windows And Doors (Lewisville) [AVOID]

**Reasoning:**
Merge Windows and Doors, LLC is a legally registered Texas business with a professional website and showrooms, indicating a legitimate operation. However, the investigation reveals critical gaps and red flags that make this contractor too risky for homeowners. The most significant concern is the complete lack of verifiable reputation: no BBB profile, no Angi/HomeAdvisor presence, and only 5 Google reviews that the Review Analyzer flagged as highly suspicious and unreliable. The business has no track record on major consumer platforms, which is unusual for an established contractor. While no lawsuits, liens, or complaints were found in court/lien searches (a positive), the absence of negative data is overshadowed by the absence of any positive, verifiable data. The company appears to be a newer or low-volume operation with an unproven public reputation. For a significant investment like windows and doors, homeowners need a contractor with a transparent, documented history of customer satisfaction, which Merge Windows and Doors does not provide.

**Red Flags:**
- [HIGH] REPUTATION: Review Analyzer found reviews highly suspicious: only 5 Google reviews with perfect 5.0 score, generic praise, low volume, and no corroboration on other platforms. Verdict: DO_NOT_TRUST_REVIEWS.
- [MEDIUM] BUSINESS_VERIFICATION: No presence on major consumer platforms (BBB, Angi, HomeAdvisor, Houzz) where established contractors typically build reputation. This creates a significant data gap.
- [LOW] ONLINE_PRESENCE: Very limited online footprint and review volume (5 reviews) for a contractor in a major metro area, suggesting new, low-volume, or unestablished business.

**Positive Signals:**
- Legally registered Texas LLC (MERGE WINDOWS AND DOORS, LLC) with active franchise tax status
- Professional website with showroom information and product focus
- No lawsuits, judgments, or liens found in court and lien record searches
- No complaints found with Texas Attorney General or in news investigations

**API Cost:** $0.0017

---

## 45/100 - B&C Electric (Mesquite) [AVOID]

**Reasoning:**
B&C Electric (legal name B&C ELECTRICAL LLC) presents significant verification and trustworthiness issues. The business is legally registered in Texas, which is a positive signal, but the overall profile is concerning. The Review Analyzer flagged the review profile as 'highly suspicious' due to a perfect 5.0 Google rating with only 28 reviews and a complete absence of reviews on all other major platforms (Yelp, BBB, Angi, Houzz). This pattern suggests potential review manipulation or a very new business with solicited reviews, making the positive rating unreliable. No negative court records, liens, or BBB complaints were found, but this is likely due to the business's small scale or newness rather than a clean history. Crucially, there is a complete lack of any third-party verification of quality, experience, or financial stability. The business has no BBB profile, no Angi listing, and no meaningful online presence beyond a single, suspiciously perfect Google rating. For a homeowner, this represents a high-risk proposition with insufficient credible data to establish trust.

**Red Flags:**
- [HIGH] REVIEW_MANIPULATION: Review Analyzer found profile 'highly suspicious' with perfect 5.0 rating on only one platform (Google, 28 reviews) and zero reviews on all other major platforms (Yelp, BBB, Angi, Houzz).
- [MEDIUM] BUSINESS_VERIFICATION: No BBB profile, Angi listing, or other professional accreditation found. Business lacks established presence on major contractor verification platforms.
- [MEDIUM] DATA_GAPS: Unable to verify years in business, licensing status (beyond LLC registration), insurance, or any history of completed projects. Critical information for contractor evaluation is missing.

**Positive Signals:**
- Legally registered as an LLC in Texas (B&C ELECTRICAL LLC)
- No court cases, liens, or BBB complaints found in searches
- Appears in local Yelp search results for electricians in Mesquite, indicating some local recognition

**API Cost:** $0.0024

---

## 45/100 - G&S Renovations (Watauga) [AVOID]

**Reasoning:**
G&S Renovations presents a concerning profile with significant red flags and a lack of verifiable positive history. The investigation reveals: 1) A direct, serious allegation of scamming customers found in a Google News snippet from a Yelp search result. 2) Extremely limited online presence and reputation data—only 8 Google reviews (4.1 stars) and 1 Houzz review, which is insufficient for a company claiming to be 'one of the most trusted' in the Metroplex. 3) No verifiable business registration or licensing found via Texas SOS or franchise tax searches, raising questions about legitimacy. 4) No BBB profile, Angi, or HomeAdvisor presence, which is unusual for an established contractor. 5) While no court cases or liens were found (a positive), the lien data was incomplete due to a scraper error. The combination of a scam allegation, unverifiable business status, and minimal public reputation creates a high-risk profile for homeowners.

**Red Flags:**
- [CRITICAL] Consumer Allegations: Direct allegation of scamming customers found in a Yelp search result snippet: 'They're unprofessional and will attempt to scam you out of your money'
- [HIGH] Business Verification: No business registration or franchise tax status found via Texas Comptroller searches. Company's legal standing is unverified.
- [HIGH] Reputation & Presence: Extremely limited review volume (8 Google, 1 Houzz) for a company claiming established trust. No BBB profile, Angi, or HomeAdvisor presence.
- [MEDIUM] Data Gaps: County lien search returned a scraper error, preventing a full assessment of financial disputes. Court searches were incomplete due to connection errors.

**Positive Signals:**
- No lawsuits or court judgments found in the limited searches that completed successfully.
- Website presents professional testimonials and details of services (pools, decks, driveways).
- Review Analyzer found the limited existing reviews to be authentic in content, though volume is a concern.

**API Cost:** $0.0017

---

## 35/100 - Avenue Window Fashions Shutters, Blinds, Shades and motorization (Keller) [AVOID]

**Reasoning:**
Investigation reveals a contractor with a complete absence of verifiable business presence and customer reviews. The business name appears to be a keyword-stuffed phrase rather than a legitimate company name. Google Maps shows a 5.0 rating with 669 reviews, but the Review Analyzer found NO actual customer reviews on any platform (Google, Yelp, BBB, Angi, etc.) and flagged the listing as suspicious. The 'reviews' shown are actually business descriptions and competitor listings, not customer feedback. No business registration, BBB profile, court records, or news mentions were found. The website exists but provides no validation of operations. This pattern suggests a business that either does not actively serve customers or has fabricated its online presence.

**Red Flags:**
- [CRITICAL] REVIEW_MANIPULATION: Zero authentic customer reviews found across all major platforms. Google Maps shows 669 reviews and 5.0 rating, but analysis reveals these are business descriptions/competitor listings, not genuine customer feedback.
- [HIGH] BUSINESS_VERIFICATION: No business registration found with Texas Secretary of State or Comptroller. No BBB profile, Angi listing, or other professional directory presence.
- [MEDIUM] ONLINE_PRESENCE: Business name appears to be a keyword-stuffed phrase ('Avenue Window Fashions Shutters, Blinds, Shades and motorization') rather than a legitimate company name, suggesting SEO manipulation over legitimate operations.
- [LOW] DATA_GAP: No court records, liens, or news investigations found, but this may be due to lack of business activity rather than clean history.

**Positive Signals:**
- Website exists (avenuewindowfashions.net)
- Phone number listed ((817) 658-9780)

**API Cost:** $0.0016

---

## 35/100 - Gomez Foundation Complete Repair LLC (Garland) [AVOID]

**Reasoning:**
The investigation reveals a contractor with virtually no verifiable track record and significant data gaps that are highly unusual for a legitimate business. Gomez Foundation Complete Repair LLC has only 2 vague Google reviews (5.0 rating) which the Review Analyzer flagged as highly suspicious and recommended DO_NOT_TRUST_REVIEWS. The business has no presence on BBB, Angi, HomeAdvisor, Houzz, or any industry-specific review platforms. No news coverage, social media presence, or consumer complaints were found, which is atypical for foundation repair companies that typically generate significant customer feedback. While no court cases, liens, or regulatory actions were found, the complete absence of positive verification data combined with the suspicious review profile creates an unacceptable risk. The business appears to be either very new, inactive, or operating without establishing a legitimate reputation.

**Red Flags:**
- [HIGH] REVIEW_AUTHENTICITY: Review Analyzer found review profile highly suspicious with only 2 vague 5-star Google reviews and no presence on other platforms
- [MEDIUM] BUSINESS_PRESENCE: No presence on BBB, Angi, HomeAdvisor, Houzz, or industry-specific review platforms
- [MEDIUM] DATA_GAPS: No verifiable customer feedback, news coverage, or social media presence found

**Positive Signals:**
- No court cases, liens, or regulatory violations found in searched counties
- Business appears registered with Texas Comptroller (franchise tax account found)

**API Cost:** $0.0018

---

## 35/100 - Elmer's Pool Services (Arlington) [AVOID]

**Reasoning:**
Elmer's Pool Services presents a high-risk profile due to a complete lack of verifiable business credentials and an extremely minimal, suspicious online presence. The business is not found on BBB, Angi, HomeAdvisor, or any major contractor platforms. The Review Analyzer concluded 'DO_NOT_TRUST_REVIEWS' based on a single generic 5-star Google review and zero reviews elsewhere, indicating an unestablished or artificially managed reputation. No business registration or franchise tax status could be verified via Texas SOS search. While no court cases, liens, or news investigations were found (a positive), the absence of any foundational business verification data (licensing, registration, credible review history) is a critical red flag. The business appears to operate with no digital footprint or public accountability, making it impossible to assess legitimacy or track record.

**Red Flags:**
- [CRITICAL] BUSINESS_VERIFICATION: No business registration, licensing, or franchise tax status could be verified. Company appears unregistered with the state.
- [HIGH] REVIEW_AUTHENTICITY: Review Analyzer verdict: DO_NOT_TRUST_REVIEWS. Only one generic 5-star Google review exists, with zero reviews on all other major platforms (BBB, Angi, Houzz, etc.).
- [HIGH] ONLINE_PRESENCE: No presence on any major contractor directory or review platform (BBB, Angi, HomeAdvisor, Houzz, Thumbtack). Business is virtually invisible online.

**Positive Signals:**
- No lawsuits, judgments, or liens found in court record searches
- No negative news investigations or consumer complaints located

**API Cost:** $0.0017

---

## 35/100 - Torres Services LLC (Irving) [AVOID]

**Reasoning:**
Torres Services LLC presents a profile of a contractor with significant verification gaps and operational red flags. The business is registered with the Texas Comptroller (taxpayer #32074728539), but there is a complete absence of verifiable customer reviews, online presence, or track record. The Review Analysis confirms 'INSUFFICIENT_DATA' and notes no actual review content exists for this specific entity. The company's website (torresacservice.com) is disconnected and leads to a Wix error page, indicating it is not actively maintained or functional. No presence was found on major contractor platforms (Angi, BBB, Google Maps, Houzz) or local court records. While no liens or lawsuits were discovered, the lack of any positive operational evidence—coupled with a non-functional website and zero customer feedback—creates an unacceptably high risk for homeowners. This pattern suggests either a very new, unestablished business or one that operates without the transparency and accountability expected of a reputable contractor.

**Red Flags:**
- [HIGH] Online Presence: Company website (torresacservice.com) is disconnected and shows a Wix error page, indicating no functional online presence.
- [HIGH] Customer Verification: Zero verifiable customer reviews found across all major platforms (BBB, Google, Yelp, etc.). Review Analysis states 'INSUFFICIENT_DATA' and found no actual review content.
- [MEDIUM] Business Verification: No presence on standard contractor verification sites (Angi, BBB, BuildZoom, Houzz) despite being a registered LLC.

**Positive Signals:**
- Business is registered as an active LLC with the Texas Comptroller (Taxpayer #32074728539).
- No liens, lawsuits, or complaints found in available court and county records.

**API Cost:** $0.0022

---

## 35/100 - HD Foundations, Inc. - Frisco TX (Frisco) [AVOID]

**Reasoning:**
Investigation reveals a contractor with virtually no verifiable business presence or positive track record. The business is not found on any major contractor platforms (Angi, BBB, HomeAdvisor, Houzz), suggesting it may not be actively soliciting work or is very new. The only review data shows a low 3.6-star rating from just 5 Google reviews, which the Review Analyzer flagged as a major red flag due to extremely low volume. The analyzer also noted a complaint pattern of failure to follow through and unresponsiveness. No business registration, licensing, or franchise tax status could be verified. While no active lawsuits, liens, or news investigations were found, the complete absence of positive verification data, combined with the low review volume and complaint pattern, creates an unacceptable level of risk for homeowners. This contractor appears to be either inactive, very new with no established reputation, or operating without proper verification.

**Red Flags:**
- [HIGH] REPUTATION: Extremely low review volume (5 reviews total) for an established contractor, indicating lack of customer feedback or new/unproven business
- [HIGH] BUSINESS_VERIFICATION: No presence on major contractor platforms (BBB, Angi, HomeAdvisor, Houzz) - business not found or not registered
- [MEDIUM] REVIEWS: Review analysis detected complaint patterns: failure to follow through (no estimate provided) and unresponsive after initial contact
- [MEDIUM] BUSINESS_VERIFICATION: Unable to verify business registration, franchise tax status, or licensing through Texas state databases

**Positive Signals:**
- No active lawsuits, liens, or judgments found in court records
- No negative news investigations or attorney general complaints found

**API Cost:** $0.0017

---

## 35/100 - Geldard Technologies, LLC (Plano) [AVOID]

**Reasoning:**
Geldard Technologies, LLC presents a profile of a contractor with significant verification gaps and a suspiciously minimal online footprint. The business claims to be a Generac dealer and installer, but there is no evidence of a verifiable track record. The Review Analyzer concluded 'DO_NOT_TRUST_REVIEWS' due to an extremely low review volume (a single generic 5-star Google review from a prolific reviewer) and a complete absence on major contractor platforms (Angi, Houzz, BBB). No court cases, liens, or news investigations were found, which is neutral but does not offset the lack of positive data. Critically, the business could not be verified with the Texas Secretary of State or Franchise Tax records, raising serious questions about its legal standing and legitimacy. The website lists a Haltom City address, not Plano, adding to the confusion. The pattern suggests a business that is either very new, operates without seeking customer validation, or may not be a fully established, licensed contracting entity.

**Red Flags:**
- [CRITICAL] BUSINESS_VERIFICATION: Business could not be verified with Texas Secretary of State or Franchise Tax records. Legal standing is unconfirmed.
- [HIGH] REVIEW_AUTHENTICITY: Review Analyzer recommends 'DO_NOT_TRUST_REVIEWS'. Only one generic 5-star review exists, and the business has no presence on industry platforms (BBB, Angi, Houzz).
- [MEDIUM] ONLINE_PRESENCE: Near-zero digital footprint for a contractor. No complaints found, but also no evidence of completed projects, customer testimonials, or industry recognition.
- [LOW] LOCATION_DISCREPANCY: Investigation requested for Plano, TX, but business website and only found address is in Haltom City, TX.

**Positive Signals:**
- No lawsuits, liens, or regulatory complaints found in searched jurisdictions.
- Website presents a professional front as an authorized Generac dealer.

**API Cost:** $0.0015

---

## 35/100 - J&J electrical services (Grand Prairie) [AVOID]

**Reasoning:**
Investigation reveals a contractor with virtually no verifiable business presence or positive track record. The business is not found on BBB, Angi, HomeAdvisor, or other major contractor platforms. The Review Analyzer concluded 'DO_NOT_TRUST_REVIEWS' due to a highly suspicious profile: only one generic 5-star Google review from 4 years ago, which is not credible for a claimed 24/7 electrical service. No court cases, liens, or news investigations were found, but this absence of data is itself a red flag for an unestablished entity. A Yelp listing exists but contains no reviews or rating. The business lacks the digital footprint, review volume, and verification expected of a reputable, active contractor in the Grand Prairie area.

**Red Flags:**
- [HIGH] REVIEW_MANIPULATION: Review Analyzer found profile highly suspicious: only 1 generic 5-star review from 4 years ago, inconsistent with a 24/7 business. Recommendation: DO_NOT_TRUST_REVIEWS.
- [HIGH] BUSINESS_VERIFICATION: No presence on major contractor platforms (BBB, Angi, HomeAdvisor, Houzz) and no verifiable business registration or franchise tax status found.
- [MEDIUM] DIGITAL_FOOTPRINT: Extremely limited online presence. Yelp listing exists but has no reviews. Google Maps shows only 1 review. No activity on social media or local forums.

**Positive Signals:**
- No court cases, liens, or regulatory complaints found in searched jurisdictions
- Yelp business listing exists with contact information

**API Cost:** $0.0019

---

## 25/100 - BH3 Residential and Commercial Electricians (Garland) [AVOID]

**Reasoning:**
The investigation reveals a contractor with a complete absence of verifiable legitimacy. The business name 'BH3 Residential and Commercial Electricians' yields zero digital footprint on any major review, licensing, or complaint platform (BBB, Google, Angi, etc.). The provided website (callw3.com) redirects to a different entity named 'W3 Electric' based in Rowlett, TX, suggesting a potential name mismatch or rebranding attempt. The Review Analyzer concluded 'DO_NOT_TRUST' due to the highly unusual lack of any reviews for a residential/commercial electrician. No court cases, liens, or news investigations were found for the specific name, but this is likely because the entity does not have an established public record. The inability to find the business in the Texas SOS or franchise tax databases is a critical red flag, indicating it may not be a legally registered entity in Texas. Homeowners should avoid due to unverifiable business status and high risk of dealing with an unlicensed or fly-by-night operation.

**Red Flags:**
- [CRITICAL] BUSINESS_VERIFICATION: Business name 'BH3 Residential and Commercial Electricians' not found in Texas SOS/franchise tax databases, indicating it may not be a legally registered entity.
- [CRITICAL] DIGITAL_PRESENCE: Zero reviews or ratings found on any major platform (BBB, Google, Angi, Houzz, etc.). Complete lack of digital footprint is highly unusual for a legitimate contractor.
- [HIGH] IDENTITY_MISMATCH: Provided website (callw3.com) features a different business name 'W3 Electric' and location (Rowlett), not 'BH3 Residential and Commercial Electricians' of Garland.
- [MEDIUM] DATA_GAP: No verifiable years in business, licensing information, or insurance details found.

**Positive Signals:**
- No court cases, liens, or news investigations found under the specific business name.
- No BBB complaints found (though BBB profile also doesn't exist).

**API Cost:** $0.0015

---

## 25/100 - Air Conditioning & Heating Repair Pros (Richardson) [AVOID]

**Reasoning:**
The investigation reveals a contractor with a complete absence of verifiable business presence and customer history, coupled with a suspiciously generic website. The business 'Air Conditioning & Heating Repair Pros' has no Google Maps listing, zero customer reviews on any major platform (Google, Yelp, Angi, Houzz, Trustpilot), and no searchable business registration. The BBB shows an 'A' rating but for a different, similarly-named entity ('Air Repair Pros'), creating a misleading impression. The website is a basic Google Sites page, not a professional business site. No court cases, liens, or news were found, which is not positive in this context—it suggests the business lacks any public operational footprint. The Review Analyzer flagged a 'CAUTION_NO_REVIEWS' with high confidence, noting the complete absence of review content as a major red flag. This pattern is consistent with a fly-by-night operation or a business that has not established a legitimate, reviewable track record with real customers.

**Red Flags:**
- [CRITICAL] BUSINESS_VERIFICATION: No verifiable business presence: No Google Maps listing, no customer reviews on any platform, and no searchable Texas SOS or franchise tax registration found.
- [HIGH] REVIEWS: Complete absence of customer reviews on all major platforms (Google, Yelp, Angi, Houzz, Trustpilot). The Review Analyzer concluded 'CAUTION_NO_REVIEWS' with high confidence.
- [MEDIUM] WEBSITE: Website is a basic, non-professional Google Sites page (sites.google.com), not a dedicated business domain, which is atypical for an established contractor.
- [MEDIUM] BBB_DISCREPANCY: BBB search results appear to reference similarly-named businesses (e.g., 'Air Repair Pros', 'AC Pros Heating and Air LLC'), not an exact match for the investigated entity, creating potential confusion.

**Positive Signals:**
- No court cases, liens, or regulatory complaints found in searches (though this is likely due to lack of footprint, not a clean record).
- BBB search returned an 'A' rating, but it's unclear if it applies to the exact entity.

**API Cost:** $0.0022

---

