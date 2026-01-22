#!/bin/bash
# Antigravity Post-Tool-Use Hook for Deliberate
# Logs file changes

TOOL_NAME="$1"
TOOL_ARGS="$2"
TOOL_OUTPUT="$3"

# Only check file modification tools
if [[ "$TOOL_NAME" != "write" && "$TOOL_NAME" != "edit" && "$TOOL_NAME" != "replace" ]]; then
  exit 0
fi

# Construct JSON payload
# We pass the raw args and let the python script parse what it can
PAYLOAD=$(jq -n --arg tool "$TOOL_NAME" --arg args "$TOOL_ARGS" --arg session "$AGY_SESSION_ID" \
  '{tool_name: $tool, tool_input: $args, session_id: $session}')

HOOK_SCRIPT="$HOME/.claude/hooks/deliberate-changes.py"
if [[ -f "./hooks/deliberate-changes.py" ]]; then
  HOOK_SCRIPT="./hooks/deliberate-changes.py"
fi

# Run the hook (fire and forget, or wait?)
# We wait but ignore output since it's just logging/notifying
echo "$PAYLOAD" | python3 "$HOOK_SCRIPT" > /dev/null 2>&1

exit 0
