#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deliberate - Command Analysis Hook

PreToolUse hook that explains what shell commands will do before execution.
Architecture:

  1) Lightweight local rules for initial risk hints.
  2) LLM explanation for human-readable review context.

https://github.com/the-radar/deliberate
"""

import hashlib
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import time
import shlex
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

# Configuration
BROADCAST_URL = "http://localhost:8765/api/broadcast"
LLM_MODE = os.environ.get("DELIBERATE_LLM_MODE")

# Support both plugin mode (CLAUDE_PLUGIN_ROOT) and npm install mode (~/.deliberate/)
# Plugin mode: config in plugin directory
# npm mode: config in ~/.deliberate/
PLUGIN_ROOT = os.environ.get('CLAUDE_PLUGIN_ROOT')
if PLUGIN_ROOT:
    CONFIG_FILE = str(Path(PLUGIN_ROOT) / ".deliberate" / "config.json")
else:
    CONFIG_FILE = str(Path.home() / ".deliberate" / "config.json")

TIMEOUT_SECONDS = 30
DEBUG = False
WEB_CACHE_TTL_SECONDS = 6 * 60 * 60
WEB_CACHE_MAX_ENTRIES = 120

# Session state for deduplication


def get_state_file(session_id: str) -> str:
    """Get session-specific state file path."""
    return os.path.expanduser(f"~/.claude/deliberate_cmd_state_{session_id}.json")


def get_history_file(session_id: str) -> str:
    """Get session-specific command history file path."""
    return os.path.expanduser(f"~/.claude/deliberate_cmd_history_{session_id}.json")


def get_web_lookup_cache_file(session_id: str) -> str:
    """Get session-scoped cache file for web lookup evidence."""
    return os.path.expanduser(f"~/.claude/deliberate_web_lookup_{session_id}.json")


def cleanup_old_state_files():
    """Remove state and history files older than 7 days (runs 10% of the time)."""
    if random.random() > 0.1:
        return
    try:
        state_dir = os.path.expanduser("~/.claude")
        if not os.path.exists(state_dir):
            return
        current_time = datetime.now().timestamp()
        seven_days_ago = current_time - (7 * 24 * 60 * 60)
        for filename in os.listdir(state_dir):
            # Clean up state files, history files, and cache files
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


def load_web_lookup_cache(session_id: str) -> dict:
    """Load per-session web lookup cache (best-effort)."""
    cache_file = get_web_lookup_cache_file(session_id)
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def save_web_lookup_cache(session_id: str, cache: dict):
    """Persist per-session web lookup cache (best-effort)."""
    cache_file = get_web_lookup_cache_file(session_id)
    try:
        os.makedirs(os.path.dirname(cache_file), exist_ok=True)
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(cache, f)
    except IOError:
        pass

def _event_log_dir() -> str:
    """Directory for JSONL event logs used by the Deliberate TUI.

    We intentionally store this under ~/.deliberate so it works for both
    Claude Code hooks and other tools (OpenCode, future IDE harnesses).
    """
    override = os.environ.get("DELIBERATE_EVENT_LOG_DIR")
    if override:
        return override
    return str(Path.home() / ".deliberate" / "events")


def _event_log_path() -> str:
    """Daily JSONL file path (UTC) for event logs."""
    day = datetime.utcnow().strftime("%Y-%m-%d")
    return os.path.join(_event_log_dir(), f"events-{day}.jsonl")


def append_event_log(payload: dict) -> bool:
    """Append a single event payload to the local JSONL event log.

    This must be fast and fail-open, never blocking command execution.
    """
    try:
        log_dir = _event_log_dir()
        os.makedirs(log_dir, exist_ok=True)
        file_path = _event_log_path()

        line = json.dumps(payload, ensure_ascii=False) + "\n"

        # Create with restrictive permissions when possible (0600).
        # If the file already exists, permissions are left as-is.
        fd = os.open(file_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            with os.fdopen(fd, "a", encoding="utf-8") as f:
                f.write(line)
        finally:
            # fdopen closes fd on exit, but keep this safe if anything goes sideways.
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


def broadcast_event(event_type: str, session_id: str, data: dict):
    """Fire-and-forget broadcast to Deliberate server.

    This is intentionally fail-open so command execution is never blocked by
    GUI transport issues.
    """
    try:
        payload = {
            "type": event_type,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "sessionId": session_id,
            "data": data
        }

        # Local persistence for the TUI, independent of server availability.
        # If local logging fails, the server can still persist the event.
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
        # Broadcast is additive only, never interfere with hook decisions.
        pass


def broadcast_progress(session_id: str, analysis_id: str, command: str, cwd: str, stage: str, message: str):
    """Broadcast incremental analysis progress for one command review."""
    try:
        broadcast_event("command_analysis_progress", session_id, {
            "analysisId": analysis_id,
            "command": command,
            "cwd": cwd,
            "stage": stage,
            "message": message
        })
    except Exception:
        pass


# Workflow patterns that indicate dangerous sequences
# Format: (pattern_name, required_commands, risk_level, description)
WORKFLOW_PATTERNS = [
    ("REPO_WIPE", ["git rm", "git push --force"], "CRITICAL",
     "Repository wipe: removing files from git and force pushing rewrites history permanently"),
    ("REPO_WIPE", ["rm -rf", "git add", "git push --force"], "CRITICAL",
     "Repository restructure with force push: deleting files and force pushing can destroy code"),
    ("MASS_DELETE", ["rm -rf", "rm -rf", "rm -rf"], "HIGH",
     "Multiple recursive deletions in sequence - high risk of unintended data loss"),
    ("HISTORY_REWRITE", ["git reset --hard", "git push --force"], "CRITICAL",
     "History rewrite: hard reset + force push permanently destroys commit history"),
    ("HISTORY_REWRITE", ["git rebase", "git push --force"], "CRITICAL",
     "History rewrite: rebase + force push rewrites shared history"),
    ("UNCOMMITTED_RISK", ["git stash", "git checkout", "rm"], "HIGH",
     "Uncommitted changes at risk: stashing, switching branches, and deleting files"),
    ("TEMP_SWAP", ["cp", "rm -rf", "cp"], "HIGH",
     "Temp directory swap pattern: copying to temp, deleting original, copying back - easy to lose data"),
    ("ENV_DESTRUCTION", ["unset", "rm .env"], "HIGH",
     "Environment destruction: unsetting variables and deleting env files"),
]


def load_command_history(session_id: str) -> dict:
    """Load command history for this session.

    Returns dict with:
    - commands: list of {command, risk, timestamp, explanation}
    - cumulative_risk: current session risk level
    - patterns_detected: list of detected workflow patterns
    - files_at_risk: set of files that could be affected
    """
    history_file = get_history_file(session_id)
    default_history = {
        "commands": [],
        "cumulative_risk": "LOW",
        "patterns_detected": [],
        "files_at_risk": []
    }

    if os.path.exists(history_file):
        try:
            with open(history_file, 'r') as f:
                history = json.load(f)
                # Ensure all keys exist
                for key in default_history:
                    if key not in history:
                        history[key] = default_history[key]
                return history
        except (json.JSONDecodeError, IOError):
            return default_history
    return default_history


def save_command_history(session_id: str, history: dict):
    """Save command history for this session."""
    history_file = get_history_file(session_id)
    try:
        os.makedirs(os.path.dirname(history_file), exist_ok=True)
        with open(history_file, 'w') as f:
            json.dump(history, f, indent=2)
    except IOError:
        pass


def extract_affected_paths(command: str) -> list:
    """Extract file/directory paths that could be affected by a command.

    Looks for paths in common destructive commands like rm, mv, cp, git rm, etc.
    Ignores paths that appear inside quoted strings (test payloads, JSON, etc.)
    """
    paths = []

    # Skip if this is primarily a test/echo command with quoted content
    # These are usually test payloads, not real destructive commands
    if re.match(r'^(echo|printf|cat)\s+[\'"]', command.strip()):
        return paths

    # Skip if command is piping to python/node (likely a test payload)
    if '| python' in command or '| node' in command:
        return paths

    # Remove quoted strings to avoid false positives from test payloads
    # This removes both 'single' and "double" quoted content
    cmd_no_quotes = re.sub(r'"[^"]*"', '', command)
    cmd_no_quotes = re.sub(r"'[^']*'", '', cmd_no_quotes)

    # Patterns for extracting paths from various commands
    # rm -rf /path or rm -rf path
    rm_match = re.findall(r'rm\s+(?:-[rfivd]+\s+)*([^\s|;&>]+)', cmd_no_quotes)
    paths.extend(rm_match)

    # git rm -rf path
    git_rm_match = re.findall(r'git\s+rm\s+(?:-[rf]+\s+)*([^\s|;&>]+)', cmd_no_quotes)
    paths.extend(git_rm_match)

    # mv source dest - source is at risk
    mv_match = re.findall(r'mv\s+(?:-[fiv]+\s+)*([^\s|;&>]+)\s+', cmd_no_quotes)
    paths.extend(mv_match)

    # Filter out flags and special chars
    paths = [p for p in paths if not p.startswith('-') and p not in ['.', '..', '/']]

    return paths


def detect_workflow_patterns(history: dict, current_command: str, window_size: int = 3) -> list:
    """Detect dangerous workflow patterns from recent command history + current command.

    Uses a sliding window to only look at the last N commands, avoiding stale pattern
    matches from old commands that are no longer relevant to the current context.

    Args:
        history: Command history dict with "commands" list
        current_command: The command being analyzed
        window_size: Number of recent commands to consider (default 3)

    Returns list of (pattern_name, risk_level, description) for detected patterns.
    """
    detected = []

    # Only look at the last N commands (sliding window)
    all_history_commands = [cmd["command"] for cmd in history.get("commands", [])]
    recent_commands = all_history_commands[-window_size:] if all_history_commands else []
    recent_commands.append(current_command)

    # Check each workflow pattern against recent commands only
    for pattern_name, required_cmds, risk_level, description in WORKFLOW_PATTERNS:
        # Check if all required command patterns appear in sequence within the window
        found_all = True
        last_idx = -1

        for required in required_cmds:
            found_this = False
            for idx, cmd in enumerate(recent_commands):
                if idx > last_idx and required.lower() in cmd.lower():
                    found_this = True
                    last_idx = idx
                    break

            if not found_this:
                found_all = False
                break

        if found_all:
            detected.append((pattern_name, risk_level, description))

    return detected


RISK_LEVELS = {"LOW": 0, "MODERATE": 1, "HIGH": 2, "CRITICAL": 3}
RISK_NAMES = {v: k for k, v in RISK_LEVELS.items()}


def calculate_cumulative_risk(history: dict, current_risk: str) -> str:
    """Calculate cumulative session risk based on history and current command.

    Risk escalates based on:
    - Number of DANGEROUS commands
    - Detected workflow patterns
    - Files at risk
    """
    max_risk = RISK_LEVELS.get(current_risk, 1)

    dangerous_count = 0
    for cmd in history.get("commands", []):
        cmd_risk = cmd.get("risk", "MODERATE")
        if cmd_risk == "DANGEROUS":
            dangerous_count += 1
        max_risk = max(max_risk, RISK_LEVELS.get(cmd_risk, 1))

    if dangerous_count >= 5:
        max_risk = max(max_risk, RISK_LEVELS["CRITICAL"])
    elif dangerous_count >= 3:
        max_risk = max(max_risk, RISK_LEVELS["HIGH"])

    for pattern in history.get("patterns_detected", []):
        pattern_risk = pattern[1] if len(pattern) > 1 else "HIGH"
        max_risk = max(max_risk, RISK_LEVELS.get(pattern_risk, 2))

    return RISK_NAMES.get(max_risk, "MODERATE")


def get_destruction_consequences(command: str, cwd: str = ".") -> dict | None:
    """Analyze what a destructive command will actually delete/modify.

    Returns dict with:
    - files: list of files that will be affected
    - dirs: list of directories that will be affected
    - total_lines: estimated lines of code at risk
    - total_size: total size in bytes
    - warning: human-readable consequence summary
    - type: the type of destruction (rm, git_reset, git_clean, etc.)

    Returns None if command is not destructive or paths don't exist.
    """
    consequences = {
        "files": [],
        "dirs": [],
        "total_lines": 0,
        "total_size": 0,
        "warning": "",
        "type": None
    }

    # Check for git reset --hard (discards uncommitted changes)
    if re.search(r'git\s+reset\s+--hard', command):
        return _analyze_git_reset_hard(cwd, consequences)

    # Check for git clean (removes untracked files)
    if re.search(r'git\s+clean', command):
        return _analyze_git_clean(cwd, consequences)

    # Check for git checkout -- (discards uncommitted changes to tracked files)
    if re.search(r'git\s+checkout\s+--', command) or re.search(r'git\s+checkout\s+\.\s*$', command):
        return _analyze_git_checkout_discard(cwd, consequences)

    # Check for git stash drop (permanently deletes stashed changes)
    if re.search(r'git\s+stash\s+drop', command):
        return _analyze_git_stash_drop(cwd, command, consequences)

    # Detect rm commands and extract targets
    rm_pattern = r'rm\s+(?:-[rfivd]+\s+)*(.+?)(?:\s*[|;&>]|$)'
    rm_match = re.search(rm_pattern, command)

    # Detect git rm commands
    git_rm_pattern = r'git\s+rm\s+(?:-[rf]+\s+)*(.+?)(?:\s*[|;&>]|$)'
    git_rm_match = re.search(git_rm_pattern, command)

    targets = []
    if rm_match:
        # Split by spaces but respect quotes
        target_str = rm_match.group(1).strip()
        targets = target_str.split()
        consequences["type"] = "rm"
    elif git_rm_match:
        target_str = git_rm_match.group(1).strip()
        targets = target_str.split()
        consequences["type"] = "git_rm"

    if not targets:
        return None

    # Analyze each target
    for target in targets:
        if target.startswith('-'):
            continue  # Skip flags

        # Expand path relative to cwd
        if not os.path.isabs(target):
            target = os.path.join(cwd, target)
        target = os.path.expanduser(target)

        # Handle glob patterns
        if '*' in target or '?' in target:
            import glob
            expanded = glob.glob(target, recursive=True)
            for path in expanded:
                _analyze_path(path, consequences)
        elif os.path.exists(target):
            _analyze_path(target, consequences)

    # Generate warning message
    if consequences["files"] or consequences["dirs"]:
        file_count = len(consequences["files"])
        dir_count = len(consequences["dirs"])
        lines = consequences["total_lines"]
        size_kb = consequences["total_size"] / 1024

        parts = []
        if file_count:
            parts.append(f"{file_count} file{'s' if file_count > 1 else ''}")
        if dir_count:
            parts.append(f"{dir_count} director{'ies' if dir_count > 1 else 'y'}")

        consequences["warning"] = f"⚠️  WILL DELETE: {', '.join(parts)}"
        if lines > 0:
            consequences["warning"] += f" ({lines:,} lines of code)"
        if size_kb > 1:
            consequences["warning"] += f" [{size_kb:.1f} KB]"

        # Show preview of what will be deleted
        preview_files = consequences["files"][:10]
        if preview_files:
            consequences["warning"] += "\n    Files:"
            for f in preview_files:
                consequences["warning"] += f"\n      - {f}"
            if len(consequences["files"]) > 10:
                consequences["warning"] += f"\n      ... and {len(consequences['files']) - 10} more"

        return consequences

    return None


def _analyze_path(path: str, consequences: dict):
    """Helper to analyze a single path and add to consequences."""
    # SECURITY: Never walk root or system directories - would hang forever
    DANGEROUS_ROOTS = {'/', '/bin', '/sbin', '/usr', '/etc', '/var', '/System', '/Library'}
    if path in DANGEROUS_ROOTS or os.path.dirname(path) == '/':
        consequences["dirs"].append(path)
        consequences["warning"] = f"⚠️  TARGETS SYSTEM DIRECTORY: {path}"
        return

    try:
        if os.path.isfile(path):
            consequences["files"].append(path)
            size, lines = _count_file_stats(path)
            consequences["total_size"] += size
            consequences["total_lines"] += lines

        elif os.path.isdir(path):
            consequences["dirs"].append(path)
            for root, _, files in os.walk(path):
                for filename in files:
                    filepath = os.path.join(root, filename)
                    consequences["files"].append(filepath)
                    size, lines = _count_file_stats(filepath)
                    consequences["total_size"] += size
                    consequences["total_lines"] += lines
    except (OSError, PermissionError):
        pass


def _analyze_git_reset_hard(cwd: str, consequences: dict) -> dict | None:
    """Analyze what git reset --hard will discard.

    Runs git diff HEAD to see uncommitted changes that will be lost.
    """
    consequences["type"] = "git_reset_hard"

    try:
        # Get list of modified files
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True, text=True, timeout=10, cwd=cwd
        )

        if status_result.returncode != 0:
            return None  # Not a git repo

        if not status_result.stdout.strip():
            return None  # No uncommitted changes, reset is safe

        # Parse modified files
        for line in status_result.stdout.strip().split('\n'):
            if len(line) >= 3:
                status = line[:2]
                filepath = line[3:].strip()

                # Handle renamed files (R  old -> new)
                if ' -> ' in filepath:
                    filepath = filepath.split(' -> ')[1]

                full_path = os.path.join(cwd, filepath)

                # M = modified, A = added, D = deleted, ? = untracked
                if status[0] in 'MA' or status[1] in 'MA':
                    consequences["files"].append(filepath)
                    if os.path.exists(full_path):
                        size, lines = _count_file_stats(full_path)
                        consequences["total_size"] += size
                        consequences["total_lines"] += lines

        # Get actual diff to show what changes will be lost
        diff_result = subprocess.run(
            ["git", "diff", "HEAD", "--stat"],
            capture_output=True, text=True, timeout=10, cwd=cwd
        )

        if not consequences["files"]:
            return None

        # Build warning message
        file_count = len(consequences["files"])
        lines = consequences["total_lines"]

        consequences["warning"] = f"⚠️  UNCOMMITTED CHANGES WILL BE DISCARDED: {file_count} file{'s' if file_count > 1 else ''}"
        if lines > 0:
            consequences["warning"] += f" ({lines:,} lines of changes)"

        consequences["warning"] += "\n    Modified files:"
        for f in consequences["files"][:10]:
            consequences["warning"] += f"\n      - {f}"
        if len(consequences["files"]) > 10:
            consequences["warning"] += f"\n      ... and {len(consequences['files']) - 10} more"

        if diff_result.stdout:
            # Add the stat summary
            stat_lines = diff_result.stdout.strip().split('\n')
            if stat_lines:
                consequences["warning"] += f"\n\n    {stat_lines[-1]}"  # Summary line like "5 files changed, 120 insertions(+), 30 deletions(-)"

        return consequences

    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


def _analyze_git_clean(cwd: str, consequences: dict) -> dict | None:
    """Analyze what git clean will remove.

    Runs git clean -n (dry run) to preview what would be deleted.
    """
    consequences["type"] = "git_clean"

    try:
        # Dry run to see what would be removed
        # -d includes directories, -f is required, -n is dry run
        clean_result = subprocess.run(
            ["git", "clean", "-dfn"],
            capture_output=True, text=True, timeout=10, cwd=cwd
        )

        if clean_result.returncode != 0:
            return None

        if not clean_result.stdout.strip():
            return None  # Nothing to clean

        # Parse output: "Would remove path/to/file"
        for line in clean_result.stdout.strip().split('\n'):
            if not line.startswith("Would remove "):
                continue

            filepath = line[len("Would remove "):].strip()
            full_path = os.path.join(cwd, filepath)

            if os.path.isdir(full_path):
                consequences["dirs"].append(filepath)
                for root, _, files in os.walk(full_path):
                    for filename in files:
                        fpath = os.path.join(root, filename)
                        consequences["files"].append(fpath)
                        size, lines = _count_file_stats(fpath)
                        consequences["total_size"] += size
                        consequences["total_lines"] += lines
            else:
                consequences["files"].append(filepath)
                if os.path.exists(full_path):
                    size, lines = _count_file_stats(full_path)
                    consequences["total_size"] += size
                    consequences["total_lines"] += lines

        if not consequences["files"] and not consequences["dirs"]:
            return None

        # Build warning
        file_count = len(consequences["files"])
        dir_count = len(consequences["dirs"])
        lines = consequences["total_lines"]

        consequences["warning"] = f"⚠️  UNTRACKED FILES WILL BE DELETED: {file_count} file{'s' if file_count != 1 else ''}"
        if dir_count:
            consequences["warning"] += f", {dir_count} director{'ies' if dir_count != 1 else 'y'}"
        if lines > 0:
            consequences["warning"] += f" ({lines:,} lines)"

        consequences["warning"] += "\n    Will remove:"
        for f in consequences["files"][:10]:
            consequences["warning"] += f"\n      - {f}"
        if len(consequences["files"]) > 10:
            consequences["warning"] += f"\n      ... and {len(consequences['files']) - 10} more"

        return consequences

    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


def _analyze_git_checkout_discard(cwd: str, consequences: dict) -> dict | None:
    """Analyze what git checkout -- will discard.

    Shows modified tracked files that will lose their changes.
    """
    consequences["type"] = "git_checkout_discard"

    try:
        # Get modified files (not staged)
        diff_result = subprocess.run(
            ["git", "diff", "--name-only"],
            capture_output=True, text=True, timeout=10, cwd=cwd
        )

        if diff_result.returncode != 0:
            return None

        if not diff_result.stdout.strip():
            return None  # No modifications to discard

        for filepath in diff_result.stdout.strip().split('\n'):
            filepath = filepath.strip()
            if not filepath:
                continue

            consequences["files"].append(filepath)
            full_path = os.path.join(cwd, filepath)

            if os.path.exists(full_path):
                size, lines = _count_file_stats(full_path)
                consequences["total_size"] += size
                consequences["total_lines"] += lines

        if not consequences["files"]:
            return None

        # Get diff stat for summary
        stat_result = subprocess.run(
            ["git", "diff", "--stat"],
            capture_output=True, text=True, timeout=10, cwd=cwd
        )

        file_count = len(consequences["files"])
        consequences["warning"] = f"⚠️  UNCOMMITTED CHANGES WILL BE DISCARDED: {file_count} file{'s' if file_count != 1 else ''}"

        consequences["warning"] += "\n    Modified files:"
        for f in consequences["files"][:10]:
            consequences["warning"] += f"\n      - {f}"
        if len(consequences["files"]) > 10:
            consequences["warning"] += f"\n      ... and {len(consequences['files']) - 10} more"

        if stat_result.stdout:
            stat_lines = stat_result.stdout.strip().split('\n')
            if stat_lines:
                consequences["warning"] += f"\n\n    {stat_lines[-1]}"

        return consequences

    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


def _analyze_git_stash_drop(cwd: str, command: str, consequences: dict) -> dict | None:
    """Analyze what git stash drop will permanently delete.

    Shows the content of the stash being dropped.
    """
    consequences["type"] = "git_stash_drop"

    try:
        # Parse which stash is being dropped (default is stash@{0})
        stash_ref = "stash@{0}"
        match = re.search(r'stash@\{(\d+)\}', command)
        if match:
            stash_ref = f"stash@{{{match.group(1)}}}"

        # Get stash info
        show_result = subprocess.run(
            ["git", "stash", "show", "--stat", stash_ref],
            capture_output=True, text=True, timeout=10, cwd=cwd
        )

        if show_result.returncode != 0:
            return None  # Stash doesn't exist

        # Parse files from stash show output
        for line in show_result.stdout.strip().split('\n'):
            # Lines look like: " file.txt | 10 +++---"
            if '|' in line:
                filepath = line.split('|')[0].strip()
                if filepath:
                    consequences["files"].append(filepath)

        if not consequences["files"]:
            return None

        file_count = len(consequences["files"])
        consequences["warning"] = f"⚠️  STASH WILL BE PERMANENTLY DELETED: {stash_ref} ({file_count} file{'s' if file_count != 1 else ''})"

        consequences["warning"] += "\n    Stashed changes:"
        for f in consequences["files"][:10]:
            consequences["warning"] += f"\n      - {f}"
        if len(consequences["files"]) > 10:
            consequences["warning"] += f"\n      ... and {len(consequences['files']) - 10} more"

        # Add the stat summary
        stat_lines = show_result.stdout.strip().split('\n')
        if stat_lines:
            consequences["warning"] += f"\n\n    {stat_lines[-1]}"

        return consequences

    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


TEXT_EXTENSIONS = {
    '.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.yaml', '.yml',
    '.md', '.txt', '.sh', '.bash', '.zsh', '.fish',
    '.html', '.css', '.scss', '.sass', '.less',
    '.java', '.kt', '.scala', '.go', '.rs', '.rb', '.php',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.m',
    '.sql', '.graphql', '.proto', '.xml', '.toml', '.ini', '.cfg',
    '.env', '.gitignore', '.dockerignore', 'Makefile', 'Dockerfile',
    '.vue', '.svelte', '.astro'
}


def _is_text_file(path: str) -> bool:
    """Check if file is likely a text/code file based on extension."""
    _, ext = os.path.splitext(path)
    return ext.lower() in TEXT_EXTENSIONS or os.path.basename(path) in TEXT_EXTENSIONS


def _count_file_stats(filepath: str) -> tuple[int, int]:
    """Count size and lines for a file. Returns (size_bytes, line_count)."""
    try:
        size = os.path.getsize(filepath)
        lines = 0
        if _is_text_file(filepath):
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                lines = sum(1 for _ in f)
        return size, lines
    except (IOError, PermissionError, OSError):
        return 0, 0


def get_backup_dir() -> str:
    """Get the Deliberate backup directory."""
    return os.path.expanduser("~/.deliberate/backups")


def create_pre_destruction_backup(
    session_id: str,
    command: str,
    cwd: str,
    consequences: dict | None,
    history: dict | None
) -> str | None:
    """Create automatic backup before CRITICAL operations.

    Backs up:
    - Files that will be affected (if consequences provided)
    - Current git state (branch, uncommitted changes)
    - Session command history (for context)

    Returns backup path if successful, None if backup failed/skipped.
    """
    import shutil

    backup_base = get_backup_dir()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Create project-specific backup dir
    project_name = os.path.basename(cwd) or "unknown"
    backup_dir = os.path.join(backup_base, project_name, timestamp)

    try:
        os.makedirs(backup_dir, exist_ok=True)

        # 1. Track file mappings for restore
        file_mappings = []  # {"original": absolute path, "backup": relative path in backup}

        # 2. Backup files at risk (if we have them)
        if consequences and consequences.get("files"):
            files_dir = os.path.join(backup_dir, "files")
            os.makedirs(files_dir, exist_ok=True)

            backed_up = 0
            for filepath in consequences["files"][:100]:  # Limit to 100 files
                # Resolve to absolute path
                if os.path.isabs(filepath):
                    abs_path = filepath
                else:
                    abs_path = os.path.join(cwd, filepath)

                if os.path.exists(abs_path) and os.path.isfile(abs_path):
                    try:
                        # Preserve directory structure relative to cwd
                        rel_path = os.path.relpath(abs_path, cwd)
                        dest_path = os.path.join(files_dir, rel_path)
                        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
                        shutil.copy2(abs_path, dest_path)

                        # Track mapping for restore
                        file_mappings.append({
                            "original": abs_path,
                            "backup": os.path.join("files", rel_path)
                        })
                        backed_up += 1
                    except (IOError, OSError, shutil.Error):
                        pass

            debug(f"Backed up {backed_up} files to {files_dir}")

        # 3. Save metadata with file mappings for restore
        metadata = {
            "timestamp": datetime.now().isoformat(),
            "session_id": session_id,
            "command": command,
            "cwd": cwd,
            "consequences": consequences,
            "history": history,
            "file_mappings": file_mappings,  # For restore: original path -> backup path
            "version": "2.0"  # Metadata format version
        }
        with open(os.path.join(backup_dir, "metadata.json"), 'w') as f:
            json.dump(metadata, f, indent=2)

        # 3. Capture git state if in a repo
        git_dir = os.path.join(backup_dir, "git_state")
        os.makedirs(git_dir, exist_ok=True)

        try:
            # Get current branch
            branch_result = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                capture_output=True, text=True, timeout=5, cwd=cwd
            )
            if branch_result.returncode == 0:
                with open(os.path.join(git_dir, "branch.txt"), 'w') as f:
                    f.write(branch_result.stdout.strip())

            # Get current commit
            commit_result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                capture_output=True, text=True, timeout=5, cwd=cwd
            )
            if commit_result.returncode == 0:
                with open(os.path.join(git_dir, "commit.txt"), 'w') as f:
                    f.write(commit_result.stdout.strip())

            # Get status
            status_result = subprocess.run(
                ["git", "status", "--porcelain"],
                capture_output=True, text=True, timeout=10, cwd=cwd
            )
            if status_result.returncode == 0:
                with open(os.path.join(git_dir, "status.txt"), 'w') as f:
                    f.write(status_result.stdout)

            # Get diff of uncommitted changes
            diff_result = subprocess.run(
                ["git", "diff", "HEAD"],
                capture_output=True, text=True, timeout=30, cwd=cwd
            )
            if diff_result.returncode == 0 and diff_result.stdout:
                with open(os.path.join(git_dir, "uncommitted.diff"), 'w') as f:
                    f.write(diff_result.stdout)

        except (subprocess.TimeoutExpired, FileNotFoundError):
            debug("Git state capture skipped (not a git repo or git unavailable)")

        debug(f"Created backup at {backup_dir}")
        return backup_dir

    except Exception as e:
        debug(f"Backup failed: {e}")
        return None


def load_backup_config() -> dict:
    """Load backup configuration from config file."""
    backup = _load_config().get("backup", {})
    return {
        "enabled": backup.get("enabled", True),
        "maxBackups": backup.get("maxBackups", 50),
        "riskThreshold": backup.get("riskThreshold", "CRITICAL")
    }


def add_command_to_history(session_id: str, command: str, risk: str, explanation: str):
    """Add a command to session history and update cumulative analysis."""
    history = load_command_history(session_id)

    # Add command entry
    history["commands"].append({
        "command": command[:500],  # Truncate long commands
        "risk": risk,
        "explanation": explanation[:200] if explanation else "",
        "timestamp": datetime.now().isoformat()
    })

    # Keep only last 50 commands to prevent unbounded growth
    if len(history["commands"]) > 50:
        history["commands"] = history["commands"][-50:]

    # Detect workflow patterns
    patterns = detect_workflow_patterns(history, command)
    if patterns:
        for pattern in patterns:
            if pattern not in history["patterns_detected"]:
                history["patterns_detected"].append(pattern)

    # Update cumulative risk
    history["cumulative_risk"] = calculate_cumulative_risk(history, risk)

    # Track files at risk
    affected_paths = extract_affected_paths(command)
    for path in affected_paths:
        if path not in history["files_at_risk"]:
            history["files_at_risk"].append(path)

    # Keep files_at_risk bounded
    if len(history["files_at_risk"]) > 100:
        history["files_at_risk"] = history["files_at_risk"][-100:]

    save_command_history(session_id, history)


def save_state(session_id: str, shown_warnings: set):
    """Save the set of shown warning keys."""
    state_file = get_state_file(session_id)
    try:
        os.makedirs(os.path.dirname(state_file), exist_ok=True)
        with open(state_file, 'w') as f:
            json.dump(list(shown_warnings), f)
    except IOError:
        pass


def get_warning_key(command: str) -> str:
    """Generate a unique key for deduplication based on command hash."""
    # MD5 used for cache key only, not security
    cmd_hash = hashlib.md5(command.encode(), usedforsecurity=False).hexdigest()[:12]
    return f"cmd-{cmd_hash}"


def get_cache_file(session_id: str, cmd_hash: str) -> str:
    """Get cache file for Pre/Post hook result sharing.

    Uses ~/.claude/ instead of /tmp for security - avoids symlink attacks
    and race conditions on shared systems.
    """
    return os.path.expanduser(f"~/.claude/deliberate_cmd_cache_{session_id}_{cmd_hash}.json")


def save_to_cache(session_id: str, cmd_hash: str, data: dict):
    """Save analysis result to cache for PostToolUse to read."""
    cache_file = get_cache_file(session_id, cmd_hash)
    try:
        with open(cache_file, 'w') as f:
            json.dump(data, f)
        debug(f"Cached result to {cache_file}")
    except IOError as e:
        debug(f"Failed to cache: {e}")


_config_cache = None
_config_cache_mtime_ns = None


def _load_config() -> dict:
    """Load config from CONFIG_FILE with simple caching.

    We keep caching to make hooks fast, but we must also react quickly to user
    toggles from the TUI (enable/disable, skip/block updates). So we invalidate
    the cache when the config file mtime changes.
    """
    global _config_cache, _config_cache_mtime_ns
    try:
        config_path = Path(CONFIG_FILE)
        stat = config_path.stat() if config_path.exists() else None
        mtime_ns = stat.st_mtime_ns if stat else None
        if _config_cache is not None and _config_cache_mtime_ns == mtime_ns:
            return _config_cache
        _config_cache_mtime_ns = mtime_ns
    except Exception:
        # If stat fails, fall back to previous cache.
        if _config_cache is not None:
            return _config_cache
    try:
        config_path = Path(CONFIG_FILE)
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                _config_cache = json.load(f)
                return _config_cache
    except Exception:
        pass
    _config_cache = {}
    return _config_cache


def deliberate_enabled() -> bool:
    """Global Deliberate enable switch (default: enabled)."""
    try:
        deliberate = _load_config().get("deliberate", {})
        value = (deliberate or {}).get("enabled")
        if isinstance(value, bool):
            return value
    except Exception:
        pass
    return True


def load_dedup_config() -> bool:
    """Load deduplication config - returns True if dedup is enabled (default)."""
    return _load_config().get("deduplication", {}).get("enabled", True)


def load_terminal_explanations_mode() -> str:
    """Load GUI terminal surfacing mode from config.

    Modes:
      - full: show full explanation in terminal (v1 behavior)
      - minimal: show a short pointer in terminal, details in the Deliberate pane
      - gui: same as minimal for PreToolUse (permission gate must stay visible)
    """
    try:
        mode = (_load_config().get("gui", {}) or {}).get("terminalExplanations", "full")
        if mode in ("full", "minimal", "gui"):
            return mode
    except Exception:
        pass
    return "full"

def load_web_search_config() -> dict:
    """Load scoped web search configuration from config (default enabled).

    This is intentionally not arbitrary browsing. It only hits known structured
    sources (npm, PyPI, GitHub, GitLab) and returns evidence that Deliberate can
    show to the user during approvals.
    """
    try:
        deliberate = _load_config().get("deliberate", {}) or {}
        ws = deliberate.get("webSearch", {}) or {}

        enabled = ws.get("enabled", True)
        sources = ws.get("sources", ["npm", "pypi", "github", "gitlab"])
        max_results = ws.get("maxResultsPerSource", 3)

        if not isinstance(sources, list):
            sources = ["npm", "pypi", "github", "gitlab"]

        try:
            max_results = int(max_results)
        except Exception:
            max_results = 3

        max_results = max(1, min(max_results, 5))

        return {
            "enabled": bool(enabled),
            "sources": [str(s).lower() for s in sources if isinstance(s, (str, int))],
            "maxResultsPerSource": max_results,
        }
    except Exception:
        return {"enabled": True, "sources": ["npm", "pypi", "github", "gitlab"], "maxResultsPerSource": 3}


def _http_get_json(url: str, timeout_s: float = 0.8, max_bytes: int = 250_000) -> Optional[dict]:
    """Fetch JSON with hard limits. Fail-open and never raise to callers."""
    try:
        req = urllib.request.Request(
            url,
            method="GET",
            headers={
                "User-Agent": "deliberate/1.0 (+https://github.com/the-radar/deliberate)",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:  # nosec B310
            data = resp.read(max_bytes + 1)
            if len(data) > max_bytes:
                return None
            try:
                return json.loads(data.decode("utf-8", errors="replace"))
            except Exception:
                return None
    except Exception:
        return None


def _extract_repo_candidates(ref: str) -> List[str]:
    """Extract repository name candidates from git/GitHub/GitLab references."""
    text = str(ref or "").strip()
    if not text:
        return []

    out: List[str] = []

    # Prefer explicit egg names when provided in pip style URLs.
    egg_match = re.search(r"#egg=([A-Za-z0-9_.\-]+)", text)
    if egg_match:
        out.append(egg_match.group(1))

    # `github:owner/repo` and `gitlab:group/repo` shorthand.
    for shorthand in ("github:", "gitlab:"):
        if text.startswith(shorthand):
            slug = text.split(":", 1)[1]
            slug = slug.split("#", 1)[0].split("?", 1)[0].strip("/")
            if slug.endswith(".git"):
                slug = slug[:-4]
            if slug:
                out.append(slug)
                out.append(slug.split("/")[-1])

    # URL and SSH formats:
    # - https://github.com/owner/repo(.git)
    # - git@github.com:owner/repo(.git)
    # - https://gitlab.com/group/subgroup/repo(.git)
    repo_match = re.search(r"(?:https?://|git@)(?:www\.)?(github\.com|gitlab\.com)[:/]+([^\s#?]+)", text)
    if repo_match:
        path_part = repo_match.group(2).strip("/")
        if path_part.endswith(".git"):
            path_part = path_part[:-4]
        if path_part:
            out.append(path_part)
            out.append(path_part.split("/")[-1])

    # De-duplicate while keeping order.
    deduped: List[str] = []
    seen = set()
    for name in out:
        n = str(name or "").strip()
        if not n or n in seen:
            continue
        seen.add(n)
        deduped.append(n)
    return deduped


def _normalize_package_candidate(raw: str) -> Optional[str]:
    """Normalize package-like tokens from install commands."""
    value = str(raw or "").strip().strip(",")
    if not value:
        return None

    # Filter obvious non-package tokens early.
    if value in ("|", "||", "&&", ";") or value.startswith("-"):
        return None
    if value.startswith(("/", "./", "../", "~/")):
        return None

    # Repo references are handled by a dedicated helper.
    if value.startswith(("git+", "http://", "https://", "git@")):
        return None
    if "github.com/" in value or "gitlab.com/" in value:
        return None
    if value.startswith(("github:", "gitlab:")):
        return None

    # Strip environment markers used by pip (`; python_version ...`).
    value = value.split(";", 1)[0].strip()
    if not value:
        return None

    # Strip extras suffix (`package[extra]`).
    value = re.sub(r"\[[^\]]+\]$", "", value).strip()
    if not value:
        return None

    # Strip pip-style version constraints.
    value = re.split(r"(?:==|~=|!=|>=|<=|>|<)", value, maxsplit=1)[0].strip()
    if not value:
        return None

    # Strip npm-style @version while preserving @scope/pkg names.
    if value.startswith("@"):
        # @scope/pkg@1.2.3 -> @scope/pkg
        if "@" in value[1:]:
            value = value.rsplit("@", 1)[0].strip()
    elif "@" in value:
        # package@1.2.3 -> package
        value = value.split("@", 1)[0].strip()

    if not value:
        return None

    # Avoid path-like references unless they are scoped npm packages.
    if "/" in value and not value.startswith("@"):
        return None

    return value


def _collect_install_tokens(tokens: List[str]) -> List[str]:
    """Collect likely package tokens from common install/exec command forms."""
    if not tokens:
        return []

    def is_sep(tok: str) -> bool:
        return tok in ("|", "||", "&&", ";")

    start = None
    prefix = tuple(tokens[:4])

    if len(tokens) >= 2 and tokens[0] == "npm" and tokens[1] in ("install", "i", "add", "exec", "x", "pack"):
        start = 2
    elif len(tokens) >= 2 and tokens[0] == "pnpm" and tokens[1] in ("add", "install", "dlx"):
        start = 2
    elif len(tokens) >= 2 and tokens[0] == "yarn" and tokens[1] in ("add", "dlx"):
        start = 2
    elif len(tokens) >= 2 and tokens[0] in ("npx", "bunx"):
        start = 1
    elif len(tokens) >= 2 and tokens[0] == "bun" and tokens[1] in ("add", "x"):
        start = 2
    elif len(tokens) >= 2 and tokens[0] in ("pip", "pip3") and tokens[1] == "install":
        start = 2
    elif len(tokens) >= 4 and prefix[:4] in (
        ("python", "-m", "pip", "install"),
        ("python3", "-m", "pip", "install"),
    ):
        start = 4
    elif len(tokens) >= 3 and tuple(tokens[:3]) == ("uv", "pip", "install"):
        start = 3
    elif len(tokens) >= 3 and tuple(tokens[:3]) == ("uv", "tool", "install"):
        start = 3

    if start is None:
        return []

    out: List[str] = []
    for token in tokens[start:]:
        if is_sep(token):
            break
        out.append(token)
    return out


def _extract_candidate_names(command: str) -> List[str]:
    """Best-effort extract likely package/binary names from a shell command."""
    try:
        tokens = shlex.split(command)
    except Exception:
        tokens = str(command).split()

    if not tokens:
        return []

    candidates: List[str] = []

    def push(name: str, allow_path: bool = False):
        n = str(name or "").strip()
        if not n:
            return
        if n.startswith("-") or n.startswith("./"):
            return
        if "/" in n and not allow_path and not n.startswith("@"):
            return
        candidates.append(n)

    # Install/exec command parsing catches explicit package names.
    for raw in _collect_install_tokens(tokens):
        for repo_name in _extract_repo_candidates(raw):
            # Keep both full slug and repo basename for better matching.
            push(repo_name, allow_path=True)
        normalized = _normalize_package_candidate(raw)
        if normalized:
            push(normalized)

    # Also consider the command itself as a candidate binary.
    head = tokens[0]
    push(head)

    out: List[str] = []
    seen = set()
    for c in candidates:
        if c in seen:
            continue
        seen.add(c)
        out.append(c)
    return out[:8]


def _local_node_bin_evidence(name: str, cwd: str) -> Optional[dict]:
    """Try to map a binary name to a local npm package via node_modules/.bin."""
    try:
        if not cwd or not name:
            return None
        bin_path = Path(cwd) / "node_modules" / ".bin" / name
        if not bin_path.exists():
            return None

        resolved = bin_path.resolve()
        parts = list(resolved.parts)
        if "node_modules" not in parts:
            return None
        idx = parts.index("node_modules")
        if idx + 1 >= len(parts):
            return None

        pkg_dir = Path(*parts[: idx + 2])
        pkg_json = pkg_dir / "package.json"
        if not pkg_json.exists():
            return None

        with open(pkg_json, "r", encoding="utf-8") as f:
            pkg = json.load(f) or {}

        pkg_name = pkg.get("name") or str(pkg_dir.name)
        repo = pkg.get("repository") or {}
        if isinstance(repo, str):
            repo_url = repo
        elif isinstance(repo, dict):
            repo_url = repo.get("url")
        else:
            repo_url = None

        return {
            "source": "local",
            "type": "npm",
            "name": str(pkg_name),
            "version": pkg.get("version"),
            "description": pkg.get("description"),
            "url": pkg.get("homepage") or repo_url,
            "confidence": "high",
        }
    except Exception:
        return None


def web_search_evidence(command: str, cwd: str, session_id: str) -> List[dict]:
    """Scoped web search that returns evidence objects (fail-open).

    We cache per-session lookups so repeated tools (for example browser-use)
    do not trigger fresh network requests on every command.
    """
    ws = load_web_search_config()
    if not ws.get("enabled", True):
        return []

    sources = set(ws.get("sources") or [])
    max_results = ws.get("maxResultsPerSource", 3)
    cache = load_web_lookup_cache(session_id)
    cache_dirty = False
    now_ts = time.time()

    evidence: List[dict] = []

    for name in _extract_candidate_names(command):
        cache_key = str(name or "").lower()
        cached_entry = cache.get(cache_key) if isinstance(cache, dict) else None
        if isinstance(cached_entry, dict):
            ts = cached_entry.get("ts", 0)
            age_ok = isinstance(ts, (int, float)) and (now_ts - float(ts)) < WEB_CACHE_TTL_SECONDS
            cached_items = cached_entry.get("evidence", [])
            if age_ok and isinstance(cached_items, list):
                evidence.extend(cached_items)
                continue

        name_evidence: List[dict] = []
        local = _local_node_bin_evidence(name, cwd)
        if local:
            name_evidence.append(local)

        enc = urllib.parse.quote(name, safe="@/._-")

        if "npm" in sources:
            data = _http_get_json(f"https://registry.npmjs.org/{enc}")
            if data and isinstance(data, dict) and data.get("name"):
                dist = data.get("dist-tags", {}) or {}
                latest = dist.get("latest")
                repo = (data.get("repository") or {}) if isinstance(data.get("repository"), dict) else {}
                url = data.get("homepage") or repo.get("url")
                name_evidence.append({
                    "source": "npm",
                    "name": data.get("name"),
                    "version": latest,
                    "description": data.get("description"),
                    "url": url,
                    "confidence": "medium",
                })

        if "pypi" in sources:
            data = _http_get_json(f"https://pypi.org/pypi/{enc}/json")
            info = (data or {}).get("info") if isinstance(data, dict) else None
            if info and isinstance(info, dict) and info.get("name"):
                name_evidence.append({
                    "source": "pypi",
                    "name": info.get("name"),
                    "version": info.get("version"),
                    "description": info.get("summary"),
                    "url": info.get("home_page") or info.get("project_url"),
                    "confidence": "medium",
                })

        if "github" in sources:
            data = _http_get_json(f"https://api.github.com/search/repositories?q={enc}+in:name&per_page={max_results}")
            items = (data or {}).get("items") if isinstance(data, dict) else None
            if isinstance(items, list):
                for item in items[:max_results]:
                    if not isinstance(item, dict):
                        continue
                    name_evidence.append({
                        "source": "github",
                        "name": item.get("full_name") or item.get("name"),
                        "description": item.get("description"),
                        "url": item.get("html_url"),
                        "stars": item.get("stargazers_count"),
                        "confidence": "low",
                    })

        if "gitlab" in sources:
            data = _http_get_json(f"https://gitlab.com/api/v4/projects?search={enc}&simple=true&per_page={max_results}")
            if isinstance(data, list):
                for item in data[:max_results]:
                    if not isinstance(item, dict):
                        continue
                    name_evidence.append({
                        "source": "gitlab",
                        "name": item.get("path_with_namespace") or item.get("name"),
                        "description": item.get("description"),
                        "url": item.get("web_url"),
                        "stars": item.get("star_count"),
                        "confidence": "low",
                    })

        evidence.extend(name_evidence)
        if cache_key:
            cache[cache_key] = {
                "ts": now_ts,
                "evidence": name_evidence[:20]
            }
            cache_dirty = True

    if cache_dirty and isinstance(cache, dict):
        # Keep cache bounded so session cache files do not grow unbounded.
        keys = list(cache.keys())
        if len(keys) > WEB_CACHE_MAX_ENTRIES:
            keys_sorted = sorted(
                keys,
                key=lambda k: (cache.get(k) or {}).get("ts", 0)
            )
            for stale_key in keys_sorted[: len(keys) - WEB_CACHE_MAX_ENTRIES]:
                cache.pop(stale_key, None)
        save_web_lookup_cache(session_id, cache)

    deduped: List[dict] = []
    seen = set()
    for ev in evidence:
        key = (ev.get("source"), ev.get("name"), ev.get("url"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(ev)

    return deduped[:20]


def format_evidence_summary(evidence: List[dict]) -> str:
    """Compact evidence summary for terminal/context. Keep it short."""
    if not evidence:
        return ""
    lines = []
    for ev in evidence[:3]:
        try:
            src = str(ev.get("source") or "?")
            name = str(ev.get("name") or "")
            ver = ev.get("version")
            url = ev.get("url")
            if ver:
                head = f"- {src}: {name}@{ver}"
            else:
                head = f"- {src}: {name}"
            if url:
                head += f" ({url})"
            lines.append(head)
        except Exception:
            continue
    return "\n".join(lines)


# Default trivial commands that are TRULY safe - no abuse potential
# These are skipped entirely (no analysis, no output) for performance
# SECURITY: Commands that can read sensitive files (cat, head, tail, less, more),
# leak secrets (env, printenv, echo), or execute commands (command) are NOT included
DEFAULT_SKIP_COMMANDS = {
    # Directory listing only (cannot read file contents)
    "ls", "ll", "la", "dir", "tree",
    # Current state queries (no sensitive data exposure)
    "pwd", "whoami", "hostname", "date", "uptime", "uname",
    # Binary location queries (safe - just paths)
    "which", "whereis", "type -t", "type -a",
    # Git read operations (repo metadata only)
    "git status", "git log", "git diff", "git branch", "git remote -v",
    "git blame", "git shortlog", "git tag", "git stash list",
}

# Shell operators for splitting pipelines into individual commands
PIPELINE_SEPARATORS = ["&&", "||", ";", "|"]

# Operators that indicate file redirection - need special handling
REDIRECT_OPERATORS = {">", ">>", "<", "2>&1", "2>", "&>"}

# Command substitution patterns - these are genuinely dangerous, never skip
DANGEROUS_SUBSTITUTION = {"`", "$("}

# Default safe commands that can appear anywhere in a pipeline
DEFAULT_SAFE_COMMANDS = {
    "sleep", "head", "tail", "wc", "sort", "uniq", "grep", "cat",
    "true", "false", "echo", "printf", "tee", "tr", "cut", "awk", "sed",
    "xargs", "timeout", "time"
}


def load_skip_commands() -> set:
    """Load skip commands list from config, with defaults."""
    skip_set = DEFAULT_SKIP_COMMANDS.copy()
    skip_config = _load_config().get("skipCommands", {})

    # Add user-configured commands (by basename)
    for cmd in skip_config.get("additional", []):
        skip_set.add(cmd)

    # Also support explicit basenames field
    for cmd in skip_config.get("basenames", []):
        skip_set.add(cmd)

    for cmd in skip_config.get("remove", []):
        skip_set.discard(cmd)

    return skip_set


def normalize_command_for_custom_lists(command: str) -> str:
    """Normalize a command line for skip/block list matching.

    We do a light normalization to reduce wrapper noise without trying to fully
    parse shell syntax.
    """
    cmd = command.strip()

    # Strip sudo wrapper.
    if cmd.startswith("sudo "):
        cmd = cmd[5:].strip()

    # Strip `command ...` wrapper.
    if cmd.startswith("command "):
        cmd = cmd[8:].strip()

    # Strip leading `env VAR=...` assignments.
    if cmd.startswith("env "):
        parts = cmd.split()
        # Keep dropping VAR=... tokens until we hit the real command.
        i = 1
        while i < len(parts) and "=" in parts[i] and not parts[i].startswith(("-", "--")):
            i += 1
        cmd = " ".join(parts[i:]).strip() if i < len(parts) else ""

    # Collapse whitespace.
    cmd = re.sub(r"\s+", " ", cmd)
    return cmd.lower()


def load_custom_blocklist() -> list:
    """Load custom blocklist patterns from config file."""
    patterns = _load_config().get("customBlocklist", [])
    if not isinstance(patterns, list):
        return []
    out = []
    for p in patterns:
        if isinstance(p, str) and p.strip():
            out.append(p.strip())
    return out


def load_auto_approve_patterns() -> list:
    """Load user-defined auto-approve patterns from config."""
    deliberate = (_load_config().get("deliberate", {}) or {})
    auto_cfg = (deliberate.get("autoApprove", {}) or {})
    patterns = auto_cfg.get("patterns", [])
    if not isinstance(patterns, list):
        return []

    out = []
    for p in patterns:
        if isinstance(p, str) and p.strip():
            out.append(p.strip())
    return out


def custom_blocklist_match(command: str, patterns: list) -> str | None:
    """Return the matching pattern if command hits the custom blocklist."""
    if not patterns:
        return None
    haystack = normalize_command_for_custom_lists(command)
    if not haystack:
        return None
    for p in patterns:
        needle = normalize_command_for_custom_lists(p)
        if needle and needle in haystack:
            return p
    return None


def auto_approve_match(command: str, patterns: list) -> str | None:
    """Return matching auto-approve pattern if command is covered."""
    if not patterns:
        return None
    haystack = normalize_command_for_custom_lists(command)
    if not haystack:
        return None
    for p in patterns:
        needle = normalize_command_for_custom_lists(p)
        if needle and needle in haystack:
            return p
    return None


def has_dangerous_substitution(command: str) -> bool:
    """Check if command contains command substitution (genuinely dangerous).

    These allow arbitrary code execution within a command:
    - echo `whoami`
    - cat $(ls /etc)
    """
    return any(op in command for op in DANGEROUS_SUBSTITUTION)


def split_pipeline(command: str) -> list:
    """Split a command pipeline into individual commands.

    Handles: cmd1 && cmd2 || cmd3 | cmd4 ; cmd5
    Returns: ['cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5']

    Note: This is a simple split - doesn't handle quoted strings perfectly,
    but good enough for skip-list checking.
    """
    import re
    # Split on pipeline separators, keeping it simple
    # Order matters: && and || before | and ;
    pattern = r'\s*(?:&&|\|\||[|;])\s*'
    parts = re.split(pattern, command)
    return [p.strip() for p in parts if p.strip()]


def extract_command_name(cmd: str) -> str:
    """Extract the command name (basename) from a command string.

    Handles:
    - 'ls -la' -> 'ls'
    - '/usr/bin/ls -la' -> 'ls'
    - 'sleep 3' -> 'sleep'
    - 'head -20' -> 'head'

    Also strips redirections from the end.
    """
    # Remove trailing redirections (2>&1, > file, etc.)
    import re
    cmd_clean = re.sub(r'\s*\d*>[>&]?\d?\s*\S*\s*$', '', cmd)
    cmd_clean = re.sub(r'\s*<\s*\S*\s*$', '', cmd_clean)

    # Get first token
    first_token = cmd_clean.split()[0] if cmd_clean.split() else ""

    # Return basename
    return os.path.basename(first_token)


def extract_command_with_subcommand(cmd: str) -> str | None:
    """Extract 'git status' style compound commands."""
    import re
    cmd_clean = re.sub(r'\s*\d*>[>&]?\d?\s*\S*\s*$', '', cmd)
    cmd_clean = re.sub(r'\s*<\s*\S*\s*$', '', cmd_clean)
    parts = cmd_clean.split()
    if len(parts) >= 2:
        base = os.path.basename(parts[0])
        return f"{base} {parts[1]}"
    return None


def is_command_in_skip_set(cmd: str, skip_set: set) -> bool:
    """Check if a command is in the skip set (handles basenames and compound commands)."""
    cmd_exact = cmd.strip()
    if cmd_exact in skip_set:
        return True

    cmd_name = extract_command_name(cmd)
    if not cmd_name:
        return False

    # Check basename directly
    if cmd_name in skip_set or cmd_name in DEFAULT_SAFE_COMMANDS:
        return True

    # Check compound command (e.g., "git status")
    compound = extract_command_with_subcommand(cmd)
    if compound and compound in skip_set:
        return True

    return False


def should_skip_command(command: str, skip_set: set) -> bool:
    """Check if command should be skipped (all parts are safe).

    Returns True only if:
    1. No command substitution (backticks, $())
    2. ALL commands in the pipeline are in the skip set or DEFAULT_SAFE_COMMANDS

    Examples:
    - 'browser-use open url && sleep 3 && browser-use state | head -20'
      -> browser-use (skip), sleep (safe), browser-use (skip), head (safe) -> SKIP
    - 'browser-use && rm -rf /'
      -> browser-use (skip), rm (NOT safe) -> DO NOT SKIP
    - 'ls > /etc/passwd'
      -> ls (skip) but writes to /etc/passwd -> DO NOT SKIP (redirect to sensitive path)
    """
    cmd_stripped = command.strip()

    # SECURITY: Never skip if command contains command substitution
    # This allows arbitrary code execution: echo `rm -rf /`
    if has_dangerous_substitution(cmd_stripped):
        return False

    # SECURITY: Never skip if redirecting to an absolute path outside home/tmp
    # Catches: ls > /etc/cron.d/evil
    import re
    redirect_match = re.search(r'>\s*(/[^/\s][^\s]*)', cmd_stripped)
    if redirect_match:
        redirect_path = redirect_match.group(1)
        # Allow redirects to /tmp, /dev/null, and relative paths
        if not redirect_path.startswith(('/tmp/', '/dev/', os.path.expanduser('~'))):
            return False

    # Split pipeline and check each command
    commands = split_pipeline(cmd_stripped)

    if not commands:
        return False

    # ALL commands in the pipeline must be safe
    for cmd in commands:
        if not is_command_in_skip_set(cmd, skip_set):
            return False

    return True


def load_llm_config() -> dict | None:
    """Load LLM configuration from config file or keychain."""
    if LLM_MODE == "manual":
        return None

    llm = _load_config().get("llm", {})
    provider = llm.get("provider")
    if not provider:
        return None

    # For claude-subscription we intentionally prefer Claude SDK's own auth
    # resolution (same source as `claude auth status`) unless the user has
    # explicitly configured an override token in Deliberate config.
    api_key = llm.get("apiKey")

    return {
        "provider": provider,
        "base_url": llm.get("baseUrl"),
        "api_key": api_key,
        "model": llm.get("model")
    }

# Commands that are usually safe (local heuristic pre-assessment).
SAFE_PREFIXES = [
    "ls", "pwd", "echo", "cat", "head", "tail", "wc", "which", "whoami",
    "date", "cal", "uptime", "hostname", "uname", "env", "printenv",
    "cd", "pushd", "popd", "dirs",
    "git status", "git log", "git diff", "git branch", "git show",
    "npm list", "npm outdated", "npm --version", "node --version",
    "python --version", "python3 --version", "pip list", "pip show",
    "pgrep", "ps aux", "top -l", "htop",
]

# Patterns that indicate potentially dangerous commands (local heuristic).
DANGEROUS_PATTERNS = [
    "rm -rf", "rm -r", "rmdir",
    "sudo", "su ",
    "> /dev/", "dd if=",
    "chmod 777", "chmod -R",
    "mkfs", "fdisk", "parted",
    ":(){ :|:& };:",  # fork bomb
    "curl | sh", "curl | bash", "wget | sh", "wget | bash",
    "DROP ", "DELETE FROM", "TRUNCATE",
    "kubectl delete", "kubectl exec",
    "docker rm", "docker rmi", "docker system prune",
    "aws s3 rm", "aws ec2 terminate",
    "terraform destroy",
    "systemctl stop", "systemctl disable",
    "kill -9", "killall", "pkill",
]


def debug(msg):
    if DEBUG:
        print(f"[deliberate-cmd] {msg}", file=sys.stderr)


def is_safe_command(command: str) -> bool:
    """Check if command is in the safe list (fallback)."""
    cmd_lower = command.strip().lower()
    return any(cmd_lower.startswith(prefix.lower()) for prefix in SAFE_PREFIXES)


def is_dangerous_command(command: str) -> bool:
    """Check if command matches dangerous local patterns."""
    cmd_lower = command.lower()
    return any(pattern.lower() in cmd_lower for pattern in DANGEROUS_PATTERNS)


def build_local_rule_reason(command: str, risk: str) -> str:
    """Generate a human-meaningful explanation for local rule decisions.

    This runs when we do not have an LLM explanation available yet. The goal is
    to avoid vague messages like "matched dangerous pattern" and instead tell
    the user what the command does and why it matters.
    """
    cmd = command.strip()
    lower = cmd.lower()

    if "curl | sh" in lower or "curl | bash" in lower or "wget | sh" in lower or "wget | bash" in lower:
        return (
            "This command downloads remote content and pipes it directly into a shell. "
            "That executes unreviewed code immediately, so treat it as high risk."
        )

    if "git reset --hard" in lower:
        return (
            "This command discards local tracked changes (`git reset --hard`). "
            "Uncommitted edits will be lost."
        )

    if "git push --force" in lower or "git push -f" in lower:
        return (
            "This command force-pushes rewritten history. It can overwrite remote commits "
            "and disrupt collaborators."
        )

    if "rm -rf" in lower or re.search(r"\brm\s+(-[a-z]*r[a-z]*)\b", lower):
        targets = extract_affected_paths(command)
        target_note = ""
        if targets:
            target_note = f" Targets: {', '.join(targets[:3])}."
            if len(targets) > 3:
                target_note = f"{target_note[:-1]} (+{len(targets) - 3} more)."
        return (
            "This command recursively and forcefully deletes files/directories (`rm -rf`). "
            "Deleted content is not moved to Trash and can be unrecoverable."
            f"{target_note}"
        )

    if "chmod 777" in lower:
        return (
            "This command grants read/write/execute permissions to everyone (`chmod 777`). "
            "That can expose sensitive files and increase abuse risk."
        )

    if lower.startswith("sudo ") or " sudo " in lower:
        return (
            "This command runs with elevated privileges (`sudo`), so mistakes can modify "
            "protected system files or settings."
        )

    if risk == "SAFE":
        if lower.startswith(("ls", "ll", "la", "dir", "tree")):
            return "This is a read-only directory listing command. It does not modify files."
        if "--version" in lower:
            return "This command only prints tool version information (read-only)."
        if lower.startswith(("git status", "git log", "git diff", "git branch", "git show")):
            return "This is a read-only Git inspection command."
        return "This command matched a read-only safe pattern."

    if risk == "DANGEROUS":
        return "This command matched a destructive or high-impact local risk pattern."

    return "Review this command manually before execution."


def assess_command_risk_by_rules(command: str) -> dict | None:
    """Lightweight local pre-assessment used before LLM explanation.

    This keeps Deliberate responsive and avoids model dependencies while still
    surfacing obvious safe/dangerous patterns.
    """
    if is_safe_command(command):
        return {
            "risk": "SAFE",
            "reason": build_local_rule_reason(command, "SAFE"),
            "source": "rules"
        }
    if is_dangerous_command(command):
        return {
            "risk": "DANGEROUS",
            "reason": build_local_rule_reason(command, "DANGEROUS"),
            "source": "rules"
        }
    return None


def extract_script_content(command: str) -> str | None:
    """Extract content of script files being executed.

    Detects patterns like:
    - bash /path/to/script.sh
    - sh script.sh
    - ./script.sh
    - source script.sh
    - python script.py
    """
    # Common script execution patterns
    patterns = [
        # bash/sh/zsh execution
        r'^(?:sudo\s+)?(?:bash|sh|zsh|ksh)\s+(?:-[a-zA-Z]*\s+)*([^\s|;&]+)',
        # Direct script execution (./script or /path/script)
        r'^(?:sudo\s+)?(\./[^\s|;&]+|/[^\s|;&]+\.(?:sh|bash|py|pl|rb|js))',
        # source or dot command
        r'^(?:source|\.)\s+([^\s|;&]+)',
        # Python execution
        r'^(?:sudo\s+)?python[23]?\s+(?:-[a-zA-Z]*\s+)*([^\s|;&]+\.py)',
        # Node execution
        r'^(?:sudo\s+)?node\s+(?:-[a-zA-Z]*\s+)*([^\s|;&]+\.js)',
    ]

    for pattern in patterns:
        match = re.search(pattern, command.strip())
        if match:
            script_path = match.group(1)
            script_path = os.path.expanduser(script_path)

            if os.path.isfile(script_path):
                try:
                    with open(script_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read(10000)  # Limit to 10KB
                        debug(f"Read script content from: {script_path} ({len(content)} chars)")
                        return content
                except (IOError, PermissionError) as e:
                    debug(f"Could not read script: {e}")
                    return None
            else:
                debug(f"Script file not found: {script_path}")
                return None

    return None


def extract_inline_content(command: str) -> str | None:
    """Extract inline content from heredocs and redirects.

    Detects patterns like:
    - cat > file << EOF ... EOF
    - cat > file << 'EOF' ... EOF
    - echo "content" > file
    - printf 'content' > file

    Returns the inline content if found, None otherwise.
    """
    # Heredoc patterns - capture content between << MARKER and MARKER
    # Handles both << EOF and << 'EOF' (quoted prevents variable expansion)
    heredoc_pattern = r'<<\s*[\'"]?(\w+)[\'"]?\s*\n(.*?)\n\1'
    heredoc_match = re.search(heredoc_pattern, command, re.DOTALL)
    if heredoc_match:
        content = heredoc_match.group(2)
        debug(f"Extracted heredoc content ({len(content)} chars)")
        return content

    # Echo redirect patterns - echo "..." > file or echo '...' > file
    # Capture the content being echoed
    echo_patterns = [
        # echo "content" > file
        r'echo\s+"([^"]+)"\s*>+\s*\S+',
        # echo 'content' > file
        r"echo\s+'([^']+)'\s*>+\s*\S+",
        # echo $'content' > file (bash ANSI-C quoting)
        r"echo\s+\$'([^']+)'\s*>+\s*\S+",
        # echo content > file (unquoted, single word)
        r'echo\s+([^\s>|;&]+)\s*>+\s*\S+',
    ]

    for pattern in echo_patterns:
        match = re.search(pattern, command)
        if match:
            content = match.group(1)
            # Unescape common sequences
            content = content.replace('\\n', '\n').replace('\\t', '\t')
            debug(f"Extracted echo content ({len(content)} chars)")
            return content

    # Printf redirect patterns - printf 'format' > file
    printf_patterns = [
        # printf "content" > file
        r'printf\s+"([^"]+)"\s*>+\s*\S+',
        # printf 'content' > file
        r"printf\s+'([^']+)'\s*>+\s*\S+",
    ]

    for pattern in printf_patterns:
        match = re.search(pattern, command)
        if match:
            content = match.group(1)
            # Unescape common sequences
            content = content.replace('\\n', '\n').replace('\\t', '\t')
            debug(f"Extracted printf content ({len(content)} chars)")
            return content

    return None


def call_llm_for_explanation(
    command: str,
    pre_assessment: dict | None = None,
    script_content: str | None = None,
    evidence: List[dict] | None = None,
) -> dict | None:
    """Call the configured LLM to explain the command using Claude Agent SDK."""
    debug("call_llm_for_explanation started")

    llm_config = load_llm_config()
    if not llm_config:
        debug("No LLM configured")
        return None

    provider = llm_config["provider"]
    debug(f"LLM provider: {provider}")

    # Only use SDK for claude-subscription provider
    if provider != "claude-subscription":
        debug("Non-OAuth provider - falling back to direct API")
        return None

    # Build context from local pre-assessment if available
    context_note = ""
    if pre_assessment:
        risk = pre_assessment.get("risk", "UNKNOWN")
        reason = pre_assessment.get("reason", "")
        source = pre_assessment.get("source", "rules")
        context_note = f"\n\nPre-screening ({source}): {risk} - {reason}"

    danger_note = ""
    if is_dangerous_command(command):
        danger_note = " ⚠️ This command matches a potentially dangerous pattern."

    # Include script content if available
    script_section = ""
    if script_content:
        truncated = script_content[:5000] + "..." if len(script_content) > 5000 else script_content
        script_section = f"""

