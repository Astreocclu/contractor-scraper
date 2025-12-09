# Contractor Scraper - Complete Codebase Documentation

## Overview

**Purpose:** Autonomous contractor discovery, validation, and trust scoring system for the Dallas-Fort Worth (DFW) region.

**Tech Stack:** Django REST Framework (Python) + Node.js scripting
**Database:** SQLite (development) / PostgreSQL (production-ready)
**Port:** 8002
**Status:** Functional - 1,523 contractors scraped, scoring pipeline working

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CONTRACTOR SCRAPER                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. SCRAPING LAYER (Google Maps via Playwright w/ Puppeteer backup) │
│     └─ google_scraper.py → 1,523 leads from DFW Metroplex   │
│                                                               │
│  2. ENRICHMENT LAYER (Yelp + BBB)                            │
│     ├─ yelp_service.py (needs API key)                      │
│     └─ enrichment.py (BBB scraping blocked)                 │
│                                                               │
│  3. AI AUDIT LAYER (DeepSeek Analysis)                       │
│     └─ ai_auditor.py → Sentiment, fake reviews, red flags   │
│                                                               │
│  4. SCORING LAYER (Trust Score Calculation)                  │
│     └─ scoring.py → 52-point system (normalized 0-100)      │
│                                                               │
│  5. API LAYER (Django REST)                                  │
│     ├─ GET /api/verticals/                                  │
│     ├─ GET /api/contractors/                                │
│     ├─ GET /api/contractors/{slug}/                         │
│     └─ GET /api/contractors/stats/                          │
│                                                               │
│  6. ADMIN INTERFACE                                          │
│     └─ Django admin at /admin/                              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
/home/reid/testhome/contractors/
├── manage.py                    # Django CLI entry point
├── db.sqlite3                   # SQLite database (1.1 MB)
├── .env                         # Environment variables & API keys
├── package.json                 # Node.js dependencies
│
├── config/                      # Django project settings
│   ├── settings.py              # Main configuration
│   ├── urls.py                  # Root URL routing
│   ├── wsgi.py                  # Production WSGI
│   └── asgi.py                  # Async ASGI
│
├── contractors/                 # Main Django application
│   ├── models.py                # Database models
│   ├── views.py                 # REST API viewsets
│   ├── serializers.py           # API serializers
│   ├── urls.py                  # API routes
│   ├── admin.py                 # Admin panel config
│   │
│   ├── management/commands/     # CLI commands
│   │   ├── scrape_contractors.py
│   │   ├── enrich_contractors.py
│   │   ├── audit_contractors.py
│   │   ├── scrape_emails.py
│   │   └── dedupe_contractors.py
│   │
│   └── services/                # Business logic
│       ├── google_scraper.py    # Google Maps (Playwright w/ Puppeteer backup, NOT API)
│       ├── enrichment.py        # BBB scraper
│       ├── yelp_service.py      # Yelp Fusion API
│       ├── ai_auditor.py        # DeepSeek AI analyzer
│       ├── scoring.py           # Trust score calculator
│       └── deduplication.py     # Duplicate detection
│
├── node_modules/                # Node.js packages
├── venv/                        # Python virtual environment
└── logs/                        # Log files
```

---

## Data Models

### Vertical (Business Categories)
```python
- name: str              # "Pool Enclosures", "Patio Covers", etc.
- slug: str              # URL-friendly identifier
- description: TextField
- search_terms: JSON     # ["pool enclosure", "sun room", ...]
- avg_job_value: int     # Average job price ($10K-$50K)
- is_active: bool
```

### Contractor (Main Records)
```python
# Core Info
- business_name: str
- slug: str (unique, auto-generated)
- verticals: ManyToMany[Vertical]

# Contact
- address, city, state, zip_code
- phone, email, website

# Google Data (97.4% populated)
- google_place_id: str (unique)
- google_rating: Decimal (0-5)
- google_review_count: int
- google_reviews_json: JSON

# Yelp Data (0% - needs API key)
- yelp_id, yelp_url, yelp_rating, yelp_review_count

# BBB Data (0% - scraping blocked)
- bbb_rating: str (A+/A/B/etc)
- bbb_accredited: bool
- bbb_complaint_count, bbb_years_in_business

# Trust Scores
- trust_score: int (0-100)
- passes_threshold: bool (50+)
- tier: choice (gold/silver/bronze/unranked)
- verification_score, reputation_score
- credibility_score, red_flag_score

