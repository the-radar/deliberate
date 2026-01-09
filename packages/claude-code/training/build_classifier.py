#!/usr/bin/env python3
"""
Build the CmdCaliper-based command classifier for Deliberate.

This script:
1. Loads the expanded training dataset
2. Generates CmdCaliper embeddings for all commands
3. Builds a malicious command embeddings database for similarity matching
4. Trains a classifier head on the embeddings
5. Exports everything for use in the npm package
"""

import json
import os
import numpy as np
from pathlib import Path
from sentence_transformers import SentenceTransformer
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.preprocessing import LabelEncoder
import pickle
import warnings
import argparse
warnings.filterwarnings('ignore')

# Paths
SCRIPT_DIR = Path(__file__).parent
DATA_FILE = SCRIPT_DIR / "expanded-command-safety.jsonl"
OUTPUT_DIR = SCRIPT_DIR.parent / "models"
OUTPUT_DIR.mkdir(exist_ok=True)

# Model configurations
MODEL_CONFIGS = {
    "small": {"hf_id": "CyCraftAI/CmdCaliper-small", "dim": 384},
    "base": {"hf_id": "CyCraftAI/CmdCaliper-base", "dim": 768},
    "large": {"hf_id": "CyCraftAI/CmdCaliper-large", "dim": 1024}
}

def load_dataset(path: Path) -> list[dict]:
    """Load the JSONL training dataset."""
    data = []
    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if line:
                data.append(json.loads(line))
    return data

def generate_embeddings(model, commands: list[str]) -> np.ndarray:
    """Generate embeddings for a list of commands."""
    print(f"Generating embeddings for {len(commands)} commands...")
    embeddings = model.encode(commands, show_progress_bar=True, convert_to_numpy=True)
    return embeddings

def build_malicious_db(data: list[dict], embeddings: np.ndarray) -> dict:
    """Build the malicious command embeddings database."""
    malicious_db = {
        'DANGEROUS': {'commands': [], 'embeddings': [], 'categories': []},
        'MODERATE': {'commands': [], 'embeddings': [], 'categories': []},
    }

    for i, item in enumerate(data):
        label = item['label']
        if label in malicious_db:
            malicious_db[label]['commands'].append(item['command'])
            malicious_db[label]['embeddings'].append(embeddings[i])
            malicious_db[label]['categories'].append(item.get('category', 'unknown'))

    # Convert to numpy arrays
    for label in malicious_db:
        malicious_db[label]['embeddings'] = np.array(malicious_db[label]['embeddings'])

    return malicious_db

def train_classifier(X: np.ndarray, y: np.ndarray, label_encoder: LabelEncoder):
    """Train and evaluate multiple classifiers, return the best one."""
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    classifiers = {
        'RandomForest': RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            min_samples_split=5,
            class_weight='balanced',
            random_state=42
        ),
        'GradientBoosting': GradientBoostingClassifier(
            n_estimators=100,
            max_depth=5,
            learning_rate=0.1,
            random_state=42
        ),
        'MLP': MLPClassifier(
            hidden_layer_sizes=(128, 64),
            activation='relu',
            max_iter=500,
            early_stopping=True,
            random_state=42
        )
    }

    best_score = 0
    best_clf = None
    best_name = None

    print("\n" + "="*60)
    print("CLASSIFIER COMPARISON")
    print("="*60)

    for name, clf in classifiers.items():
        print(f"\nTraining {name}...")
        clf.fit(X_train, y_train)
        score = clf.score(X_test, y_test)
        y_pred = clf.predict(X_test)

        print(f"\n{name} Results:")
        print(f"Accuracy: {score:.4f}")
        print("\nClassification Report:")
        print(classification_report(y_test, y_pred, target_names=label_encoder.classes_))

        if score > best_score:
            best_score = score
            best_clf = clf
            best_name = name

    print("\n" + "="*60)
    print(f"BEST CLASSIFIER: {best_name} (accuracy: {best_score:.4f})")
    print("="*60)

    # Retrain best classifier on full dataset
    print(f"\nRetraining {best_name} on full dataset...")
    best_clf.fit(X, y)

    return best_clf, best_name

