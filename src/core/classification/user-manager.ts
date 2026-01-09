import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

export interface UserConfig {
  version: string;
  safeList: string[];
  dangerList: string[];
  patterns?: {
    safe: string[];
    danger: string[];
  };
  settings?: {
    defaultAction: 'ask' | 'allow' | 'deny';
    verbosity: 'quiet' | 'normal' | 'verbose';
    learningMode: boolean;
  };
  stats?: {
    totalCommands: number;
    approvedCommands: number;
    blockedCommands: number;
    lastUpdated: string;
  };
}

export interface RuleValidation {
  valid: boolean;
  errors?: string[];
  conflicts?: any[];
}

export interface ImportResult {
  imported: boolean;
  added?: {
    safe: number;
    danger: number;
  };
  skipped?: {
    safe: number;
    danger: number;
  };
  error?: string;
  rejected?: string[];
  merged?: boolean;
  final?: {
    safeList: string[];
    dangerList: string[];
  };
}

export interface StatsResult {
  totalCommands: number;
  classificationBreakdown?: {
    safe: number;
    caution: number;
    high: number;
    critical: number;
  };
  userOverrides?: {
    safeOverrides: number;
    dangerOverrides: number;
  };
  topCommands?: Array<{
    command: string;
    count: number;
  }>;
  recommendations?: Array<{
    command: string;
    frequency: number;
    alwaysApproved?: boolean;
    alwaysBlocked?: boolean;
    suggestion: string;
  }>;
  lastUpdated?: string;
}

export class UserManager {
  private configPath: string;
  private backupDir: string;
  private config: UserConfig | null = null;
  private commandStats = new Map<string, { approved: number; blocked: number }>();

  constructor(configDir?: string) {
    const baseDir = configDir || path.join(os.homedir(), '.deliberate');
    this.configPath = path.join(baseDir, 'user-config.json');
    this.backupDir = path.join(baseDir, 'backups');
  }

  /**
   * Load user configuration
   */
  async loadUserConfig(configPath?: string): Promise<UserConfig> {
    const targetPath = configPath || this.configPath;
    
    try {
      const content = await fs.readFile(targetPath, 'utf-8');
      const config = JSON.parse(content);
      
      // Handle migration from old format
      let finalConfig = config;
      if (!config.version) {
        finalConfig = await this.migrateOldConfig(config);
      }
      
      this.config = finalConfig;
      return finalConfig;
    } catch (error) {
      // Create default config
      const defaultConfig: UserConfig = {
        version: '1.0.0',
        safeList: [],
        dangerList: [],
        patterns: {
          safe: [],
          danger: [],
        },
        settings: {
          defaultAction: 'ask',
          verbosity: 'normal',
          learningMode: true,
        },
        stats: {
          totalCommands: 0,
          approvedCommands: 0,
          blockedCommands: 0,
          lastUpdated: new Date().toISOString(),
        },
      };
      
      this.config = defaultConfig;
      await this.saveUserConfig(defaultConfig);
      return defaultConfig;
    }
  }

  /**
   * Save user configuration
   */
  async saveUserConfig(config: UserConfig): Promise<{ saved: boolean; backup?: string }> {
    // Create backup first
    const backup = await this.createBackup();
    
    // Save new config
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
    
    this.config = config;
    
    return { saved: true, backup };
  }

  /**
   * Add command to safe list
   */
  async addToSafeList(
    command: string,
    options?: { isPattern?: boolean; regex?: boolean; description?: string }
  ): Promise<any> {
    if (!this.config) {
      await this.loadUserConfig();
    }
    
    // Check if already in danger list
    if (await this.isInDangerList(command)) {
      return {
        added: false,
        conflict: true,
        reason: 'Command is in danger list',
        suggestion: 'Remove from danger list first',
      };
    }
    
    // Check if it's a pattern
    if (options?.isPattern || options?.regex) {
      if (options.regex) {
        // Validate regex
        try {
          new RegExp(command);
        } catch {
          return { added: false, error: 'Invalid regex' };
        }
      }
      
      if (!this.config!.patterns) {
        this.config!.patterns = { safe: [], danger: [] };
      }
      
      if (!this.config!.patterns.safe.includes(command)) {
        this.config!.patterns.safe.push(command);
        await this.saveUserConfig(this.config!);
        return { added: true, type: options.regex ? 'regex' : 'pattern' };
      }
      
      return { added: false, reason: 'Already in safe patterns' };
    }
    
    // Add to literal list
    if (!this.config!.safeList.includes(command)) {
      this.config!.safeList.push(command);
      await this.saveUserConfig(this.config!);
      return { added: true, type: 'literal' };
    }
    
    return { added: false, reason: 'Already in safe list' };
  }

