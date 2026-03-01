# Bottom-pane friendly UX WORKFILE

One-line summary: make Deliberate pane less invasive by defaulting split placement to below Claude Code and supporting top/bottom/left/right directions.

## Problem statement and requirements
User feedback: current TUI is technically capable but feels invasive; explanation/review pane should appear below Claude Code instead of right side.

Requirements:
- Pane split supports bottom placement reliably in WezTerm and tmux.
- Default pane placement should be bottom for both `deliberate start` and `deliberate pane`.
- Existing direction overrides remain available.
- Onboarding/docs copy should align with new default behavior.

## Detailed implementation plan (checklist)
- [x] Extend pane direction handling in split launcher for top/bottom.
- [x] Update CLI direction defaults and help text.
- [x] Update UX copy in onboarding/readme.
- [x] Validate syntax/tests.
- [ ] Commit changes.

## System context
- `/Users/h4tch1ing/Documents/deliberate/src/pane.js`
- `/Users/h4tch1ing/Documents/deliberate/bin/cli.js`
- `/Users/h4tch1ing/Documents/deliberate/src/start.js`
- `/Users/h4tch1ing/Documents/deliberate/README.md`

## Security considerations
- No security boundary changes. Pane direction affects UX only.

## Testing strategy
- `node --check bin/cli.js src/pane.js src/start.js`
- `npm test`
- `deliberate pane --help` to verify direction options and default.

## Progress tracking
- [x] Workfile created
- [x] Implementation complete
- [x] Validation complete
- [ ] Commit complete
