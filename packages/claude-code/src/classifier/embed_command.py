#!/usr/bin/env python3
"""
Generate CmdCaliper embeddings for commands.
Called by model-classifier.js for command classification.

Usage: python embed_command.py --base64 "base64_encoded_command"
       python embed_command.py "command to analyze"
Output: JSON array of 384 floats (the embedding)
"""

import sys
import json
import base64
from pathlib import Path

# Use the local model copy
MODEL_PATH = Path(__file__).parent.parent.parent / "models" / "cmdcaliper-small"

# Cache the model to avoid reloading
_model = None

def get_model():
    """Load model once and cache it."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(str(MODEL_PATH))
    return _model

def get_embedding(command: str) -> list[float]:
    """Generate embedding for a command using CmdCaliper."""
    model = get_model()
    embedding = model.encode(command, convert_to_numpy=True)
    return embedding.tolist()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command provided"}))
        sys.exit(1)

    # Check for base64 flag (safer input method)
    if sys.argv[1] == "--base64" and len(sys.argv) >= 3:
        try:
            command = base64.b64decode(sys.argv[2]).decode('utf-8')
        except Exception as e:
            print(json.dumps({"error": f"Invalid base64: {e}"}))
            sys.exit(1)
    else:
        command = sys.argv[1]

    try:
        embedding = get_embedding(command)
        print(json.dumps(embedding))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
