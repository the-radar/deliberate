#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deliberate - SessionEnd hook (Claude Code)

Intent:
- Kill the Deliberate TUI pane that was spawned for this session and remove its
  lock file when Claude Code reports the session ending.

Design constraints:
- Must be fast and fail-open. A failure here must never block Claude Code.
- Must only kill the PID recorded in the lock file (never broad pkill).
"""

import json
import os
import signal
import sys
from pathlib import Path
from typing import Any, Dict, Optional


def _pane_lock_path(session_id: str) -> Path:
    safe = "".join(ch for ch in session_id if ch.isalnum() or ch in ("_", "-"))[:120] or "default"
    return Path.home() / ".deliberate" / "panes" / f"pane-started-{safe}.json"


def _read_lock(lock_path: Path) -> Dict[str, Any]:
    try:
        with open(lock_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def _terminate(pid: Optional[int]) -> None:
    if not pid or pid <= 0:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except PermissionError:
        return
    except Exception:
        return


def main() -> int:
    try:
        input_data = json.load(sys.stdin)
    except Exception:
        return 0

    session_id = input_data.get("session_id")
    if not session_id:
        return 0

    lock_path = _pane_lock_path(str(session_id))
    if not lock_path.exists():
        return 0

    data = _read_lock(lock_path)
    pid = data.get("pid")
    try:
        pid_int = int(pid) if pid is not None else None
    except (TypeError, ValueError):
        pid_int = None

    _terminate(pid_int)

    try:
        lock_path.unlink(missing_ok=True)
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
