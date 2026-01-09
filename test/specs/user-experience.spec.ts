/**
 * Specification: User Experience
 * 
 * Requirements from our discussion:
 * 1. Clear, concise messages
 * 2. No interference with normal workflow
 * 3. Obvious when protection is ON/OFF
 * 4. Easy to understand AI explanations
 */

import { execSync } from 'child_process';
import * as fs from 'fs';

describe('User Experience Specification', () => {
  describe('Command Output', () => {
    it('MUST show clear message for safe commands', () => {
      execSync('node dist/cli/index.js on');
      const output = execSync('node dist/cli/index.js intercept ls -la').toString();
      
      expect(output).toContain('✓ Safe command - proceeding');
      expect(output).not.toContain('AI Security Analysis');
      expect(output.split('\n').length).toBeLessThan(3); // Concise
    });

    it('MUST show detailed analysis for dangerous commands', () => {
      const output = execSync('node dist/cli/index.js intercept rm -rf /tmp/test', {
        input: 'n\n'
      }).toString();
      
      expect(output).toContain('AI Security Analysis');
      expect(output).toContain('Verdict:');
      expect(output).toContain('Risks:');
      expect(output).toContain('Approve? [y/N]:');
    });

    it('MUST NOT show technical jargon to users', () => {
      const output = execSync('node dist/cli/index.js intercept rm test.txt', {
        input: 'n\n'
      }).toString();
      
      // Should not contain
      expect(output).not.toMatch(/stack trace/i);
      expect(output).not.toMatch(/undefined|null/i);
      expect(output).not.toMatch(/error:/i);
      expect(output).not.toContain('node_modules');
    });
  });

  describe('Toggle Feedback', () => {
    it('MUST clearly show when turning ON', () => {
      const output = execSync('node dist/cli/index.js on').toString();
      
      expect(output).toContain('✅');
      expect(output).toContain('Deliberate protection enabled');
    });

    it('MUST clearly show when turning OFF', () => {
      const output = execSync('node dist/cli/index.js off').toString();
      
      expect(output).toContain('🔓');
      expect(output).toContain('Deliberate protection disabled');
    });

    it('MUST show current status clearly', () => {
      execSync('node dist/cli/index.js on');
      const output = execSync('node dist/cli/index.js status').toString();
      
      expect(output).toContain('Protection: ✓ ACTIVE');
      expect(output).toContain('Safe commands: Pass instantly');
      expect(output).toContain('Dangerous commands: Require approval');
    });
  });

  describe('AI Explanations', () => {
    it('MUST provide clear, actionable explanations', () => {
      const analysis = {
        verdict: 'WARN',
        explanation: 'This command will recursively delete the directory and all its contents',
        risks: ['Permanent data loss', 'No undo option'],
        alternatives: ['Use rm -i for confirmation', 'Move to trash instead']
      };
      
      const formatted = formatAIAnalysis(analysis);
      
      expect(formatted).not.toContain('elevated privileges');
      expect(formatted).not.toContain('security implications');
      expect(formatted).toContain('delete');
      expect(formatted).toContain('permanently');
    });
  });

  describe('Error Handling', () => {
    it('MUST show friendly error messages', () => {
      // Try to use expired auth token
      const output = execSync('node dist/cli/index.js agent-exec expired-token-123 || true').toString();
      
      expect(output).toContain('Auth token expired or invalid');
      expect(output).not.toContain('Error: ValidationError');
    });

    it('MUST handle AI service unavailable gracefully', () => {
      // Stop LocalAI to simulate failure
      const output = execSync('node dist/cli/index.js intercept rm important.txt', {
        env: { ...process.env, LOCALAI_URL: 'http://localhost:99999' },
        input: 'n\n'
      }).toString();
      
      expect(output).toContain('AI analysis unavailable - defaulting to safe mode');
      expect(output).toContain('Approve? [y/N]:');
    });
  });

  describe('Configuration Experience', () => {
    it('MUST show helpful config command output', () => {
      const output = execSync('node dist/cli/index.js config --list').toString();
      
      expect(output).toContain('=== Safe Commands ===');
      expect(output).toContain('=== Danger Commands ===');
      expect(output).toContain('=== Blocked Commands ===');
      expect(output).toMatch(/Total: \d+ safe, \d+ danger, \d+ blocked/);
    });

    it('MUST confirm configuration changes', () => {
      const output = execSync('node dist/cli/index.js config --safe "npm install"').toString();
      
      expect(output).toContain('✓ Added "npm install" to safe list');
    });
  });

  describe('Help and Documentation', () => {
    it('MUST provide clear help text', () => {
      const output = execSync('node dist/cli/index.js --help').toString();
      
      expect(output).toContain('deliberate on/off');
      expect(output).toContain('Turn protection on or off');
      expect(output).toContain('Examples:');
      expect(output).toContain('deliberate rm file.txt');
    });
  });

  describe('AI Agent Experience', () => {
    it('MUST clearly show when AI agent is detected', () => {
      process.env.CLAUDE_CODE_SSE_PORT = '56337';
      
      const output = execSync('node dist/cli/index.js ai "rm test.txt"').toString();
      
      expect(output).toContain('🤖 AI Agent Detected');
      expect(output).toContain('Agent: claude_code');
      expect(output).toContain('Auth code:');
      expect(output).toContain('To execute:');
      
      delete process.env.CLAUDE_CODE_SSE_PORT;
    });

    it('MUST show clear auth token usage instructions', () => {
      const authCode = 'test-eagle-42';
      const output = formatAuthToken(authCode, 'claude_code-123');
      
      expect(output).toContain(`deliberate agent-exec ${authCode}`);
      expect(output).toContain('Valid for: 5 minutes');
      expect(output).toContain('Single use only');
    });
  });
});

// Helper function to test
function formatAIAnalysis(analysis: any): string {
  return `
⚠️  Verdict: ${analysis.verdict}

🔍 Analysis:
   ${analysis.explanation}

⚠️  Risks:
${analysis.risks.map(r => `   • ${r}`).join('\n')}

💡 Safer Alternatives:
${analysis.alternatives.map(a => `   • ${a}`).join('\n')}
`;
}

function formatAuthToken(code: string, agentId: string): string {
  return `
🔑 Auth code: ${code}

To execute:
deliberate agent-exec ${code} --agent-id ${agentId}

Valid for: 5 minutes
Single use only
`;
}