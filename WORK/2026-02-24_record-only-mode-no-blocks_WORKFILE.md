# Record-only mode (no blocks/approval gates) WORKFILE

One-line summary: implement a true record-only mode so Deliberate keeps explainability/audit logging while never blocking or requiring approval prompts.

## Problem statement and requirements
User requested: keep Deliberate active but remove execution blocking while they do time-sensitive work.

Requirements:
- No `permissionDecision: block`
- No `permissionDecision: ask`
- Keep command analysis, explanation generation, evidence capture, and event logging
- Preserve safety transparency in output/pane history

## Detailed implementation plan (checklist)
- [x] Add config default for `deliberate.recordOnly`.
- [x] Add hook helper to read record-only state from config.
- [x] Skip custom blocklist hard-stop when record-only is enabled.
- [x] Force PreToolUse allow path in record-only mode while preserving context/event payloads.
- [x] Add/adjust tests.
- [x] Enable record-only in runtime config and verify with live hook output.
- [x] Reinstall hooks + run full local tests.

## System context (relevant files)
- `/Users/h4tch1ing/Documents/deliberate/src/config.js`
- `/Users/h4tch1ing/Documents/deliberate/hooks/deliberate-commands.py`
- `/Users/h4tch1ing/Documents/deliberate/hooks/tests/test_deliberate_commands.py`
- `/Users/h4tch1ing/Documents/deliberate/test/config-defaults.test.mjs`
- `/Users/h4tch1ing/Documents/deliberate/README.md`
- `/Users/h4tch1ing/Documents/deliberate/TROUBLESHOOTING.md`

## Security considerations
- Record-only mode intentionally reduces interactive safety gates.
- Compensating controls retained: risk scoring, LLM explanation, event log trail, evidence context, and post-analysis.
- Explicit override text is included for blocklist matches so operators can see what would have been blocked.

## Alternative approaches considered
- Disable Deliberate entirely: rejected, loses audit trail and explainability.
- Add wildcard auto-approve: rejected, dangerous commands still hit manual review and does not satisfy “no blocks”.

## Testing strategy
- `python3 -m py_compile hooks/*.py`
- `python3 -m unittest hooks.tests.test_deliberate_commands hooks.tests.test_deliberate_changes -v`
- `node --check src/config.js src/tui/index.js src/install.js bin/cli.js`
- `npm test`
- Live hook simulation for dangerous command and blocklist match, verify `permissionDecision: allow`.

## Progress tracking
- [x] Workfile created
- [x] Implementation in progress
- [x] Runtime validated
- [x] Docs validated
- [ ] Commit completed

## Open questions
- Should TUI header explicitly show `record-only` as an operating mode label?
