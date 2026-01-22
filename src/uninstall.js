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
const OPENCODE_DIR = path.join(HOME_DIR, '.config', 'opencode');
const OPENCODE_PLUGIN_DIR = path.join(OPENCODE_DIR, 'plugins');
const OPENCODE_CONFIG_FILES = ['opencode.json', 'opencode.jsonc'];
const ANTIGRAVITY_DIR = path.join(HOME_DIR, '.antigravity');
const ANTIGRAVITY_HOOKS_DIR = path.join(ANTIGRAVITY_DIR, 'hooks');
const GEMINI_DIR = path.join(HOME_DIR, '.gemini');
const GEMINI_HOOKS_DIR = path.join(GEMINI_DIR, 'hooks');

// Hook files to remove
const HOOKS_TO_REMOVE = [
  'deliberate-commands.py',
  'deliberate-commands-post.py',
  'deliberate-changes.py'
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
 * Remove OpenCode plugin from config and plugins dir
 */
function removeOpenCodePlugin() {
  let removed = false;

  const pluginPaths = [
    path.join(OPENCODE_PLUGIN_DIR, 'deliberate.js'),
    path.join(OPENCODE_PLUGIN_DIR, 'deliberate-changes.js')
  ];

  for (const pluginPath of pluginPaths) {
    if (fs.existsSync(pluginPath)) {
      fs.unlinkSync(pluginPath);
      console.log(`  Removed OpenCode plugin: ${pluginPath}`);
      removed = true;
    }
  }

  for (const filename of OPENCODE_CONFIG_FILES) {
    const configPath = path.join(OPENCODE_DIR, filename);
    if (!fs.existsSync(configPath)) continue;

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      if (Array.isArray(config.plugin)) {
        const nextPlugins = config.plugin.filter((entry) => !String(entry).includes('deliberate'));
        if (nextPlugins.length !== config.plugin.length) {
          config.plugin = nextPlugins;
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
          console.log(`  Updated OpenCode config: ${configPath}`);
          removed = true;
        }
      }
    } catch (error) {
      console.warn(`  Warning: Could not parse ${configPath}: ${error.message}`);
    }
  }

  if (!removed) {
    console.log('  No OpenCode plugin config found');
  }

  return removed;
}

/**
 * Remove Antigravity hooks
 */
function uninstallAntigravityHooks() {
  if (!fs.existsSync(ANTIGRAVITY_HOOKS_DIR)) return;

  console.log('Removing Antigravity hooks...');
  const hooks = ['pre-tool-use.sh', 'post-tool-use.sh'];
  
  for (const hook of hooks) {
    const hookPath = path.join(ANTIGRAVITY_HOOKS_DIR, hook);
    if (fs.existsSync(hookPath)) {
      fs.unlinkSync(hookPath);
      console.log(`  Removed: ${hookPath}`);
    }
  }

  // Note: We don't automatically disable hooks in settings.json to avoid messing up user config
  // if they have other hooks. But we could check if only our hooks were there.
  // For now, leaving the config enabled is safer than breaking other tools.
}

/**
 * Remove Gemini hooks
 */
function uninstallGeminiHooks() {
  if (!fs.existsSync(GEMINI_HOOKS_DIR)) return;

  console.log('Removing Gemini hooks...');
  const hooks = ['pre-command.sh', 'post-file-change.sh'];
  
  for (const hook of hooks) {
    const hookPath = path.join(GEMINI_HOOKS_DIR, hook);
    if (fs.existsSync(hookPath)) {
      fs.unlinkSync(hookPath);
      console.log(`  Removed: ${hookPath}`);
    }
  }
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
              hook.command.includes('deliberate-commands') ||
              hook.command.includes('deliberate-changes')
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
              hook.command.includes('deliberate-commands') ||
              hook.command.includes('deliberate-changes')
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

  // Remove OpenCode plugin
  console.log('');
  removeOpenCodePlugin();

  // Remove Antigravity hooks
  console.log('');
  uninstallAntigravityHooks();

  // Remove Gemini hooks
  console.log('');
  uninstallGeminiHooks();

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
  console.log('  Restart Claude Code, OpenCode, Antigravity, and Gemini to unload hooks/plugins');
  console.log('');
}

// Allow running directly
if (process.argv[1] && process.argv[1].endsWith('uninstall.js')) {
  uninstall();
}

export default { uninstall };
