# Deliberate vs Claude Code Safety Net

This is a short, practical comparison for positioning and roadmap context. It is not a takedown. It clarifies the tradeoffs.

## High-level focus

Deliberate focuses on prevention plus recovery, with workflow-aware safety and automatic backups before destructive commands run. Safety Net focuses on prevention only, blocking destructive commands with strict parsing and bypass-resistant detection.

## Capabilities at a glance

| Area | Deliberate | Claude Code Safety Net |
|---|---|---|
| Core goal | Catch destructive commands and back up before execution | Catch destructive commands and block execution |
| Recovery | Automatic pre-destruction backups + file mappings | None (block-only) |
| Workflow awareness | Detects patterns like repo wipe, history rewrite, mass delete | Focused on command analysis and bypass resistance |
| Install UX | npm global + hook install | Marketplace + statusline + slash commands |
| Platforms | Claude Code (current), expanding next | Claude Code, OpenCode, Gemini CLI |
| Custom rules | Not yet | Yes, JSON rules with verification |
| Diagnostics | Basic | Doctor command, audit logs, statusline |

## Design philosophy

Deliberate assumes mistakes will happen and optimizes for recovery. Safety Net assumes prevention is enough and optimizes for blocking precision. Both are valid. Deliberate aims to be the seatbelt that saves you even when you crash, not just the guardrail that tries to prevent the crash.

## Where Deliberate is ahead

Deliberate already ships automatic backups with file mapping for restore, consequence visualization that shows what will be lost, and workflow context that reduces warning fatigue.

## Where Safety Net is ahead (today)

Safety Net has wider platform support, a more polished install UX, and more mature diagnostics and audit tooling.

## Near-term Deliberate roadmap (aligned with this gap)

The near-term roadmap should close the platform gap by adding OpenCode and Gemini CLI, then add diagnostics and statusline integration, and finally add custom rule config for teams.

## Positioning for marketing

If you need a simple line: Deliberate is the safety net plus recovery. It does not just stop destructive commands; it creates a backup so the mistake is reversible.
