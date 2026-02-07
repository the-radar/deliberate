/**
 * Event log helpers for Deliberate UIs.
 *
 * Why this exists:
 * - WS-only UI feeds lose history if the server/UI starts after a session begins.
 * - Hooks must fail-open and never depend on a server being up.
 *
 * So hooks (Python) append a JSONL line per event to a local file, and UIs
 * (TUI, later IDE harnesses) can read/tail it for reliable history.
 *
 * Security:
 * - This log can contain raw commands and file paths, which may include secrets.
 * - We store it under ~/.deliberate/ with restrictive permissions (0600) on
 *   Unix-like systems and keep basic retention helpers.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

function resolveEventLogDir() {
  if (process.env.DELIBERATE_EVENT_LOG_DIR) {
    return process.env.DELIBERATE_EVENT_LOG_DIR;
  }
  return path.join(os.homedir(), '.deliberate', 'events');
}

function utcDayStamp(date = new Date()) {
  // YYYY-MM-DD in UTC.
  return date.toISOString().slice(0, 10);
}

export function getEventLogDir() {
  return resolveEventLogDir();
}

export function getEventLogPath(date = new Date()) {
  return path.join(resolveEventLogDir(), `events-${utcDayStamp(date)}.jsonl`);
}

function ensureLogFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    // mode only applies on create, but that is the common case.
    fs.writeFileSync(filePath, '', { mode: 0o600 });
  }

  // Best-effort permission tightening on Unix. Skip on Windows.
  if (process.platform !== 'win32') {
    try {
      const stat = fs.statSync(filePath);
      const mode = stat.mode & 0o777;
      if (mode !== 0o600) {
        fs.chmodSync(filePath, 0o600);
      }
    } catch {
      // Ignore. Log is still local-only.
    }
  }
}

export function appendEventLog(event) {
  const filePath = getEventLogPath();
  ensureLogFile(filePath);

  const line = `${JSON.stringify(event)}\n`;

  // Use open+write so we can enforce file modes on creation.
  const fd = fs.openSync(filePath, 'a', 0o600);
  try {
    fs.writeSync(fd, line, null, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

export function cleanupOldEventLogs({ days = 7, probability = 0.1 } = {}) {
  if (Math.random() > probability) return;

  const dir = resolveEventLogDir();
  if (!fs.existsSync(dir)) return;

  const now = Date.now();
  const maxAgeMs = days * 24 * 60 * 60 * 1000;

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.startsWith('events-') || !entry.endsWith('.jsonl')) continue;
    const filePath = path.join(dir, entry);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore cleanup failures.
    }
  }
}

export function readEventsFromFile(filePath, { maxEvents = 2000 } = {}) {
  if (!fs.existsSync(filePath)) return [];

  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = raw.split('\n').filter(Boolean);
  const start = Math.max(0, lines.length - maxEvents);
  const out = [];

  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') out.push(parsed);
    } catch {
      // Skip malformed lines.
    }
  }

  return out;
}

export function readRecentEvents({ days = 2, maxEventsPerFile = 2000 } = {}) {
  const out = [];
  const now = new Date();

  for (let i = 0; i < days; i += 1) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const filePath = getEventLogPath(date);
    out.push(...readEventsFromFile(filePath, { maxEvents: maxEventsPerFile }));
  }

  out.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  return out;
}

/**
 * Tail today's event log file.
 *
 * We use polling (interval) instead of fs.watch as the primary mechanism
 * because watch delivery varies across platforms, terminals, and editors.
 *
 * @returns {() => void} stop function
 */
export function tailEventLog({ onEvent, onError, intervalMs = 300 } = {}) {
  const filePath = getEventLogPath();
  ensureLogFile(filePath);

  let fd = null;
  let pos = 0;
  let pending = '';

  const open = () => {
    try {
      fd = fs.openSync(filePath, 'r');
      pos = fs.fstatSync(fd).size;
    } catch (error) {
      fd = null;
      pos = 0;
      onError?.(error);
    }
  };

  const close = () => {
    if (fd === null) return;
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
    fd = null;
  };

  const readNew = () => {
    if (fd === null) open();
    if (fd === null) return;

    let stats;
    try {
      stats = fs.fstatSync(fd);
    } catch (error) {
      close();
      onError?.(error);
      return;
    }

    if (stats.size < pos) {
      // Truncated/rotated.
      pos = 0;
      pending = '';
    }

    const toRead = stats.size - pos;
    if (toRead <= 0) return;

    const buffer = Buffer.alloc(toRead);
    try {
      fs.readSync(fd, buffer, 0, toRead, pos);
    } catch (error) {
      close();
      onError?.(error);
      return;
    }

    pos += toRead;
    pending += buffer.toString('utf8');

    const lines = pending.split('\n');
    pending = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        onEvent?.(parsed);
      } catch {
        // Ignore malformed.
      }
    }
  };

  open();
  const timer = setInterval(readNew, intervalMs);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    close();
  };
}

