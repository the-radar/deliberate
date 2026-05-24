/**
 * Spec-adherence wrapper (PreToolUse on Write|Edit|MultiEdit).
 *
 * Talks to the existing `spec_watcher_daemon.py` over its unix socket at
 * `~/.cache/nospec-drift/spec.sock`. The daemon owns spec parsing and Haiku
 * eval; this module owns the deliberate-side policy:
 *
 *   - If discipline state is off / paused / bypassed -> allow with audit (handled by eval-entry).
 *   - If the project root has no `.git` directory -> stringency off, allow.
 *   - If the daemon is unreachable AND .git is present -> fail-closed with a
 *     clear debug note for Claude.
 *   - If there's no written spec (no `docs/` and no spec-mapping.json) -> ask
 *     Claude to interview the user (the AelosX "user-message-as-spec" case).
 *   - Otherwise forward the payload to the daemon and pass its verdict through.
 *
 * Returns:
 *   { decision: 'allow' | 'block' | 'ask', message: string, daemonReachable: boolean }
 */

import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

const DAEMON_SOCKET = path.join(os.homedir(), '.cache', 'nospec-drift', 'spec.sock');
const DAEMON_TIMEOUT_MS = 5_000;

/**
 * Walk up from `cwd` looking for `.git` to determine whether stringency applies.
 *
 * @param {string} cwd
 * @returns {boolean}
 */
export function isStringentProject(cwd) {
  if (typeof cwd !== 'string' || !cwd) return false;
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/**
 * Heuristic: does the project carry any written spec we can grep against?
 * If not, the AelosX note says we should interview the user instead of
 * blocking.
 *
 * @param {string} cwd
 * @returns {boolean}
 */
export function hasWrittenSpec(cwd) {
  if (typeof cwd !== 'string' || !cwd) return false;
  const candidates = [
    path.join(cwd, 'docs'),
    path.join(cwd, 'specs'),
    path.join(cwd, '.claude', 'spec-mapping.json'),
    path.join(cwd, 'spec-mapping.json')
  ];
  return candidates.some((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
}

/**
 * Best-effort daemon ping. Resolves to true when the socket exists and accepts
 * a connection; false otherwise. Never throws.
 *
 * @returns {Promise<boolean>}
 */
export function pingDaemon() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    try {
      if (!fs.existsSync(DAEMON_SOCKET)) return resolve(false);
      const client = net.createConnection(DAEMON_SOCKET);
      client.setTimeout(DAEMON_TIMEOUT_MS);
      client.on('connect', () => { client.end(); finish(true); });
      client.on('error', () => finish(false));
      client.on('timeout', () => { client.destroy(); finish(false); });
    } catch {
      finish(false);
    }
  });
}

/**
 * Send a JSON request to the daemon, wait for one JSON response.
 *
 * @param {object} payload
 * @returns {Promise<object | null>}
 */
export function callDaemon(payload) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => { if (!finished) { finished = true; resolve(value); } };
    try {
      const client = net.createConnection(DAEMON_SOCKET);
      client.setTimeout(DAEMON_TIMEOUT_MS);
      let buffer = '';
      client.on('connect', () => {
        client.write(JSON.stringify(payload) + '\n');
      });
      client.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        if (buffer.includes('\n')) {
          try {
            const parsed = JSON.parse(buffer.split('\n')[0]);
            client.end();
            finish(parsed);
          } catch {
            client.end();
            finish(null);
          }
        }
      });
      client.on('error', () => finish(null));
      client.on('timeout', () => { client.destroy(); finish(null); });
      client.on('end', () => finish(null));
    } catch {
      finish(null);
    }
  });
}

/**
 * Top-level evaluator. Implements the stringency + interview rules from the
 * AelosX note's locked decisions.
 *
 * @param {{ filePath: string, after: string, cwd: string }} args
 * @returns {Promise<{ decision: string, message: string, daemonReachable: boolean }>}
 */
export async function evaluateSpecAdherence(args) {
  const cwd = (args && args.cwd) || process.cwd();
  if (!isStringentProject(cwd)) {
    return {
      decision: 'allow',
      message: 'no .git in project root; stringency off',
      daemonReachable: false
    };
  }

  if (!hasWrittenSpec(cwd)) {
    return {
      decision: 'ask',
      message: [
        'SPEC INTERVIEW REQUIRED',
        'No written spec found in this project (no docs/, specs/, or spec-mapping.json).',
        'The user message is the spec. Before writing code:',
        '  1. Restate what you understood from the user in your own words.',
        '  2. Ask the user to confirm or correct the interpretation.',
        '  3. Only then write the code.',
        '',
        'Deliberate is the discipline of slowing down — interview first, write second.'
      ].join('\n'),
      daemonReachable: false
    };
  }

  const reachable = await pingDaemon();
  if (!reachable) {
    return {
      decision: 'block',
      message: [
        'SPEC ADHERENCE FAIL-CLOSED',
        'spec_watcher_daemon is not reachable at ~/.cache/nospec-drift/spec.sock',
        'and this project has .git so stringency is on.',
        '',
        'Either:',
        '  - start the daemon: `python3 ~/.claude/hooks/spec_watcher_daemon.py &`',
        '  - or temporarily relax discipline: `deliberate hooks pause 30m`',
        '',
        'Discipline is on the leash to protect you from drift, not to cage you.'
      ].join('\n'),
      daemonReachable: false
    };
  }

  const verdict = await callDaemon({
    op: 'check',
    file_path: args.filePath,
    after: args.after,
    cwd
  });
  if (!verdict || typeof verdict !== 'object') {
    return {
      decision: 'block',
      message: 'spec daemon responded with no/invalid JSON; failing closed',
      daemonReachable: true
    };
  }

  const decision = verdict.decision === 'block' || verdict.decision === 'ask' ? verdict.decision : 'allow';
  return {
    decision,
    message: typeof verdict.message === 'string' ? verdict.message : '',
    daemonReachable: true
  };
}

export default {
  evaluateSpecAdherence,
  isStringentProject,
  hasWrittenSpec,
  pingDaemon,
  callDaemon
};
