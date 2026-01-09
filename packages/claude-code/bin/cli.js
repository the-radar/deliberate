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
  .description('Install hooks and configure Claude Code integration')
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

    // Check hooks installation
    const claudeSettingsPath = join(homedir(), '.claude', 'settings.json');
    let hooksInstalled = false;

    if (existsSync(claudeSettingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(claudeSettingsPath, 'utf-8'));
        const hooks = settings.hooks || {};
        const preToolUse = hooks.PreToolUse || [];
        const postToolUse = hooks.PostToolUse || [];

        const hasCommandHook = preToolUse.some(h =>
          h.command && h.command.includes('explain-command')
        );
        const hasChangesHook = postToolUse.some(h =>
          h.command && h.command.includes('explain-changes')
        );

        if (hasCommandHook && hasChangesHook) {
          console.log('Hooks:      ✅ Installed (PreToolUse + PostToolUse)');
          hooksInstalled = true;
        } else if (hasCommandHook) {
          console.log('Hooks:      ⚠️  Partial (PreToolUse only)');
          hooksInstalled = true;
        } else if (hasChangesHook) {
          console.log('Hooks:      ⚠️  Partial (PostToolUse only)');
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
    if (hooksInstalled) {
      console.log('Status: Ready to protect your Claude Code sessions');
    } else {
      console.log('Status: Run "deliberate install" to set up hooks');
    }
  });

program.parse();
