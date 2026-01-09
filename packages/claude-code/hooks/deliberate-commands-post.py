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

DEBUG = os.environ.get("DELIBERATE_DEBUG", "").lower() in ("1", "true", "yes")


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

    # User-facing message - color the explanation so it's not easy to skip
    user_message = f"{emoji} {BOLD}{CYAN}DELIBERATE{RESET} {BOLD}{color}[{risk}]{RESET}\n    {color}{explanation}{RESET}{llm_unavailable_warning}"

    # Context for Claude
    context = f"**Deliberate** [{risk}]: {explanation}{llm_unavailable_warning}"

    # Output for PostToolUse - systemMessage makes it visible to user
    output = {
        "systemMessage": user_message,
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": context
        }
    }

    print(json.dumps(output))
    sys.exit(0)


if __name__ == "__main__":
    main()
