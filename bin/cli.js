#!/usr/bin/env node
/**
 * Deliberate CLI
 * Safety layer for agentic coding tools
 */

import { Command } from 'commander';
import { install } from '../src/install.js';
import { startServer } from '../src/server.js';
import { classify, getStatus } from '../src/classifier/index.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const program = new Command();

program
  .name('deliberate')
  .description('Safety layer for agentic coding tools')
  .version('1.0.0');

program
  .command('install')
  .description('Install hooks and configure Claude Code/OpenCode integration')
  .action(async () => {
    await install();
  });

program
  .command('serve')
  .description('Start the classifier server')
  .option('-p, --port <port>', 'Port to listen on', '8765')
  .action(async (options) => {
    await startServer(parseInt(options.port));
  });

program
  .command('classify <input>')
  .description('Classify a command or file change')
  .option('-t, --type <type>', 'Type of input: command, edit, write', 'command')
  .action(async (input, options) => {
    const result = await classify(input, options.type);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('status')
  .description('Check if hooks are installed and classifier is ready')
  .action(async () => {
    console.log('Deliberate Status\n');

    // Check Claude Code hooks installation
    const claudeSettingsPath = join(homedir(), '.claude', 'settings.json');
    let hooksInstalled = false;

    if (existsSync(claudeSettingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(claudeSettingsPath, 'utf-8'));
        const hooks = settings.hooks || {};
        const preToolUse = hooks.PreToolUse || [];
        const postToolUse = hooks.PostToolUse || [];

        const hasHookCommand = (entries, needle) =>
          entries.some(entry => Array.isArray(entry.hooks) && entry.hooks.some(hook =>
            hook.command && hook.command.includes(needle)
          ));

        const hasCommandHook = hasHookCommand(preToolUse, 'deliberate-commands');
        const hasChangesHook = hasHookCommand(postToolUse, 'deliberate-changes');
        const hasCommandPostHook = hasHookCommand(postToolUse, 'deliberate-commands-post');

        if (hasCommandHook && hasChangesHook && hasCommandPostHook) {
          console.log('Hooks:      ✅ Installed (PreToolUse + PostToolUse)');
          hooksInstalled = true;
        } else if (hasCommandHook || hasChangesHook || hasCommandPostHook) {
          console.log('Hooks:      ⚠️  Partial (missing some hooks)');
          hooksInstalled = true;
        } else {
          console.log('Hooks:      ❌ Not installed');
        }
      } catch (e) {
        console.log('Hooks:      ❌ Error reading settings');
      }
    } else {
      console.log('Hooks:      ❌ Claude settings not found');
    }

    // Check OpenCode plugin installation
    const openCodeConfigDir = join(homedir(), '.config', 'opencode');
    const openCodeConfigPaths = [join(openCodeConfigDir, 'opencode.json'), join(openCodeConfigDir, 'opencode.jsonc')];
    const openCodePluginPaths = [
      join(openCodeConfigDir, 'plugins', 'deliberate.js'),
      join(openCodeConfigDir, 'plugins', 'deliberate-changes.js')
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

    // Check classifier status
    const classifierStatus = getStatus();

    if (classifierStatus.patternMatcher?.ready) {
      console.log('Patterns:   ✅ Ready');
    } else {
      console.log('Patterns:   ❌ Not loaded');
    }

    if (classifierStatus.modelClassifier?.ready) {
      console.log('Classifier: ✅ Ready');
    } else {
      console.log('Classifier: ⚠️  Will load on first use');
    }

    // Overall status
    console.log('');
    if (hooksInstalled || openCodeInstalled) {
      console.log('Status: Ready to protect your agent sessions');
    } else {
      console.log('Status: Run "deliberate install" to set up hooks');
    }
  });

program.parse();
