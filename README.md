# Deliberate

A safety layer for AI coding agents.

## The Problem

AI agents have access to your shell. They can run any command. Delete files. Exfiltrate credentials. Open reverse shells. The only guardrail: a yes/no prompt you'll inevitably approve on autopilot.

## The Solution

Deliberate forces you to be deliberate. Every command gets classified and explained before execution:

```
[Bash] rm -rf node_modules
🚨 [DANGEROUS] Recursively deletes the node_modules directory and all contents.
> Allow? [y/n]
```

The analysis persists after execution—no more vanishing prompts:

```
🚨 DELIBERATE [DANGEROUS]
    Recursively deletes the node_modules directory and all contents.
```

Three risk levels:
- ✅ **SAFE** — Read-only, no system changes
- ⚡ **MODERATE** — Modifies files or services, reversible
- 🚨 **DANGEROUS** — Destructive, credential access, network exfiltration

Every command shows its analysis. You decide with context, not blind trust.

## How It Works

Four layers, each serving a purpose:

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Pattern Matcher                                   │
│           Regex rules. Deterministic. Can't be bypassed     │
│           by prompt injection.                              │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: ML Classifier                                     │
│           Semantic embeddings via CmdCaliper. Trained on    │
│           712 labeled commands. Catches novel attacks.      │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: LLM Explainer                                     │
│           Human-readable explanations. Uses your            │
│           configured provider (Claude, Ollama, etc).        │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Catch-All Backup                                  │
│           Automatic backup before ANY destructive command.  │
│           Files recoverable even if you approve by mistake. │
└─────────────────────────────────────────────────────────────┘
```

The AI agent can't explain away its own commands—the classifier runs independently.

## Workflow Detection

Individual commands can look safe while the sequence is catastrophic. Deliberate tracks command history within sessions and detects dangerous patterns:

| Pattern | What It Detects |
|---------|-----------------|
| REPO_WIPE | rm + git rm + force push |
| MASS_DELETE | 3+ rm commands in sequence |
| HISTORY_REWRITE | git reset --hard + force push |
| TEMP_SWAP | copy to temp, delete original, copy back |

When a pattern is detected, you see the full context—not just the current command.

## Consequence Visualization

Before destructive commands run, you see exactly what will be affected:

```
⚠️  WILL DELETE: 17 files, 2 directories (2,847 lines of code) [156.3 KB]
    Files:
      - src/ai/deliberate-ai.ts
      - src/core/classification/classifier.ts
      - src/cli/commands.ts
      ... and 14 more
```

Supported commands:
- `rm` / `git rm` — shows files and line counts
- `git reset --hard` — shows uncommitted changes that will be discarded
- `git clean` — shows untracked files that will be deleted
- `git checkout --` — shows modified files that will revert
- `git stash drop` — shows stash contents that will be lost

## Automatic Backups

Every destructive command triggers an automatic backup before execution:

```
~/.deliberate/backups/
  └── my-project/
      └── 20250114_120000/
          ├── metadata.json    # Command, paths, restore info
          ├── files/           # Backed up files (original structure)
          └── git_state/       # Branch, commit, uncommitted diff
