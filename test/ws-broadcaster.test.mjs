import test from 'node:test';
import assert from 'node:assert/strict';
import { createBroadcaster } from '../src/ws-broadcaster.js';

test('stores events by session for backfill', () => {
  const broadcaster = createBroadcaster({ maxEventsPerSession: 2 });

  broadcaster.broadcast({
    type: 'command_analyzed',
    timestamp: new Date().toISOString(),
    sessionId: 'session-a',
    data: { command: 'ls -la', risk: 'SAFE' }
  });

  broadcaster.broadcast({
    type: 'command_analyzed',
    timestamp: new Date().toISOString(),
    sessionId: 'session-a',
    data: { command: 'git status', risk: 'SAFE' }
  });

  broadcaster.broadcast({
    type: 'command_analyzed',
    timestamp: new Date().toISOString(),
    sessionId: 'session-a',
    data: { command: 'pwd', risk: 'SAFE' }
  });

  const events = broadcaster.getSessionEvents('session-a');
  assert.equal(events.length, 2);
  assert.equal(events[0].data.command, 'git status');
  assert.equal(events[1].data.command, 'pwd');

  broadcaster.close();
});

test('rejects malformed events', () => {
  const broadcaster = createBroadcaster();
  assert.throws(() => broadcaster.broadcast({
    timestamp: new Date().toISOString(),
    sessionId: 'session-b',
    data: {}
  }), /type/);
  broadcaster.close();
});
