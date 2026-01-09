# Contractor Auditor - System Architecture

**Updated:** 2026-01-09

---

## Overview

Forensic contractor auditing system that collects data from 30+ sources, analyzes with DeepSeek LLM, and produces Trust Scores (0-100).

---

## Pipeline Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    AUDIT PIPELINE                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. ENTRY POINT                                              │
│     └─ bin/run_audit.js --id 123 [--mode dialectic]         │
│                                                              │
│  2. ORCHESTRATOR (services/orchestrator.js)                  │
│     ├─ Find/create contractor in PostgreSQL                  │
│     ├─ Check for cached data (TTL-based)                    │
│     └─ Dispatch to collection or audit                      │
│                                                              │
│  3. COLLECTION (services/collection_service.js)              │
│     ├─ Tier 1: Reviews (Google, BBB, Yelp, Trustpilot)      │
│     ├─ Tier 2: News (Google News, local)                    │
│     ├─ Tier 3: Social (Reddit, YouTube)                     │
│     ├─ Tier 4: Employee (Indeed, Glassdoor)                 │
│     ├─ Tier 5: Government (OSHA, EPA)                       │
│     ├─ Tier 6: Texas (Franchise Tax)                        │
│     ├─ Tier 7: Courts (County liens)                        │
│     └─ Tier 8: Industry (Porch, BuildZoom, HomeAdvisor)     │
│                                                              │
│  4. REVIEW ANALYSIS (services/review_analyzer.js)            │
│     ├─ Strategic sampling: 10 five-star, 10 one-two, 5 mid  │
│     ├─ Fake review detection                                │
│     └─ Complaint pattern extraction                         │
│                                                              │
│  5. AUDIT AGENT (services/audit_agent.js)                    │
│     ├─ Standard: Single DeepSeek pass                       │
│     └─ Dialectic: 3-persona adversarial (see below)         │
│                                                              │
│  6. DATABASE (PostgreSQL contractors_dev)                    │
│     ├─ contractor_raw_data: Cached scraper results          │
│     ├─ audit_records: Audit results (V4 = dialectic)        │
│     └─ contractors_contractor: Master data                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Audit Modes

### Standard Mode (default)

Single DeepSeek pass analyzing all collected data.

```bash
node bin/run_audit.js --id 123
```

- Cost: ~$0.003 per audit
- Speed: ~30 seconds
- Use for: Batch audits, initial screening

### Dialectic Mode (3-persona)

Three sequential DeepSeek passes with adversarial reasoning.

```bash
node bin/run_audit.js --id 123 --mode dialectic
```

| Persona | Role | Question |
|---------|------|----------|
| Consumer Advocate | Skeptical | "Why should we NOT trust this contractor?" |
| Fair Arbiter | Charitable | "Why might they be trustworthy despite flags?" |
| Synthesizer | Senior analyst | "Who made the stronger case and why?" |

- Cost: ~$0.009 per audit (3x standard)
- Speed: ~90 seconds
- Use for: Important audits, borderline cases
- Database: `audit_version = 4`, full trace in `reasoning_trace`

**Output structure:**
```javascript
{
  advocate: { trust_score, assessment_confidence, data_confidence, reasoning },
  arbiter: { trust_score, assessment_confidence, data_confidence, reasoning },
  synthesizer: {
    final_trust_score,
    agreements,
    disagreements,
    stronger_case,
    summary
  }
}
```

---

## Deep Investigation Framework (Planned)

Iterative investigation loop between collection and audit:

1. Rule-based checks identify fraud patterns (virtual addresses, timeline fabrication)
2. LLM cascade (DeepSeek → Gemini → Claude) generates follow-up queries
3. Serper API executes searches
4. Loop until max_iterations or no new queries
5. Enriched data passes to DialecticAuditAgent

**Status:** Planned, not yet implemented. See `docs/plans/2026-01-09-deep-investigation-framework.md`

---

## Review Strategic Sampling

To balance cost and fraud detection, review_analyzer.js samples:

| Category | Count | Rationale |
|----------|-------|-----------|
| Five-star reviews | 10 | Catch fake positive patterns |
| One-two star reviews | 10 | Surface real complaints |
| Mid-star reviews (3-4) | 5 | Balanced perspective |

This replaced the previous approach of truncating at 3000 chars (which missed fraud signals).

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| PostgreSQL over SQLite | Production scalability, concurrent access |
| DeepSeek over GPT-4 | Cost ($0.001/1K tokens vs $0.03), seed=42 for determinism |
| Playwright over APIs | Google Places API caused $300 overcharge |
| Pre-computed lien scores | 110KB raw data too large for LLM context |
| No score caps in dialectic | Trust LLM judgment with pre-analyzed data |
| temperature: 0 | Zero variance (was 29-point variance at 0.1) |

---

## Files by Function

| Function | File |
|----------|------|
| CLI entry | `bin/run_audit.js` |
| Batch orchestration | `bin/batch_audit_runner.js` |
| Collection only | `bin/batch_collect.js` |
| Core orchestration | `services/orchestrator.js` |
| Data collection | `services/collection_service.js` |
| Audit agents | `services/audit_agent.js` |
| Review analysis | `services/review_analyzer.js` |
| External APIs | `services/api_sources.js` |
| Score constraints | `services/scoring_constraints.js` |
| Database | `services/db_pg.js` |
| Python scrapers | `scrapers/*.py` |
| County liens | `scrapers/county_liens/*.py` |
