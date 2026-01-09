import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import * as path from 'path';
import * as fs from 'fs/promises';
import { CommandClassifier } from '../../src/core/classification/classifier';
import { UserManager } from '../../src/core/classification/user-manager';
import { SensitiveDataRedactor } from '../../src/core/redaction/redactor';
import { TestUtils } from '../helpers/test-utils';

describe('Basic Integration Flow', () => {
  let testEnv: any;
  let classifier: CommandClassifier;
  let userManager: UserManager;
  let redactor: SensitiveDataRedactor;
  
  beforeEach(async () => {
    testEnv = await TestUtils.createTestEnvironment();
    classifier = new CommandClassifier();
    userManager = new UserManager(testEnv.tempDir);
    redactor = new SensitiveDataRedactor();
  });
  
  afterEach(async () => {
    await testEnv.cleanup();
  });
  
  describe('Command Classification', () => {
    test('classifies safe commands correctly', async () => {
      const safeCommands = ['ls', 'pwd', 'echo', 'date'];
      
      for (const cmd of safeCommands) {
        const result = await classifier.classify(cmd);
        expect(result.riskLevel).toBe('SAFE');
        expect(result.requiresApproval).toBe(false);
      }
    });
    
    test('classifies dangerous commands correctly', async () => {
      const dangerousCommands = [
        { cmd: 'rm', args: ['-rf', '/'] },
        { cmd: 'dd', args: ['if=/dev/zero', 'of=/dev/sda'] },
      ];
      
      for (const { cmd, args } of dangerousCommands) {
        const result = await classifier.classify(cmd, args);
        expect(['HIGH', 'CRITICAL']).toContain(result.riskLevel);
        expect(result.requiresApproval).toBe(true);
      }
    });
    
    test('identifies sudo commands', async () => {
      const result = await classifier.classify('sudo', ['apt', 'update']);
      expect(result.isSudo).toBe(true);
      expect(result.requiresApproval).toBe(true);
    });
  });
  
  describe('User Management', () => {
    test('manages user safe list', async () => {
      await userManager.loadUserConfig();
      
      // Add to safe list
      const addResult = await userManager.addToSafeList('mycustomtool');
      expect(addResult.added).toBe(true);
      
      // Check if in safe list
      const inList = await userManager.isInSafeList('mycustomtool');
      expect(inList).toBe(true);
      
      // Remove from safe list
      await userManager.removeFromSafeList('mycustomtool');
      const stillInList = await userManager.isInSafeList('mycustomtool');
      expect(stillInList).toBe(false);
    });
    
    test('exports and imports rules', async () => {
      await userManager.loadUserConfig();
      
      // Add some rules
      await userManager.addToSafeList('tool1');
      await userManager.addToDangerList('tool2');
      
      // Export rules
      const exported = await userManager.exportRules();
      expect(exported.rules.safeList).toContain('tool1');
      expect(exported.rules.dangerList).toContain('tool2');
      
      // Create a new UserManager instance to test import
      const newUserManager = new UserManager(testEnv.tempDir);
      
      const importResult = await newUserManager.importRules(exported);
      expect(importResult.imported).toBe(true);
      
      // Verify imported
      expect(await newUserManager.isInSafeList('tool1')).toBe(true);
      expect(await newUserManager.isInDangerList('tool2')).toBe(true);
    });
  });
  
  describe('Sensitive Data Redaction', () => {
    test('redacts API keys', async () => {
      const text = 'My OpenAI key is sk-abc123def456ghi789jkl';
      const result = await redactor.redact(text);
      
      expect(result.redacted).toBe('My OpenAI key is [REDACTED_API_KEY]');
      expect(result.sensitive).toBe(true);
      expect(result.count).toBe(1);
    });
    
    test('redacts passwords in commands', async () => {
      const command = 'mysql -u root -pmypassword123 database';
      const redacted = await redactor.redactCommand(command);
      
      expect(redacted).toBe('mysql -u root -p[REDACTED_PASSWORD] database');
    });
    
    test('redacts multiple sensitive items', async () => {
      const text = `
        API_KEY=sk-1234567890abcdef
        password=supersecret123
        ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB...
      `;
      
      const result = await redactor.redact(text);
      expect(result.count).toBeGreaterThan(2);
      expect(result.redacted).toContain('[REDACTED');
      expect(result.redacted).not.toContain('supersecret123');
      expect(result.redacted).not.toContain('sk-1234567890abcdef');
    });
    
    test('validates redaction completeness', async () => {
      const text = 'AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE';
      const result = await redactor.redact(text);
      
      expect(result.validation?.success).toBe(true);
      expect(result.validation?.originalSensitiveCount).toBe(1);
      expect(result.validation?.remainingSensitiveCount).toBe(0);
    });
  });
  
  describe('Classification with User Rules', () => {
    test('user rules override default classification', async () => {
      await userManager.loadUserConfig();
      
      // Add rm to safe list (normally dangerous)
      await userManager.addToSafeList('rm');
      
      // Reload classifier rules
      await classifier.loadUserRules(path.join(testEnv.tempDir, 'user-config.json'));
      
      // Test override
      const result = await classifier.classify('rm', ['-rf', '/tmp/test']);
      expect(result.riskLevel).toBe('SAFE');
      expect(result.source).toBe('user-defined');
    });
    
    test('danger list takes precedence over safe list', async () => {
      await userManager.loadUserConfig();
      
      // Add to both lists
      await userManager.addToSafeList('mytool');
      const dangerResult = await userManager.addToDangerList('mytool');
      
      // Should fail due to conflict
      expect(dangerResult.added).toBe(true);
      
      // Reload classifier
      await classifier.loadUserRules(path.join(testEnv.tempDir, 'user-config.json'));
      
      // Should be dangerous
      const result = await classifier.classify('mytool');
      expect(result.riskLevel).toBe('HIGH');
      expect(result.source).toBe('user-defined');
    });
  });
});