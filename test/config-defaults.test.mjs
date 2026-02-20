import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function withTempConfig(run) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-config-defaults-'));
  const configFile = path.join(tmpDir, 'config.json');
  process.env.DELIBERATE_CONFIG_FILE = configFile;
  try {
    await run(configFile);
  } finally {
    delete process.env.DELIBERATE_CONFIG_FILE;
  }
}

async function loadConfigModuleFresh() {
  return import(`../src/config.js?test=${Date.now()}-${Math.random()}`);
}

test('default config exposes web search + auto approve settings', async () => {
  await withTempConfig(async () => {
    const cfg = await loadConfigModuleFresh();
    const loaded = cfg.loadConfig();

    assert.equal(loaded.deliberate.enabled, true);
    assert.equal(loaded.deliberate.webSearch.enabled, true);
    assert.deepEqual(loaded.deliberate.webSearch.sources, ['npm', 'pypi', 'github', 'gitlab']);
    assert.deepEqual(loaded.deliberate.autoApprove.patterns, []);
  });
});

test('addAutoApprovePattern stores unique trimmed patterns', async () => {
  await withTempConfig(async (configFile) => {
    const cfg = await loadConfigModuleFresh();

    cfg.addAutoApprovePattern(' browser-use ');
    cfg.addAutoApprovePattern('browser-use');
    cfg.addAutoApprovePattern('pnpm dlx playwright');

    const disk = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    assert.deepEqual(disk.deliberate.autoApprove.patterns, ['browser-use', 'pnpm dlx playwright']);
  });
});
