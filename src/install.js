/**
 * Installer - Sets up Claude Code hooks and configuration
 * Handles:
 * - Symlinking hooks to ~/.claude/hooks/
 * - Updating ~/.claude/settings.json
 * - Installing OpenCode plugin (if available)
 * - Configuring Deliberate LLM provider
 * - Optional server startup for pane/chat transport
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { LLM_PROVIDERS, setLLMProvider, isLLMConfigured, getConfigFile } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cross-platform paths
const HOME_DIR = os.homedir();
const IS_WINDOWS = process.platform === 'win32';
const CLAUDE_DIR = path.join(HOME_DIR, '.claude');
const HOOKS_DIR = path.join(CLAUDE_DIR, 'hooks');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const OPENCODE_DIR = path.join(HOME_DIR, '.config', 'opencode');
const OPENCODE_PLUGIN_DIR = path.join(OPENCODE_DIR, 'plugins');
const ANTIGRAVITY_DIR = path.join(HOME_DIR, '.antigravity');
const ANTIGRAVITY_HOOKS_DIR = path.join(ANTIGRAVITY_DIR, 'hooks');
const ANTIGRAVITY_SETTINGS = path.join(HOME_DIR, 'Library', 'Application Support', 'Antigravity', 'User', 'settings.json'); // macOS specific, need to handle others?
// Research showed ~/.antigravity/settings.json as global config, but ls showed ~/Library/.../settings.json
// I'll check both or prefer the one that exists.
const GEMINI_DIR = path.join(HOME_DIR, '.gemini');
const GEMINI_HOOKS_DIR = path.join(GEMINI_DIR, 'hooks');
const GEMINI_SETTINGS = path.join(GEMINI_DIR, 'settings.json');

// Python command (python on Windows, python3 on Unix)
const PYTHON_CMD = IS_WINDOWS ? 'python' : 'python3';

const OPENCODE_CONFIG_FILES = ['opencode.json', 'opencode.jsonc'];

// Hook files to install
const HOOKS = [
  // Commands - PreToolUse for analysis and review gating
  {
    source: 'deliberate-commands.py',
    dest: 'deliberate-commands.py',
    event: 'PreToolUse',
    matcher: 'Bash',
    timeout: 35
  },
  // Commands - PostToolUse for persistent display of cached analysis
  {
    source: 'deliberate-commands-post.py',
    dest: 'deliberate-commands-post.py',
    event: 'PostToolUse',
    matcher: 'Bash',
    timeout: 5  // Just reads cache, no analysis needed
  },
  // Changes - PostToolUse for informational analysis only (cannot block)
  {
    source: 'deliberate-changes.py',
    dest: 'deliberate-changes.py',
    event: 'PostToolUse',
    matcher: 'Write|Edit|MultiEdit',
    timeout: 35
  },

  // SessionStart: auto-open per-session Deliberate pane (TUI) and auto-start server
  {
    source: 'deliberate-session-start.py',
    dest: 'deliberate-session-start.py',
    event: 'SessionStart',
    // Claude Code fires SessionStart for multiple lifecycle reasons
    // (startup/resume/compact). We only want to auto-open panes on startup.
    matcher: 'startup',
    timeout: 5
  }
];

/**
 * Get the command to run a Python hook
 * On Windows, we need to call python explicitly
 * @param {string} hookPath - Path to the hook file
 * @returns {string} Command to run the hook
 */
function getHookCommand(hookPath) {
  if (IS_WINDOWS) {
    // Windows: call python explicitly
    return `python "${hookPath}"`;
  }
  // Unix: can run directly (shebang)
  return hookPath;
}

/**
 * Ensure a directory exists
 * @param {string} dir - Directory path
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

/**
 * Remove an existing file or symlink path if present.
 *
 * Why this helper exists:
 * - `fs.existsSync` returns false for broken symlinks.
 * - We install many hooks as symlinks, so we must use lstat to detect and
 *   remove stale entries reliably before creating new links.
 *
 * @param {string} targetPath
 */
