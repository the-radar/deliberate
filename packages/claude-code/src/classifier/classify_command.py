#!/usr/bin/env python3
"""
Classify commands using CmdCaliper embeddings + RandomForest classifier.
Called by model-classifier.js for command classification.

Usage:
  python classify_command.py --base64 "base64_encoded_command"
  python classify_command.py --base64 "base64_encoded_command" --model base
  python classify_command.py "command to analyze"

Models available:
  - small (128 MB, 384-dim) - default, ships with package
  - base (419 MB, 768-dim) - better accuracy, download on demand
  - large (1.3 GB, 1024-dim) - best accuracy, download on demand

Output: JSON with classification result
"""

import sys
import json
import base64
import pickle
import argparse
from pathlib import Path
import numpy as np

# Paths
SCRIPT_DIR = Path(__file__).parent
MODELS_DIR = SCRIPT_DIR.parent.parent / "models"

# Model configurations
MODEL_CONFIGS = {
    "small": {
        "hf_id": "CyCraftAI/CmdCaliper-small",
        "local_path": MODELS_DIR / "cmdcaliper-small",
        "dim": 384
    },
    "base": {
        "hf_id": "CyCraftAI/CmdCaliper-base",
        "local_path": MODELS_DIR / "cmdcaliper-base",
        "dim": 768
    },
    "large": {
        "hf_id": "CyCraftAI/CmdCaliper-large",
        "local_path": MODELS_DIR / "cmdcaliper-large",
        "dim": 1024
    }
}

# Cache loaded models
_models = {}
_classifiers = {}
_training_embeddings = {}  # Cache training embeddings for similarity check

def get_model(model_size="small"):
    """Load embedding model (cached)."""
    if model_size in _models:
        return _models[model_size]

    from sentence_transformers import SentenceTransformer

    config = MODEL_CONFIGS[model_size]

    # Try local path first, then HuggingFace
    if config["local_path"].exists():
        model = SentenceTransformer(str(config["local_path"]))
    else:
        model = SentenceTransformer(config["hf_id"])

    _models[model_size] = model
    return model

def get_classifier(model_size="small"):
    """Load trained RandomForest classifier for the given model size."""
    if model_size in _classifiers:
        return _classifiers[model_size]

    # Classifier file named by model size
    classifier_path = MODELS_DIR / f"classifier_{model_size}.pkl"

    # Fall back to generic classifier if size-specific doesn't exist
    if not classifier_path.exists():
        classifier_path = MODELS_DIR / "command_classifier.pkl"

    if not classifier_path.exists():
        return None

    with open(classifier_path, "rb") as f:
        data = pickle.load(f)

    _classifiers[model_size] = data
    return data

def get_training_embeddings(model_size="small"):
    """Load training embeddings for similarity checking."""
    if model_size in _training_embeddings:
        return _training_embeddings[model_size]

    embeddings_path = MODELS_DIR / "malicious_embeddings.json"
    if not embeddings_path.exists():
        return None

    with open(embeddings_path, "r") as f:
        data = json.load(f)

    # Combine all training embeddings with their labels
    all_embeddings = []
    all_labels = []
    all_commands = []

    for label in ["DANGEROUS", "MODERATE", "SAFE"]:
        if label in data:
            embeddings = data[label].get("embeddings", [])
            commands = data[label].get("commands", [])
            for i, emb in enumerate(embeddings):
                all_embeddings.append(emb)
                all_labels.append(label)
                all_commands.append(commands[i] if i < len(commands) else "")

    # Also load SAFE embeddings if stored separately (they're in training data)
    # For now, we use what's in malicious_embeddings.json which has DANGEROUS and MODERATE

    result = {
        "embeddings": np.array(all_embeddings) if all_embeddings else None,
        "labels": all_labels,
        "commands": all_commands
    }

    _training_embeddings[model_size] = result
    return result


