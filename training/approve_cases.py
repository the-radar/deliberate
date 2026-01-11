#!/usr/bin/env python3
"""
Approve pending review cases and add them to training data.

Usage:
  # Interactive review mode (default)
  python approve_cases.py

  # Approve all with suggested labels
  python approve_cases.py --approve-all

  # Approve specific indices
  python approve_cases.py --approve 0 1 2 5

  # Reject specific indices (remove from pending)
  python approve_cases.py --reject 3 4

  # Show pending cases without modifying
  python approve_cases.py --list

  # After approval, retrain the model
  python build_classifier.py --model base
"""

import json
import argparse
from pathlib import Path
from datetime import datetime

SCRIPT_DIR = Path(__file__).parent
PENDING_FILE = SCRIPT_DIR / "pending-review.jsonl"
TRAINING_FILE = SCRIPT_DIR / "expanded-command-safety.jsonl"
APPROVED_LOG = SCRIPT_DIR / "approved-cases.log"


def load_pending():
    """Load pending review cases."""
    if not PENDING_FILE.exists():
        return []

    cases = []
    with open(PENDING_FILE, 'r') as f:
        for line in f:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
    return cases


def save_pending(cases):
    """Save remaining pending cases."""
    with open(PENDING_FILE, 'w') as f:
        for case in cases:
            f.write(json.dumps(case) + '\n')


def add_to_training(command, label, category="active_learning"):
    """Add a command to the training data."""
    entry = {
        "command": command,
        "label": label,
        "category": category
    }
    with open(TRAINING_FILE, 'a') as f:
        f.write(json.dumps(entry) + '\n')


def log_approval(case, final_label, action):
    """Log the approval decision."""
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "command": case["command"],
        "model_label": case["model_label"],
        "suggested_label": case.get("suggested_label"),
        "final_label": final_label,
        "action": action,
        "confidence": case.get("confidence"),
        "coverage": case.get("coverage")
    }
    with open(APPROVED_LOG, 'a') as f:
        f.write(json.dumps(log_entry) + '\n')


def display_case(idx, case):
    """Display a case for review."""
    print(f"\n{'='*60}")
    print(f"Case #{idx}")
    print(f"{'='*60}")
    print(f"Command: {case['command']}")
    print(f"Model said: {case['model_label']} (conf: {case.get('confidence', 'N/A')})")
    print(f"Suggested:  {case.get('suggested_label', 'N/A')}")
    print(f"Coverage:   {case.get('coverage', 'N/A')}")
    print(f"Nearest:    {case.get('nearest_command', 'N/A')}")
    print(f"Source:     {case.get('source', 'N/A')}")


def interactive_review(cases):
    """Interactively review each case."""
    remaining = []

    for idx, case in enumerate(cases):
        display_case(idx, case)

        suggested = case.get('suggested_label', case['model_label'])
        print(f"\nOptions:")
        print(f"  [D] DANGEROUS")
        print(f"  [M] MODERATE")
        print(f"  [S] SAFE")
        print(f"  [Enter] Accept suggested ({suggested})")
        print(f"  [r] Reject/skip this case")
        print(f"  [q] Quit (remaining cases stay pending)")

        choice = input("\nYour choice: ").strip().upper()

        if choice == 'Q':
            remaining.extend(cases[idx:])
            break
        elif choice == 'R':
            log_approval(case, None, "rejected")
            print("  → Rejected")
        elif choice == 'D':
            add_to_training(case['command'], 'DANGEROUS')
            log_approval(case, 'DANGEROUS', "approved")
            print("  → Added as DANGEROUS")
        elif choice == 'M':
            add_to_training(case['command'], 'MODERATE')
            log_approval(case, 'MODERATE', "approved")
            print("  → Added as MODERATE")
        elif choice == 'S':
            add_to_training(case['command'], 'SAFE')
            log_approval(case, 'SAFE', "approved")
            print("  → Added as SAFE")
        elif choice == '':
            add_to_training(case['command'], suggested)
            log_approval(case, suggested, "approved")
            print(f"  → Added as {suggested}")
        else:
            print("  → Invalid choice, keeping in pending")
            remaining.append(case)

    return remaining


def main():
    parser = argparse.ArgumentParser(description="Approve pending review cases")
    parser.add_argument("--list", action="store_true", help="List pending cases")
    parser.add_argument("--approve-all", action="store_true",
                        help="Approve all with suggested labels")
    parser.add_argument("--approve", type=int, nargs="+",
                        help="Approve specific indices with suggested labels")
    parser.add_argument("--reject", type=int, nargs="+",
                        help="Reject specific indices")
    parser.add_argument("--label", choices=["DANGEROUS", "MODERATE", "SAFE"],
                        help="Override label for --approve indices")

    args = parser.parse_args()

    cases = load_pending()

    if not cases:
        print("No pending cases to review.")
        return

    print(f"Found {len(cases)} pending cases")

    if args.list:
        for idx, case in enumerate(cases):
            display_case(idx, case)
        return

    if args.approve_all:
        for case in cases:
            label = case.get('suggested_label', case['model_label'])
            add_to_training(case['command'], label)
            log_approval(case, label, "approved-batch")
            print(f"  ✓ {case['command'][:50]}... → {label}")
        save_pending([])
        print(f"\nApproved all {len(cases)} cases. Run build_classifier.py to retrain.")
        return

    if args.approve:
        remaining = []
        label_override = args.label
        for idx, case in enumerate(cases):
            if idx in args.approve:
                label = label_override or case.get('suggested_label', case['model_label'])
                add_to_training(case['command'], label)
                log_approval(case, label, "approved-selective")
                print(f"  ✓ #{idx}: {case['command'][:40]}... → {label}")
            else:
                remaining.append(case)
        save_pending(remaining)
        print(f"\nApproved {len(args.approve)} cases, {len(remaining)} remaining.")
        return

    if args.reject:
        remaining = []
        for idx, case in enumerate(cases):
            if idx in args.reject:
                log_approval(case, None, "rejected")
                print(f"  ✗ #{idx}: {case['command'][:40]}... → REJECTED")
            else:
                remaining.append(case)
        save_pending(remaining)
        print(f"\nRejected {len(args.reject)} cases, {len(remaining)} remaining.")
        return

    # Interactive mode
    remaining = interactive_review(cases)
    save_pending(remaining)

    if remaining:
        print(f"\n{len(remaining)} cases still pending.")
    else:
        print("\nAll cases processed!")

    print("\nTo retrain the model, run:")
    print("  python build_classifier.py --model base")


if __name__ == "__main__":
    main()
