# Troubleshooting

## Installation Issues

### "command not found: deliberate-claude-code"

The CLI wasn't installed globally or isn't in your PATH.

```bash
# Try installing globally
npm install -g @deliberate/claude-code

# Or run directly from the package
npx @deliberate/claude-code install
```

### Hooks not triggering

1. **Check hooks are installed:**
   ```bash
   ls -la ~/.claude/hooks/ | grep deliberate
   ```

   You should see:
   ```
   deliberate-explain-command.py -> /path/to/hooks/explain-command.py
   deliberate-explain-changes.py -> /path/to/hooks/explain-changes.py
   ```

2. **Check settings.json:**
   ```bash
   cat ~/.claude/settings.json | grep -A5 deliberate
   ```

   Should show hook configurations for PreToolUse and PostToolUse.

3. **Restart Claude Code:**
   Hooks are loaded on startup. Close and reopen Claude Code.

### Python errors in hooks

The hooks require Python 3.9+.

```bash
# Check Python version
python3 --version

# On Windows, ensure Python is in PATH
python --version
```

### Permission denied (Unix)

```bash
# Make hooks executable
chmod +x ~/.claude/hooks/deliberate-*.py
```

## LLM Configuration Issues

### "No LLM configured"

The hooks can't find a valid configuration.

```bash
# Check config exists
cat ~/.deliberate/config.json

# Reconfigure
deliberate-claude-code install
```

### Anthropic API errors

```
urllib.error.HTTPError: HTTP Error 401: Unauthorized
```

Your API key is invalid or expired.

1. Check your key at https://console.anthropic.com/settings/keys
2. Update config:
   ```bash
   # Edit ~/.deliberate/config.json and update apiKey
   ```

### anthropic-max-router connection refused

```
urllib.error.URLError: <urlopen error [Errno 61] Connection refused>
```

The router isn't running.

```bash
# Start the router
anthropic-max-router

# Or check if it's running
curl http://localhost:3456/health
```

### Ollama connection refused

```bash
# Start Ollama
ollama serve

# Check it's running
curl http://localhost:11434/api/tags
```

## Classifier Server Issues

### Model download fails

```
Failed to load model: Unauthorized access
```

The model might not be accessible. Check your network connection and try again.

```bash
# Clear cache and retry
rm -rf .cache/transformers
deliberate-claude-code serve
```

### Server already running

```
Error: listen EADDRINUSE: address already in use :::8765
```

Another instance is running or the port is in use.

```bash
# Find what's using the port
lsof -i :8765

# Kill it if needed
kill -9 <PID>
```

### High memory usage

The ML model uses ~500MB RAM. If this is too much:

1. Don't run the server (pattern matching will be used as fallback)
2. Or use a machine with more RAM

## Hook Output Issues

### Explanations not appearing

1. **Check LLM is reachable:**
   ```bash
   # For anthropic-max-router
   curl http://localhost:3456/health

   # For Ollama
   curl http://localhost:11434/api/tags
   ```

2. **Enable debug mode:**
   Edit the hook file and set `DEBUG = True`, then check stderr.

### Wrong risk classification

The classifier uses:
- Pattern matching (fallback)
- ML model (if server running)

If classifications seem wrong:
1. Start the classifier server for better accuracy
2. Report false positives/negatives as issues

### Timeout errors

Hooks have a 35-second timeout by default. If your LLM is slow:

1. Edit `~/.claude/settings.json`
2. Increase the timeout value for deliberate hooks

## Windows-Specific Issues

### Symlinks not working

Windows requires admin privileges for symlinks. The installer copies files instead.

If hooks aren't updating after edits:
```bash
# Re-run install to copy updated files
deliberate-claude-code install
```

### Python not found

Ensure Python is installed and in your PATH:
```cmd
python --version
```

If not found, install from https://python.org and check "Add to PATH" during installation.

### Path issues

Windows uses backslashes. If you see path errors:
1. Check config file uses forward slashes or escaped backslashes
2. Reinstall to regenerate paths

## Debugging

### Enable verbose logging

Edit the hook files:
```python
DEBUG = True  # Near the top of the file
```

Then run Claude Code and check stderr output.

### Test hooks manually

```bash
# Test explain-command
echo '{"tool_name": "Bash", "tool_input": {"command": "ls -la"}}' | python3 ~/.claude/hooks/deliberate-explain-command.py

# Test explain-changes
echo '{"tool_name": "Write", "tool_input": {"file_path": "/tmp/test.txt", "content": "hello"}}' | python3 ~/.claude/hooks/deliberate-explain-changes.py
```

### Check classifier directly

```bash
# If server is running
curl -X POST http://localhost:8765/classify/command \
  -H "Content-Type: application/json" \
  -d '{"command": "rm -rf /"}'
```

## Still Having Issues?

1. Check the [GitHub issues](https://github.com/anthropics/deliberate-claude-code/issues)
2. Open a new issue with:
   - Your OS and version
   - Node.js version (`node --version`)
   - Python version (`python3 --version`)
   - Error messages
   - Steps to reproduce
