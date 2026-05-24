/**
 * `deliberate llm chat` — provider-agnostic LLM call used by the Python hooks.
 *
 * Reads a JSON request from stdin, invokes `streamChat` with the user's
 * configured provider (Dexter, Ollama, anthropic, etc. via #3's
 * bring-your-own gateway), and writes one JSON response to stdout.
 *
 * Request shape:
 *   { "prompt": "..." , "maxTokens"?: number, "timeoutMs"?: number }
 *   OR
 *   { "messages": [{role, content}, ...], "maxTokens"?: number, "timeoutMs"?: number }
 *
 * Response shape:
 *   { "text": "...", "ok": true }
 *   OR on failure:
 *   { "text": "", "ok": false, "error": "<reason>" }
 *
 * Always exits 0 — the hooks decide what to do on failure (degrade to
 * local rules). Never throws.
 */

import fs from 'fs';
import { streamChat } from './chat-client.js';

// Plan: docs/plans/wire-llm-to-hooks.md§"read stdin" · Issue: #10
function readStdin() {
  if (process.stdin.isTTY) return '';
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Plan: docs/plans/wire-llm-to-hooks.md§"emit" · Issue: #10
function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
}

// Plan: docs/plans/wire-llm-to-hooks.md§"run llm cli" · Issue: #10
export async function runLlmCli() {
  const raw = readStdin();
  let req = {};
  try { req = raw ? JSON.parse(raw) : {}; } catch {
    emit({ text: '', ok: false, error: 'invalid JSON on stdin' });
    return;
  }

  const maxTokens = Number.isFinite(req.maxTokens) ? req.maxTokens : 1024;
  const timeoutMs = Number.isFinite(req.timeoutMs) ? req.timeoutMs : 120_000;

  let messages = Array.isArray(req.messages) ? req.messages : null;
  if (!messages && typeof req.prompt === 'string') {
    messages = [{ role: 'user', content: req.prompt }];
  }
  if (!messages || messages.length === 0) {
    emit({ text: '', ok: false, error: 'missing prompt or messages' });
    return;
  }

  let text = '';
  let errorMessage = null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await streamChat({
      messages,
      maxTokens,
      timeoutMs,
      signal: controller.signal,
      onEvent: (ev) => {
        if (ev && ev.type === 'token' && typeof ev.text === 'string') text += ev.text;
        if (ev && ev.type === 'error') errorMessage = ev.message || 'upstream error';
      }
    });
  } catch (err) {
    errorMessage = err && err.message ? err.message : 'stream threw';
  } finally {
    clearTimeout(timeout);
  }

  if (errorMessage) {
    emit({ text: '', ok: false, error: errorMessage });
    return;
  }
  if (!text.trim()) {
    emit({ text: '', ok: false, error: 'empty response from LLM' });
    return;
  }
  emit({ text, ok: true });
}

export default { runLlmCli };
