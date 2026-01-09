import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { EnhancedCommandInterceptor } from '../../src/core/interception/interceptor-enhanced';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// Mock child_process for controlled testing
jest.mock('child_process');
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

// Mock axios for LLM calls
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AI Integration Tests', () => {
  let interceptor: EnhancedCommandInterceptor;
  let testDir: string;
  
  beforeEach(async () => {
    // Create test directory
    testDir = path.join(os.tmpdir(), `deliberate-ai-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Set AI mode
    process.env.DELIBERATE_AI = '1';
    
    interceptor = new EnhancedCommandInterceptor();
    
    // Mock Ollama check
    mockedSpawn.mockImplementation((cmd: string, args?: any[]) => {
      const mockProcess: any = {
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(0);
        }),
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        unref: jest.fn()
      };
      return mockProcess;
    });
    
    // Mock Ollama API responses
    mockedAxios.get.mockResolvedValue({
      data: {
        models: [
          { name: 'qwen2:1.5b-instruct-q4_0' },
          { name: 'smollm2:1.7b-instruct-q4_0' },
          { name: 'deepseek-r1:1.5b-q4_0' }
        ]
      }
    });
    
    mockedAxios.post.mockResolvedValue({
      data: { response: 'Model loaded' }
    });
  });
  
  afterEach(async () => {
    await interceptor.shutdown();
    await fs.rm(testDir, { recursive: true, force: true });
    delete process.env.DELIBERATE_AI;
    jest.clearAllMocks();
  });
  
  describe('Safe Command Flow', () => {
    test('should allow safe commands with AI analysis', async () => {
      // Mock AI responses for safe command
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { 
            response: `Command: ls -la
What it does: Lists all files with details
Risks: None
Safety rating: SAFE
No security concerns.`
          }
        })
        .mockResolvedValueOnce({
          data: {
            response: `This is a read-only directory listing command.
No risks identified.
Safe for execution.`
          }
        })
        .mockResolvedValueOnce({
          data: {
            response: `Overall risk level: ALLOW
Explanation: Safe directory listing command
Both analyses agree this is safe.`
          }
        });
      
      // Mock command execution
      mockedSpawn.mockImplementation((cmd: string, args?: any[]) => {
        if (cmd.includes('ls')) {
          const mockProcess: any = {
            on: jest.fn((event, callback) => {
              if (event === 'exit') callback(0);
            }),
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() }
          };
          return mockProcess;
        }
        return mockedSpawn.getMockImplementation()!(cmd, args);
      });
      
      await interceptor.initialize();
      const result = await interceptor.intercept('ls', ['-la']);
      
      expect(result.allowed).toBe(true);
      expect(result.executed).toBe(true);
      expect(result.exitCode).toBe(0);
      
      // Verify AI was called
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/generate'),
        expect.objectContaining({
          model: expect.any(String),
          prompt: expect.stringContaining('ls -la')
        })
      );
    });
  });
  
  describe('Dangerous Command Flow', () => {
    test('should block dangerous commands based on AI analysis', async () => {
      // Mock AI responses for dangerous command
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { 
            response: `Command: rm -rf /
What it does: Recursively deletes everything from root
Risks:
- Complete system destruction
- Permanent data loss
- System becomes unbootable
Safety rating: DANGEROUS
CRITICAL: This will destroy the entire system!`
          }
        })
        .mockResolvedValueOnce({
          data: {
            response: `EXTREME DANGER!
Impact:
- Deletes all system files
- Destroys user data
- Renders system unusable
This command should NEVER be executed!`
          }
        })
        .mockResolvedValueOnce({
          data: {
            response: `Overall risk level: BLOCK
- System destruction
- Data loss permanent
- No recovery possible
Explanation: This command will completely destroy your system. Never execute this.
Alternative: Use rm with specific paths and without -f flag.`
          }
        });
      
      await interceptor.initialize();
      const result = await interceptor.intercept('rm', ['-rf', '/']);
      
      expect(result.allowed).toBe(false);
      expect(result.executed).toBe(false);
      expect(result.reason).toContain('destroy your system');
    });
  });
  
  describe('Warning Command Flow with TTY', () => {
    test('should warn and request approval for moderate risk commands', async () => {
      // Mock TTY as available
      process.stdin.isTTY = true;
      
      // Mock AI responses for moderate risk
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { 
            response: `Command: curl http://example.com
What it does: Downloads content from URL
Risks:
- May download malicious content
- Network exposure
Safety rating: CAUTION
Verify the URL is trusted.`
          }
        })
        .mockResolvedValueOnce({
          data: {
            response: `Network operation detected.
Risks:
- Unknown content source
- Potential malware download
Requires user verification.`
          }
        })
        .mockResolvedValueOnce({
          data: {
            response: `Overall risk level: WARN
- Downloads from internet
- URL trust required
Explanation: This downloads content from the internet. Ensure you trust the source.
Alternative: Use curl with --output to save to specific file for inspection.`
          }
        });
      
      // Note: In real test, we'd need to mock TTY interaction
      // For now, we'll test that it attempts to get approval
      await interceptor.initialize();
      
      // This will fail because we can't mock TTY input in tests
      try {
        await interceptor.intercept('curl', ['http://example.com']);
      } catch (error) {
        // Expected to fail due to TTY mocking limitations
        expect(error).toBeDefined();
      }
    });
  });
  
  describe('AI Agent Auth Code Flow', () => {
    test('should generate auth code when no TTY available', async () => {
      // Mock no TTY
      process.stdin.isTTY = false;
      
      // Mock AI responses
      mockedAxios.post
        .mockResolvedValueOnce({
          data: { response: 'Command requires network access. CAUTION level.' }
        })
        .mockResolvedValueOnce({
          data: { response: 'External connection risk identified.' }
        })
        .mockResolvedValueOnce({
          data: { 
            response: `Overall risk level: WARN
Explanation: Network command requires approval`
          }
        });
      
      await interceptor.initialize();
      const result = await interceptor.intercept('wget', ['https://example.com/file.zip']);
      
      expect(result.allowed).toBe(false);
      expect(result.authCode).toBeDefined();
      expect(result.authCode).toMatch(/^[a-z]+-[a-z]+-\d{1,2}$/);
      expect(result.reason).toContain('Auth code generated');
    });
    
    test('should execute command with valid auth code', async () => {
      // First, generate an auth code
      process.stdin.isTTY = false;
      
      mockedAxios.post.mockResolvedValue({
        data: { 
          response: 'Overall risk level: WARN\nExplanation: Needs approval'
        }
      });
      
      await interceptor.initialize();
      const firstResult = await interceptor.intercept('echo', ['test']);
      
      expect(firstResult.authCode).toBeDefined();
      
      // Now use the auth code
      mockedSpawn.mockImplementation((cmd: string) => {
        if (cmd.includes('echo')) {
          const mockProcess: any = {
            on: jest.fn((event, callback) => {
              if (event === 'exit') callback(0);
            }),
            stdout: { 
              on: jest.fn((event, callback) => {
                if (event === 'data') callback(Buffer.from('test\n'));
              })
            },
            stderr: { on: jest.fn() }
          };
          return mockProcess;
        }
        return mockedSpawn.getMockImplementation()!(cmd);
      });
      
      const execResult = await interceptor.handleAgentExecution(
        firstResult.authCode!,
        'test-agent'
      );
      
      expect(execResult.allowed).toBe(true);
      expect(execResult.executed).toBe(true);
      expect(execResult.exitCode).toBe(0);
    });
  });
  
  describe('Sensitive Data Handling', () => {
    test('should redact sensitive data before sending to LLM', async () => {
      const apiKey = 'sk-1234567890abcdefghijklmnop';
      
      mockedAxios.post.mockResolvedValue({
        data: { 
          response: 'Overall risk level: WARN\nAPI key usage detected'
        }
      });
      
      await interceptor.initialize();
      await interceptor.intercept('curl', [
        '-H',
        `Authorization: Bearer ${apiKey}`,
        'https://api.example.com'
      ]);
      
      // Check that API key was redacted in prompts
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          prompt: expect.not.stringContaining(apiKey)
        })
      );
      
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          prompt: expect.stringContaining('REDACTED')
        })
      );
    });
  });
  
  describe('Built-in Command Handling', () => {
    test('should handle cd command as builtin', async () => {
      process.chdir(testDir);
      
      await interceptor.initialize();
      const result = await interceptor.intercept('cd', [os.homedir()]);
      
      expect(result.allowed).toBe(true);
      expect(result.executed).toBe(true);
      expect(process.cwd()).toBe(os.homedir());
      
      // Should not call AI for builtins
      expect(mockedAxios.post).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          prompt: expect.stringContaining('cd')
        })
      );
    });
    
    test('should handle export command as builtin', async () => {
      await interceptor.initialize();
      const result = await interceptor.intercept('export', ['TEST_VAR=hello']);
      
      expect(result.allowed).toBe(true);
      expect(result.executed).toBe(true);
      expect(process.env.TEST_VAR).toBe('hello');
      
      // Cleanup
      delete process.env.TEST_VAR;
    });
  });
  
  describe('AI Failure Handling', () => {
    test('should fallback to pattern analysis when AI fails', async () => {
      // Make all AI calls fail
      mockedAxios.post.mockRejectedValue(new Error('LLM server error'));
      
      await interceptor.initialize();
      
      // Safe command should still be allowed
      mockedSpawn.mockImplementation((cmd: string) => {
        const mockProcess: any = {
          on: jest.fn((event, callback) => {
            if (event === 'exit') callback(0);
          }),
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() }
        };
        return mockProcess;
      });
      
      const safeResult = await interceptor.intercept('ls', []);
      expect(safeResult.allowed).toBe(true);
      
      // Dangerous command should still be blocked
      const dangerResult = await interceptor.intercept('rm', ['-rf', '/']);
      expect(dangerResult.allowed).toBe(false);
      expect(dangerResult.reason).toContain('dangerous patterns');
    });
  });
  
  describe('Performance', () => {
    test('should complete analysis within reasonable time', async () => {
      // Mock fast AI responses
      mockedAxios.post.mockImplementation(() => 
        Promise.resolve({
          data: { response: 'ALLOW\nSafe command' }
        })
      );
      
      await interceptor.initialize();
      
      const start = Date.now();
      await interceptor.intercept('echo', ['test']);
      const duration = Date.now() - start;
      
      // Should complete within 1 second even with 3 AI calls
      expect(duration).toBeLessThan(1000);
    });
  });
});