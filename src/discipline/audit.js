/**
 * Append-only audit log for discipline state changes.
 *
 * The AelosX note's contract: "No silent disabling." Every pause/off/bypass
 * action lands here as a JSONL line so the agent (and the user) can see when
 * the safety net was lowered.
 *
 * File: `~/.deliberate/discipline-audit.jsonl`
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_DIR = path.join(os.homedir(), '.deliberate');
const FILE_NAME = 'discipline-audit.jsonl';

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
}

function auditPath(dir) {
  return path.join(dir || DEFAULT_DIR, FILE_NAME);
}

/**
 * Append one audit record. Best-effort — never throws so a logging failure
 * cannot break a state mutation.
 *
 * @param {object} entry
 * @param {{ dir?: string }} [opts]
 */
export function recordAudit(entry, opts = {}) {
  try {
    const dir = opts.dir || DEFAULT_DIR;
    ensureDir(dir);
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      ...entry
    }) + '\n';
    fs.appendFileSync(auditPath(dir), line);
  } catch {
    /* best-effort */
  }
}

/**
 * Read recent audit entries, newest last (file order). Bounded by maxEntries.
 *
 * @param {{ dir?: string, maxEntries?: number }} [opts]
 * @returns {object[]}
 */
export function readAudit(opts = {}) {
  const max = Number.isFinite(opts.maxEntries) ? opts.maxEntries : 200;
  try {
    const body = fs.readFileSync(auditPath(opts.dir), 'utf8');
    const lines = body.trim().split('\n').slice(-max);
    const out = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    return out;
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    return [];
  }
}

export default { recordAudit, readAudit };
