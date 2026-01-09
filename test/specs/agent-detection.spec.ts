/**
 * Specification: AI Agent Detection
 * 
 * Requirements from our discussion:
 * 1. Automatically detect AI agents (Claude Code, Copilot, etc.)
 * 2. Generate auth tokens for dangerous commands
 * 3. deliberate ai on/off controls agent protection
 * 4. Single-use auth tokens with 5-minute expiry
 */

import { AIAgentDetector } from '../../src/core/detection/ai-agent-detector';
import { AgentAuthSystem } from '../../src/ai/auth-system';
import { execSync } from 'child_process';

describe('AI Agent Detection Specification', () => {
  let detector: AIAgentDetector;
  let authSystem: AgentAuthSystem;
  
  beforeEach(() => {
    detector = new AIAgentDetector();
    authSystem = AgentAuthSystem.getInstance();
  });

  describe('Agent Detection', () => {
    it('MUST detect Claude Code environment', async () => {
      process.env.CLAUDE_CODE_SSE_PORT = '56337';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
      process.env.VSCODE_INJECTION = '1';
      
      const result = await detector.detect();
      
      expect(result.detected).toBe(true);
      expect(result.agentType).toBe('claude_code');
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.evidence).toContain('CLAUDE_CODE_SSE_PORT');
      
      // Cleanup
      delete process.env.CLAUDE_CODE_SSE_PORT;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.VSCODE_INJECTION;
    });

    it('MUST detect GitHub Copilot', async () => {
      process.env.GITHUB_COPILOT_ACTIVE = '1';
      process.env.COPILOT_PROXY_ENDPOINT = 'http://localhost:3000';
      
      const result = await detector.detect();
      
      expect(result.detected).toBe(true);
      expect(result.agentType).toBe('github_copilot');
      
      // Cleanup
      delete process.env.GITHUB_COPILOT_ACTIVE;
      delete process.env.COPILOT_PROXY_ENDPOINT;
    });

    it('MUST NOT detect AI in normal terminal', async () => {
      // Clean environment
      const result = await detector.detect();
      
      expect(result.detected).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('MUST use multiple detection factors', async () => {
      // Partial environment (not enough for high confidence)
      process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
      
      const result = await detector.detect();
      
      expect(result.evidence).toContain('API key present');
      expect(result.confidence).toBeLessThan(0.5); // Low confidence with just API key
      
      delete process.env.ANTHROPIC_API_KEY;
    });
  });

  describe('Auth Token Generation', () => {
    it('MUST generate auth tokens for AI agents with dangerous commands', async () => {
      // Simulate AI agent environment
      process.env.CLAUDE_CODE_SSE_PORT = '56337';
      
      const output = execSync('node dist/cli/index.js ai "rm -rf node_modules"').toString();
      
      expect(output).toContain('AI Agent Detected');
      expect(output).toContain('Auth code:');
      expect(output).toMatch(/Auth code: [a-z]+-[a-z]+-\d+/);
      expect(output).toContain('deliberate agent-exec');
      
      delete process.env.CLAUDE_CODE_SSE_PORT;
    });

    it('MUST NOT generate tokens for safe commands', async () => {
      process.env.CLAUDE_CODE_SSE_PORT = '56337';
      
      const output = execSync('node dist/cli/index.js ai "ls -la"').toString();
      
      expect(output).toContain('✓ Safe command - proceeding');
      expect(output).not.toContain('Auth code:');
      
      delete process.env.CLAUDE_CODE_SSE_PORT;
    });

    it('MUST enforce single-use tokens', async () => {
      const authCode = await authSystem.generateAuthCode('rm', ['test.txt'], {
        verdict: 'WARN',
        confidence: 0.8
      });
      
      // First use should succeed
      const validation1 = await authSystem.validateAuthCode(authCode);
      expect(validation1.valid).toBe(true);
      
      // Second use should fail
      const validation2 = await authSystem.validateAuthCode(authCode);
      expect(validation2.valid).toBe(false);
      expect(validation2.reason).toContain('already used');
    });

    it('MUST expire tokens after 5 minutes', async () => {
      const authCode = await authSystem.generateAuthCode('rm', ['test.txt'], {
        verdict: 'WARN',
        confidence: 0.8
      });
      
      // Mock time passing
      jest.advanceTimersByTime(6 * 60 * 1000); // 6 minutes
      
      const validation = await authSystem.validateAuthCode(authCode);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('expired');
    });
  });

  describe('AI Mode Toggle', () => {
    it('MUST respect deliberate ai on/off setting', async () => {
      process.env.CLAUDE_CODE_SSE_PORT = '56337';
      
      // AI mode ON (default)
      execSync('node dist/cli/index.js ai on');
      let output = execSync('node dist/cli/index.js intercept rm test.txt', {
        env: process.env
      }).toString();
      expect(output).toContain('AI Agent Detected');
      
      // AI mode OFF
      execSync('node dist/cli/index.js ai off');
      output = execSync('node dist/cli/index.js intercept rm test.txt', {
        env: process.env
      }).toString();
      expect(output).not.toContain('AI Agent Detected');
      
      delete process.env.CLAUDE_CODE_SSE_PORT;
    });

    it('MUST treat ai off same as deliberate off for agents', async () => {
      process.env.CLAUDE_CODE_SSE_PORT = '56337';
      execSync('node dist/cli/index.js ai off');
      
      // Should execute without any interception
      const result = execSync('echo "test" > /tmp/test-deliberate.txt && rm /tmp/test-deliberate.txt', {
        shell: true
      });
      
      // File should be deleted without prompts
      expect(fs.existsSync('/tmp/test-deliberate.txt')).toBe(false);
      
      delete process.env.CLAUDE_CODE_SSE_PORT;
    });
  });

  describe('Agent Identification', () => {
    it('MUST generate unique agent IDs', async () => {
      const detection = {
        detected: true,
        agentType: 'claude_code',
        confidence: 0.99,
        evidence: ['CLAUDE_CODE_SSE_PORT']
      };
      
      const id1 = detector.generateAgentId(detection);
      const id2 = detector.generateAgentId(detection);
      
      expect(id1).toMatch(/^claude_code-\d+$/);
      expect(id2).toMatch(/^claude_code-\d+$/);
      expect(id1).not.toBe(id2);
    });
  });
});