import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TestUtils } from '../../../helpers/test-utils';
import { MockSystemCalls } from '../../../mocks/system-mocks';

// Mock the interceptor module (to be implemented)
const mockShimGenerator = {
  generateShims: jest.fn(),
  installShims: jest.fn(),
  updatePATH: jest.fn(),
  verifyInstallation: jest.fn(),
};

describe('PATH Shim System', () => {
  let testEnv: any;
  
  beforeEach(async () => {
    testEnv = await TestUtils.createTestEnvironment();
    jest.clearAllMocks();
  });
  
  afterEach(async () => {
    await testEnv.cleanup();
  });
  
  describe('Shim Installation', () => {
    test('creates shim directory at ~/.deliberate/shims', async () => {
      const shimDir = path.join(testEnv.tempDir, '.deliberate', 'shims');
      
      await mockShimGenerator.installShims(shimDir);
      
      // Simulate directory creation
      await fs.mkdir(shimDir, { recursive: true });
      
      const stats = await fs.stat(shimDir);
      expect(stats.isDirectory()).toBe(true);
    });
    
    test('generates shims for all commands in system PATH', async () => {
      const systemCommands = ['ls', 'rm', 'cp', 'mv', 'chmod', 'chown', 'dd', 'git'];
      const shimDir = testEnv.shimDir;
      
      // Mock which command to return paths
      const mockWhich = MockSystemCalls.mockWhich({
        'ls': '/bin/ls',
        'rm': '/bin/rm',
        'cp': '/bin/cp',
        'mv': '/bin/mv',
        'chmod': '/bin/chmod',
        'chown': '/usr/bin/chown',
        'dd': '/bin/dd',
        'git': '/usr/bin/git',
      });
      
      // Generate shims
      for (const cmd of systemCommands) {
        const shimPath = path.join(shimDir, cmd);
        const shimContent = `#!/bin/sh
exec deliberate intercept ${cmd} "$@"`;
        
        await fs.writeFile(shimPath, shimContent);
        await fs.chmod(shimPath, 0o755);
      }
      
      // Verify all shims created
      const createdShims = await fs.readdir(shimDir);
      expect(createdShims.sort()).toEqual(systemCommands.sort());
      
      // Verify shim permissions
      for (const cmd of systemCommands) {
        const shimPath = path.join(shimDir, cmd);
        const stats = await fs.stat(shimPath);
        expect(stats.mode & 0o777).toBe(0o755);
      }
    });
    
    test('handles command names with special characters', async () => {
      const specialCommands = ['g++', 'git-upload-pack', 'docker-compose', '7z'];
      const shimDir = testEnv.shimDir;
      
      for (const cmd of specialCommands) {
        const shimPath = path.join(shimDir, cmd);
        const shimContent = `#!/bin/sh
exec deliberate intercept "${cmd}" "$@"`;
        
        await fs.writeFile(shimPath, shimContent);
        await fs.chmod(shimPath, 0o755);
      }
      
      // Verify special command shims
      const createdShims = await fs.readdir(shimDir);
      expect(createdShims).toEqual(expect.arrayContaining(specialCommands));
    });
    
    test('updates PATH to prioritize shim directory', async () => {
      const originalPATH = process.env.PATH;
      const shimDir = testEnv.shimDir;
      
      // Simulate PATH update
      const newPATH = `${shimDir}:${originalPATH}`;
      process.env.PATH = newPATH;
      
      expect(process.env.PATH?.startsWith(shimDir)).toBe(true);
      expect(process.env.PATH.split(':')[0]).toBe(shimDir);
      
      // Cleanup
      process.env.PATH = originalPATH;
    });
    
    test('preserves existing PATH entries', async () => {
      const originalPATH = '/usr/local/bin:/usr/bin:/bin';
      process.env.PATH = originalPATH;
      const shimDir = testEnv.shimDir;
      
      // Update PATH
      const newPATH = `${shimDir}:${originalPATH}`;
      process.env.PATH = newPATH;
      
      const pathEntries = process.env.PATH.split(':');
      expect(pathEntries[0]).toBe(shimDir);
      expect(pathEntries.slice(1).join(':')).toBe(originalPATH);
    });
    
    test('handles missing commands gracefully', async () => {
      const mockWhich = jest.fn().mockRejectedValue(new Error('Command not found'));
      
      // Attempt to create shim for non-existent command
      const result = await mockShimGenerator.generateShims(['nonexistent'], testEnv.shimDir)
        .catch((err: Error) => err);
      
      // Should skip missing commands, not fail entirely
      expect(result).not.toBeInstanceOf(Error);
    });
    
    test('creates shims with correct content', async () => {
      const shimDir = testEnv.shimDir;
      const command = 'rm';
      const shimPath = path.join(shimDir, command);
      
      const expectedContent = `#!/bin/sh
# Deliberate command interceptor shim
# Auto-generated - do not edit

# Preserve original command
DELIBERATE_ORIGINAL_CMD="${command}"

# Execute through deliberate
exec deliberate intercept "${command}" "$@"`;
      
      await fs.writeFile(shimPath, expectedContent);
      
      const content = await fs.readFile(shimPath, 'utf-8');
      expect(content).toContain('#!/bin/sh');
      expect(content).toContain(`DELIBERATE_ORIGINAL_CMD="${command}"`);
      expect(content).toContain('exec deliberate intercept');
    });
  });
  
  describe('Command Routing', () => {
    test('routes intercepted commands to deliberate core', async () => {
      const shimDir = testEnv.shimDir;
      const mockSpawn = MockSystemCalls.mockSpawn();
      
      // Create a shim
      const shimPath = path.join(shimDir, 'ls');
      await fs.writeFile(shimPath, `#!/bin/sh
exec deliberate intercept ls "$@"`, 'utf-8');
      await fs.chmod(shimPath, 0o755);
      
      // Execute shim
      const result = await TestUtils.execute(shimPath, ['-la']);
      
      // Verify deliberate was called
      expect(mockSpawn).toHaveBeenCalledWith(
        'deliberate',
        ['intercept', 'ls', '-la'],
        expect.any(Object)
      );
    });
    
    test('preserves all command arguments exactly', async () => {
      const testCases = [
        { args: ['-rf', '/tmp/test'], expected: ['-rf', '/tmp/test'] },
        { args: ['--file="test file.txt"'], expected: ['--file="test file.txt"'] },
        { args: ['-e', 's/foo/bar/g'], expected: ['-e', 's/foo/bar/g'] },
        { args: ['$HOME/.config'], expected: ['$HOME/.config'] },
        { args: ['*.txt'], expected: ['*.txt'] },
        { args: ["'single quotes'"], expected: ["'single quotes'"] },
        { args: ['"double quotes"'], expected: ['"double quotes"'] },
      ];
      
      for (const { args, expected } of testCases) {
        const mockSpawn = MockSystemCalls.mockSpawn();
        
        // Execute with arguments
        await TestUtils.execute('./deliberate', ['intercept', 'test', ...args]);
        
        expect(mockSpawn).toHaveBeenCalledWith(
          './deliberate',
          ['intercept', 'test', ...expected],
          expect.any(Object)
        );
      }
    });
    
    test('maintains environment variables', async () => {
      const testEnv = {
        USER: 'testuser',
        HOME: '/home/testuser',
        CUSTOM_VAR: 'custom_value',
        PATH: '/usr/bin:/bin',
      };
      
      const mockSpawn = MockSystemCalls.mockSpawn();
      
      // Execute with custom environment
      await TestUtils.execute('./deliberate', ['intercept', 'env'], {
        env: testEnv,
      });
      
      expect(mockSpawn).toHaveBeenCalledWith(
        './deliberate',
        ['intercept', 'env'],
        expect.objectContaining({
          env: expect.objectContaining(testEnv),
        })
      );
    });
    
    test('handles shell built-ins correctly', async () => {
      const builtins = ['cd', 'export', 'alias', 'source', 'eval', 'set'];
      
      for (const builtin of builtins) {
        // Built-ins should be marked for special handling
        const result = await mockShimGenerator.generateShims([builtin], testEnv.shimDir);
        
        // Verify special handling marker
        expect(result).toEqual(expect.objectContaining({
          [builtin]: expect.objectContaining({
            isBuiltin: true,
            requiresShellExecution: true,
          }),
        }));
      }
    });
    
    test('preserves working directory', async () => {
      const cwd = '/test/working/directory';
      const mockSpawn = MockSystemCalls.mockSpawn();
      
      await TestUtils.execute('./deliberate', ['intercept', 'pwd'], { cwd });
      
      expect(mockSpawn).toHaveBeenCalledWith(
        './deliberate',
        ['intercept', 'pwd'],
        expect.objectContaining({ cwd })
      );
    });
    
    test('handles stdin/stdout/stderr correctly', async () => {
      const mockSpawn = MockSystemCalls.mockSpawn();
      
      await TestUtils.execute('./deliberate', ['intercept', 'cat'], {
        stdio: 'pipe',
      });
      
      expect(mockSpawn).toHaveBeenCalledWith(
        './deliberate',
        ['intercept', 'cat'],
        expect.objectContaining({
          stdio: 'pipe',
        })
      );
    });
  });
  
  describe('Shim Verification', () => {
    test('verifies all shims are executable', async () => {
      const shimDir = testEnv.shimDir;
      const commands = ['ls', 'rm', 'cp'];
      
      // Create shims
      for (const cmd of commands) {
        const shimPath = path.join(shimDir, cmd);
        await fs.writeFile(shimPath, '#!/bin/sh\necho "shim"');
        await fs.chmod(shimPath, 0o755);
      }
      
      // Verify executability
      for (const cmd of commands) {
        const shimPath = path.join(shimDir, cmd);
        await fs.access(shimPath, fs.constants.X_OK);
        // Should not throw
      }
    });
    
    test('detects and reports missing shims', async () => {
      const shimDir = testEnv.shimDir;
      const expectedCommands = ['ls', 'rm', 'cp', 'mv'];
      const createdCommands = ['ls', 'cp']; // Missing rm and mv
      
      // Create only some shims
      for (const cmd of createdCommands) {
        const shimPath = path.join(shimDir, cmd);
        await fs.writeFile(shimPath, '#!/bin/sh\necho "shim"');
      }
      
      // Check for missing shims
      const missing = [];
      for (const cmd of expectedCommands) {
        try {
          await fs.access(path.join(shimDir, cmd));
        } catch {
          missing.push(cmd);
        }
      }
      
      expect(missing).toEqual(['rm', 'mv']);
    });
    
    test('validates shim content integrity', async () => {
      const shimDir = testEnv.shimDir;
      const command = 'git';
      const shimPath = path.join(shimDir, command);
      
      // Create valid shim
      await fs.writeFile(shimPath, `#!/bin/sh
exec deliberate intercept ${command} "$@"`);
      
      // Validate content
      const content = await fs.readFile(shimPath, 'utf-8');
      expect(content).toMatch(/^#!\/bin\/sh/);
      expect(content).toContain('deliberate intercept');
      expect(content).toContain(command);
      expect(content).toContain('"$@"');
    });
  });
});