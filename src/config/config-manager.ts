import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { z } from 'zod';
import { Logger } from '../utils/logger';

// Configuration schema with Zod validation
const ConfigSchema = z.object({
  version: z.string(),
  security: z.object({
    enforcement_level: z.enum(['strict', 'moderate', 'permissive']),
    bypass_prevention: z.boolean().default(true),
    require_tty: z.boolean().default(true),
    audit_logging: z.boolean().default(true),
    command_integrity: z.boolean().default(true)
  }),
  performance: z.object({
    enable_fast_path: z.boolean().default(true),
    cache_size: z.number().default(10000),
    cache_ttl_minutes: z.number().default(60),
    parallel_analysis: z.boolean().default(true),
    model_timeout_ms: z.number().default(5000)
  }),
  ai: z.object({
    enable_llm_analysis: z.boolean().default(true),
    models: z.object({
      primary: z.string().default('qwen2:1.5b-instruct-q4_0'),
      secondary: z.string().default('smollm2:1.7b-instruct-q4_0'),
      decision: z.string().default('deepseek-r1:1.5b-distill-q4_0')
    }),
    confidence_threshold: z.number().default(0.7),
    auth_code_expiry_minutes: z.number().default(5)
  }),
  patterns: z.object({
    custom_dangerous: z.array(z.string()).default([]),
    custom_safe: z.array(z.string()).default([]),
    whitelist_commands: z.array(z.string()).default([]),
    blacklist_commands: z.array(z.string()).default([])
  }),
  notifications: z.object({
    webhook_url: z.string().optional(),
    email_alerts: z.string().optional(),
    alert_on_dangerous: z.boolean().default(true),
    alert_on_bypass_attempt: z.boolean().default(true)
  }),
  learning: z.object({
    enable_continuous_learning: z.boolean().default(true),
    data_collection: z.boolean().default(true),
    federated_learning: z.boolean().default(false),
    privacy_level: z.enum(['high', 'medium', 'low']).default('high')
  })
});

type Config = z.infer<typeof ConfigSchema>;

export class ConfigManager {
  private static instance: ConfigManager;
  private config: Config;
  private userConfigPath: string;
  private systemConfigPath: string;
  private logger: Logger;
  private watchers: Map<string, fs.FSWatcher> = new Map();
  
