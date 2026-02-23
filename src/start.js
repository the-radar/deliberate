/**
 * Startup orchestration for Deliberate.
 *
 * Why this module exists:
 * - Give users one command (`deliberate start`) that handles common startup.
 * - Keep server boot logic separate from CLI argument wiring.
 * - Keep onboarding walkthrough text centralized and testable.
 *
 * Security and reliability notes:
 * - Health checks are localhost-only with short timeouts.
 * - Server process is detached and never receives secrets via logs.
 * - Failures are surfaced to CLI callers without crashing hook flows.
 */

import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import { loadConfig, patchConfig } from './config.js';

export const DEFAULT_SERVER_PORT = 8765;

/**
 * Resolve server port from config with strict bounds checking.
 * @param {object} config
 * @returns {number}
 */
export function resolveServerPort(config = loadConfig()) {
  const raw = Number(config?.server?.port);
  if (Number.isInteger(raw) && raw >= 1 && raw <= 65535) {
    return raw;
  }
  return DEFAULT_SERVER_PORT;
}

/**
 * Localhost health probe.
 * @param {{port:number, timeoutMs?:number}} options
 * @returns {Promise<boolean>}
 */
export function isServerHealthy({ port, timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/health',
      method: 'GET',
      timeout: timeoutMs
    }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll health endpoint until timeout.
 * @param {{port:number, timeoutMs?:number, intervalMs?:number}} options
 * @returns {Promise<boolean>}
 */
export async function waitForServerHealthy({ port, timeoutMs = 5000, intervalMs = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await isServerHealthy({ port, timeoutMs: Math.min(800, intervalMs) });
    if (ok) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }
  return false;
}

function serverScriptPath() {
  return fileURLToPath(new URL('./server.js', import.meta.url));
}

/**
 * Spawn the local server as a detached background process.
 * @param {{port:number, cwd?:string}} options
 * @returns {number|null} child pid when available
 */
export function spawnDetachedServer({ port, cwd } = {}) {
  const child = spawn(
    process.execPath,
    [serverScriptPath()],
    {
      cwd: cwd || process.cwd(),
      env: { ...process.env, PORT: String(port) },
      detached: true,
      stdio: 'ignore'
    }
  );
  child.unref();
  return typeof child.pid === 'number' ? child.pid : null;
}

/**
 * Ensure the Deliberate server is reachable.
 * If already healthy, no process is started.
 * @param {{port?:number, config?:object, cwd?:string, timeoutMs?:number}} options
 * @returns {Promise<{port:number, started:boolean, healthy:boolean, pid:number|null}>}
 */
export async function ensureServerRunning(options = {}) {
  const config = options.config || loadConfig();
  const port = Number.isInteger(options.port) ? options.port : resolveServerPort(config);

  const alreadyHealthy = await isServerHealthy({ port });
  if (alreadyHealthy) {
    return { port, started: false, healthy: true, pid: null };
  }

  const pid = spawnDetachedServer({ port, cwd: options.cwd });
  const healthy = await waitForServerHealthy({ port, timeoutMs: options.timeoutMs ?? 5000 });
  return { port, started: true, healthy, pid };
}

/**
 * True when first-run onboarding should be displayed.
 * @param {object} config
 * @returns {boolean}
 */
export function shouldShowOnboarding(config = loadConfig()) {
  return config?.onboarding?.completed !== true;
}

/**
 * Persist onboarding completion marker.
 * @returns {object} updated config
 */
export function markOnboardingComplete() {
  return patchConfig({
    onboarding: {
      completed: true,
      lastShownAt: new Date().toISOString()
    }
  });
}

/**
 * Human-facing, short walkthrough for first-time users.
 * Keep this text concise because it shows directly in terminal.
 * @returns {string}
 */
export function renderOnboardingWalkthrough() {
  return [
    '',
    'Quick walkthrough',
    '-----------------',
    'Deliberate is review-first. It keeps approvals clear and logged.',
    '',
    'Fast start:',
    '  - Run `deliberate start` to start server + open pane.',
    '  - Keep coding in Claude Code, review in the Deliberate pane.',
    '',
    'Core keys in the pane:',
    '  - v: toggle review queue/history',
    '  - d: discuss selected item',
    '  - w: guided always-allow policy flow',
    '  - s: do not flag exact command',
    '  - b: block command pattern',
    '  - x: disable/enable Deliberate globally',
    '',
    'Tip: run `deliberate onboarding` any time to replay this guide.',
    ''
  ].join('\n');
}

/**
 * Friendly status summary used by CLI command output.
 * @param {{started:boolean, port:number, healthy:boolean}} status
 * @returns {string}
 */
export function formatStartStatus(status) {
  if (!status?.healthy) {
    return `Server: ❌ Failed to become healthy on http://localhost:${status?.port ?? DEFAULT_SERVER_PORT}`;
  }
  if (status.started) {
    return `Server: ✅ Started on http://localhost:${status.port}`;
  }
  return `Server: ✅ Already running on http://localhost:${status.port}`;
}

export default {
  resolveServerPort,
  isServerHealthy,
  waitForServerHealthy,
  spawnDetachedServer,
  ensureServerRunning,
  shouldShowOnboarding,
  markOnboardingComplete,
  renderOnboardingWalkthrough,
  formatStartStatus
};
