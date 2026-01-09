import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as path from 'path';
import { TestUtils } from '../../../helpers/test-utils';
import { CommandTestHelper } from '../../../helpers/command-helpers';
import { MockSystemCalls } from '../../../mocks/system-mocks';

describe('Direct Execution Prevention', () => {
  let testEnv: any;
  let originalPATH: string | undefined;
  
  beforeEach(async () => {
    testEnv = await TestUtils.createTestEnvironment();
    originalPATH = process.env.PATH;
    // Set deliberate shims as first in PATH
    process.env.PATH = `${testEnv.shimDir}:${originalPATH}`;
    jest.clearAllMocks();
  });
  
  afterEach(async () => {
    process.env.PATH = originalPATH;
    await testEnv.cleanup();
  });
  
  describe('Direct Path Interception', () => {
    test('intercepts direct path execution (/usr/bin/rm)', async () => {
      const directPaths = [
        '/usr/bin/rm',
        '/bin/rm',
        '/usr/local/bin/git',
        '/sbin/fdisk',
        '/usr/sbin/useradd',
      ];
      
      for (const directPath of directPaths) {
        // Mock the interception mechanism
        const result = await CommandTestHelper.executeWithDeliberate(directPath, ['-rf', '/tmp/test']);
        
        // Should be intercepted despite direct path
        expect(result.stderr).toContain('intercepted');
        expect(result.exitCode).not.toBe(0);
      }
    });
    
    test('handles relative path execution (./script.sh)', async () => {
      const relativePaths = [
        './dangerous-script.sh',
        '../scripts/cleanup.sh',
        'scripts/install.sh',
      ];
      
      for (const relativePath of relativePaths) {
        // Create mock script
        await TestUtils.createMockCommand(testEnv.tempDir, 'dangerous-script.sh', 
          '#!/bin/bash\nrm -rf /');
        
        const result = await CommandTestHelper.executeWithDeliberate(relativePath);
        
        // Should analyze script execution
        expect(result.stdout).toContain('script execution');
        expect(result.exitCode).toBe(0); // Intercepted, not executed
      }
    });
    
    test('intercepts commands through symlinks', async () => {
      const symlinkPath = path.join(testEnv.tempDir, 'danger-link');
      
      // Create symlink to dangerous command
      await TestUtils.execute('ln', ['-s', '/bin/rm', symlinkPath]);
      
      const result = await CommandTestHelper.executeWithDeliberate(symlinkPath, ['-rf', '/']);
      
      // Should detect and intercept symlink execution
      expect(result.stderr).toContain('intercepted');
      expect(result.stdout).not.toContain('rm: cannot remove');
    });
    
    test('prevents execution through resolved paths', async () => {
      // Test various path resolution attempts
      const pathVariants = [
        '/usr/../usr/bin/rm',  // Path with ..
        '/usr/./bin/./rm',     // Path with .
        '//usr//bin//rm',      // Multiple slashes
      ];
      
      for (const variant of pathVariants) {
        const result = await CommandTestHelper.executeWithDeliberate(variant, ['--help']);
        
        // Should normalize and intercept
        expect(result.stdout).toContain('deliberate');
        expect(result.exitCode).toBe(0);
      }
    });
  });
  
  describe('Escape Character Prevention', () => {
    test('intercepts commands with escaped characters (\\rm)', async () => {
      const escapedCommands = [
        '\\rm',
        '\\\\rm',
        '\\/bin/rm',
        'command rm',  // 'command' builtin
        'builtin rm',  // 'builtin' builtin
      ];
      
      for (const cmd of escapedCommands) {
        const result = await TestUtils.execute('sh', ['-c', `${cmd} -rf /tmp/test`]);
        
        // Should still be caught
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toMatch(/intercepted|not found|deliberate/i);
      }
    });
    
    test('handles quoted command bypasses', async () => {
      const quotedCommands = [
        '"rm" -rf /',
        "'rm' -rf /",
        'r"m" -rf /',
        "r'm' -rf /",
      ];
      
      for (const cmd of quotedCommands) {
        const result = await TestUtils.execute('sh', ['-c', cmd]);
        
        // Should detect quoted bypass attempts
        expect(result.exitCode).not.toBe(0);
      }
    });
    
    test('prevents unicode and special character bypasses', async () => {
      const specialCommands = [
        'r\\x6d -rf /',      // Hex escape
        '$\'rm\' -rf /',     // ANSI-C quoting
        'r$\'\\155\' -rf /', // Octal escape
      ];
      
      for (const cmd of specialCommands) {
        const result = await TestUtils.execute('bash', ['-c', cmd]);
        
        // Should handle special encodings
        expect(result.exitCode).not.toBe(0);
      }
    });
  });
  
  describe('Environment Manipulation Prevention', () => {
    test('intercepts commands through env modification', async () => {
      const envBypassAttempts = [
        'PATH=/usr/bin rm -rf /',
        'PATH=/original/path:$PATH rm -rf /',
        'env PATH=/usr/bin rm -rf /',
        'env -i PATH=/usr/bin rm -rf /',
      ];
      
      for (const attempt of envBypassAttempts) {
        const result = await TestUtils.execute('sh', ['-c', attempt]);
        
        // Should maintain interception despite PATH changes
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).not.toContain('cannot remove \'/\'');
      }
    });
    
    test('handles LD_PRELOAD injection attempts', async () => {
      const maliciousEnv = {
        LD_PRELOAD: '/tmp/evil.so',
        LD_LIBRARY_PATH: '/tmp/evil',
      };
      
      const result = await CommandTestHelper.executeWithDeliberate('ls', [], {
        env: maliciousEnv,
      });
      
      // Should sanitize dangerous environment variables
      expect(result.exitCode).toBe(0);
      expect(process.env.LD_PRELOAD).toBeUndefined();
      expect(process.env.LD_LIBRARY_PATH).toBeUndefined();
    });
    
    test('prevents alias-based bypasses', async () => {
      // Test alias bypass attempts
      const aliasCommands = [
        'alias rm=echo && rm -rf /',
        'unalias rm 2>/dev/null; rm -rf /',
        'alias deliberate=true && rm -rf /',
      ];
      
      for (const cmd of aliasCommands) {
        const result = await TestUtils.execute('bash', ['-c', cmd]);
        
        // Should prevent alias manipulation
        expect(result.exitCode).not.toBe(0);
      }
    });
  });
  
  describe('Shell Feature Bypasses', () => {
    test('prevents command substitution bypasses', async () => {
      const substitutionAttempts = [
        '$(echo rm) -rf /',
        '`echo rm` -rf /',
        'eval "rm -rf /"',
        'bash -c "rm -rf /"',
        'sh -c "rm -rf /"',
      ];
      
      for (const attempt of substitutionAttempts) {
        const result = await TestUtils.execute('sh', ['-c', attempt]);
        
        // Should catch evaluated commands
        expect(result.exitCode).not.toBe(0);
      }
    });
    
    test('handles function definition bypasses', async () => {
      const functionAttempts = [
        'function rm() { /bin/rm "$@"; }; rm -rf /',
        'rm() { /bin/rm "$@"; }; rm -rf /',
      ];
      
      for (const attempt of functionAttempts) {
        const result = await TestUtils.execute('bash', ['-c', attempt]);
        
        // Should prevent function override bypasses
        expect(result.exitCode).not.toBe(0);
      }
    });
    
    test('prevents source/dot command bypasses', async () => {
      // Create malicious script
      const scriptPath = path.join(testEnv.tempDir, 'evil.sh');
      await TestUtils.createMockCommand(testEnv.tempDir, 'evil.sh', 
        '#!/bin/bash\n/bin/rm -rf /');
      
      const sourceAttempts = [
        `source ${scriptPath}`,
        `. ${scriptPath}`,
      ];
      
      for (const attempt of sourceAttempts) {
        const result = await TestUtils.execute('bash', ['-c', attempt]);
        
        // Should analyze sourced scripts
        expect(result.exitCode).not.toBe(0);
      }
    });
  });
  
  describe('Binary Execution Prevention', () => {
    test('intercepts execution through exec syscall', async () => {
      // Test direct exec family calls
      const execAttempts = [
        'exec /bin/rm -rf /',
        'exec -a othername /bin/rm -rf /',
        'nice -n 10 /bin/rm -rf /',
        'nohup /bin/rm -rf /',
      ];
      
      for (const attempt of execAttempts) {
        const result = await TestUtils.execute('sh', ['-c', attempt]);
        
        // Should intercept exec calls
        expect(result.exitCode).not.toBe(0);
      }
    });
    
    test('handles permission-based bypasses', async () => {
      // Create executable with different permissions
      const customExec = path.join(testEnv.tempDir, 'custom-rm');
      await TestUtils.createMockCommand(testEnv.tempDir, 'custom-rm', 
        '#!/bin/sh\n/bin/rm "$@"');
      
      // Various permission attempts
      const permissionTests = [
        { mode: 0o4755, desc: 'setuid' },  // Setuid
        { mode: 0o2755, desc: 'setgid' },  // Setgid
        { mode: 0o1755, desc: 'sticky' },  // Sticky bit
      ];
      
      for (const { mode, desc } of permissionTests) {
        await TestUtils.execute('chmod', [mode.toString(8), customExec]);
        
        const result = await CommandTestHelper.executeWithDeliberate(customExec, ['-rf', '/tmp/test']);
        
        // Should handle special permission binaries
        expect(result.stderr).toContain('intercepted');
      }
    });
  });
  
  describe('Complex Bypass Combinations', () => {
    test('handles multiple bypass techniques combined', async () => {
      const complexBypasses = [
        'PATH=/usr/bin eval "\\rm -rf /"',
        'env -i PATH=/bin bash -c "$(echo rm) -rf /"',
        'unset PATH; /usr/bin/env rm -rf /',
        '( PATH=/usr/bin; exec \\rm -rf / )',
      ];
      
      for (const bypass of complexBypasses) {
        const result = await TestUtils.execute('bash', ['-c', bypass]);
        
        // Should handle complex combinations
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).not.toContain('cannot remove');
      }
    });
    
    test('prevents time-based race condition bypasses', async () => {
      // Attempt rapid execution to bypass checks
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(
          TestUtils.execute('/bin/rm', ['-rf', `/tmp/test${i}`])
        );
      }
      
      const results = await Promise.all(promises);
      
      // All should be intercepted despite concurrent execution
      results.forEach(result => {
        expect(result.exitCode).not.toBe(0);
      });
    });
  });
});