def export_for_js(embeddings: np.ndarray, data: list[dict], malicious_db: dict,
                  classifier, label_encoder: LabelEncoder, output_dir: Path,
                  model_size: str = "small", model_id: str = "CyCraftAI/CmdCaliper-small"):
    """Export everything for JavaScript consumption."""

    # Export malicious embeddings database as JSON (for similarity matching)
    malicious_export = {}
    for label, content in malicious_db.items():
        malicious_export[label] = {
            'commands': content['commands'],
            'embeddings': content['embeddings'].tolist(),
            'categories': content['categories']
        }

    with open(output_dir / 'malicious_embeddings.json', 'w') as f:
        json.dump(malicious_export, f)
    print(f"Saved malicious embeddings DB to {output_dir / 'malicious_embeddings.json'}")

    # Export classifier as pickle (for Python inference)
    # Save both model-specific and generic versions
    classifier_file = f'classifier_{model_size}.pkl'
    with open(output_dir / classifier_file, 'w+b') as f:
        pickle.dump({
            'classifier': classifier,
            'label_encoder': label_encoder
        }, f)
    print(f"Saved classifier to {output_dir / classifier_file}")

    # Also save as generic name for backwards compatibility
    with open(output_dir / 'command_classifier.pkl', 'w+b') as f:
        pickle.dump({
            'classifier': classifier,
            'label_encoder': label_encoder
        }, f)
    print(f"Saved classifier copy to {output_dir / 'command_classifier.pkl'}")

    # Export classifier weights for JavaScript (if MLP)
    if hasattr(classifier, 'coefs_'):
        mlp_export = {
            'weights': [w.tolist() for w in classifier.coefs_],
            'biases': [b.tolist() for b in classifier.intercepts_],
            'classes': label_encoder.classes_.tolist(),
            'activation': classifier.activation
        }
        with open(output_dir / 'mlp_weights.json', 'w') as f:
            json.dump(mlp_export, f)
        print(f"Saved MLP weights for JS to {output_dir / 'mlp_weights.json'}")

    # Export training metadata
    metadata = {
        'embedding_model': model_id,
        'embedding_dim': embeddings.shape[1],
        'num_examples': len(data),
        'labels': label_encoder.classes_.tolist(),
        'label_distribution': {
            label: sum(1 for d in data if d['label'] == label)
            for label in label_encoder.classes_
        },
        'categories': list(set(d.get('category', 'unknown') for d in data))
    }
    with open(output_dir / 'training_metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved training metadata to {output_dir / 'training_metadata.json'}")

def compute_similarity_thresholds(malicious_db: dict, safe_embeddings: np.ndarray):
    """Compute optimal similarity thresholds for each risk level."""
    from sklearn.metrics.pairwise import cosine_similarity

    thresholds = {}

    for label in ['DANGEROUS', 'MODERATE']:
        if len(malicious_db[label]['embeddings']) == 0:
            continue

        mal_emb = malicious_db[label]['embeddings']

        # Compute similarities between malicious commands
        intra_sims = cosine_similarity(mal_emb, mal_emb)
        np.fill_diagonal(intra_sims, 0)
        intra_mean = intra_sims[intra_sims > 0].mean()

        # Compute similarities between malicious and safe
        inter_sims = cosine_similarity(mal_emb, safe_embeddings)
        inter_mean = inter_sims.mean()

        # Threshold is midpoint between intra-class and inter-class similarity
        threshold = (intra_mean + inter_mean) / 2

        thresholds[label] = {
            'threshold': float(threshold),
            'intra_class_mean': float(intra_mean),
            'inter_class_mean': float(inter_mean)
        }

        print(f"\n{label} similarity analysis:")
        print(f"  Intra-class mean similarity: {intra_mean:.4f}")
        print(f"  Cross-class mean similarity: {inter_mean:.4f}")
        print(f"  Recommended threshold: {threshold:.4f}")

    return thresholds

def main():
    parser = argparse.ArgumentParser(description="Build CmdCaliper command classifier")
    parser.add_argument("--model", "-m", choices=["small", "base", "large"],
                        default="base", help="Model size to use (default: base)")
    args = parser.parse_args()

    model_size = args.model
    model_config = MODEL_CONFIGS[model_size]

    print("="*60)
    print("DELIBERATE COMMAND CLASSIFIER BUILDER")
    print("="*60)

    # Load data
    print(f"\nLoading dataset from {DATA_FILE}...")
    data = load_dataset(DATA_FILE)
    print(f"Loaded {len(data)} examples")

    # Show distribution
    labels = [d['label'] for d in data]
    for label in set(labels):
        count = labels.count(label)
        print(f"  {label}: {count} ({100*count/len(labels):.1f}%)")

    # Load CmdCaliper model
    print(f"\nLoading CmdCaliper-{model_size} model ({model_config['hf_id']})...")

    # Check for local model first
    local_model_path = OUTPUT_DIR / f"cmdcaliper-{model_size}"
    if local_model_path.exists():
        print(f"  Using local model at {local_model_path}")
        model = SentenceTransformer(str(local_model_path))
    else:
        print(f"  Downloading from HuggingFace...")
        model = SentenceTransformer(model_config['hf_id'])

    print(f"Model loaded. Embedding dimension: {model.get_sentence_embedding_dimension()}")

    # Generate embeddings
    commands = [d['command'] for d in data]
    embeddings = generate_embeddings(model, commands)
    print(f"Generated embeddings shape: {embeddings.shape}")

    # Build malicious DB
    print("\nBuilding malicious command embeddings database...")
    malicious_db = build_malicious_db(data, embeddings)
    for label, content in malicious_db.items():
        print(f"  {label}: {len(content['commands'])} commands")

    # Get safe embeddings for threshold computation
    safe_indices = [i for i, d in enumerate(data) if d['label'] == 'SAFE']
    safe_embeddings = embeddings[safe_indices]

    # Compute similarity thresholds
    print("\nComputing similarity thresholds...")
    thresholds = compute_similarity_thresholds(malicious_db, safe_embeddings)

    # Prepare for classifier training
    label_encoder = LabelEncoder()
    y = label_encoder.fit_transform(labels)
    print(f"\nLabel encoding: {dict(zip(label_encoder.classes_, range(len(label_encoder.classes_))))}")

    # Train classifier
    classifier, clf_name = train_classifier(embeddings, y, label_encoder)

    # Export everything
    print("\nExporting models and data...")
    export_for_js(embeddings, data, malicious_db, classifier, label_encoder, OUTPUT_DIR,
                  model_size=model_size, model_id=model_config['hf_id'])

    # Save thresholds
    with open(OUTPUT_DIR / 'similarity_thresholds.json', 'w') as f:
        json.dump(thresholds, f, indent=2)
    print(f"Saved similarity thresholds to {OUTPUT_DIR / 'similarity_thresholds.json'}")

    print("\n" + "="*60)
    print("BUILD COMPLETE!")
    print("="*60)
    print(f"\nOutput files in {OUTPUT_DIR}:")
    for f in OUTPUT_DIR.iterdir():
        size = f.stat().st_size
        print(f"  {f.name}: {size:,} bytes")

if __name__ == '__main__':
    main()
