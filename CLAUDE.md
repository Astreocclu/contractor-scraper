# Contractor Intelligence System

## Prompting Principles

**Always use positive framing** - say what TO do, specify what to preserve:
- "Keep all X in Y" instead of "Don't put X here"
- "Remove ONLY these items: X, Y, Z"
- "Preserve all structural elements exactly"

---

## Repo Scope: Contractor Auditing Only

- Keep all **imports** within this repo
- The `contractors/` Django app name is preserved for database compatibility

---

## MANDATORY STARTUP PROTOCOL (Every Session)

**Before doing ANY work, Claude MUST:**

1. Have Gemini read and summarize ALL documentation including recent work:
   ```bash
   gemini -p "Read and summarize ALL of these files in one comprehensive briefing:

   RECENT WORK (CRITICAL - read these first):
   - docs/plans/*.md (all recent implementation plans)
   - /home/reid/command-center/exports/*.md (session exports from last 48 hours)
   - SESSION-NOTES.md

   STATUS FILES:
   - TODO.md
   - STATUS.md
   - ERRORS.md

   REFERENCE DOCS:
   - docs/AGENTIC_QUICKREF.md
   - docs/AGENTIC_AUDIT_SPEC.md
   - docs/CODEBASE_DOCUMENTATION.md
   - docs/DATABASE_ANALYSIS.md
   - scrapers/README.md

   Provide:
   1. What was worked on in the last 48 hours (from plans/ and exports/)
   2. Current priorities
   3. System state
   4. Known bugs
   5. Architecture overview
   6. Any critical warnings"
   ```
2. Read and internalize Gemini's summary
3. Run `git status` to confirm branch state

This ensures Claude has full project context before making any changes.

---

## What This Is
Forensic contractor auditing. Playwright (with Puppeteer as backup) scrapes → DeepSeek analyzes → Trust Score.

## Isolation
- Port: 8002 | Database: PostgreSQL (contractors_dev) | Venv: `./venv`
- Always keep completely separate from Boss (8000) and Pools (8001)

---

## LLM Startup Checklist

**Read these files IN ORDER before doing any work:**

