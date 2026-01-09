/**
 * Specification: Performance Requirements
 * 
 * Requirements from our discussion:
 * 1. Safe commands must complete in <10ms
 * 2. AI decisions must return within 500ms
 * 3. No noticeable overhead for normal terminal use
 * 4. System must work on low-end hardware
 */

import { execSync } from 'child_process';
import { DeliberateAnalyzer } from '../../src/core/analyzer';

describe('Performance Specification', () => {
  let analyzer: DeliberateAnalyzer;
  
  beforeEach(() => {
    analyzer = new DeliberateAnalyzer();
  });

  describe('Safe Command Performance', () => {
    const SAFE_COMMANDS = [
      'ls', 'pwd', 'echo test', 'cat small.txt', 
      'grep pattern file', 'which node', 'ps aux'
    ];

    SAFE_COMMANDS.forEach(cmd => {
      it(`MUST process '${cmd}' in <10ms`, async () => {
        const times: number[] = [];
        
        // Run 100 times to get average
        for (let i = 0; i < 100; i++) {
          const start = process.hrtime.bigint();
          await analyzer.analyze(cmd, []);
          const end = process.hrtime.bigint();
          times.push(Number(end - start) / 1_000_000); // Convert to ms
        }
        
        const avgTime = times.reduce((a, b) => a + b) / times.length;
        const maxTime = Math.max(...times);
        
        expect(avgTime).toBeLessThan(10);
        expect(maxTime).toBeLessThan(20); // Even worst case
      });
    });
  });

  describe('Toggle Performance', () => {
    it('MUST switch on/off in <50ms', () => {
      const times: number[] = [];
      
      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        execSync('node dist/cli/index.js on');
        const onTime = Date.now() - start;
        
        const start2 = Date.now();
        execSync('node dist/cli/index.js off');
        const offTime = Date.now() - start2;
        
        times.push(onTime, offTime);
      }
      
      const avgTime = times.reduce((a, b) => a + b) / times.length;
      expect(avgTime).toBeLessThan(50);
    });
  });

  describe('Memory Usage', () => {
    it('MUST use less than 100MB RAM at idle', async () => {
      // Start deliberate
      execSync('node dist/cli/index.js on');
      
      // Get process memory
      const usage = process.memoryUsage();
      const totalMB = (usage.heapUsed + usage.external) / 1024 / 1024;
      
      expect(totalMB).toBeLessThan(100);
    });

    it('MUST not leak memory over time', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Process 1000 commands
      for (let i = 0; i < 1000; i++) {
        await analyzer.analyze('ls', ['-la']);
      }
      
      // Force garbage collection
      if (global.gc) global.gc();
      
      const finalMemory = process.memoryUsage().heapUsed;
      const leakMB = (finalMemory - initialMemory) / 1024 / 1024;
      
      expect(leakMB).toBeLessThan(10); // Less than 10MB growth
    });
  });

  describe('AI Performance', () => {
    it('MUST return AI decision within 500ms', async () => {
      // This test requires LocalAI to be running
      const start = Date.now();
      
      const result = await deliberate.analyzeWithAI({
        command: 'rm',
        args: ['-rf', 'important'],
        context: {}
      });
      
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
    });

    it('MUST cache AI responses effectively', async () => {
      const command = { command: 'rm', args: ['-rf', 'test'], context: {} };
      
      // First call
      const start1 = Date.now();
      await deliberate.analyzeWithAI(command);
      const time1 = Date.now() - start1;
      
      // Second call (cached)
      const start2 = Date.now();
      await deliberate.analyzeWithAI(command);
      const time2 = Date.now() - start2;
      
      expect(time2).toBeLessThan(time1 / 10); // 10x faster
    });
  });

  describe('Startup Performance', () => {
    it('MUST be ready within 100ms of startup', () => {
      const start = Date.now();
      execSync('node dist/cli/index.js status');
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Concurrent Command Handling', () => {
    it('MUST handle 100 concurrent safe commands', async () => {
      const promises = [];
      const start = Date.now();
      
      // Launch 100 concurrent analyses
      for (let i = 0; i < 100; i++) {
        promises.push(analyzer.analyze('ls', []));
      }
      
      await Promise.all(promises);
      const elapsed = Date.now() - start;
      
      // Should complete all 100 in reasonable time
      expect(elapsed).toBeLessThan(1000); // 1 second for 100 commands
    });
  });

  describe('Resource Constraints', () => {
    it('MUST work on system with 2GB RAM', () => {
      // This is more of a deployment test
      // Ensures our dependencies don't exceed memory limits
      const packageJson = require('../../package.json');
      const heavyDeps = ['tensorflow', 'puppeteer', 'electron'];
      
      heavyDeps.forEach(dep => {
        expect(packageJson.dependencies).not.toHaveProperty(dep);
        expect(packageJson.devDependencies).not.toHaveProperty(dep);
      });
    });
  });
});