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

import { loadConfig } from './config.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_TIMEOUT_MS = 60_000;

const execFileAsync = promisify(execFile);

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
    parts.push(`Classifier risk: ${context.risk}`);
  }
  if (context.explanation) {
    parts.push('');
    parts.push('Classifier explanation:');
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

function getAnthropicConfig() {
  const config = loadConfig();
  const llm = config.llm || {};
  const provider = llm.provider || null;

  // "anthropic" provider uses an API key.
  // "claude-subscription" uses OAuth from the macOS keychain (or an override key).
  const apiKey = llm.apiKey || process.env.ANTHROPIC_API_KEY || null;

  return {
    provider,
    apiKey,
    baseUrl: llm.baseUrl || 'https://api.anthropic.com/v1/messages',
    model: llm.model || 'claude-3-5-haiku-20241022'
  };
}

async function getClaudeCodeOAuthTokenFromKeychain() {
  // Matches the Python hook behavior. We never print this value.
  if (process.platform !== 'darwin') return null;

  try {
    const { stdout } = await execFileAsync('/usr/bin/security', [
      'find-generic-password',
      '-s',
      'Claude Code-credentials',
      '-w'
    ], { timeout: 5000, maxBuffer: 1024 * 1024 });

    const raw = String(stdout || '').trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const token = parsed?.claudeAiOauth?.accessToken;
    if (typeof token !== 'string') return null;

    // Claude Code tokens we have seen are sk-ant-oat01-*.
    if (!token.startsWith('sk-ant-oat01-')) return null;
    return token;
  } catch {
    return null;
  }
}

async function streamMockResponse(prompt, onEvent, { signal } = {}) {
  const text = `Mock chat response.\n\nYou asked:\n${prompt}\n\nIf you want real chat, set an Anthropic API key in ~/.deliberate/config.json (llm.apiKey) or ANTHROPIC_API_KEY.`;
  const chunks = text.split(/(\s+)/).filter(Boolean);

  for (const chunk of chunks) {
    if (signal?.aborted) return;
    onEvent?.({ type: 'token', text: chunk });
    // Small delay gives UIs something to animate without making tests slow.
    await new Promise((r) => setTimeout(r, 5));
  }
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
export async function streamChat({ messages, context = {}, maxTokens, onEvent, signal } = {}) {
  if (!isMessageArray(messages) || messages.length < 1) {
    throw new Error('Missing required field: messages (array)');
  }

  onEvent?.({ type: 'start', timestamp: nowIso() });

  const latestUser = messages.slice().reverse().find((m) => m.role === 'user');
  const userPrompt = safeString(latestUser?.content, 20_000) || '';

  const mode = String(process.env.DELIBERATE_CHAT_MODE || '').toLowerCase();
  const anth = getAnthropicConfig();

  const wantsMock = mode === 'mock';
  const oauthToken = (!wantsMock && anth.provider === 'claude-subscription' && !anth.apiKey)
    ? await getClaudeCodeOAuthTokenFromKeychain()
    : null;

  // If we have neither an API key nor an OAuth token, we must mock.
  const shouldMock = wantsMock || (!anth.apiKey && !oauthToken);
  if (shouldMock) {
    await streamMockResponse(userPrompt, onEvent, { signal });
    onEvent?.({ type: 'done', timestamp: nowIso() });
    return;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), DEFAULT_TIMEOUT_MS);

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

    const payload = {
      model: anth.model,
      max_tokens: Number(maxTokens) > 0 ? Math.min(Number(maxTokens), 4000) : DEFAULT_MAX_TOKENS,
      stream: true,
      system,
      messages: messages
        .slice(0, 50)
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: safeString(m.content, 20_000) || ''
        }))
    };

    // Auth handling:
    // - Anthropic API keys use x-api-key
    // - Claude subscription tokens are OAuth and use Authorization: Bearer
    const headers = {
      'content-type': 'application/json',
      'anthropic-version': DEFAULT_ANTHROPIC_VERSION
    };

    if (oauthToken) {
      headers.authorization = `Bearer ${oauthToken}`;
      headers['anthropic-beta'] = 'oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14';
    } else {
      headers['x-api-key'] = anth.apiKey;
    }

    const response = await fetch(anth.baseUrl, {
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

    // Anthropic streaming uses server-sent events. Parse line-by-line.
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

        if (!line) continue;
        if (!line.startsWith('data:')) continue;

        const raw = line.slice('data:'.length).trim();
        if (!raw || raw === '[DONE]') continue;

        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }

        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          const text = parsed.delta?.text;
          if (typeof text === 'string' && text.length) {
            onEvent?.({ type: 'token', text });
          }
        }
      }

      if (abortController.signal.aborted) break;
    }

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
