#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deliberate discipline hook: anxiety
Thin shim — see hooks/_discipline_dispatch.py for the actual logic.
"""

import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _discipline_dispatch import dispatch

if __name__ == "__main__":
    raise SystemExit(dispatch("anxiety"))