function removeExistingPath(targetPath) {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isFile() || stat.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
    }
  } catch (err) {
    // Path missing is expected on first install.
  }
}

/**
 * Install hook files to ~/.claude/hooks/
 * Uses symlinks on Unix (edits take effect immediately)
 * Uses copies on Windows (symlinks require admin)
 * @returns {string[]} List of installed hook paths
 */
function installHooks() {
  ensureDir(HOOKS_DIR);

  const hooksSourceDir = path.join(__dirname, '..', 'hooks');
  const installed = [];

  for (const hook of HOOKS) {
    const sourcePath = path.join(hooksSourceDir, hook.source);
    const destPath = path.join(HOOKS_DIR, hook.dest);

    if (!fs.existsSync(sourcePath)) {
      console.warn(`Warning: Hook source not found: ${sourcePath}`);
      continue;
    }

    // Remove existing file/symlink if present
    try {
      const stat = fs.lstatSync(destPath);
      if (stat.isFile() || stat.isSymbolicLink()) {
        fs.unlinkSync(destPath);
      }
    } catch (err) {
      // File doesn't exist, that's fine
    }

    if (IS_WINDOWS) {
      // Windows: Copy the file (symlinks require admin/dev mode)
      fs.copyFileSync(sourcePath, destPath);
      console.log(`Installed hook: ${hook.dest} (copied)`);
    } else {
      // Unix: Create symlink for live updates
      fs.symlinkSync(sourcePath, destPath);
      // Ensure source is executable
      fs.chmodSync(sourcePath, 0o755);
      console.log(`Installed hook: ${hook.dest} -> ${sourcePath}`);
    }

    installed.push(destPath);
  }

  return installed;
}

function loadOpenCodeConfig() {
  for (const filename of OPENCODE_CONFIG_FILES) {
    const candidate = path.join(OPENCODE_DIR, filename);
    if (fs.existsSync(candidate)) {
      try {
        const content = fs.readFileSync(candidate, 'utf-8');
        return { path: candidate, config: JSON.parse(content) };
      } catch (error) {
        return { path: candidate, config: null, error: error.message };
      }
    }
  }

  return { path: path.join(OPENCODE_DIR, OPENCODE_CONFIG_FILES[0]), config: null };
}

