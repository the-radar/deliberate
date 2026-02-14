# Web search + review-first UX WORKFILE

## Problem statement and requirements
Deliberate’s core target user is a nervous user who wants explicit approvals, plain-English explanations, and a paper trail. The current TUI reads like an operator dashboard and Deliberate currently tells the LLM to “use WebSearch” even though no actual web search evidence is gathered. This breaks trust.

We need a real “web search” capability, but tightly scoped for safety workflows:
- Prefer structured sources (npm registry, PyPI JSON API, GitHub repo search).
- No general page fetching or arbitrary browsing.
- Produce evidence (name, description, homepage/repo URL, version) that can be shown to the user.
- Use evidence in the explanation and in the “always allow” interview flow.

Success looks like: when Deliberate doesn’t recognize a command or package (ex: `browser-use`), it shows the user what it found and asks the right follow-up questions before they approve. It also preserves an audit trail.

## Constraints/assumptions
- Hooks must be fast and fail-open. Any web lookup must have short timeouts and never block Claude Code for long.
- Never print or log secrets.
- Network may be restricted in some environments. Treat “no network” as a normal state, and say so.
- Do not grant WebFetch-like capabilities. Limit to registry/search endpoints only.

## Implementation plan (checklist)
- [ ] Add config toggle for web lookup (default enabled): `deliberate.webSearch.enabled`.
- [ ] Implement best-effort “web search” in the Bash PreToolUse hook:
  - [x] Detect likely package/binary names from the command (`npx`, `pnpm dlx`, bare binary).
  - [x] Query npm registry: `https://registry.npmjs.org/<name>` (timeout, cap response).
  - [x] Query PyPI: `https://pypi.org/pypi/<name>/json` (timeout).
  - [x] Query GitHub repo search: `https://api.github.com/search/repositories?q=<name>&per_page=3` (timeout).
  - [x] Query GitLab project search: `https://gitlab.com/api/v4/projects?search=<name>` (timeout).
  - [x] Convert results into a compact evidence block with URLs.
  - [x] Cache per-session per-name lookups to avoid repeated network calls.
- [ ] Feed evidence into the LLM explanation prompt and include citations/URLs in user-facing explanation (pane/TUI).
- [x] Feed evidence into the LLM explanation prompt and include citations/URLs in user-facing explanation (pane/TUI).
- [x] Add incremental analysis progress events and coalesced in-place updates in TUI.
- [ ] Add “review-first” UX scaffolding:
  - [x] Add/confirm “pending approvals” view to the TUI (separate from history).
  - [x] Add a place to show evidence and the approval interview transcript.
- [ ] Tests:
  - [ ] Unit test: parsing package names from commands.
  - [ ] Unit test: web lookup functions with mocked HTTP responses.

## System context (relevant files)
- Hooks:
  - `/Users/bobola/Documents/deliberate/hooks/deliberate-commands.py`
  - `/Users/bobola/Documents/deliberate/hooks/deliberate-commands-post.py`
  - `/Users/bobola/Documents/deliberate/hooks/deliberate-changes.py`
- TUI:
  - `/Users/bobola/Documents/deliberate/src/tui/index.js`
- Config:
  - `/Users/bobola/Documents/deliberate/src/config.js`

## Security considerations
- Only call known endpoints (registry + GitHub search). No arbitrary URL fetching.
- Enforce timeouts and maximum bytes to avoid hanging hooks or memory blowups.
- Evidence may include sensitive command context. Never include full env, tokens, or expanded file contents.

## Testing strategy
- Mock urllib requests in Python unit tests (or isolate lookup logic into a module and test separately).
- Ensure hooks still complete when network is blocked or endpoints are down.

## Progress tracking
- Implemented scoped web lookup, evidence surfacing, per-session cache, and review-first TUI queue with guided always-allow policy flow.
