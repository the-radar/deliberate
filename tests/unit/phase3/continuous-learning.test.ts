import { LearningDataCollector } from '../../../src/learning/data-collector';
import { IncrementalModelUpdater } from '../../../src/learning/incremental-updater';
import { FederatedLearningCoordinator } from '../../../src/learning/federated-coordinator';
import { ConfigManager } from '../../../src/config/config-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Tests for Phase 3 Continuous Learning System
 * 
 * Verifies data collection, model updates, and federated learning
 */

describe('Phase 3 Continuous Learning Tests', () => {
  let collector: LearningDataCollector;
  let updater: IncrementalModelUpdater;
  let coordinator: FederatedLearningCoordinator;
  let configManager: ConfigManager;
  let tempDir: string;

  beforeAll(() => {
    // Create temp directory for test data
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-learning-test-'));
    
    // Initialize config manager with test config
    configManager = ConfigManager.getInstance();
    configManager.updateConfig({
      learning: {
        data_collection: true,
        privacy_level: 'medium',
        federated_enabled: true
      }
    });
  });

  afterAll(() => {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Get fresh instances
    collector = LearningDataCollector.getInstance();
    updater = new IncrementalModelUpdater();
    coordinator = new FederatedLearningCoordinator();
    
    // Clear any existing data
    (collector as any).events = [];
    (collector as any).userPatterns.clear();
  });

  describe('Learning Data Collection', () => {
    test('should collect learning events when enabled', () => {
      const event = {
        command: 'rm',
        args: ['-rf', '/tmp/test'],
        classification: 'dangerous',
        userDecision: 'rejected' as const,
        context: {
          cwd: '/home/user/project',
          confidence: 0.9,
          verdict: 'BLOCK' as const
        }
      };

      collector.recordEvent(event);

      const events = (collector as any).events;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        command: 'rm',
        classification: 'dangerous',
        userDecision: 'rejected'
      });
    });

    test('should anonymize data based on privacy level', () => {
      // Test medium privacy level
      configManager.updateConfig({
        learning: { privacy_level: 'medium' }
      });

      collector.recordEvent({
        command: 'cat',
        args: [`${os.homedir()}/secret.txt`, 'user@example.com'],
        classification: 'safe',
        userDecision: 'approved' as const
      });

      const events = (collector as any).events;
      expect(events[0].args[0]).toBe('<HOME>/secret.txt');
      expect(events[0].args[1]).toBe('<EMAIL>');
    });

    test('should not collect data when disabled', () => {
      configManager.updateConfig({
        learning: { data_collection: false }
      });

      collector.recordEvent({
        command: 'ls',
        args: [],
        classification: 'safe',
        userDecision: 'approved' as const
      });

      const events = (collector as any).events;
      expect(events).toHaveLength(0);
    });

    test('should track user patterns', () => {
      // Record same command multiple times
      for (let i = 0; i < 5; i++) {
        collector.recordEvent({
          command: 'git',
          args: ['push', 'origin', 'main'],
          classification: 'moderate',
          userDecision: 'approved' as const,
          outcome: 'success' as const
        });
      }

      const patterns = (collector as any).userPatterns;
      const pattern = patterns.get('git push origin main');
      
      expect(pattern).toBeDefined();
      expect(pattern.frequency).toBe(5);
      expect(pattern.outcomes.success).toBe(5);
    });

    test('should identify valuable learning events', () => {
      const events = [
        // User override - valuable
        {
          command: 'rm',
          args: ['file.txt'],
          classification: 'dangerous',
          userDecision: 'modified' as const,
          context: { cwd: '/tmp', confidence: 0.9 }
        },
        // Low confidence approved - valuable
        {
          command: 'curl',
          args: ['http://example.com'],
          classification: 'moderate',
          userDecision: 'approved' as const,
          context: { cwd: '/tmp', confidence: 0.6 }
        },
        // High confidence rejected - valuable
        {
          command: 'chmod',
          args: ['777', '.'],
          classification: 'safe',
          userDecision: 'rejected' as const,
          context: { cwd: '/tmp', confidence: 0.85 }
        },
        // Normal event - not valuable
        {
          command: 'ls',
          args: [],
          classification: 'safe',
          userDecision: 'approved' as const,
          context: { cwd: '/tmp', confidence: 0.95 }
        }
      ];

      events.forEach(e => collector.recordEvent(e));
      
      const valuableEvents = (collector as any).filterValuableEvents(
        (collector as any).events
      );
      
      expect(valuableEvents).toHaveLength(3);
      expect(valuableEvents.some(e => e.command === 'ls')).toBe(false);
    });

    test('should prepare training batches', (done) => {
      collector.on('training-batch', (batch) => {
        expect(batch.events).toHaveLength(10);
        expect(batch.patterns).toBeDefined();
        expect(batch.timestamp).toBeDefined();
        done();
      });

      // Record enough valuable events
      for (let i = 0; i < 10; i++) {
        collector.recordEvent({
          command: 'rm',
          args: [`file${i}.txt`],
          classification: 'dangerous',
          userDecision: 'modified' as const,
          context: { cwd: '/tmp', confidence: 0.5 }
        });
      }
    });

    test('should export data for training', () => {
      collector.recordEvent({
        command: 'docker',
        args: ['run', 'nginx'],
        classification: 'moderate',
        userDecision: 'approved' as const,
        context: {
          cwd: '/home/user',
          confidence: 0.75,
          verdict: 'WARN' as const
        },
        outcome: 'success' as const
      });

      const trainingData = collector.exportForTraining();
      
      expect(trainingData).toHaveLength(1);
      expect(trainingData[0]).toMatchObject({
        instruction: 'Analyze command safety based on user patterns and context',
        input: {
          command: 'docker',
          args: ['run', 'nginx']
        },
        output: {
          classification: 'moderate',
          userDecision: 'approved',
          verdict: 'WARN'
        }
      });
    });

    test('should provide user insights', () => {
      // Record various events
      for (let i = 0; i < 20; i++) {
        collector.recordEvent({
          command: i < 15 ? 'git' : 'rm',
          args: ['arg'],
          classification: 'safe',
          userDecision: i < 18 ? 'approved' as const : 'rejected' as const,
          context: { cwd: '/tmp', confidence: 0.8 },
          outcome: i % 5 === 0 ? 'error' as const : 'success' as const
        });
      }

      const insights = collector.getUserInsights();
      
      expect(insights.totalCommands).toBe(20);
      expect(insights.approvalRate).toBeCloseTo(0.9, 1);
      expect(insights.commonCommands[0].command).toBe('git');
      expect(insights.commonCommands[0].frequency).toBe(15);
    });

    test('should clean up old events', () => {
      // Add old event
      const oldEvent = {
        id: 'old-event',
        timestamp: Date.now() - 35 * 24 * 60 * 60 * 1000, // 35 days ago
        command: 'old',
        args: [],
        classification: 'safe',
        userDecision: 'approved' as const,
        context: { cwd: '/', confidence: 0.9 }
      };
      
      (collector as any).events.push(oldEvent);
      
      // Add recent event
      collector.recordEvent({
        command: 'new',
        args: [],
        classification: 'safe',
        userDecision: 'approved' as const
      });

      collector.cleanup();
      
      const events = (collector as any).events;
      expect(events).toHaveLength(1);
      expect(events[0].command).toBe('new');
    });
  });

  describe('Incremental Model Updates', () => {
    test('should prepare model update from learning data', async () => {
      // Record training data
      for (let i = 0; i < 50; i++) {
        collector.recordEvent({
          command: 'test',
          args: [`arg${i}`],
          classification: 'safe',
          userDecision: 'approved' as const,
          context: { cwd: '/tmp', confidence: 0.8 }
        });
      }

      const trainingData = collector.exportForTraining();
      const update = await updater.prepareUpdate(trainingData);
      
      expect(update).toBeDefined();
      expect(update.dataCount).toBe(50);
      expect(update.patterns).toBeDefined();
      expect(update.weights).toBeDefined();
    });

    test('should apply incremental updates to model', async () => {
      const mockUpdate = {
        dataCount: 100,
        patterns: [
          { command: 'git', args: 'push', frequency: 20 },
          { command: 'docker', args: 'run', frequency: 15 }
        ],
        weights: new Float32Array(100),
        timestamp: Date.now()
      };

      const result = await updater.applyUpdate(mockUpdate);
      
      expect(result.success).toBe(true);
      expect(result.version).toBeDefined();
      expect(result.metrics).toBeDefined();
    });

    test('should validate update quality before applying', async () => {
      // Create low quality update
      const badUpdate = {
        dataCount: 5, // Too few samples
        patterns: [],
        weights: new Float32Array(100),
        timestamp: Date.now()
      };

      const validation = await updater.validateUpdate(badUpdate);
      
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('Insufficient data');
    });

    test('should track update history', async () => {
      // Apply multiple updates
      for (let i = 0; i < 3; i++) {
        await updater.applyUpdate({
          dataCount: 50,
          patterns: [{ command: 'test', args: 'arg', frequency: 10 }],
          weights: new Float32Array(100),
          timestamp: Date.now() + i * 1000
        });
      }

      const history = updater.getUpdateHistory();
      
      expect(history).toHaveLength(3);
      expect(history[0].version).toBeDefined();
      expect(history[0].timestamp).toBeDefined();
    });

    test('should rollback to previous version if needed', async () => {
      // Apply updates
      await updater.applyUpdate({
        dataCount: 50,
        patterns: [],
        weights: new Float32Array(100),
        timestamp: Date.now()
      });
      
      const version1 = updater.getCurrentVersion();
      
      await updater.applyUpdate({
        dataCount: 50,
        patterns: [],
        weights: new Float32Array(100),
        timestamp: Date.now() + 1000
      });

      // Rollback
      const result = await updater.rollback(version1);
      
      expect(result.success).toBe(true);
      expect(updater.getCurrentVersion()).toBe(version1);
    });
  });

  describe('Federated Learning', () => {
    test('should initialize federated learning coordinator', async () => {
      const result = await coordinator.initialize({
        nodeId: 'test-node',
        role: 'contributor' as const,
        privacyBudget: 10
      });
      
      expect(result.success).toBe(true);
      expect(coordinator.getNodeId()).toBe('test-node');
    });

    test('should prepare local contribution', async () => {
      await coordinator.initialize({
        nodeId: 'test-node',
        role: 'contributor' as const,
        privacyBudget: 10
      });

      // Create some learning data
      const localData = Array(100).fill(null).map((_, i) => ({
        command: `cmd${i % 10}`,
        classification: 'safe',
        confidence: Math.random()
      }));

      const contribution = await coordinator.prepareContribution(localData);
      
      expect(contribution).toBeDefined();
      expect(contribution.nodeId).toBe('test-node');
      expect(contribution.dataCount).toBe(100);
      expect(contribution.gradients).toBeDefined();
      expect(contribution.noise).toBeGreaterThan(0); // Privacy noise added
    });

    test('should aggregate contributions from multiple nodes', async () => {
      const contributions = [
        {
          nodeId: 'node1',
          dataCount: 100,
          gradients: new Float32Array(100).fill(0.1),
          noise: 0.01,
          timestamp: Date.now()
        },
        {
          nodeId: 'node2',
          dataCount: 150,
          gradients: new Float32Array(100).fill(0.2),
          noise: 0.01,
          timestamp: Date.now()
        },
        {
          nodeId: 'node3',
          dataCount: 50,
          gradients: new Float32Array(100).fill(0.05),
          noise: 0.01,
          timestamp: Date.now()
        }
      ];

      const aggregated = await coordinator.aggregate(contributions);
      
      expect(aggregated).toBeDefined();
      expect(aggregated.totalDataCount).toBe(300);
      expect(aggregated.participantCount).toBe(3);
      expect(aggregated.globalGradients).toBeDefined();
      
      // Check weighted average
      const expectedAvg = (0.1 * 100 + 0.2 * 150 + 0.05 * 50) / 300;
      expect(aggregated.globalGradients[0]).toBeCloseTo(expectedAvg, 4);
    });

    test('should enforce privacy budget', async () => {
      await coordinator.initialize({
        nodeId: 'test-node',
        role: 'contributor' as const,
        privacyBudget: 2 // Very limited budget
      });

      // First contribution should work
      const contrib1 = await coordinator.prepareContribution([]);
      expect(contrib1).toBeDefined();

      // Second contribution should work
      const contrib2 = await coordinator.prepareContribution([]);
      expect(contrib2).toBeDefined();

      // Third contribution should fail (budget exhausted)
      await expect(coordinator.prepareContribution([])).rejects.toThrow('Privacy budget exhausted');
    });

    test('should handle coordinator role', async () => {
      await coordinator.initialize({
        nodeId: 'coordinator-node',
        role: 'coordinator' as const,
        privacyBudget: 100
      });

      const round = await coordinator.startRound();
      
      expect(round).toBeDefined();
      expect(round.roundId).toBeDefined();
      expect(round.status).toBe('collecting');
      expect(round.targetNodes).toBeGreaterThan(0);
    });

    test('should validate contribution signatures', async () => {
      const validContribution = {
        nodeId: 'node1',
        dataCount: 100,
        gradients: new Float32Array(100),
        noise: 0.01,
        timestamp: Date.now(),
        signature: 'valid-signature'
      };

      const invalidContribution = {
        ...validContribution,
        signature: 'invalid-signature'
      };

      const validResult = await coordinator.validateContribution(validContribution);
      expect(validResult.valid).toBe(true);

      const invalidResult = await coordinator.validateContribution(invalidContribution);
      expect(invalidResult.valid).toBe(false);
    });
  });

  describe('Learning Performance', () => {
    test('should collect data with minimal overhead', () => {
      const iterations = 1000;
      const start = process.hrtime.bigint();
      
      for (let i = 0; i < iterations; i++) {
        collector.recordEvent({
          command: 'test',
          args: ['arg'],
          classification: 'safe',
          userDecision: 'approved' as const
        });
      }
      
      const end = process.hrtime.bigint();
      const avgTimeMs = Number(end - start) / iterations / 1_000_000;
      
      // Should average less than 1ms per event
      expect(avgTimeMs).toBeLessThan(1);
    });

    test('should handle concurrent learning updates', async () => {
      const promises = [];
      
      // Simulate concurrent updates from multiple sources
      for (let i = 0; i < 10; i++) {
        promises.push(
          updater.applyUpdate({
            dataCount: 50,
            patterns: [],
            weights: new Float32Array(100),
            timestamp: Date.now() + i
          })
        );
      }

      const results = await Promise.all(promises);
      
      // All updates should succeed
      expect(results.every(r => r.success)).toBe(true);
      
      // Should have sequential versions
      const versions = results.map(r => r.version).sort();
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i]).toBeGreaterThan(versions[i - 1]);
      }
    });
  });

  describe('Privacy Protection', () => {
    test('should apply differential privacy to contributions', async () => {
      await coordinator.initialize({
        nodeId: 'test-node',
        role: 'contributor' as const,
        privacyBudget: 10,
        epsilon: 1.0 // Privacy parameter
      });

      const sensitiveData = [
        { command: 'mysql', args: '-p secretpassword', classification: 'dangerous' },
        { command: 'curl', args: 'http://internal.api/secret', classification: 'moderate' }
      ];

      const contribution = await coordinator.prepareContribution(sensitiveData);
      
      // Should have noise added
      expect(contribution.noise).toBeGreaterThan(0);
      
      // Gradients should be clipped
      const maxGradient = Math.max(...contribution.gradients);
      expect(maxGradient).toBeLessThanOrEqual(1.0); // Assuming clipping at 1.0
    });

    test('should anonymize high privacy level data completely', () => {
      configManager.updateConfig({
        learning: { privacy_level: 'high' }
      });

      collector.recordEvent({
        command: 'scp',
        args: [
          'user@192.168.1.100:/home/user/secret.key',
          '/Users/john/Downloads/'
        ],
        classification: 'dangerous',
        userDecision: 'approved' as const
      });

      const events = (collector as any).events;
      expect(events[0].args[0]).toBe('<USER>@<IP>:<PATH>');
      expect(events[0].args[1]).toBe('<PATH>');
    });
  });
});
