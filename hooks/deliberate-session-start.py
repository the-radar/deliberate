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
        server_cfg = config.get("server", {}) or {}
        port = int(server_cfg.get("port", DEFAULT_SERVER_PORT))
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


def _pid_alive(pid: Optional[int]) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # PID exists but is owned by another user.
        return True
    except Exception:
        return False


def _read_lock(lock_path: Path) -> Dict[str, Any]:
    try:
        with open(lock_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def _prune_stale_locks(max_age_days: int = 7) -> None:
    """Remove lock files whose recorded pid is dead, or that have aged out.

    Best-effort — never raises. Keeps the panes/ directory from growing forever
    when SessionEnd hooks miss (crash, force-quit, old Claude Code build).
    """
    try:
        base = Path.home() / ".deliberate" / "panes"
        if not base.is_dir():
            return
        cutoff = datetime.utcnow().timestamp() - (max_age_days * 86400)
        for entry in base.iterdir():
            if not entry.is_file() or not entry.name.startswith("pane-started-"):
                continue
            data = _read_lock(entry)
            pid = data.get("pid") if isinstance(data, dict) else None
            try:
                pid_int = int(pid) if pid is not None else None
            except (TypeError, ValueError):
                pid_int = None
            # Drop if PID recorded but dead, OR no PID and file is old.
            if pid_int is not None:
                if not _pid_alive(pid_int):
                    entry.unlink(missing_ok=True)
                continue
            try:
                if entry.stat().st_mtime < cutoff:
                    entry.unlink(missing_ok=True)
            except Exception:
                continue
    except Exception:
        pass


def _claim_lock_slot(session_id: str) -> bool:
    """Check whether a fresh pane should be spawned for this session.

    Self-heals stale locks: if the recorded pane PID is dead, the slot is
    reclaimable. Returns True if caller may spawn a new pane.
    """
    try:
        lock_path = _pane_lock_path(session_id)
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        if not lock_path.exists():
            return True
        existing = _read_lock(lock_path)
        existing_pid = existing.get("pid")
        try:
            existing_pid_int = int(existing_pid) if existing_pid is not None else None
        except (TypeError, ValueError):
            existing_pid_int = None
        if existing_pid_int is not None and _pid_alive(existing_pid_int):
            return False
        # Stale: dead PID or legacy lock with no PID — reclaim.
        lock_path.unlink(missing_ok=True)
        return True
    except Exception:
        # Fail closed: avoid spawning if we cannot reason about state.
        return False


def _write_lock(session_id: str, pane_pid: Optional[int]) -> None:
    """Atomically write the per-session pane lock with the live pane PID."""
    try:
        lock_path = _pane_lock_path(session_id)
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "sessionId": session_id,
            "pid": int(pane_pid) if pane_pid else None,
            "ppid": os.getppid(),
            "timestamp": _now_iso(),
        }
        tmp = lock_path.with_suffix(lock_path.suffix + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        tmp.replace(lock_path)
    except Exception:
        pass


def _spawn_detached(argv: List[str], cwd: Optional[str] = None, env: Optional[Dict[str, str]] = None) -> Optional[int]:
    """Spawn a detached process and return its PID (or None on failure)."""
    try:
        proc = subprocess.Popen(  # noqa: S603,S607 - controlled argv, local use only
            argv,
            cwd=cwd or None,
            env=env or os.environ.copy(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        return proc.pid
    except Exception:
        return None


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

    # Opportunistic cleanup: drop pane lock files whose pane PID is dead.
    _prune_stale_locks()

    # Lock per session_id so we do not spawn multiple panes if SessionStart
    # fires more than once. Self-heals stale (dead-PID) locks.
    if not _claim_lock_slot(str(session_id)):
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
    pane_pid = _spawn_detached(
        ["node", cli_js, "pane", "--session", str(session_id)],
        cwd=cwd,
        env=os.environ.copy(),
    )

    # Record the spawned pane's PID so SessionEnd / cleanup can verify and kill.
    _write_lock(str(session_id), pane_pid)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
