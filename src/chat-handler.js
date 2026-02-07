/**
 * Chat handler for Deliberate UIs.
 *
 * The server exposes an SSE endpoint used by the GUI (and potentially other
 * local consumers). The actual streaming/auth logic lives in chat-client so
 * the TUI and server behave the same.
 */

import { streamChat } from './chat-client.js';

function writeSse(res, payload, event = 'message') {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
}

function isMessageArray(value) {
  return Array.isArray(value) && value.every((m) => m && typeof m === 'object');
}

/**
 * Express handler. Streams an SSE response.
 *
 * Body format (minimum):
 * {
 *   "messages": [{ "role": "user", "content": "..." }, ...],
 *   "context": { "command": "...", "risk": "...", "explanation": "...", "consequences": {...} }
 * }
 */
export async function handleChatSse(req, res) {
  const body = req.body || {};
  const messages = body.messages;
  const context = body.context && typeof body.context === 'object' ? body.context : {};

  if (!isMessageArray(messages) || messages.length < 1) {
    res.status(400).json({ error: 'Missing required field: messages (array)' });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  try {
    await streamChat({
      messages,
      context,
      maxTokens: body.maxTokens,
      signal: abortController.signal,
      onEvent: (event) => {
        if (!event || typeof event !== 'object') return;
        if (event.type === 'token') writeSse(res, event, 'token');
        else if (event.type === 'error') writeSse(res, event, 'error');
        else if (event.type === 'start') writeSse(res, event, 'start');
        else if (event.type === 'done') writeSse(res, event, 'done');
        else writeSse(res, event, 'message');
      }
    });
  } catch (error) {
    writeSse(res, { type: 'error', message: 'Chat failed' }, 'error');
    writeSse(res, { type: 'done', timestamp: new Date().toISOString() }, 'done');
  } finally {
    res.end();
  }
}

export default { handleChatSse };
