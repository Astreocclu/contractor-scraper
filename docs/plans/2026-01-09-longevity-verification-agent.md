# Business Longevity Verification Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a longevity verification data source that scrapes Texas SOS for entity formation dates, collects "years in business" claims from websites, and uses Gemini to detect discrepancies between claimed and verified history.

**Architecture:** New Python Playwright scraper for Texas SOS → Node.js orchestrator collects claims from existing raw_data → Gemini 3 Pro analyzes discrepancies → Results stored as `longevity_verification` source in contractor_raw_data → Existing audit_agent.js automatically includes it in analysis.

**Tech Stack:** Python 3.11, Playwright, Node.js, Gemini 3 Pro API, PostgreSQL

---

## Task 1: Texas SOS Playwright Scraper

**Files:**
- Create: `scrapers/texas_sos.py`
- Test: Manual test with known contractor

**Step 1: Inspect Texas SOS website structure**

Navigate to: https://www.sos.state.tx.us/corp/sosda/index.shtml

Key observations:
- Search form at `/corp/soslookup.shtml` (simpler than sosda)
- Entity search returns table with: File Number, Entity Name, Type, Status
- Entity detail page has formation date, registered agent, officers

**Step 2: Create the scraper file**

```python
#!/usr/bin/env python3
"""
Texas Secretary of State Entity Scraper

Searches for business entities and extracts:
- Formation date
- Entity type (LLC, Corp, etc.)
- Status (Active, Forfeited, etc.)
- Registered agent
- Officers/directors
- Related entities (same registered agent)

Usage:
    python3 scrapers/texas_sos.py "Business Name" [--json]
"""

import sys
import json
import re
import asyncio
from datetime import datetime
from playwright.async_api import async_playwright
from difflib import SequenceMatcher

# Rate limiting
DELAY_BETWEEN_REQUESTS = 2.0  # seconds

def normalize_name(name: str) -> str:
    """Normalize business name for comparison."""
    name = name.lower()
    # Remove common suffixes
    suffixes = ['llc', 'l.l.c.', 'inc', 'inc.', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited']
    for suffix in suffixes:
        name = re.sub(rf'\b{suffix}\b\.?$', '', name)
    # Remove punctuation and extra spaces
    name = re.sub(r'[^\w\s]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name

def name_similarity(name1: str, name2: str) -> float:
    """Calculate similarity between two business names."""
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    return SequenceMatcher(None, n1, n2).ratio()

async def search_sos(business_name: str) -> dict:
    """
    Search Texas SOS for a business entity.

    Returns:
        {
            "found": bool,
            "entity_name": str,
            "file_number": str,
            "formation_date": str (YYYY-MM-DD),
            "entity_type": str,
            "status": str,
            "registered_agent": str,
            "officers": [str],
            "related_entities": [{name, file_number, formation_date}],
            "search_term": str,
            "search_url": str,
            "error": str (if failed)
        }
    """
    result = {
        "found": False,
        "entity_name": None,
        "file_number": None,
        "formation_date": None,
        "entity_type": None,
        "status": None,
        "registered_agent": None,
        "officers": [],
        "related_entities": [],
        "search_term": business_name,
        "search_url": None,
        "error": None
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        )
        page = await context.new_page()

        try:
            # Navigate to SOS search
            search_url = "https://mycpa.cpa.state.tx.us/coa/coaSearchBtn"
            await page.goto(search_url, timeout=30000)
            result["search_url"] = search_url

            # Wait for form
            await page.wait_for_selector('input[name="taxpayerName"]', timeout=10000)

            # Fill search form
            await page.fill('input[name="taxpayerName"]', business_name)

            # Submit search
            await page.click('input[type="submit"][value="Search"]')
            await asyncio.sleep(DELAY_BETWEEN_REQUESTS)

            # Wait for results
            await page.wait_for_selector('table', timeout=15000)

            # Parse results table
            rows = await page.query_selector_all('table tr')

            candidates = []
            for row in rows[1:]:  # Skip header
                cells = await row.query_selector_all('td')
                if len(cells) >= 4:
                    entity_name = await cells[0].inner_text()
                    file_number = await cells[1].inner_text() if len(cells) > 1 else ""
                    entity_type = await cells[2].inner_text() if len(cells) > 2 else ""
                    status = await cells[3].inner_text() if len(cells) > 3 else ""

                    similarity = name_similarity(business_name, entity_name.strip())
                    if similarity > 0.5:  # Minimum threshold
                        candidates.append({
                            "name": entity_name.strip(),
                            "file_number": file_number.strip(),
                            "entity_type": entity_type.strip(),
                            "status": status.strip(),
                            "similarity": similarity
                        })

            if not candidates:
                result["found"] = False
                result["error"] = "No matching entities found"
                await browser.close()
                return result

            # Select best match
            candidates.sort(key=lambda x: x["similarity"], reverse=True)
            best_match = candidates[0]

            result["found"] = True
            result["entity_name"] = best_match["name"]
            result["file_number"] = best_match["file_number"]
            result["entity_type"] = best_match["entity_type"]
            result["status"] = best_match["status"]

            # Click into entity details to get formation date, officers, registered agent
            detail_link = await page.query_selector(f'a:has-text("{best_match["file_number"]}")')
            if detail_link:
                await detail_link.click()
                await asyncio.sleep(DELAY_BETWEEN_REQUESTS)

                # Extract formation date
                page_text = await page.inner_text('body')

                # Look for formation date patterns
                date_patterns = [
                    r'Formation\s*Date[:\s]+(\d{1,2}/\d{1,2}/\d{4})',
                    r'File\s*Date[:\s]+(\d{1,2}/\d{1,2}/\d{4})',
                    r'Created[:\s]+(\d{1,2}/\d{1,2}/\d{4})',
                ]
                for pattern in date_patterns:
                    match = re.search(pattern, page_text, re.IGNORECASE)
                    if match:
                        date_str = match.group(1)
                        try:
                            parsed_date = datetime.strptime(date_str, '%m/%d/%Y')
                            result["formation_date"] = parsed_date.strftime('%Y-%m-%d')
                            break
                        except ValueError:
                            pass

                # Extract registered agent
                agent_match = re.search(r'Registered\s*Agent[:\s]+([^\n]+)', page_text, re.IGNORECASE)
                if agent_match:
                    result["registered_agent"] = agent_match.group(1).strip()

                # Extract officers/directors
                officers_section = re.search(r'Officers?.*?Directors?[:\s]*(.*?)(?=Address|$)', page_text, re.IGNORECASE | re.DOTALL)
                if officers_section:
                    officers_text = officers_section.group(1)
                    # Split by newlines and filter
                    officers = [o.strip() for o in officers_text.split('\n') if o.strip() and len(o.strip()) > 2]
                    result["officers"] = officers[:10]  # Limit to 10

            # If entity is young (<5 years) and we have registered agent, search for related entities
            if result["formation_date"] and result["registered_agent"]:
                formation_year = int(result["formation_date"][:4])
                current_year = datetime.now().year
                entity_age = current_year - formation_year

                if entity_age < 5:
                    # Search for other entities with same registered agent
                    await page.goto(search_url)
                    await page.wait_for_selector('input[name="taxpayerName"]', timeout=10000)

                    # Extract agent name (first/last name from registered agent)
                    agent_name = result["registered_agent"].split(',')[0].strip()
                    await page.fill('input[name="taxpayerName"]', agent_name)
                    await page.click('input[type="submit"][value="Search"]')
                    await asyncio.sleep(DELAY_BETWEEN_REQUESTS)

                    await page.wait_for_selector('table', timeout=15000)
                    related_rows = await page.query_selector_all('table tr')

                    for row in related_rows[1:5]:  # Check first few
                        cells = await row.query_selector_all('td')
                        if len(cells) >= 4:
                            related_name = await cells[0].inner_text()
                            related_file = await cells[1].inner_text()

                            # Skip the same entity
                            if related_file.strip() != result["file_number"]:
                                result["related_entities"].append({
                                    "name": related_name.strip(),
                                    "file_number": related_file.strip()
                                })

        except Exception as e:
            result["error"] = str(e)

        finally:
            await browser.close()

    return result


async def main():
    if len(sys.argv) < 2:
        print("Usage: python3 texas_sos.py 'Business Name' [--json]")
        sys.exit(1)

    business_name = sys.argv[1]
    output_json = '--json' in sys.argv

    result = await search_sos(business_name)

    if output_json:
        print(json.dumps(result, indent=2))
    else:
        if result["found"]:
            print(f"Entity: {result['entity_name']}")
            print(f"File Number: {result['file_number']}")
            print(f"Type: {result['entity_type']}")
            print(f"Status: {result['status']}")
            print(f"Formation Date: {result['formation_date'] or 'Not found'}")
            print(f"Registered Agent: {result['registered_agent'] or 'Not found'}")
            if result["officers"]:
                print(f"Officers: {', '.join(result['officers'])}")
            if result["related_entities"]:
                print(f"Related Entities: {len(result['related_entities'])} found")
        else:
            print(f"Not found: {result['error']}")


if __name__ == "__main__":
    asyncio.run(main())
```

