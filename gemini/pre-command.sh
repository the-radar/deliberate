#!/bin/bash
# Gemini Pre-Command Hook for Deliberate
# Intercepts shell commands

COMMAND="$1"

# Construct JSON payload
PAYLOAD=$(jq -n --arg cmd "$COMMAND" --arg session "$GEMINI_SESSION_ID" \
  '{tool_name: "Bash", tool_input: {command: $cmd}, session_id: $session, cwd: env.PWD}')

HOOK_SCRIPT="$HOME/.claude/hooks/deliberate-commands.py"
if [[ -f "./hooks/deliberate-commands.py" ]]; then
  HOOK_SCRIPT="./hooks/deliberate-commands.py"
fi

OUTPUT=$(echo "$PAYLOAD" | python3 "$HOOK_SCRIPT")
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "BLOCKED by Deliberate" >&2
  exit 1
fi

exit 0
