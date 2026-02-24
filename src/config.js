/**
 * Configuration management for Deliberate.
 *
 * Primary goals:
 * - Single source of truth shared by hooks, server, and GUI.
 * - Safe defaults, additive config fields, and stable disk writes.
 * - Testability via DELIBERATE_CONFIG_FILE override.
 *
 * By default we store preferences in:
 * - Plugin mode: $CLAUDE_PLUGIN_ROOT/.deliberate/config.json
 * - npm mode:    ~/.deliberate/config.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Cross-platform home directory
const HOME_DIR = os.homedir();

function resolveConfigFile() {
  // Test and power-user override.
  if (process.env.DELIBERATE_CONFIG_FILE) {
    return process.env.DELIBERATE_CONFIG_FILE;
  }

  // Keep parity with the Python hooks: if CLAUDE_PLUGIN_ROOT is set, read from
  // the plugin-local .deliberate directory.
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return path.join(process.env.CLAUDE_PLUGIN_ROOT, '.deliberate', 'config.json');
  }

  return path.join(HOME_DIR, '.deliberate', 'config.json');
}

// Default configuration
const DEFAULT_CONFIG = {
  // Master enable switch for Deliberate hooks and UI.
  // When disabled, hooks should fail-open and produce no output, making Deliberate
  // effectively inert until re-enabled.
  deliberate: {
    enabled: true,

    // Record-only mode keeps analysis + logging active, but never asks/blocks
    // commands in PreToolUse. This is useful for high-velocity sessions where
    // the user wants full auditability without execution interruptions.
    recordOnly: false,

    // Scoped "web search" for unknown commands/packages.
    // This is intentionally not arbitrary WebFetch. It only queries known
    // structured sources and produces evidence that can be shown to the user.
    webSearch: {
      enabled: true,
      sources: ['npm', 'pypi', 'github', 'gitlab'],
      maxResultsPerSource: 3
    },

    // Auto-approve rules still run analysis/logging, but they skip interactive
    // approval prompts for matching commands.
    autoApprove: {
      patterns: []
    }
  },
  llm: {
    provider: null,  // 'claude-subscription', 'anthropic', 'ollama', or null
    apiKey: null,    // For 'anthropic' provider
    baseUrl: null,   // Custom URL (e.g., Ollama endpoint)
    model: null      // Model to use
  },
  // Local Deliberate server for broadcast/config/chat transport.
  server: {
    port: 8765
  },
  deduplication: {
    enabled: true  // When true, don't show same warning twice per session
  },

  // Commands the hook should fully skip (no analysis, no output).
  // The hook supports both basenames ("ls") and exact command lines
  // ("git status --porcelain").
  skipCommands: {
    additional: [],
    basenames: [],
    remove: []
  },

  // User-provided block patterns the hook should treat as dangerous.
  // This is intentionally simple (substring match on normalized command).
  customBlocklist: [],

  // UI preferences (TUI pane today, optional GUI later).
  gui: {
    alwaysOnTop: true,
    serverBaseUrl: 'http://localhost:8765',
    visibleOnAllWorkspaces: true,

    // Where should human-facing explanations appear?
    // - "full": show full explanations in Claude Code terminal (current v1 behavior)
    // - "minimal": show a short pointer in terminal, full details in the Deliberate pane/TUI
    // - "gui": suppress terminal explanations entirely (pane/TUI only)
    terminalExplanations: 'full'
  },

  // Terminal UI behavior.
  tui: {
    // Auto-open a per-session pane on Claude Code SessionStart.
    // This is the intended "native" workflow for Claude Code/OpenCode.
    autoPane: true,

    // Start the local Deliberate server if it is not running yet.
    autoStartServer: true
  },

  // CLI onboarding helper state.
  // We show the quick walkthrough once by default, then keep it replayable via
  // `deliberate onboarding`.
  onboarding: {
    completed: false,
    lastShownAt: null
  }
};

// Provider configurations
export const LLM_PROVIDERS = {
  'claude-subscription': {
    name: 'Claude Pro/Max Subscription',
    description: 'Use your Claude Pro or Max subscription (recommended)',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-20250514',
    requiresApiKey: false,  // Uses OAuth token
    usesOAuth: true
  },
  anthropic: {
    name: 'Anthropic API Key',
    description: 'Use your Anthropic API key directly (pay-per-token)',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-5-haiku-20241022',
    requiresApiKey: true
  },
  ollama: {
    name: 'Ollama (local)',
    description: 'Use a local Ollama model (free, private)',
    baseUrl: 'http://localhost:11434/api/generate',
    model: 'llama3.2',
    requiresApiKey: false
  }
};

/**
 * Ensure the .deliberate directory exists
 */
function ensureDir() {
  const configFile = resolveConfigFile();
  const configDir = path.dirname(configFile);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }

  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      out[key] = deepMerge(base[key], value);
      continue;
    }
    out[key] = value;
  }

  return out;
}

