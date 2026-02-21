import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function getPort(server) {
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Unexpected server address');
  }
  return addr.port;
}

async function readSseEvents(response) {
  const text = await response.text();
  const events = [];

  let current = { event: 'message', data: '' };
  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) {
      if (current.data) events.push(current);
      current = { event: 'message', data: '' };
      continue;
    }
    if (trimmed.startsWith('event:')) {
      current.event = trimmed.slice('event:'.length).trim();
      continue;
    }
    if (trimmed.startsWith('data:')) {
      current.data += trimmed.slice('data:'.length).trim();
      continue;
    }
  }
  if (current.data) events.push(current);
  return events;
}

test('config endpoints read + mutate config file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-config-'));
  const configFile = path.join(tmpDir, 'config.json');

  process.env.DELIBERATE_CONFIG_FILE = configFile;

  const { startServer } = await import('../src/server.js');
  const server = await startServer(0);
  const port = getPort(server);

  try {
    const base = `http://localhost:${port}`;
    const statusRes = await fetch(`${base}/status`);
    assert.equal(statusRes.status, 200);
    const status = await statusRes.json();
    assert.equal(status.mode, 'ux-explainability');

    const cfgRes = await fetch(`${base}/api/config`);
    assert.equal(cfgRes.status, 200);
    const cfg = await cfgRes.json();
    assert.equal(cfg.gui.alwaysOnTop, true);
    assert.equal(cfg.llm.hasApiKey, false);

    const skipRes = await fetch(`${base}/api/config/skip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'git status --porcelain' })
    });
    assert.equal(skipRes.status, 200);

    const blockRes = await fetch(`${base}/api/config/block`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'rm -rf /' })
    });
    assert.equal(blockRes.status, 200);

    const autoApproveRes = await fetch(`${base}/api/config/auto-approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'browser-use' })
    });
    assert.equal(autoApproveRes.status, 200);

    const patchRes = await fetch(`${base}/api/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gui: { alwaysOnTop: false } })
    });
    assert.equal(patchRes.status, 200);
    const patched = await patchRes.json();
    assert.equal(patched.gui.alwaysOnTop, false);

    const disk = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    assert.ok(disk.skipCommands.additional.includes('git status --porcelain'));
    assert.ok(disk.customBlocklist.includes('rm -rf /'));
    assert.ok(disk.deliberate.autoApprove.patterns.includes('browser-use'));
    assert.equal(disk.gui.alwaysOnTop, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.DELIBERATE_CONFIG_FILE;
  }
});

test('chat endpoint streams SSE (mock mode)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-chat-'));
  const configFile = path.join(tmpDir, 'config.json');

  process.env.DELIBERATE_CONFIG_FILE = configFile;
  process.env.DELIBERATE_CHAT_MODE = 'mock';

  const { startServer } = await import('../src/server.js');
  const server = await startServer(0);
  const port = getPort(server);

  try {
    const base = `http://localhost:${port}`;
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: { command: 'rm -rf /', risk: 'DANGEROUS' },
        messages: [{ role: 'user', content: 'why is this risky?' }]
      })
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type')?.startsWith('text/event-stream'), true);

    const events = await readSseEvents(res);
    assert.ok(events.some((e) => e.event === 'token'));
    assert.ok(events.some((e) => e.event === 'done'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.DELIBERATE_CONFIG_FILE;
    delete process.env.DELIBERATE_CHAT_MODE;
  }
});
