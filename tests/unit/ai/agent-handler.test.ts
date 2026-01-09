import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { AgentCommandHandler } from '../../../src/ai/agent-handler';
import { AgentAuthSystem } from '../../../src/ai/auth-system';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

jest.mock('child_process');
jest.mock('../../../src/ai/auth-system');

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('AgentCommandHandler', () => {
  let handler: AgentCommandHandler;
  let mockAuthSystem: jest.Mocked<AgentAuthSystem>;
  
  beforeEach(() => {
    handler = new AgentCommandHandler();
    mockAuthSystem = (handler as any).authSystem;
  });
  
  describe('generateCodeForAgent', () => {
    test('should generate auth code for agent', () => {
      const command = 'git';
      const args = ['commit', '-m', 'test'];
      const analysis = {
        verdict: 'WARN' as const,
        explanation: 'Commits changes',
        risks: ['Permanent record'],
        confidence: 0.8
      };
      
      mockAuthSystem.generateAuthCode.mockReturnValue('swift-eagle-42');
      
      const code = handler.generateCodeForAgent(command, args, analysis);
      
      expect(code).toBe('swift-eagle-42');
      expect(mockAuthSystem.generateAuthCode).toHaveBeenCalledWith(
        command,
        args,
        expect.objectContaining({
          verdict: 'WARN',
          generatedAt: expect.any(String)
        })
      );
    });
    
    test('should include agent context if provided', () => {
      const agentContext = {
        agentName: 'test-agent',
        purpose: 'automated testing'
      };
      
      mockAuthSystem.generateAuthCode.mockReturnValue('brave-lion-7');
      
      handler.generateCodeForAgent('ls', [], {
        verdict: 'ALLOW',
        explanation: 'Safe',
        risks: [],
        confidence: 1
      }, agentContext);
      
      expect(mockAuthSystem.generateAuthCode).toHaveBeenCalledWith(
        'ls',
        [],
        expect.objectContaining({
          agentContext
        })
      );
    });
  });
  
  describe('executeWithAuth', () => {
    test('should execute command with valid auth code', async () => {
      const authCode = 'valid-code-1';
      const command = 'echo';
      const args = ['hello'];
      
      mockAuthSystem.validateAuthCode.mockReturnValue({
        valid: true,
        data: {
          command,
          args,
          analysis: { verdict: 'ALLOW' },
          timestamp: Date.now(),
          used: false
        }
      });
      
      // Mock process spawn
      const mockProcess = new EventEmitter();
      const mockStdout = new EventEmitter();
      const mockStderr = new EventEmitter();
      
      Object.assign(mockProcess, {
        stdout: mockStdout,
        stderr: mockStderr
      });
      
      mockedSpawn.mockReturnValue(mockProcess as any);
      
      // Simulate execution
      const resultPromise = handler.executeWithAuth({
        authCode,
        agentId: 'test-agent'
      });
      
      // Emit output and exit
      mockStdout.emit('data', Buffer.from('hello\n'));
      mockProcess.emit('exit', 0);
      
      const result = await resultPromise;
      
      expect(result.success).toBe(true);
      expect(result.output).toBe('hello\n');
      expect(result.exitCode).toBe(0);
      
      expect(mockedSpawn).toHaveBeenCalledWith(command, args, {
        stdio: 'pipe',
        env: expect.objectContaining({
          DELIBERATE_AGENT_EXECUTION: '1'
        })
      });
    });
    
    test('should reject invalid auth code', async () => {
      mockAuthSystem.validateAuthCode.mockReturnValue({
        valid: false,
        reason: 'Invalid auth code'
      });
      
      const result = await handler.executeWithAuth({
        authCode: 'invalid-code',
        agentId: 'test-agent'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid auth code');
      expect(mockedSpawn).not.toHaveBeenCalled();
    });
    
    test('should handle command execution failure', async () => {
      mockAuthSystem.validateAuthCode.mockReturnValue({
        valid: true,
        data: {
          command: 'false',
          args: [],
          analysis: {},
          timestamp: Date.now(),
          used: false
        }
      });
      
      const mockProcess = new EventEmitter();
      Object.assign(mockProcess, {
        stdout: new EventEmitter(),
        stderr: new EventEmitter()
      });
      
      mockedSpawn.mockReturnValue(mockProcess as any);
      
      const resultPromise = handler.executeWithAuth({
        authCode: 'valid-code',
        agentId: 'test-agent'
      });
      
      mockProcess.emit('exit', 1);
      
      const result = await resultPromise;
      
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });
    
    test('should capture stderr output', async () => {
      mockAuthSystem.validateAuthCode.mockReturnValue({
        valid: true,
        data: {
          command: 'ls',
          args: ['/nonexistent'],
          analysis: {},
          timestamp: Date.now(),
          used: false
        }
      });
      
      const mockProcess = new EventEmitter();
      const mockStdout = new EventEmitter();
      const mockStderr = new EventEmitter();
      
      Object.assign(mockProcess, {
        stdout: mockStdout,
        stderr: mockStderr
      });
      
      mockedSpawn.mockReturnValue(mockProcess as any);
      
      const resultPromise = handler.executeWithAuth({
        authCode: 'valid-code',
        agentId: 'test-agent'
      });
      
      mockStderr.emit('data', Buffer.from('ls: /nonexistent: No such file or directory\n'));
      mockProcess.emit('exit', 1);
      
      const result = await resultPromise;
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('No such file or directory');
    });
    
    test('should include metadata in execution log', async () => {
      mockAuthSystem.validateAuthCode.mockReturnValue({
        valid: true,
        data: {
          command: 'echo',
          args: ['test'],
          analysis: {},
          timestamp: Date.now(),
          used: false
        }
      });
      
      const mockProcess = new EventEmitter();
      Object.assign(mockProcess, {
        stdout: new EventEmitter(),
        stderr: new EventEmitter()
      });
      
      mockedSpawn.mockReturnValue(mockProcess as any);
      
      const metadata = {
        requestId: '12345',
        source: 'api'
      };
      
      const resultPromise = handler.executeWithAuth({
        authCode: 'valid-code',
        agentId: 'test-agent',
        metadata
      });
      
      mockProcess.emit('exit', 0);
      await resultPromise;
      
      const history = handler.getAgentHistory('test-agent');
      expect(history).toContainEqual(
        expect.objectContaining({
          metadata,
          authCode: 'valid-code'
        })
      );
    });
  });
  
  describe('getAgentHistory', () => {
    test('should return empty array for unknown agent', () => {
      const history = handler.getAgentHistory('unknown-agent');
      expect(history).toEqual([]);
    });
    
    test('should track execution history', async () => {
      mockAuthSystem.validateAuthCode.mockReturnValue({
        valid: true,
        data: {
          command: 'echo',
          args: ['test'],
          analysis: {},
          timestamp: Date.now(),
          used: false
        }
      });
      
      const mockProcess = new EventEmitter();
      Object.assign(mockProcess, {
        stdout: new EventEmitter(),
        stderr: new EventEmitter()
      });
      
      mockedSpawn.mockReturnValue(mockProcess as any);
      
      const resultPromise = handler.executeWithAuth({
        authCode: 'code1',
        agentId: 'agent1'
      });
      
      mockProcess.emit('exit', 0);
      await resultPromise;
      
      const history = handler.getAgentHistory('agent1');
      expect(history).toHaveLength(2); // Initial log + result log
      expect(history[0]).toMatchObject({
        command: 'echo',
        args: ['test'],
        authCode: 'code1'
      });
      expect(history[1]).toMatchObject({
        type: 'result',
        success: true,
        exitCode: 0
      });
    });
  });
  
  describe('formatAuthCodeForDisplay', () => {
    test('should format auth code with analysis', () => {
      const code = 'happy-cloud-99';
      const analysis = {
        verdict: 'WARN' as const,
        explanation: 'May have side effects',
        risks: ['Network access'],
        confidence: 0.75
      };
      
      const formatted = handler.formatAuthCodeForDisplay(code, analysis);
      
      expect(formatted).toContain('happy-cloud-99');
      expect(formatted).toContain('⚠️');
      expect(formatted).toContain('WARN');
      expect(formatted).toContain('Valid for: 5 minutes');
      expect(formatted).toContain('deliberate agent-exec happy-cloud-99');
    });
    
    test('should use appropriate emoji for risk level', () => {
      const testCases = [
        { verdict: 'ALLOW' as const, emoji: '✅' },
        { verdict: 'WARN' as const, emoji: '⚠️' },
        { verdict: 'BLOCK' as const, emoji: '🚫' }
      ];
      
      for (const { verdict, emoji } of testCases) {
        const formatted = handler.formatAuthCodeForDisplay('test-code', {
          verdict,
          explanation: '',
          risks: [],
          confidence: 1
        });
        
        expect(formatted).toContain(emoji);
      }
    });
  });
});