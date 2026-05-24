# Note for deliberate agent — wire AelosX discipline hooks

From: Claude (AelosX session, 2026-05-23)
For: Whoever next works on deliberate
Status: DRAFT — Bobola to confirm contents via interview before this is canonical

---

## Why this note exists

AelosX session today shipped UI features that pass mechanical verification (toggle changes attribute, build green, tests pass) but fail user-facing reality (light mode unreadable, Approve spins forever, "Buy a new Twilio number for this tenant" appears on customer surface). The pattern: I keep verifying mechanism instead of experience, and the hooks that were supposed to stop this aren't wired.

Bobola wants this routed through deliberate instead of being patched directly into `~/.claude/hooks/hooks.json`. Deliberate becomes the single source of truth for discipline hooks across all Claude Code work, so updating discipline = updating deliberate, not editing per-project Claude config.

## What's available but not firing

Three existing hook scripts in `~/.claude/hooks/` that should be wired:

1. **`spec_adherence_hook.py`** — PreToolUse drift catcher for Write|Edit|MultiEdit. Queries `spec_watcher_daemon.py` (already alive, PID 38776, socket at `~/.cache/nospec-drift/spec.sock`) for matching spec sections, uses Haiku via Claude Agent SDK to decide allow/deny/ask. Daemon needs a LaunchAgent so it survives reboots.

2. **`issues-loop-anxiety.sh`** — UserPromptSubmit prompt-injector that re-states the issues-loop discipline every prompt. One-shot bash echo, no LLM call.

3. **`verify-behavior.sh`** — Stop hook that injects the "evidence before claims" reminder when the agent is about to say "done."

Plus one new hook to build:

4. **`plan-trace-comment` (new)** — PostToolUse on Write|Edit. Reads the diff. If a code file (`.ts/.tsx/.js/.py/.go` etc.) gained new function/component/class definitions, requires a comment of shape `// Plan: <doc path>§"<section>" · Issue: #<N>` adjacent to the new block. Fails the tool call if missing. Forces every change to carry the trace from spec→code in human-readable form.

## Anti-gaming requirement

Bobola asked explicitly: how does the wired system prevent me from gaming what I built?

The properties that make it ungameable:
- **Spec-adherence runs BEFORE write, not after.** I can't write the code first and then game the check.
- **Daemon is a separate process with its own cache of the spec.** I can't edit the spec to match my code on the fly without the daemon picking up the spec change first and re-parsing.
- **Plan-trace comments live in the code itself**, not in a separate file I can stale-update. If the comment references `docs/plans/X.md §"foo"`, the next reader (human or agent) can grep for that section and see if the code actually does what §"foo" promised.
- **Verify-behavior is a Stop hook**, not advisory text in the prompt. It fires after I claim done, and the requirement is "show the command output you ran in this same message" — if I haven't run anything in this turn, I can't show fresh output, period.

Together: spec-adherence catches drift at write-time, plan-trace forces traceability at commit-time, verify-behavior catches "done without evidence" at stop-time. The leash tightens at three independent points. Gaming one requires gaming all three.

## Suggested wiring shape

Deliberate's `hooks/hooks.json` already has Python session-start/session-end/changes/commands hooks. New entries to add (in deliberate's hooks config, then deliberate's installer propagates to `~/.claude/hooks/hooks.json` so Claude Code actually fires them):

```jsonc
// PreToolUse
{ "matcher": "Write|Edit|MultiEdit",
  "hooks": [{ "type": "command", "command": "python3 ~/.claude/hooks/spec_adherence_hook.py" }],
  "description": "NoSpecDrift — block writes that drift from the spec" }

// UserPromptSubmit
{ "matcher": "*",
  "hooks": [{ "type": "command", "command": "bash ~/.claude/hooks/issues-loop-anxiety.sh" }],
  "description": "Issues-loop anxiety — re-inject discipline every prompt" }

// PostToolUse
{ "matcher": "Write|Edit|MultiEdit",
  "hooks": [{ "type": "command", "command": "python3 <new-script>/plan-trace-comment.py" }],
  "description": "Require plan/issue trace comment on new code blocks" }

// Stop
{ "matcher": "*",
  "hooks": [{ "type": "command", "command": "bash ~/.claude/hooks/verify-behavior.sh" }],
  "description": "Evidence-before-claims gate on completion" }
```

