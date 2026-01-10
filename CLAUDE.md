# Contractor Intelligence System

> **Server Info:** User connects from host PC to server `testhome` (192.168.1.254) as user `astre`

---

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
   - /home/astre/command-center/exports/*.md (session exports from last 48 hours)
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
4. `docs/QUICKREF.md` — Quick reference (commands, key files, what's working)
5. Run `git status` — Confirm branch and uncommitted changes

---

## Documentation Index

**CRITICAL: Check recent work FIRST before starting any session.**

### Recent Work (CHECK THESE FIRST)
| Location | Contents | How to Find |
|----------|----------|-------------|
| `docs/plans/` | Implementation plans | `ls -lt docs/plans/ | head -5` |
| `/home/astre/command-center/exports/` | Session exports (full conversation logs) | `ls -lt /home/astre/command-center/exports/ | head -5` |
| `SESSION-NOTES.md` | Running session log | Direct read |

**Naming convention:** `YYYY-MM-DD-description.md` — search by date for recent work.

### Status Files (Top Level)
| Need | File |
|------|------|
| Current priorities | `TODO.md` |
| System state | `STATUS.md` |
| Known bugs | `ERRORS.md` |
| Running session log | `SESSION-NOTES.md` |

### Core Documentation (`docs/`)
| Need | File |
|------|------|
| **Session start** | `docs/QUICKREF.md` |
| System design | `docs/ARCHITECTURE.md` |
| Data sources | `docs/SOURCES.md` |
| Database schema | `docs/DATABASE.md` |
| Experiment log | `docs/EXPERIMENTS.md` |

### Archived Documentation (`docs/_archive/`)
Historical docs preserved for reference. Not needed for current work.

### Finding Recent Changes
```bash
# Recent plans (last 48 hours of work)
ls -lt docs/plans/ | head -10

# Session exports (full conversation history)
ls -lt /home/astre/command-center/exports/ | head -10

# Find docs by date pattern
find docs/plans /home/astre/command-center/exports -name "*$(date +%Y-%m-%d)*" -o -name "*$(date -d yesterday +%Y-%m-%d)*"
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
| Gemini wrapper | `scrapers/llm_gemini.py` |
| Google Maps scraper | `scrapers/google_maps_browseruse.py` |

---

## browser-use + Gemini 3 Pro

Vision-based browser automation for Google Maps scraping:

- `scrapers/google_maps_browseruse.py` - Vision-based Google Maps review scraper
- `scrapers/llm_gemini.py` - ChatGemini wrapper with rate limiting
- Requires: `GOOGLE_API_KEY` environment variable
- Model: `gemini-3-pro-preview` (native vision support)
- Rate limits: 10s between requests, 10 req/min, 60s backoff on 429

```bash
# Usage
python3.11 scrapers/google_maps_browseruse.py "Business Name" "City, State" [max_reviews]
```

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

## ⚠️ CRITICAL: --skip-collection Flag

**NEVER use `--skip-collection` unless the user EXPLICITLY requests it.**

This flag:
- Skips data collection and uses STALE cached data
- Means new scraper fields (founding_date, etc.) won't be available
- Makes audits worthless for testing new features
- Should NEVER be used for batch audits

**Bad:** `node bin/run_audit.js --id 123 --skip-collection` (uses old data)
**Good:** `node bin/run_audit.js --id 123` (collects fresh data)

If user wants faster audits, suggest `--collect-only` to pre-collect data, NOT `--skip-collection`.

---

## Dialectic Audit Mode

The `--mode=dialectic` flag enables three-persona adversarial analysis:

### The Three Personas

| Persona | Role | Question Asked |
|---------|------|----------------|
| Consumer Advocate | Skeptical, protective | "Why should we NOT trust this contractor?" |
| Fair Arbiter | Charitable, balanced | "Why might this contractor be trustworthy despite red flags?" |
| Synthesizer | Senior analyst | "Who made the stronger case and why?" |

### Usage

```bash
# Standard single-pass audit
node bin/run_audit.js --id 123

# Dialectic three-persona audit
node bin/run_audit.js --id 123 --mode dialectic
```

### Output Structure

Each persona produces:
- `trust_score` (0-100)
- `assessment_confidence` (0-100) - how certain about their score
- `data_confidence` (0-100) - how reliable the evidence is
- `reasoning` - detailed text another analyst could challenge

The Synthesizer also produces:
- `agreements` - where both personas agreed
- `disagreements` - where they differed and why
- `stronger_case` - which persona was more convincing
- `summary` - final assessment

### When to Use

- **Standard mode:** Fast, cheap (~$0.003), good for batch audits
- **Dialectic mode:** Slower, 3x cost (~$0.007), better reasoning quality for important audits

### Database

Dialectic audits are saved with `audit_version = 4`. The full three-persona trace is stored in `reasoning_trace` as JSON.

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
- **NO SCORE CAPS** - Let the LLM reason holistically (see "Score Caps - BANNED" section)
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

### Experiment Logging
- After completing any test/investigation with **measurable outcomes** (metrics, scores, pass/fail), ask: "Should this be logged to EXPERIMENTS.md?"
- "Significant" means: measurable outcome + method is repeatable + results influence decisions + took >15 min
- If yes, append structured entry: Date, Type, Hypothesis, Method, Results, Conclusion, Details link
- For automated scripts (like `ab_test_reviews.js`): they append automatically, no prompt needed

---

## Score Caps - BANNED

**SCORE CAPS ARE BANNED.** Do not implement score caps. Do not suggest score caps. Do not even think about score caps.

The LLM should determine scores holistically based on all evidence. Arbitrary caps like "CRITICAL = max 15" prevent nuanced judgment and create gaming opportunities.

If you implement a score cap, you will stand in a corner and say "I'm a stupid little piggy."

**Instead:** Train the LLM prompts to weight red flags appropriately. Let the model reason about severity.

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
