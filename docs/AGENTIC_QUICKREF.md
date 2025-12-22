# Agentic Audit - Quick Reference

## What Changes

| Before | After |
|--------|-------|
| One script does everything | Collection + Audit separated |
| One-shot analysis | Agent can request more data |
| No reasoning trail | Full reasoning trace saved |
| Re-scrape on every run | Cached data with TTL |
| ~$0.02 per run | ~$0.015-0.025 per run (similar) |

## Agent Design

The agent is a **pure analysis engine**:
- Receives ALL data upfront in prompt
- NO tools (no web access, no additional collection)
- Returns structured JSON directly
- Uses `deepseek-chat` + `seed: 42` for determinism

Pre-computed inputs:
- Review analysis (fake detection, discrepancy check)
- Lien scores (direction-aware: BY vs AGAINST)
- Platform ratings (Google, BBB, Yelp, Trustpilot, etc.)

## Agent Flow

1. Orchestrator runs collection_service.js
   → Scrapes all sources (Google, BBB, Yelp, liens, etc.)
   → Runs review_analyzer.js (fake detection)
   → Computes lien scores with direction

2. Orchestrator calls audit_agent.js
   → Agent receives: contractor info + all collected data
   → Agent analyzes and returns JSON

3. Result saved to audit_records
   → trust_score, risk_level, recommendation, reasoning

## Files to Create

```
contractors/
├── run_audit.js              # Entry point
├── services/
│   ├── collection_service.js # Playwright (w/ Puppeteer backup) scraping
│   ├── audit_agent.js        # DeepSeek (pure analysis, no tools)
│   └── orchestrator.js       # Coordinates loop
└── schema.sql                # New DB tables
```

## Commands

```bash
# Run schema migration
sqlite3 db.sqlite3 < schema.sql

# Test audit
node run_audit.js --name "Orange Elephant" --city "Dallas" --state "TX"
```

## What Agent Analyzes (Examples)

| Pattern | Analysis Result |
|---------|-----------------|
| Google 4.8★, Trustpilot 1.5★ | Flag as rating manipulation |
| Only 10 reviews on Google | Note: Limited sample size, low confidence |
| BBB shows F rating | Flag as CRITICAL (high risk) |
| Vague/identical complaints | Flag as potentially fake reviews |
| Consistent ratings + no liens | Assign high trust score |

## Cost Controls

- Max 3 collection rounds
- Cached data (7 day TTL for stable sources)
- Max 10 agent iterations
- Cost tracked per audit

## Hand to Claude Code

Give Claude Code:
1. `AGENTIC_AUDIT_SPEC.md` (full spec)
2. `schema.sql` (database)
3. `forensic_audit_puppeteer.js` (existing code to refactor)

Say: "Implement this. Start with schema, then collection_service, then audit_agent."
