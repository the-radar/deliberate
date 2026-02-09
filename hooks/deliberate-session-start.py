#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deliberate - SessionStart hook (Claude Code)

Intent:
- Make Deliberate feel native to each Claude Code session by auto-opening a
  per-session TUI pane at session start.
- Auto-start the local Deliberate server if it isn't already running.

Design constraints:
- Must be fast and fail-open, never slowing or breaking Claude Code startup.
- Must not print or expose secrets.
- Must avoid spawning duplicate panes for the same session_id.

This hook is optional and configured under ~/.claude/settings.json:
  hooks.SessionStart -> deliberate-session-start.py
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any


DEFAULT_SERVER_PORT = 8765


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _load_config() -> Dict[str, Any]:
    """Best-effort load of ~/.deliberate/config.json (or plugin-local config)."""
    try:
        plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT")
        if plugin_root:
            config_file = Path(plugin_root) / ".deliberate" / "config.json"
        else:
            config_file = Path.home() / ".deliberate" / "config.json"

        if not config_file.exists():
            return {}

        with open(config_file, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def _get_server_port(config: dict) -> int:
    try:
        port = int((config.get("classifier", {}) or {}).get("serverPort", DEFAULT_SERVER_PORT))
        return port if 1 <= port <= 65535 else DEFAULT_SERVER_PORT
    except Exception:
        return DEFAULT_SERVER_PORT


def _enabled(config: dict, key: str, default: bool) -> bool:
    try:
        tui = config.get("tui", {}) or {}
        value = tui.get(key)
        if isinstance(value, bool):
            return value
    except Exception:
        pass
    return default


def _deliberate_enabled(config: dict) -> bool:
    """Global Deliberate enable switch (default: enabled)."""
    try:
        deliberate = config.get("deliberate", {}) or {}
        value = deliberate.get("enabled")
        if isinstance(value, bool):
            return value
    except Exception:
        pass
    return True


def _healthcheck(port: int) -> bool:
    try:
        url = f"http://localhost:{port}/health"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=0.5):  # nosec B310
            return True
    except Exception:
        return False


def _repo_root() -> Optional[Path]:
    """Resolve repo root from this hook location.

    Works for:
    - Local repo hook commands (hook file lives in <repo>/hooks)
    - Symlinked hook in ~/.claude/hooks -> <repo>/hooks
    - npm install layout (hook file still lives inside a package that has bin/ + src/)
    """
    try:
        here = Path(__file__).resolve()
        candidate = here.parent.parent  # hooks/ -> repo root
        if (candidate / "bin" / "cli.js").exists() and (candidate / "src" / "server.js").exists():
            return candidate
    except Exception:
        pass

    # As a fallback, respect CLAUDE_PLUGIN_ROOT if present (used by some runtimes).
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if plugin_root:
        pr = Path(plugin_root)
        if (pr / "bin" / "cli.js").exists() and (pr / "src" / "server.js").exists():
            return pr

    return None


def _pane_lock_path(session_id: str) -> Path:
    safe = "".join(ch for ch in session_id if ch.isalnum() or ch in ("_", "-"))[:120] or "default"
    return Path.home() / ".deliberate" / "panes" / f"pane-started-{safe}.json"


def _try_lock(session_id: str) -> bool:
    """Create a lock file once per session to prevent duplicate panes."""
    try:
        lock_path = _pane_lock_path(session_id)
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        if lock_path.exists():
            return False
        with open(lock_path, "x", encoding="utf-8") as f:
            json.dump({"sessionId": session_id, "timestamp": _now_iso()}, f)
        return True
    except Exception:
        return False


def _spawn_detached(argv: List[str], cwd: Optional[str] = None, env: Optional[Dict[str, str]] = None):
    """Spawn a detached process and return immediately (best-effort)."""
    try:
        subprocess.Popen(  # noqa: S603,S607 - controlled argv, local use only
            argv,
            cwd=cwd or None,
            env=env or os.environ.copy(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception:
        pass


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except Exception:
        return 0

    # Claude Code fires SessionStart for multiple reasons (startup/resume/compact).
    # We only want to auto-open panes on initial startup, to avoid spawning extra
    # panes during compaction cycles.
    source = (
        input_data.get("source")
        or input_data.get("reason")
        or input_data.get("event_source")
        or ""
    )
    if str(source).lower() not in ("", "startup"):
        return 0

    session_id = input_data.get("session_id") or "default"
    cwd = input_data.get("cwd") or os.getcwd()

    config = _load_config()

    if not _deliberate_enabled(config):
        return 0

    auto_pane = _enabled(config, "autoPane", True)
    auto_start_server = _enabled(config, "autoStartServer", True)

    # If auto pane is disabled, do nothing.
    if not auto_pane:
        return 0

    # Lock per session_id so we do not spawn multiple panes if SessionStart
    # fires more than once.
    if not _try_lock(str(session_id)):
        return 0

    repo = _repo_root()
    if not repo:
        return 0

    port = _get_server_port(config)

    # Start server if desired and not healthy.
    if auto_start_server and not _healthcheck(port):
        server_js = str(repo / "src" / "server.js")
        env = os.environ.copy()
        env["PORT"] = str(port)
        _spawn_detached(["node", server_js], cwd=cwd, env=env)

    # Open pane filtered to this session.
    cli_js = str(repo / "bin" / "cli.js")
    _spawn_detached(
        ["node", cli_js, "pane", "--session", str(session_id)],
        cwd=cwd,
        env=os.environ.copy(),
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
