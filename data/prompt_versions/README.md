# Prompt Versions

This directory stores timestamped backups of persona prompts during optimization.

## File Naming

- `YYYY-MM-DDTHHMMSS_advocate.txt` - Consumer Advocate prompt
- `YYYY-MM-DDTHHMMSS_arbiter.txt` - Fair Arbiter prompt
- `YYYY-MM-DDTHHMMSS_synthesizer.txt` - Synthesizer prompt

## Usage

Each optimization cycle backs up prompts before modification. To revert:

1. Find the timestamp you want to restore
2. Copy content back to `services/audit_agent.js`
3. Or use the `/optimize-audit` command with `--revert TIMESTAMP`

## Changelog

Changes are logged in `changelog.json` with:
- timestamp
- persona modified
- hypothesis
- result (improved/worse/no_change)