# AI Analysis
- ai_summary: TextField
- ai_sentiment_score: int (0-100)
- ai_red_flags: JSON
```

### ContractorAudit (Audit Records)
```python
- contractor: ForeignKey
- audit_date: datetime
- trust_score: int
- risk_level: choice (CRITICAL/SEVERE/MODERATE/LOW/TRUSTED)
- recommendation: choice (AVOID/CAUTION/VERIFY/RECOMMENDED)
- synthesis_data: JSON (full DeepSeek response)
- narrative_summary: TextField
```

### RedFlag (Issues Found)
```python
- audit: ForeignKey[ContractorAudit]
- severity: choice (CRITICAL/SEVERE/MODERATE/MINOR)
- category: str
- description, evidence, source
```

---

## Data Pipeline Flow

### Phase 1: Scraping
```
manage.py scrape_contractors
    ↓
google_scraper.py
    - Searches 40+ DFW metro cities
    - Uses Playwright scraping (with Puppeteer as backup) (Google Places API is BANNED)
    - Rate limiting: 2s between searches
    - Fetches place details (phone, website)
    ↓
[Save to Contractor model]
Result: 1,523 contractors with Google data
```

### Phase 2: Enrichment
```
manage.py enrich_contractors
    ↓
├─ yelp_service.py (Yelp Fusion API)
│   - Business search by name/city
│   - 60% name match threshold
│   - Returns: rating, review_count, url
│   STATUS: Not configured (needs YELP_API_KEY)
│
└─ enrichment.py (BBB scraping)
    - HTML scraping at bbb.org
    - Returns: rating, accredited, years, complaints
    STATUS: Blocked by Cloudflare
```

### Phase 3: AI Audit & Scoring
```
manage.py audit_contractors
    ↓
├─ ai_auditor.py (DeepSeek API)
│   Input: google_reviews_json
│   Analysis:
│     - Sentiment score (0-100)
│     - Fake review detection
│     - Red flag identification
│     - Common complaints/praises
│   Output: AuditResult
│
└─ scoring.py (TrustScoreCalculator)
    52-point system → normalized to 0-100

    VERIFICATION (12 pts max):
      - Has address: 3 pts
      - Has phone: 2 pts
      - Has website: 2 pts (+ 1 if HTTPS)
      - BBB accredited: 4 pts

    REPUTATION (20 pts max):
      - Google rating (≥4.8: 5 pts, ≥4.5: 4 pts)
      - Google review count (≥100: 3 pts)
      - Yelp rating (weighted higher)
      - AI sentiment bonus (≥85: 4 pts)

    CREDIBILITY (12 pts max):
      - Website: 2 pts
      - Professional email: 1 pt
      - Business years: 1-3 pts
      - SSL cert: 1 pt

    RED FLAGS (8 pts max):
      - Deductions for complaints, issues

    TIERS:
      - Gold: 80+
      - Silver: 65-79
      - Bronze: 50-64 (passing)
      - Unranked: <50
```

---

## REST API Endpoints

**Base URL:** `http://localhost:8002/api/`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/verticals/` | GET | List all business categories |
| `/api/contractors/` | GET | List passing contractors (default) |
| `/api/contractors/?all=true` | GET | List all contractors |
| `/api/contractors/?vertical=SLUG` | GET | Filter by category |
| `/api/contractors/?city=CITY` | GET | Filter by city |
| `/api/contractors/{slug}/` | GET | Full contractor details |
| `/api/contractors/stats/` | GET | Aggregate statistics |
| `/api/contractors/top/` | GET | Top 10 contractors |

**Admin Interface:** `http://localhost:8002/admin/`

---

## Management Commands

```bash
# Activate virtual environment
source venv/bin/activate

# Scrape contractors from Google Maps (via Playwright w/ Puppeteer backup)
python manage.py scrape_contractors [--vertical SLUG] [--city CITY] [--limit N]

# Enrich with BBB/Yelp data
python manage.py enrich_contractors [--limit N] [--yelp-only] [--bbb-only]

# Run AI audits and calculate scores
python manage.py audit_contractors [--limit N] [--skip-ai]

# Extract emails from websites
python manage.py scrape_emails [--limit N]

# Detect and handle duplicates
python manage.py dedupe_contractors [--dry-run]
```

---

## Environment Variables (.env)

