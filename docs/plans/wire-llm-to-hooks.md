# Wire bash + write hooks to the configured LLM provider

Issue: the-radar/deliberate#10

## Why

`hooks/deliberate-commands.py` and `hooks/deliberate-changes.py` only
call the LLM when `llm.provider == "claude-subscription"`. Every other
provider (Dexter, Ollama, openai-compatible — i.e. everyone since #3
generalized the model server) falls through to local-rule analysis
forever. The hooks aren't broken, they're just degraded — bash and
write events never get an LLM explanation in the timeline.

## What ships

### "deliberate llm chat" CLI

A provider-agnostic LLM call surface so Python hooks can ask
deliberate to run a prompt against whichever endpoint the user has
configured.

- Read JSON request from stdin (`{prompt}` or `{messages}`, optional
  `maxTokens` and `timeoutMs`).
- Invoke `streamChat` with the user's configured provider.
- Print one JSON response on stdout (`{text, ok}` or
  `{text:"", ok:false, error}`).
- Always exit 0. Hooks decide what to do on failure.

### "read stdin"

Sync read of stdin (matches the pattern used in
`src/discipline/eval-entry.js`) — avoids the async-listener-race that
loses the first chunk when Commander's lazy import resolves.

### "emit"

JSON output writer — tight wrapper so both the success and failure
paths land the right shape.

### "run llm cli"

Top-level orchestrator: parse request, build messages, run
streamChat with abort + timeout, classify the result into one of the
two response shapes.

## Python-side change (separate)

Both `call_llm_for_explanation` definitions stop early-returning on
non-`claude-subscription` providers and instead subprocess
`node bin/cli.js llm chat`, pass the existing prompt verbatim, and
parse the `text` field with the existing `RISK:` / `EXPLANATION:`
regex. Local-rule fallback stays the safety net when the LLM
errors.

## Proof of working

- A `bash` command runs through a real Dexter/Ollama gateway and the
  timeline event carries the model's explanation, not a rule label.
- A `Write` of a code file produces the same.
- With the gateway down, the hook still completes via local rules
  and emits no misleading "LLM unavailable — configure" copy.
