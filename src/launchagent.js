/**
 * LaunchAgent management for the spec_watcher_daemon (macOS only).
 *
 * The AelosX-note unification needs the daemon at `~/.claude/hooks/
 * spec_watcher_daemon.py` to be alive whenever Claude Code runs. A LaunchAgent
 * at `~/Library/LaunchAgents/com.bobola.nospec-drift.plist` keeps it running
 * across reboots and restarts it on crash.
 *
 * This module owns the install / uninstall / status helpers. The CLI
 * subcommand `deliberate launchagent ...` exposes them.
 *
 * Behaviour is fail-open: on non-macOS or when paths are missing, install is
 * a no-op with a clear message; no exceptions thrown.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const LABEL = 'com.bobola.nospec-drift';
const PLIST_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = path.join(PLIST_DIR, `${LABEL}.plist`);
const LOG_DIR = path.join(os.homedir(), '.cache', 'nospec-drift');

function defaultDaemonPath() {
  return path.join(os.homedir(), '.claude', 'hooks', 'spec_watcher_daemon.py');
}

function defaultPython() {
  // Use the system python3 the existing daemon uses, not anything venv'd.
  return '/usr/bin/python3';
}

function buildPlist({ daemonPath, python }) {
  // Plist XML kept simple and stable so users can sanity-read it.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${python}</string>
    <string>${daemonPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(LOG_DIR, 'daemon.out.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(LOG_DIR, 'daemon.err.log')}</string>
</dict>
</plist>
`;
}

/**
 * @returns {{ supported: boolean, reason?: string }}
 */
export function checkSupport() {
  if (process.platform !== 'darwin') {
    return { supported: false, reason: `LaunchAgent is macOS-only (platform=${process.platform})` };
  }
  return { supported: true };
}

/**
 * Install / refresh the plist and load it via launchctl.
 *
 * @param {{ daemonPath?: string, python?: string }} [opts]
 * @returns {{ ok: boolean, plistPath: string, message: string }}
 */
export function installLaunchAgent(opts = {}) {
  const support = checkSupport();
  if (!support.supported) {
    return { ok: false, plistPath: PLIST_PATH, message: support.reason || 'unsupported' };
  }

  const daemonPath = opts.daemonPath || defaultDaemonPath();
  const python = opts.python || defaultPython();

  if (!fs.existsSync(daemonPath)) {
    return {
      ok: false,
      plistPath: PLIST_PATH,
      message: `spec_watcher_daemon.py not found at ${daemonPath} — install it first or pass --daemon`
    };
  }
  if (!fs.existsSync(python)) {
    return {
      ok: false,
      plistPath: PLIST_PATH,
      message: `python interpreter not found at ${python}`
    };
  }

  try {
    fs.mkdirSync(PLIST_DIR, { recursive: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(PLIST_PATH, buildPlist({ daemonPath, python }));
  } catch (err) {
    return { ok: false, plistPath: PLIST_PATH, message: `write failed: ${err && err.message}` };
  }

  // Reload the agent. `bootout` is a no-op if not loaded, so we ignore errors;
  // `bootstrap` is what actually starts it.
  const gui = `gui/${process.getuid()}`;
  try {
    try {
      execFileSync('launchctl', ['bootout', gui, PLIST_PATH], { stdio: 'ignore' });
    } catch { /* not loaded — fine */ }
    execFileSync('launchctl', ['bootstrap', gui, PLIST_PATH], { stdio: 'ignore' });
  } catch (err) {
    return {
      ok: false,
      plistPath: PLIST_PATH,
      message: `launchctl bootstrap failed: ${err && err.message}. Plist written; load it manually.`
    };
  }

  return {
    ok: true,
    plistPath: PLIST_PATH,
    message: `LaunchAgent installed and loaded (${LABEL})`
  };
}

/**
 * Unload and remove the plist.
 */
export function uninstallLaunchAgent() {
  const support = checkSupport();
  if (!support.supported) {
    return { ok: false, plistPath: PLIST_PATH, message: support.reason || 'unsupported' };
  }
  const gui = `gui/${process.getuid()}`;
  try {
    execFileSync('launchctl', ['bootout', gui, PLIST_PATH], { stdio: 'ignore' });
  } catch { /* not loaded — fine */ }
  try {
    if (fs.existsSync(PLIST_PATH)) fs.unlinkSync(PLIST_PATH);
  } catch (err) {
    return { ok: false, plistPath: PLIST_PATH, message: `remove failed: ${err && err.message}` };
  }
  return { ok: true, plistPath: PLIST_PATH, message: `LaunchAgent ${LABEL} removed` };
}

/**
 * Report install state.
 */
export function launchAgentStatus() {
  const support = checkSupport();
  const plistExists = fs.existsSync(PLIST_PATH);
  let loaded = null;
  if (support.supported) {
    try {
      const out = execFileSync('launchctl', ['list'], { encoding: 'utf8' });
      loaded = out.split('\n').some((line) => line.includes(LABEL));
    } catch {
      loaded = null;
    }
  }
  return {
    supported: support.supported,
    plistPath: PLIST_PATH,
    plistExists,
    loaded,
    label: LABEL
  };
}

export default { installLaunchAgent, uninstallLaunchAgent, launchAgentStatus, checkSupport };
