#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Shared dispatcher for deliberate's discipline hooks.

Each hook script in hooks/ is a tiny wrapper that calls dispatch(kind) here.
This module forwards stdin to `node bin/cli.js hooks eval --kind=<kind>` and
mirrors the node process's stdout/exit code back to Claude Code.

Why a thin Python shim and not a direct node script:
  - Claude Code already expects Python entries for everything else deliberate
    ships, and the existing installer wires Python paths.
  - Keeping the shim trivial means the discipline logic lives in one language
    (JS, in src/discipline/) — easier to test, one place to change behavior.

Fail-open: if node is missing or the dispatch errors, this script exits 0 so a
broken deliberate install never wedges Claude Code.
"""

import json
import os
import subprocess
import sys
from pathlib import Path


def _repo_root():
    here = Path(__file__).resolve()
    candidate = here.parent.parent  # hooks/ -> repo root
    if (candidate / "bin" / "cli.js").exists():
        return candidate
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if plugin_root and (Path(plugin_root) / "bin" / "cli.js").exists():
        return Path(plugin_root)
    return None


def dispatch(kind):
    repo = _repo_root()
    if not repo:
        return 0

    payload = sys.stdin.read() if not sys.stdin.isatty() else ""
    cli = str(repo / "bin" / "cli.js")

    try:
        proc = subprocess.run(
            ["node", cli, "hooks", "eval", "--kind", kind],
            input=payload.encode("utf-8"),
            capture_output=True,
            timeout=30,
        )
    except FileNotFoundError:
        # node not installed -> fail open
        return 0
    except subprocess.TimeoutExpired:
        # discipline check is the leash, not the gallows -> fail open on timeout
        return 0
    except Exception:
        return 0

    if proc.stdout:
        sys.stdout.write(proc.stdout.decode("utf-8", errors="replace"))
    if proc.stderr:
        sys.stderr.write(proc.stderr.decode("utf-8", errors="replace"))

    return proc.returncode
