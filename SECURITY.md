# Security Model & Limitations

This document explains what Deliberate does and does not protect against.

## What Deliberate does

Deliberate adds human review friction to agent actions:
- local rule-based pre-assessment for obvious risk patterns
- LLM explanations for command/file-change intent
- approval-focused UX with policy controls and audit trail

## What it helps with

### Accidental destructive actions
- recursive deletes
- force-history rewrites
- risky permission changes

### Obvious risky intent
- command patterns associated with destructive or credential-sensitive behavior
- risky workflow sequences across a session

### Cognitive load reduction
- plain-language explanation before approval
- persistent history for post-action review

## What it does not guarantee

### Novel or obfuscated attacks
Rule patterns are not complete. Attackers can use uncommon syntax, encoding, or multi-step choreography.

### LLM mistakes
Explanations can still be wrong, incomplete, or manipulated by context.

### Compromised dependencies
If runtime dependencies or providers are compromised, outputs may be untrustworthy.

### Time-of-check vs time-of-use
An environment can change after analysis and before execution.

## Trust model

You remain the final authority. Deliberate helps you make a better decision, it does not replace your judgment.

## Recommended operating posture

1. Keep approvals explicit for destructive commands.
2. Use narrow policy rules when adding always-allow patterns.
3. Review evidence and consequence previews, not only risk labels.
4. Keep regular backups outside Deliberate.
5. Combine with terminal/tool-level permission boundaries.

## Reporting security issues

If you find bypasses, misleading explanations, or policy edge cases that reduce safety, report them with a reproducible example.