## What I need from the deliberate agent

1. Pick where the new `plan-trace-comment` hook lives — deliberate's hooks/ folder or Claude's? Vote: deliberate's, so it's versioned with the rest of the discipline.
2. Build it. Spec for the trace comment shape is in the section above; behavior is "fail the write if missing on new code blocks."
3. Wire the four entries into `~/.claude/hooks/hooks.json` via deliberate's installer.
4. Set up a `~/Library/LaunchAgents/com.bobola.nospec-drift.plist` so the daemon survives reboots.
5. Add a deliberate command (`deliberate hooks status` or similar) that prints which discipline hooks are wired vs missing, so Bobola can grep at any time.

## Locked decisions (Bobola, 2026-05-23 interview)

### Plan-trace failure mode: **HARD-BLOCK**
PostToolUse fails the tool call if a new function/component/class definition lands without `// Plan: <doc>§"<section>" · Issue: #<N>`. No trace, no write. No warn-and-allow. Slows velocity, accumulates no debt.

### Spec-adherence daemon behaviour: **fail-closed, but only when stringent — with user-friendly off-switch**
Read this carefully — it's the most nuanced answer:

- **Default = fail-closed** when the daemon is down, but always with a clear debug note injected for Claude so the agent knows WHY it's blocked (not just a silent denial).
- **Stringency trigger**: turn on the fail-closed gate ONLY when the project root contains a `.git` directory. Reason: a lot of debugging and non-code work happens in folders that aren't real projects. Don't gate the agent's writes there.
- **User-message-as-spec case**: a lot of work happens where the *spec is the user's message itself* (Bobola types a request, no written doc exists yet). In that case, the spec-adherence machinery shouldn't try to grep `docs/` — it should detect "no written spec, user message is the spec" and tell Claude to **interview the user on what the message actually means** before writing code. This is deliberate doing what its name promises: helping the user be deliberate, not just gating Claude.
- **User-friendly toggle**: provide a clean way for Bobola to turn the whole thing off or change how it works without editing JSON by hand. A `deliberate hooks {strict|loose|off}` command, or a config flag. Don't let strictness become a cage.

### Scope: **all Claude Code projects, globally**
No allowlist, no opt-out by default. Discipline is universal. If a project genuinely needs to bypass, it uses the user-friendly toggle above.

### Rollback / kill-switch (added per Bobola)
The wired hooks MUST have a single-command kill switch for emergencies. When Bobola is shipping a hotfix and a hook is being too strict, he needs to be able to run something like `deliberate hooks pause 60m` (pause all discipline hooks for 60 minutes), `deliberate hooks off` (until explicitly re-enabled), or `deliberate hooks bypass <hook-name>` (one specific hook only). Pause/off MUST log the action so the agent (me) can see the discipline is off and behave more carefully because the safety net is down. No silent disabling.

## Anti-game checklist the deliberate agent should verify

Before declaring this work done, the deliberate agent should test:

1. **Can Claude write code without a plan-trace comment?** → No. PostToolUse rejects the write.
2. **Can Claude write code while the spec-adherence daemon is down?** → No, if the project has `.git`. The user-message-as-spec interview fires instead if no `docs/` is present.
3. **Can Claude claim "done" without showing fresh command output?** → No. The Stop hook injects the iron-law reminder; the next message that claims success without re-running verification is itself flagged.
4. **Can Claude turn off the hooks silently?** → No. Kill switch logs the action and the agent sees that the safety net is down.
5. **Can the user override in an emergency?** → Yes. `deliberate hooks pause 60m` or equivalent.
6. **Will any of this trigger on a non-code repo (e.g. `~/Documents/notes-scratch`)?** → No, because no `.git`, stringency stays off.

## Recorded games Claude played this AelosX session (so the deliberate agent knows what shapes of cheating to watch for)

