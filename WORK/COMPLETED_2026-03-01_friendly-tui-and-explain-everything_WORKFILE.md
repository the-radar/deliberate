# Friendly TUI + explain-everything mode WORKFILE

One-line summary: make Deliberate feel friendlier in-session and add a first-class "explain everything" mode for full command narration.

## Problem statement and requirements
User wants Deliberate to act like an assistant that explains everything in Claude Code, while keeping the UI less invasive and less technical.

Requirements:
- Keep existing power features, but improve copy/tone/labels for nervous users.
- Prioritize explanation visibility in details panel.
- Add explicit explain-everything mode (disable default skip list).
- Keep record-only compatibility.

## Detailed implementation plan (checklist)
- [x] Add `deliberate.explainEverything` config flag with default `false`.
- [x] Wire hook skip logic to honor explain-everything mode.
- [x] Add tests for config defaults + skip behavior.
- [x] Make TUI header/list/details wording friendlier and explanation-first.
- [x] Add in-TUI `e` toggle for explain-everything mode.
- [x] Validate build/tests and runtime behavior.
- [x] Update docs and commit.

## System context
- `/Users/h4tch1ing/Documents/deliberate/src/config.js`
- `/Users/h4tch1ing/Documents/deliberate/hooks/deliberate-commands.py`
- `/Users/h4tch1ing/Documents/deliberate/src/tui/index.js`
- `/Users/h4tch1ing/Documents/deliberate/src/start.js`
- `/Users/h4tch1ing/Documents/deliberate/README.md`
- `/Users/h4tch1ing/Documents/deliberate/TROUBLESHOOTING.md`
- `/Users/h4tch1ing/Documents/deliberate/hooks/tests/test_deliberate_commands.py`
- `/Users/h4tch1ing/Documents/deliberate/test/config-defaults.test.mjs`

## Security considerations
- Explain-everything increases analysis frequency, but does not weaken blocking logic by itself.
- Record-only remains explicit and separate from explain-everything.
- Event logging/audit remains unchanged.

## Testing strategy
- `node --check bin/cli.js src/pane.js src/start.js src/tui/index.js src/config.js`
- `python3 -m py_compile hooks/*.py`
- `python3 -m unittest hooks.tests.test_deliberate_commands hooks.tests.test_deliberate_changes -v`
- `npm test`
- Runtime smoke: simulate `ls -la` with explain-everything on and verify hook emits explanation instead of skipping.

## Progress tracking
- [x] Workfile created
- [x] Implementation in progress
- [x] Validation complete
- [x] Commit complete