**Step 3: Test the scraper manually**

Run: `cd /home/astre/command-center/src/greenlit/auditor && source venv/bin/activate && python3 scrapers/texas_sos.py "Orange Elephant Roofing" --json`

Expected: JSON with entity info or "not found"

**Step 4: Commit**

```bash
git add scrapers/texas_sos.py
git commit -m "feat: add Texas SOS entity scraper for longevity verification"
```

---

## Task 2: Longevity Claims Collector

**Files:**
- Create: `scrapers/longevity_claims.py`

**Step 1: Create claims collector**

This script extracts "years in business" claims from already-collected raw_data.

```python
#!/usr/bin/env python3
"""
Longevity Claims Collector

Extracts "years in business" claims from:
- BBB profile (years_in_business field)
- Google Maps (business description)
- Contractor website (about page, footer)

Usage:
    python3 scrapers/longevity_claims.py <contractor_id> [--json]
"""

import sys
import json
import re
import psycopg2
from datetime import datetime

DB_CONFIG = {
    "dbname": "contractors_dev",
    "user": "astre",
    "host": "localhost"
}

def extract_years_from_text(text: str) -> list[dict]:
    """
    Extract years/established claims from text.

    Returns list of:
        {"claim": str, "year": int, "type": str}
    """
    if not text:
        return []

    claims = []
    current_year = datetime.now().year

    # Pattern: "Established 1985" or "Since 1985" or "Founded 1985"
    year_patterns = [
        (r'(?:established|founded|since|serving\s+since)[:\s]+(\d{4})', 'established'),
        (r'(\d{4})\s*-\s*(?:present|today|\d{4})', 'range'),
        (r'in\s+business\s+(?:since|for)\s+(\d+)\s+years?', 'years_in_business'),
        (r'(\d+)\+?\s+years?\s+(?:of\s+)?(?:experience|in\s+business|serving)', 'years_claim'),
        (r'over\s+(\d+)\s+years?', 'years_claim'),
        (r'more\s+than\s+(\d+)\s+years?', 'years_claim'),
    ]

    for pattern, claim_type in year_patterns:
        matches = re.finditer(pattern, text.lower())
        for match in matches:
            value = int(match.group(1))

            if claim_type in ['established', 'range']:
                # Value is a year
                if 1900 < value <= current_year:
                    claims.append({
                        "claim": match.group(0),
                        "year": value,
                        "type": claim_type,
                        "implied_years": current_year - value
                    })
            else:
                # Value is number of years
                if 1 <= value <= 150:
                    implied_year = current_year - value
                    claims.append({
                        "claim": match.group(0),
                        "year": implied_year,
                        "type": claim_type,
                        "implied_years": value
                    })

    return claims


def collect_claims(contractor_id: int) -> dict:
    """
    Collect longevity claims from contractor's raw_data.

    Returns:
        {
            "contractor_id": int,
            "claims": {
                "bbb": {"years_in_business": int, "raw": str},
                "google": {"claim": str, "year": int},
                "website": [{"claim": str, "year": int}],
                "other": []
            },
            "max_claimed_years": int,
            "claimed_established_year": int or None,
            "sources_checked": [str]
        }
    """
    result = {
        "contractor_id": contractor_id,
        "claims": {
            "bbb": None,
            "google": None,
            "website": [],
            "other": []
        },
        "max_claimed_years": 0,
        "claimed_established_year": None,
        "sources_checked": []
    }

    conn = psycopg2.connect(**DB_CONFIG)
    cursor = conn.cursor()

    try:
        # Get all raw_data for contractor
        cursor.execute("""
            SELECT source_name, raw_text, structured_data
            FROM contractor_raw_data
            WHERE contractor_id = %s
        """, (contractor_id,))

        rows = cursor.fetchall()

        for source_name, raw_text, structured_data in rows:
            result["sources_checked"].append(source_name)

            # Parse structured data if JSON string
            if structured_data and isinstance(structured_data, str):
                try:
                    structured_data = json.loads(structured_data)
                except json.JSONDecodeError:
                    structured_data = None

            # BBB - has years_in_business field
            if source_name == 'bbb' and structured_data:
                years = structured_data.get('years_in_business')
                if years:
                    result["claims"]["bbb"] = {
                        "years_in_business": int(years),
                        "raw": f"{years} years in business"
                    }
                    if int(years) > result["max_claimed_years"]:
                        result["max_claimed_years"] = int(years)

            # Google Maps - check business description
            elif source_name.startswith('google_maps') and structured_data:
                description = structured_data.get('description', '')
                if description:
                    claims = extract_years_from_text(description)
                    if claims:
                        best = max(claims, key=lambda x: x.get('implied_years', 0))
                        result["claims"]["google"] = best
                        if best.get('implied_years', 0) > result["max_claimed_years"]:
                            result["max_claimed_years"] = best['implied_years']

            # Website - check for established/since claims
            elif source_name == 'website':
                text = raw_text or ''
                if structured_data and isinstance(structured_data, dict):
                    # May have about page text
                    text += ' ' + str(structured_data.get('about_text', ''))

                claims = extract_years_from_text(text)
                if claims:
                    result["claims"]["website"] = claims
                    best = max(claims, key=lambda x: x.get('implied_years', 0))
                    if best.get('implied_years', 0) > result["max_claimed_years"]:
                        result["max_claimed_years"] = best['implied_years']

            # Other sources - check raw text
            elif raw_text:
                claims = extract_years_from_text(raw_text)
                if claims:
                    for claim in claims:
                        claim["source"] = source_name
                        result["claims"]["other"].append(claim)

        # Determine claimed established year
        current_year = datetime.now().year
        if result["max_claimed_years"] > 0:
            result["claimed_established_year"] = current_year - result["max_claimed_years"]

    finally:
        cursor.close()
        conn.close()

    return result


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 longevity_claims.py <contractor_id> [--json]")
        sys.exit(1)

    contractor_id = int(sys.argv[1])
    output_json = '--json' in sys.argv

    result = collect_claims(contractor_id)

    if output_json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Contractor ID: {contractor_id}")
        print(f"Sources checked: {len(result['sources_checked'])}")
        print(f"Max claimed years: {result['max_claimed_years']}")
        if result['claimed_established_year']:
            print(f"Implied established year: {result['claimed_established_year']}")
        print(f"Claims: {json.dumps(result['claims'], indent=2)}")


if __name__ == "__main__":
    main()
```

