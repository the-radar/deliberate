/**
 * Shared chat streaming client.
 *
 * Used by:
 * - Server SSE endpoint (/api/chat)
 * - Terminal UI (embedded chat)
 *
 * This keeps auth + streaming parsing in one place so behavior matches across UIs.
 *
 * Security:
 * - Never log keys/tokens or raw request payloads.
 * - Bound message sizes and time out upstream calls.
 */

import { getLLMConfig } from './config.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_TIMEOUT_MS = 60_000;

function nowIso() {
  return new Date().toISOString();
}

function safeString(value, max = 20_000) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function isMessageArray(value) {
  return Array.isArray(value) && value.every((m) => m && typeof m === 'object');
}

function resolveHomePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;
  const trimmed = filePath.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

function readEnvTokenFile(filePath, envName) {
  const resolved = resolveHomePath(filePath);
  if (!resolved || typeof envName !== 'string' || !envName.trim()) return null;

  try {
    const body = fs.readFileSync(resolved, 'utf-8');
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${envName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=(.*)$`, 'm');
    const match = body.match(pattern);
    if (!match) return null;
    return match[1].trim().replace(/^['\"]|['\"]$/g, '') || null;
  } catch {
    return null;
  }
}

function resolveAuthToken(llm) {
  if (typeof llm.apiKey === 'string' && llm.apiKey.trim()) {
    return llm.apiKey.trim();
  }

  if (llm.authTokenEnv && process.env[llm.authTokenEnv]) {
    return process.env[llm.authTokenEnv].trim() || null;
  }

  return readEnvTokenFile(llm.authTokenFile, llm.authTokenEnv);
}

function buildAuthHeaders(llm) {
  const token = resolveAuthToken(llm);
  if (!token) return {};

  const header = String(llm.authHeader || 'authorization').toLowerCase();
  if (header === 'x-api-key') {
    return { 'x-api-key': token };
  }

  return { authorization: `Bearer ${token}` };
}

function buildLLMConfig() {
  return getLLMConfig() || {
    provider: null,
    protocol: 'openai-chat-completions',
    baseUrl: null,
    apiKey: null,
    model: null,
    authTokenFile: null,
    authTokenEnv: null,
    authHeader: null
  };
}
function buildSystemPrompt(context) {
  const parts = [];
  parts.push('You are Deliberate, a safety assistant helping a developer understand what a shell command will do.');
  parts.push('Be direct, specific, and pragmatic. Call out real risks, irreversible actions, and safer alternatives.');

  if (context.command) {
    parts.push('');
    parts.push('Command:');
    parts.push(context.command);
  }
  if (context.risk) {
    parts.push('');
    parts.push(`Assessed risk: ${context.risk}`);
  }
  if (context.explanation) {
    parts.push('');
    parts.push('Current explanation:');
    parts.push(context.explanation);
  }
  if (context.consequences) {
    parts.push('');
    parts.push('Consequences (structured):');
    parts.push(JSON.stringify(context.consequences, null, 2));
  }
  if (Array.isArray(context.evidence) && context.evidence.length) {
    parts.push('');
    parts.push('Evidence (sources):');
    parts.push(JSON.stringify(context.evidence.slice(0, 8), null, 2));
  }

  return parts.join('\n');
}

async function streamMockResponse(prompt, onEvent, { signal } = {}) {
  const text = `Mock chat response.\n\nYou asked:\n${prompt}\n\nIf you want real chat, configure deliberate's llm.baseUrl, llm.model, and local auth settings in ~/.deliberate/config.json.`;
  const chunks = text.split(/(\s+)/).filter(Boolean);

  for (const chunk of chunks) {
    if (signal?.aborted) return;
    onEvent?.({ type: 'token', text: chunk });
    await new Promise((r) => setTimeout(r, 5));
  }
}

function buildMessagesPayload(messages) {
  return messages
    .slice(0, 50)
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: safeString(m.content, 20_000) || ''
    }));
}

function emitDelta(parsed, protocol, onEvent) {
  if (protocol === 'anthropic-messages') {
    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
      const text = parsed.delta?.text;
      if (typeof text === 'string' && text.length) onEvent?.({ type: 'token', text });
    }
    return;
  }

  const text = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
  if (typeof text === 'string' && text.length) onEvent?.({ type: 'token', text });
}

