/**
 * Discipline state machine for deliberate's hook orchestration layer.
 *
 * State lives in `~/.deliberate/discipline-state.json` so it survives across
 * processes (CLI writes, Python wrapper hooks read). All mutations append to
 * `discipline-audit.jsonl` (see audit.js) — no silent disabling.
 *
 * Shape:
 *   {
 *     "state":      "strict" | "loose" | "off",
 *     "pauseUntil": null | ISO-8601 timestamp,
 *     "bypass":     string[]   // hook ids to skip when state !== "off"
 *   }
 *
 * Effective rules (consumed by isEnabled):
 *   - state === "off"                                     -> disabled
 *   - pauseUntil set and in the future                    -> disabled
 *   - hookId in bypass list                               -> disabled
 *   - otherwise enabled; the underlying hook decides verdict
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { recordAudit } from './audit.js';

const DEFAULT_STATE_DIR = path.join(os.homedir(), '.deliberate');
const STATE_FILE_NAME = 'discipline-state.json';

const VALID_STATES = new Set(['strict', 'loose', 'off']);

const DEFAULT_STATE = Object.freeze({
  state: 'strict',
  pauseUntil: null,
  bypass: []
});

function statePath(dir = DEFAULT_STATE_DIR) {
  return path.join(dir, STATE_FILE_NAME);
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Read the current discipline state. Missing file -> DEFAULT_STATE.
 *
 * @param {{ dir?: string }} [opts]
 * @returns {{ state: string, pauseUntil: string|null, bypass: string[] }}
 */
export function readState(opts = {}) {
  const dir = opts.dir || DEFAULT_STATE_DIR;
  const file = statePath(dir);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return normalize(parsed);
  } catch {
    return clone(DEFAULT_STATE);
  }
}

function normalize(input) {
  const out = clone(DEFAULT_STATE);
  if (input && typeof input === 'object') {
    if (VALID_STATES.has(input.state)) out.state = input.state;
    if (typeof input.pauseUntil === 'string') out.pauseUntil = input.pauseUntil;
    if (Array.isArray(input.bypass)) {
      out.bypass = input.bypass.filter((s) => typeof s === 'string' && s.length > 0);
    }
  }
  return out;
}

/**
 * Atomically write a new state. Always appends an audit entry describing the
 * action so the agent can see when the safety net was changed.
 *
 * @param {{ state: string, pauseUntil?: string|null, bypass?: string[] }} next
 * @param {{ dir?: string, reason?: string, action?: string }} [opts]
 * @returns {object} the persisted state
 */
export function writeState(next, opts = {}) {
  const dir = opts.dir || DEFAULT_STATE_DIR;
  ensureDir(dir);
  const persisted = normalize(next);
  const file = statePath(dir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(persisted, null, 2));
  fs.renameSync(tmp, file);
  recordAudit({
    action: opts.action || 'set_state',
    state: persisted.state,
    pauseUntil: persisted.pauseUntil,
    bypass: persisted.bypass,
    reason: opts.reason || null
  }, { dir });
  return persisted;
}

/**
 * Pause discipline for a duration like "60m", "2h", "30s".
 *
 * @param {string} duration
 * @param {{ dir?: string, reason?: string }} [opts]
 */
export function pauseFor(duration, opts = {}) {
  const ms = parseDuration(duration);
  if (ms === null) throw new Error(`pauseFor: invalid duration "${duration}"`);
  const until = new Date(Date.now() + ms).toISOString();
  const current = readState({ dir: opts.dir });
  return writeState({ ...current, pauseUntil: until }, {
    dir: opts.dir,
    reason: opts.reason || `pause ${duration}`,
    action: 'pause'
  });
}

/**
 * Add a hook id to the bypass list. Discipline stays on for other hooks.
 *
 * @param {string} hookId
 * @param {{ dir?: string, reason?: string }} [opts]
 */
export function bypassHook(hookId, opts = {}) {
  if (typeof hookId !== 'string' || hookId.length === 0) {
    throw new Error('bypassHook: hookId required');
  }
  const current = readState({ dir: opts.dir });
  const bypass = Array.from(new Set([...(current.bypass || []), hookId]));
  return writeState({ ...current, bypass }, {
    dir: opts.dir,
    reason: opts.reason || `bypass ${hookId}`,
    action: 'bypass'
  });
}

/**
 * Remove a hook from the bypass list.
 */
export function unbypassHook(hookId, opts = {}) {
  const current = readState({ dir: opts.dir });
  const bypass = (current.bypass || []).filter((h) => h !== hookId);
  return writeState({ ...current, bypass }, {
    dir: opts.dir,
    reason: opts.reason || `unbypass ${hookId}`,
    action: 'unbypass'
  });
}

/**
 * Is discipline currently enforcing the given hook id?
 *
 * @param {string} hookId
 * @param {{ dir?: string, now?: number }} [opts]
 * @returns {{ enabled: boolean, reason: string, state: object }}
 */
export function isEnabled(hookId, opts = {}) {
  const state = readState({ dir: opts.dir });
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();

  if (state.state === 'off') {
    return { enabled: false, reason: 'state=off', state };
  }
  if (state.pauseUntil) {
    const until = Date.parse(state.pauseUntil);
    if (Number.isFinite(until) && until > now) {
      return { enabled: false, reason: `paused until ${state.pauseUntil}`, state };
    }
  }
  if (typeof hookId === 'string' && state.bypass.includes(hookId)) {
    return { enabled: false, reason: `bypass ${hookId}`, state };
  }
  return { enabled: true, reason: state.state, state };
}

/**
 * Parse "60m" / "2h" / "30s" / "1d" into milliseconds.
 *
 * @param {string} input
 * @returns {number|null}
 */
export function parseDuration(input) {
  if (typeof input !== 'string') return null;
  const match = input.trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const mult = unit === 's' ? 1_000
             : unit === 'm' ? 60_000
             : unit === 'h' ? 3_600_000
             : 86_400_000;
  return n * mult;
}

export const __testing__ = { statePath, normalize, DEFAULT_STATE };

export default {
  readState, writeState, pauseFor, bypassHook, unbypassHook, isEnabled, parseDuration
};
