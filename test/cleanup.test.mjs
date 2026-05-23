import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cleanupPanes, isPidAlive } from '../src/cleanup.js';

function mkTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function writeLock(dir, sessionId, payload) {
  const file = path.join(dir, `pane-started-${sessionId}.json`);
  fs.writeFileSync(file, JSON.stringify(payload));
  return file;
}

test('cleanupPanes removes locks whose pid is dead', () => {
  const dir = mkTempDir('deliberate-cleanup-dead');
  // PID 999999 is virtually certain to be dead. Belt-and-braces: check first.
  const deadPid = 999999;
  assert.equal(isPidAlive(deadPid), false, 'sanity: chosen pid must be dead');

  const liveFile = writeLock(dir, 'alive', { sessionId: 'alive', pid: process.pid });
  const deadFile = writeLock(dir, 'dead', { sessionId: 'dead', pid: deadPid });

  const summary = cleanupPanes({ panesDir: dir });
  assert.equal(summary.scanned, 2);
  assert.equal(summary.removed.length, 1);
  assert.equal(summary.removed[0].reason, 'dead-pid');
  assert.ok(fs.existsSync(liveFile), 'live-pid lock should be kept');
  assert.ok(!fs.existsSync(deadFile), 'dead-pid lock should be removed');
});

test('cleanupPanes removes legacy locks (no pid) older than maxAgeDays', () => {
  const dir = mkTempDir('deliberate-cleanup-legacy');
  const file = writeLock(dir, 'legacy', { sessionId: 'legacy', timestamp: '2026-02-01T00:00:00Z' });
  // Backdate the file by 30 days.
  const past = Date.now() / 1000 - 30 * 86400;
  fs.utimesSync(file, past, past);

  const summary = cleanupPanes({ panesDir: dir, maxAgeDays: 7 });
  assert.equal(summary.removed.length, 1);
  assert.equal(summary.removed[0].reason, 'legacy-stale');
  assert.ok(!fs.existsSync(file));
});

test('cleanupPanes dry-run reports but does not delete', () => {
  const dir = mkTempDir('deliberate-cleanup-dry');
  const deadPid = 999999;
  const file = writeLock(dir, 'dead', { sessionId: 'dead', pid: deadPid });

  const summary = cleanupPanes({ panesDir: dir, dryRun: true });
  assert.equal(summary.removed.length, 1);
  assert.ok(fs.existsSync(file), 'dry-run must not delete the lock');
});

test('cleanupPanes returns empty summary for missing panes dir', () => {
  const dir = path.join(os.tmpdir(), `deliberate-cleanup-missing-${process.pid}-${Date.now()}`);
  const summary = cleanupPanes({ panesDir: dir });
  assert.equal(summary.scanned, 0);
  assert.equal(summary.removed.length, 0);
  assert.equal(summary.kept.length, 0);
});
