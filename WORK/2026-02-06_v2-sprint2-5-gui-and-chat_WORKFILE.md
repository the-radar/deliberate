# V2 Sprints 2-5 (GUI + Controls + Chat + Packaging) WORKFILE

## Problem statement and requirements
Complete Deliberate v2 per `/Users/bobola/.claude/plans/mossy-meandering-hoare.md` through Sprint 5 so the Tauri GUI works end-to-end:
- Sprint 2: Tauri v2 + Svelte shell that connects to `/ws` and renders timeline.
- Sprint 3: Detail panel + controls with config mutation endpoints and custom blocklist enforcement.
- Sprint 4: Embedded chat per command via Anthropic Messages API with SSE streaming.
- Sprint 5: Packaging polish, build scripts, optional install path.

Also, remove existing test failures and get `npm test` passing locally so we can trust the verification loop.

## Constraints/Assumptions
- Preserve existing hook stdout JSON contract.
- Avoid logging secrets.
- Prefer file-based state, keep config backward compatible.

## Implementation plan (checklist)
- [x] Fix existing classifier test failures so `npm test` is green.
- [x] Sprint 2: scaffold `gui/` (Tauri v2 + SvelteKit) + `deliberate gui` CLI command.
- [x] Implement GUI WS client with reconnect and terminal styling.
- [x] Sprint 3: implement server config endpoints + config schema updates + hooks read customBlocklist.
- [x] Implement GUI detail panel + controls calling REST endpoints.
- [x] Sprint 4: implement server chat handler + SSE streaming + GUI chat thread component.
- [x] Sprint 5: add build scripts, icons placeholders, docs, and ensure `tauri build` works.
- [ ] End-to-end manual verification: server + GUI + hooks on a real session.

## System context
- Server: `/Users/bobola/Documents/deliberate/src/server.js`, `/Users/bobola/Documents/deliberate/src/config.js`
- Hooks: `/Users/bobola/Documents/deliberate/hooks/*`
- CLI: `/Users/bobola/Documents/deliberate/bin/cli.js`
- Plan: `/Users/bobola/.claude/plans/mossy-meandering-hoare.md`

## Testing strategy
- Keep `npm test` green.
- Add targeted tests for new config endpoints and chat route validation.
- Manual GUI smoke tests via `npm run gui:dev` (tauri dev) and WS timeline.

## Progress tracking
- [x] Workfile created
- [x] Classifier tests fixed
- [x] Sprint 2 done
- [x] Sprint 3 done
- [x] Sprint 4 done
- [x] Sprint 5 done
- [ ] End-to-end verified
