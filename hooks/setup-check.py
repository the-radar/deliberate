#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deliberate - Setup Check Hook

SessionStart hook that checks if Deliberate is configured and offers
to run setup if needed. This ensures plugin users get LLM configured.

https://github.com/the-radar/deliberate
"""

import json
import os
import sys
from pathlib import Path

CONFIG_FILE = os.path.expanduser("~/.deliberate/config.json")


def load_config():
    """Check if Deliberate is configured"""
    try:
        config_path = Path(CONFIG_FILE)
        if not config_path.exists():
            return None

        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
            llm = config.get("llm", {})
            if llm.get("provider") and llm.get("apiKey"):
                return config

        return None
    except Exception:
        return None


def main():
    config = load_config()

    if config:
        # Already configured, exit silently
        sys.exit(0)

    # Not configured - show setup instructions
    message = """⚙️  Deliberate Setup Required

Deliberate needs LLM configuration for detailed command explanations.

To configure, run in your terminal:
  npm install -g deliberate
  deliberate install

Or manually edit: ~/.deliberate/config.json

Until configured, you'll only see basic pattern matching."""

    output = {
        "systemMessage": message
    }

    print(json.dumps(output))
    sys.exit(0)


if __name__ == "__main__":
    main()