**Step 2: Test manually**

Run: `cd /home/astre/command-center/src/greenlit/auditor && source venv/bin/activate && python3 scrapers/longevity_claims.py 1524 --json`

Expected: JSON with claims from existing raw_data for contractor 1524

**Step 3: Commit**

```bash
git add scrapers/longevity_claims.py
git commit -m "feat: add longevity claims collector from raw_data"
```

---

## Task 3: Longevity Analyzer Service (Node.js + Gemini)

**Files:**
- Create: `services/longevity_analyzer.js`

**Step 1: Create the analyzer service**

```javascript
/**
 * Longevity Analyzer
 *
 * Orchestrates:
 * 1. Texas SOS scraping
 * 2. Claims collection from raw_data
 * 3. Gemini analysis for discrepancy detection
 *
 * Usage:
 *   const analyzer = new LongevityAnalyzer(db);
 *   const result = await analyzer.analyze(contractorId, contractor);
 */

const { runCommand } = require('./async_command');
const path = require('path');

const SCRAPERS_DIR = path.join(__dirname, '..', 'scrapers');

// Gemini API configuration
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-1.5-pro';

const ANALYSIS_PROMPT = `You are a forensic business analyst verifying contractor longevity for Greenlit, a platform that helps homeowners identify trustworthy contractors.

