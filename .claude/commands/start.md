# /start - Begin Auditor Session

Load context and provide a session briefing.

## Process

### 1. Get Current Date
```bash
date +%Y-%m-%d
```
Store as TODAY for file references.

### 2. Load Current State
Read `state/current.md` for:
- Active priorities
- Open threads
- Recent context
- Any blockers

### 3. Check Today's Session
If `sessions/{TODAY}.md` exists, we're resuming. Show last few entries.
If not, this is a fresh session.

### 4. Check System Health
Use MCP tool: `health_check()`
Report any issues.

### 5. Provide Briefing

Output format:
```
Good [morning/afternoon]! It's [Day], [Date].

**Auditor Status:**
- [Active/Idle] - [brief status]

**Today's Priorities:**
1. [Priority from state/current.md]
2. [Priority 2]
3. [Priority 3]

**Open Threads:**
- [Any unfinished work]

**System Health:** [OK/Issues]

What would you like to work on?
```

### 6. Create Session Entry
If this is the first session today, create `sessions/{TODAY}.md`:
```markdown
# Auditor Session: {TODAY}

## Session Started: {TIME}
```

If resuming, append:
```markdown
## Session Resumed: {TIME}
```