  /**
   * Add command to danger list
   */
  async addToDangerList(
    command: string,
    options?: { temporary?: boolean; duration?: number }
  ): Promise<any> {
    if (!this.config) {
      await this.loadUserConfig();
    }
    
    if (options?.temporary) {
      // Handle temporary danger listing (would need additional state management)
      return {
        added: true,
        temporary: true,
        expiresAt: new Date(Date.now() + (options.duration || 3600000)),
      };
    }
    
    if (!this.config!.dangerList.includes(command)) {
      this.config!.dangerList.push(command);
      await this.saveUserConfig(this.config!);
      return { added: true, temporary: false };
    }
    
    return { added: false, reason: 'Already in danger list' };
  }

  /**
   * Remove from safe list
   */
  async removeFromSafeList(command: string): Promise<void> {
    if (!this.config) {
      await this.loadUserConfig();
    }
    
    const index = this.config!.safeList.indexOf(command);
    if (index > -1) {
      this.config!.safeList.splice(index, 1);
      await this.saveUserConfig(this.config!);
    }
  }

  /**
   * Remove from danger list
   */
  async removeFromDangerList(command: string): Promise<void> {
    if (!this.config) {
      await this.loadUserConfig();
    }
    
    const index = this.config!.dangerList.indexOf(command);
    if (index > -1) {
      this.config!.dangerList.splice(index, 1);
      await this.saveUserConfig(this.config!);
    }
  }

  /**
   * Check if command is in safe list
   */
  async isInSafeList(command: string): Promise<boolean> {
    if (!this.config) {
      await this.loadUserConfig();
    }
    
    return this.config!.safeList.includes(command);
  }

  /**
   * Check if command is in danger list
   */
  async isInDangerList(command: string): Promise<boolean> {
    if (!this.config) {
      await this.loadUserConfig();
    }
    
    return this.config!.dangerList.includes(command);
  }

  /**
   * Export rules to shareable format
   */
  async exportRules(): Promise<any> {
    // Always use the current in-memory config, don't reload
    if (!this.config) {
      await this.loadUserConfig();
    }
    
    const exportData = {
      format: 'deliberate-rules-v1',
      exported: new Date().toISOString(),
      rules: {
        safeList: this.config!.safeList,
        dangerList: this.config!.dangerList,
        patterns: this.config!.patterns || { safe: [], danger: [] },
      },
      checksum: '',
    };
    
    // Calculate checksum
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(exportData.rules));
    exportData.checksum = `sha256:${hash.digest('hex')}`;
    
