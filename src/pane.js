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

export async function openPane(options = {}) {
  const percent = Number(options.percent) > 0 ? Math.min(Math.max(Number(options.percent), 10), 80) : 30;
  const direction = options.direction === 'left' ? 'left' : 'right';

  const tui = buildTuiCommandArgs(options);

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

  // Fallback: run in the current terminal. This blocks, but it still works.
  // We keep the message short because this will show up in terminal output.
  console.error('deliberate pane: no supported pane manager detected, running TUI in this terminal');
  await run(tui.cmd, tui.args, { cwd: options.cwd || process.cwd() });
}

export default { openPane };