```ini
# Database
DATABASE_URL=sqlite:///db.sqlite3

# API Keys
DEEPSEEK_API_KEY=sk-xxxxx          # Working (5M free tokens/month)
YELP_API_KEY=                       # EMPTY - needs setup
SERPAPI_KEY=                        # EMPTY - optional
GOOGLE_PLACES_API_KEY=              # BANNED - DO NOT USE (caused $300 overcharge)

# Django
SECRET_KEY=dev-secret-key-change-in-production
DEBUG=True
```

---

## Current Database Status

### Summary
| Metric | Value |
|--------|-------|
| Total Contractors | 1,523 |
| Passing (50+) | 0 (0%) |
| Average Score | 12.3 |
| Top Score | 48 |

### Data Coverage
| Field | Coverage |
|-------|----------|
| Google Place ID | 100% |
| Google Rating | 97.4% |
| Phone Number | 99.3% |
| Website | 91.7% |
| Yelp Data | 0% |
| BBB Data | 0% |

### Geographic Distribution (Top 5)
1. Dallas: 77 (5.1%)
2. Fort Worth: 71 (4.7%)
3. Arlington: 57 (3.7%)
4. Plano: 54 (3.5%)
5. Frisco: 50 (3.3%)

### Verticals
- Patio Covers: 856 (56.2%)
- Pool Enclosures: 519 (34.1%)
- Motorized Shades: 390 (25.6%)

---

## Key Services Explained

### google_scraper.py
The primary data source. Uses Playwright (with Puppeteer as backup) to scrape Google Maps for contractors in 40+ DFW cities using configured search terms per vertical. **Note:** Google Places API is BANNED (caused $300 overcharge).

**Key methods:**
- `search(query, city)` - Text search for businesses
- `get_place_details(place_id)` - Get phone, website
- `fetch_reviews(place_id)` - Get up to 5 reviews

### yelp_service.py
Yelp Fusion API integration for additional ratings and reviews.

**Key methods:**
- `search_business(name, city)` - Find business on Yelp
- `get_reviews(business_id)` - Fetch reviews

**Status:** Not configured - needs `YELP_API_KEY`

### ai_auditor.py
DeepSeek AI integration for review analysis and red flag detection.

**Analyzes:**
- Sentiment (0-100)
- Fake review patterns
- Red flags (safety, licensing, threats)
- Source conflicts (Google vs Yelp)

### scoring.py
Trust score calculator using a 52-point weighted system.

**Categories:**
- Verification (12 pts)
- Reputation (20 pts)
- Credibility (12 pts)
- Red Flags (8 pts)

---

## Why Scores Are Low

The scoring system works correctly, but data is incomplete:

**Missing Data Impact:**
- No Yelp data: -3 to -6 points
- No BBB accreditation: -6 to -9 points
- Limited reviews: -2 to -3 points

**To reach Gold tier (80+), a contractor needs:**
- BBB accredited (+4-6 pts)
- 5+ years in business (+3 pts)
- Google 4.5+ rating (+4 pts)
- 100+ reviews (+3 pts)
- Yelp 4.0+ rating (+3 pts)
- Good sentiment (+4 pts)
- Website & Phone (+3 pts)

**Fix:** Add `YELP_API_KEY` to `.env` and run enrichment.

---

## Node.js Tools

### scrape_emails_deepseek.js
Extracts emails from contractor websites using Playwright (with Puppeteer as backup) for rendering and DeepSeek for intelligent extraction.

```bash
node scrape_emails_deepseek.js [--limit N]
```

**Process:**
1. Query contractors without emails
2. Visit homepage + /contact, /about pages
3. Wait for JavaScript rendering
4. Send HTML to DeepSeek for extraction
5. Save best email to database

---

## Running the Project

```bash
# Navigate to project
cd /home/reid/testhome/contractors

# Activate Python environment
source venv/bin/activate

# Start Django server
python manage.py runserver 8002

# Access:
# - API: http://localhost:8002/api/
# - Admin: http://localhost:8002/admin/
```

---

## Project Independence

This is a **standalone project** with no code sharing:

```
Projects (separate):
├─ contractors (port 8002) ← This project
├─ boss-security-visualizer (port 8000)
└─ pool-enclosure-visualizer (port 8001)
```

Each has its own database, virtual environment, and API.

---

## Next Steps to Improve

1. **Add Yelp API Key** - Set `YELP_API_KEY` in `.env`
2. **Fix BBB Enrichment** - Consider SerpAPI ($50/month) or proxy rotation
3. **Run Full Enrichment** - `python manage.py enrich_contractors`
4. **Re-audit All** - `python manage.py audit_contractors`

This should push many contractors above the 50-point passing threshold.
