#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deliberate - Command Analysis PostToolUse Hook

PostToolUse hook that displays cached command analysis after Bash execution.
Reads analysis cached by the PreToolUse hook (deliberate-commands.py).

This provides persistent visibility of command analysis even after the
PreToolUse permission prompt disappears.
"""

import json
import sys
import os
import hashlib
import urllib.request
from datetime import datetime
from pathlib import Path
from os import getcwd

DEBUG = os.environ.get("DELIBERATE_DEBUG", "").lower() in ("1", "true", "yes")
BROADCAST_URL = "http://localhost:8765/api/broadcast"

# Support both plugin mode (CLAUDE_PLUGIN_ROOT) and npm install mode (~/.deliberate/)
PLUGIN_ROOT = os.environ.get('CLAUDE_PLUGIN_ROOT')
if PLUGIN_ROOT:
    CONFIG_FILE = str(Path(PLUGIN_ROOT) / ".deliberate" / "config.json")
else:
    CONFIG_FILE = str(Path.home() / ".deliberate" / "config.json")


def debug(msg: str):
    """Print debug message to stderr if DEBUG is enabled."""
    if DEBUG:
        print(f"[deliberate-cmd-post] {msg}", file=sys.stderr)


def get_cache_file(session_id: str, cmd_hash: str) -> str:
    """Get cache file path - must match PreToolUse hook."""
    return os.path.expanduser(f"~/.claude/deliberate_cmd_cache_{session_id}_{cmd_hash}.json")


def load_from_cache(session_id: str, cmd_hash: str) -> dict | None:
    """Load analysis result from cache."""
    cache_file = get_cache_file(session_id, cmd_hash)
    try:
        if os.path.exists(cache_file):
            with open(cache_file, 'r') as f:
                data = json.load(f)
            # Clean up cache file after reading
            os.remove(cache_file)
            debug(f"Loaded and removed cache: {cache_file}")
            return data
    except (IOError, json.JSONDecodeError) as e:
        debug(f"Failed to load cache: {e}")
    return None


def _event_log_dir() -> str:
    override = os.environ.get("DELIBERATE_EVENT_LOG_DIR")
    if override:
        return override
    return str(Path.home() / ".deliberate" / "events")


def _event_log_path() -> str:
    day = datetime.utcnow().strftime("%Y-%m-%d")
    return os.path.join(_event_log_dir(), f"events-{day}.jsonl")


def append_event_log(payload: dict) -> bool:
    """Append event to JSONL log for the Deliberate TUI (fail-open)."""
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


def broadcast_event(session_id: str, data: dict):
    """Fire-and-forget event broadcast. Never block PostToolUse output."""
    try:
        payload = {
            "type": "command_post_analysis",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "sessionId": session_id,
            "data": data
        }

        logged = append_event_log(payload)

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


def load_terminal_explanations_mode() -> str:
    """Load GUI terminal surfacing mode from config.

    Modes:
      - full: show full explanation in terminal (v1 behavior)
      - minimal: show a short pointer in terminal, details in the Deliberate pane
      - gui: show nothing in terminal, details in the Deliberate pane
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


def main():
    debug("PostToolUse hook started")

    try:
        input_data = json.load(sys.stdin)
        debug(f"Got input: tool={input_data.get('tool_name')}")
    except json.JSONDecodeError as e:
        debug(f"JSON decode error: {e}")
        sys.exit(0)

    # Only process Bash commands
    tool_name = input_data.get("tool_name", "")
    if tool_name != "Bash":
        debug(f"Not Bash, skipping: {tool_name}")
        sys.exit(0)

    # Get session ID and command
    session_id = input_data.get("session_id", "default")
    tool_input = input_data.get("tool_input", {})
    command = tool_input.get("command", "")
    cwd = input_data.get("cwd", getcwd())

    if not command:
        debug("No command found")
        sys.exit(0)

    # Generate same hash as PreToolUse to find cache
    # MD5 used for cache key only, not security
    cmd_hash = hashlib.md5(command.encode(), usedforsecurity=False).hexdigest()[:16]

    # Load cached analysis
    cached = load_from_cache(session_id, cmd_hash)
    if not cached:
        debug("No cached analysis found")
        sys.exit(0)

    risk = cached.get("risk", "MODERATE")
    explanation = cached.get("explanation", "Command executed")
    llm_unavailable_warning = cached.get("llm_unavailable_warning", "")
    surfacing_mode = load_terminal_explanations_mode()

    # ANSI color codes for terminal output
    BOLD = "\033[1m"
    CYAN = "\033[96m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    GREEN = "\033[92m"
    RESET = "\033[0m"

    # Choose emoji and color based on risk
    if risk == "DANGEROUS":
        emoji = "🚨"
        color = RED
    elif risk == "SAFE":
        emoji = "✅"
        color = GREEN
    else:
        emoji = "⚡"
        color = YELLOW

    # User-facing message. Even in "gui" mode we keep a tiny pointer so the user
    # is never fully blind if the GUI/server is down.
    if surfacing_mode in ("minimal", "gui"):
        user_message = f"{emoji} {BOLD}{CYAN}DELIBERATE{RESET} {BOLD}{color}[{risk}]{RESET}\n    {color}Details in Deliberate pane{RESET}"
    else:
        # Full explanation in terminal (v1 behavior).
        user_message = f"{emoji} {BOLD}{CYAN}DELIBERATE{RESET} {BOLD}{color}[{risk}]{RESET}\n    {color}{explanation}{RESET}{llm_unavailable_warning}"

    # Context for Claude
    context = f"**Deliberate** [{risk}]: {explanation}{llm_unavailable_warning}"

    # Output for PostToolUse. `systemMessage` makes it visible to the user.
    # We always include `additionalContext` so Claude still gets the details.
    output = {
        "systemMessage": user_message,
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": context
        }
    }

    broadcast_event(session_id, {
        "command": command,
        "cwd": cwd,
        "risk": risk,
        "explanation": explanation,
        "permissionDecision": "allow"
    })

    print(json.dumps(output))
    sys.exit(0)


if __name__ == "__main__":
    main()
