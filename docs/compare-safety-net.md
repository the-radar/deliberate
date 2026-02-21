# Deliberate vs Claude Code Safety Net

This is a short, practical comparison for positioning and roadmap context. It is not a takedown. It clarifies the tradeoffs.

## High-level focus

Deliberate focuses on review UX and explainability, with security as a sidecar. Safety Net focuses on strict prevention and blocking behavior.

## Capabilities at a glance

| Area | Deliberate | Claude Code Safety Net |
|---|---|---|
| Core goal | Clear human review moments and explanations before approval | Block unsafe commands aggressively |
| Interaction model | Explain + ask + record decision | Evaluate + block/allow |
| Recovery posture | Supports consequence visibility and review history | Primarily prevention-focused |
| Workflow awareness | Session-level context and review timeline | Command-level protection emphasis |
| Install UX | npm global + hook install + TUI pane | Marketplace + statusline + slash commands |
| Platforms | Claude Code, OpenCode, Antigravity, Gemini CLI | Claude Code ecosystem |
| Policy controls | Skip/block/always-allow patterns with audit trail | Rule-centric blocking policy |
| Diagnostics | Session timeline + event log | Doctor command, statusline, audits |

## Design philosophy

Deliberate assumes developers need confidence and context while keeping flow. Safety Net assumes stronger prevention defaults. Both are useful for different teams.

## Where Deliberate is ahead

Deliberate emphasizes explainability in-session, explicit approval UX, and a decision paper trail that is easy to review later.

## Where Safety Net is ahead (today)

Safety Net has mature prevention ergonomics and polished built-in Claude Code integration.

## Near-term Deliberate roadmap (aligned with this gap)

The near-term roadmap is to deepen review UX, improve policy interview flows, and tighten team oversight views across many sessions.

## Positioning for marketing

If you need a simple line: Deliberate helps you approve agent actions with confidence through clear explanations, explicit decisions, and a durable audit trail.