## CONTEXT
Only 36% of construction companies survive 5 years. A contractor operating 10+ years under the same name has passed brutal market selection. Longevity is the single strongest signal of contractor quality.

## YOUR TASK
Analyze the discrepancy between CLAIMED business history and VERIFIED SOS records.

## DATA PROVIDED
**Texas SOS Findings:**
{{sos_findings}}

**Claimed History:**
{{claimed_history}}

## ANALYSIS GUIDELINES

### Legitimate Discrepancies (Minor):
- LLC formed recently but owner worked in trade before incorporating
- "25 years experience" vs "25 years in business" are different claims
- Corporate restructuring (Inc → LLC conversion)
- Adding partners to name (Smith Roofing → Smith & Sons Roofing)

### Red Flags (Major/Fraudulent):
- "Established 1985" but SOS shows 2019, no predecessor found
- Multiple name changes following complaint patterns
- Owner previously ran failed company with complaints
- SOS shows revoked/forfeited status

### Tier Definitions:
- **Exceptional**: 10+ verified years, no discrepancies, active status
- **Established**: 5-9 verified years, minor or no discrepancies
- **Developing**: 2-4 verified years, claims reasonably match reality
- **Unproven**: Under 2 years, or insufficient data to verify
- **Suspicious**: Major discrepancy between claims and SOS, or pattern suggesting deception

