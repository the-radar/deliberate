#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deliberate - File Change Analysis Hook

PostToolUse hook that explains what file changes occurred after Write/Edit operations.
Architecture:

  1) Lightweight local rules for initial risk hints.
  2) LLM explanation for human-readable review context.

https://github.com/the-radar/deliberate
"""

import json
import sys
import os
import urllib.request
from pathlib import Path

# Configuration
BROADCAST_URL = "http://localhost:8765/api/broadcast"

# Support both plugin mode (CLAUDE_PLUGIN_ROOT) and npm install mode (~/.deliberate/)
# Plugin mode: config in plugin directory
# npm mode: config in ~/.deliberate/
PLUGIN_ROOT = os.environ.get('CLAUDE_PLUGIN_ROOT')
if PLUGIN_ROOT:
    CONFIG_FILE = str(Path(PLUGIN_ROOT) / ".deliberate" / "config.json")
else:
    CONFIG_FILE = str(Path.home() / ".deliberate" / "config.json")

MAX_CONTENT_LINES = 100
TIMEOUT_SECONDS = 30
DEBUG = False

# Session state for deduplication and Pre/Post caching
import hashlib
import random
from datetime import datetime


def get_state_file(session_id: str) -> str:
    """Get session-specific state file path."""
    return os.path.expanduser(f"~/.claude/deliberate_changes_state_{session_id}.json")


def get_cache_file(session_id: str, file_hash: str) -> str:
    """Get cache file for Pre/Post hook result sharing."""
    # Using /tmp is intentional for ephemeral cache (nosec B108)
    return f"/tmp/deliberate_cache_{session_id}_{file_hash}.json"  # nosec B108


def cleanup_old_state_files():
    """Remove state files older than 7 days (runs 10% of the time)."""
    if random.random() > 0.1:
        return
    try:
        state_dir = os.path.expanduser("~/.claude")
        if not os.path.exists(state_dir):
            return
        current_time = datetime.now().timestamp()
        seven_days_ago = current_time - (7 * 24 * 60 * 60)
        for filename in os.listdir(state_dir):
            if filename.startswith("deliberate_") and filename.endswith(".json"):
                file_path = os.path.join(state_dir, filename)
                try:
                    if os.path.getmtime(file_path) < seven_days_ago:
                        os.remove(file_path)
                except (OSError, IOError):
                    pass
    except Exception:
        pass


def load_state(session_id: str) -> set:
    """Load the set of already-shown warning keys for this session."""
    state_file = get_state_file(session_id)
    if os.path.exists(state_file):
        try:
            with open(state_file, 'r') as f:
                return set(json.load(f))
        except (json.JSONDecodeError, IOError):
            return set()
    return set()


def save_state(session_id: str, shown_warnings: set):
    """Save the set of shown warning keys."""
    state_file = get_state_file(session_id)
    try:
        os.makedirs(os.path.dirname(state_file), exist_ok=True)
        with open(state_file, 'w') as f:
            json.dump(list(shown_warnings), f)
    except IOError:
        pass


def _event_log_dir() -> str:
    """Directory for JSONL event logs used by the Deliberate TUI."""
    override = os.environ.get("DELIBERATE_EVENT_LOG_DIR")
    if override:
        return override
    return str(Path.home() / ".deliberate" / "events")


def _event_log_path() -> str:
    """Daily JSONL file path (UTC) for event logs."""
    day = datetime.utcnow().strftime("%Y-%m-%d")
    return os.path.join(_event_log_dir(), f"events-{day}.jsonl")


def append_event_log(payload: dict) -> bool:
    """Append event payload to local JSONL log (fail-open)."""
    try:
        log_dir = _event_log_dir()
        os.makedirs(log_dir, exist_ok=True)
        file_path = _event_log_path()
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        fd = os.open(file_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            with os.fdopen(fd, "a", encoding="utf-8") as f:
                f.write(line)
        finally:
            try:
                os.close(fd)
            except Exception:
                pass
        return True
    except Exception:
        return False


def cleanup_old_event_logs(days: int = 7):
    """Remove event logs older than N days (best-effort, runs 10% of the time)."""
    if random.random() > 0.1:
        return
    try:
        log_dir = _event_log_dir()
        if not os.path.exists(log_dir):
            return
        current_time = datetime.now().timestamp()
        cutoff = current_time - (days * 24 * 60 * 60)
        for filename in os.listdir(log_dir):
            if not filename.startswith("events-") or not filename.endswith(".jsonl"):
                continue
            file_path = os.path.join(log_dir, filename)
            try:
                if os.path.getmtime(file_path) < cutoff:
                    os.remove(file_path)
            except (OSError, IOError):
                pass
    except Exception:
        pass


def get_warning_key(file_path: str, content_hash: str) -> str:
    """Generate a unique key for deduplication."""
    # MD5 used for cache key only, not security (nosec B324)
    return f"file-{hashlib.md5(file_path.encode(), usedforsecurity=False).hexdigest()[:8]}-{content_hash[:8]}"


def load_dedup_config() -> bool:
    """Load deduplication config - returns True if dedup is enabled (default)."""
    try:
        config_path = Path(CONFIG_FILE)
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                return config.get("deduplication", {}).get("enabled", True)
    except Exception:
        pass
    return True


def load_terminal_explanations_mode() -> str:
    """Load GUI terminal surfacing mode from config.

    Modes:
      - full: show full explanation in terminal (v1 behavior)
      - minimal: show a short pointer in terminal, details in the Deliberate pane
      - gui: suppress terminal output, details in the Deliberate pane
    """
    try:
        config_path = Path(CONFIG_FILE)
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                mode = (config.get("gui", {}) or {}).get("terminalExplanations", "full")
                if mode in ("full", "minimal", "gui"):
                    return mode
    except Exception:
        pass
    return "full"


def deliberate_enabled() -> bool:
    """Global Deliberate enable switch (default: enabled)."""
    try:
        config_path = Path(CONFIG_FILE)
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f) or {}
                deliberate = config.get("deliberate", {}) or {}
                value = deliberate.get("enabled")
                if isinstance(value, bool):
                    return value
    except Exception:
        pass
    return True


def extract_content(tool_name: str, tool_input: dict) -> tuple:
    """Extract file_path and content from tool input, handling Write/Edit/MultiEdit."""
    file_path = tool_input.get("file_path", "")

    if tool_name == "Write":
        content = tool_input.get("content", "")
        return file_path, content, "write", None, content

    elif tool_name == "Edit":
        old_string = tool_input.get("old_string", "")
        new_string = tool_input.get("new_string", "")
        return file_path, new_string, "edit", old_string, new_string

    elif tool_name == "MultiEdit":
        edits = tool_input.get("edits", [])
        # Combine all new_strings for analysis
        all_new = " ".join(edit.get("new_string", "") for edit in edits)
        all_old = " ".join(edit.get("old_string", "") for edit in edits)
        return file_path, all_new, "multiedit", all_old, all_new

    return "", "", "", None, None


def load_llm_config():
    # type: () -> dict | None
    """Load LLM configuration from ~/.deliberate/config.json or keychain"""
    try:
        config_path = Path(CONFIG_FILE)
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                llm = config.get("llm", {})
                provider = llm.get("provider")
                if not provider:
                    return None

                # For claude-subscription we prefer Claude SDK's own auth
                # resolution unless Deliberate config explicitly sets apiKey.
                api_key = llm.get("apiKey")

                return {
                    "provider": provider,
                    "base_url": llm.get("baseUrl"),
                    "api_key": api_key,
                    "model": llm.get("model")
                }
    except Exception as e:
        debug(f"Error loading config: {e}")
    return None

def debug(msg):
    if DEBUG:
        print(f"[deliberate-changes] {msg}", file=sys.stderr)


def broadcast_event(session_id: str, data: dict):
    """Fire-and-forget broadcast for v2 GUI consumers."""
    try:
        payload = {
            "type": "file_change_analyzed",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "sessionId": session_id,
            "data": data
        }

        logged = append_event_log(payload)
        cleanup_old_event_logs()

        headers = {"Content-Type": "application/json"}
        if logged:
            headers["X-Deliberate-Event-Logged"] = "1"

        req = urllib.request.Request(
            BROADCAST_URL,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=0.5):  # nosec B310
            pass
    except Exception:
        pass


HIGH_RISK_PATH_HINTS = (
    ".env",
    "id_rsa",
    "id_ed25519",
    "authorized_keys",
    "/etc/",
    "/.ssh/",
)

HIGH_RISK_CONTENT_HINTS = (
    "BEGIN PRIVATE KEY",
    "aws_access_key_id",
    "aws_secret_access_key",
    "api_key",
    "secret_key",
    "password=",
    "token=",
    "curl ",
    "wget ",
)


def assess_change_risk_by_rules(
    operation: str,
    file_path: str,
    content: str = None,
    old_string: str = None,
    new_string: str = None
) -> dict | None:
    """Lightweight local pre-assessment for file changes."""
    path_lower = str(file_path or "").lower()
    body = (new_string if new_string is not None else content) or ""
    body_snippet = str(body)[:4000]
    body_lower = body_snippet.lower()

    for hint in HIGH_RISK_PATH_HINTS:
        if hint.lower() in path_lower:
            return {
                "risk": "DANGEROUS",
                "reason": f"Sensitive path modified ({hint})",
                "source": "rules"
            }

    for hint in HIGH_RISK_CONTENT_HINTS:
        if hint.lower() in body_lower:
            return {
                "risk": "MODERATE",
                "reason": f"Potentially sensitive or execution-oriented content detected ({hint})",
                "source": "rules"
            }

    # Low-risk hints for docs/config style edits.
    if path_lower.endswith((".md", ".txt", ".rst")):
        return {"risk": "SAFE", "reason": "Documentation/text file change", "source": "rules"}

    if operation == "write" and path_lower.endswith((".json", ".yaml", ".yml", ".toml")):
        return {"risk": "SAFE", "reason": "Structured config file write", "source": "rules"}

    return None


def _call_llm_via_deliberate_cli(prompt: str, timeout_seconds: int) -> str | None:
    """Subprocess into `node bin/cli.js llm chat` for provider-agnostic LLM calls.

    Plan: docs/plans/wire-llm-to-hooks.md§"Python-side change (separate)" · Issue: #10
    """
    import subprocess as _sp
    repo_root = Path(__file__).resolve().parent.parent
    cli = repo_root / "bin" / "cli.js"
    if not cli.exists():
        debug(f"deliberate cli not found at {cli}")
        return None
    # 2026-05-24: bound to 200 tokens + 15s floor — same reason as
    # deliberate-commands.py. Local 4B models can't ship 1KB in 5s.
    req = json.dumps({
        "prompt": prompt,
        "maxTokens": 200,
        "timeoutMs": max(15_000, timeout_seconds * 1_000),
    })
    try:
        proc = _sp.run(
            ["node", str(cli), "llm", "chat"],
            input=req.encode("utf-8"),
            capture_output=True,
            timeout=timeout_seconds + 5,
        )
    except Exception as e:
        debug(f"deliberate llm chat threw: {e}")
        return None
    if proc.returncode != 0:
        debug(f"deliberate llm chat non-zero exit: {proc.returncode}")
        return None
    try:
        body = json.loads(proc.stdout.decode("utf-8", errors="replace") or "{}")
    except Exception:
        return None
    if not body.get("ok"):
        debug(f"deliberate llm chat failed: {body.get('error', 'unknown')}")
        return None
    text = body.get("text", "")
    return text if isinstance(text, str) and text.strip() else None


def call_llm_for_explanation(file_path: str, operation: str, content: str, pre_assessment: dict | None = None) -> dict | None:
    """Call the configured LLM to explain a file change.

    Two paths:
      - provider == 'claude-subscription' -> Claude Agent SDK (legacy)
      - any other provider -> deliberate's streamChat via `deliberate llm chat`
        (so we honour the user's bring-your-own gateway from #3)
    """

    llm_config = load_llm_config()
    if not llm_config:
        debug("No LLM configured")
        return None

    provider = llm_config["provider"]

    file_name = os.path.basename(file_path)

    # Build context from local pre-assessment if available
    context_note = ""
    if pre_assessment:
        risk = pre_assessment.get("risk", "UNKNOWN")
        reason = pre_assessment.get("reason", "")
        source = pre_assessment.get("source", "rules")
        context_note = f"\n\nPre-screening ({source}): {risk} - {reason}"

    if operation == "write":
        # 2026-05-24: same /no_think prefix as deliberate-commands.py so Qwen
        # families skip thinking-mode preamble.
        prompt = f"""/no_think
OUTPUT ONLY the two lines specified at the bottom. Do not show reasoning, planning, or preamble. Just the verdict.

Analyze this file write for both purpose and security implications. Be concise (1-2 sentences).{context_note}

File: {file_name}
Operation: Created/overwrote file

Content preview:
```
{content[:2000]}
```

Consider:
- What does this file do?
- Any security concerns? (credentials, permissions, executable code, network access, data exposure)
- Could this be malicious or have unintended side effects?

Format your response as:
RISK: [SAFE|MODERATE|DANGEROUS]
EXPLANATION: [your explanation including any security notes]"""
    else:  # edit or multiedit
        prompt = f"""/no_think
OUTPUT ONLY the two lines specified at the bottom. Do not show reasoning, planning, or preamble. Just the verdict.

Analyze this edit for both purpose and security implications. Be concise (1-2 sentences).{context_note}

File: {file_name}
Operation: {"Multiple edits (batch)" if operation == "multiedit" else "Find and replace"}

{content}

Consider:
- What does this change do?
- Any security concerns? (weakening validation, exposing data, changing permissions, modifying auth logic)
- Could this introduce vulnerabilities?

Format your response as:
RISK: [SAFE|MODERATE|DANGEROUS]
EXPLANATION: [your explanation including any security notes]"""

    # New path: provider-agnostic LLM via deliberate's streamChat for any
    # provider that isn't the legacy claude-subscription SDK.
    if provider != "claude-subscription":
        content = _call_llm_via_deliberate_cli(prompt, timeout_seconds=TIMEOUT_SECONDS)
        if not content:
            return None
        risk = "MODERATE"
        explanation = content
        if "RISK:" in content and "EXPLANATION:" in content:
            parts = content.split("EXPLANATION:")
            risk_line = parts[0]
            explanation = parts[1].strip() if len(parts) > 1 else content
            if "DANGEROUS" in risk_line:
                risk = "DANGEROUS"
            elif "SAFE" in risk_line:
                risk = "SAFE"
        return {"risk": risk, "explanation": explanation}

    try:
        # Use Claude Agent SDK
        import subprocess
        import tempfile

        # Create temp file for SDK script
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            sdk_script = f"""
import os
import sys
import json
import asyncio
from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

# Optional override token. If omitted, Claude SDK uses existing Claude auth.
token = {repr(llm_config["api_key"])}
if token:
    os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token

async def main():
    # Create SDK client - disallow all tools (just need text response)
    client = ClaudeSDKClient(
        options=ClaudeAgentOptions(
            model={repr(llm_config["model"])},
            max_turns=1,
            disallowed_tools=['Task', 'TaskOutput', 'Bash', 'Glob', 'Grep', 'ExitPlanMode', 'Read', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'TodoWrite', 'KillShell', 'AskUserQuestion', 'Skill', 'SlashCommand', 'EnterPlanMode', 'WebSearch']
        )
    )

    # Send prompt
    prompt = {repr(prompt)}

    async with client:
        await client.query(prompt)

        # Collect response from ResultMessage
        response_text = ""
        async for msg in client.receive_response():
            msg_type = type(msg).__name__
            if msg_type == 'ResultMessage' and hasattr(msg, 'result'):
                response_text = msg.result
                break

        print(response_text)

# Run async main
asyncio.run(main())
"""
            f.write(sdk_script)
            script_path = f.name

        # Run SDK script
        result = subprocess.run(
            ["python3", script_path],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS
        )

        os.unlink(script_path)

        if result.returncode != 0:
            debug(f"SDK script failed: {result.stderr}")
            return None

        llm_content = result.stdout.strip()

        # Parse the response
        risk = "MODERATE"
        explanation = llm_content

        if "RISK:" in llm_content and "EXPLANATION:" in llm_content:
            parts = llm_content.split("EXPLANATION:")
            risk_line = parts[0]
            explanation = parts[1].strip() if len(parts) > 1 else llm_content

            if "DANGEROUS" in risk_line:
                risk = "DANGEROUS"
            elif "SAFE" in risk_line:
                risk = "SAFE"

        return {"risk": risk, "explanation": explanation}

    except Exception as e:
        debug(f"SDK error: {e}")
        return None


def main():
    debug("Hook started")

    # Periodically clean up old state files
    cleanup_old_state_files()

    try:
        input_data = json.load(sys.stdin)
        debug(f"Got input: tool={input_data.get('tool_name')}")
    except json.JSONDecodeError as e:
        debug(f"JSON decode error: {e}")
        sys.exit(0)

    # Extract session ID for deduplication
    session_id = input_data.get("session_id", "default")
    hook_event = input_data.get("hook_event_name", "PreToolUse")
    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})
    cwd = input_data.get("cwd", os.getcwd())

    # Only process Write, Edit, and MultiEdit
    if tool_name not in ("Write", "Edit", "MultiEdit"):
        debug(f"Not Write/Edit/MultiEdit, skipping: {tool_name}")
        sys.exit(0)

    # Extract content using unified function
    file_path, content, operation, old_string, new_string = extract_content(tool_name, tool_input)

    if not file_path:
        debug("No file path, skipping")
        sys.exit(0)

    if not content and not new_string:
        debug("No content, skipping")
        sys.exit(0)

    # Master kill switch. When disabled, fail-open with no output.
    if not deliberate_enabled():
        debug("Deliberate disabled, skipping")
        sys.exit(0)

    # Generate content hash for caching and deduplication
    content_hash = hashlib.md5((file_path + (new_string or content or "")).encode(), usedforsecurity=False).hexdigest()

    # Build content description based on operation
    if operation == "write":
        lines = content.split('\n')
        line_count = len(lines)
        if line_count > MAX_CONTENT_LINES:
            preview = '\n'.join(lines[:MAX_CONTENT_LINES])
            content_desc = f"{preview}\n... ({line_count - MAX_CONTENT_LINES} more lines)"
        else:
            content_desc = content

    elif operation == "multiedit":
        edits = tool_input.get("edits", [])
        edit_count = len(edits)
        content_desc = f"MultiEdit: {edit_count} changes\n"
        for i, edit in enumerate(edits[:3]):  # Show first 3
            old = edit.get("old_string", "")[:200]
            new = edit.get("new_string", "")[:200]
            content_desc += f"\n[{i+1}] {old[:50]}... → {new[:50]}..."
        if edit_count > 3:
            content_desc += f"\n... and {edit_count - 3} more edits"

    else:  # edit
        content_desc = f"OLD:\n```\n{old_string[:1000]}\n```\n\nNEW:\n```\n{new_string[:1000]}\n```"

    # Get relative path for display
    rel_path = os.path.basename(file_path)
    try:
        home = os.path.expanduser("~")
        if file_path.startswith(home):
            rel_path = "~" + file_path[len(home):]
    except Exception:
        pass

    # Layer 1: local rule pre-assessment.
    pre_assessment = assess_change_risk_by_rules(
        operation=operation,
        file_path=file_path,
        content=content if operation == "write" else None,
        old_string=old_string if operation in ("edit", "multiedit") else None,
        new_string=new_string if operation in ("edit", "multiedit") else None
    )

    # Layer 2: Get LLM explanation for detailed analysis
    debug(f"Analyzing {operation}: {file_path[:80]}")
    llm_result = call_llm_for_explanation(file_path, operation, content_desc, pre_assessment)

    # Progressive degradation: use local rule pre-assessment if LLM is unavailable.
    # Warning intentionally suppressed — see deliberate-commands.py for the
    # same rationale (we never call the LLM for non-claude-subscription
    # providers yet, so "LLM unavailable" is misleading noise).
    # Fail loud when the LLM was meant to run but didn't.
    llm_unavailable_warning = ""
    if not llm_result:
        rule_risk = pre_assessment.get("risk", "MODERATE") if pre_assessment else "MODERATE"
        risk = rule_risk
        explanation = (
            "⚠ LLM unreachable — analysis SKIPPED. "
            f"Local rules say risk={rule_risk}"
            + (f": {pre_assessment.get('reason')}" if pre_assessment and pre_assessment.get('reason') else "")
            + ". Run `deliberate hooks status` and verify the configured gateway is responding."
        )
        debug("LLM failed; surfacing fail-loud event")
        else:
            # No LLM and no rule match: fail-open.
            debug("No LLM and no rule pre-assessment, allowing file change")
            sys.exit(0)
    else:
        risk = llm_result["risk"]
        explanation = llm_result["explanation"]

        # If local rules consider the change risky but LLM says SAFE, keep it in
        # review by promoting to MODERATE.
        if pre_assessment and pre_assessment.get("risk") == "DANGEROUS" and risk == "SAFE":
            risk = "MODERATE"
            reason = pre_assessment.get("reason", "Local rule matched dangerous pattern")
            explanation = f"{explanation}\n\nLocal rule note: {reason}"

    if not explanation or explanation == "None":
        if pre_assessment and pre_assessment.get("reason"):
            explanation = pre_assessment.get("reason")
        else:
            explanation = "Review file change manually"

    # Session deduplication - check if we've already warned about this exact change
    if load_dedup_config():
        warning_key = get_warning_key(file_path, content_hash)
        shown_warnings = load_state(session_id)

        if warning_key in shown_warnings:
            # Already shown this warning in this session - allow without re-prompting
            debug(f"Deduplicated: {warning_key} already shown this session")
            sys.exit(0)

        # Mark as shown and save state
        shown_warnings.add(warning_key)
        save_state(session_id, shown_warnings)

    # NOTE: This is PostToolUse - the write already happened
    # Show informational output for ALL risk levels (including SAFE)
    # User can review what happened even for safe changes
    # We can only inform the user, not block. No exit(2) here.

    # ANSI color codes for terminal output
    BOLD = "\033[1m"
    CYAN = "\033[96m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    GREEN = "\033[92m"
    RESET = "\033[0m"

    # Choose emoji and color based on risk for visual branding
    if risk == "DANGEROUS":
        emoji = "🚨"
        color = RED
    elif risk == "SAFE":
        emoji = "✅"
        color = GREEN
    else:
        emoji = "⚡"
        color = YELLOW

    # Operation label
    if operation == "write":
        op_label = "Write"
    elif operation == "multiedit":
        op_label = "MultiEdit"
    else:
        op_label = "Edit"

    # User-facing message with branded formatting and colors
    # Make the explanation text visible with the risk color so it's not skipped
    surfacing_mode = load_terminal_explanations_mode()
    # Even in "gui" mode we keep a tiny pointer so the user is never fully blind
    # if the GUI/server is down.
    if surfacing_mode in ("minimal", "gui"):
        user_message = f"{emoji} {BOLD}{CYAN}DELIBERATE{RESET} {BOLD}{color}[{risk}]{RESET} {op_label}\n    File: {rel_path}\n    {color}Details in Deliberate pane{RESET}"
    else:
        user_message = f"{emoji} {BOLD}{CYAN}DELIBERATE{RESET} {BOLD}{color}[{risk}]{RESET} {op_label}\n    File: {rel_path}\n    {color}{explanation}{RESET}{llm_unavailable_warning}"

    # Context for Claude
    context = f"**Deliberate {op_label}** [{risk}] {rel_path}: {explanation}{llm_unavailable_warning}"

    # Cache result for Post hook to read (if this is PreToolUse)
    cache_file = get_cache_file(session_id, content_hash)
    try:
        with open(cache_file, 'w') as f:
            json.dump({
                "risk": risk,
                "explanation": explanation,
                "user_message": user_message,
                "context": context,
                "op_label": op_label,
                "rel_path": rel_path
            }, f)
    except IOError:
        pass

    # Output for PostToolUse - informational only
    # systemMessage is what makes it visible to the user
    # permissionDecision/permissionDecisionReason are for PreToolUse only
    output = {
        "systemMessage": user_message,
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": context
        }
    }

    broadcast_event(session_id, {
        "operation": op_label.lower(),
        "filePath": file_path,
        "relativePath": rel_path,
        "cwd": cwd,
        "risk": risk,
        "explanation": explanation,
        "permissionDecision": "allow"
    })

    print(json.dumps(output))

    sys.exit(0)


if __name__ == "__main__":
    main()
