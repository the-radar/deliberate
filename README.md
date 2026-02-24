# Deliberate

A review-first safety companion for AI coding agents.

## Why Deliberate

Agent prompts can move fast. The dangerous part is not always one command, it is a stream of commands you approve on autopilot. Deliberate is built to slow that moment down in a useful way.

The product value is clear and explicit:
- human review moments before execution
- plain-language explanations
- visible evidence and consequences
- durable audit trail in a terminal-native workflow

Security is the sidecar, not the product tax.

## What Deliberate does

For command execution and file changes, Deliberate:
- analyzes intent with lightweight local rules plus LLM explanation
- shows risk as SAFE, MODERATE, or DANGEROUS
- highlights workflow-level risk patterns across session history
- previews destructive consequences when possible
- stores timeline/audit events locally for later review

The experience is centered on approvals and explainability, not opaque model scoring.

## How it works

Deliberate uses a simple architecture:
1. Local rule pre-assessment for fast risk hints.
2. LLM-generated explanation for human-readable review context.
3. Workflow and consequence tracking for "what happens if I run this".
4. Policy controls (don’t flag, block pattern, always-allow pattern) with audit events.

## Installation

```bash
npm install -g deliberate
deliberate install
```

The installer configures:
- Claude Code hooks in `~/.claude/settings.json`
- OpenCode plugins in `~/.config/opencode/plugins/`
- Antigravity hooks in `~/.antigravity/hooks/`
- Gemini hooks in `~/.gemini/hooks/`
- Optional LLM provider setup for richer explanations

### Dependencies

- Node.js 18+
- Python 3.9+

## CLI

```bash
deliberate install          # Install hooks/plugins and configure LLM
deliberate start            # One-command startup (server + pane)
deliberate status           # Check installation state
deliberate serve            # Start local Deliberate server (events/chat/config)
deliberate pane             # Open Deliberate TUI in a split pane (WezTerm/tmux)
deliberate tui              # Run Deliberate TUI in current terminal
deliberate onboarding       # Replay first-run walkthrough tips
deliberate gui              # Launch optional desktop GUI
```

## Deliberate pane (TUI, recommended)

The TUI is designed for Claude Code/OpenCode side-pane workflows.

It reads local JSONL event logs (`~/.deliberate/events/`) so you keep history even if the pane starts late.

Typical workflow (recommended):

```bash
deliberate start
```

Manual equivalent:

```bash
deliberate serve
deliberate pane
```

If split-pane features are not available:

```bash
deliberate tui
```

## Review-first UX

The TUI opens in **review queue** mode by default so pending approvals stay front and center.

- `v` toggle review queue/history
- `d` discuss selected item in embedded chat
- `s` don’t flag exact command
- `b` block command pattern
- `w` guided always-allow policy flow
- `x` disable/enable Deliberate globally

## Scoped evidence lookups

For unknown commands/packages Deliberate gathers bounded evidence from:
- npm registry
- PyPI JSON API
- GitHub repository search
- GitLab project search
- local `node_modules/.bin` resolution when available

This evidence is shown in the pane and attached to approval context.

## Auto-open pane on SessionStart

When hooks are installed, Deliberate can auto-open one pane per Claude Code session and auto-start the local server:

```json
{
  "tui": { "autoPane": true, "autoStartServer": true }
}
```

## Policy model

Deliberate supports explicit always-allow patterns in:
`~/.deliberate/config.json` under `deliberate.autoApprove.patterns`.

Matching commands are still analyzed and logged. Deliberate only auto-applies the policy when the command is not currently assessed as dangerous.

If you need zero execution gating while keeping audit logs/explanations, enable record-only mode:

```json
{
  "deliberate": { "recordOnly": true }
}
```

## GUI note

The desktop GUI remains in-repo for future IDE/Antigravity harness workflows. For Claude Code/OpenCode, the TUI pane is the primary experience.

## Integrations

### OpenCode
- command safety hook behavior
- file change summaries

### Antigravity
- PreToolUse command analysis
- PostToolUse file-change summaries

### Gemini CLI
- pre-command analysis
- post-file-change summaries

## License

Copyright © 2026 The Radar. All rights reserved.
Source available for inspection and personal use.
