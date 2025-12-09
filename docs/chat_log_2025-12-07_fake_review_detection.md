# Chat Log: Fake Review Detection System

**Date:** 2025-12-07

---

## What Was Accomplished

### 1. Orange Elephant Analysis (Known Fraud Case)
- Analyzed 3 locations: Fort Worth (listed), Dallas (local), Elmhurst IL (HQ)
- Found: BBB F rating + Google 4.3★ = mathematical impossibility without manipulation
- Detected self-reviews ("Orange Elephant" as reviewer name)
- Found storm chaser language ("knocked on door after hail")
- HQ review revealed: 6-month delays, "half-ass" work, fired workers

### 2. Architecture Decision
- **Claude vs Gemini debate** on code-based vs AI-only detection
- Claude scored 92/100, Gemini scored 82/100
- **Decision: AI-only approach** - keep it simple, no code-based layer
- Review analysis already wired up in `collection_service.js` (lines 938-1002)

### 3. Search Engine Testing for Yelp Data
| Engine | Status | Notes |
|--------|--------|-------|
| Google | Blocked | CAPTCHA on headless |
| Yelp Direct | Blocked | DataDome CAPTCHA |
| DuckDuckGo | Works | curl gets Yelp URLs |
| Bing | Works | curl gets Yelp URLs |
| Yahoo | Works | curl gets Yelp URLs |
| Brave | Works | curl gets Yelp URLs |
| Ecosia | Works | curl gets Yelp URLs |

**Plan:** Rotate through engines when rate limited

---

## Key Decisions

1. **AI-only** for fake review detection (no code-based penalties)
2. **20 reviews minimum** from HQ location for reliable analysis
3. **Flag discrepancy** if HQ has many reviews but local has few
4. **Skip Yelp scraping** until API available - use search engines to check existence only
5. **Rotate search engines** to avoid rate limits

---

## Technical Findings

### What Works
- `review_analyzer.js` calls DeepSeek for fake review analysis
- Runs automatically during collection phase
- Google Maps scraper extracts reviews
- All 5 alt search engines return Yelp business URLs

### What's Blocked
- Yelp direct scraping (DataDome CAPTCHA)
- Google search (CAPTCHA on automation)
- DuckDuckGo Playwright (CAPTCHA, but curl works)

### Rating Data Issue
- Search engines return Yelp URLs but NOT rating/review count in plain text
- User reports seeing stars visually - likely in structured data or images
- Need to investigate: JSON-LD, aria-labels, or image parsing

---

## Pending Tasks

1. **Increase review scraping** from 5-7 to 20 in `google_maps.py`
2. **Extract Yelp ratings** from search engine snippets (structured data?)
3. **Build search engine rotation** into Yelp checker
4. **Test on more contractors** to validate detection

---

## Key Files

| File | Purpose |
|------|---------|
| `services/review_analyzer.js` | DeepSeek AI analysis |
| `services/collection_service.js:938-1002` | Runs review analysis |
| `scrapers/google_maps.py` | Needs max_reviews=20 |
| `scrapers/yelp.py` | Blocked, needs API |
| `docs/FAKE_REVIEW_DETECTION_PLAN.md` | Simplified plan |

---

## Next Session

1. Fix Yelp rating extraction from search snippets
2. Increase Google Maps review limit
3. Test full pipeline on Orange Elephant
