#!/bin/bash
# Gemini Post-File-Change Hook for Deliberate

FILE_PATH="$1"

# Construct JSON payload
# Gemini passes file path, we need to infer content or just log the path
PAYLOAD=$(jq -n --arg path "$FILE_PATH" --arg session "$GEMINI_SESSION_ID" \
  '{tool_name: "Write", tool_input: {file_path: $path}, session_id: $session}')

HOOK_SCRIPT="$HOME/.claude/hooks/deliberate-changes.py"
if [[ -f "./hooks/deliberate-changes.py" ]]; then
  HOOK_SCRIPT="./hooks/deliberate-changes.py"
fi

echo "$PAYLOAD" | python3 "$HOOK_SCRIPT" > /dev/null 2>&1

exit 0
