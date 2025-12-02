# Contractor Scraper

## What This Is
Standalone contractor database. Scrapes from Google, enriches with BBB/Yelp, calculates trust scores.

## STANDALONE PROJECT
- Database: contractor_db (SQLite fallback: db.sqlite3)
- Port: 8002
- Venv: ./venv
- NO imports from Boss or Pools

## Commands
```bash
source venv/bin/activate
python manage.py runserver 8002
python manage.py scrape_contractors
python manage.py enrich_contractors
python manage.py audit_contractors
```

## Trust Score
- 80+ = Passes
- <80 = Does Not Pass

## Related Projects (NO CODE SHARING)
- Boss Visualizer: /home/reid/testhome/boss-security-visualizer/ (port 8000)
- Pool Visualizer: /home/reid/testhome/pool-visualizer/ (port 8001)

These projects are completely separate. Do NOT import code between them.

## Working Style
- When I share a problem, analyze it first and wait for my reply before making changes
- Break large tasks into 3-5 subtasks and confirm the plan before starting
- Ask clarifying questions if requirements are ambiguous
- One feature at a time, fully complete before moving on

## Git Workflow
- Run `git status` and show me the output before any git operations
- Suggest commits but wait for my approval before running them
- Tell me when to commit, don't do it automatically
