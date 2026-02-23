# One-command start + onboarding walkthrough WORKFILE

One-line summary: ship a friendlier first-run experience with a single `deliberate start` command and a concise in-terminal onboarding walkthrough.

## Problem statement and requirements
User feedback: Deliberate feels powerful after setup, but first-time flow still has friction.

Required outcomes:
- One command to get moving (`deliberate start`) so users do not need to remember server + pane choreography.
- A short onboarding walkthrough focused on real user actions and keyboard controls.
- Keep behavior cross-terminal and fail-open.

## Detailed implementation plan (checklist)
- [x] Add start/orchestration module for:
  - [x] server health check
  - [x] detached server boot when needed
  - [x] first-run onboarding text rendering
  - [x] onboarding completion persistence in config
- [x] Add CLI commands:
  - [x] `deliberate start` (server + pane, with optional `--no-pane`)
  - [x] `deliberate onboarding` (replay quick walkthrough)
- [x] Update default config schema with onboarding state.
- [x] Update install success copy + README/TROUBLESHOOTING + changelog messaging.
- [x] Add/extend tests for new config defaults and start helper behavior.
- [ ] Run full build/test verification and commit.

## System context (relevant files)
- `/Users/h4tch1ing/Documents/deliberate/bin/cli.js`
- `/Users/h4tch1ing/Documents/deliberate/src/config.js`
- `/Users/h4tch1ing/Documents/deliberate/src/pane.js`
- `/Users/h4tch1ing/Documents/deliberate/src/install.js`
- `/Users/h4tch1ing/Documents/deliberate/README.md`
- `/Users/h4tch1ing/Documents/deliberate/TROUBLESHOOTING.md`
- `/Users/h4tch1ing/Documents/deliberate/CHANGELOG.md`
- `/Users/h4tch1ing/Documents/deliberate/test/config-defaults.test.mjs`

## Security considerations and potential vulnerabilities
- Startup orchestration must not leak secrets or config keys.
- Server boot should be local-only and detached, no remote execution.
- Health checks should use short timeouts and strict localhost target.
- Onboarding text should not imply reduced review guarantees.

## Alternative approaches considered
- Add onboarding inside installer only. Rejected because users often forget install-time guidance.
- Force onboarding every run. Rejected to avoid noise for experienced users.

## Testing strategy
- `node --check` on changed JS files.
- `npm test` for Node tests.
- `python3 -m py_compile hooks/*.py` regression sanity.
- `python3 -m unittest hooks.tests.test_deliberate_commands hooks.tests.test_deliberate_changes -v` unchanged hook safety checks.

## Progress tracking
- [x] Workfile created
- [x] Implementation complete
- [x] Tests complete
- [x] Docs complete
- [ ] Commit complete

## Questions / uncertainties
- None blocking.

## Validation notes
- `node --check bin/cli.js src/start.js src/config.js src/install.js src/index.js src/server.js src/tui/index.js` passed.
- `npm test` passed (`12/12`).
- `python3 -m py_compile hooks/deliberate-commands.py hooks/deliberate-commands-post.py hooks/deliberate-changes.py hooks/deliberate-session-start.py` passed.
- `python3 -m unittest hooks.tests.test_deliberate_commands hooks.tests.test_deliberate_changes -v` passed.
- Manual smoke:
  - `node bin/cli.js start --no-pane --force-onboarding` passed.
  - `node bin/cli.js onboarding --no-mark-complete` passed.
