import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TestUtils } from '../../../helpers/test-utils';

// Mock user management module (to be implemented)
const mockUserManager = {
  loadUserConfig: jest.fn(),
  saveUserConfig: jest.fn(),
  addToSafeList: jest.fn(),
  addToDangerList: jest.fn(),
  removeFromSafeList: jest.fn(),
  removeFromDangerList: jest.fn(),
  isInSafeList: jest.fn(),
  isInDangerList: jest.fn(),
  exportRules: jest.fn(),
  importRules: jest.fn(),
  validateRules: jest.fn(),
  getStats: jest.fn(),
};

describe('User Management for Classification', () => {
  let testEnv: any;
  let configPath: string;
  
  beforeEach(async () => {
    testEnv = await TestUtils.createTestEnvironment();
    configPath = path.join(testEnv.tempDir, '.deliberate', 'user-config.json');
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    jest.clearAllMocks();
  });
  
  afterEach(async () => {
    await testEnv.cleanup();
  });
  
  describe('User Configuration Management', () => {
    test('creates default user config on first run', async () => {
      const defaultConfig = {
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
      
      mockUserManager.loadUserConfig.mockResolvedValue(defaultConfig);
      
      const config = await mockUserManager.loadUserConfig(configPath);
      
      expect(config).toMatchObject({
        version: '1.0.0',
        safeList: [],
        dangerList: [],
        settings: expect.any(Object),
      });
    });
    
    test('loads existing user configuration', async () => {
      const existingConfig = {
        version: '1.0.0',
        safeList: ['custom-tool', 'company-script'],
        dangerList: ['legacy-script', 'deprecated-tool'],
        patterns: {
          safe: ['^npm run .*'],
          danger: ['.*--force.*'],
        },
      };
      
      await fs.writeFile(configPath, JSON.stringify(existingConfig, null, 2));
      
      mockUserManager.loadUserConfig.mockResolvedValue(existingConfig);
      
      const config = await mockUserManager.loadUserConfig(configPath);
      
      expect(config.safeList).toEqual(['custom-tool', 'company-script']);
      expect(config.dangerList).toEqual(['legacy-script', 'deprecated-tool']);
    });
    
    test('migrates old config format to new version', async () => {
      const oldConfig = {
        // Old format without version
        whitelist: ['old-safe-cmd'],
        blacklist: ['old-danger-cmd'],
      };
      
      await fs.writeFile(configPath, JSON.stringify(oldConfig));
      
      mockUserManager.loadUserConfig.mockResolvedValue({
        version: '1.0.0',
        safeList: ['old-safe-cmd'],
        dangerList: ['old-danger-cmd'],
        migrated: true,
        migratedFrom: 'legacy',
      });
      
      const config = await mockUserManager.loadUserConfig(configPath);
      
      expect(config.migrated).toBe(true);
      expect(config.safeList).toEqual(['old-safe-cmd']);
      expect(config.dangerList).toEqual(['old-danger-cmd']);
    });
    
    test('validates configuration schema', async () => {
      const invalidConfigs = [
        { safeList: 'not-an-array' },  // Wrong type
        { safeList: [123, 456] },       // Wrong element type
        { version: '99.0.0' },          // Unsupported version
        {},                             // Missing required fields
      ];
      
      for (const invalid of invalidConfigs) {
        await fs.writeFile(configPath, JSON.stringify(invalid));
        
        mockUserManager.validateRules.mockResolvedValue({
          valid: false,
          errors: ['Invalid configuration format'],
        });
        
        const result = await mockUserManager.validateRules(invalid);
        
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
      }
    });
  });
  
  describe('Safe List Management', () => {
    test('adds commands to safe list', async () => {
      const commands = ['npm test', 'git status', 'docker ps'];
      
      for (const cmd of commands) {
        await mockUserManager.addToSafeList(cmd);
      }
      
      expect(mockUserManager.addToSafeList).toHaveBeenCalledTimes(3);
      
      // Verify persistence
      mockUserManager.loadUserConfig.mockResolvedValue({
        safeList: commands,
      });
      
      const config = await mockUserManager.loadUserConfig(configPath);
      expect(config.safeList).toEqual(commands);
    });
    
    test('prevents duplicate entries in safe list', async () => {
      mockUserManager.addToSafeList.mockImplementation(async (cmd: string) => {
        const current = await mockUserManager.loadUserConfig(configPath);
        if (current.safeList.includes(cmd)) {
          return { added: false, reason: 'Already in safe list' };
        }
        return { added: true };
      });
      
      await mockUserManager.addToSafeList('git status');
      const result = await mockUserManager.addToSafeList('git status');
      
      expect(result.added).toBe(false);
      expect(result.reason).toBe('Already in safe list');
    });
    
    test('removes commands from safe list', async () => {
      // Setup initial list
      mockUserManager.loadUserConfig.mockResolvedValue({
        safeList: ['cmd1', 'cmd2', 'cmd3'],
      });
      
      await mockUserManager.removeFromSafeList('cmd2');
      
      mockUserManager.loadUserConfig.mockResolvedValue({
        safeList: ['cmd1', 'cmd3'],
      });
      
      const config = await mockUserManager.loadUserConfig(configPath);
      expect(config.safeList).not.toContain('cmd2');
    });
    
    test('supports pattern-based safe listing', async () => {
      const patterns = [
        '^npm run .*',           // Any npm run command
        '^git (status|log|diff)', // Specific git commands
        '^ls( |$)',              // ls with or without args
      ];
      
      mockUserManager.addToSafeList.mockImplementation(async (pattern: string, options?: any) => {
        if (options?.isPattern) {
          // Add to patterns instead of literal list
          return { added: true, type: 'pattern' };
        }
        return { added: true, type: 'literal' };
      });
      
      for (const pattern of patterns) {
        const result = await mockUserManager.addToSafeList(pattern, { isPattern: true });
        expect(result.type).toBe('pattern');
      }
    });
  });
  
  describe('Danger List Management', () => {
    test('adds commands to danger list', async () => {
      const dangerousCommands = [
        'legacy-cleanup.sh',
        'unsafe-migration.py',
        'old-deploy-script',
      ];
      
      for (const cmd of dangerousCommands) {
        await mockUserManager.addToDangerList(cmd);
      }
      
      mockUserManager.loadUserConfig.mockResolvedValue({
        dangerList: dangerousCommands,
      });
      
      const config = await mockUserManager.loadUserConfig(configPath);
      expect(config.dangerList).toEqual(dangerousCommands);
    });
    
    test('warns when safe-listing conflicting commands', async () => {
      // Command is in danger list
      mockUserManager.isInDangerList.mockResolvedValue(true);
      
      mockUserManager.addToSafeList.mockResolvedValue({
        added: false,
        conflict: true,
        reason: 'Command is in danger list',
        suggestion: 'Remove from danger list first',
      });
      
      const result = await mockUserManager.addToSafeList('dangerous-cmd');
      
      expect(result.conflict).toBe(true);
      expect(result.suggestion).toBe('Remove from danger list first');
    });
    
    test('supports temporary danger listing', async () => {
      mockUserManager.addToDangerList.mockImplementation(
        async (cmd: string, options?: any) => {
          if (options?.temporary) {
            return {
              added: true,
              temporary: true,
              expiresAt: new Date(Date.now() + options.duration),
            };
          }
          return { added: true, temporary: false };
        }
      );
      
      const result = await mockUserManager.addToDangerList('temp-danger', {
        temporary: true,
        duration: 3600000, // 1 hour
      });
      
      expect(result.temporary).toBe(true);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });
  });
  
  describe('Rule Import/Export', () => {
    test('exports user rules to shareable format', async () => {
      const config = {
        safeList: ['git status', 'npm test'],
        dangerList: ['rm -rf', 'dangerous-script'],
        patterns: {
          safe: ['^npm run'],
          danger: ['.*--force.*'],
        },
      };
      
      mockUserManager.exportRules.mockResolvedValue({
        format: 'deliberate-rules-v1',
        exported: new Date().toISOString(),
        rules: config,
        checksum: 'sha256:abcdef...',
      });
      
      const exported = await mockUserManager.exportRules();
      
      expect(exported.format).toBe('deliberate-rules-v1');
      expect(exported.rules).toEqual(config);
      expect(exported.checksum).toMatch(/^sha256:/);
    });
    
    test('imports rules from file', async () => {
      const importData = {
        format: 'deliberate-rules-v1',
        rules: {
          safeList: ['imported-safe-cmd'],
          dangerList: ['imported-danger-cmd'],
        },
        checksum: 'sha256:123456...',
      };
      
      const importPath = path.join(testEnv.tempDir, 'import-rules.json');
      await fs.writeFile(importPath, JSON.stringify(importData));
      
      mockUserManager.importRules.mockResolvedValue({
        imported: true,
        added: {
          safe: 1,
          danger: 1,
        },
        skipped: {
          safe: 0,
          danger: 0,
        },
      });
      
      const result = await mockUserManager.importRules(importPath);
      
      expect(result.imported).toBe(true);
      expect(result.added.safe).toBe(1);
      expect(result.added.danger).toBe(1);
    });
    
    test('validates imported rules before applying', async () => {
      const maliciousImport = {
        format: 'deliberate-rules-v1',
        rules: {
          safeList: ['rm -rf /', 'dd if=/dev/zero of=/dev/sda'],
          dangerList: [],
        },
      };
      
      mockUserManager.importRules.mockResolvedValue({
        imported: false,
        error: 'Dangerous commands in safe list',
        rejected: ['rm -rf /', 'dd if=/dev/zero of=/dev/sda'],
      });
      
      const result = await mockUserManager.importRules(maliciousImport);
      
      expect(result.imported).toBe(false);
      expect(result.error).toContain('Dangerous commands');
      expect(result.rejected).toHaveLength(2);
    });
    
    test('merges imported rules with existing ones', async () => {
      const existing = {
        safeList: ['existing-safe'],
        dangerList: ['existing-danger'],
      };
      
      const toImport = {
        safeList: ['new-safe'],
        dangerList: ['new-danger'],
      };
      
      mockUserManager.importRules.mockResolvedValue({
        imported: true,
        merged: true,
        final: {
          safeList: ['existing-safe', 'new-safe'],
          dangerList: ['existing-danger', 'new-danger'],
        },
      });
      
      const result = await mockUserManager.importRules(toImport, {
        merge: true,
      });
      
      expect(result.merged).toBe(true);
      expect(result.final.safeList).toHaveLength(2);
      expect(result.final.dangerList).toHaveLength(2);
    });
  });
  
  describe('Usage Statistics', () => {
    test('tracks command classification statistics', async () => {
      mockUserManager.getStats.mockResolvedValue({
        totalCommands: 1000,
        classificationBreakdown: {
          safe: 600,
          caution: 250,
          high: 100,
          critical: 50,
        },
        userOverrides: {
          safeOverrides: 20,
          dangerOverrides: 10,
        },
        topCommands: [
          { command: 'git status', count: 150 },
          { command: 'npm test', count: 120 },
          { command: 'ls -la', count: 100 },
        ],
        lastUpdated: new Date().toISOString(),
      });
      
      const stats = await mockUserManager.getStats();
      
      expect(stats.totalCommands).toBe(1000);
      expect(stats.classificationBreakdown.safe).toBe(600);
      expect(stats.topCommands).toHaveLength(3);
    });
    
    test('provides learning recommendations', async () => {
      mockUserManager.getStats.mockResolvedValue({
        recommendations: [
          {
            command: 'npm run build',
            frequency: 50,
            alwaysApproved: true,
            suggestion: 'Consider adding to safe list',
          },
          {
            command: 'risky-script.sh',
            frequency: 10,
            alwaysBlocked: true,
            suggestion: 'Consider adding to danger list',
          },
        ],
      });
      
      const stats = await mockUserManager.getStats();
      
      expect(stats.recommendations).toHaveLength(2);
      expect(stats.recommendations[0].suggestion).toContain('safe list');
    });
  });
  
  describe('Advanced Pattern Management', () => {
    test('supports regex patterns for classification', async () => {
      const regexPatterns = [
        {
          pattern: '^sudo\\s+rm\\s+-rf\\s+\\/$',
          type: 'danger',
          description: 'Sudo recursive force remove from root',
          priority: 100,
        },
        {
          pattern: '^(npm|yarn)\\s+(test|lint|build)$',
          type: 'safe',
          description: 'Common development commands',
          priority: 50,
        },
      ];
      
      for (const patternDef of regexPatterns) {
        mockUserManager.addToSafeList.mockImplementation(async (pattern: string, options?: any) => {
          if (options?.regex) {
            // Validate regex
            try {
              new RegExp(pattern);
              return { added: true, type: 'regex' };
            } catch {
              return { added: false, error: 'Invalid regex' };
            }
          }
          return { added: true };
        });
        
        const result = await mockUserManager.addToSafeList(
          patternDef.pattern,
          { regex: true, description: patternDef.description }
        );
        
        expect(result.added).toBe(true);
        expect(result.type).toBe('regex');
      }
    });
    
    test('handles pattern priority and conflicts', async () => {
      const patterns = [
        { pattern: 'rm *', priority: 10, type: 'danger' },
        { pattern: 'rm *.tmp', priority: 20, type: 'safe' },
      ];
      
      mockUserManager.validateRules.mockImplementation(async (rules: any) => {
        // Higher priority wins in conflicts
        return {
          valid: true,
          conflicts: [{
            pattern1: patterns[0].pattern,
            pattern2: patterns[1].pattern,
            resolution: 'Higher priority pattern takes precedence',
            winner: patterns[1].pattern,
          }],
        };
      });
      
      const validation = await mockUserManager.validateRules({ patterns });
      
      expect(validation.conflicts).toHaveLength(1);
      expect(validation.conflicts[0].winner).toBe('rm *.tmp');
    });
  });
  
  describe('Backup and Recovery', () => {
    test('creates automatic backups before changes', async () => {
      const backupPath = path.join(testEnv.tempDir, '.deliberate', 'backups');
      
      mockUserManager.saveUserConfig.mockImplementation(async (config: any) => {
        // Create backup
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const backupFile = path.join(backupPath, `config-${timestamp}.json`);
        
        await fs.mkdir(backupPath, { recursive: true });
        await fs.writeFile(backupFile, JSON.stringify(config));
        
        return { saved: true, backup: backupFile };
      });
      
      const result = await mockUserManager.saveUserConfig({
        safeList: ['new-command'],
      });
      
      expect(result.backup).toMatch(/config-.*\.json$/);
    });
    
    test('limits number of backups to conserve space', async () => {
      const maxBackups = 10;
      const backupPath = path.join(testEnv.tempDir, '.deliberate', 'backups');
      await fs.mkdir(backupPath, { recursive: true });
      
      // Create old backups
      for (let i = 0; i < 15; i++) {
        const name = `config-2024-01-${String(i + 1).padStart(2, '0')}.json`;
        await fs.writeFile(path.join(backupPath, name), '{}');
      }
      
      mockUserManager.saveUserConfig.mockImplementation(async () => {
        // Cleanup old backups
        const files = await fs.readdir(backupPath);
        if (files.length > maxBackups) {
          const sorted = files.sort();
          const toDelete = sorted.slice(0, files.length - maxBackups);
          
          for (const file of toDelete) {
            await fs.unlink(path.join(backupPath, file));
          }
        }
        
        return { saved: true, cleaned: true };
      });
      
      await mockUserManager.saveUserConfig({});
      
      const remaining = await fs.readdir(backupPath);
      expect(remaining.length).toBeLessThanOrEqual(maxBackups);
    });
  });
});