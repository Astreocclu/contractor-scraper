# /begin

1. `TZ="America/Chicago" date +%Y-%m-%d` → TODAY, `+%H:%M` → TIME
2. Skim `state/local-index.md` — workspace file map (unlocks cross-workspace searches)
3. Read `state/current.md`
4. Read `state/carry-forward.md`
5. Read `state/profile.md` if exists
6. Read `state/handoffs.md` — include pending items in briefing
7. If `sessions/{TODAY}.md` missing → create: `# Session: {TODAY}\n## Started: {TIME} CT`

## Critical Reminders (from severity 4-5 lessons)

- NEVER use Google Places API — caused $300 charge
- NEVER call api.anthropic.com directly — use Task tool ($48+$200 burned in past)
- Liens filed BY contractor (GRANTEE) are NOT red flags — only liens AGAINST (GRANTOR)
- Verify data CONTENT, not just HTTP 200 status. "page not found" with 200 OK is NOT success.
- When user says data is broken, PROVE it works with actual data before saying it's fine.
- After wiring ANY data source, verify output contains actual data you need, not just metadata.
- Every new or modified `.md` file MUST start with `<system_meta>` XML block at line 1. Use `[TAG]` inline content tags. Files without metadata are invisible to the index. See CLAUDE.md XML Metadata section.

## My Place

Upstream: Contractors in database, external data sources (BBB, Google, licenses)
My Job: Forensic vetting, Trust Score generation (0-100)
Downstream: Database → Outbound, Website

8. Brief: date, active audits, critical reminders, carry-forward, pending handoffs, "What to audit?"
