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

Three layers, each serving a purpose:

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
└─────────────────────────────────────────────────────────────┘
```

The AI agent can't explain away its own commands—the classifier runs independently.

## Installation

```bash
npm install -g deliberate
deliberate install
```

The installer walks you through LLM provider setup (Claude, Anthropic API, or Ollama).

### Dependencies

**Python 3.9+** with ML libraries:

```bash
pip install sentence-transformers scikit-learn numpy
```

The CmdCaliper embedding model (~419MB) downloads on first use.

## CLI

```bash
deliberate install          # Install hooks, configure LLM
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
- Claude Code (or any tool supporting Claude Code hooks)

Works on macOS, Linux, and Windows.

## Uninstall

```bash
deliberate uninstall
```

## Acknowledgments

Command embeddings by [CmdCaliper](https://huggingface.co/CyCraftAI/CmdCaliper-base) from CyCraft AI.

## License

Copyright © 2025 TheRadarTech LLC. All Rights Reserved.

This software is proprietary. See [LICENSE](LICENSE) for details.
