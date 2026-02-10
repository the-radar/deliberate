/**
 * Split-pane launcher for the Deliberate TUI.
 *
 * Priorities:
 * - WezTerm (best UX for the target user base)
 * - tmux (nice-to-have, optional)
 * - fallback: run TUI in the current terminal
 *
 * We avoid mandatory dependencies because Claude Code/OpenCode can run inside
 * many terminal environments.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { readRecentEvents } from './event-log.js';

function buildTuiCommandArgs(options = {}) {
  // We want to run the exact same CLI that invoked `deliberate pane`, even when
  // Deliberate is installed as an npm package. The safest way is:
  //   node <path-to-bin/cli.js> tui ...
  const cliPath = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
  const args = [cliPath, 'tui'];

  if (options.allSessions) args.push('--all');
  if (options.sessionId) args.push('--session', options.sessionId);
  if (options.follow === false) args.push('--no-follow');

  return {
    cmd: process.execPath,
    args
  };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function isWezTerm() {
  return Boolean(process.env.WEZTERM_PANE);
}

function isTmux() {
  return Boolean(process.env.TMUX);
}

function pickSessionForCwd(events, cwd) {
  const anchor = typeof cwd === 'string' && cwd.trim() ? cwd : null;
  if (!anchor) return null;

  const withSep = anchor.endsWith(path.sep) ? anchor : `${anchor}${path.sep}`;

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    const evCwd = typeof ev?.data?.cwd === 'string' ? ev.data.cwd : null;
    if (!evCwd) continue;

    const evWithSep = evCwd.endsWith(path.sep) ? evCwd : `${evCwd}${path.sep}`;
    const matches = evCwd === anchor || anchor.startsWith(evWithSep) || evCwd.startsWith(withSep);
    if (!matches) continue;

    const sid = typeof ev.sessionId === 'string' ? ev.sessionId : null;
    if (sid) return sid;
  }

  return null;
}

export async function openPane(options = {}) {
  const percent = Number(options.percent) > 0 ? Math.min(Math.max(Number(options.percent), 10), 80) : 30;
  const direction = options.direction === 'left' ? 'left' : 'right';

  const resolved = { ...options };

  // If the user didn't specify a session, try to pick the session that last
  // emitted events for this working directory. This makes `deliberate pane`
  // feel "native" to the Claude Code session in the current project.
  if (!resolved.allSessions && !resolved.sessionId) {
    const events = readRecentEvents({ days: 2, maxEventsPerFile: 2000 });
    const picked = pickSessionForCwd(events, resolved.cwd || process.cwd());
    if (picked) resolved.sessionId = picked;
  }

  const tui = buildTuiCommandArgs(resolved);

  if (isWezTerm()) {
    const args = [
      'cli',
      'split-pane',
      direction === 'left' ? '--left' : '--right',
      '--percent',
      String(percent),
      '--',
      tui.cmd,
      ...tui.args
    ];
    try {
      await run('wezterm', args);
      return;
    } catch {
      // Fall through, some environments have WEZTERM_* vars without the cli.
    }
  }

  if (isTmux()) {
    const args = [
      'split-window',
      '-h',
      // Don't steal focus. This is critical for Claude Code UX, otherwise the
      // newly-created Deliberate pane becomes active and it feels like it
      // "captures" all keyboard input.
      '-d',
      direction === 'left' ? '-b' : '',
      '-p',
      String(percent),
      tui.cmd,
      ...tui.args
    ].filter(Boolean);

    try {
      await run('tmux', args);
      return;
    } catch {
      // Fall through.
    }
  }

  // macOS fallback: open a new WezTerm window when we can't split.
  // This is intentionally macOS-specific because the user wants a native
  // per-session "side panel" experience even outside split-capable terminals.
  if (process.platform === 'darwin') {
    const cwd = options.cwd || process.cwd();
    const startArgs = ['start', '--cwd', cwd, '--', tui.cmd, ...tui.args];

    try {
      await run('wezterm', startArgs);
      return;
    } catch {
      // Fall through to `open -na WezTerm` if wezterm isn't on PATH.
    }

    try {
      await run('open', ['-na', 'WezTerm', '--args', ...startArgs]);
      return;
    } catch {
      // Fall through to in-terminal mode.
    }
  }

  // Final fallback: run in the current terminal. This blocks, but it still works.
  console.error('deliberate pane: no supported pane manager detected, running TUI in this terminal');
  await run(tui.cmd, tui.args, { cwd: options.cwd || process.cwd() });
}

export default { openPane };
