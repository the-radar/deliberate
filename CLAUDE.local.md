# Project Working State

## Current Goal:
Finalize Deliberate as a review-first UX/explainability product (TUI-first), with security as a sidecar and no classifier/model stack.

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

### Now:
- Final commit + handoff for user validation in live Claude Code workflows.

### Next:
- Run user-side validation and iterate on policy interview UX polish if needed.

## Open Questions:
- None blocking implementation.

## Working Set (files/ids/commands):
- `/Users/h4tch1ing/Documents/deliberate/WORK/2026-02-21_remove-classifier_WORKFILE.md`
- `/Users/h4tch1ing/Documents/deliberate/bin/cli.js`
- `/Users/h4tch1ing/Documents/deliberate/src/server.js`
- `/Users/h4tch1ing/Documents/deliberate/src/install.js`
- `/Users/h4tch1ing/Documents/deliberate/src/config.js`
- `/Users/h4tch1ing/Documents/deliberate/hooks/deliberate-commands.py`
- `/Users/h4tch1ing/Documents/deliberate/hooks/deliberate-changes.py`
- `/Users/h4tch1ing/Documents/deliberate/README.md`
- `node --check bin/cli.js src/server.js src/install.js src/config.js src/index.js src/tui/index.js`
- `python3 -m py_compile hooks/deliberate-commands.py hooks/deliberate-commands-post.py hooks/deliberate-changes.py hooks/deliberate-session-start.py`
- `python3 -m unittest hooks.tests.test_deliberate_commands -v`
- `npm test`

## Project Ammo (.ammo/)
- none yet
