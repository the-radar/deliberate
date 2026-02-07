#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CmdCaliper worker process.

This keeps the SentenceTransformer model and classifier loaded in memory and
serves classification requests over stdin/stdout using JSONL.

Protocol:
  Request line (JSON):
    {"id":"...", "command_b64":"...", "model":"base"}

  Response line (JSON):
    {"id":"...", "ok":true, "result":{...}}
    {"id":"...", "ok":false, "error":"..."}

This is used by src/classifier/model-classifier.js to avoid spawning a fresh
Python process for every command classification, which is too slow in practice.
"""

import base64
import json
import sys


def _write(obj: dict):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    try:
        # Import from sibling file. This script is launched with cwd at project root
        # and an explicit absolute path in Node, so we add this file's directory.
        import os
        from pathlib import Path
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from classify_command import classify_command  # type: ignore
    except Exception as e:
        _write({"id": "init", "ok": False, "error": f"worker import failed: {e}"})
        return 1

    _write({"id": "init", "ok": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
            req_id = msg.get("id")
            if not req_id:
                _write({"id": None, "ok": False, "error": "missing id"})
                continue

            command_b64 = msg.get("command_b64")
            model = msg.get("model") or "base"
            if not isinstance(command_b64, str) or not command_b64:
                _write({"id": req_id, "ok": False, "error": "missing command_b64"})
                continue

            command = base64.b64decode(command_b64).decode("utf-8", errors="replace")
            result = classify_command(command, model_size=model)
            _write({"id": req_id, "ok": True, "result": result})
        except Exception as e:
            _write({"id": msg.get("id") if isinstance(msg, dict) else None, "ok": False, "error": str(e)})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
