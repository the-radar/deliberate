import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as path from 'path';
import { TestUtils, ExecutionResult } from '../../../helpers/test-utils';
import { CommandTestHelper } from '../../../helpers/command-helpers';

// Mock command router (to be implemented)
const mockCommandRouter = {
  route: jest.fn(),
  classify: jest.fn(),
  execute: jest.fn(),
  getContext: jest.fn(),
};

describe('Command Routing', () => {
  let testEnv: any;
  
  beforeEach(async () => {
    testEnv = await TestUtils.createTestEnvironment();
    jest.clearAllMocks();
  });
  
  afterEach(async () => {
    await testEnv.cleanup();
  });
  
  describe('Command Classification and Routing', () => {
    test('routes safe commands directly without analysis', async () => {
      const safeCommands = ['ls', 'pwd', 'echo', 'date', 'whoami'];
      
      for (const cmd of safeCommands) {
        mockCommandRouter.classify.mockReturnValue({ risk: 'SAFE', direct: true });
        
        const result = await mockCommandRouter.route(cmd, []);
        
        expect(mockCommandRouter.classify).toHaveBeenCalledWith(cmd, []);
        expect(result.routed).toBe('direct');
        expect(result.requiresAnalysis).toBe(false);
      }
    });
    
    test('routes dangerous commands to analysis pipeline', async () => {
      const dangerousCommands = [
        { cmd: 'rm', args: ['-rf', '/'] },
        { cmd: 'dd', args: ['if=/dev/zero', 'of=/dev/sda'] },
        { cmd: 'chmod', args: ['-R', '777', '/'] },
      ];
      
      for (const { cmd, args } of dangerousCommands) {
        mockCommandRouter.classify.mockReturnValue({ risk: 'DANGEROUS', direct: false });
        
        const result = await mockCommandRouter.route(cmd, args);
        
        expect(result.routed).toBe('analysis');
        expect(result.requiresAnalysis).toBe(true);
        expect(result.requiresApproval).toBe(true);
      }
    });
    
    test('handles command aliases correctly', async () => {
      const aliasMap = {
        'll': 'ls -la',
        'la': 'ls -a',
        'l': 'ls -CF',
        'grep': 'grep --color=auto',
      };
      
      for (const [alias, expanded] of Object.entries(aliasMap)) {
        mockCommandRouter.getContext.mockReturnValue({ aliases: aliasMap });
        
        const result = await mockCommandRouter.route(alias, []);
        
        expect(result.expanded).toBe(expanded);
        expect(result.originalCommand).toBe(alias);
      }
    });
    
    test('preserves command context through routing', async () => {
      const context = {
        cwd: '/home/user/project',
        user: 'testuser',
        shell: '/bin/bash',
        env: { HOME: '/home/testuser', USER: 'testuser' },
      };
      
      mockCommandRouter.getContext.mockReturnValue(context);
      
      const result = await mockCommandRouter.route('git', ['commit', '-m', 'test']);
      
      expect(result.context).toEqual(context);
      expect(mockCommandRouter.classify).toHaveBeenCalledWith('git', ['commit', '-m', 'test'], context);
    });
  });
  
  describe('Argument Handling', () => {
    test('preserves complex argument structures', async () => {
      const complexArgs = [
        {
          args: ['--file="test file.txt"', '--output=/tmp/out'],
          expected: ['--file="test file.txt"', '--output=/tmp/out'],
        },
        {
          args: ['-e', 's/foo/bar/g', '-e', 's/baz/qux/g'],
          expected: ['-e', 's/foo/bar/g', '-e', 's/baz/qux/g'],
        },
        {
          args: ['--', '-rf', '/tmp/test'],
          expected: ['--', '-rf', '/tmp/test'],
        },
        {
          args: ['\\$USER', '\\`whoami\\`', '\\$(date)'],
          expected: ['\\$USER', '\\`whoami\\`', '\\$(date)'],
        },
      ];
      
      for (const { args, expected } of complexArgs) {
        const result = await mockCommandRouter.route('test', args);
        
        expect(result.args).toEqual(expected);
        expect(result.argsIntact).toBe(true);
      }
    });
    
    test('handles glob patterns without expansion', async () => {
      const globPatterns = ['*.txt', '**/*.js', '[abc]*.log', '?.md'];
      
      for (const pattern of globPatterns) {
        const result = await mockCommandRouter.route('rm', [pattern]);
        
        // Should preserve glob patterns for analysis
        expect(result.args).toContain(pattern);
        expect(result.expandedGlobs).toBeUndefined();
      }
    });
    
    test('preserves environment variable references', async () => {
      const envVars = [
        '$HOME/.config',
        '${USER}_backup',
        '$PWD/output',
        '${CUSTOM_VAR:-default}',
      ];
      
      for (const envVar of envVars) {
        const result = await mockCommandRouter.route('cp', [envVar, '/tmp/']);
        
        expect(result.args[0]).toBe(envVar);
        expect(result.unexpandedVars).toBe(true);
      }
    });
  });
  
  describe('Shell Built-in Routing', () => {
    test('identifies shell built-ins correctly', async () => {
      const builtins = {
        'cd': { isBuiltin: true, requiresShell: true },
        'export': { isBuiltin: true, requiresShell: true },
        'alias': { isBuiltin: true, requiresShell: true },
        'source': { isBuiltin: true, requiresShell: true },
        'eval': { isBuiltin: true, requiresShell: true },
        'set': { isBuiltin: true, requiresShell: true },
        'unset': { isBuiltin: true, requiresShell: true },
        '.': { isBuiltin: true, requiresShell: true },
      };
      
      for (const [cmd, expected] of Object.entries(builtins)) {
        const result = await mockCommandRouter.route(cmd, []);
        
        expect(result.isBuiltin).toBe(expected.isBuiltin);
        expect(result.requiresShell).toBe(expected.requiresShell);
      }
    });
    
    test('routes built-ins through shell subprocess', async () => {
      mockCommandRouter.execute.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'cd') {
          // Simulate shell execution
          return { success: true, shellExecuted: true };
        }
        return { success: false };
      });
      
      const result = await mockCommandRouter.execute('cd', ['/tmp']);
      
      expect(result.shellExecuted).toBe(true);
      expect(result.success).toBe(true);
    });
    
    test('validates built-in arguments before execution', async () => {
      const builtinTests = [
        { cmd: 'cd', args: ['/etc/passwd'], valid: false }, // Not a directory
        { cmd: 'cd', args: ['/tmp'], valid: true },
        { cmd: 'export', args: ['PATH=/malicious:$PATH'], valid: false },
        { cmd: 'export', args: ['CUSTOM_VAR=value'], valid: true },
        { cmd: 'eval', args: ['rm -rf /'], valid: false },
        { cmd: 'source', args: ['/tmp/unknown.sh'], valid: false },
      ];
      
      for (const { cmd, args, valid } of builtinTests) {
        mockCommandRouter.classify.mockReturnValue({
          risk: valid ? 'SAFE' : 'DANGEROUS',
          isBuiltin: true,
        });
        
        const result = await mockCommandRouter.route(cmd, args);
        
        expect(result.validArgs).toBe(valid);
      }
    });
  });
  
  describe('Command Chains and Pipes', () => {
    test('handles command chains correctly', async () => {
      const chains = [
        'cd /tmp && rm -rf test',
        'mkdir test || exit 1',
        'ls -la; pwd; whoami',
        'true && echo "success" || echo "failure"',
      ];
      
      for (const chain of chains) {
        const result = await mockCommandRouter.route('sh', ['-c', chain]);
        
        expect(result.isChain).toBe(true);
        expect(result.chainCommands).toBeInstanceOf(Array);
        expect(result.requiresAnalysis).toBe(true);
      }
    });
    
    test('analyzes each command in a pipe separately', async () => {
      const pipe = 'cat /etc/passwd | grep root | awk -F: \'{print $1}\'';
      
      const result = await mockCommandRouter.route('sh', ['-c', pipe]);
      
      expect(result.isPipe).toBe(true);
      expect(result.pipeCommands).toHaveLength(3);
      expect(result.pipeCommands).toEqual([
        'cat /etc/passwd',
        'grep root',
        'awk -F: \'{print $1}\'',
      ]);
    });
    
    test('identifies dangerous commands in chains', async () => {
      const dangerousChains = [
        'echo "safe" && rm -rf /',
        'ls | rm -rf /',
        'true || dd if=/dev/zero of=/dev/sda',
      ];
      
      for (const chain of dangerousChains) {
        mockCommandRouter.classify.mockReturnValue({ risk: 'DANGEROUS' });
        
        const result = await mockCommandRouter.route('sh', ['-c', chain]);
        
        expect(result.containsDanger).toBe(true);
        expect(result.requiresApproval).toBe(true);
      }
    });
  });
  
  describe('Execution Context', () => {
    test('captures complete execution context', async () => {
      const mockContext = {
        cwd: process.cwd(),
        user: process.env.USER,
        uid: process.getuid?.() || 1000,
        gid: process.getgid?.() || 1000,
        groups: process.getgroups?.() || [],
        shell: process.env.SHELL || '/bin/sh',
        terminal: process.stdout.isTTY ? process.env.TERM : null,
        parentPid: process.ppid,
        timestamp: Date.now(),
      };
      
      mockCommandRouter.getContext.mockReturnValue(mockContext);
      
      const result = await mockCommandRouter.route('ls', ['-la']);
      
      expect(result.context).toMatchObject({
        cwd: expect.any(String),
        user: expect.any(String),
        shell: expect.any(String),
        timestamp: expect.any(Number),
      });
    });
    
    test('includes sudo context when present', async () => {
      const sudoEnv = {
        SUDO_USER: 'regularuser',
        SUDO_UID: '1000',
        SUDO_GID: '1000',
        SUDO_COMMAND: '/usr/bin/deliberate rm -rf /',
      };
      
      // Mock sudo environment
      Object.assign(process.env, sudoEnv);
      
      const result = await mockCommandRouter.getContext();
      
      expect(result.sudo).toEqual({
        user: 'regularuser',
        uid: 1000,
        gid: 1000,
        command: '/usr/bin/deliberate rm -rf /',
      });
      
      // Cleanup
      Object.keys(sudoEnv).forEach(key => delete process.env[key]);
    });
    
    test('tracks command nesting depth', async () => {
      // Simulate nested command execution
      process.env.DELIBERATE_DEPTH = '2';
      
      const result = await mockCommandRouter.route('bash', ['-c', 'rm -rf /']);
      
      expect(result.context.depth).toBe(3);
      expect(result.context.nested).toBe(true);
      
      delete process.env.DELIBERATE_DEPTH;
    });
  });
  
  describe('Error Handling', () => {
    test('handles missing commands gracefully', async () => {
      mockCommandRouter.route.mockRejectedValue(new Error('Command not found'));
      
      const result = await mockCommandRouter.route('nonexistentcmd', [])
        .catch((err: Error) => ({ error: err.message }));
      
      expect(result.error).toBe('Command not found');
    });
    
    test('handles routing failures with fallback', async () => {
      mockCommandRouter.classify.mockImplementation(() => {
        throw new Error('Classification failed');
      });
      
      // Should fall back to safe analysis
      const result = await mockCommandRouter.route('ls', ['-la'])
        .catch(() => ({ fallback: true, defaultAction: 'analyze' }));
      
      expect(result.fallback).toBe(true);
      expect(result.defaultAction).toBe('analyze');
    });
    
    test('preserves error context for debugging', async () => {
      const errorContext = {
        command: 'rm',
        args: ['-rf', '/'],
        stage: 'classification',
        timestamp: Date.now(),
      };
      
      mockCommandRouter.classify.mockRejectedValue(
        Object.assign(new Error('Classification error'), { context: errorContext })
      );
      
      const result = await mockCommandRouter.route('rm', ['-rf', '/'])
        .catch((err: any) => ({ error: err.message, context: err.context }));
      
      expect(result.context).toEqual(errorContext);
    });
  });
});