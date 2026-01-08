---
description: Interactive prompt optimization loop for dialectic audits
---

# Optimize Audit Prompts

You are running an interactive optimization loop for the dialectic audit system.

## Your Mission

Improve the three persona prompts (Advocate, Arbiter, Synthesizer) so that audit scores match human expectations in the benchmark file.

## The Loop

### Step 1: Run Benchmark Audits

Run the batch dialectic auditor:

```bash
source venv/bin/activate && set -a && . ./.env && set +a
node bin/batch_dialectic.js --benchmark data/benchmark_contractors.json --batch-size 3
```

Parse the JSON output to understand:
- Which contractors HIT their expected range (within tolerance)
- Which contractors MISSED and by how much
- The reasoning each persona gave

### Step 2: Analyze Misses

For each miss, examine:
1. What was the expected score vs actual?
2. Which persona pushed the score in the wrong direction?
3. What reasoning did that persona give?
4. Is there a pattern across multiple misses?

Look for patterns like:
- "Advocate ignores positive signals"
- "Arbiter too forgiving of BBB F ratings"
- "Synthesizer always sides with Arbiter"

### Step 3: Propose a Change

Based on your analysis, propose ONE specific change to ONE persona's prompt.

Format your proposal:
```
HYPOTHESIS: [What pattern you're trying to fix]
PERSONA: [Advocate | Arbiter | Synthesizer]
CHANGE: [Specific text to add, remove, or modify]
EXPECTED EFFECT: [Which contractors should improve and why]
```

### Step 4: Ask User

Use AskUserQuestion to ask:
- "Apply this change and run again"
- "Reject, try different hypothesis"
- "Stop optimization here"

### Step 5: If Applying

1. Backup current prompts to `data/prompt_versions/` with timestamp
2. Modify the prompt constant in `services/audit_agent.js`
3. Log the change to `data/prompt_versions/changelog.json`
4. Return to Step 1

## Backup Format

When backing up prompts, use this naming:
```
data/prompt_versions/YYYY-MM-DDTHHMMSS_advocate.txt
data/prompt_versions/YYYY-MM-DDTHHMMSS_arbiter.txt
data/prompt_versions/YYYY-MM-DDTHHMMSS_synthesizer.txt
```

## Changelog Format

Append to `data/prompt_versions/changelog.json`:
```json
{
  "timestamp": "2026-01-09T00:00:00",
  "persona": "advocate",
  "hypothesis": "Advocate ignores positive review volume",
  "change_summary": "Added instruction to acknowledge review volume before concerns",
  "before_hit_rate": "50%",
  "after_hit_rate": "75%",
  "result": "improved"
}
```

## Success Criteria

Stop when:
- 80%+ of benchmark contractors hit their expected range
- OR user says stop
- OR 10 optimization cycles completed

## Important Notes

- Make ONE change at a time to isolate effects
- Always backup before modifying
- If a change makes things worse, revert it
- Focus on the WORST misses first (largest delta)
