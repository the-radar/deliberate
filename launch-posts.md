# Launch Posts for Deliberate v1.0.5

## LinkedIn

**Headline:** AI agents need guardrails. Now yours have them—everywhere.

We just released **Deliberate v1.0.5**, expanding our AI safety layer to support **Antigravity** and **Google's Gemini CLI**.

If you're using AI agents to write code, you know the anxiety of watching them execute shell commands. One wrong `rm -rf` or `git reset` can cost hours of work.

Deliberate solves this by intercepting commands *before* they run. It uses a local ML model to classify risk and explains exactly what will happen in plain English.

**What's new in v1.0.5:**
✅ **Antigravity Support:** Full integration with `PreToolUse` hooks to block dangerous commands.
✅ **Gemini CLI Support:** Native hooks for Google's agentic CLI.
✅ **Robust Installation:** Improved model setup that works even on restricted networks.

It now protects you across the entire ecosystem:
- Claude Code
- OpenCode
- Antigravity
- Gemini CLI

Install it once, and it configures all your tools automatically:

```bash
npm install -g deliberate
deliberate install
```

Source available on GitHub: https://github.com/the-radar/deliberate

#AI #DevTools #SoftwareEngineering #Antigravity #Gemini #ClaudeCode

---

## Twitter / X Thread

1/5
🚨 **Deliberate v1.0.5 is live!**

Now protecting your **Antigravity** and **Gemini CLI** sessions.

The safety layer for AI coding agents just got bigger. 🛡️

https://github.com/the-radar/deliberate

2/5
**Antigravity Support** ⚡
Deliberate now hooks directly into Antigravity's `PreToolUse` event.

Every bash command is analyzed before it runs.
- 🚨 Dangerous? You get a warning.
- ✅ Safe? It runs instantly.

No more accidental `rm -rf` or git disasters.

3/5
**Gemini CLI Support** ♊
Using Google's new agentic CLI? We've got you covered.

Deliberate intercepts commands and tracks file changes, giving you full visibility into what the agent is doing—before it's too late.

4/5
**One Safety Layer, Any Agent** 🔒
Whether you use Claude Code, OpenCode, Antigravity, or Gemini, Deliberate provides consistent, ML-powered safety checks.

- Local execution (privacy first)
- Semantic analysis (catches obfuscated attacks)
- Human-readable explanations

5/5
Try it now:

```bash
npm install -g deliberate
deliberate install
```

It automatically detects and configures your installed agents.

Star the repo: https://github.com/the-radar/deliberate

#AI #CodingAgents #DevTools #Security
