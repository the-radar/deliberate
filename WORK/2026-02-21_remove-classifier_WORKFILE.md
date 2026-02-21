# Remove classifier stack and shift Deliberate to UX/explainability WORKFILE

One-line summary: remove model/classifier pipeline entirely, keep Deliberate focused on review UX + explainability + policy controls, with lightweight rule sidecar.

## Problem statement and requirements
User requested complete classifier removal and a clearer product value: UX and explainability first, security as a sidecar, without stifling users.

Required outcome:
- No model/classifier runtime dependency in CLI, hooks, server, docs, or tests.
- Hooks continue to provide explicit review moments, evidence, policy controls, and audit trail.
- Server remains for broadcast/history/chat/config only.
- Product messaging reflects the new value proposition.

## Detailed implementation plan (checklist)
- [x] Remove classifier references from Node runtime (`src/server.js`, `bin/cli.js`, `src/index.js`, `src/install.js`, `src/config.js`).
- [x] Remove classifier network dependency from hooks:
  - [x] `hooks/deliberate-commands.py`
  - [x] `hooks/deliberate-changes.py`
- [x] Replace classifier-based risk path with lightweight in-hook rule pre-assessment + LLM explanation.
- [x] Remove classifier-specific test suites and add lightweight regression tests for non-classifier behavior.
- [x] Remove classifier package/dependency surface (`src/classifier`, package deps/files).
- [x] Remove classifier training assets (`training/`) to eliminate dead maintenance surface.
- [x] Update README and status/install text to reflect UX-first architecture.
- [x] Refresh marketing collateral to remove classifier-centric messaging (`docs/marketing-plan.md`, `launch-posts.md`, `docs/compare-safety-net.md`).
- [x] Run syntax/build checks and full tests.
- [x] Commit with clean, human message.

## System context (relevant files)
- `/Users/h4tch1ing/Documents/deliberate/bin/cli.js`
- `/Users/h4tch1ing/Documents/deliberate/src/server.js`
- `/Users/h4tch1ing/Documents/deliberate/src/install.js`
- `/Users/h4tch1ing/Documents/deliberate/src/index.js`
- `/Users/h4tch1ing/Documents/deliberate/src/config.js`
- `/Users/h4tch1ing/Documents/deliberate/hooks/deliberate-commands.py`
- `/Users/h4tch1ing/Documents/deliberate/hooks/deliberate-changes.py`
- `/Users/h4tch1ing/Documents/deliberate/package.json`
- `/Users/h4tch1ing/Documents/deliberate/README.md`

## Security considerations and potential vulnerabilities
- Preserve fail-open behavior and strict timeouts in hooks.
- Keep explicit custom blocklist policy as user-controlled hard stop.
- Avoid replacing classifier with brittle broad auto-blocking; prioritize user approval flow.
- Keep logs and context free of secrets.

## Alternative approaches considered
- Keep classifier optional: rejected to match explicit user request for complete removal.
- Keep classifier endpoints but no-op internally: rejected as dead complexity and misleading API surface.

## Testing strategy
- `node --check` across changed JS files.
- `python3 -m py_compile` for all hooks.
- `python3 -m unittest hooks.tests.test_deliberate_commands -v`.
- `node --test --test-concurrency=1` full suite (post-removal).

## Progress tracking
- [x] Workfile created
- [x] Implementation complete
- [x] Tests complete
- [x] Docs/continuity updated
- [x] Commit complete

## Questions / uncertainties
- No blockers. Legacy config compatibility was removed in active codepaths to keep architecture explicit.

## Validation notes
- `node --check bin/cli.js src/server.js src/install.js src/config.js src/index.js src/tui/index.js` passed.
- `python3 -m py_compile hooks/deliberate-commands.py hooks/deliberate-commands-post.py hooks/deliberate-changes.py hooks/deliberate-session-start.py` passed.
- `python3 -m unittest hooks.tests.test_deliberate_commands hooks.tests.test_deliberate_changes -v` passed.
- `npm test` passed (`9/9`).
