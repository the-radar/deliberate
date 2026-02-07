# Deliberate v2 Pivot: TUI + Pane (replace GUI-first UX) WORKFILE

## Problem statement and requirements
The v2 Tauri GUI companion shipped, but the workflow feels disconnected from Claude Code/OpenCode. The new intended UX is terminal-native:

- A Deliberate TUI that shows hook events as a stacked, reviewable timeline with expandable details.
- A `deliberate pane` command that opens the TUI in a split pane when possible (WezTerm first, tmux optional), so the agent session stays on the left and Deliberate stays always-on on the right.
- Embedded chat inside the TUI for “discuss this command/change” threads.
- GUI remains in the repo for later IDE/Antigravity harnesses, but Claude Code/OpenCode should default to TUI.

Success looks like: I can run `deliberate pane`, keep coding in Claude Code, and Deliberate events reliably accumulate in the side pane with history, controls, and chat.

## Constraints/assumptions
- Keep hook stdout JSON contract unchanged (agent still receives `additionalContext`).
- Never print secrets (config API keys, OAuth tokens).
- “Always on” means the side pane stays running until the user closes it, without requiring tmux.
- Cross-terminal: WezTerm is the best path, but we must degrade gracefully elsewhere.
- Avoid mandatory server dependency for the UI feed. Hooks must fail-open and never block.

## Implementation plan (checklist)
- [x] Create a persistent event log written by hooks (JSONL) so the UI has history even if the server/UI starts late.
- [x] Implement `src/tui/`:
  - [x] Timeline list (stacked items) + details viewer
  - [x] Session filter (latest/all)
  - [x] Controls: skip warning / always block for selected item (writes to config.json via `src/config.js`)
  - [x] Embedded chat (streaming tokens, mock mode when no key)
  - [x] Keyboard shortcuts + minimal help footer
- [x] Add CLI commands:
  - [x] `deliberate tui` runs the TUI
  - [x] `deliberate pane` opens a split pane (wezterm cli, tmux if present, fallback to current terminal)
- [x] Update hook terminal pointer text from “GUI” to “TUI/pane” and write events to JSONL (without changing gating).
- [x] Server polish (optional): append `/api/broadcast` events to JSONL only when hooks did not already log (header gate).
- [x] Tests:
  - [x] Unit tests for event log writer/reader
  - [x] Chat client tests in mock mode (no keys required)
- [ ] Manual end-to-end verification:
  - [ ] Run `deliberate pane` in WezTerm, trigger hook events, confirm they appear and persist
  - [ ] Confirm skip/block actions update config and immediately affect hook behavior

## System context (files, methods)
- CLI entry: `/Users/bobola/Documents/deliberate/bin/cli.js`
- Hooks:
  - `/Users/bobola/Documents/deliberate/hooks/deliberate-commands.py`
  - `/Users/bobola/Documents/deliberate/hooks/deliberate-commands-post.py`
  - `/Users/bobola/Documents/deliberate/hooks/deliberate-changes.py`
- Config helpers: `/Users/bobola/Documents/deliberate/src/config.js`
- Server + WS: `/Users/bobola/Documents/deliberate/src/server.js`, `/Users/bobola/Documents/deliberate/src/ws-broadcaster.js`
- Existing GUI (kept): `/Users/bobola/Documents/deliberate/gui/`

## Directory structure (new)
- `src/tui/` for TUI implementation
- `src/event-log.js` shared log helpers (path, append, read, tail)
- `test/event-log.test.mjs` and `test/chat-client.test.mjs`

## Pseudocode (critical pieces)

### Hook event log append (Python)
```
payload = {type, timestamp, sessionId, data}
path = ~/.deliberate/events/events-YYYY-MM-DD.jsonl
mkdir -p dirname(path)
append line: json.dumps(payload) + "\n"
best-effort, swallow errors
```

### Node TUI tailer
```
load recent events by reading last N lines from the newest JSONL file(s)
open file descriptor, seek to end
fs.watch(file) -> on change, read newly appended bytes, split into lines, parse JSON
emit parsed events to UI store
```

### Chat (shared client)
```
if DELIBERATE_CHAT_MODE=mock OR no api key/oauth token:
  stream mock tokens
else:
  POST https://api.anthropic.com/v1/messages with stream:true
  parse SSE "data:" lines and forward text deltas to UI
```

## Security considerations
- Event log stores raw commands/paths, which can include secrets. Mitigations:
  - Store locally under `~/.deliberate/` with restrictive permissions (0600).
  - Keep retention bounded (delete logs older than N days, default 7).
  - Provide config escape hatch later if user wants to disable persistence.
- Chat: never print keys/tokens. Errors must not dump request bodies.
- Pane spawning: avoid shell injection by using execFile/spawn argument arrays.

## Alternative approaches considered
- WS-only feed (no event log): simpler, but loses history when server is started late and breaks “always on” reliability.
- Mandatory tmux: great UX but fails in many environments.
- Keep GUI and fight window manager quirks: user explicitly rejected the separated workflow.

## Testing strategy / test cases
- Event log append: writes valid JSONL line and preserves permissions.
- Event log read: loads events, ignores malformed lines.
- Config mutations: skip/block updates are persisted and bounded.
- Chat mock: returns token stream and terminates with done.

## Progress tracking
- [x] Workfile created
- [x] Implement event log persistence (hooks + node helpers)
- [x] Implement TUI + embedded chat
- [x] Implement `deliberate pane`
- [x] Update hooks copy + config wording for TUI
- [x] Tests green (`npm test`)
- [ ] Manual WezTerm verification

## Questions / uncertainties
- Best default session filter: latest session vs all sessions. Start with “latest” and allow quick toggle.
- Pane width/percent default for wezterm split.