    return exportData;
  }

  /**
   * Import rules from file or data
   */
  async importRules(
    data: any,
    options?: { merge?: boolean }
  ): Promise<ImportResult> {
    // Validate format
    if (data.format !== 'deliberate-rules-v1') {
      return {
        imported: false,
        error: 'Invalid format',
      };
    }
    
    // Validate checksum if provided
    if (data.checksum) {
      const hash = crypto.createHash('sha256');
      hash.update(JSON.stringify(data.rules));
      const expectedChecksum = `sha256:${hash.digest('hex')}`;
      
      if (data.checksum !== expectedChecksum) {
        return {
          imported: false,
          error: 'Checksum mismatch',
        };
      }
    }
    
    // Validate rules for dangerous patterns in safe list
    const dangerousInSafe = data.rules.safeList.filter((cmd: string) => 
      this.isDangerousCommand(cmd)
    );
    
    if (dangerousInSafe.length > 0) {
      return {
        imported: false,
        error: 'Dangerous commands in safe list',
        rejected: dangerousInSafe,
      };
    }
    
    if (!this.config) {
      await this.loadUserConfig();
    }
    
    if (options?.merge) {
      // Merge with existing rules
      const merged = {
        safeList: [...new Set([...this.config!.safeList, ...data.rules.safeList])],
        dangerList: [...new Set([...this.config!.dangerList, ...data.rules.dangerList])],
      };
      
      this.config!.safeList = merged.safeList;
      this.config!.dangerList = merged.dangerList;
      
      if (data.rules.patterns) {
        if (!this.config!.patterns) {
          this.config!.patterns = { safe: [], danger: [] };
        }
        this.config!.patterns.safe = [...new Set([...this.config!.patterns.safe, ...data.rules.patterns.safe])];
        this.config!.patterns.danger = [...new Set([...this.config!.patterns.danger, ...data.rules.patterns.danger])];
      }
      
      await this.saveUserConfig(this.config!);
      
      return {
        imported: true,
        merged: true,
        final: merged,
      };
    } else {
      // Replace existing rules
      this.config!.safeList = data.rules.safeList;
      this.config!.dangerList = data.rules.dangerList;
      this.config!.patterns = data.rules.patterns;
      
      await this.saveUserConfig(this.config!);
      
      return {
        imported: true,
        added: {
          safe: data.rules.safeList.length,
          danger: data.rules.dangerList.length,
        },
        skipped: {
          safe: 0,
          danger: 0,
        },
      };
    }
  }

  /**
   * Validate rules configuration
   */
  async validateRules(rules: any): Promise<RuleValidation> {
    const errors: string[] = [];
    
    // Check basic structure
    if (!Array.isArray(rules.safeList)) {
      errors.push('safeList must be an array');
    }
    
    if (!Array.isArray(rules.dangerList)) {
      errors.push('dangerList must be an array');
    }
    
    // Check for conflicts
    const conflicts = [];
    if (rules.safeList && rules.dangerList) {
      const inBoth = rules.safeList.filter((cmd: string) => 
        rules.dangerList.includes(cmd)
      );
      
      if (inBoth.length > 0) {
        conflicts.push({
          type: 'overlap',
          commands: inBoth,
          message: 'Commands appear in both safe and danger lists',
        });
      }
    }
    
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  }

  /**
   * Get usage statistics
   */
  async getStats(): Promise<StatsResult> {
    if (!this.config) {
      await this.loadUserConfig();
    }
    
    const stats: StatsResult = {
      totalCommands: this.config!.stats?.totalCommands || 0,
      lastUpdated: this.config!.stats?.lastUpdated,
    };
    
    // Add classification breakdown if available
    if (this.commandStats.size > 0) {
      const topCommands = Array.from(this.commandStats.entries())
        .map(([command, stats]) => ({
          command,
          count: stats.approved + stats.blocked,
          approved: stats.approved,
          blocked: stats.blocked,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      
      stats.topCommands = topCommands.map(({ command, count }) => ({ command, count }));
      
      // Generate recommendations
      stats.recommendations = topCommands
        .filter(cmd => cmd.count >= 5)
        .map(cmd => {
          if (cmd.approved > 0 && cmd.blocked === 0) {
            return {
              command: cmd.command,
              frequency: cmd.count,
              alwaysApproved: true,
              suggestion: 'Consider adding to safe list',
            };
          } else if (cmd.blocked > 0 && cmd.approved === 0) {
            return {
              command: cmd.command,
              frequency: cmd.count,
              alwaysBlocked: true,
              suggestion: 'Consider adding to danger list',
            };
          }
          return null;
        })
        .filter(rec => rec !== null) as any[];
    }
    
    return stats;
  }

  /**
   * Migrate old config format
   */
  private async migrateOldConfig(oldConfig: any): Promise<UserConfig> {
    return {
      version: '1.0.0',
      safeList: oldConfig.whitelist || oldConfig.safeList || [],
      dangerList: oldConfig.blacklist || oldConfig.dangerList || [],
      patterns: oldConfig.patterns,
      settings: oldConfig.settings || {
        defaultAction: 'ask',
        verbosity: 'normal',
        learningMode: true,
      },
      stats: {
        totalCommands: 0,
        approvedCommands: 0,
        blockedCommands: 0,
        lastUpdated: new Date().toISOString(),
      },
      migrated: true,
      migratedFrom: 'legacy',
    } as any;
  }

  /**
   * Create backup of current config
   */
  private async createBackup(): Promise<string> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const backupFile = path.join(this.backupDir, `config-${timestamp}.json`);
      
      if (this.config) {
        await fs.writeFile(backupFile, JSON.stringify(this.config, null, 2));
      }
      
      // Clean old backups
      await this.cleanOldBackups();
      
      return backupFile;
    } catch {
      // Backup failed, but don't block operation
      return '';
    }
  }

  /**
   * Clean old backups
   */
  private async cleanOldBackups(maxBackups: number = 10): Promise<void> {
    try {
      const files = await fs.readdir(this.backupDir);
      const backupFiles = files
        .filter(f => f.startsWith('config-') && f.endsWith('.json'))
        .sort();
      
      if (backupFiles.length > maxBackups) {
        const toDelete = backupFiles.slice(0, backupFiles.length - maxBackups);
        
        for (const file of toDelete) {
          await fs.unlink(path.join(this.backupDir, file));
        }
      }
    } catch {
      // Cleanup failed, ignore
    }
  }

  /**
   * Check if command is inherently dangerous
   */
  private isDangerousCommand(command: string): boolean {
    const dangerous = [
      'rm -rf /',
      'dd if=/dev/zero of=/dev/sda',
      'mkfs',
      'format',
      ':(){ :|:& };:',
    ];
    
    return dangerous.some(d => command.includes(d));
  }
}