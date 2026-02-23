import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function withTempConfig(run) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-start-flow-'));
  const configFile = path.join(tmpDir, 'config.json');
  process.env.DELIBERATE_CONFIG_FILE = configFile;
  try {
    await run(configFile);
  } finally {
    delete process.env.DELIBERATE_CONFIG_FILE;
  }
}

async function loadFreshStartModule() {
  return import(`../src/start.js?test=${Date.now()}-${Math.random()}`);
}

async function loadFreshConfigModule() {
  return import(`../src/config.js?test=${Date.now()}-${Math.random()}`);
}

test('resolveServerPort validates configured range', async () => {
  const start = await loadFreshStartModule();

  assert.equal(start.resolveServerPort({ server: { port: 9123 } }), 9123);
  assert.equal(start.resolveServerPort({ server: { port: 0 } }), start.DEFAULT_SERVER_PORT);
  assert.equal(start.resolveServerPort({ server: { port: 70000 } }), start.DEFAULT_SERVER_PORT);
  assert.equal(start.resolveServerPort({ server: { port: 'oops' } }), start.DEFAULT_SERVER_PORT);
});

test('renderOnboardingWalkthrough includes key first-run actions', async () => {
  const start = await loadFreshStartModule();
  const text = start.renderOnboardingWalkthrough();

  assert.match(text, /deliberate start/);
  assert.match(text, /\bv: toggle review queue\/history\b/);
  assert.match(text, /\bd: discuss selected item\b/);
  assert.match(text, /\bw: guided always-allow policy flow\b/);
});

test('markOnboardingComplete persists onboarding state', async () => {
  await withTempConfig(async (configFile) => {
    const cfg = await loadFreshConfigModule();
    const start = await loadFreshStartModule();

    const initial = cfg.loadConfig();
    assert.equal(start.shouldShowOnboarding(initial), true);

    start.markOnboardingComplete();

    const disk = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    assert.equal(disk.onboarding.completed, true);
    assert.equal(typeof disk.onboarding.lastShownAt, 'string');

    const reloaded = cfg.loadConfig();
    assert.equal(start.shouldShowOnboarding(reloaded), false);
  });
});
