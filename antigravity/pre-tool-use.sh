#!/bin/bash
# Antigravity Pre-Tool-Use Hook for Deliberate
# Intercepts bash commands to check for safety

TOOL_NAME="$1"
TOOL_ARGS="$2"

# Only check bash/execute_command tools
if [[ "$TOOL_NAME" != "bash" && "$TOOL_NAME" != "execute_command" && "$TOOL_NAME" != "terminal" ]]; then
  exit 0
fi

# Extract command from args (assuming JSON or string)
# This is a best-guess adapter. In a real scenario, we'd inspect the actual payload.
COMMAND="$TOOL_ARGS"

# Construct JSON payload for Deliberate
# We use jq to safely escape the command string
PAYLOAD=$(jq -n --arg cmd "$COMMAND" --arg session "$AGY_SESSION_ID" \
  '{tool_name: "Bash", tool_input: {command: $cmd}, session_id: $session, cwd: env.PWD}')

# Call the core Deliberate hook
# We use the global install path or local if testing
HOOK_SCRIPT="$HOME/.claude/hooks/deliberate-commands.py"
if [[ -f "./hooks/deliberate-commands.py" ]]; then
  HOOK_SCRIPT="./hooks/deliberate-commands.py"
fi

# Run the python hook
OUTPUT=$(echo "$PAYLOAD" | python3 "$HOOK_SCRIPT")
EXIT_CODE=$?

# Check if blocked
if [[ $EXIT_CODE -ne 0 ]]; then
  echo "BLOCKED by Deliberate: Command rejected." >&2
  exit 1
fi

exit 0
