# County Liens Scraper

Playwright-based scrapers for extracting mechanic's liens, tax liens, and abstracts of judgment from Texas DFW county public record portals.

## Supported Counties

| County | Portal | Status |
|--------|--------|--------|
| Tarrant | countyclerk.tarrantcounty.com | Ready for testing |
| Dallas | dallascounty.org | Ready for testing |
| Collin | apps.collincountytx.gov | Ready for testing |
| Denton | apps.dentoncounty.gov | Ready for testing |

## Document Types Captured

| Code | Meaning | Severity |
|------|---------|----------|
| MECH_LIEN | Mechanic's Lien | HIGH - Stiffed subcontractor/supplier |
| REL_LIEN | Release of Lien | CONTEXT - Lien resolved |
| ABS_JUDG | Abstract of Judgment | CRITICAL - Lost lawsuit |
| FED_TAX_LIEN | Federal Tax Lien | CRITICAL - IRS pursuing |
| STATE_TAX_LIEN | State Tax Lien | HIGH - TX Comptroller pursuing |

## Usage

### Python CLI
```bash
# Search single contractor
python -m scrapers.county_liens.orchestrator --name "ABC Contractors LLC"

# Include owner name search
python -m scrapers.county_liens.orchestrator --name "ABC Contractors LLC" --owner "John Smith"
```

### Node.js Integration
The lien scraper is integrated into `collection_service.js`:
```javascript
const results = await scrapeCountyLiensPython(businessName, ownerName);
```

### Test Script
```bash
node tests/test_lien_scrapers.js "Company Name"
```

## Scoring Integration

Lien data affects the Trust Score via `audit_agent_v2.js`:

| Condition | Score Impact |
|-----------|--------------|
| 3+ active mechanic's liens | CRITICAL (max 15) |
| Federal tax lien > $50k | CRITICAL (max 15) |
| Abstract of judgment > $50k | CRITICAL (max 15) |
| 1-2 active mechanic's liens | SEVERE (max 35) |
| State tax lien | SEVERE (max 35) |
| Resolved liens (slow >90 days) | -2 points |
| Resolved liens (quick) | Minimal impact |

## Files

```
scrapers/county_liens/
├── __init__.py         # Package exports
├── base.py             # Abstract base class
├── entity_resolver.py  # Name matching (fuzzywuzzy)
├── orchestrator.py     # Multi-county coordination
├── tarrant.py          # Tarrant County scraper
├── dallas.py           # Dallas County scraper
├── collin.py           # Collin County scraper
└── denton.py           # Denton County scraper
```

## Database Model

`CountyLienRecord` in `contractors/models.py`:
- Links to `Contractor` via `matched_contractor`
- Tracks `has_release` for lien resolution
- Stores `raw_data` JSON for debugging

## Notes

- **Rate limiting**: 1 request/second per county
- **Timeout**: 5 minutes for full 4-county scrape
- **Selectors**: May need adjustment after live browser testing
- **Entity matching**: Uses fuzzywuzzy with 85% threshold