## OUTPUT FORMAT
Return ONLY this JSON:
{
  "verified_longevity": {
    "years_verified": <number based on SOS formation date>,
    "verification_basis": "<explain what you verified>",
    "earliest_confirmed_operation": "<YYYY or 'Unknown'>",
    "lineage_notes": "<any predecessor/successor notes>"
  },
  "discrepancy_analysis": {
    "claims_match_sos": <true/false>,
    "discrepancy_severity": "<none/minor/major/fraudulent>",
    "explanation": "<detailed explanation of any discrepancy>"
  },
  "ownership_profile": {
    "founder_operated": <true/false/unknown>,
    "entity_status": "<Active/Forfeited/etc>",
    "entity_type": "<LLC/Corp/etc>",
    "notes": "<any relevant ownership notes>"
  },
  "longevity_tier": "<exceptional/established/developing/unproven/suspicious>",
  "confidence": "<high/medium/low>",
  "reasoning": "<2-3 sentence summary of your assessment>"
}`;

const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);

class LongevityAnalyzer {
  constructor(db) {
    this.db = db;
    this.apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    this.totalCost = 0;
  }

  /**
   * Run Texas SOS scraper
   */
  async scrapeTexasSOS(businessName) {
    log('  Scraping Texas SOS...');

    const scriptPath = path.join(SCRAPERS_DIR, 'texas_sos.py');

    try {
      const result = await runCommand('python3', [scriptPath, businessName, '--json'], {
        cwd: SCRAPERS_DIR,
        timeout: 60000,
        json: true
      });

      if (result.found) {
        success(`    SOS: Found ${result.entity_name} (${result.formation_date || 'no date'})`);
      } else {
        warn(`    SOS: Not found - ${result.error || 'No matching entity'}`);
      }

      return result;
    } catch (err) {
      warn(`    SOS scraper error: ${err.message}`);
      return {
        found: false,
        error: err.message,
        search_term: businessName
      };
    }
  }

  /**
   * Collect claims from raw_data
   */
  async collectClaims(contractorId) {
    log('  Collecting longevity claims...');

    const scriptPath = path.join(SCRAPERS_DIR, 'longevity_claims.py');

    try {
      const result = await runCommand('python3', [scriptPath, String(contractorId), '--json'], {
        cwd: SCRAPERS_DIR,
        timeout: 30000,
        json: true
      });

      if (result.max_claimed_years > 0) {
        success(`    Claims: ${result.max_claimed_years} years claimed`);
      } else {
        log(`    Claims: No explicit claims found`);
      }

      return result;
    } catch (err) {
      warn(`    Claims collector error: ${err.message}`);
      return {
        contractor_id: contractorId,
        claims: {},
        max_claimed_years: 0,
        sources_checked: []
      };
    }
  }

  /**
   * Call Gemini API for analysis
   */
  async analyzeWithGemini(sosFindings, claimedHistory) {
    if (!this.apiKey) {
      warn('    No Gemini API key - skipping LLM analysis');
      return this.fallbackAnalysis(sosFindings, claimedHistory);
    }

    log('  Analyzing with Gemini...');

    const prompt = ANALYSIS_PROMPT
      .replace('{{sos_findings}}', JSON.stringify(sosFindings, null, 2))
      .replace('{{claimed_history}}', JSON.stringify(claimedHistory, null, 2));

    try {
      const response = await fetch(
        `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 2000
            }
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText.substring(0, 200)}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Estimate cost (Gemini 1.5 Pro pricing)
      const inputTokens = prompt.length / 4;  // rough estimate
      const outputTokens = text.length / 4;
      this.totalCost += (inputTokens * 0.00000125) + (outputTokens * 0.000005);

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        success(`    Gemini: ${result.longevity_tier} tier (${result.confidence} confidence)`);
        return result;
      }

      throw new Error('No JSON in Gemini response');

    } catch (err) {
      warn(`    Gemini analysis failed: ${err.message}`);
      return this.fallbackAnalysis(sosFindings, claimedHistory);
    }
  }

  /**
   * Fallback analysis without LLM
   */
  fallbackAnalysis(sosFindings, claimedHistory) {
    const currentYear = new Date().getFullYear();

    // Calculate verified years from SOS
    let verifiedYears = 0;
    if (sosFindings.found && sosFindings.formation_date) {
      const formationYear = parseInt(sosFindings.formation_date.substring(0, 4));
      verifiedYears = currentYear - formationYear;
    }

    // Calculate claimed years
    const claimedYears = claimedHistory.max_claimed_years || 0;

    // Simple discrepancy check
    const discrepancy = claimedYears - verifiedYears;
    let severity = 'none';
    if (discrepancy > 10) severity = 'major';
    else if (discrepancy > 5) severity = 'minor';

    // Simple tier assignment
    let tier = 'unproven';
    if (!sosFindings.found) tier = 'unproven';
    else if (verifiedYears >= 10 && severity === 'none') tier = 'exceptional';
    else if (verifiedYears >= 5) tier = 'established';
    else if (verifiedYears >= 2) tier = 'developing';

    if (severity === 'major') tier = 'suspicious';

    return {
      verified_longevity: {
        years_verified: verifiedYears,
        verification_basis: sosFindings.found ? 'Texas SOS formation date' : 'Unable to verify',
        earliest_confirmed_operation: sosFindings.formation_date?.substring(0, 4) || 'Unknown',
        lineage_notes: ''
      },
      discrepancy_analysis: {
        claims_match_sos: discrepancy <= 2,
        discrepancy_severity: severity,
        explanation: `Claimed ${claimedYears} years, SOS shows ${verifiedYears} years (${discrepancy} year gap)`
      },
      ownership_profile: {
        founder_operated: 'unknown',
        entity_status: sosFindings.status || 'Unknown',
        entity_type: sosFindings.entity_type || 'Unknown',
        notes: ''
      },
      longevity_tier: tier,
      confidence: sosFindings.found ? 'medium' : 'low',
      reasoning: `Fallback analysis: ${verifiedYears} verified years from SOS, ${claimedYears} claimed.`
    };
  }

  /**
   * Main analysis method
   */
  async analyze(contractorId, contractor) {
    log('\n📅 Running Longevity Verification...');

    // 1. Scrape Texas SOS
    const sosFindings = await this.scrapeTexasSOS(contractor.name);

    // 2. Collect claims from existing raw_data
    const claimedHistory = await this.collectClaims(contractorId);

    // 3. Analyze with Gemini
    const analysis = await this.analyzeWithGemini(sosFindings, claimedHistory);

    // 4. Build final result
    const result = {
      contractor_id: contractorId,
      research_date: new Date().toISOString(),
      sos_findings: sosFindings,
      claimed_history: claimedHistory,
      ...analysis,
      total_cost: this.totalCost
    };

    // 5. Store to raw_data
    await this.storeResult(contractorId, result);

    return result;
  }

  /**
   * Store result to contractor_raw_data
   */
  async storeResult(contractorId, result) {
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    await this.db.run(`
      INSERT INTO contractor_raw_data
      (contractor_id, source_name, source_url, raw_text, structured_data, fetch_status, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (contractor_id, source_name)
      DO UPDATE SET
        source_url = EXCLUDED.source_url,
        raw_text = EXCLUDED.raw_text,
        structured_data = EXCLUDED.structured_data,
        fetch_status = EXCLUDED.fetch_status,
        fetched_at = EXCLUDED.fetched_at,
        expires_at = EXCLUDED.expires_at
    `, [
      contractorId,
      'longevity_verification',
      result.sos_findings?.search_url || 'https://www.sos.state.tx.us',
      JSON.stringify(result, null, 2),
      JSON.stringify(result),
      result.sos_findings?.found ? 'success' : 'not_found',
      now,
      expires
    ]);

    success('    Longevity verification stored to raw_data');
  }
}

