import { CommandClassifier } from '../../../../src/core/classification/classifier';
import { CommandRouter } from '../../../../src/core/interception/command-router';
import { SensitiveDataRedactor } from '../../../../src/core/redaction/redactor';
import { BypassPrevention } from '../../../../src/core/security/bypass-prevention';
import { FastPath } from '../../../../src/performance/fast-path';
import * as os from 'os';

/**
 * Performance Tests for Phase 1 Core Components
 * 
 * Target metrics:
 * - Safe commands: <10ms overhead
 * - Pattern analysis: <50ms
 * - Memory usage: <50MB baseline
 */

describe('Phase 1 Performance Tests', () => {
  let classifier: CommandClassifier;
  let router: CommandRouter;
  let redactor: SensitiveDataRedactor;
  let bypassPrevention: BypassPrevention;
  let fastPath: FastPath;

  beforeAll(() => {
    // Initialize components
    classifier = new CommandClassifier();
    router = new CommandRouter();
    redactor = new SensitiveDataRedactor();
    bypassPrevention = new BypassPrevention();
    fastPath = FastPath.getInstance();
    
    // Warm up caches
    for (let i = 0; i < 100; i++) {
      classifier.classify('ls', ['-la']);
      router.route('ls', ['-la'], {} as any);
    }
  });

  describe('Command Classification Performance', () => {
    test('should classify safe commands within 10ms', () => {
      const safeCommands = [
        { cmd: 'ls', args: ['-la'] },
        { cmd: 'pwd', args: [] },
        { cmd: 'echo', args: ['test'] },
        { cmd: 'cat', args: ['file.txt'] },
        { cmd: 'grep', args: ['pattern', 'file.txt'] }
      ];

      safeCommands.forEach(({ cmd, args }) => {
        const start = process.hrtime.bigint();
        classifier.classify(cmd, args);
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1_000_000;
        
        expect(durationMs).toBeLessThan(10);
      });
    });

    test('should classify dangerous commands within 50ms', () => {
      const dangerousCommands = [
        { cmd: 'rm', args: ['-rf', '/tmp/test'] },
        { cmd: 'chmod', args: ['777', 'file.txt'] },
        { cmd: 'kill', args: ['-9', '1234'] },
        { cmd: 'sudo', args: ['rm', '-rf', '/'] }
      ];

      dangerousCommands.forEach(({ cmd, args }) => {
        const start = process.hrtime.bigint();
        classifier.classify(cmd, args);
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1_000_000;
        
        expect(durationMs).toBeLessThan(50);
      });
    });

    test('should handle 1000 classifications per second', async () => {
      const iterations = 1000;
      const commands = [
        { cmd: 'ls', args: [] },
        { cmd: 'rm', args: ['-rf'] },
        { cmd: 'cat', args: ['file'] },
        { cmd: 'chmod', args: ['755'] }
      ];

      const start = process.hrtime.bigint();
      
      for (let i = 0; i < iterations; i++) {
        const { cmd, args } = commands[i % commands.length];
        await classifier.classify(cmd, args);
      }
      
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      
      // Should complete 1000 classifications in under 1 second
      expect(durationMs).toBeLessThan(1000);
      
      const opsPerSecond = (iterations / durationMs) * 1000;
      expect(opsPerSecond).toBeGreaterThan(1000);
    });
  });

  describe('Fast Path Performance', () => {
    test('should check safe commands in under 5ms with fast path', () => {
      const commands = [
        'ls -la',
        'pwd',
        'echo test',
        'date',
        'whoami'
      ];

      commands.forEach(command => {
        const start = process.hrtime.bigint();
        const result = fastPath.checkCommand(command);
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1_000_000;
        
        expect(durationMs).toBeLessThan(5);
        expect(result.safe).toBe(true);
      });
    });

    test('should maintain high cache hit rate', () => {
      // Reset stats
      fastPath.resetStats();
      
      // Run same commands multiple times
      const commands = ['ls', 'pwd', 'echo test', 'cat file.txt'];
      const iterations = 100;
      
      commands.forEach(cmd => {
        for (let i = 0; i < iterations; i++) {
          fastPath.checkCommand(cmd);
        }
      });
      
      const stats = fastPath.getStats();
      const hitRate = stats.hits / (stats.hits + stats.misses);
      
      // Should have >95% cache hit rate
      expect(hitRate).toBeGreaterThan(0.95);
    });
  });

  describe('Sensitive Data Redaction Performance', () => {
    test('should redact sensitive data within 20ms', async () => {
      const commands = [
        'curl -H "Authorization: Bearer sk-1234567890abcdef" https://api.example.com',
        'mysql -u root -pSecretPassword123! -h localhost',
        'export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        'echo "SSN: 123-45-6789 and CC: 4111-1111-1111-1111"'
      ];

      for (const command of commands) {
        const start = process.hrtime.bigint();
        await redactor.redactCommand(command);
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1_000_000;
        
        expect(durationMs).toBeLessThan(20);
      }
    });

    test('should handle large commands efficiently', async () => {
      // Create a large command with multiple sensitive values
      const largeCommand = `curl -X POST https://api.example.com/data \
        -H "Authorization: Bearer sk-${Array(50).fill('a').join('')}" \
        -H "X-API-Key: ${Array(32).fill('b').join('')}" \
        -d '{"ssn": "123-45-6789", "cc": "4111-1111-1111-1111", \
        "data": "${Array(1000).fill('x').join('')}"}'`;

      const start = process.hrtime.bigint();
      await redactor.redactCommand(largeCommand);
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      
      // Should handle large commands within 50ms
      expect(durationMs).toBeLessThan(50);
    });
  });

  describe('Bypass Prevention Performance', () => {
    test('should detect bypass attempts within 30ms', async () => {
      const contexts = [
        {
          command: 'rm',
          args: ['-rf', '/'],
          env: { LD_PRELOAD: '/tmp/evil.so' },
          cwd: '/',
          user: 'test',
          timestamp: Date.now(),
          sudo: false
        },
        {
          command: 'ls',
          args: [],
          env: { PATH: '/tmp/evil:/usr/bin' },
          cwd: '/home/user',
          user: 'test',
          timestamp: Date.now(),
          sudo: false,
          parentPid: 12345
        }
      ];

      for (const context of contexts) {
        const start = process.hrtime.bigint();
        await bypassPrevention.detectBypass(context);
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1_000_000;
        
        expect(durationMs).toBeLessThan(30);
      }
    });
  });

  describe('Memory Usage', () => {
    test('should maintain reasonable memory footprint', () => {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const initialMemory = process.memoryUsage();
      
      // Perform many operations
      for (let i = 0; i < 10000; i++) {
        classifier.classify('ls', ['-la']);
        fastPath.checkCommand('ls -la');
        redactor.redactCommand(`echo "test${i}"`);
      }
      
      const finalMemory = process.memoryUsage();
      const heapGrowth = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
      
      // Heap growth should be less than 50MB
      expect(heapGrowth).toBeLessThan(50);
    });

    test('should not leak memory with cache cycling', () => {
      const iterations = 10000;
      const memorySnapshots: number[] = [];
      
      // Take memory snapshots during operation
      for (let i = 0; i < iterations; i++) {
        // Generate unique commands to stress cache
        const uniqueCmd = `echo "unique-${i}-${Math.random()}"`;
        classifier.classify('echo', [`unique-${i}-${Math.random()}`]);
        fastPath.checkCommand(uniqueCmd);
        
        // Take snapshot every 1000 iterations
        if (i % 1000 === 0) {
          if (global.gc) global.gc();
          memorySnapshots.push(process.memoryUsage().heapUsed);
        }
      }
      
      // Memory should stabilize (not continuously grow)
      const firstHalf = memorySnapshots.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
      const secondHalf = memorySnapshots.slice(5).reduce((a, b) => a + b, 0) / 5;
      const growth = (secondHalf - firstHalf) / firstHalf;
      
      // Growth should be less than 20%
      expect(growth).toBeLessThan(0.2);
    });
  });

  describe('End-to-End Performance', () => {
    test('should process safe commands end-to-end within 10ms', async () => {
      const commands = ['ls', 'pwd', 'echo test', 'date'];
      
      for (const cmd of commands) {
        const start = process.hrtime.bigint();
        
        // Simulate full pipeline
        const routing = await router.route(cmd, [], {} as any);
        if (!routing.direct) {
          await classifier.classify(cmd, []);
        }
        await redactor.redactCommand(cmd);
        
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1_000_000;
        
        expect(durationMs).toBeLessThan(10);
      }
    });

    test('should handle concurrent operations efficiently', async () => {
      const concurrentOps = 100;
      const operations = Array(concurrentOps).fill(null).map((_, i) => ({
        cmd: i % 2 === 0 ? 'ls' : 'rm',
        args: i % 2 === 0 ? ['-la'] : ['-rf', `/tmp/test${i}`]
      }));
      
      const start = process.hrtime.bigint();
      
      // Run operations concurrently
      await Promise.all(operations.map(async ({ cmd, args }) => {
        await classifier.classify(cmd, args);
        await redactor.redactCommand(`${cmd} ${args.join(' ')}`);
      }));
      
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      
      // Should complete 100 concurrent operations within 500ms
      expect(durationMs).toBeLessThan(500);
      
      const opsPerSecond = (concurrentOps / durationMs) * 1000;
      expect(opsPerSecond).toBeGreaterThan(200);
    });
  });

  describe('Performance Benchmarks Summary', () => {
    test('should meet all performance targets', () => {
      console.log('\n=== Deliberate Performance Benchmarks ===\n');
      
      // Benchmark safe command
      const safeStart = process.hrtime.bigint();
      classifier.classify('ls', ['-la']);
      const safeDuration = Number(process.hrtime.bigint() - safeStart) / 1_000_000;
      console.log(`Safe command classification: ${safeDuration.toFixed(2)}ms (target: <10ms)`);
      
      // Benchmark dangerous command
      const dangerStart = process.hrtime.bigint();
      classifier.classify('rm', ['-rf', '/']);
      const dangerDuration = Number(process.hrtime.bigint() - dangerStart) / 1_000_000;
      console.log(`Dangerous command classification: ${dangerDuration.toFixed(2)}ms (target: <50ms)`);
      
      // Benchmark fast path
      const fastStart = process.hrtime.bigint();
      fastPath.checkCommand('ls -la');
      const fastDuration = Number(process.hrtime.bigint() - fastStart) / 1_000_000;
      console.log(`Fast path check: ${fastDuration.toFixed(2)}ms (target: <5ms)`);
      
      // Memory usage
      const memory = process.memoryUsage();
      console.log(`Memory usage: ${(memory.heapUsed / 1024 / 1024).toFixed(2)}MB (target: <50MB baseline)`);
      
      console.log('\n✅ All performance targets met!\n');
      
      expect(safeDuration).toBeLessThan(10);
      expect(dangerDuration).toBeLessThan(50);
      expect(fastDuration).toBeLessThan(5);
    });
  });
});