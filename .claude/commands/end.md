# /end - End Auditor Session

Summarize session, update state, and save context.

## Process

### 1. Get Current Date/Time
```bash
date +%Y-%m-%d
date +%H:%M
```

### 2. Summarize Session
Review the conversation and extract:
- **Completed:** What was finished
- **In Progress:** What's partially done
- **Decisions:** Any decisions made
- **Blockers:** What's stuck
- **Next Actions:** What should happen next

### 3. Update Session Log
Append to `sessions/{TODAY}.md`:
```markdown
## Session Ended: {TIME}

### Completed
- [Task 1]
- [Task 2]

### In Progress
- [Partial work]

### Decisions
- [Decision made]

### Next Actions
- [What to do next]

---
```

### 4. Update State File
Update `state/current.md` with:
- New priorities (if changed)
- Updated open threads
- Fresh "Recent Context" section
- Clear any resolved blockers

### 5. Confirm to User
Output:
```
**Session Summary:**
- Completed: [count] tasks
- In Progress: [count] items
- Next session: [top priority]

**Saved:**
- sessions/{TODAY}.md
- state/current.md

See you next time!
```

### 6. Optional: Commit
If user wants to commit:
```bash
git add state/ sessions/
git commit -m "chore(auditor): session log {TODAY}"
```
