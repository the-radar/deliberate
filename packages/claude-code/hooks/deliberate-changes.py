#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deliberate - File Change Analysis Hook

PostToolUse hook that explains what file changes occurred after Write/Edit operations.
Multi-layer architecture for robust classification:

  Layer 1: Pattern matching + ML model (fast, immune to prompt injection)
  Layer 2: LLM explanation (natural language, configurable provider)

https://github.com/the-radar/deliberate
"""

import json
import sys
import os
import urllib.request
import urllib.error
from pathlib import Path

# Configuration
CLASSIFIER_WRITE_URL = "http://localhost:8765/classify/write"
CLASSIFIER_EDIT_URL = "http://localhost:8765/classify/edit"

# Support both plugin mode (CLAUDE_PLUGIN_ROOT) and npm install mode (~/.deliberate/)
# Plugin mode: config in plugin directory
# npm mode: config in ~/.deliberate/
PLUGIN_ROOT = os.environ.get('CLAUDE_PLUGIN_ROOT')
if PLUGIN_ROOT:
    CONFIG_FILE = str(Path(PLUGIN_ROOT) / ".deliberate" / "config.json")
else:
    CONFIG_FILE = str(Path.home() / ".deliberate" / "config.json")

MAX_CONTENT_LINES = 100
TIMEOUT_SECONDS = 30
CLASSIFIER_TIMEOUT = 5
DEBUG = False
USE_CLASSIFIER = True

# Session state for deduplication and Pre/Post caching
import hashlib
import random
from datetime import datetime


def get_state_file(session_id: str) -> str:
    """Get session-specific state file path."""
    return os.path.expanduser(f"~/.claude/deliberate_changes_state_{session_id}.json")


def get_cache_file(session_id: str, file_hash: str) -> str:
    """Get cache file for Pre/Post hook result sharing."""
    # Using /tmp is intentional for ephemeral cache (nosec B108)
    return f"/tmp/deliberate_cache_{session_id}_{file_hash}.json"  # nosec B108


def cleanup_old_state_files():
    """Remove state files older than 7 days (runs 10% of the time)."""
    if random.random() > 0.1:
        return
    try:
        state_dir = os.path.expanduser("~/.claude")
        if not os.path.exists(state_dir):
            return
        current_time = datetime.now().timestamp()
        seven_days_ago = current_time - (7 * 24 * 60 * 60)
        for filename in os.listdir(state_dir):
            if filename.startswith("deliberate_") and filename.endswith(".json"):
                file_path = os.path.join(state_dir, filename)
                try:
                    if os.path.getmtime(file_path) < seven_days_ago:
                        os.remove(file_path)
                except (OSError, IOError):
                    pass
    except Exception:
        pass


def load_state(session_id: str) -> set:
    """Load the set of already-shown warning keys for this session."""
    state_file = get_state_file(session_id)
    if os.path.exists(state_file):
        try:
            with open(state_file, 'r') as f:
                return set(json.load(f))
        except (json.JSONDecodeError, IOError):
            return set()
    return set()


def save_state(session_id: str, shown_warnings: set):
    """Save the set of shown warning keys."""
    state_file = get_state_file(session_id)
    try:
        os.makedirs(os.path.dirname(state_file), exist_ok=True)
        with open(state_file, 'w') as f:
            json.dump(list(shown_warnings), f)
    except IOError:
        pass


def get_warning_key(file_path: str, content_hash: str) -> str:
    """Generate a unique key for deduplication."""
    # MD5 used for cache key only, not security (nosec B324)
    return f"file-{hashlib.md5(file_path.encode(), usedforsecurity=False).hexdigest()[:8]}-{content_hash[:8]}"


def load_blocking_config() -> dict:
    """Load blocking configuration from ~/.deliberate/config.json"""
    try:
        config_path = Path(CONFIG_FILE)
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                blocking = config.get("blocking", {})
                return {
                    "enabled": blocking.get("enabled", False),
                    "confidenceThreshold": blocking.get("confidenceThreshold", 0.85)
                }
    except Exception:
        pass
    return {"enabled": False, "confidenceThreshold": 0.85}


def load_dedup_config() -> bool:
    """Load deduplication config - returns True if dedup is enabled (default)."""
    try:
        config_path = Path(CONFIG_FILE)
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                return config.get("deduplication", {}).get("enabled", True)
    except Exception:
        pass
    return True


def extract_content(tool_name: str, tool_input: dict) -> tuple:
    """Extract file_path and content from tool input, handling Write/Edit/MultiEdit."""
    file_path = tool_input.get("file_path", "")

    if tool_name == "Write":
        content = tool_input.get("content", "")
        return file_path, content, "write", None, content

    elif tool_name == "Edit":
        old_string = tool_input.get("old_string", "")
        new_string = tool_input.get("new_string", "")
        return file_path, new_string, "edit", old_string, new_string

    elif tool_name == "MultiEdit":
        edits = tool_input.get("edits", [])
        # Combine all new_strings for analysis
        all_new = " ".join(edit.get("new_string", "") for edit in edits)
        all_old = " ".join(edit.get("old_string", "") for edit in edits)
        return file_path, all_new, "multiedit", all_old, all_new

    return "", "", "", None, None


def get_token_from_keychain():
    # type: () -> str | None
    """Get Claude Code OAuth token from macOS Keychain."""
    try:
        import subprocess
        result = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode != 0:
            return None

        credentials_json = result.stdout.strip()
        if not credentials_json:
            return None

        data = json.loads(credentials_json)
        token = data.get("claudeAiOauth", {}).get("accessToken")

        if token and token.startswith("sk-ant-oat01-"):
            return token
        return None
    except Exception:
        return None


def load_llm_config():
    # type: () -> dict | None
    """Load LLM configuration from ~/.deliberate/config.json or keychain"""
    try:
        config_path = Path(CONFIG_FILE)
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                llm = config.get("llm", {})
                provider = llm.get("provider")
                if not provider:
                    return None

                # For claude-subscription, get fresh token from keychain
                api_key = llm.get("apiKey")
                if provider == "claude-subscription":
                    keychain_token = get_token_from_keychain()
                    if keychain_token:
                        api_key = keychain_token

                return {
                    "provider": provider,
                    "base_url": llm.get("baseUrl"),
                    "api_key": api_key,
                    "model": llm.get("model")
                }
    except Exception as e:
        debug(f"Error loading config: {e}")
    return None

def debug(msg):
    if DEBUG:
        print(f"[deliberate-changes] {msg}", file=sys.stderr)


def call_classifier(operation: str, file_path: str, content: str = None, old_string: str = None, new_string: str = None) -> dict | None:
    """Call the classifier server for pattern + ML based classification."""
    if not USE_CLASSIFIER:
        return None

    try:
        if operation == "write":
            request_body = json.dumps({
                "filePath": file_path,
                "content": content[:2000] if content else None
            }).encode('utf-8')
            url = CLASSIFIER_WRITE_URL
        else:  # edit
            request_body = json.dumps({
                "filePath": file_path,
                "oldString": old_string[:1000] if old_string else None,
                "newString": new_string[:1000] if new_string else None
            }).encode('utf-8')
            url = CLASSIFIER_EDIT_URL

        req = urllib.request.Request(
            url,
            data=request_body,
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=CLASSIFIER_TIMEOUT) as response:  # nosec B310
            result = json.loads(response.read().decode('utf-8'))
            debug(f"Classifier result: {result}")
            return result

    except urllib.error.URLError as e:
        debug(f"Classifier unavailable: {e}")
        return None
    except Exception as e:
        debug(f"Classifier error: {e}")
        return None


def call_llm_for_explanation(file_path: str, operation: str, content: str, pre_classification: dict | None = None) -> dict | None:
    """Call the configured LLM to explain the changes using Claude Agent SDK."""

    llm_config = load_llm_config()
    if not llm_config:
        debug("No LLM configured")
        return None

    provider = llm_config["provider"]

    # Only use SDK for claude-subscription provider
    if provider != "claude-subscription":
        debug("Non-OAuth provider - falling back to direct API")
        return None

    file_name = os.path.basename(file_path)

    # Build context from pre-classification if available
    context_note = ""
    if pre_classification:
        risk = pre_classification.get("risk", "UNKNOWN")
        reason = pre_classification.get("reason", "")
        source = pre_classification.get("source", "classifier")
        context_note = f"\n\nPre-screening ({source}): {risk} - {reason}"

    if operation == "write":
        prompt = f"""Analyze this file write for both purpose and security implications. Be concise (1-2 sentences).{context_note}

