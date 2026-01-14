# Case Study: How We Accidentally Wiped Our Own Codebase (And What We Built To Prevent It)

## The Incident

On January 10th, 2025, we were restructuring the Deliberate repository. The goal was simple: move the `packages/claude-code` subdirectory to the repo root so users could install directly from GitHub.

What happened instead: we deleted the entire original Deliberate codebase—months of work on the TypeScript CLI, AI analysis layer, and core classification system—and force-pushed that deletion to GitHub.

The irony? **Deliberate was running the whole time.** It analyzed every command. It flagged them as DANGEROUS. And we ran them anyway.

## What Went Wrong

### The Commands (as Deliberate saw them)

```
1. rm -rf /tmp/deliberate-new/node_modules /tmp/deliberate-new/.cache /tmp/deliberate-new/models
   → DANGEROUS: "Safe cleanup targeting temp subdirectories"

2. cp -r packages/claude-code/* /tmp/deliberate-new/
   → SAFE: "Copying files to staging directory"

3. git rm -rf .
   → DANGEROUS: "Removing all files from git tracking"

4. cp -r /tmp/deliberate-new/* .
   → SAFE: "Copying files back"

5. git push --force
   → DANGEROUS: "Force push rewrites history"
```

### The Problem: Isolated Analysis

Each command was analyzed in isolation. Each analysis was technically correct. But the **sequence** told a different story:

> "Copy only ONE package to temp. Delete EVERYTHING from repo. Copy back only that one package. Force push to make it permanent."

Deliberate couldn't see this because it had no memory of previous commands. It couldn't connect the dots.

### The Human Factor

The user (one of our developers) was shown DANGEROUS warnings. They said "Yeah" and continued. Why?

1. **Warning fatigue**: After seeing several DANGEROUS flags with reasonable explanations, the warnings lost impact
2. **Trust in the AI's reasoning**: The explanations sounded rational ("just temp cleanup", "user-initiated restructure")
3. **No visualization of consequences**: At no point did we see "You are about to permanently delete: src/ai/, src/core/, src/cli/, bin/deliberate..."

## The Recovery

We discovered we could reconstruct the lost code from Claude Code's conversation logs. The session files in `~/.claude/projects/` contained every file read and written, preserved in JSON format.

But this was luck, not design. If we hadn't known to look there, or if the logs had been cleared, the code would be gone forever.

## What We Built: Deliberate v2

### 1. Session Command History

Deliberate now maintains a rolling history of commands within each session:

```python
SESSION_HISTORY = {
    "commands": [...],
    "cumulative_risk": "HIGH",
    "files_at_risk": ["src/ai/*", "src/core/*", ...],
    "pattern_detected": "REPOSITORY_RESTRUCTURE"
}
```

### 2. Workflow Pattern Detection

We identify dangerous sequences, not just dangerous commands:

| Pattern | Commands | Risk |
|---------|----------|------|
| REPO_WIPE | rm + git rm + force push | CRITICAL |
| MASS_DELETE | 3+ rm commands in sequence | HIGH |
| HISTORY_REWRITE | reset --hard + force push | CRITICAL |
| UNCOMMITTED_RISK | heavy edits + destructive op | HIGH |

### 3. Consequence Visualization

Before any destructive operation, you now see exactly what will be affected:

```
⚠️  DESTRUCTIVE OPERATION DETECTED

This command sequence will permanently delete:
  - src/ai/deliberate-ai.ts (196 lines)
  - src/ai/localai-client.ts (158 lines)
  - src/core/classification/classifier.ts (412 lines)
  - ... and 14 more files

Total: 2,847 lines of code will be permanently removed.

No backup detected. Create one now? [Y/n]
```

### 4. Automatic Pre-Destruction Backups

Before any CRITICAL operation, Deliberate automatically snapshots:
- Current git state (branch, uncommitted changes)
- Files that will be affected
- Session command history (for context)

Stored in `~/.deliberate/backups/<project>/<timestamp>/`

### 5. Recovery Skill

When prevention fails, recovery matters. Deliberate includes a `/recover-code` skill that:
- Searches Deliberate's automatic backups first
- Falls back to Claude Code conversation logs
- Provides extraction scripts and step-by-step guidance
- Documents the exact file paths and formats needed

The skill is built on our hard-won knowledge: project-specific conversation directories often only contain hook outputs, while the actual development work lives in the parent directory session files.

## Lessons Learned

1. **Context matters more than classification**: A "safe" command in a dangerous sequence is still dangerous
2. **Warnings without consequences are ignored**: Show WHAT will be lost, not just THAT something is risky
3. **Backups aren't optional**: Especially for AI-assisted development where mistakes happen fast
4. **The conversation IS the backup**: Every file read/written is logged—if you know where to look

## The Irony

We built Deliberate to prevent AI coding assistants from making catastrophic mistakes. Then we made a catastrophic mistake while building it, with Deliberate running.

That's how we knew it wasn't good enough. Now it is.

---

*This case study is part of Deliberate's documentation. The incident described is real. The code was recovered. The lessons were learned.*
