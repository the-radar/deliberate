# Work File: local state and hook path migration
Summary: Move project continuity tracking to CLAUDE.local.md and update local Claude hooks/messages to stop referencing CONTINUITY.md.

## Problem statement and requirements
- User confirmed there is an active v2 plan and wants local project memory updated.
- User wants cleanup for hook/config references that still mention CONTINUITY.md.
- User specifically called out ~/.claude/settings.json.

## Detailed implementation plan with subtasks
- [x] Verify current project state and active v2 plan source.
- [x] Update /Users/bobola/Documents/deliberate/CLAUDE.local.md to current v2-focused state.
- [x] Confirm whether CONTINUITY.md still exists in project root.
- [x] Update ~/.claude/settings.json SessionStart hook string from CONTINUITY.md to CLAUDE.local.md.
- [x] Update ~/.claude/hooks scripts/messages that still instruct CONTINUITY.md.
- [x] Verify replacements with ripgrep.

## System context
- /Users/bobola/Documents/deliberate/CLAUDE.local.md
- /Users/bobola/.claude/settings.json
- /Users/bobola/.claude/hooks/session_briefing.sh
- /Users/bobola/.claude/hooks/context-monitor.py
- /Users/bobola/.claude/hooks/context-monitor-opencode.py

## Directory structure
- Project root: /Users/bobola/Documents/deliberate
- User Claude config: /Users/bobola/.claude

## Pseudocode
- scan files for "CONTINUITY.md"
- replace with "CLAUDE.local.md" in targeted hook/config files
- re-scan to verify no stale references remain in those hook/config files

## Security considerations
- Do not print secrets from ~/.claude/.credentials.json or env files.
- Only touch known config/hook files; avoid broad destructive edits.

## Alternative approaches considered
- Keep CONTINUITY.md references for backward compatibility: rejected, user requested direct migration.
- Add dual lookup (CLAUDE.local.md then CONTINUITY.md): rejected for now to keep behavior explicit.

## Research findings and reference code
- Active v2 plan source found: /Users/bobola/.claude/plans/mossy-meandering-hoare.md
- Current stale reference confirmed in ~/.claude/settings.json SessionStart command.

## Design decisions and rationale
- Use CLAUDE.local.md as the single canonical project memory path.
- Update user-facing hook guidance text so workflow instructions are consistent.

## Testing strategy and test cases
- rg for CONTINUITY.md in touched files returns no matches.
- Confirm settings.json contains CLAUDE.local.md in SessionStart command.

## Progress tracking
- [x] Investigate and locate stale references
- [x] Prepare project local state update
- [x] Apply ~/.claude hook/config changes
- [x] Validate changes

## Questions and uncertainties
- Whether user wants legacy references removed globally from all historical docs or only active hooks/config.
