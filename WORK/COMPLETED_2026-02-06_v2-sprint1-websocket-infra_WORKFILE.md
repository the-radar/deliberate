# V2 Sprint 1 WebSocket Infrastructure WORKFILE

## Problem statement and requirements
Implement Deliberate v2 Sprint 1 from `/Users/bobola/.claude/plans/mossy-meandering-hoare.md` so hook events can be broadcast in real time to WebSocket clients without breaking existing v1 behavior. Required outputs:
- Add `src/ws-broadcaster.js` with WS server and session event history.
- Add `POST /api/broadcast` and `GET /api/session/:id` endpoints.
- Wire WebSocket upgrade path into existing HTTP server in `src/server.js`.
- Update hooks (`deliberate-commands.py`, `deliberate-commands-post.py`, `deliberate-changes.py`) to fire-and-forget POST events with short timeout.
- Add `ws` dependency.
- Verify event flow with local WS client and regress existing build/tests.

## Detailed implementation plan (checklist)
- [x] Inspect server and hook code paths where event payload data should be sourced.
- [x] Implement `src/ws-broadcaster.js` with:
  - [x] in-memory session timeline ring buffer
  - [x] WS client management
  - [x] `broadcast(event)` and `getSessionEvents(sessionId)` helpers
  - [x] input validation to avoid malformed event injection
- [x] Modify `src/server.js` to:
  - [x] create HTTP server explicitly
  - [x] attach broadcaster upgrade handler on `/ws`
  - [x] add `POST /api/broadcast` validation + broadcast
  - [x] add `GET /api/session/:id` backfill endpoint
- [x] Modify hooks to POST event payloads with timeout and exception-safe behavior:
  - [x] `hooks/deliberate-commands.py`
  - [x] `hooks/deliberate-commands-post.py`
  - [x] `hooks/deliberate-changes.py`
- [x] Add/update tests for broadcaster and new endpoints.
- [x] Run build/validation checks then tests.
- [x] Manual real-time verification loop with WS client.
- [x] Update continuity files (`CLAUDE.local.md`, this WORKFILE).

## System context (relevant files)
- `/Users/bobola/Documents/deliberate/src/server.js`
- `/Users/bobola/Documents/deliberate/src/index.js`
- `/Users/bobola/Documents/deliberate/hooks/deliberate-commands.py`
- `/Users/bobola/Documents/deliberate/hooks/deliberate-commands-post.py`
- `/Users/bobola/Documents/deliberate/hooks/deliberate-changes.py`
- `/Users/bobola/Documents/deliberate/package.json`
- `/Users/bobola/Documents/deliberate/test/*`

## Directory structure notes
No new top-level directories needed. Add one new module under `src/`.

## Pseudocode for critical algorithms
`broadcast(event)`
1. Validate `event.type`, `event.timestamp`, `event.sessionId`.
2. Normalize payload structure and drop oversized fields.
3. Append to session history list, prune to max N events.
4. Serialize once and send to all open WS clients.
5. Remove dead clients on send failure.

`POST /api/broadcast`
1. Parse JSON body.
2. Validate schema and allowed primitive types.
3. Call broadcaster `broadcast`.
4. Return `{status:"ok"}` quickly.

## Security considerations and potential vulnerabilities
- Reject invalid JSON schema to avoid arbitrary object abuse.
- Bound in-memory history size to prevent unbounded memory growth.
- Keep hook broadcast fail-open: never block command execution if broadcast fails.
- Use short request timeout from hooks.
- Avoid logging sensitive command payloads verbatim in server errors.

## Alternative approaches considered
- SSE instead of WS, rejected because plan explicitly targets WS and bidirectional future growth.
- Writing session history to disk, rejected for Sprint 1 because plan favors in-memory + fast add-on behavior.

## Research findings and reference code
- Existing server uses Express app.listen; must shift to explicit `http.createServer(app)` to handle WS upgrade cleanly.
- Hook code already centralizes risk/explanation/session context, so event payload composition can happen near final output path.

## Design decisions and rationale
- Keep event history in-memory in server process for low-latency backfill.
- Reuse one helper function per hook for POSTing events to reduce duplication and risk of diverging schemas.
- Preserve current hook stdout JSON contract exactly, adding broadcast as side effect only.

## Testing strategy and test cases
- Unit/integration tests for:
  - valid `/api/broadcast` request accepted and retrievable via session endpoint
  - invalid event rejected with 400
- Run existing node test suite to catch regressions.
- Manual WS subscriber validation against live server.

## Progress tracking
- [x] Workfile created
- [x] Code changes complete
- [x] Build checks pass
- [x] Targeted tests pass (`node --test test/ws-broadcaster.test.mjs`)
- [x] Manual WS verification passes (node ws client received broadcast + session backfill count verified)

## Verification notes (2026-02-06)
- `npm install` completed and updated lockfile with `ws`.
- Static checks passed:
  - `node --check src/server.js`
  - `node --check src/ws-broadcaster.js`
  - `PYTHONPYCACHEPREFIX=/tmp python3 -m py_compile hooks/deliberate-commands.py hooks/deliberate-commands-post.py hooks/deliberate-changes.py`
- Targeted tests passed:
  - `node --test test/ws-broadcaster.test.mjs`
- Manual e2e passed using `startServer(0)` + `WebSocket` client + `POST /api/broadcast` + `GET /api/session/:id`.
- Full `npm test` remains failing due pre-existing command-classifier environment/model data issues unrelated to Sprint 1 changes (`classify_command.py` reports no training data available / command-model load failure).

## Questions and uncertainties
- Whether to include full command strings in broadcast for all hooks or keep existing truncation strategy.
