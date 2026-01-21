---
name: recover-code
description: Recover lost code from Claude Code conversation logs or Deliberate backups
---

# Code Recovery Skill

Use this skill when code has been accidentally deleted or lost. It searches through:
1. Deliberate's automatic backups (`~/.deliberate/backups/`)
2. Claude Code conversation logs (`~/.claude/projects/`)

## Recovery Sources

### 1. Deliberate Backups (Preferred)

Deliberate automatically creates backups before CRITICAL operations. Check these first:

```bash
# List available backups for a project
ls -la ~/.deliberate/backups/<project-name>/

# Each backup contains:
# - metadata.json: command that triggered backup, timestamp, session info
# - files/: backed up files preserving directory structure
# - git_state/: branch, commit, uncommitted changes
```

To restore from a Deliberate backup:
1. Find the relevant backup by timestamp
2. Review `metadata.json` to confirm it's the right backup
3. Copy files from `files/` back to your project

### 2. Claude Code Conversation Logs

If no Deliberate backup exists, code can be reconstructed from conversation logs.

**Key insight**: Project-specific directories (e.g., `~/.claude/projects/-Users-bobola-Documents-deliberate/`) often only contain hook outputs. The actual development work with file reads/writes is in the PARENT directory session (e.g., `~/.claude/projects/-Users-bobola-Documents/`).

#### Finding the Right Session File

```bash
# List session files by size (larger = more development work)
ls -lhS ~/.claude/projects/-Users-*-Documents/*.jsonl

# Check tool usage in a session
grep -o '"name":"[^"]*"' <session>.jsonl | sort | uniq -c | sort -rn

# Find file paths touched
grep -o '"file_path":"[^"]*"' <session>.jsonl | sort -u
```

#### Extracting Code

Tool results are logged with `toolUseResult` containing file content:

```python
#!/usr/bin/env python3
"""Extract files from Claude Code conversation logs."""
import json
import os
import sys

def extract_files(session_file, output_dir):
    """Extract all file contents from a session file."""
    os.makedirs(output_dir, exist_ok=True)
    extracted = {}

    with open(session_file, 'r') as f:
        for line in f:
            try:
                entry = json.loads(line)

                # Look for toolUseResult with file content
                if entry.get("type") == "assistant":
                    msg = entry.get("message", {})
                    for block in msg.get("content", []):
                        if block.get("type") == "tool_result":
                            content = block.get("content", [])
                            for item in content:
                                if isinstance(item, dict) and item.get("type") == "tool_result":
                                    result = item.get("content", "")
                                    # Parse file content from result
                                    if "filePath" in str(result):
                                        # Extract and save
                                        pass

                # Look for Write tool inputs
                if entry.get("type") == "assistant":
                    msg = entry.get("message", {})
                    for block in msg.get("content", []):
                        if block.get("type") == "tool_use" and block.get("name") == "Write":
                            input_data = block.get("input", {})
                            file_path = input_data.get("file_path", "")
                            content = input_data.get("content", "")
                            if file_path and content:
                                extracted[file_path] = content

            except json.JSONDecodeError:
                continue

    # Write extracted files
    for file_path, content in extracted.items():
        # Create relative path in output dir
        rel_path = file_path.lstrip("/")
        out_path = os.path.join(output_dir, rel_path)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'w') as f:
            f.write(content)
        print(f"Extracted: {file_path}")

    print(f"\nExtracted {len(extracted)} files to {output_dir}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python extract_files.py <session.jsonl> <output_dir>")
        sys.exit(1)
    extract_files(sys.argv[1], sys.argv[2])
```

## Recovery Workflow

1. **Check Deliberate backups first**:
   ```bash
   ls -la ~/.deliberate/backups/
   ```

2. **If no backup, find the session file**:
   ```bash
   # Look for large session files in the parent directory
   ls -lhS ~/.claude/projects/-Users-*-Documents/*.jsonl | head -5
   ```

3. **Verify it has your code**:
   ```bash
   grep -l "YourFileName" ~/.claude/projects/-Users-*-Documents/*.jsonl
   ```

4. **Extract the code**:
   - Use the Python script above, or
   - Manually grep and extract specific files

5. **Restore to a new directory** (don't overwrite current state):
   ```bash
   mkdir ~/recovered-code
   # Copy/extract files there first
   # Review before moving to final location
   ```

## Prevention

To avoid needing recovery:

1. **Enable Deliberate backups** (on by default):
   ```json
   // ~/.deliberate/config.json
   {
     "backup": {
       "enabled": true,
       "riskThreshold": "HIGH"
     }
   }
   ```

2. **Commit frequently** - git is the best backup

3. **Pay attention to workflow warnings** - Deliberate now detects dangerous command sequences

4. **Review consequence previews** - Deliberate shows what will be deleted before destructive operations
