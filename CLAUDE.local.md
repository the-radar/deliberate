# Project Working State

## Current Goal:
Polish first-run UX with one-command startup and onboarding walkthrough, while keeping Deliberate review-first and TUI-native.

## Constraints/Assumptions:
- Keep hook fail-open behavior and low latency.
- Preserve per-session pane workflow for Claude Code/OpenCode.
- Keep GUI in repo for future IDE harnesses, but TUI is the primary experience.

## Key Decisions:
- Removed classifier stack completely from runtime, hooks, server API surface, and tests.
- Server now focuses on event broadcast/history/config/chat only.
- Command/file risk now uses lightweight local rules + LLM explanation, not ML classifier scoring.
- Removed legacy classifier training assets from `training/` to keep maintenance surface small.

## State:
### Done:
- TUI-first pivot with review queue, history mode, policy controls, embedded chat, and audit log.
- Scoped evidence lookup (npm/PyPI/GitHub/GitLab + local bin resolution).
- Guided always-allow workflow with audit events.
- Classifier removal pass:
  - deleted `/Users/h4tch1ing/Documents/deliberate/src/classifier/`
  - removed classifier-heavy tests (`test/test-aws-cli.mjs`, `test/test-classifier.mjs`, `test/test-edge-cases.mjs`, `test/test-novel-commands.mjs`)
  - removed `@huggingface/transformers` dependency and classifier packaging artifacts
  - updated server/CLI/install/config/hooks/docs to classifier-free architecture
- Local validation now fully green (`npm test` passes end-to-end).
- One-command startup + onboarding pass:
  - added `deliberate start` (ensures server + opens pane)
  - added `deliberate onboarding` (replay walkthrough)
  - added startup/orchestration module `/Users/h4tch1ing/Documents/deliberate/src/start.js`
  - updated docs/install messaging to point users to `deliberate start`
  - added test coverage for start/onboarding helpers

### Now:
- Hand off for external review.

### Next:
- Run user-side validation and iterate on policy interview UX polish if needed.

## Open Questions:
- None blocking implementation.

## Working Set (files/ids/commands):
- `/Users/h4tch1ing/Documents/deliberate/WORK/2026-02-21_remove-classifier_WORKFILE.md`
- `/Users/h4tch1ing/Documents/deliberate/WORK/2026-02-23_onboarding-start-workflow_WORKFILE.md`
- `/Users/h4tch1ing/Documents/deliberate/bin/cli.js`
- `/Users/h4tch1ing/Documents/deliberate/src/start.js`
- `/Users/h4tch1ing/Documents/deliberate/src/server.js`
- `/Users/h4tch1ing/Documents/deliberate/src/install.js`
- `/Users/h4tch1ing/Documents/deliberate/src/config.js`
- `/Users/h4tch1ing/Documents/deliberate/README.md`
- `/Users/h4tch1ing/Documents/deliberate/TROUBLESHOOTING.md`
- `node --check bin/cli.js src/start.js src/config.js src/install.js src/index.js src/server.js src/tui/index.js`
- `python3 -m py_compile hooks/deliberate-commands.py hooks/deliberate-commands-post.py hooks/deliberate-changes.py hooks/deliberate-session-start.py`
- `python3 -m unittest hooks.tests.test_deliberate_commands hooks.tests.test_deliberate_changes -v`
- `npm test`

## Project Ammo (.ammo/)
- none yet