File: {file_name}
Operation: Created/overwrote file

Content preview:
```
{content[:2000]}
```

Consider:
- What does this file do?
- Any security concerns? (credentials, permissions, executable code, network access, data exposure)
- Could this be malicious or have unintended side effects?

Format your response as:
RISK: [SAFE|MODERATE|DANGEROUS]
EXPLANATION: [your explanation including any security notes]"""
    else:  # edit or multiedit
        prompt = f"""Analyze this edit for both purpose and security implications. Be concise (1-2 sentences).{context_note}

File: {file_name}
Operation: {"Multiple edits (batch)" if operation == "multiedit" else "Find and replace"}

{content}

Consider:
- What does this change do?
- Any security concerns? (weakening validation, exposing data, changing permissions, modifying auth logic)
- Could this introduce vulnerabilities?

Format your response as:
RISK: [SAFE|MODERATE|DANGEROUS]
EXPLANATION: [your explanation including any security notes]"""

    try:
        # Use Claude Agent SDK
        import subprocess
        import tempfile

        # Create temp file for SDK script
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            sdk_script = f"""
import os
import sys
import json
import asyncio
from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

# Set OAuth token from keychain
token = {repr(llm_config["api_key"])}
os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token

async def main():
    # Create SDK client - disallow all tools (just need text response)
    client = ClaudeSDKClient(
        options=ClaudeAgentOptions(
            model={repr(llm_config["model"])},
            max_turns=1,
            disallowed_tools=['Task', 'TaskOutput', 'Bash', 'Glob', 'Grep', 'ExitPlanMode', 'Read', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'TodoWrite', 'KillShell', 'AskUserQuestion', 'Skill', 'SlashCommand', 'EnterPlanMode', 'WebSearch']
        )
    )

    # Send prompt
    prompt = {repr(prompt)}

    async with client:
        await client.query(prompt)

        # Collect response from ResultMessage
        response_text = ""
        async for msg in client.receive_response():
            msg_type = type(msg).__name__
            if msg_type == 'ResultMessage' and hasattr(msg, 'result'):
                response_text = msg.result
                break

        print(response_text)