def compute_similarity(embedding1, embedding2):
    """Compute cosine similarity between two embeddings."""
    dot_product = np.dot(embedding1, embedding2)
    norm1 = np.linalg.norm(embedding1)
    norm2 = np.linalg.norm(embedding2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return float(dot_product / (norm1 * norm2))


def find_nearest_training_example(embedding, model_size="small"):
    """
    Find the most similar command in the training data.

    Returns:
        dict with: max_similarity, nearest_command, nearest_label, coverage_score

        coverage_score: How well the training data covers this command
        - > 0.85: Very similar to training data, trust classifier
        - 0.70-0.85: Moderately similar, classifier likely reliable
        - 0.50-0.70: Low similarity, consider LLM fallback
        - < 0.50: Very different from training, definitely use LLM
    """
    training_data = get_training_embeddings(model_size)

    if training_data is None or training_data["embeddings"] is None:
        return {
            "max_similarity": 0.0,
            "nearest_command": None,
            "nearest_label": None,
            "coverage_score": 0.0,
            "needs_llm_fallback": True,
            "reason": "No training data available"
        }

    # Compute similarities to all training examples
    similarities = []
    for train_emb in training_data["embeddings"]:
        sim = compute_similarity(embedding, train_emb)
        similarities.append(sim)

    similarities = np.array(similarities)
    max_idx = np.argmax(similarities)
    max_similarity = float(similarities[max_idx])

    # Compute coverage score (how well training data covers this input)
    # Use top-5 similarities to get a more robust measure
    top_k = min(5, len(similarities))
    top_similarities = np.sort(similarities)[-top_k:]
    coverage_score = float(np.mean(top_similarities))

    # Determine if we need LLM fallback
    needs_llm = coverage_score < 0.70

    return {
        "max_similarity": max_similarity,
        "nearest_command": training_data["commands"][max_idx],
        "nearest_label": training_data["labels"][max_idx],
        "coverage_score": coverage_score,
        "needs_llm_fallback": needs_llm,
        "reason": _get_coverage_reason(coverage_score)
    }


def _get_coverage_reason(coverage_score):
    """Get human-readable reason for coverage score."""
    if coverage_score >= 0.85:
        return "Command very similar to training data - high confidence"
    elif coverage_score >= 0.70:
        return "Command moderately similar to training data - good confidence"
    elif coverage_score >= 0.50:
        return "Command has low similarity to training data - consider LLM verification"
    else:
        return "Command very different from training data - LLM fallback recommended"


def get_embedding(command: str, model_size="small") -> np.ndarray:
    """Generate embedding for a command."""
    model = get_model(model_size)
    embedding = model.encode(command, convert_to_numpy=True)
    return embedding

def classify_command(command: str, model_size="small") -> dict:
    """
    Classify a command using CmdCaliper embeddings + RandomForest.

    Returns:
        dict with keys: risk, confidence, reason, probabilities, coverage info

    Active Learning Support:
        - coverage_score: How well training data covers this command (0-1)
        - needs_llm_fallback: Whether LLM should verify this classification
        - nearest_command: Most similar command in training data
    """
    # Get embedding
    embedding = get_embedding(command, model_size)

    # Check how well training data covers this command
    coverage_info = find_nearest_training_example(embedding, model_size)

    # Get classifier
    classifier_data = get_classifier(model_size)

    if classifier_data is None:
        # No classifier available - return embedding only
        return {
            "embedding": embedding.tolist(),
            "risk": None,
            "reason": "No classifier available - embedding only mode",
            "needs_llm_fallback": True,
            **coverage_info
        }

    classifier = classifier_data["classifier"]
    label_encoder = classifier_data["label_encoder"]

    # Predict
    embedding_2d = embedding.reshape(1, -1)
    prediction = classifier.predict(embedding_2d)[0]
    probabilities = classifier.predict_proba(embedding_2d)[0]

    # Decode label
    risk = label_encoder.inverse_transform([prediction])[0]

    # Get confidence for predicted class
    confidence = float(probabilities[prediction])

    # Build probability dict
    prob_dict = {}
    for i, label in enumerate(label_encoder.classes_):
        prob_dict[label] = float(probabilities[i])

    # Determine if we need LLM fallback based on multiple factors:
    # 1. Low coverage score (command unlike training data)
    # 2. Low classifier confidence
    # 3. Close probabilities between classes (uncertainty)
    sorted_probs = sorted(probabilities, reverse=True)
    prob_margin = sorted_probs[0] - sorted_probs[1] if len(sorted_probs) > 1 else 1.0

    needs_llm = (
        coverage_info["needs_llm_fallback"] or  # Low similarity to training data
        confidence < 0.60 or                     # Low classifier confidence
        prob_margin < 0.20                       # Classes too close (uncertain)
    )

    # Generate reason with coverage context
    if needs_llm:
        if coverage_info["coverage_score"] < 0.50:
            reason = f"Command unfamiliar to classifier (coverage: {coverage_info['coverage_score']*100:.0f}%) - LLM verification recommended"
        elif confidence < 0.60:
            reason = f"Classifier uncertain ({confidence*100:.1f}% confidence) - LLM verification recommended"
        else:
            reason = f"Close call between classes (margin: {prob_margin*100:.0f}%) - LLM verification recommended"
    else:
        if risk == "DANGEROUS":
            reason = f"Classifier detected dangerous pattern ({confidence*100:.1f}% confidence, coverage: {coverage_info['coverage_score']*100:.0f}%)"
        elif risk == "MODERATE":
            reason = f"Classifier detected moderate risk ({confidence*100:.1f}% confidence, coverage: {coverage_info['coverage_score']*100:.0f}%)"
        else:
            reason = f"Classifier determined command is safe ({confidence*100:.1f}% confidence, coverage: {coverage_info['coverage_score']*100:.0f}%)"

    return {
        "risk": risk,
        "confidence": float(confidence),
        "reason": reason,
        "probabilities": prob_dict,
        "model_size": model_size,
        # Active learning fields - ensure Python native types for JSON serialization
        "needs_llm_fallback": bool(needs_llm),
        "coverage_score": float(coverage_info["coverage_score"]),
        "nearest_command": coverage_info["nearest_command"],
        "nearest_label": coverage_info["nearest_label"],
        "max_similarity": float(coverage_info["max_similarity"]),
        # Don't include full embedding to reduce output size
        # "embedding": embedding.tolist(),
    }

def main():
    parser = argparse.ArgumentParser(description="Classify shell commands")
    parser.add_argument("command", nargs="?", help="Command to classify")
    parser.add_argument("--base64", "-b", help="Base64 encoded command")
    parser.add_argument("--model", "-m", choices=["small", "base", "large"],
                        default="small", help="Model size to use")
    parser.add_argument("--embed-only", action="store_true",
                        help="Only return embedding, skip classification")

    args = parser.parse_args()

    # Get command from args
    if args.base64:
        try:
            command = base64.b64decode(args.base64).decode("utf-8")
        except Exception as e:
            print(json.dumps({"error": f"Invalid base64: {e}"}))
            sys.exit(1)
    elif args.command:
        command = args.command
    else:
        print(json.dumps({"error": "No command provided"}))
        sys.exit(1)

    try:
        if args.embed_only:
            embedding = get_embedding(command, args.model)
            print(json.dumps(embedding.tolist()))
        else:
            result = classify_command(command, args.model)
            print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