function saveOpenCodeConfig(configPath, config) {
  ensureDir(OPENCODE_DIR);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function ensureOpenCodePluginReference() {
  const pluginPaths = [
    path.join(OPENCODE_PLUGIN_DIR, 'deliberate.js'),
    path.join(OPENCODE_PLUGIN_DIR, 'deliberate-changes.js')
  ];
  const targets = pluginPaths.map((pluginPath) => {
    const normalized = pluginPath.split(path.sep).join('/');
    return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
  });
  const { path: configPath, config, error } = loadOpenCodeConfig();

  if (error) {
    console.warn(`Warning: Could not parse ${configPath}: ${error}`);
    return { updated: false, configPath };
  }

  const nextConfig = config || { $schema: 'https://opencode.ai/config.json' };
  const plugins = Array.isArray(nextConfig.plugin) ? nextConfig.plugin : [];
  let updated = false;

  for (const target of targets) {
    if (!plugins.includes(target)) {
      plugins.push(target);
      updated = true;
    }
  }

  if (updated) {
    nextConfig.plugin = plugins;
    saveOpenCodeConfig(configPath, nextConfig);
  }

  return { updated, configPath };
}

/**
 * Install Antigravity hooks
 */
function installAntigravityHooks() {
  // Check if Antigravity is installed (check both config locations)
  let settingsFile = path.join(HOME_DIR, '.antigravity', 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    // Try macOS standard path
    settingsFile = path.join(HOME_DIR, 'Library', 'Application Support', 'Antigravity', 'User', 'settings.json');
  }

  if (!fs.existsSync(settingsFile) && !fs.existsSync(ANTIGRAVITY_DIR)) {
    console.log('Antigravity: ⚠️  Not found (skipping)');
    return false;
  }

  ensureDir(ANTIGRAVITY_HOOKS_DIR);

  const sourceDir = path.join(__dirname, '..', 'antigravity');
  const hooks = [
    { src: 'pre-tool-use.sh', dest: 'pre-tool-use.sh' },
    { src: 'post-tool-use.sh', dest: 'post-tool-use.sh' }
  ];

  for (const hook of hooks) {
    const sourcePath = path.join(sourceDir, hook.src);
    const destPath = path.join(ANTIGRAVITY_HOOKS_DIR, hook.dest);

    removeExistingPath(destPath);

    if (IS_WINDOWS) {
      fs.copyFileSync(sourcePath, destPath);
    } else {
      fs.symlinkSync(sourcePath, destPath);
      fs.chmodSync(sourcePath, 0o755);
    }
  }

  // Update settings
  if (fs.existsSync(settingsFile)) {
    try {
      const content = fs.readFileSync(settingsFile, 'utf-8');
      const settings = JSON.parse(content);
      
      if (!settings.tools) settings.tools = {};
      settings.tools.enableHooks = true;
      
      if (!settings.hooks) settings.hooks = {};
      settings.hooks.enabled = true;
      settings.hooks.path = ANTIGRAVITY_HOOKS_DIR;

      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
      console.log(`Antigravity: ✅ Hooks installed & enabled in ${settingsFile}`);
    } catch (e) {
      console.warn(`Antigravity: ⚠️  Failed to update settings: ${e.message}`);
    }
  } else {
    console.log('Antigravity: ✅ Hooks installed (settings.json not found)');
  }

  return true;
}

/**
 * Install Gemini hooks
 */
function installGeminiHooks() {
  if (!fs.existsSync(GEMINI_DIR)) {
    console.log('Gemini: ⚠️  Not found (skipping)');
    return false;
  }

  ensureDir(GEMINI_HOOKS_DIR);

  const sourceDir = path.join(__dirname, '..', 'gemini');
  const hooks = [
    { src: 'pre-command.sh', dest: 'pre-command.sh' },
    { src: 'post-file-change.sh', dest: 'post-file-change.sh' }
  ];

  for (const hook of hooks) {
    const sourcePath = path.join(sourceDir, hook.src);
    const destPath = path.join(GEMINI_HOOKS_DIR, hook.dest);

    removeExistingPath(destPath);

    if (IS_WINDOWS) {
      fs.copyFileSync(sourcePath, destPath);
    } else {
      fs.symlinkSync(sourcePath, destPath);
      fs.chmodSync(sourcePath, 0o755);
    }
  }

  // Update settings
  if (fs.existsSync(GEMINI_SETTINGS)) {
    try {
      const content = fs.readFileSync(GEMINI_SETTINGS, 'utf-8');
      const settings = JSON.parse(content);
      
      if (!settings.tools) settings.tools = {};
      settings.tools.enableHooks = true;
      
      if (!settings.hooks) settings.hooks = {};
      settings.hooks.enabled = true;
      settings.hooks.path = GEMINI_HOOKS_DIR;
      
      if (!settings.hooks.scripts) settings.hooks.scripts = {};
      settings.hooks.scripts['pre-command'] = 'pre-command.sh';
      settings.hooks.scripts['post-file-change'] = 'post-file-change.sh';

      fs.writeFileSync(GEMINI_SETTINGS, JSON.stringify(settings, null, 2));
      console.log(`Gemini: ✅ Hooks installed & enabled in ${GEMINI_SETTINGS}`);
    } catch (e) {
      console.warn(`Gemini: ⚠️  Failed to update settings: ${e.message}`);
    }
  } else {
    console.log('Gemini: ✅ Hooks installed (settings.json not found)');
  }

  return true;
}

/**
 * Install OpenCode plugin to ~/.config/opencode/plugins
 * Uses symlink on Unix, copy on Windows
 * @returns {string|null} Installed plugin path or null
 */
function installOpenCodePlugin() {
  const pluginSource = path.join(__dirname, '..', 'opencode');

  const primaryPluginSource = path.join(pluginSource, 'deliberate-plugin.js');
  const changesPluginSource = path.join(pluginSource, 'deliberate-changes-plugin.js');

  if (!fs.existsSync(primaryPluginSource) || !fs.existsSync(changesPluginSource)) {
    console.warn('Warning: OpenCode plugin source not found, skipping');
    return null;
  }

  ensureDir(OPENCODE_PLUGIN_DIR);

  const primaryDest = path.join(OPENCODE_PLUGIN_DIR, 'deliberate.js');
  const changesDest = path.join(OPENCODE_PLUGIN_DIR, 'deliberate-changes.js');

  for (const dest of [primaryDest, changesDest]) {
    try {
      const stat = fs.lstatSync(dest);
      if (stat.isFile() || stat.isSymbolicLink()) {
        fs.unlinkSync(dest);
      }
    } catch (err) {
      // File doesn't exist, that's fine
    }
  }

  if (IS_WINDOWS) {
    fs.copyFileSync(primaryPluginSource, primaryDest);
    fs.copyFileSync(changesPluginSource, changesDest);
    console.log(`Installed OpenCode plugin: ${primaryDest} (copied)`);
    console.log(`Installed OpenCode plugin: ${changesDest} (copied)`);
  } else {
    fs.symlinkSync(primaryPluginSource, primaryDest);
    fs.symlinkSync(changesPluginSource, changesDest);
    fs.chmodSync(primaryPluginSource, 0o755);
    fs.chmodSync(changesPluginSource, 0o755);
    console.log(`Installed OpenCode plugin: ${primaryDest} -> ${primaryPluginSource}`);
    console.log(`Installed OpenCode plugin: ${changesDest} -> ${changesPluginSource}`);
  }

  const configResult = ensureOpenCodePluginReference();
  if (configResult.updated) {
    console.log(`Updated OpenCode config: ${configResult.configPath}`);
  } else {
    console.log(`OpenCode config already references plugin: ${configResult.configPath}`);
  }

  return primaryDest;
}

/**
 * Update ~/.claude/settings.json with hook configuration
 * Preserves existing settings and hooks
 */
function updateSettings() {
  let settings = {};

  // Load existing settings if present
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const content = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      settings = JSON.parse(content);
      console.log('Loaded existing settings.json');
    } catch (error) {
      console.warn('Warning: Could not parse existing settings.json, creating backup');
      fs.copyFileSync(SETTINGS_FILE, SETTINGS_FILE + '.backup');
      settings = {};
    }
  }

  // Ensure hooks structure exists
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Add/update our hooks for each event type
  for (const hook of HOOKS) {
    const event = hook.event;
    if (!settings.hooks[event]) {
      settings.hooks[event] = [];
    }

    const normalizeMatcher = (value) => (typeof value === 'string' ? value : '');
    const needle = String(hook.dest || hook.source || 'deliberate').replace(/\\/g, '/');

    // Check if our hook already exists
    // Prefer matching by the installed hook filename, not by matcher.
    // Users often tweak matchers manually, and we also evolve them over time
    // (ex: SessionStart should only run on "startup"). If we matched on matcher
    // first, we'd accidentally install duplicates.
    const existingIndex = settings.hooks[event].findIndex((h) =>
      (h.hooks || []).some((hh) => String(hh.command || '').includes(needle))
    );

    const hookPath = path.join(HOOKS_DIR, hook.dest);
    const hookConfig = {
      matcher: hook.matcher,
      hooks: [
        {
          type: 'command',
          command: getHookCommand(hookPath),
          timeout: hook.timeout
        }
      ]
    };

    if (existingIndex >= 0) {
      // Update existing
      settings.hooks[event][existingIndex] = hookConfig;
      console.log(`Updated ${event} hook for ${hook.matcher}`);
    } else {
      // Add new
      settings.hooks[event].push(hookConfig);
      console.log(`Added ${event} hook for ${hook.matcher}`);
    }
  }

  // Write settings
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  console.log(`Updated: ${SETTINGS_FILE}`);
}

