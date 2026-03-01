# /end (or end) - Hybrid Session Closeout

`end` and `/end` are identical.

Modes:
- `end` (default): Hybrid Core closeout now
- `end full`: Hybrid Core + full closeout now
- `end async`: Hybrid Core now + delegated heavy closeout

## Process

### 1. Resolve Date/Time (CT)
```bash
TZ="America/Chicago" date +%Y-%m-%d
TZ="America/Chicago" date +%H:%M
```

### 2. Ensure Session Log
- Ensure `sessions/` exists.
- Ensure `sessions/{TODAY}.md` exists.

### 3. Hybrid Core (MANDATORY)
Write immediately while context is fresh:

1. Update `state/current.md` with:
- active work
- blockers
- next actions
- any handoffs needed

2. Update `state/carry-forward.md` with one distilled next-session lesson.

3a. Preferred authoring rule: keep `<tldr>` in source files at 150 chars or less:
```bash
/home/astre/command-center/src/orchestrator/tools/check_system_meta_tldr.sh "$(pwd)" || echo WARN_tldr_over_150_truncation_backup
```
(Truncation during local-index rebuild is backup only.)

3. Rebuild `state/local-index.md` from workspace `\<system_meta\>` blocks:
```bash
/home/astre/command-center/src/orchestrator/tools/build_local_index.sh "$(pwd)"
```

4. Append concise summary to `sessions/{TODAY}.md`:
```markdown
## Session Ended: HH:MM CT

### Accomplished
- ...

### Next
- ...
```

This step is required for all `/end` modes.

### 4. Mode Behavior

#### `end` (default)
- Stop after Hybrid Core.

#### `end full`
- After Hybrid Core:
  - add COOKIE/BAD ROBOT to `/home/astre/command-center/LESSONS.md` when reusable
  - update `state/profile.md` for newly observed user preferences/patterns
  - run doc/contract drift check if workflows changed
  - rate session quality (`X/100`) with one concrete improvement

#### `end async`
- After Hybrid Core:
  1. Write capsule: `state/end-capsule-{TODAY}-{TIME}.md`
  2. Include: scope completed, key files touched, decisions, candidate lessons, profile deltas, open handoffs
  3. Dispatch background worker (Task tool or dispatch surface) with capsule + workspace path
  4. Worker may append/refine but must not overwrite Hybrid Core entries
  5. Worker appends completion note to `sessions/{TODAY}.md` with CT timestamp

### 5. Guardrails
- `/end` can write what it needs for continuity.
- Do not mutate lock/policy docs unless explicitly requested.
- Keep timestamps in `CT`.