  private constructor() {
    this.logger = new Logger('config-manager');
    this.userConfigPath = path.join(os.homedir(), '.deliberate', 'config.yaml');
    this.systemConfigPath = '/etc/deliberate/config.yaml';
    
    this.config = this.getDefaultConfig();
    this.loadConfig();
    this.watchConfigFiles();
  }
  
  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }
  
  /**
   * Load configuration from files
   */
  private loadConfig(): void {
    try {
      // Load in priority order: user -> system -> defaults
      const configs = [
        this.loadConfigFile(this.userConfigPath),
        this.loadConfigFile(this.systemConfigPath),
        this.getDefaultConfig()
      ];
      
      // Merge configurations
      this.config = this.mergeConfigs(configs);
      
      // Validate
      this.config = ConfigSchema.parse(this.config);
      
      this.logger.info('Configuration loaded successfully');
    } catch (error) {
      this.logger.error('Invalid configuration:', error);
      this.config = this.getDefaultConfig();
    }
  }
  
  /**
   * Load configuration from YAML file
   */
  private loadConfigFile(filePath: string): Partial<Config> | null {
    try {
      // Check if it's YAML or JSON
      const content = fs.readFileSync(filePath, 'utf-8');
      
      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        // For YAML, we'll use a simple parser
        return this.parseYAML(content);
      } else {
        // Assume JSON
        return JSON.parse(content);
      }
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        this.logger.warn(`Failed to load config from ${filePath}:`, error);
      }
      return null;
    }
  }
  
  /**
   * Simple YAML parser (basic implementation)
   */
  private parseYAML(content: string): any {
    // Use js-yaml for proper YAML parsing
    const yaml = require('js-yaml');
    try {
      return yaml.load(content);
    } catch (error) {
      this.logger.error('YAML parse error:', error);
      return {};
    }
  }
  
  
  /**
   * Merge multiple configurations
   */
  private mergeConfigs(configs: Array<Partial<Config> | null>): Config {
    const merged = {} as any;
    
    for (const config of configs.reverse()) {
      if (config) {
        this.deepMerge(merged, config);
      }
    }
    
    return merged;
  }
  
  /**
   * Deep merge objects
   */
  private deepMerge(target: any, source: any): void {
    for (const key in source) {
      if (source[key] instanceof Object && key in target && !Array.isArray(source[key])) {
        this.deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
  
  /**
   * Get default configuration
   */
  private getDefaultConfig(): Config {
    return {
      version: '1.0.0',
      security: {
        enforcement_level: 'strict',
        bypass_prevention: true,
        require_tty: true,
        audit_logging: true,
        command_integrity: true
      },
      performance: {
        enable_fast_path: true,
        cache_size: 10000,
        cache_ttl_minutes: 60,
        parallel_analysis: true,
        model_timeout_ms: 5000
      },
      ai: {
        enable_llm_analysis: true,
        models: {
          primary: 'qwen2:1.5b-instruct-q4_0',
          secondary: 'smollm2:1.7b-instruct-q4_0',
          decision: 'deepseek-r1:1.5b-distill-q4_0'
        },
        confidence_threshold: 0.7,
        auth_code_expiry_minutes: 5
      },
      patterns: {
        custom_dangerous: [],
        custom_safe: [],
        whitelist_commands: [],
        blacklist_commands: []
      },
      notifications: {
        alert_on_dangerous: true,
        alert_on_bypass_attempt: true
      },
      learning: {
        enable_continuous_learning: true,
        data_collection: true,
        federated_learning: false,
        privacy_level: 'high'
      }
    };
  }
  
  /**
   * Watch configuration files for changes
   */
  private watchConfigFiles(): void {
    const files = [this.userConfigPath, this.systemConfigPath];
    
    for (const file of files) {
      try {
        if (fs.existsSync(file)) {
          const watcher = fs.watch(file, (eventType) => {
            if (eventType === 'change') {
              this.logger.info(`Configuration file changed: ${file}`);
              this.loadConfig();
              this.emit('config-changed', this.config);
            }
          });
          
          this.watchers.set(file, watcher);
        }
      } catch (error) {
        this.logger.warn(`Unable to watch config file ${file}:`, error);
      }
    }
  }
  
  /**
   * Event emitter functionality
   */
  private listeners: Map<string, Function[]> = new Map();
  
  on(event: string, listener: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }
  
  private emit(event: string, ...args: any[]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        listener(...args);
      }
    }
  }
  
  /**
   * Get configuration value
   */
  get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key];
  }
  
  /**
   * Get nested configuration value
   */
  getPath(path: string): any {
    const parts = path.split('.');
    let current: any = this.config;
    
    for (const part of parts) {
      if (current && typeof current === 'object' && part && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }
    
    return current;
  }
  
  /**
   * Set configuration value
   */
  async set<K extends keyof Config>(key: K, value: Config[K]): Promise<void> {
    this.config[key] = value;
    await this.saveConfig();
  }
  
  /**
   * Set nested configuration value
   */
  async setPath(path: string, value: any): Promise<void> {
    const parts = path.split('.');
    let current: any = this.config;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part && (!(part in current) || typeof current[part] !== 'object')) {
        current[part] = {};
      }
      if (part) {
        current = current[part];
      }
    }
    
    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      current[lastPart] = value;
    }
    await this.saveConfig();
  }
  
  /**
   * Save configuration to file
   */
  private async saveConfig(): Promise<void> {
    const dir = path.dirname(this.userConfigPath);
    await fs.promises.mkdir(dir, { recursive: true });
    
    // Convert to YAML format
    const yamlContent = this.toYAML(this.config);
    
    await fs.promises.writeFile(this.userConfigPath, yamlContent, 'utf-8');
    this.logger.info('Configuration saved');
  }
  
  /**
   * Convert object to YAML format
   */
  private toYAML(obj: any): string {
    // Use js-yaml for proper YAML serialization
    const yaml = require('js-yaml');
    try {
      return yaml.dump(obj);
    } catch (error) {
      this.logger.error('YAML serialize error:', error);
      return '';
    }
  }
  
  /**
   * Apply policy file
   */
  async applyPolicyFile(policyPath: string): Promise<void> {
    const policy = this.loadConfigFile(policyPath);
    if (policy) {
      this.deepMerge(this.config, policy);
      await this.saveConfig();
      this.logger.info(`Applied policy from ${policyPath}`);
    }
  }
  
  /**
   * Export configuration
   */
  exportConfig(): Config {
    return JSON.parse(JSON.stringify(this.config));
  }
  
  /**
   * Validate configuration
   */
  validateConfig(config: any): boolean {
    try {
      ConfigSchema.parse(config);
      return true;
    } catch (error) {
      this.logger.error('Configuration validation failed:', error);
      return false;
    }
  }
  
  /**
   * Cleanup
   */
  destroy(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.listeners.clear();
  }
}