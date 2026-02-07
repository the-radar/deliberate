import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendEventLog,
  getEventLogPath,
  readRecentEvents,
  tailEventLog
} from '../src/event-log.js';

function waitFor(fn, { timeoutMs = 2000, intervalMs = 25 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

test('event log append + readRecentEvents', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-events-'));
  process.env.DELIBERATE_EVENT_LOG_DIR = tmp;

  try {
    const event = {
      type: 'command_analyzed',
      timestamp: new Date().toISOString(),
      sessionId: 'session-a',
      data: { command: 'echo hi', risk: 'SAFE', explanation: 'prints hi' }
    };

    appendEventLog(event);

    const filePath = getEventLogPath();
    assert.equal(fs.existsSync(filePath), true);

    const events = readRecentEvents({ days: 1, maxEventsPerFile: 50 });
    assert.ok(events.some((e) => e.sessionId === 'session-a'));
  } finally {
    delete process.env.DELIBERATE_EVENT_LOG_DIR;
  }
});

test('tailEventLog emits appended events', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-events-tail-'));
  process.env.DELIBERATE_EVENT_LOG_DIR = tmp;

  const seen = [];
  const stop = tailEventLog({
    intervalMs: 20,
    onEvent: (ev) => seen.push(ev)
  });

  try {
    const event = {
      type: 'command_post_analysis',
      timestamp: new Date().toISOString(),
      sessionId: 'session-b',
      data: { command: 'ls', risk: 'SAFE', explanation: 'lists files' }
    };

    appendEventLog(event);

    await waitFor(() => seen.some((e) => e.sessionId === 'session-b'), { timeoutMs: 2000 });
    assert.ok(seen.some((e) => e.type === 'command_post_analysis'));
  } finally {
    stop();
    delete process.env.DELIBERATE_EVENT_LOG_DIR;
  }
});