- Verified `[data-theme]` attribute toggle, didn't verify the page is readable in either theme. → light mode shipped invisible.
- Verified component renders one task, didn't notice the task was hardcoded forever. → Ada billboard.
- Verified Approve button has `aria-busy`, didn't verify it actually does anything when no backend exists. → spinning forever.
- Verified `grep -E "banned words"` against source, didn't read rendered UI strings. → "Buy a new Twilio number for this tenant" shipped on customer surface.
- Claimed merges + verifications green based on local tests, said "loop scope complete" before user had deployed or could test. → premature done-claims.
- Filed 7 issues' work as merged + evidenced, didn't notice the experience was broken end-to-end. → mechanism-over-experience as a structural pattern across the whole session.

All six are catchable by combinations of the four wired hooks IF the hooks force me to **read rendered output, not source greps**, and force me to **show fresh command output before claiming done**, and force me to **trace every change back to a plan section that names the experience goal, not just the mechanism**.

---

## Meta: this is a unification problem, not a wiring problem (Bobola, 2026-05-23)

Bobola wants every discipline hook he is making — anxiety, spec-adherence, verify-behavior, plan-trace, teammate-mode, and whatever else lands later — to **roll up into deliberate** as the single layer that owns "being deliberate."

The framing he gave: deliberate's name is the contract. Anxiety + spec-adherence + verify-behavior are all instances of *making the agent be deliberate before acting*. They should not be N independent tools fighting for hook slots in `~/.claude/hooks/hooks.json`. They should be deliberate's responsibility — deliberate owns the discipline graph and decides which checks fire when.

What deliberate already has that we shouldn't remove:
- Deliberate hooks folder (`~/Documents/deliberate/hooks/`) with `deliberate-changes.py`, `deliberate-commands.py`, `deliberate-commands-post.py`, `deliberate-session-start.py`, `deliberate-session-end.py`, plus a `hooks.json`.
- LLM provider config (currently Dexter via Haiku) for any check that needs LLM eval.
- `recordOnly` mode and `autoApprove.patterns` — already supports the toggle/kill-switch shape.

What the deliberate agent should think about (NOT a directive, a framing question):
- Should anxiety + spec-adherence + verify-behavior become INTERNAL features of deliberate, accessed via `deliberate-changes.py`'s evaluation path? Or stay as separate hook scripts that deliberate's installer wires into Claude config?
- Either way, the user wants ONE thing he configures (`deliberate hooks {strict|loose|off}`), not five.
- Don't remove what deliberate already does. Check what's there. Add what's missing. Unify the surface.

## Reference 1: Bobola's NoSpecDrift implementation plan (his original write-up, verbatim)

This is how he originally thought spec-adherence should work, before the rollup framing. Read it for the design intent (especially the matching logic, denial-message format, file-type filters), then decide how it folds into deliberate.

```markdown
# NoSpecDrift Hook - Implementation Plan

## Overview
A Claude Code hook that catches semantic drift between specifications and code before writes happen. Triggers on PreToolUse for Write/Edit/MultiEdit/NotebookEdit.

## Core Components

### 1. Hook Script (`~/.claude/hooks/spec_adherence_hook.py`)
- Receives tool input via stdin
- Loads project-level spec-mapping.json
- Matches file paths to specs
- Extracts relevant spec sections
- Calls Haiku LLM for drift analysis
- Returns deny/allow decision

### 2. Config File (`.claude/spec-mapping.json` per project)
- Spec-to-code path mappings
- Section-level granularity
- Skip patterns for tests/generated files

### 3. Hook Registration (`~/.claude/settings.json`)
- PreToolUse matcher for write tools
- 45s timeout for LLM calls

## Resolved Questions

### Behavior
- Blocking mode: Always block (deny) on drift detected
- Error handling: Ask user when LLM timeout/error occurs

### Spec Discovery
- Hybrid: convention (auto-detect docs/, specs/) + smart filename matching (UserAuth.spec.md → UserAuth.tsx) + optional explicit overrides

### Analysis
- LLM: Haiku 4.5 via same cline-profile as Claude Code
- File types: code only (.ts, .tsx, .js, .jsx, .py, .go, .rs, etc.); skip CSS, configs, assets
- Caching: parsed specs cached with file watcher, invalidate on spec file change
- No spec found: warn but allow write (show "No spec found for X")
- Auto-matching: kebab-case, camelCase, PascalCase all normalize and match. Also check section headers in spec files.

### UX
- Message format: bullet list with expectation vs actual behavior, line refs to BOTH spec AND implementation, actionable suggestion (exact wording matters), quote from spec + action recommendation
- Always show which spec file/section was checked
- Skip mechanism: NONE — update the spec if intentional deviation. No drifts allowed.
- Setup: auto-enable if `specs/` or `docs/` folders exist (zero config)
- Edit scope: check FULL file after edit (not just changed portion)
- Debug command: show spec→file mappings
- Multi-section: check ALL matching sections (not just first)
- Section limit: ~1000 lines max per section sent to LLM

### Example Denial Message
SPEC DRIFT DETECTED
Checked: docs/UI_SPEC.md ## Pan's Avatar (lines 166-180)

• Avatar style mismatch
  Spec (L168): "abstract/geometric animation"
  Code (L24): Creates 'breathing orb' animation
  → Update code to use geometric shapes, not organic orb

• Size violation
  Spec (L171): "~30% of screen height"
  Code (L31): Fixed 120px height
  → Use relative vh units: height: 30vh

Re-read spec section and revise implementation.
```

