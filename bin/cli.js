#!/usr/bin/env node
/**
 * Deliberate CLI
 * Safety layer for agentic coding tools
 */

import { Command } from 'commander';
import { install } from '../src/install.js';
import { startServer } from '../src/server.js';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { installGuiFromGithubRelease, getInstalledGuiPath } from '../src/gui-install.js';
import { loadConfig } from '../src/config.js';

const program = new Command();

program
  .name('deliberate')
  .description('Review-first explainability companion for agentic coding')
  .version('1.0.0');

program
  .command('install')
  .description('Install hooks and configure Claude Code/OpenCode integration')
  .action(async () => {
    await install();
  });

program
  .command('serve')
  .description('Start the Deliberate local server')
  .option('-p, --port <port>', 'Port to listen on', '8765')
  .action(async (options) => {
    await startServer(parseInt(options.port));
  });

program
  .command('start')
  .description('One-command startup: ensure server is running and open Deliberate pane')
  .option('--percent <percent>', 'Pane size percentage (10-80)', '30')
  .option('--direction <dir>', 'Split direction: bottom, top, right, or left', 'bottom')
  .option('--all', 'Show all sessions (default is latest)', false)
  .option('--session <id>', 'Filter to a specific session id', null)
  .option('--no-follow', 'Do not auto-follow new events')
  .option('--no-pane', 'Start server only (do not open pane)')
  .option('--no-onboarding', 'Skip walkthrough text for this run')
  .option('--force-onboarding', 'Show walkthrough even if already completed', false)
  .action(async (options) => {
    const {
      ensureServerRunning,
      formatStartStatus,
      shouldShowOnboarding,
      markOnboardingComplete,
      renderOnboardingWalkthrough
    } = await import('../src/start.js');

    const config = loadConfig();
    const status = await ensureServerRunning({ config, cwd: process.cwd() });
    console.log(formatStartStatus(status));
    if (!status.healthy) {
      process.exitCode = 1;
      return;
    }

    const showOnboarding = Boolean(
      options.forceOnboarding ||
      (options.onboarding !== false && shouldShowOnboarding(config))
    );

    if (showOnboarding) {
      console.log(renderOnboardingWalkthrough());
      markOnboardingComplete();
    }

    if (options.pane !== false) {
      const { openPane } = await import('../src/pane.js');
      await openPane({
        percent: options.percent,
        direction: options.direction,
        allSessions: options.all,
        sessionId: options.session,
        follow: options.follow,
        cwd: process.cwd()
      });
    } else {
      console.log('Pane: skipped (--no-pane). Run `deliberate pane` when ready.');
    }
  });

