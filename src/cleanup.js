/**
 * deliberate cleanup
 *
 * Sweep `~/.deliberate/panes/` and reconcile lock files with reality:
 *   - lock file with a live pid → keep
 *   - lock file with a dead pid → remove the lock file
 *   - lock file with no pid that is older than `maxAgeDays` → remove
 *
 * Optionally takes `{ killOrphans: true }` to SIGTERM live PIDs that are not
 * tied to a currently-active Claude Code session. Detecting which sessions
 * are alive is out of scope for this module (we just expose the primitives).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const PANES_DIR = path.join(os.homedir(), '.deliberate', 'panes');

/**
 * @param {number | null | undefined} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    // process.kill with signal 0 throws if the pid is dead or unreachable.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the pid is alive but owned by another user — count as alive.
    return err && err.code === 'EPERM';
  }
}

/**
 * @param {string} filePath
 * @returns {{ sessionId?: string, pid?: number, timestamp?: string } | null}
 */
function readLock(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data;
  } catch {
    // ignored — treat unreadable locks as missing
  }
  return null;
}

/**
 * Sweep lock files. Returns a summary; the caller decides how to render.
 *
 * @param {{ panesDir?: string, maxAgeDays?: number, dryRun?: boolean }} [opts]
 */
export function cleanupPanes(opts = {}) {
  const dir = opts.panesDir || PANES_DIR;
  const maxAgeDays = Number.isFinite(opts.maxAgeDays) ? opts.maxAgeDays : 7;
  const dryRun = Boolean(opts.dryRun);

  const summary = {
    panesDir: dir,
    scanned: 0,
    kept: [],      // [{ file, pid, sessionId }]
    removed: [],   // [{ file, reason, pid, sessionId }]
    errors: []     // [{ file, message }]
  };

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return summary;
    summary.errors.push({ file: dir, message: String(err && err.message || err) });
    return summary;
  }

  const cutoffMs = Date.now() - maxAgeDays * 86400 * 1000;

  for (const name of entries) {
    if (!name.startsWith('pane-started-') || !name.endsWith('.json')) continue;
    const filePath = path.join(dir, name);
    summary.scanned += 1;

    const data = readLock(filePath);
    const pidRaw = data && data.pid;
    const pid = Number.isFinite(pidRaw) ? pidRaw : null;
    const sessionId = data && typeof data.sessionId === 'string' ? data.sessionId : undefined;

    let reason = null;
    if (pid !== null) {
      if (!isPidAlive(pid)) reason = 'dead-pid';
    } else {
      // Legacy locks have no pid. Trust mtime instead.
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(filePath).mtimeMs;
      } catch (err) {
        summary.errors.push({ file: filePath, message: String(err && err.message || err) });
        continue;
      }
      if (mtimeMs < cutoffMs) reason = 'legacy-stale';
    }

    if (reason) {
      if (!dryRun) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          summary.errors.push({ file: filePath, message: String(err && err.message || err) });
          continue;
        }
      }
      summary.removed.push({ file: filePath, reason, pid, sessionId });
    } else {
      summary.kept.push({ file: filePath, pid, sessionId });
    }
  }

  return summary;
}

/**
 * @param {ReturnType<typeof cleanupPanes>} summary
 * @returns {string}
 */
export function formatCleanupSummary(summary) {
  const lines = [];
  lines.push(`Pane locks scanned: ${summary.scanned}`);
  lines.push(`  kept (live pid):  ${summary.kept.length}`);
  lines.push(`  removed:          ${summary.removed.length}`);
  if (summary.removed.length > 0) {
    const byReason = summary.removed.reduce((acc, item) => {
      acc[item.reason] = (acc[item.reason] || 0) + 1;
      return acc;
    }, {});
    for (const [reason, count] of Object.entries(byReason)) {
      lines.push(`    - ${reason}: ${count}`);
    }
  }
  if (summary.errors.length > 0) {
    lines.push(`  errors:           ${summary.errors.length}`);
    for (const e of summary.errors) lines.push(`    - ${e.file}: ${e.message}`);
  }
  return lines.join('\n');
}

export default { cleanupPanes, formatCleanupSummary, isPidAlive };