SCRIPT CONTENT (being executed):
```
{truncated}
```

CRITICAL: Analyze the SCRIPT CONTENT above, not just the command. The script may contain malicious code like:
- Remote code execution (curl/wget piped to bash)
- Data exfiltration
- Privilege escalation
- File system destruction
- Backdoor installation"""

    evidence_section = ""
    if evidence:
        # Keep evidence readable and bounded. It's used as citations for the
        # explanation and for follow-up questions.
        try:
            evidence_json = json.dumps(evidence[:10], ensure_ascii=False, indent=2)[:8000]
        except Exception:
            evidence_json = "[]"
        evidence_section = f"""

EVIDENCE (scoped web search + local resolution):
```json
{evidence_json}
```"""

    prompt = f"""Analyze this shell command for both purpose and security implications. Be concise (1-2 sentences).{danger_note}{context_note}{script_section}
{evidence_section}

Command: {command}

Consider:
- What does this command do?
- Any security concerns? (file deletion, privilege escalation, network access, data exfiltration, code execution)
- Could this be destructive or have unintended side effects?
- Is this command obfuscated or trying to hide its intent?
{f"- MOST IMPORTANTLY: Analyze the script content being executed!" if script_content else ""}

If you're uncertain about what something does, say what you don't know and ask a focused follow-up question.

