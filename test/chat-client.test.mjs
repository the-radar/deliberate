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

