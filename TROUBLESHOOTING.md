# Troubleshooting

## Install and hook wiring

### `deliberate` command not found

```bash
npm install -g deliberate
```

If global install is not available:

```bash
npx deliberate install
```

### Hooks are not triggering

1. Verify hook files exist:

```bash
ls -la ~/.claude/hooks/ | grep deliberate
```

2. Verify hook entries in `~/.claude/settings.json`.

3. Restart Claude Code (hooks load on startup).

### Python errors

Hooks require Python 3.9+:

```bash
python3 --version
```

### Permission denied on hook scripts (macOS/Linux)

```bash
chmod +x ~/.claude/hooks/deliberate-*.py
```

## Server and pane

### Port already in use (`8765`)

```bash
lsof -i :8765
```

Stop conflicting process, or run Deliberate on a different port.

### Pane opens but no live events

- Make sure hooks are installed and Deliberate is enabled (`x` toggle in TUI).
- Start server if needed:

```bash
deliberate serve
```

- Keep in mind events are persisted locally under `~/.deliberate/events/`, so history should still appear even if server starts late.

### Pane focus issues in tmux/WezTerm

Use `deliberate pane` from the same terminal session as Claude Code. Deliberate uses detached split behavior in tmux to avoid stealing focus.

## LLM explanation issues

### No LLM configured

Run install again and configure provider:

```bash
deliberate install
```

### LLM/network unavailable

Deliberate falls back to local rule hints and still preserves review flow. You can continue without full LLM detail.

## TUI behavior

### Need history instead of pending queue

Press `v` to toggle from review queue to history mode.

### Need to stop repeated prompts for a known command

Select event and press `s` to save an exact “don’t flag” rule, or use `w` for a guided always-allow policy pattern.

## Windows notes

### Symlinks

Installer copies hook files on Windows instead of symlinking. Re-run install after local hook edits:

```bash
deliberate install
```

### Python PATH

```cmd
python --version
```

If missing, install Python and enable “Add to PATH”.

## Debugging

### Enable hook debug logs

Set `DEBUG = True` in the relevant hook file under `~/.claude/hooks/` (or source repo if symlinked).

### Manual hook test

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | python3 ~/.claude/hooks/deliberate-commands.py
```

## Still stuck?

Capture:
- OS + version
- Node version (`node --version`)
- Python version (`python3 --version`)
- exact error message
- minimal repro steps
