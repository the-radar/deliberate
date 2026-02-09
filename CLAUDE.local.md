# Project Working State

## Current Goal:
Pivot Deliberate v2 UX to a terminal-native TUI + split-pane workflow (WezTerm-first, tmux optional), with embedded chat, while keeping the v2 GUI in-repo for later IDE/Antigravity harnesses.

## Constraints/Assumptions:
- Keep current v1 CLI/hook behavior unchanged while adding v2 pieces.
- TUI/Pane is additive, not a replacement for hook stdout JSON.
- UI feed must be reliable with history (do not depend on server being up at the right moment).
- Canonical project continuity file is `CLAUDE.local.md`.

## Key Decisions:
- Switch active track from v1 GTM tasks to v2 implementation planning/execution.
- Treat `/Users/bobola/.claude/plans/mossy-meandering-hoare.md` as “implemented but deprecated UX”. Keep the GUI, but Claude Code/OpenCode should use TUI.
- Remove active workflow references to `CONTINUITY.md` in hooks/config.

## State:
### Done:
- Confirmed v2 plan exists and is detailed (Tauri GUI companion with 5 sprints).
- Confirmed v2 code has not started yet (`gui/` missing, no broadcast endpoints).
- Migrated project continuity file name from `CONTINUITY.md` to `CLAUDE.local.md`.
- Implemented Sprint 1 core plumbing:
  - `src/ws-broadcaster.js` (event validation, bounded per-session history, WS fanout)
  - `src/server.js` now exposes `/api/broadcast`, `/api/session/:id`, and `/ws` upgrade route
  - Hook-side fire-and-forget broadcasts in `deliberate-commands.py`, `deliberate-commands-post.py`, `deliberate-changes.py`
  - Added unit tests in `test/ws-broadcaster.test.mjs`
- Completed Sprint 1 validation pass:
  - `npm install` succeeded and lockfile now includes `ws`
  - manual WS e2e check passed (`/api/broadcast` -> `/ws` client event -> `/api/session/:id` backfill)
- Fixed pre-existing repo issues so `npm test` is fully green.
- Implemented Sprints 2-5:
  - `gui/` Tauri v2 + SvelteKit shell with timeline, details, controls, chat, settings
  - `deliberate gui` CLI command
  - Config endpoints: `GET /api/config`, `PATCH /api/config`, `POST /api/config/skip`, `POST /api/config/block`
  - Hook-side custom blocklist enforcement (`customBlocklist`)
  - Chat: `POST /api/chat` SSE streaming with mock mode for tests
  - Root scripts: `gui:install`, `gui:dev`, `gui:build`, `gui:check`
  - `npm --prefix gui run check` and `tauri build` succeed locally
- Implemented v2 pivot (TUI-first for Claude Code/OpenCode):
  - Persistent JSONL event log under `~/.deliberate/events/` (hooks + server fallback)
  - `deliberate tui` terminal UI with session filter, details, skip/block controls, embedded chat
  - `deliberate pane` split-pane launcher (WezTerm-first, tmux optional, fallback to current terminal)
  - Per-session pane defaulting: hooks now include `cwd` in events and the pane/TUI auto-picks the most recent session for the current working directory
  - Claude Code SessionStart hook (`hooks/deliberate-session-start.py`) can auto-open a per-session pane and auto-start the server
  - Installer no longer hard-fails on missing `claude-agent-sdk` (optional, not required for core functionality)

### Now:
- Manual verification in WezTerm against real Claude Code sessions (pane split, follow behavior, skip/block effects).

### Next:
- Decide release packaging for GUI vs TUI (binary distribution and how users should choose UI mode by environment).

## Open Questions:
- None for core v2 implementation. Remaining work is polish and release flow decisions (GUI binary distribution, signing).

## Working Set (files/ids/commands):
- `/Users/bobola/Documents/deliberate/CLAUDE.local.md`
- `/Users/bobola/.claude/plans/mossy-meandering-hoare.md`
- `/Users/bobola/Documents/deliberate/WORK/2026-02-07_tui-pane-pivot_WORKFILE.md`
- `/Users/bobola/Documents/deliberate/src/ws-broadcaster.js`
- `/Users/bobola/Documents/deliberate/src/server.js`
- `/Users/bobola/Documents/deliberate/hooks/deliberate-commands.py`
- `/Users/bobola/Documents/deliberate/hooks/deliberate-commands-post.py`
- `/Users/bobola/Documents/deliberate/hooks/deliberate-changes.py`
- `/Users/bobola/Documents/deliberate/test/ws-broadcaster.test.mjs`
- `/Users/bobola/Documents/deliberate/WORK/COMPLETED_2026-02-06_v2-sprint1-websocket-infra_WORKFILE.md`
- `/Users/bobola/Documents/deliberate/WORK/2026-02-06_v2-sprint2-5-gui-and-chat_WORKFILE.md`

## Project Ammo (.ammo/)
- none yet
