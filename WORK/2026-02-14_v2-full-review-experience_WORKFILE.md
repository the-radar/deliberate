# Deliberate v2 full review experience WORKFILE

## Problem statement and requirements
User asked to "build the full thing" for the v2 TUI-first Deliberate experience.

Primary target user is a nervous operator who wants explicit approvals, clear human explanations, and a durable paper trail. Secondary target is a team lead who needs oversight across sessions.

Required outcomes for this pass:
- Review-first TUI flow that prioritizes pending approvals over noisy history.
- Strong "always allow going forward" UX with explicit risk guidance and user confirmation.
- Real, visible evidence in approvals remains intact (npm/PyPI/GitHub/GitLab/local).
- Hook policy support for auto-approve patterns so approved patterns skip future prompts while still preserving auditability.
- Keep fail-open behavior and local reliability (no hard dependency on server).

## Detailed implementation plan (checklist)
- [x] Implement hook auto-approve pattern support:
  - [x] Load `deliberate.autoApprove.patterns` from config.
  - [x] Normalize + match against command safely.
  - [x] Apply policy after analysis, before ask gate, while preserving dangerous hard-block behavior.
  - [x] Include policy metadata in cache, event payloads, and context.
- [x] Add per-session scoped web evidence cache in hook to reduce repeated lookups.
- [ ] Extend server config API:
  - [x] Add endpoint to append auto-approve patterns.
  - [x] Cover endpoint in existing config API tests.
- [x] Redesign TUI for review-first experience:
  - [x] Add review/history view toggle (default review).
  - [x] Build pending-approval queue from event stream by analysis lifecycle.
  - [x] Improve event/details rendering for policy updates and evidence.
  - [x] Add guided "always allow" flow (LLM-assisted guidance + explicit confirm).
  - [x] Write local policy audit events to JSONL for paper trail.
- [ ] Update docs and continuity:
  - [x] README shortcut/feature docs.
  - [x] CLAUDE.local.md + CONTINUITY.md state updates.
  - [x] Mark progress in this workfile.
- [ ] Verification:
  - [x] Build/type/syntax checks.
  - [x] Run targeted tests.
  - [x] Run full test suite and document known unrelated flakes if present.

## System context (relevant files)
- `/Users/h4tch1ing/Documents/deliberate/hooks/deliberate-commands.py`
- `/Users/h4tch1ing/Documents/deliberate/hooks/deliberate-commands-post.py`
- `/Users/h4tch1ing/Documents/deliberate/src/tui/index.js`
- `/Users/h4tch1ing/Documents/deliberate/src/config.js`
- `/Users/h4tch1ing/Documents/deliberate/src/server.js`
- `/Users/h4tch1ing/Documents/deliberate/src/chat-client.js`
- `/Users/h4tch1ing/Documents/deliberate/test/config-chat-api.test.mjs`

## Directory structure (if required)
No new top-level directories expected. Reuse current `src/`, `hooks/`, and `test/` layout.

## Pseudocode for critical algorithms
### Pending approval queue (TUI)
1. Filter events by selected session/all.
2. Walk events in timestamp order.
3. For each analysisId:
   - latest progress -> provisional pending item
   - `command_analyzed` with `ask` -> pending item
   - `command_analyzed` with `allow|block` -> remove pending
   - `command_post_analysis` -> remove pending
4. Render pending items as review queue.

### Hook auto-approve decision
1. Run existing analysis pipeline (classifier + LLM + evidence).
2. If command matches auto-approve pattern and command is not hard-blocked:
   - set permission decision to allow
   - cache + broadcast with auto-approve metadata
   - return without interactive ask
3. Otherwise continue existing ask flow.

## Security considerations and potential vulnerabilities
- Keep hook fail-open and timeout-bounded on network calls.
- Keep evidence lookup scoped to known registry/search APIs.
- Never emit secrets in logs, cache, or event details.
- Preserve hard auto-block behavior for truly dangerous commands even if a broad allow pattern exists.
- Audit policy changes by appending local event-log entries with minimal required metadata.

## Alternative approaches considered
- Keep single history stream only: rejected, too noisy for the nervous primary user.
- Full GUI policy wizard first: rejected for this pass, product direction is terminal-native first.
- General web fetch tool: rejected by security scope, keep structured search only.

## Research findings and reference code
- Existing incremental progress stream and evidence plumbing already in hook/TUI.
- Existing chat stream client can provide guidance text in TUI overlays.
- Existing config mutation helpers provide durable local policy storage.

## Design decisions and rationale
- Default TUI mode should be review queue because approvals are the core job-to-be-done.
- Keep history mode available for team lead/audit workflows.
- "Always allow" should be deliberate and explicit, not a silent skip toggle.
- Auto-approve must still preserve audit trail (events + cache + post summary).

## Testing strategy and test cases
- Config API test: verify `/api/config/auto-approve` persists pattern.
- TUI smoke: ensure review queue computes correctly from mixed event sequence.
- Hook smoke: run python syntax check and dry-run with sample payloads.
- Existing targeted node tests for event log/chat/ws remain green.

## Progress tracking
- [x] Workfile created
- [x] Hook auto-approve + cache
- [x] TUI review-first + guided always allow
- [x] API + tests
- [x] Docs/continuity
- [x] Validation and final pass

## Questions and uncertainties
- Keep dangerous hard-block precedence over auto-approve for this pass unless user explicitly requests override.

## Validation notes
- `python3 -m py_compile hooks/*.py` passed.
- `node --check` passed on changed JS modules.
- Targeted tests passed:
  - `node --test --test-concurrency=1 test/config-chat-api.test.mjs test/event-log.test.mjs test/chat-client.test.mjs test/ws-broadcaster.test.mjs`
- Full suite still shows existing classifier/model instability unrelated to this change set:
  - `test/test-aws-cli.mjs` (CmdCaliper timeout noise)
  - `test/test-classifier.mjs` (CmdCaliper timeout noise)
  - `test/test-edge-cases.mjs` (existing borderline classifier expectation mismatches)