```

Files are recoverable even if you approve a destructive command by mistake. The `metadata.json` includes file mappings for exact restore to original locations.

## Installation

```bash
npm install -g deliberate
deliberate install
```

The installer configures:
- **Claude Code:** Adds hooks to `~/.claude/settings.json`.
- **OpenCode:** Installs plugins to `~/.config/opencode/plugins/` and registers them in `~/.config/opencode/opencode.json`.
- **Antigravity:** Adds hooks to `~/.antigravity/hooks/` and updates `settings.json`.
- **Gemini:** Adds hooks to `~/.gemini/hooks/` and updates `settings.json`.
- **LLM:** Sets up your provider (Claude, Anthropic API, or Ollama) for explanations.

### Dependencies

**Python 3.9+** is required. The installer auto-installs `sentence-transformers`, `scikit-learn`, and `numpy`. The CmdCaliper embedding model (~419MB) downloads on first use.

## CLI

```bash
deliberate install          # Install Claude Code hooks + OpenCode plugin, configure LLM
deliberate status           # Check installation
deliberate classify "rm -rf /"   # Test classification → DANGEROUS
deliberate serve            # Start classifier server (faster)
deliberate pane             # Open Deliberate TUI in a split pane (WezTerm/tmux)
deliberate tui              # Run Deliberate TUI in the current terminal
deliberate gui              # Launch the desktop GUI (optional, for IDE harness work)
```

## Deliberate pane (TUI, recommended for Claude Code/OpenCode)

Deliberate v2 is moving toward a terminal-native workflow. The TUI is designed to live in a side pane while your agent session runs on the left.

It reads a local JSONL event log written by the hooks, so you still get history even if you start the pane after a session begins.

In one terminal:

```bash
deliberate serve
```

Then open the pane:

```bash
deliberate pane
```

If you are not in a supported terminal pane manager, you can still run it in the current terminal:

```bash
deliberate tui
```

To reduce terminal noise, set `gui.terminalExplanations` in `~/.deliberate/config.json` to `"minimal"` (or `"gui"`). The hooks will keep the permission gate visible, but point you to the pane for details.

Embedded chat works in the TUI. If you do not have keys configured, chat replies in mock mode.

### Auto-open pane on Claude Code SessionStart

If you install Deliberate hooks, a Deliberate pane can auto-open at Claude Code session start (one pane per session) and auto-start the local server. This is controlled by:

```json
{
  "tui": { "autoPane": true, "autoStartServer": true }
}
```

## Deliberate GUI (Desktop, optional)

The desktop GUI is a Tauri app that shows hook output in a floating window. It is kept for future IDE/Antigravity harnesses and is not the recommended UX for Claude Code/OpenCode.

From the repo checkout:

```bash
npm run gui:install
npm run gui:build
deliberate gui
```

If macOS blocks the app the first time you run it, the usual workaround is:

```bash
xattr -cr /path/to/Deliberate.app
```

## Training

The classifier ships with 481 labeled examples: reverse shells, credential theft, cloud operations, container escapes, privilege escalation, and safe workflows.

### Add Your Own

```bash
# Add to training/expanded-command-safety.jsonl
{"command": "...", "label": "DANGEROUS", "category": "..."}

# Retrain
python training/build_classifier.py --model base
```

### Active Learning

Uncertain classifications get logged. Review and approve them:

```bash
python training/approve_cases.py   # Review pending
python training/build_classifier.py --model base  # Retrain
```

## Requirements

- Node.js 18+
- Python 3.9+
- Claude Code or OpenCode 1.0+

Works on macOS, Linux, and Windows.

## OpenCode Support

Deliberate integrates with OpenCode via two plugins (installed automatically):
- **Command Safety:** Intercepts `bash` commands like `rm`, `git reset`, `docker rm`.
- **Change Summaries:** Summarizes file modifications from `write`, `edit`, `patch`, and `multiedit` tools.

Unlike standard plugins, these reuse the same Python analysis engine as Claude Code, ensuring consistent safety rules and explanations across platforms.

**Note:** You must restart OpenCode after `deliberate install`.

## Antigravity Support

Deliberate integrates with Antigravity via shell hooks (installed automatically):
- **PreToolUse:** Intercepts `Bash` tool usage to analyze commands.
- **PostToolUse:** Logs file changes from `Write`/`Edit` tools.

Hooks are installed to `~/.antigravity/hooks/` and enabled in `~/.antigravity/settings.json`.

## Gemini Support

Deliberate integrates with Gemini CLI via shell hooks (installed automatically):
- **pre-command:** Intercepts shell commands.
- **post-file-change:** Logs file modifications.

Hooks are installed to `~/.gemini/hooks/` and enabled in `~/.gemini/settings.json`.

## Uninstall

```bash
deliberate uninstall
```

Removes all hooks, plugins, and configuration.

## Acknowledgments

Command embeddings by [CmdCaliper](https://huggingface.co/CyCraftAI/CmdCaliper-base) from CyCraft AI.

## License

Copyright © 2026 The Radar. All rights reserved.
Source available for inspection and personal use.
