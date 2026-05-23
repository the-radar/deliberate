import test from 'node:test';
import assert from 'node:assert/strict';

import { startIdleExitWatchdog } from '../src/server.js';

function waitFor(predicate, { timeoutMs = 2000, intervalMs = 25 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout waiting for predicate'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

test('startIdleExitWatchdog calls onExit after sustained idle past idleExitMs', async () => {
  let exitCalled = null;
  const stop = startIdleExitWatchdog({
    getClientCount: () => 0,
    idleExitMs: 50,
    intervalMs: 10,
    startupGraceMs: 0,
    onExit: (info) => { exitCalled = info; }
  });

  await waitFor(() => exitCalled !== null, { timeoutMs: 500 });
  assert.ok(exitCalled, 'onExit must be called when idle');
  assert.match(exitCalled.reason, /clients=0/);
  stop();
});

test('startIdleExitWatchdog never exits while clients > 0', async () => {
  let exitCalled = false;
  const stop = startIdleExitWatchdog({
    getClientCount: () => 1,
    idleExitMs: 30,
    intervalMs: 5,
    startupGraceMs: 0,
    onExit: () => { exitCalled = true; }
  });

  await new Promise((r) => setTimeout(r, 200));
  assert.equal(exitCalled, false, 'must not exit while a client is connected');
  stop();
});

test('startIdleExitWatchdog resets idle timer when clients reappear', async () => {
  let exitCalled = false;
  let clientCount = 0;
  const stop = startIdleExitWatchdog({
    getClientCount: () => clientCount,
    idleExitMs: 80,
    intervalMs: 5,
    startupGraceMs: 0,
    onExit: () => { exitCalled = true; }
  });

  // After ~50ms (under idleExitMs), a client reconnects.
  setTimeout(() => { clientCount = 1; }, 50);
  await new Promise((r) => setTimeout(r, 200));

  assert.equal(exitCalled, false, 'reconnecting before idleExitMs must reset the watchdog');
  stop();
});

test('startIdleExitWatchdog is a noop when idleExitMs <= 0 (escape hatch)', async () => {
  let exitCalled = false;
  const stop = startIdleExitWatchdog({
    getClientCount: () => 0,
    idleExitMs: 0,
    intervalMs: 5,
    startupGraceMs: 0,
    onExit: () => { exitCalled = true; }
  });

  await new Promise((r) => setTimeout(r, 150));
  assert.equal(exitCalled, false, 'idleExitMs=0 disables the watchdog');
  stop();
});

test('startIdleExitWatchdog respects startup grace window', async () => {
  let exitCalled = false;
  const stop = startIdleExitWatchdog({
    getClientCount: () => 0,
    idleExitMs: 10,
    intervalMs: 5,
    startupGraceMs: 150,
    onExit: () => { exitCalled = true; }
  });

  await new Promise((r) => setTimeout(r, 80));
  assert.equal(exitCalled, false, 'must not exit during the startup grace window');
  stop();
});
