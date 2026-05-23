import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { streamChat } from '../src/chat-client.js';

test('streamChat emits token and done events in mock mode', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-chat-client-'));
  const configFile = path.join(tmpDir, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({}, null, 2));

  process.env.DELIBERATE_CONFIG_FILE = configFile;
  process.env.DELIBERATE_CHAT_MODE = 'mock';

  try {
    const events = [];
    await streamChat({
      context: { command: 'rm -rf /', risk: 'DANGEROUS' },
      messages: [{ role: 'user', content: 'is this safe?' }],
      onEvent: (ev) => events.push(ev)
    });

    assert.ok(events.some((e) => e.type === 'token'));
    assert.ok(events.some((e) => e.type === 'done'));
  } finally {
    delete process.env.DELIBERATE_CONFIG_FILE;
    delete process.env.DELIBERATE_CHAT_MODE;
  }
});

test('streamChat reads auth token from env-file for a private OpenAI-compatible gateway', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-chat-client-gateway-'));
  const configFile = path.join(tmpDir, 'config.json');
  const authFile = path.join(tmpDir, 'auth.env');
  fs.writeFileSync(authFile, 'GATEWAY_AUTH_TOKEN=secret-test-token\n');
  fs.writeFileSync(configFile, JSON.stringify({
    llm: {
      provider: 'openai-compatible',
      baseUrl: 'http://local.test/v1/chat/completions',
      model: 'fast',
      authTokenFile: authFile,
      authTokenEnv: 'GATEWAY_AUTH_TOKEN',
      authHeader: 'x-api-key',
      requiresAuth: true,
      protocol: 'openai-chat-completions'
    }
  }, null, 2));

  process.env.DELIBERATE_CONFIG_FILE = configFile;
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    });
  };

  try {
    const events = [];
    await streamChat({
      messages: [{ role: 'user', content: 'say hi' }],
      onEvent: (ev) => events.push(ev)
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://local.test/v1/chat/completions');
    assert.equal(requests[0].options.headers['x-api-key'], 'secret-test-token');
    assert.equal(requests[0].options.headers.authorization, undefined);

    const payload = JSON.parse(requests[0].options.body);
    assert.equal(payload.model, 'fast');
    assert.equal(payload.messages[0].role, 'system');
    assert.equal(payload.messages[1].content, 'say hi');
    assert.ok(events.some((e) => e.type === 'token' && e.text === 'hello'));
    assert.ok(events.some((e) => e.type === 'done'));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DELIBERATE_CONFIG_FILE;
  }
});

