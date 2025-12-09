---
description: Iterative planning with Gemini until 95% confidence (user)
argument-hint: [task description]
---

# Gemini Collaborative Planning

You are entering **iterative planning mode** with Gemini as your co-architect.

**CRITICAL:** Gemini has 5x the context. Gemini reads the files, NOT Claude. This saves tokens.

## Task to Plan
$ARGUMENTS

## Process

### Round 1: Gemini Reads & Drafts
**DO NOT read files yourself.** Send Gemini to explore and draft the initial plan:

```bash
gemini -p "PLANNING TASK: $ARGUMENTS

YOUR JOB:
1. Read any relevant files in this codebase to understand the current implementation
2. Check docs/ for architecture context if helpful
3. Draft an implementation plan with:
   - Goal summary
   - Files to modify/create (with specific line references)
   - Step-by-step approach
   - Potential risks/edge cases
   - Your confidence level (0-100%)

Be thorough - you have the context budget for it."
```

Claude then reviews Gemini's plan and critiques it.

### Iteration Loop
Repeat until BOTH conditions are met:
- Gemini states 95%+ confidence
- You (Claude) are at 95%+ confidence

Each round:
1. Read Gemini's plan carefully
2. Critique it: What could break? What's missing? What would you do differently?
3. State your current confidence level and why
4. Send your critique back to Gemini:
```bash
gemini -p "PLAN REVISION REQUEST (Round N)

Task: $ARGUMENTS

Your previous plan confidence: X%
My (Claude) confidence: Y%

MY CRITIQUE:
[Your specific concerns, questions, edge cases]

Please:
1. Re-read any files needed to address my concerns
2. Revise your plan
3. Update your confidence level"
```

**KEY:** Gemini re-reads files as needed. Claude NEVER reads files during planning.

### Completion
When both reach 95%+ confidence:
1. Present the **final agreed plan** to the user
2. List any caveats or assumptions
3. Ask if they want you to proceed with implementation

## Rules
- **Claude NEVER reads files during planning** - Gemini does all file reading (token savings)
- Do NOT implement anything until the user approves the final plan
- Be honest about your confidence - don't inflate it
- If stuck in a loop (5+ rounds), summarize disagreements and ask user to decide
- Track what changed each round so the user can follow the evolution
- Only read files yourself AFTER the plan is approved and you're implementing
