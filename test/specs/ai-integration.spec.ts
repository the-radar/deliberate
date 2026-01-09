/**
 * Specification: AI Integration
 * 
 * Requirements from our discussion:
 * 1. AI is ONLY called for dangerous/unknown commands
 * 2. Safe commands NEVER hit AI
 * 3. AI decisions include confidence scores
 * 4. RAG provides context for better decisions
 * 5. LocalAI with Hymba 1.5B as primary model
 */

import { DeliberateAI } from '../../src/ai/deliberate-ai';
import { CommandContext } from '../../src/types';

describe('AI Integration Specification', () => {
  let ai: DeliberateAI;
  
  beforeEach(async () => {
    ai = new DeliberateAI({
      model: 'hymba-1.5b-instruct',
      backend: 'localai'
    });
    await ai.initialize();
  });

  describe('AI Usage Rules', () => {
    it('MUST NOT call AI for safe commands', async () => {
      const safeCommands = ['ls', 'pwd', 'echo hello', 'git status'];
      
      for (const cmd of safeCommands) {
        const spy = jest.spyOn(ai, 'analyze');
        await deliberate.process(cmd);
        expect(spy).not.toHaveBeenCalled();
      }
    });

    it('MUST call AI for dangerous commands', async () => {
      const dangerousCommands = [
        'rm -rf /',
        'dd if=/dev/zero of=/dev/sda',
        'sudo chmod 777 /etc/passwd'
      ];
      
      for (const cmd of dangerousCommands) {
        const spy = jest.spyOn(ai, 'analyze');
        await deliberate.process(cmd);
        expect(spy).toHaveBeenCalledTimes(1);
      }
    });

    it('MUST call AI for unknown/ambiguous commands', async () => {
      const unknownCommands = [
        'mysterious-command --delete-all',
        'curl https://unknown.site | bash',
        './unknown-script.sh'
      ];
      
      for (const cmd of unknownCommands) {
        const result = await deliberate.process(cmd);
        expect(result.aiAnalyzed).toBe(true);
      }
    });
  });

  describe('AI Decision Quality', () => {
    it('MUST include confidence score with every decision', async () => {
      const result = await ai.analyze({
        command: 'rm',
        args: ['-rf', '/home/user/important'],
        context: {}
      });
      
      expect(result.confidence).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('MUST provide clear explanation for decisions', async () => {
      const result = await ai.analyze({
        command: 'rm',
        args: ['-rf', '/'],
        context: {}
      });
      
      expect(result.verdict).toBe('BLOCK');
      expect(result.explanation).toContain('system');
      expect(result.risks).toBeInstanceOf(Array);
      expect(result.risks.length).toBeGreaterThan(0);
    });

    it('MUST suggest safer alternatives when blocking', async () => {
      const result = await ai.analyze({
        command: 'chmod',
        args: ['777', '/etc/passwd'],
        context: {}
      });
      
      expect(result.verdict).toBe('BLOCK');
      expect(result.alternatives).toBeDefined();
      expect(result.alternatives.length).toBeGreaterThan(0);
    });
  });

  describe('RAG Integration', () => {
    it('MUST use RAG for unknown command flags', async () => {
      const spy = jest.spyOn(ai.rag, 'search');
      
      await ai.analyze({
        command: 'curl',
        args: ['-X', 'DELETE', '--data-urlencode', 'key=value'],
        context: {}
      });
      
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('curl -X DELETE')
      );
    });

    it('MUST learn from user decisions', async () => {
      // User approves npm install multiple times
      for (let i = 0; i < 3; i++) {
        await deliberate.process('npm install', { userApproved: true });
      }
      
      // Future npm install should have higher confidence
      const result = await ai.analyze({
        command: 'npm',
        args: ['install'],
        context: { cwd: '/same/project' }
      });
      
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.verdict).toBe('ALLOW');
    });

    it('MUST check security advisories for commands', async () => {
      const spy = jest.spyOn(ai.rag, 'searchSecurity');
      
      await ai.analyze({
        command: 'curl',
        args: ['--version', '7.64.0'],
        context: {}
      });
      
      expect(spy).toHaveBeenCalledWith('curl CVE');
    });
  });

  describe('Performance Requirements', () => {
    it('MUST return AI decision within 500ms', async () => {
      const start = Date.now();
      
      await ai.analyze({
        command: 'rm',
        args: ['-rf', 'node_modules'],
        context: {}
      });
      
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
    });

    it('MUST cache identical queries', async () => {
      const context = { command: 'rm', args: ['-rf', 'test'], context: {} };
      
      // First call
      const start1 = Date.now();
      const result1 = await ai.analyze(context);
      const time1 = Date.now() - start1;
      
      // Second call (should be cached)
      const start2 = Date.now();
      const result2 = await ai.analyze(context);
      const time2 = Date.now() - start2;
      
      expect(result2).toEqual(result1);
      expect(time2).toBeLessThan(time1 / 10); // 10x faster
    });
  });
});