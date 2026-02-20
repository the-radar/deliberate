# Deliberate v2 full experience completion WORKFILE

One-line summary: finish the review-first TUI + policy workflow so nervous users get explicit, high-trust approvals with paper trail, then validate end-to-end.

## Problem statement and requirements
User asked to "build the full thing" after iterative feedback on v2. The target UX is:
- Nervous user first: explicit review moments, clear explanations, evidence, and audit trail.
- Team lead second: cross-session oversight and clear "why was this allowed" context.
- TUI-first for Claude Code/OpenCode; GUI kept for future IDE/antigravity harnesses.

Must complete and harden:
- review-first TUI behavior
- always-allow policy UX and persistence
- scoped web evidence and analysis progress surfacing
- stable per-session pane behavior with clear paper trail

## Detailed implementation plan (checklist)
- [x] Re-read active implementation in hooks/TUI/config and identify any remaining gaps.
- [x] Ensure config model includes `deliberate.autoApprove.patterns` with safe defaults.
- [x] Ensure hook path fully supports always-allow policy while preserving dangerous auto-block and full audit logging.
- [x] Improve TUI review UX copy and visibility for policy-based allow decisions.
- [x] Add test coverage for new policy/config behavior and hook normalization matching.
- [x] Update docs and continuity files (`README.md`, `CLAUDE.local.md`, `CONTINUITY.md`).
- [x] Run build/syntax checks, then full and targeted tests.
- [ ] Commit complete implementation with normal human commit message.

## System context (relevant files/methods)
- `/Users/h4tch1ing/Documents/deliberate/src/config.js`
- `/Users/h4tch1ing/Documents/deliberate/hooks/deliberate-commands.py`
- `/Users/h4tch1ing/Documents/deliberate/src/tui/index.js`
- `/Users/h4tch1ing/Documents/deliberate/src/server.js`
- `/Users/h4tch1ing/Documents/deliberate/README.md`
- `/Users/h4tch1ing/Documents/deliberate/CLAUDE.local.md`

## Directory structure (if required)
- Existing repository structure is sufficient.
- New/updated work artifacts in `/Users/h4tch1ing/Documents/deliberate/WORK/`.

## Pseudocode for critical algorithms
### Always-allow matching (hook)
1. Normalize command (strip wrappers, collapse whitespace, lowercase).
2. Iterate `deliberate.autoApprove.patterns`.
3. Normalize each pattern and substring-match against command.
4. If matched:
   - keep analysis/evidence/cache/history
   - emit command_analyzed with `permissionDecision: allow` and `autoApproval` metadata
   - skip interactive approval prompt

### Review queue (TUI)
1. Read timeline events.
2. Group by analysisId.
3. Keep latest progress event until final decision event appears.
4. In review mode, show pending approval/progress set.
5. In history mode, show full timeline.

## Security considerations and potential vulnerabilities
- No arbitrary web fetching, only known registry/search endpoints.
- Keep hook fail-open and time-bounded for network calls.
- Avoid logging secrets in audit events or test fixtures.
- Preserve hard dangerous auto-block path even with auto-approve policies.

## Alternative approaches considered
- Remove auto-approve entirely: rejected because user explicitly needs controllable friction reduction.
- GUI-first revisit: rejected for Claude Code/OpenCode workflows where side-pane TUI is preferred.

## Research findings and reference code
- Existing hook already supports scoped evidence lookup, event progress streaming, and auto-approve matching.
- Existing TUI already supports review/history split and guided always-allow action.
- Remaining work is gap closure, validation, and documentation consistency.

## Design decisions and rationale
- Keep explicit review queue as default to prioritize nervous-user approvals.
- Keep policy decisions auditable with explicit `policy_update` and `autoApproval` metadata.
- Keep behavior additive and backward-compatible with existing hook output contract.

## Testing strategy and test cases
- Build/syntax checks:
  - `python3 -m py_compile hooks/deliberate-commands.py hooks/deliberate-session-start.py`
  - `node --check src/config.js src/tui/index.js src/server.js`
- Automated tests:
  - `node --test --test-concurrency=1`
  - new focused tests for config auto-approve mutation and hook normalization/matching
- Manual sanity:
  - run TUI and inspect review queue rendering from existing event logs

## Progress tracking
- [x] Workfile created
- [x] Gap analysis completed
- [x] Code changes completed
- [x] Tests completed
- [x] Docs/continuity updated
- [ ] Commit completed

## Questions and uncertainties to resolve
- Determine whether current code already satisfies "full thing" user intent with only polish/docs, or if additional UX code changes are still needed after direct validation.

## Validation notes
- `node --check src/config.js src/tui/index.js src/server.js` passed.
- `python3 -m py_compile hooks/deliberate-commands.py hooks/deliberate-commands-post.py hooks/deliberate-session-start.py hooks/deliberate-changes.py` passed.
- `python3 -m unittest hooks.tests.test_deliberate_commands -v` passed.
- Targeted node tests passed:
  - `node --test --test-concurrency=1 test/config-defaults.test.mjs test/config-chat-api.test.mjs test/event-log.test.mjs test/chat-client.test.mjs test/ws-broadcaster.test.mjs`
- Full `npm test` currently fails because the local classifier model environment is missing required `huggingface-hub` version (`>=0.34.0,<1.0`). This affects pre-existing suites:
  - `/Users/h4tch1ing/Documents/deliberate/test/test-aws-cli.mjs`
  - `/Users/h4tch1ing/Documents/deliberate/test/test-classifier.mjs`
  - `/Users/h4tch1ing/Documents/deliberate/test/test-edge-cases.mjs`
  - `/Users/h4tch1ing/Documents/deliberate/test/test-novel-commands.mjs`