Format your response as:
RISK: [SAFE|MODERATE|DANGEROUS]
EXPLANATION: [your explanation including any security notes]"""

    try:
        # Create temp file for SDK script
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            sdk_script = f"""
import os
import sys
import json
import asyncio
from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

# Optional override token. If not provided, Claude SDK uses local Claude auth.
token = {repr(llm_config["api_key"])}
if token:
    os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token

async def main():
    # Create SDK client - disallow all tools except WebSearch (for verifying commands)
    client = ClaudeSDKClient(
        options=ClaudeAgentOptions(
            model={repr(llm_config["model"])},
            max_turns=1,
            disallowed_tools=['Task', 'TaskOutput', 'Bash', 'Glob', 'Grep', 'ExitPlanMode', 'Read', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'TodoWrite', 'KillShell', 'AskUserQuestion', 'Skill', 'SlashCommand', 'EnterPlanMode']
        )
    )

    # Send prompt
    prompt = {repr(prompt)}

    async with client:
        await client.query(prompt)

        # Collect response - check both AssistantMessage and ResultMessage
        response_text = ""
        async for msg in client.receive_response():
            msg_type = type(msg).__name__

            # Try to get text from AssistantMessage
            if msg_type == 'AssistantMessage' and hasattr(msg, 'content'):
                # content is a list of blocks (TextBlock, ToolUseBlock, etc.)
                for block in (msg.content or []):
                    block_type = type(block).__name__
                    if block_type == 'TextBlock' and hasattr(block, 'text') and block.text:
                        # Accumulate text from all TextBlocks
                        if response_text:
                            response_text += "\\n" + block.text
                        else:
                            response_text = block.text

            # ResultMessage marks the end
            if msg_type == 'ResultMessage':
                if hasattr(msg, 'result') and msg.result:
                    response_text = msg.result
                break

        print(response_text if response_text else "")