module.exports = { LongevityAnalyzer };
```

**Step 2: Test the service manually**

Create a quick test script:

```bash
cd /home/astre/command-center/src/greenlit/auditor
node -e "
const { LongevityAnalyzer } = require('./services/longevity_analyzer');
const { DatabaseService } = require('./services/database_service');

async function test() {
  const db = new DatabaseService();
  await db.connect();

  const analyzer = new LongevityAnalyzer(db);
  const contractor = { name: 'Orange Elephant Roofing', city: 'Fort Worth', state: 'TX' };
  const result = await analyzer.analyze(1524, contractor);

  console.log(JSON.stringify(result, null, 2));
  await db.close();
}

test().catch(console.error);
"
```

**Step 3: Commit**

```bash
git add services/longevity_analyzer.js
git commit -m "feat: add LongevityAnalyzer service with Gemini integration"
```

---

## Task 4: Integrate into Collection Service

**Files:**
- Modify: `services/collection_service.js`

**Step 1: Add source definition**

In `SOURCES` object (around line 370), add:

```javascript
  // Tier 9: Longevity Verification (cache 7d)
  longevity_verification: { ttl: 604800, tier: 9, type: 'analyzer' },
```

**Step 2: Import LongevityAnalyzer**

At the top of file (around line 13), add:

```javascript
const { LongevityAnalyzer } = require('./longevity_analyzer');
```

**Step 3: Call analyzer in runInitialCollection**

At the end of `runInitialCollection` method (before the final return), add:

```javascript
    // === LONGEVITY VERIFICATION (runs after other sources to use their data) ===
    log('\n  Running longevity verification...');
    try {
      const longevityAnalyzer = new LongevityAnalyzer(this.db);
      const longevityResult = await longevityAnalyzer.analyze(contractorId, contractor);

      results.push({
        source: 'longevity_verification',
        url: longevityResult.sos_findings?.search_url,
        status: longevityResult.sos_findings?.found ? 'success' : 'not_found',
        text: JSON.stringify(longevityResult),
        structured: longevityResult
      });

      if (longevityResult.longevity_tier) {
        const tierColors = {
          'exceptional': '\x1b[32m',  // green
          'established': '\x1b[32m',  // green
          'developing': '\x1b[33m',   // yellow
          'unproven': '\x1b[33m',     // yellow
          'suspicious': '\x1b[31m'    // red
        };
        const color = tierColors[longevityResult.longevity_tier] || '';
        console.log(`${color}    Longevity: ${longevityResult.longevity_tier.toUpperCase()} (${longevityResult.verified_longevity?.years_verified || 0} verified years)\x1b[0m`);
      }
    } catch (err) {
      warn(`    Longevity verification error: ${err.message}`);
    }