program
  .command('gui')
  .description('Launch the Deliberate desktop GUI (Tauri)')
  .option('--dev', 'Run in dev mode (tauri dev)', false)
  .option('--install', 'Download the GUI binary from GitHub Releases', false)
  .option('--repo <repo>', 'GitHub repo for releases (owner/name)', 'the-radar/deliberate')
  .option('--tag <tag>', 'Release tag (defaults to latest)', null)
  .option('--asset-url <url>', 'Direct download URL for a GUI binary', null)
  .action(async (options) => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = path.join(__dirname, '..');
    const guiDir = path.join(repoRoot, 'gui');

    const run = (cmd, args, cwd) => new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${cmd} exited with code ${code}`));
      });
    });

    const localBinary = path.join(guiDir, 'src-tauri', 'target', 'release', 'gui');
    const installedBinary = getInstalledGuiPath();

    const hasGuiDir = existsSync(guiDir);
    const hasLocalBinary = hasGuiDir && existsSync(localBinary);
    const hasInstalledBinary = existsSync(installedBinary);

    if (options.install) {
      const result = await installGuiFromGithubRelease({
        repo: options.repo,
        tag: options.tag,
        assetUrl: options.assetUrl
      });
      console.log(`Installed GUI: ${result.assetName}`);
      await run(result.installedPath, [], repoRoot);
      return;
    }

    if (!options.dev && hasLocalBinary) {
      await run(localBinary, [], guiDir);
      return;
    }

    if (!options.dev && hasInstalledBinary) {
      await run(installedBinary, [], repoRoot);
      return;
    }

    if (options.dev) {
      if (!hasGuiDir) {
        throw new Error('GUI dev mode requires the repo checkout (missing gui/ directory)');
      }
      await run('npm', ['--prefix', guiDir, 'run', 'tauri', 'dev'], repoRoot);
      return;
    }

    throw new Error('GUI is not installed. Run `deliberate gui --install` or build from source.');
  });

program
  .command('tui')
  .description('Run the Deliberate terminal UI (best for Claude Code/OpenCode)')
  .option('--all', 'Show all sessions (default is latest)', false)
  .option('--session <id>', 'Filter to a specific session id', null)
  .option('--no-follow', 'Do not auto-follow new events')
  .action(async (options) => {
    const { runTui } = await import('../src/tui/index.js');
    await runTui({
      allSessions: options.all,
      sessionId: options.session,
      follow: options.follow
    });
  });

program
  .command('pane')
  .description('Open the Deliberate TUI in a split pane when supported (WezTerm/tmux)')
  .option('--percent <percent>', 'Pane size percentage (10-80)', '30')
  .option('--direction <dir>', 'Split direction: bottom, top, right, or left', 'bottom')
  .option('--all', 'Show all sessions (default is latest)', false)
  .option('--session <id>', 'Filter to a specific session id', null)
  .option('--no-follow', 'Do not auto-follow new events')
  .action(async (options) => {
    const { openPane } = await import('../src/pane.js');
    await openPane({
      percent: options.percent,
      direction: options.direction,
      allSessions: options.all,
      sessionId: options.session,
      follow: options.follow,
      cwd: process.cwd()
    });
  });

program
  .command('onboarding')
  .description('Replay the Deliberate quick walkthrough')
  .option('--no-mark-complete', 'Do not persist onboarding completion')
  .action(async (options) => {
    const { renderOnboardingWalkthrough, markOnboardingComplete } = await import('../src/start.js');
    console.log(renderOnboardingWalkthrough());
    if (options.markComplete !== false) {
      markOnboardingComplete();
    }
  });

program
  .command('status')
  .description('Check if hooks are installed and Deliberate is ready')
  .action(async () => {
    console.log('Deliberate Status\n');

    // Check Claude Code hooks installation
    const claudeSettingsPath = path.join(homedir(), '.claude', 'settings.json');
    let hooksInstalled = false;

    if (existsSync(claudeSettingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(claudeSettingsPath, 'utf-8'));
        const hooks = settings.hooks || {};
        const preToolUse = hooks.PreToolUse || [];
        const postToolUse = hooks.PostToolUse || [];
        const sessionStart = hooks.SessionStart || [];

        const hasHookCommand = (entries, needle) =>
          entries.some(entry => Array.isArray(entry.hooks) && entry.hooks.some(hook =>
            hook.command && hook.command.includes(needle)
          ));

        const hasCommandHook = hasHookCommand(preToolUse, 'deliberate-commands');
        const hasChangesHook = hasHookCommand(postToolUse, 'deliberate-changes');
        const hasCommandPostHook = hasHookCommand(postToolUse, 'deliberate-commands-post');
        const hasSessionStartHook = hasHookCommand(sessionStart, 'deliberate-session-start');

        if (hasCommandHook && hasChangesHook && hasCommandPostHook) {
          console.log('Hooks:      ✅ Installed (PreToolUse + PostToolUse)');
          hooksInstalled = true;
        } else if (hasCommandHook || hasChangesHook || hasCommandPostHook) {
          console.log('Hooks:      ⚠️  Partial (missing some hooks)');
          hooksInstalled = true;
        } else {
          console.log('Hooks:      ❌ Not installed');
        }

        if (hasSessionStartHook) {
          console.log('Auto pane:  ✅ SessionStart hook installed');
        } else {
          console.log('Auto pane:  ⚠️  SessionStart hook not installed');
        }
      } catch (e) {
        console.log('Hooks:      ❌ Error reading settings');
      }
    } else {
      console.log('Hooks:      ❌ Claude settings not found');
    }

    // Check OpenCode plugin installation
    const openCodeConfigDir = path.join(homedir(), '.config', 'opencode');
    const openCodeConfigPaths = [path.join(openCodeConfigDir, 'opencode.json'), path.join(openCodeConfigDir, 'opencode.jsonc')];
    const openCodePluginPaths = [
      path.join(openCodeConfigDir, 'plugins', 'deliberate.js'),
      path.join(openCodeConfigDir, 'plugins', 'deliberate-changes.js')
    ];

    let openCodeInstalled = false;
    const configPath = openCodeConfigPaths.find(path => existsSync(path));

    if (configPath) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        const plugins = Array.isArray(config.plugin) ? config.plugin.map(String) : [];
        const commandPlugin = plugins.some(entry => entry.includes('deliberate.js'));
        const changesPlugin = plugins.some(entry => entry.includes('deliberate-changes.js'));
        const filesPresent = openCodePluginPaths.every(path => existsSync(path));

        if (commandPlugin && changesPlugin && filesPresent) {
          console.log('OpenCode:   ✅ Installed (commands + changes)');
          openCodeInstalled = true;
        } else if (commandPlugin || changesPlugin || filesPresent) {
          console.log('OpenCode:   ⚠️  Partial install');
          openCodeInstalled = true;
        } else {
          console.log('OpenCode:   ❌ Not installed');
        }
      } catch (e) {
        console.log('OpenCode:   ❌ Error reading opencode.json');
      }
    } else {
      console.log('OpenCode:   ❌ Config not found');
    }

    console.log('Quick start: ℹ️  Run `deliberate start` (starts server + opens pane)');
    console.log('Server only: ℹ️  Run `deliberate serve` when using pane/chat APIs');

    // Overall status
    console.log('');
    if (hooksInstalled || openCodeInstalled) {
      console.log('Status: Ready for review-first Deliberate workflows');
    } else {
      console.log('Status: Run "deliberate install" to set up hooks');
    }
  });

program
  .command('cleanup')
  .description('Reconcile pane lock files in ~/.deliberate/panes/ with reality')
  .option('--dry-run', 'Report what would be removed without deleting anything', false)
  .option('--max-age-days <days>', 'Remove legacy locks with no pid older than N days', '7')
  .action(async (options) => {
    const { cleanupPanes, formatCleanupSummary } = await import('../src/cleanup.js');
    const maxAgeDays = Number.parseInt(options.maxAgeDays, 10);
    const summary = cleanupPanes({
      dryRun: Boolean(options.dryRun),
      maxAgeDays: Number.isFinite(maxAgeDays) ? maxAgeDays : 7
    });
    console.log(formatCleanupSummary(summary));
    if (options.dryRun) console.log('(dry run — no files were removed)');
  });

program.parse();