1. `TODO.md` — Current priorities (what to work on)
2. `STATUS.md` — System state (what's working/broken)
3. `ERRORS.md` — Known issues (avoid repeating mistakes)
4. `docs/AGENTIC_QUICKREF.md` — Audit system overview (how it works)
5. Run `git status` — Confirm branch and uncommitted changes

---

## Documentation Index

**CRITICAL: Check recent work FIRST before starting any session.**

### Recent Work (CHECK THESE FIRST)
| Location | Contents | How to Find |
|----------|----------|-------------|
| `docs/plans/` | Implementation plans | `ls -lt docs/plans/ | head -5` |
| `/home/reid/command-center/exports/` | Session exports (full conversation logs) | `ls -lt /home/reid/command-center/exports/ | head -5` |
| `SESSION-NOTES.md` | Running session log | Direct read |

**Naming convention:** `YYYY-MM-DD-description.md` — search by date for recent work.

### Status Files (Top Level)
| Need | File |
|------|------|
| Current priorities | `TODO.md` |
| System state | `STATUS.md` |
| Known bugs | `ERRORS.md` |
| Running session log | `SESSION-NOTES.md` |

### Reference Documentation (`docs/`)
| Need | File |
|------|------|
| **Audit quick reference** | `docs/AGENTIC_QUICKREF.md` |
| Audit full spec | `docs/AGENTIC_AUDIT_SPEC.md` |
| Codebase overview | `docs/CODEBASE_DOCUMENTATION.md` |
| Database stats | `docs/DATABASE_ANALYSIS.md` |
| Archived session logs | `docs/_archive/` |

### Finding Recent Changes
```bash
# Recent plans (last 48 hours of work)
ls -lt docs/plans/ | head -10

# Session exports (full conversation history)
ls -lt /home/reid/command-center/exports/ | head -10

# Find docs by date pattern
find docs/plans /home/reid/command-center/exports -name "*$(date +%Y-%m-%d)*" -o -name "*$(date -d yesterday +%Y-%m-%d)*"
```

---

## File Map

| Need | File |
|------|------|
| CLI entry | `bin/run_audit.js` |
| Batch runner | `bin/batch_audit_runner.js` |
| Data collection | `bin/batch_collect.js` |
| Scraping | `services/collection_service.js` |
| DeepSeek agent | `services/audit_agent.js` |
| Review analysis | `services/review_analyzer.js` |

---

## Pipeline Architecture

The system uses a single audit pipeline:

### Entry Points
- **Single audit:** `bin/run_audit.js --id 123`
- **Batch audit:** `bin/batch_audit_runner.js --limit 100`

### Flow
1. `run_audit.js` → `orchestrator.js` → `collection_service.js` → `audit_agent.js`
2. Collection gathers data from all sources (Google, BBB, Yelp, county liens, etc.)
3. Review analyzer pre-processes reviews for authenticity
4. Lien scraper pre-computes lien scores with direction analysis
5. Audit agent receives ALL data in prompt (no web access)
6. Agent returns JSON with score, risk level, reasoning

### Key Design Decisions
- **No score caps:** LLM receives pre-analyzed data, trust its judgment
- **Deterministic:** Uses `deepseek-chat` + `seed: 42` for reproducible results
- **Pre-computed summaries:** Lien scores and review analysis passed as summaries, not raw data
- **Zero variance:** Tested at 0-point variance across 5 runs with complex contractors

---



## Commands

**Note:** Always use `python3` commands over `python` commands.

```bash
source venv/bin/activate && set -a && . ./.env && set +a

node bin/run_audit.js --id 123
node bin/run_audit.js --name "Company" --city "Dallas" --state "TX"
node bin/batch_collect.js --id 123 --force
python3 manage.py runserver 8002
```

---

## Always Do These

### Terminology
- Always say `contractors` (the term `homescreen` is contaminated)
- Always say `pool` or `swimming pool` (the term `pool enclosure` means Florida screen rooms)
- **Sourcing** = Collecting data for EXISTING contractors (via `bin/batch_collect.js`) - Audit prep
- Always use DeepSeek + Playwright (with Puppeteer as backup) (Perplexity API is banned)
- Always use Playwright scraping (with Puppeteer as backup) (Google Places API caused $300 overcharge)

### Prompts
- Use positive framing (see Prompting Principles at top)
- Specify what to preserve: "Preserve all structural elements exactly"

### Scoring
- Always enforce score caps in code via `enforceScoreMultipliers()`
- Always parse structured data before sending to LLM

### Task Breakdown
- Always break work into phases (2-4 per project)
- Always break phases into tasks (3-5 per phase)
- Always break tasks into subtasks (2-3 per task)
- Each subtask should complete in one focused session

### Workflow
- Always read relevant docs before starting (see index above)
- Always analyze problems first, wait for confirmation before changes
- Always show `git status` before any git operations
- Always suggest commits, wait for approval before running

---

## Score Caps (Enforced in Code)

```
CRITICAL flag → max 15
SEVERE/HIGH  → max 35
MODERATE     → max 60
```

---

## Test Contractor
Orange Elephant Roofing (ID: 1524) - Known fraud, expect score ~15, CRITICAL

---

## GEMINI CLI DELEGATION

**Pattern:** Claude asks Gemini for advice/commands → Gemini returns text → Claude executes with its own tools.

Gemini is a **consultant**, not an executor. It has 5x context but limited tool access.

### USE GEMINI FOR (text-in, text-out):
- "What files should I look at for X?"
- "What command would do Y?"
- "Analyze this code structure and suggest approach"
- "Critique my plan - what breaks?"
- Reading/analyzing 3+ files at once

### CLAUDE ALWAYS EXECUTES:
- **Web research** - Claude's WebSearch/WebFetch (Gemini can't do web)
- **Playwright/browser tasks** - Claude runs the actual scraping
- **File operations** - Claude reads/writes/edits
- **Shell commands** - Claude executes what Gemini suggests
- **Code writing** - Claude does the implementation

### EXAMPLE FLOW:
```
Claude: "gemini -p 'What files handle the audit scoring in this project?'"
Gemini: "Check services/audit_agent.js, services/review_analyzer.js"
Claude: [Uses Read tool on those files, then implements changes]
```

---

## ITERATIVE BRAINSTORMING

For architecture decisions or complex problem-solving:

1. Claude drafts initial approach
2. Claude pipes to Gemini: `echo "[draft]" | gemini -p "Critique this. What breaks?"`
3. Claude reads critique, revises
4. Repeat until solid

Use this for THINKING through hard problems only - implement code separately with Claude's tools.