```

**Step 4: Test full collection with longevity**

Run: `cd /home/astre/command-center/src/greenlit/auditor && source venv/bin/activate && set -a && . ./.env && set +a && node bin/run_audit.js --id 1524`

Expected: See "Running longevity verification..." and tier output in collection logs

**Step 5: Commit**

```bash
git add services/collection_service.js
git commit -m "feat: integrate longevity verification into collection pipeline"
```

---

## Task 5: Update Audit Agent Prompt

**Files:**
- Modify: `services/audit_agent.js`

**Step 1: Add longevity guidance to SYSTEM_PROMPT**

In the `SYSTEM_PROMPT` constant (around line 12), add after the `## LIEN ANALYSIS` section:

```javascript
## LONGEVITY VERIFICATION (CRITICAL - READ CAREFULLY)
The longevity_verification source provides verified business history from Texas SOS.

### HOW TO USE LONGEVITY DATA:
- **years_verified**: Confirmed years from SOS formation date (authoritative)
- **longevity_tier**: Pre-computed tier (exceptional/established/developing/unproven/suspicious)
- **discrepancy_severity**: How much claimed history differs from verified (none/minor/major/fraudulent)

### LONGEVITY SCORING IMPACT:
- **Exceptional (10+ verified years)**: Strong positive signal, +10-15 points
- **Established (5-9 years)**: Positive signal, +5-10 points
- **Developing (2-4 years)**: Neutral, no adjustment
- **Unproven (<2 years)**: Slight negative unless other strong signals, -5 points
- **Suspicious (major discrepancy)**: RED FLAG, treat as HIGH severity issue

### RED FLAGS FROM LONGEVITY:
- Claims "established 1985" but SOS shows 2019 formation with no predecessor → FRAUDULENT HISTORY
- Entity status is "Forfeited" or "Revoked" → BUSINESS NOT IN GOOD STANDING
- Multiple related entities with recent formations → Possible phoenix company (starts new after complaints)
```

**Step 2: Test audit with longevity data**

Run: `node bin/run_audit.js --id 1524`

Expected: Audit reasoning should reference longevity findings

**Step 3: Commit**

```bash
git add services/audit_agent.js
git commit -m "feat: add longevity verification guidance to audit agent prompt"
```

---

## Task 6: Add CLI Standalone Mode

**Files:**
- Create: `bin/run_longevity.js`

**Step 1: Create standalone CLI**

