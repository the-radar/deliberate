/**
 * Configuration management for Deliberate Claude Code
 * Stores user preferences in ~/.deliberate/config.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Cross-platform home directory
const HOME_DIR = os.homedir();
const DELIBERATE_DIR = path.join(HOME_DIR, '.deliberate');
const CONFIG_FILE = path.join(DELIBERATE_DIR, 'config.json');

// Default configuration
const DEFAULT_CONFIG = {
  llm: {
    provider: null,  // 'claude-subscription', 'anthropic', 'ollama', or null
    apiKey: null,    // For 'anthropic' provider
    baseUrl: null,   // Custom URL (e.g., Ollama endpoint)
    model: null      // Model to use
  },
  classifier: {
    serverPort: 8765,
    enabled: true
  },
  blocking: {
    enabled: false,  // When true, auto-block high-confidence DANGEROUS operations
    confidenceThreshold: 0.85  // Block if DANGEROUS + confidence > this threshold
  },
  deduplication: {
    enabled: true  // When true, don't show same warning twice per session
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
  if (!fs.existsSync(DELIBERATE_DIR)) {
    fs.mkdirSync(DELIBERATE_DIR, { recursive: true });
  }
}

/**
 * Load configuration from disk
 * @returns {Object} Configuration object
 */
export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
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
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
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
  return DELIBERATE_DIR;
}

/**
 * Get the config file path
 * @returns {string}
 */
export function getConfigFile() {
  return CONFIG_FILE;
}

/**
 * Get blocking configuration
 * @returns {Object} { enabled: boolean, confidenceThreshold: number }
 */
export function getBlockingConfig() {
  const config = loadConfig();
  return config.blocking || DEFAULT_CONFIG.blocking;
}

/**
 * Set blocking configuration
 * @param {boolean} enabled - Whether auto-blocking is enabled
 * @param {number} confidenceThreshold - Threshold for auto-blocking (0-1)
 */
export function setBlockingConfig(enabled, confidenceThreshold = 0.85) {
  const config = loadConfig();
  config.blocking = {
    enabled: !!enabled,
    confidenceThreshold: Math.max(0, Math.min(1, confidenceThreshold))
  };
  saveConfig(config);
  return config.blocking;
}

export default {
  loadConfig,
  saveConfig,
  getLLMConfig,
  setLLMProvider,
  isLLMConfigured,
  getConfigDir,
  getConfigFile,
  getBlockingConfig,
  setBlockingConfig,
  LLM_PROVIDERS
};
