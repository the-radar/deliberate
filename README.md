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

The installer sets up Claude Code hooks and the OpenCode plugin, then walks you through LLM provider setup (Claude, Anthropic API, or Ollama). If OpenCode is installed, it registers two `file://` plugins (commands + changes) in `~/.config/opencode/opencode.json`.

### Dependencies

**Python 3.9+** with ML libraries:

```bash
pip install sentence-transformers scikit-learn numpy
```

The CmdCaliper embedding model (~419MB) downloads on first use.

## CLI

```bash
deliberate install          # Install Claude Code hooks + OpenCode plugin, configure LLM
deliberate status           # Check installation
deliberate classify "rm -rf /"   # Test classification → DANGEROUS
deliberate serve            # Start classifier server (faster)
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

## OpenCode

OpenCode support is installed by `deliberate install`. It registers two plugins in `~/.config/opencode/opencode.json`:

- `file://~/.config/opencode/plugins/deliberate.js` (command safety)
- `file://~/.config/opencode/plugins/deliberate-changes.js` (edit/change summaries)

After install, restart OpenCode to load the plugins. For edit/change summaries, OpenCode must be configured to allow edit tools (write/edit/patch/multiedit) so the plugin can read tool metadata. The plugins call the same Deliberate hook scripts, so LLM explanations behave the same as Claude Code.

## Uninstall

```bash
deliberate uninstall
```

## Acknowledgments

Command embeddings by [CmdCaliper](https://huggingface.co/CyCraftAI/CmdCaliper-base) from CyCraft AI.

## License

MIT License - see [LICENSE](LICENSE) for details.