/**
 * Check if a command exists in PATH
 * @param {string} cmd - Command to check
 * @returns {boolean}
 */
function commandExists(cmd) {
  try {
    const checkCmd = IS_WINDOWS ? `where ${cmd}` : `which ${cmd}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check Python version
 * @returns {{ok: boolean, version: string|null}}
 */
function checkPython() {
  try {
    const result = execSync(`${PYTHON_CMD} --version`, { encoding: 'utf-8' });
    const match = result.match(/Python (\d+)\.(\d+)/);
    if (match) {
      const major = parseInt(match[1]);
      const minor = parseInt(match[2]);
      if (major >= 3 && minor >= 9) {
        return { ok: true, version: result.trim() };
      }
      return { ok: false, version: result.trim() };
    }
    return { ok: false, version: null };
  } catch {
    return { ok: false, version: null };
  }
}

/**
 * Check if Claude CLI is available
 * @returns {boolean}
 */
function checkClaudeCLI() {
  return commandExists('claude');
}

/**
 * Check if existing Claude OAuth credentials exist
 * @returns {{exists: boolean, token: string|null}}
 */
function checkExistingClaudeCredentials() {
  const credentialsFile = path.join(HOME_DIR, '.claude', '.credentials.json');
  try {
    if (fs.existsSync(credentialsFile)) {
      const content = fs.readFileSync(credentialsFile, 'utf-8');
      const creds = JSON.parse(content);
      // Look for OAuth token in credentials
      if (creds.claudeAiOauth?.accessToken) {
        return { exists: true, token: creds.claudeAiOauth.accessToken };
      }
    }
  } catch {
    // Ignore read errors
  }
  return { exists: false, token: null };
}

/**
 * Run claude setup-token and capture the OAuth token
 * @returns {Promise<{success: boolean, token: string|null, error: string|null}>}
 */
async function captureClaudeOAuthToken() {
  const { spawn } = await import('child_process');

  return new Promise((resolve) => {
    console.log('');
    console.log('Opening browser for Claude authentication...');
    console.log('(Complete the OAuth flow in your browser)');
    console.log('');

    const child = spawn('claude', ['setup-token'], {
      stdio: ['inherit', 'pipe', 'inherit'],
      shell: true
    });

    let output = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      // Print output to user (they need to see the flow)
      process.stdout.write(text);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, token: null, error: 'setup-token failed' });
        return;
      }

      // Extract token from output - format: "sk-ant-oat01-..."
      const tokenMatch = output.match(/sk-ant-[a-zA-Z0-9_-]+/);
      if (tokenMatch) {
        resolve({ success: true, token: tokenMatch[0], error: null });
      } else {
        resolve({ success: false, token: null, error: 'Could not find token in output' });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, token: null, error: err.message });
    });
  });
}

/**
 * Check if Ollama is running
 * @returns {boolean}
 */
function isOllamaRunning() {
  try {
    execSync('curl -s http://localhost:11434/api/tags', { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Simple prompt for user input (no external dependencies)
 * @param {string} question - Question to ask
 * @param {boolean} hidden - Hide input (for passwords/keys)
 * @returns {Promise<string>}
 */
async function prompt(question, hidden = false) {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(question);
      let input = '';
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', (char) => {
        char = char.toString();
        if (char === '\n' || char === '\r') {
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (char === '\u0003') {
          process.exit();
        } else if (char === '\u007F') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          input += char;
          process.stdout.write('*');
        }
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Simple menu selection
 * @param {string} question - Question to ask
 * @param {Array<{value: string, label: string}>} options - Options to choose from
 * @returns {Promise<string>}
 */
async function select(question, options) {
  console.log(question);
  options.forEach((opt, i) => {
    console.log(`  ${i + 1}) ${opt.label}`);
  });

  while (true) {
    const answer = await prompt('Enter number: ');
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= options.length) {
      return options[num - 1].value;
    }
    console.log('Invalid selection, try again.');
  }
}

/**
 * Configure LLM provider interactively
 * @returns {Promise<void>}
 */
async function configureLLM() {
  console.log('');
  console.log('Configure Deliberate LLM Explainer');
  console.log('----------------------------------');
  console.log('The LLM provides human-readable explanations for commands.');
  console.log('');

  // Build options based on what's available
  const options = [];

  // Check for existing Claude credentials or Claude CLI
  const existingCreds = checkExistingClaudeCredentials();
  if (existingCreds.exists) {
    options.push({
      value: 'claude-subscription-existing',
      label: 'Claude Pro/Max Subscription [credentials found] (recommended)'
    });
  } else if (checkClaudeCLI()) {
    options.push({
      value: 'claude-subscription',
      label: 'Claude Pro/Max Subscription (recommended)'
    });
  }

  // Always offer direct API
  options.push({
    value: 'anthropic',
    label: 'Anthropic API Key (pay-per-token)'
  });

  // Check for Ollama
  if (isOllamaRunning()) {
    options.push({
      value: 'ollama',
      label: 'Ollama (local) [running]'
    });
  }

  options.push({
    value: 'skip',
    label: 'Skip for now (hooks still run, no LLM explanations)'
  });

  const provider = await select('How do you want to authenticate?', options);

  if (provider === 'skip') {
    console.log('');
    console.log('Skipped LLM configuration.');
    console.log('Hooks will still run, but explanations will be basic.');
    console.log('You can configure it later by editing:');
    console.log(`  ${getConfigFile()}`);
    return;
  }

  let apiKey = null;

  if (provider === 'claude-subscription-existing') {
    // Use existing credentials
    apiKey = existingCreds.token;
    console.log('');
    console.log('Using existing Claude credentials.');
  } else if (provider === 'claude-subscription') {
    // Run claude setup-token to get new credentials
    const result = await captureClaudeOAuthToken();
    if (!result.success) {
      console.log('');
      console.log(`Error: ${result.error}`);
      console.log('');
      console.log('If running inside Claude Code or a non-interactive terminal,');
      console.log('first run this in a separate terminal: claude setup-token');
      console.log('Then re-run: deliberate install');
      return;
    }
    apiKey = result.token;
  } else if (provider === 'anthropic') {
    console.log('');
    console.log('Get your API key from: https://console.anthropic.com/settings/keys');
    apiKey = await prompt('Enter your Anthropic API key: ', true);

    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      console.log('');
      console.log('Warning: API key should start with "sk-ant-"');
      const confirm = await prompt('Continue anyway? (y/n): ');
      if (confirm.toLowerCase() !== 'y') {
        console.log('Aborted.');
        return;
      }
    }
  }

  // Normalize provider name for storage
  const providerToSave = provider.startsWith('claude-subscription') ? 'claude-subscription' : provider;

  // Save configuration
  try {
    setLLMProvider(providerToSave, { apiKey });
    console.log('');
    console.log(`Configured: ${LLM_PROVIDERS[providerToSave].name}`);
    console.log(`Config saved to: ${getConfigFile()}`);

    // Set restrictive permissions on config file (contains API key/token)
    if (apiKey && !IS_WINDOWS) {
      try {
        fs.chmodSync(getConfigFile(), 0o600);
        console.log('(File permissions set to 600 for security)');
      } catch (err) {
        // Ignore chmod errors
      }
    } else if (apiKey && IS_WINDOWS) {
      console.log('Note: On Windows, manually restrict access to:');
      console.log(`  ${getConfigFile()}`);
    }
  } catch (error) {
    console.error('Error saving configuration:', error.message);
  }
}

/**
 * Check if Deliberate plugin is already loaded
 * @returns {boolean}
 */
function isPluginInstalled() {
  try {
    const settingsFile = path.join(HOME_DIR, '.claude', 'settings.json');
    if (!fs.existsSync(settingsFile)) return false;

    const content = fs.readFileSync(settingsFile, 'utf-8');
    const settings = JSON.parse(content);

    // Check if deliberate plugin is enabled
    if (settings.enabledPlugins && settings.enabledPlugins['deliberate']) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Main installation function
 */
export async function install() {
  console.log('');
  console.log('===========================================');
  console.log('  Deliberate - Installation');
  console.log('===========================================');
  console.log('');

  // Check for plugin installation conflict
  if (isPluginInstalled()) {
    console.error('ERROR: Deliberate is already installed as a Claude Code plugin.');
    console.error('');
    console.error('You cannot have both the npm and plugin versions installed.');
    console.error('They will conflict and cause commands to be analyzed twice.');
    console.error('');
    console.error('Options:');
    console.error('  1. Uninstall the plugin: /plugin uninstall deliberate');
    console.error('  2. OR: Use the plugin version and skip npm installation');
    console.error('');
    console.error('Recommended: Use the plugin version for better integration.');
    process.exit(1);
  }

  // Check Python
  console.log('Checking Python...');
  const python = checkPython();
  if (!python.ok) {
    if (python.version) {
      console.error(`Error: ${python.version} found, but Python 3.9+ is required`);
    } else {
      console.error(`Error: Python not found. Install Python 3.9+ first.`);
    }
    process.exit(1);
  }
  console.log(`  ${python.version}`);

  // Install hooks
  console.log('');
  console.log('Installing hooks...');
  const installed = installHooks();

  if (installed.length === 0) {
    console.error('Error: No hooks were installed');
    process.exit(1);
  }

  // Update settings
  console.log('');
  console.log('Updating Claude Code settings...');
  updateSettings();

  // Install OpenCode plugin
  console.log('');
  console.log('Installing OpenCode plugin...');
  const opencodePlugin = installOpenCodePlugin();
  if (!opencodePlugin) {
    console.log('OpenCode plugin: ⚠️  Not installed');
  } else {
    console.log('OpenCode plugin: ✅ Installed (commands + changes)');
  }

  // Install Antigravity hooks
  console.log('');
  installAntigravityHooks();

  // Install Gemini hooks
  console.log('');
  installGeminiHooks();

  // Configure LLM if not already configured
  if (!isLLMConfigured()) {
    await configureLLM();
  } else {
    console.log('');
    console.log('LLM already configured. To reconfigure, edit:');
    console.log(`  ${getConfigFile()}`);
  }

  // Success message
  console.log('');
  console.log('===========================================');
  console.log('  Installation Complete!');
  console.log('===========================================');
  console.log('');
  console.log('Installed hooks:');
  for (const hookPath of installed) {
    console.log(`  - ${hookPath}`);
  }
  if (opencodePlugin) {
    console.log(`  - ${opencodePlugin} (OpenCode plugin: commands)`);
    console.log(`  - ${path.join(OPENCODE_PLUGIN_DIR, 'deliberate-changes.js')} (OpenCode plugin: changes)`);
  }
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart Claude Code to load the new hooks');
  console.log('  2. Restart OpenCode to load the new plugin');
  console.log('  3. Restart Antigravity/Gemini to load new hooks');
  console.log('');
  console.log('  4. One-command startup (recommended):');
  console.log('     deliberate start');
  console.log('');
  console.log('     (or server only)');
  console.log('     deliberate serve');
  console.log('');
}

// Allow running directly
if (process.argv[1] && process.argv[1].endsWith('install.js')) {
  install();
}

export default { install };
