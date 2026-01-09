import { BuiltinHandler } from '../../../src/core/commands/builtin-handler';
import { CommandRouter } from '../../../src/core/interception/command-router';
import { EnhancedCommandInterceptor } from '../../../src/core/interception/interceptor-enhanced';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Tests for Phase 2 Built-in Command Handling
 * 
 * Verifies that shell built-in commands bypass AI analysis
 * and are handled directly for performance.
 */

describe('Phase 2 Built-in Command Tests', () => {
  let builtinHandler: BuiltinHandler;
  let router: CommandRouter;
  let tempDir: string;

  beforeAll(() => {
    builtinHandler = new BuiltinHandler();
    router = new CommandRouter();
    
    // Create temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-builtin-test-'));
    process.env.TEST_DIR = tempDir;
  });

  afterAll(() => {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.TEST_DIR;
  });

  describe('Built-in Command Detection', () => {
    test('should identify shell built-in commands', () => {
      const builtins = ['cd', 'pwd', 'export', 'unset', 'alias', 'source', '.'];
      
      builtins.forEach(cmd => {
        const result = builtinHandler.isBuiltin(cmd);
        expect(result).toBe(true);
      });
    });

    test('should not identify regular commands as built-ins', () => {
      const regular = ['ls', 'rm', 'cat', 'grep', 'curl', 'node'];
      
      regular.forEach(cmd => {
        const result = builtinHandler.isBuiltin(cmd);
        expect(result).toBe(false);
      });
    });
  });

  describe('cd Command Handling', () => {
    const originalCwd = process.cwd();

    afterEach(() => {
      process.chdir(originalCwd);
    });

    test('should handle cd to absolute path', async () => {
      const result = await builtinHandler.handle('cd', [tempDir]);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(process.cwd()).toBe(tempDir);
    });

    test('should handle cd to home directory', async () => {
      const result = await builtinHandler.handle('cd', ['~']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(process.cwd()).toBe(os.homedir());
    });

    test('should handle cd with no arguments (go to home)', async () => {
      const result = await builtinHandler.handle('cd', []);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(process.cwd()).toBe(os.homedir());
    });

    test('should handle cd to previous directory (cd -)', async () => {
      const startDir = process.cwd();
      
      // First change to temp dir
      await builtinHandler.handle('cd', [tempDir]);
      expect(process.cwd()).toBe(tempDir);
      
      // Then go back with cd -
      const result = await builtinHandler.handle('cd', ['-']);
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(process.cwd()).toBe(startDir);
    });

    test('should handle cd to non-existent directory', async () => {
      const result = await builtinHandler.handle('cd', ['/non/existent/path']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('No such file or directory');
    });

    test('should expand tilde in paths', async () => {
      const subDir = 'test-subdir';
      const fullPath = path.join(os.homedir(), subDir);
      fs.mkdirSync(fullPath, { recursive: true });
      
      try {
        const result = await builtinHandler.handle('cd', [`~/${subDir}`]);
        
        expect(result.executed).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(process.cwd()).toBe(fullPath);
      } finally {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    });
  });

  describe('pwd Command Handling', () => {
    test('should return current working directory', async () => {
      const result = await builtinHandler.handle('pwd', []);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe(process.cwd());
    });

    test('should handle pwd with arguments (ignored)', async () => {
      const result = await builtinHandler.handle('pwd', ['-L', '-P']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe(process.cwd());
    });
  });

  describe('export Command Handling', () => {
    test('should set environment variables', async () => {
      const result = await builtinHandler.handle('export', ['TEST_VAR=test_value']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(process.env.TEST_VAR).toBe('test_value');
      
      // Cleanup
      delete process.env.TEST_VAR;
    });

    test('should handle multiple variable assignments', async () => {
      const result = await builtinHandler.handle('export', [
        'VAR1=value1',
        'VAR2=value2',
        'VAR3=value3'
      ]);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(process.env.VAR1).toBe('value1');
      expect(process.env.VAR2).toBe('value2');
      expect(process.env.VAR3).toBe('value3');
      
      // Cleanup
      delete process.env.VAR1;
      delete process.env.VAR2;
      delete process.env.VAR3;
    });

    test('should handle quoted values', async () => {
      const result = await builtinHandler.handle('export', ['QUOTED="value with spaces"']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(process.env.QUOTED).toBe('value with spaces');
      
      delete process.env.QUOTED;
    });

    test('should list all exports when no arguments', async () => {
      process.env.TEST_EXPORT = 'test_value';
      
      const result = await builtinHandler.handle('export', []);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('TEST_EXPORT=test_value');
      
      delete process.env.TEST_EXPORT;
    });
  });

  describe('unset Command Handling', () => {
    test('should unset environment variables', async () => {
      process.env.TO_UNSET = 'value';
      expect(process.env.TO_UNSET).toBe('value');
      
      const result = await builtinHandler.handle('unset', ['TO_UNSET']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(process.env.TO_UNSET).toBeUndefined();
    });

    test('should handle multiple unsets', async () => {
      process.env.UNSET1 = 'value1';
      process.env.UNSET2 = 'value2';
      process.env.UNSET3 = 'value3';
      
      const result = await builtinHandler.handle('unset', ['UNSET1', 'UNSET2', 'UNSET3']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(process.env.UNSET1).toBeUndefined();
      expect(process.env.UNSET2).toBeUndefined();
      expect(process.env.UNSET3).toBeUndefined();
    });

    test('should handle unset of non-existent variable', async () => {
      const result = await builtinHandler.handle('unset', ['NON_EXISTENT_VAR']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0); // unset succeeds even if var doesn't exist
    });
  });

  describe('echo Command Handling', () => {
    test('should echo simple text', async () => {
      const result = await builtinHandler.handle('echo', ['Hello', 'World']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('Hello World');
    });

    test('should handle echo with no arguments', async () => {
      const result = await builtinHandler.handle('echo', []);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('');
    });

    test('should expand environment variables', async () => {
      process.env.ECHO_TEST = 'expanded';
      
      const result = await builtinHandler.handle('echo', ['$ECHO_TEST']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('expanded');
      
      delete process.env.ECHO_TEST;
    });

    test('should handle -n flag (no newline)', async () => {
      const result = await builtinHandler.handle('echo', ['-n', 'no newline']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('no newline');
      expect(result.flags?.noNewline).toBe(true);
    });
  });

  describe('test Command Handling', () => {
    test('should handle file existence test', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'test');
      
      // File exists
      let result = await builtinHandler.handle('test', ['-f', testFile]);
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      
      // File doesn't exist
      result = await builtinHandler.handle('test', ['-f', '/non/existent']);
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(1);
    });

    test('should handle directory test', async () => {
      // Directory exists
      let result = await builtinHandler.handle('test', ['-d', tempDir]);
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      
      // Not a directory
      const file = path.join(tempDir, 'file.txt');
      fs.writeFileSync(file, 'test');
      result = await builtinHandler.handle('test', ['-d', file]);
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(1);
    });

    test('should handle string equality test', async () => {
      // Equal strings
      let result = await builtinHandler.handle('test', ['hello', '=', 'hello']);
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      
      // Not equal
      result = await builtinHandler.handle('test', ['hello', '=', 'world']);
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(1);
    });

    test('should handle numeric comparisons', async () => {
      // Equal
      let result = await builtinHandler.handle('test', ['5', '-eq', '5']);
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      
      // Less than
      result = await builtinHandler.handle('test', ['3', '-lt', '5']);
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      
      // Greater than (false)
      result = await builtinHandler.handle('test', ['3', '-gt', '5']);
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('Command Router Integration', () => {
    test('should route built-in commands directly', async () => {
      const builtins = [
        { cmd: 'cd', args: ['/tmp'] },
        { cmd: 'pwd', args: [] },
        { cmd: 'export', args: ['VAR=value'] },
        { cmd: 'echo', args: ['test'] }
      ];

      for (const { cmd, args } of builtins) {
        const routing = await router.route(cmd, args, {} as any);
        expect(routing.direct).toBe(true);
        expect(routing.reason).toContain('built-in');
      }
    });

    test('should not route dangerous commands as built-ins', async () => {
      const dangerous = [
        { cmd: 'rm', args: ['-rf'] },
        { cmd: 'chmod', args: ['777'] },
        { cmd: 'kill', args: ['-9'] }
      ];

      for (const { cmd, args } of dangerous) {
        const routing = await router.route(cmd, args, {} as any);
        expect(routing.direct).toBe(false);
      }
    });
  });

  describe('Performance', () => {
    test('built-in commands should execute within 5ms', async () => {
      const commands = [
        { cmd: 'pwd', args: [] },
        { cmd: 'echo', args: ['test'] },
        { cmd: 'export', args: ['PERF_TEST=value'] },
        { cmd: 'test', args: ['-f', __filename] }
      ];

      for (const { cmd, args } of commands) {
        const start = process.hrtime.bigint();
        await builtinHandler.handle(cmd, args);
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1_000_000;
        
        expect(durationMs).toBeLessThan(5);
      }
      
      // Cleanup
      delete process.env.PERF_TEST;
    });

    test('should bypass AI analysis completely', async () => {
      const interceptor = new EnhancedCommandInterceptor();
      
      // Mock AI components to track if they're called
      const aiMock = jest.fn();
      (interceptor as any).analysisOrchestrator = {
        analyzeCommand: aiMock
      };
      
      // Initialize the interceptor
      await interceptor.initialize();
      
      // Execute built-in command
      const result = await interceptor.intercept('echo', ['test']);
      
      // AI should not have been called
      expect(aiMock).not.toHaveBeenCalled();
      expect(result.executed).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed export commands', async () => {
      const result = await builtinHandler.handle('export', ['INVALID SYNTAX']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Invalid export syntax');
    });

    test('should handle invalid test syntax', async () => {
      const result = await builtinHandler.handle('test', ['-invalid']);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(2); // test returns 2 for syntax errors
      expect(result.error).toContain('Invalid test syntax');
    });

    test('should handle cd to file (not directory)', async () => {
      const file = path.join(tempDir, 'notadir.txt');
      fs.writeFileSync(file, 'content');
      
      const result = await builtinHandler.handle('cd', [file]);
      
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Not a directory');
    });
  });
});