# Run async main
asyncio.run(main())
"""
            f.write(sdk_script)
            script_path = f.name

        # Run SDK script
        debug("Running SDK script...")
        result = subprocess.run(
            ["python3", script_path],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS
        )

        os.unlink(script_path)

        debug(f"SDK returncode: {result.returncode}")
        debug(f"SDK stderr: {result.stderr[:500] if result.stderr else 'none'}")
        if result.returncode != 0:
            debug(f"SDK script failed: {result.stderr}")
            return None

        content = result.stdout.strip()
        debug(f"SDK stdout (first 200 chars): {content[:200]}")

        # Parse the response
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
    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    # Only process Bash commands
    if tool_name != "Bash":
        debug("Not a Bash command, skipping")
        sys.exit(0)

    command = tool_input.get("command", "")
    if not command:
        debug("No command, skipping")
        sys.exit(0)

    # Stable id for this specific command analysis run.
    analysis_seed = f"{session_id}|{command}|{time.time_ns()}"
    analysis_id = hashlib.md5(analysis_seed.encode(), usedforsecurity=False).hexdigest()[:16]

    # Master kill switch. When disabled, fail-open with no output.
    if not deliberate_enabled():
        debug("Deliberate disabled, skipping")
        sys.exit(0)

    # Check if command should be skipped (trivial, always-safe commands)
    skip_commands = load_skip_commands()
    if should_skip_command(command, skip_commands):
        debug(f"Skipping trivial command: {command[:50]}")
        sys.exit(0)

    # Claude Code provides the working directory in the hook payload. We use it
    # both for consequence analysis and as an anchor so the TUI can auto-select
    # the correct session for the current project.
    cwd = input_data.get("cwd", os.getcwd())
    broadcast_progress(session_id, analysis_id, command, cwd, "start", "Starting command analysis")

    surfacing_mode = load_terminal_explanations_mode()

    # Scoped web search evidence (npm/PyPI/GitHub/GitLab + local resolution).
    # This is used to make explanations more trustworthy and to drive follow-up
    # questions for approvals.
    broadcast_progress(session_id, analysis_id, command, cwd, "web_search", "Checking npm/PyPI/GitHub/GitLab evidence")
    evidence = web_search_evidence(command, cwd, session_id)
    if evidence:
        broadcast_progress(session_id, analysis_id, command, cwd, "web_search_done", f"Found {len(evidence)} evidence item(s)")
    else:
        broadcast_progress(session_id, analysis_id, command, cwd, "web_search_done", "No evidence found")

    # User custom blocklist, hard stop before any heavier analysis.
    block_match = custom_blocklist_match(command, load_custom_blocklist())
    if block_match:
        explanation = f"Command matched your custom blocklist entry: {block_match}"
        broadcast_event("command_analyzed", session_id, {
            "analysisId": analysis_id,
            "command": command,
            "cwd": cwd,
            "risk": "DANGEROUS",
            "explanation": explanation,
            "evidence": evidence,
            "consequences": None,
            "workflowPatterns": [],
            "backupPath": None,
            "permissionDecision": "block"
        })
        if surfacing_mode == "full":
            print(f"⛔ BLOCKED by Deliberate: {explanation}", file=sys.stderr)
        else:
            print("⛔ BLOCKED by Deliberate (details in Deliberate pane)", file=sys.stderr)
        sys.exit(2)

    # Check command history for workflow patterns BEFORE individual analysis
    # Uses sliding window (default 3 commands) to avoid stale pattern matches
    history = load_command_history(session_id)
    workflow_patterns = detect_workflow_patterns(history, command)

    # Check for destruction consequences
    destruction_consequences = get_destruction_consequences(command, cwd)

    # If we detect a dangerous workflow pattern, escalate immediately
    workflow_warning = ""
    workflow_risk_escalation = None  # Track if we need to escalate risk due to workflow
    if workflow_patterns:
        for pattern_name, pattern_risk, pattern_desc in workflow_patterns:
            workflow_warning += f"\n\n⚠️  WORKFLOW PATTERN DETECTED: {pattern_name} [{pattern_risk}]\n"
            workflow_warning += f"    {pattern_desc}\n"
            workflow_warning += f"    Session commands: {len(history['commands'])} | Cumulative risk: {history['cumulative_risk']}"

            # Track highest workflow risk for potential escalation
            if workflow_risk_escalation is None or pattern_risk == "CRITICAL":
                workflow_risk_escalation = pattern_risk

            # Show files at risk if we have them
            if history.get("files_at_risk"):
                files_preview = history["files_at_risk"][:5]
                workflow_warning += f"\n    Files at risk: {', '.join(files_preview)}"
                if len(history["files_at_risk"]) > 5:
                    workflow_warning += f" (+{len(history['files_at_risk']) - 5} more)"

    # Build destruction warning from consequences (already computed above)
    destruction_warning = ""
    if destruction_consequences and destruction_consequences.get("warning"):
        destruction_warning = f"\n\n{destruction_consequences['warning']}"

    # Layer 1: local rules for quick pre-assessment.
    pre_assessment = assess_command_risk_by_rules(command)

    # Extract script content if this is a script execution command
    script_content = extract_script_content(command)
    if script_content:
        debug(f"Detected script execution, read {len(script_content)} chars of script content")

    # Extract inline content if this is a heredoc/echo/printf write command
    inline_content = extract_inline_content(command)
    if inline_content:
        debug(f"Detected inline content write, extracted {len(inline_content)} chars")

    # Use whichever content we found (mutually exclusive in practice)
    # Script content = executing a file, inline content = writing via heredoc/echo
    analyzed_content = script_content or inline_content

    # Layer 2: Get LLM explanation for detailed analysis
    debug(f"Analyzing command: {command[:80]}")
    broadcast_progress(session_id, analysis_id, command, cwd, "llm", "Drafting explanation")
    llm_result = call_llm_for_explanation(command, pre_assessment, analyzed_content, evidence)

    # Progressive degradation: use local pre-assessment if LLM is unavailable.
    llm_unavailable_warning = ""
    if not llm_result:
        if pre_assessment:
            risk = pre_assessment.get("risk", "MODERATE")
            explanation = pre_assessment.get('reason', 'Review command manually')
            llm_unavailable_warning = "\n\n⚠️  LLM unavailable - using local rules only.\nTo get detailed explanations, configure: ~/.deliberate/config.json\nOr run: deliberate install"
            debug("LLM unavailable, using rule pre-assessment")
        else:
            # No LLM and no rule match: fail-open.
            debug("No LLM and no rule pre-assessment, allowing command")
            sys.exit(0)
    else:
        risk = llm_result["risk"]
        explanation = llm_result["explanation"]

        # If a local dangerous rule triggers but the LLM says SAFE, keep this in
        # review flow by promoting to MODERATE instead of hard-blocking.
        if pre_assessment and pre_assessment.get("risk") == "DANGEROUS" and risk == "SAFE":
            risk = "MODERATE"
            reason = pre_assessment.get("reason", "Local rule matched dangerous pattern")
            explanation = f"{explanation}\n\nLocal rule note: {reason}"

    # Guard against None/empty explanation - fall back to local reason or generic message
    if not explanation or explanation == "None":
        if pre_assessment and pre_assessment.get("reason"):
            explanation = pre_assessment.get("reason")
        else:
            explanation = "Review command before proceeding"

    matched_auto_approve_pattern = auto_approve_match(command, load_auto_approve_patterns())
    auto_approval = None
    if matched_auto_approve_pattern:
        auto_approval = {
            "matched": True,
            "pattern": matched_auto_approve_pattern,
            "applied": False,
        }

    # NOTE: Deduplication is handled AFTER block/allow decision
    # We moved it below to prevent blocked commands from being allowed on retry

    # Cache result for PostToolUse to display (persistent after execution)
    # This ensures analysis is visible even after PreToolUse prompt disappears
    # MD5 used for cache key only, not security
    cmd_hash = hashlib.md5(command.encode(), usedforsecurity=False).hexdigest()[:16]
    save_to_cache(session_id, cmd_hash, {
        "analysisId": analysis_id,
        "risk": risk,
        "explanation": explanation,
        "command": command[:200],  # Truncate for cache
        "llm_unavailable_warning": llm_unavailable_warning,
        "evidence": evidence,
        "autoApproval": auto_approval
    })

    # Add command to session history for workflow tracking
    add_command_to_history(session_id, command, risk or "MODERATE", explanation or "")

    # SAFE commands: auto-allow, PostToolUse will show info after execution
    # UNLESS a workflow pattern was detected - then we still need to warn
    if risk == "SAFE" and not workflow_patterns:
        broadcast_event("command_analyzed", session_id, {
            "analysisId": analysis_id,
            "command": command,
            "cwd": cwd,
            "risk": risk,
            "explanation": explanation,
            "evidence": evidence,
            "consequences": destruction_consequences,
            "workflowPatterns": workflow_patterns,
            "backupPath": None,
            "autoApproval": auto_approval,
            "permissionDecision": "allow"
        })
        debug(f"Auto-allowing SAFE command, cached for PostToolUse")
        sys.exit(0)

    # Trigger automatic backup for ANY destructive command (catch-all safety net)
    backup_config = load_backup_config()
    backup_path = None
    if backup_config.get("enabled", True):
        # Backup if we detected any destruction consequences - this is the catch-all
        # Regardless of risk level, if files will be deleted, back them up first
        should_backup = destruction_consequences is not None and (
            destruction_consequences.get("files") or
            destruction_consequences.get("dirs")
        )

        if should_backup:
            backup_path = create_pre_destruction_backup(
                session_id, command, cwd,
                destruction_consequences, history
            )
            if backup_path:
                debug(f"Created pre-destruction backup at: {backup_path}")

    # Explicit user policy: always allow matching commands without prompting.
    # We still run full analysis and keep audit events/cached summaries.
    # Guardrail: if the command is assessed as DANGEROUS, require manual review.
    if auto_approval and risk != "DANGEROUS":
        auto_approval["applied"] = True
        broadcast_progress(
            session_id,
            analysis_id,
            command,
            cwd,
            "policy",
            f"Auto-approved by policy pattern: {matched_auto_approve_pattern}"
        )
        broadcast_event("command_analyzed", session_id, {
            "analysisId": analysis_id,
            "command": command,
            "cwd": cwd,
            "risk": risk,
            "explanation": explanation,
            "evidence": evidence,
            "consequences": destruction_consequences,
            "workflowPatterns": workflow_patterns,
            "backupPath": backup_path,
            "autoApproval": auto_approval,
            "permissionDecision": "allow"
        })
        debug(f"Auto-approved by policy: {matched_auto_approve_pattern}")
        sys.exit(0)

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

    # User-facing message with branded formatting and colors.
    # In minimal/gui surfacing modes we keep the permission gate visible, but we
    # hide the full explanation in the terminal and surface it in the side pane.
    if surfacing_mode in ("minimal", "gui"):
        reason = f"{emoji} {BOLD}{CYAN}DELIBERATE{RESET} {BOLD}{color}[{risk}]{RESET}\n    {color}Details in Deliberate pane{RESET}"
    else:
        # Full terminal explanation (v1 behavior).
        reason = f"{emoji} {BOLD}{CYAN}DELIBERATE{RESET} {BOLD}{color}[{risk}]{RESET}\n    {color}{explanation}{RESET}{llm_unavailable_warning}"
        ev_summary = format_evidence_summary(evidence)
        if ev_summary:
            reason += f"\n\n{CYAN}Evidence:{RESET}\n{ev_summary}"

    # Add workflow/destruction/backup context only in full terminal mode.
    backup_notice = ""
    if surfacing_mode == "full":
        if workflow_warning:
            reason += f"\n{RED}{workflow_warning}{RESET}"
        if destruction_warning:
            reason += f"\n{RED}{destruction_warning}{RESET}"
        if backup_path:
            backup_notice = f"\n\n💾 Auto-backup created: {backup_path}"
            reason += f"\n{GREEN}{backup_notice}{RESET}"
    else:
        # Still include backup path in Claude context (and GUI event payload).
        if backup_path:
            backup_notice = f"\n\n💾 Auto-backup created: {backup_path}"

    # For Claude's context (shown in conversation)
    context = f"**Deliberate** [{risk}]: {explanation}{llm_unavailable_warning}"
    ev_summary = format_evidence_summary(evidence)
    if ev_summary:
        context += f"\n\nEvidence:\n{ev_summary}"
    if workflow_warning:
        # Strip ANSI codes for Claude's context
        context += workflow_warning
    if destruction_warning:
        context += destruction_warning
    if backup_notice:
        context += backup_notice

    # Session deduplication - only for "ask" commands (not blocked ones)
    # This prevents showing the same warning twice in a session
    if load_dedup_config():
        warning_key = get_warning_key(command)
        shown_warnings = load_state(session_id)

        if warning_key in shown_warnings:
            # Already shown this warning in this session - allow without re-prompting
            debug(f"Deduplicated: {warning_key} already shown this session")
            sys.exit(0)

        # Mark as shown and save state
        shown_warnings.add(warning_key)
        save_state(session_id, shown_warnings)

    broadcast_progress(session_id, analysis_id, command, cwd, "decision", f"Ready for approval ({risk})")

    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": reason,
            "additionalContext": context
        }
    }

    broadcast_event("command_analyzed", session_id, {
        "analysisId": analysis_id,
        "command": command,
        "cwd": cwd,
        "risk": risk,
        "explanation": explanation,
        "evidence": evidence,
        "consequences": destruction_consequences,
        "workflowPatterns": workflow_patterns,
        "backupPath": backup_path,
        "autoApproval": auto_approval,
        "permissionDecision": "ask"
    })

    print(json.dumps(output))

    sys.exit(0)


if __name__ == "__main__":
    main()