async function streamSseResponse(response, protocol, onEvent, abortController) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trimEnd();
      buffer = buffer.slice(idx + 1);

      if (!line || !line.startsWith('data:')) continue;

      const raw = line.slice('data:'.length).trim();
      if (!raw || raw === '[DONE]') continue;

      try {
        emitDelta(JSON.parse(raw), protocol, onEvent);
      } catch {
        continue;
      }
    }

    if (abortController.signal.aborted) break;
  }
}

function buildRequestPayload(llm, system, messages, maxTokens) {
  const payload = {
    model: llm.model,
    max_tokens: Number(maxTokens) > 0 ? Math.min(Number(maxTokens), 4000) : DEFAULT_MAX_TOKENS,
    stream: true,
    messages: buildMessagesPayload(messages)
  };

  if (llm.protocol === 'anthropic-messages') {
    return { ...payload, system };
  }

  return {
    ...payload,
    reasoning: { effort: 'none' },
    messages: [
      { role: 'system', content: system },
      ...payload.messages
    ]
  };
}

function buildRequestHeaders(llm) {
  const headers = {
    'content-type': 'application/json',
    ...buildAuthHeaders(llm)
  };

  if (llm.protocol === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01';
  }

  return headers;
}

/**
 * Stream chat responses, emitting events via callback.
 *
 * Input format (minimum):
 * {
 *   messages: [{ role: "user"|"assistant", content: "..." }, ...],
 *   context: { command, risk, explanation, consequences }
 * }
 */
// Plan: docs/plans/wire-llm-to-hooks.md§"deliberate llm chat CLI" · Issue: #10
export async function streamChat({ messages, context = {}, maxTokens, onEvent, signal, timeoutMs } = {}) {
  if (!isMessageArray(messages) || messages.length < 1) {
    throw new Error('Missing required field: messages (array)');
  }

  onEvent?.({ type: 'start', timestamp: nowIso() });

  const latestUser = messages.slice().reverse().find((m) => m.role === 'user');
  const userPrompt = safeString(latestUser?.content, 20_000) || '';

  const mode = String(process.env.DELIBERATE_CHAT_MODE || '').toLowerCase();
  const llm = buildLLMConfig();

  const wantsMock = mode === 'mock';
  const hasAuth = Boolean(resolveAuthToken(llm));
  const shouldMock = wantsMock || !llm.baseUrl || !llm.model || (llm.requiresAuth && !hasAuth);
  if (shouldMock) {
    await streamMockResponse(userPrompt, onEvent, { signal });
    onEvent?.({ type: 'done', timestamp: nowIso() });
    return;
  }

  const abortController = new AbortController();
  const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => abortController.abort(), effectiveTimeout);

  const onAbort = () => abortController.abort();
  if (signal) {
    if (signal.aborted) abortController.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const system = buildSystemPrompt({
      command: safeString(context.command, 10_000),
      risk: safeString(context.risk, 100),
      explanation: safeString(context.explanation, 10_000),
      consequences: context.consequences && typeof context.consequences === 'object' ? context.consequences : null,
      evidence: Array.isArray(context.evidence) ? context.evidence : null
    });

    const payload = buildRequestPayload(llm, system, messages, maxTokens);
    const headers = buildRequestHeaders(llm);

    const response = await fetch(llm.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: abortController.signal
    });

    if (!response.ok) {
      onEvent?.({ type: 'error', message: `Upstream error (${response.status})` });
      onEvent?.({ type: 'done', timestamp: nowIso() });
      return;
    }

    if (!response.body) {
      onEvent?.({ type: 'error', message: 'Upstream returned no body' });
      onEvent?.({ type: 'done', timestamp: nowIso() });
      return;
    }

    await streamSseResponse(response, llm.protocol, onEvent, abortController);

    if (abortController.signal.aborted) {
      onEvent?.({ type: 'error', message: 'Chat aborted' });
    }

    onEvent?.({ type: 'done', timestamp: nowIso() });
  } catch (error) {
    if (abortController.signal.aborted) {
      onEvent?.({ type: 'error', message: 'Chat aborted' });
      onEvent?.({ type: 'done', timestamp: nowIso() });
      return;
    }

    onEvent?.({ type: 'error', message: 'Chat failed' });
    onEvent?.({ type: 'done', timestamp: nowIso() });
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener?.('abort', onAbort);
  }
}

export default { streamChat };