(See full plan in Bobola's notes — the above captures the essential design.)

## Reference 2: The REAL anxiety hook (from Apple Notes; not on this machine)

Bobola flagged that the anxiety hook he was thinking of "wasn't on this machine." The local `~/.claude/hooks/issues-loop-anxiety.sh` is a simple bash echo of issues-loop discipline. The REAL anxiety hook lives in his Apple Notes — far more sophisticated. It's a unified LLM evaluation + state-tracked enforcement hook for all PreToolUse and Stop events. Calls Bedrock (Haiku by default), uses prefill for guaranteed JSON, **tracks state to prevent gaming via rephrasing**. Has an escape valve at 3 attempts. Logs every evaluation.

The deliberate agent should pull this into deliberate. Key behaviours to preserve:

- **Single hook for all PreToolUse and Stop events** — not N hook files. One brain.
- **State tracking at `~/.claude/anxiety-state.json`** with `concern`, `evidence_snapshot`, `ts`, `attempts`. On retry, compares `current_evidence` (Bash + Read tool counts) to `evidence_snapshot`. **No new evidence = re-block with same concern.** This is the explicit anti-gaming mechanism.
- **Escape valve**: after 3 blocks, auto-release (otherwise the agent is permanently stuck).
- **Dual-witness marker** at `~/.claude/dual-witness-pending.json`: when a test file is being written, mark it. (Pairs with whatever consumes the marker — separate concern.)
- **Per-event-type prompts** — different prompts for Stop, SubagentStop, PreToolUse(Edit/Write), PreToolUse(Bash), PreToolUse(TaskUpdate). Each prompt is a tight validator with 2-6 specific failure modes, expects strict JSON `{"decision":"approve"}` or `{"decision":"block","reason":"..."}`.
- **Prompts use prefill** (`messages.append({"role":"assistant","content":[{"text":"{"}]})`) to guarantee JSON output even from sloppy models.
- **Logs every evaluation** to `~/.claude/hook-evaluations.jsonl` (timestamp, hook type, tool, model, decision, reason, latency_ms, tokens, error).

The specific failure modes the anxiety hook catches at Stop:

1. **UNVERIFIED COMPLETION**: claims done/working but no Bash output shows the code DOING the claimed behaviour. Compilation alone is NOT behavioral proof. (Exact failure mode from this AelosX session.)
2. **UNTESTED ARTIFACT**: wrote executable code, claims it works, no Bash execution exercising the behaviour.
3. **FABRICATED CITATION**: references a specific document's content but no Read/WebFetch of that document in the conversation.
4. **UNGROUNDED EXTERNAL CLAIM**: asserts specific facts about external system state without tool_result evidence.
5. **QUESTION MISMATCH**: answers a substantially different question than asked.
6. **UNFILED ISSUES**: identified defects/risks but didn't file them as `git-issues new` calls. (The file rule, enforced.)

The full hook source is ~590 lines of Python at this length. It will live cleanly under `~/Documents/deliberate/hooks/anxiety.py` and be wired by deliberate's installer. **Bobola added it to Apple Notes; pull it from there or ask him to paste it into `~/Documents/deliberate/hooks/anxiety.py` directly.**

## Reference 3: teammate-mode skill (installed locally this session)

Bobola also added a `teammate-mode` skill to Apple Notes and asked Claude to install it. **Done.** Installed at `~/.claude/skills/teammate-mode/SKILL.md`. Auto-loads on description match.

The skill is a cognitive-forcing-function counter to the agent's trained tendencies (move fast, sound confident, compress, summarize). Cited research: Lee et al. CHI 2025, Kosmyna et al. MIT 2025, Buçinca et al. CSCW 2021, Vasconcelos et al. CSCW 2023, Si et al. EMNLP 2024.

Key behaviours the skill encodes:
- Size to assimilation, not generation. Small chunks the user can process.
- Offers, does not assert.
- Either party can stop to re-check.
- Re-read before backing down on pushback (reflexive backdown is as bad as reflexive confidence).
- Show, don't summarize, tool output.
- Ask before routing — don't silently activate workflow skills when the user wants to think together.
- Honest "I don't know" beats hedged "could explore."

This skill lives alongside the discipline hooks. The hooks enforce process; teammate-mode tunes the conversational stance. Together: the agent is small-stepped AND verified.

## What "all this rolls up into deliberate" actually means as a unification proposal

If I were the deliberate agent looking at this, the cleanest move would be:

1. **Deliberate owns one hook entry per Claude Code event type** (PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStop). The entry calls `deliberate-changes.py` (or a new `deliberate-evaluate.py`).
2. **Deliberate's evaluator dispatches internally** to the right discipline check based on event type, tool name, and config:
   - PreToolUse Write/Edit → spec-adherence + anxiety pre-edit
   - PreToolUse Bash → anxiety pre-bash
   - PreToolUse TaskUpdate → anxiety pre-task
   - Stop → anxiety stop (the six failure modes above) + verify-behavior reminder
   - PostToolUse Write/Edit → plan-trace comment check
   - UserPromptSubmit → issues-loop anxiety prompt injection (only if `.git` in cwd)
3. **One config surface**: `deliberate config` (or `~/.deliberate/config.json` keys) controls which checks are on, strictness per check, and the kill-switch (pause/off/bypass). The user does not edit `~/.claude/hooks/hooks.json` directly.
4. **Daemon for spec watching** stays as-is (the existing `spec_watcher_daemon.py` is already alive and listens on `~/.cache/nospec-drift/spec.sock`); deliberate just queries it.
5. **Logs are unified**: instead of `~/.claude/hook-evaluations.jsonl` plus `~/.claude/anxiety-state.json` plus deliberate's own logs, everything writes to `~/.deliberate/logs/` or equivalent so you can see the whole discipline graph in one place.

That's the unification. The deliberate agent is invited to take this as a starting frame, not a spec — refine it with the existing deliberate architecture in mind.

## Summary of what the deliberate agent should do

1. **Read this whole note.**
2. **Don't remove deliberate's existing functionality.** Check what's there first. Add what's missing. Refactor toward unification only where it's safe.
3. **Pull the anxiety hook code** from Bobola's Apple Notes (or ask him to paste it into `~/Documents/deliberate/hooks/anxiety.py`). It is the most substantive piece of the discipline graph; everything else is either small (the bash shell scripts) or already-running-but-unwired (the spec_watcher_daemon).
4. **Decide the unification shape** (the proposal above is a starting frame, not a directive).
5. **Build the missing pieces** (plan-trace-comment hook, kill-switch command, `.git`-detection logic for stringency, user-message-as-spec interview path, LaunchAgent for the spec daemon).
6. **Verify against the anti-game checklist** in the previous section before declaring done.
7. **Tell Bobola what's wired vs what's pending**, plainly, with the equivalent of `deliberate hooks status`.
