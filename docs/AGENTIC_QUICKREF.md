# Agentic Audit - Quick Reference

## What Changes

| Before | After |
|--------|-------|
| One script does everything | Collection + Audit separated |
| One-shot analysis | Agent can request more data |
| No reasoning trail | Full reasoning trace saved |
| Re-scrape on every run | Cached data with TTL |
| ~$0.02 per run | ~$0.015-0.025 per run (similar) |

## Agent Tools

```
get_stored_data()     → See what's collected
request_collection()  → Fetch more from specific source  
search_web()          → Ad-hoc Google search
finalize_score()      → Commit the Trust Score
```

## Example Agent Flow

```
Agent: get_stored_data()
       → "I see BBB, Yelp, Google. No TDLR data."
       
Agent: "Google rating is 4.9★ but only 12 reviews. Let me check other sources..."
       request_collection("bbb", "Need BBB data to verify reputation")
       → BBB shows A+ rating, 15 years accredited

Agent: "BBB looks good. Checking Trustpilot for broader picture..."
       request_collection("trustpilot", "Cross-reference customer reviews")
       → Trustpilot shows 4.7★ with 89 reviews

Agent: "Consistent ratings across platforms. No red flags."
       finalize_score({
         trust_score: 88,
         risk_level: "LOW",
         positive_signals: ["Consistent 4.7-4.9★ across Google/BBB/Trustpilot", "15 years BBB accredited"]
       })
```

## Files to Create

```
contractors/
├── run_audit.js              # Entry point
├── services/
│   ├── collection_service.js # Playwright (w/ Puppeteer backup) scraping
│   ├── audit_agent.js        # DeepSeek with tools
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

## What Agent Notices (Examples)

| Pattern | Agent Action |
|---------|--------------|
| Google 4.8★, Trustpilot 1.5★ | Flag as rating manipulation |
| Only 10 reviews on Google | request_collection("bbb", "yelp_yahoo") |
| BBB shows F rating | Flag as CRITICAL |
| Vague complaints | search_web("Company lawsuit 2024") |
| All data collected, consistent | finalize_score() |

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