function atomicWriteJson(filePath, data) {
  const configDir = path.dirname(filePath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

/**
 * Load configuration from disk
 * @returns {Object} Configuration object
 */
export function loadConfig() {
  const configFile = resolveConfigFile();
  try {
    if (fs.existsSync(configFile)) {
      const content = fs.readFileSync(configFile, 'utf-8');
      return deepMerge(DEFAULT_CONFIG, JSON.parse(content));
    }
  } catch (error) {
    console.warn('Warning: Could not load config, using defaults');
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Save configuration to disk
 * @param {Object} config - Configuration object
 */
export function saveConfig(config) {
  atomicWriteJson(resolveConfigFile(), config);
}

/**
 * Patch config values with a partial object (deep merge).
 * @param {Object} patch - Partial config
 * @returns {Object} Updated config
 */
export function patchConfig(patch) {
  const current = loadConfig();
  const next = deepMerge(current, patch);
  saveConfig(next);
  return next;
}

function normalizeListEntry(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function boundedUniqueAppend(list, value, limit = 500) {
  const next = Array.isArray(list) ? [...list] : [];
  if (!next.includes(value)) {
    next.push(value);
  }
  if (next.length > limit) {
    return next.slice(next.length - limit);
  }
  return next;
}

/**
 * Add a command to the skip list.
 *
 * We treat entries as "exact" strings. The hook also supports basenames and
 * compound subcommands, but the GUI action ("Don't flag") is naturally scoped
 * to the full command line.
 */
export function addSkipCommand(command) {
  const entry = normalizeListEntry(command);
  if (!entry) {
    throw new Error('Missing required field: command');
  }

  const config = loadConfig();
  const skip = config.skipCommands || DEFAULT_CONFIG.skipCommands;
  skip.additional = boundedUniqueAppend(skip.additional, entry);
  config.skipCommands = skip;
  saveConfig(config);
  return config;
}

/**
 * Add a command pattern to the custom blocklist.
 * @param {string} pattern
 */
export function addCustomBlock(pattern) {
  const entry = normalizeListEntry(pattern);
  if (!entry) {
    throw new Error('Missing required field: pattern');
  }
  const config = loadConfig();
  config.customBlocklist = boundedUniqueAppend(config.customBlocklist, entry);
  saveConfig(config);
  return config;
}

/**
 * Add a pattern to auto-approve list.
 * Matching is simple substring on normalized command in hooks.
 */
export function addAutoApprovePattern(pattern) {
  const entry = normalizeListEntry(pattern);
  if (!entry) {
    throw new Error('Missing required field: pattern');
  }
  const config = loadConfig();
  const deliberate = config.deliberate || DEFAULT_CONFIG.deliberate;
  const autoApprove = deliberate.autoApprove || { patterns: [] };
  autoApprove.patterns = boundedUniqueAppend(autoApprove.patterns, entry);
  deliberate.autoApprove = autoApprove;
  config.deliberate = deliberate;
  saveConfig(config);
  return config;
}

/**
 * Get LLM configuration for hooks
 * Returns environment-variable-friendly format
 * @returns {Object} LLM config with provider, url, key, model
 */
export function getLLMConfig() {
  const config = loadConfig();
  const llm = config.llm;

  if (!llm.provider) {
    return null;
  }

  const providerConfig = LLM_PROVIDERS[llm.provider];
  if (!providerConfig) {
    return null;
  }

  return {
    provider: llm.provider,
    baseUrl: llm.baseUrl || providerConfig.baseUrl,
    apiKey: llm.apiKey,
    model: llm.model || providerConfig.model
  };
}

/**
 * Set LLM provider configuration
 * @param {string} provider - Provider name
 * @param {Object} options - Additional options (apiKey, baseUrl, model)
 */
export function setLLMProvider(provider, options = {}) {
  const config = loadConfig();

  if (!LLM_PROVIDERS[provider]) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const providerConfig = LLM_PROVIDERS[provider];

  config.llm = {
    provider,
    apiKey: options.apiKey || null,
    baseUrl: options.baseUrl || providerConfig.baseUrl,
    model: options.model || providerConfig.model
  };

  saveConfig(config);
  return config.llm;
}

/**
 * Check if LLM is configured
 * @returns {boolean}
 */
export function isLLMConfigured() {
  const config = loadConfig();
  return !!config.llm.provider;
}

/**
 * Get the config directory path
 * @returns {string}
 */
export function getConfigDir() {
  return path.dirname(resolveConfigFile());
}

/**
 * Get the config file path
 * @returns {string}
 */
export function getConfigFile() {
  return resolveConfigFile();
}

export function getGuiConfig() {
  const config = loadConfig();
  return deepMerge(DEFAULT_CONFIG.gui, config.gui || {});
}

export default {
  loadConfig,
  saveConfig,
  patchConfig,
  addSkipCommand,
  addCustomBlock,
  addAutoApprovePattern,
  getLLMConfig,
  setLLMProvider,
  isLLMConfigured,
  getConfigDir,
  getConfigFile,
  getGuiConfig,
  LLM_PROVIDERS
};