# Run async main
asyncio.run(main())
"""
            f.write(sdk_script)
            script_path = f.name

        # Run SDK script
        result = subprocess.run(
            ["python3", script_path],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS
        )

        os.unlink(script_path)

        if result.returncode != 0:
            debug(f"SDK script failed: {result.stderr}")
            return None

        llm_content = result.stdout.strip()

        # Parse the response
        risk = "MODERATE"
        explanation = llm_content

        if "RISK:" in llm_content and "EXPLANATION:" in llm_content:
            parts = llm_content.split("EXPLANATION:")
            risk_line = parts[0]
            explanation = parts[1].strip() if len(parts) > 1 else llm_content

            if "DANGEROUS" in risk_line:
                risk = "DANGEROUS"
            elif "SAFE" in risk_line:
                risk = "SAFE"

        return {"risk": risk, "explanation": explanation}

    except Exception as e:
        debug(f"SDK error: {e}")
        return None


def main():
    debug("Hook started")

    # Periodically clean up old state files
    cleanup_old_state_files()

    try:
        input_data = json.load(sys.stdin)
        debug(f"Got input: tool={input_data.get('tool_name')}")
    except json.JSONDecodeError as e:
        debug(f"JSON decode error: {e}")
        sys.exit(0)

    # Extract session ID for deduplication
    session_id = input_data.get("session_id", "default")
    hook_event = input_data.get("hook_event_name", "PreToolUse")
    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    # Only process Write, Edit, and MultiEdit
    if tool_name not in ("Write", "Edit", "MultiEdit"):
        debug(f"Not Write/Edit/MultiEdit, skipping: {tool_name}")
        sys.exit(0)

    # Extract content using unified function
    file_path, content, operation, old_string, new_string = extract_content(tool_name, tool_input)

    if not file_path:
        debug("No file path, skipping")
        sys.exit(0)

    if not content and not new_string:
        debug("No content, skipping")
        sys.exit(0)

    # Generate content hash for caching and deduplication
    content_hash = hashlib.md5((file_path + (new_string or content or "")).encode(), usedforsecurity=False).hexdigest()

    # Build content description based on operation
    if operation == "write":
        lines = content.split('\n')
        line_count = len(lines)
        if line_count > MAX_CONTENT_LINES:
            preview = '\n'.join(lines[:MAX_CONTENT_LINES])
            content_desc = f"{preview}\n... ({line_count - MAX_CONTENT_LINES} more lines)"
        else:
            content_desc = content

    elif operation == "multiedit":
        edits = tool_input.get("edits", [])
        edit_count = len(edits)
        content_desc = f"MultiEdit: {edit_count} changes\n"
        for i, edit in enumerate(edits[:3]):  # Show first 3
            old = edit.get("old_string", "")[:200]
            new = edit.get("new_string", "")[:200]
            content_desc += f"\n[{i+1}] {old[:50]}... → {new[:50]}..."
        if edit_count > 3:
            content_desc += f"\n... and {edit_count - 3} more edits"

    else:  # edit
        content_desc = f"OLD:\n```\n{old_string[:1000]}\n```\n\nNEW:\n```\n{new_string[:1000]}\n```"

    # Get relative path for display
    rel_path = os.path.basename(file_path)
    try:
        home = os.path.expanduser("~")
        if file_path.startswith(home):
            rel_path = "~" + file_path[len(home):]
    except Exception:
        pass

    # Layer 1: Try classifier server first (pattern + ML) for risk level
    # MultiEdit uses the edit endpoint (has old/new strings like Edit)
    classifier_op = "edit" if operation == "multiedit" else operation
    classifier_result = call_classifier(
        operation=classifier_op,
        file_path=file_path,
        content=content if operation == "write" else None,
        old_string=old_string if operation in ("edit", "multiedit") else None,
        new_string=new_string if operation in ("edit", "multiedit") else None
    )

    # Layer 2: Get LLM explanation for detailed analysis
    debug(f"Analyzing {operation}: {file_path[:80]}")
    llm_result = call_llm_for_explanation(file_path, operation, content_desc, classifier_result)

    # Progressive degradation: Use classifier if LLM unavailable
    llm_unavailable_warning = ""
    if not llm_result:
        if classifier_result and classifier_result.get("source") != "fallback":
            # Classifier worked, use its result even without LLM explanation
            risk = classifier_result.get("risk", "MODERATE")
            explanation = classifier_result.get('reason', 'Review file change manually')
            llm_unavailable_warning = "\n\n⚠️  LLM unavailable - using basic pattern matching only.\nTo get detailed explanations, configure: ~/.deliberate/config.json\nOr run: deliberate install"
            debug("LLM unavailable, using classifier-only result")
        else:
            # Both layers failed - exit silently (fail-open)
            # This prevents blocking user if Deliberate is misconfigured
            debug("Both classifier and LLM unavailable, allowing file change")
            sys.exit(0)
    else:
        # Use classifier risk if available, otherwise use LLM risk
        if classifier_result:
            risk = classifier_result.get("risk", llm_result["risk"])
        else:
            risk = llm_result["risk"]
        explanation = llm_result["explanation"]

    # Session deduplication - check if we've already warned about this exact change
    if load_dedup_config():
        warning_key = get_warning_key(file_path, content_hash)
        shown_warnings = load_state(session_id)

        if warning_key in shown_warnings:
            # Already shown this warning in this session - allow without re-prompting
            debug(f"Deduplicated: {warning_key} already shown this session")
            sys.exit(0)

        # Mark as shown and save state
        shown_warnings.add(warning_key)
        save_state(session_id, shown_warnings)

    # NOTE: This is PostToolUse - the write already happened
    # Show informational output for ALL risk levels (including SAFE)
    # User can review what happened even for safe changes
    # We can only inform the user, not block. No exit(2) here.

    # ANSI color codes for terminal output
    BOLD = "\033[1m"
    CYAN = "\033[96m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    GREEN = "\033[92m"
    RESET = "\033[0m"

    # Choose emoji and color based on risk for visual branding
    if risk == "DANGEROUS":
        emoji = "🚨"
        color = RED
    elif risk == "SAFE":
        emoji = "✅"
        color = GREEN
    else:
        emoji = "⚡"
        color = YELLOW

    # Operation label
    if operation == "write":
        op_label = "Write"
    elif operation == "multiedit":
        op_label = "MultiEdit"
    else:
        op_label = "Edit"

    # User-facing message with branded formatting and colors
    # Make the explanation text visible with the risk color so it's not skipped
    user_message = f"{emoji} {BOLD}{CYAN}DELIBERATE{RESET} {BOLD}{color}[{risk}]{RESET} {op_label}\n    File: {rel_path}\n    {color}{explanation}{RESET}{llm_unavailable_warning}"

    # Context for Claude
    context = f"**Deliberate {op_label}** [{risk}] {rel_path}: {explanation}{llm_unavailable_warning}"

    # Cache result for Post hook to read (if this is PreToolUse)
    cache_file = get_cache_file(session_id, content_hash)
    try:
        with open(cache_file, 'w') as f:
            json.dump({
                "risk": risk,
                "explanation": explanation,
                "user_message": user_message,
                "context": context,
                "op_label": op_label,
                "rel_path": rel_path
            }, f)
    except IOError:
        pass

    # Output for PostToolUse - informational only
    # systemMessage is what makes it visible to the user
    # permissionDecision/permissionDecisionReason are for PreToolUse only
    output = {
        "systemMessage": user_message,
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": context
        }
    }

    print(json.dumps(output))

    sys.exit(0)


if __name__ == "__main__":
    main()
