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
       
Agent: "Contractor claims licensed. Let me check..."
       request_collection("tdlr", "Claims to be licensed but no data")
       → TDLR scraped, shows ACTIVE license
       
Agent: "License verified. But claims 500 projects..."
       request_collection("permits", "Need permit history to verify volume claim")
       → Permit data fetched
       
Agent: "Only 47 permits in 3 years. Claims don't match."
       finalize_score({
         trust_score: 62,
         risk_level: "MODERATE", 
         red_flags: [{severity: "MEDIUM", description: "Claims don't match permit history"}]
       })
```

## Files to Create

```
contractors/
├── run_audit.js              # Entry point
├── services/
│   ├── collection_service.js # Puppeteer scraping
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
| Claims 15yr, BBB shows 2022 formation | request_collection("permits") |
| Google 4.8★, Yelp 2.1★ | Flag as manipulation |
| No license data | request_collection("tdlr") |
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