```javascript
#!/usr/bin/env node
/**
 * Standalone Longevity Verification CLI
 *
 * Usage:
 *   node bin/run_longevity.js --id 123
 *   node bin/run_longevity.js --name "Business Name" --city "Dallas" --state "TX"
 */

const { LongevityAnalyzer } = require('../services/longevity_analyzer');
const { DatabaseService } = require('../services/database_service');

async function main() {
  const args = process.argv.slice(2);

  // Parse args
  let contractorId = null;
  let name = null;
  let city = 'Dallas';
  let state = 'TX';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) {
      contractorId = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--name' && args[i + 1]) {
      name = args[i + 1];
      i++;
    } else if (args[i] === '--city' && args[i + 1]) {
      city = args[i + 1];
      i++;
    } else if (args[i] === '--state' && args[i + 1]) {
      state = args[i + 1];
      i++;
    }
  }

  if (!contractorId && !name) {
    console.log('Usage:');
    console.log('  node bin/run_longevity.js --id <contractor_id>');
    console.log('  node bin/run_longevity.js --name "Business Name" --city "City" --state "ST"');
    process.exit(1);
  }

  const db = new DatabaseService();
  await db.connect();

  try {
    let contractor;

    if (contractorId) {
      // Lookup contractor
      const rows = await db.exec(`
        SELECT id, name, city, state FROM contractors_contractor WHERE id = ?
      `, [contractorId]);

      if (rows.length === 0) {
        console.error(`Contractor ID ${contractorId} not found`);
        process.exit(1);
      }

      contractor = rows[0];
    } else {
      // Use provided name
      contractor = { id: 0, name, city, state };
      contractorId = 0;
    }

    console.log(`\n🔍 Longevity Verification: ${contractor.name}`);
    console.log(`   Location: ${contractor.city}, ${contractor.state}\n`);

    const analyzer = new LongevityAnalyzer(db);
    const result = await analyzer.analyze(contractorId, contractor);

    // Display results
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('  LONGEVITY VERIFICATION RESULTS');
    console.log('════════════════════════════════════════════════════════════\n');

    const tierColors = {
      'exceptional': '\x1b[32m',
      'established': '\x1b[32m',
      'developing': '\x1b[33m',
      'unproven': '\x1b[33m',
      'suspicious': '\x1b[31m'
    };
    const color = tierColors[result.longevity_tier] || '';

    console.log(`  TIER:        ${color}${(result.longevity_tier || 'unknown').toUpperCase()}\x1b[0m`);
    console.log(`  CONFIDENCE:  ${result.confidence || 'unknown'}`);
    console.log(`  VERIFIED YEARS: ${result.verified_longevity?.years_verified || 0}`);

    if (result.sos_findings?.found) {
      console.log('\n--- SOS FINDINGS ---');
      console.log(`  Entity:      ${result.sos_findings.entity_name}`);
      console.log(`  File #:      ${result.sos_findings.file_number}`);
      console.log(`  Type:        ${result.sos_findings.entity_type}`);
      console.log(`  Status:      ${result.sos_findings.status}`);
      console.log(`  Formation:   ${result.sos_findings.formation_date || 'Not found'}`);
      if (result.sos_findings.registered_agent) {
        console.log(`  Agent:       ${result.sos_findings.registered_agent}`);
      }
    }

    if (result.claimed_history?.max_claimed_years > 0) {
      console.log('\n--- CLAIMED HISTORY ---');
      console.log(`  Max Claimed: ${result.claimed_history.max_claimed_years} years`);
      if (result.claimed_history.claims?.bbb) {
        console.log(`  BBB:         ${result.claimed_history.claims.bbb.years_in_business} years`);
      }
    }

    if (result.discrepancy_analysis) {
      console.log('\n--- DISCREPANCY ANALYSIS ---');
      const severity = result.discrepancy_analysis.discrepancy_severity;
      const severityColor = severity === 'none' ? '\x1b[32m' :
                           severity === 'minor' ? '\x1b[33m' : '\x1b[31m';
      console.log(`  Severity:    ${severityColor}${severity.toUpperCase()}\x1b[0m`);
      console.log(`  Match:       ${result.discrepancy_analysis.claims_match_sos ? 'Yes' : 'No'}`);
      if (result.discrepancy_analysis.explanation) {
        console.log(`  Details:     ${result.discrepancy_analysis.explanation}`);
      }
    }

    if (result.reasoning) {
      console.log('\n--- REASONING ---');
      console.log(`  ${result.reasoning}`);
    }

    console.log(`\n--- METADATA ---`);
    console.log(`  API Cost:    $${(result.total_cost || 0).toFixed(4)}`);

  } finally {
    await db.close();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

**Step 2: Make executable**

```bash
chmod +x bin/run_longevity.js
```

**Step 3: Test standalone**

Run: `node bin/run_longevity.js --name "Orange Elephant Roofing" --city "Fort Worth" --state "TX"`

Expected: Formatted longevity report

**Step 4: Commit**

```bash
git add bin/run_longevity.js
git commit -m "feat: add standalone longevity verification CLI"
```

---

## Task 7: Integration Test

**Files:**
- Test end-to-end flow

**Step 1: Run full audit with longevity**

```bash
cd /home/astre/command-center/src/greenlit/auditor
source venv/bin/activate && set -a && . ./.env && set +a

# Test with known contractor
node bin/run_audit.js --id 1524
```

**Step 2: Verify longevity data in raw_data**

```bash
psql contractors_dev -c "
SELECT source_name, fetch_status,
       structured_data->>'longevity_tier' as tier,
       structured_data->'verified_longevity'->>'years_verified' as years
FROM contractor_raw_data
WHERE contractor_id = 1524 AND source_name = 'longevity_verification';
"
```

Expected: Row with tier and years

**Step 3: Verify audit reasoning includes longevity**

Check audit output references longevity findings

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: verify longevity verification integration complete"
```

---

## Summary

| Task | Files | Purpose |
|------|-------|---------|
| 1 | `scrapers/texas_sos.py` | Scrape TX SOS for entity data |
| 2 | `scrapers/longevity_claims.py` | Collect claims from raw_data |
| 3 | `services/longevity_analyzer.js` | Orchestrate + Gemini analysis |
| 4 | `services/collection_service.js` | Integrate into pipeline |
| 5 | `services/audit_agent.js` | Add prompt guidance |
| 6 | `bin/run_longevity.js` | Standalone CLI |
| 7 | Integration test | Verify end-to-end |

**Total estimated API cost per contractor:** ~$0.005 (Gemini)
**Total new code:** ~600 lines
