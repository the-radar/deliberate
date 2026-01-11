/**
 * Uninstaller - Removes Claude Code hooks and optionally removes config
 * Handles:
 * - Removing hooks from ~/.claude/hooks/
 * - Removing hook entries from ~/.claude/settings.json
 * - Optionally removing ~/.deliberate/config.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME_DIR = os.homedir();
const CLAUDE_DIR = path.join(HOME_DIR, '.claude');
const HOOKS_DIR = path.join(CLAUDE_DIR, 'hooks');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const CONFIG_FILE = path.join(HOME_DIR, '.deliberate', 'config.json');

// Hook files to remove
const HOOKS_TO_REMOVE = [
  'deliberate-explain-command.py',
  'deliberate-explain-changes.py'
];

/**
 * Remove hook files from ~/.claude/hooks/
 */
function removeHooks() {
  console.log('Removing hook files...');
  let removed = 0;

  for (const hookFile of HOOKS_TO_REMOVE) {
    const hookPath = path.join(HOOKS_DIR, hookFile);
    if (fs.existsSync(hookPath)) {
      fs.unlinkSync(hookPath);
      console.log(`  Removed: ${hookPath}`);
      removed++;
    }
  }

  if (removed === 0) {
    console.log('  No hook files found to remove');
  }

  return removed;
}

/**
 * Remove Deliberate hooks from ~/.claude/settings.json
 */
function removeFromSettings() {
  console.log('Updating Claude Code settings...');

  if (!fs.existsSync(SETTINGS_FILE)) {
    console.log('  Settings file not found, skipping');
    return;
  }

  try {
    const content = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    const settings = JSON.parse(content);

    // Remove Deliberate hooks from PreToolUse and PostToolUse
    let modified = false;

    if (settings.hooks) {
      // Filter out Deliberate hooks from PreToolUse
      if (settings.hooks.PreToolUse) {
        const filtered = settings.hooks.PreToolUse.map(matcher => {
          if (!matcher.hooks) return matcher;

          const filteredHooks = matcher.hooks.filter(hook => {
            const isDeliberate = hook.command && (
              hook.command.includes('deliberate-explain-command') ||
              hook.command.includes('deliberate-explain-changes')
            );
            if (isDeliberate) modified = true;
            return !isDeliberate;
          });

          return { ...matcher, hooks: filteredHooks };
        }).filter(matcher => matcher.hooks && matcher.hooks.length > 0);

        settings.hooks.PreToolUse = filtered;
      }

      // Filter out Deliberate hooks from PostToolUse
      if (settings.hooks.PostToolUse) {
        const filtered = settings.hooks.PostToolUse.map(matcher => {
          if (!matcher.hooks) return matcher;

          const filteredHooks = matcher.hooks.filter(hook => {
            const isDeliberate = hook.command && (
              hook.command.includes('deliberate-explain-command') ||
              hook.command.includes('deliberate-explain-changes')
            );
            if (isDeliberate) modified = true;
            return !isDeliberate;
          });

          return { ...matcher, hooks: filteredHooks };
        }).filter(matcher => matcher.hooks && matcher.hooks.length > 0);

        settings.hooks.PostToolUse = filtered;
      }
    }

    if (modified) {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      console.log('  Settings updated');
    } else {
      console.log('  No Deliberate hooks found in settings');
    }
  } catch (error) {
    console.error(`  Error updating settings: ${error.message}`);
  }
}

/**
 * Prompt for user input (simple version)
 * @param {string} question
 * @returns {Promise<string>}
 */
async function prompt(question) {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Main uninstall function
 */
export async function uninstall() {
  console.log('');
  console.log('===========================================');
  console.log('  Deliberate - Uninstallation');
  console.log('===========================================');
  console.log('');

  // Remove hooks
  const removed = removeHooks();

  // Update settings
  console.log('');
  removeFromSettings();

  // Ask about config
  console.log('');
  if (fs.existsSync(CONFIG_FILE)) {
    const answer = await prompt('Remove ~/.deliberate/config.json? (y/n): ');
    if (answer.toLowerCase() === 'y') {
      fs.unlinkSync(CONFIG_FILE);
      console.log('  Removed config file');

      // Try to remove directory if empty
      const configDir = path.dirname(CONFIG_FILE);
      try {
        const files = fs.readdirSync(configDir);
        if (files.length === 0) {
          fs.rmdirSync(configDir);
          console.log('  Removed empty ~/.deliberate directory');
        }
      } catch {
        // Ignore errors
      }
    } else {
      console.log('  Kept config file');
    }
  } else {
    console.log('Config file not found, nothing to remove');
  }

  // Success message
  console.log('');
  console.log('===========================================');
  console.log('  Uninstallation Complete!');
  console.log('===========================================');
  console.log('');
  console.log('Next step:');
  console.log('  Restart Claude Code to unload the hooks');
  console.log('');
}

// Allow running directly
if (process.argv[1] && process.argv[1].endsWith('uninstall.js')) {
  uninstall();
}

export default { uninstall };
