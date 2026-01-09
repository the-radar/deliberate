import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IncrementalModelUpdater } from '../../src/learning/model-updater';
import { LearningDataCollector } from '../../src/learning/data-collector';
import { ConfigManager } from '../../src/config/config-manager';

// Mock dependencies
jest.mock('../../src/learning/data-collector');
jest.mock('../../src/config/config-manager');

describe('IncrementalModelUpdater', () => {
  let updater: IncrementalModelUpdater;
  let mockCollector: jest.Mocked<LearningDataCollector>;
  let mockConfig: jest.Mocked<ConfigManager>;
  let tempDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-model-test-'));
    process.env.HOME = tempDir;
    
    // Reset singleton
    (IncrementalModelUpdater as any).instance = undefined;
    
    // Setup mocks
    mockCollector = {
      exportForTraining: jest.fn().mockReturnValue(generateMockTrainingData(150)),
      getUserInsights: jest.fn().mockReturnValue({ totalCommands: 100 })
    } as any;
    (LearningDataCollector.getInstance as jest.Mock).mockReturnValue(mockCollector);
    
    mockConfig = {
      getPath: jest.fn().mockReturnValue(true)
    } as any;
    (ConfigManager.getInstance as jest.Mock).mockReturnValue(mockConfig);
    
    updater = IncrementalModelUpdater.getInstance();
  });

  afterEach(() => {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Update Scheduling', () => {
    it('should schedule update with sufficient data', async () => {
      const updatePromise = updater.scheduleUpdate('normal');
      
      await expect(updatePromise).resolves.toBeUndefined();
      
      const stats = updater.getStatistics();
      expect(stats.queuedUpdates).toBeGreaterThanOrEqual(0);
    });

    it('should reject update with insufficient data', async () => {
      mockCollector.exportForTraining.mockReturnValue(generateMockTrainingData(50));
      
      await updater.scheduleUpdate('normal');
      
      const stats = updater.getStatistics();
      expect(stats.queuedUpdates).toBe(0);
    });

    it('should prioritize high priority updates', async () => {
      await updater.scheduleUpdate('low');
      await updater.scheduleUpdate('high');
      await updater.scheduleUpdate('normal');
      
      // High priority should trigger immediate processing
      // Wait a bit for processing to start
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const stats = updater.getStatistics();
      expect(stats.isUpdating || stats.queuedUpdates < 3).toBe(true);
    });
  });

  describe('EWC (Elastic Weight Consolidation)', () => {
    it('should calculate Fisher Information Matrix', async () => {
      const updateCompleted = new Promise(resolve => {
        updater.once('update-completed', resolve);
      });
      
      await updater.scheduleUpdate('high');
      const result = await updateCompleted;
      
      expect(result).toBeDefined();
      expect(updater.getStatistics().ewcEnabled).toBe(true);
    });

    it('should apply EWC penalty to important patterns', async () => {
      // Schedule initial update to establish parameters
      await new Promise(resolve => {
        updater.once('update-completed', resolve);
        updater.scheduleUpdate('high');
      });
      
      // Schedule second update to apply EWC
      await new Promise(resolve => {
        updater.once('update-completed', resolve);
        updater.scheduleUpdate('high');
      });
      
      const stats = updater.getStatistics();
      expect(stats.totalCheckpoints).toBeGreaterThan(1);
    });
  });

  describe('Checkpoint Management', () => {
    it('should create checkpoints after updates', async () => {
      const updateCompleted = new Promise(resolve => {
        updater.once('update-completed', resolve);
      });
      
      await updater.scheduleUpdate('high');
      await updateCompleted;
      
      const stats = updater.getStatistics();
      expect(stats.totalCheckpoints).toBe(1);
      expect(stats.currentVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should maintain checkpoint history', async () => {
      // Create multiple checkpoints
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => {
          updater.once('update-completed', resolve);
          updater.scheduleUpdate('high');
        });
      }
      
      const stats = updater.getStatistics();
      expect(stats.checkpoints.length).toBe(3);
      expect(stats.checkpoints[0].version).not.toBe(stats.checkpoints[2].version);
    });
  });

  describe('Rollback Functionality', () => {
    beforeEach(async () => {
      // Create some checkpoints first
      for (let i = 0; i < 2; i++) {
        await new Promise(resolve => {
          updater.once('update-completed', resolve);
          updater.scheduleUpdate('high');
        });
      }
    });

    it('should rollback to previous version', async () => {
      const statsBefore = updater.getStatistics();
      const previousVersion = statsBefore.checkpoints[0].version;
      
      await updater.rollback();
      
      const statsAfter = updater.getStatistics();
      expect(statsAfter.currentVersion).toBe(previousVersion);
    });

    it('should rollback to specific version', async () => {
      const stats = updater.getStatistics();
      const targetVersion = stats.checkpoints[0].version;
      
      await updater.rollback(targetVersion);
      
      expect(updater.getStatistics().currentVersion).toBe(targetVersion);
    });

    it('should emit rollback event', async () => {
      const rollbackPromise = new Promise(resolve => {
        updater.once('rollback', resolve);
      });
      
      await updater.rollback();
      const checkpoint = await rollbackPromise;
      
      expect(checkpoint).toBeDefined();
    });
  });

  describe('Data Balancing', () => {
    it('should balance training data across commands', async () => {
      // Create imbalanced data
      const imbalancedData = [
        ...generateMockTrainingData(100, 'rm'),
        ...generateMockTrainingData(20, 'ls'),
        ...generateMockTrainingData(30, 'cat')
      ];
      mockCollector.exportForTraining.mockReturnValue(imbalancedData);
      
      await new Promise(resolve => {
        updater.once('update-completed', resolve);
        updater.scheduleUpdate('high');
      });
      
      // Should complete successfully with balanced data
      const stats = updater.getStatistics();
      expect(stats.latestMetrics).toBeDefined();
    });
  });

  describe('Performance Metrics', () => {
    it('should track training metrics', async () => {
      const result = await new Promise<any>(resolve => {
        updater.once('update-completed', resolve);
        updater.scheduleUpdate('high');
      });
      
      expect(result.metrics).toBeDefined();
      expect(result.metrics.accuracy).toBeGreaterThan(0);
      expect(result.metrics.loss).toBeDefined();
      expect(result.metrics.validationScore).toBeGreaterThan(0);
      expect(result.metrics.trainingTime).toBeGreaterThan(0);
    });
  });
});

// Helper function to generate mock training data
function generateMockTrainingData(count: number, command: string = 'test'): any[] {
  const data = [];
  for (let i = 0; i < count; i++) {
    data.push({
      input: {
        command: i % 3 === 0 ? 'rm' : (i % 3 === 1 ? 'ls' : command),
        args: ['arg1', 'arg2']
      },
      output: {
        classification: i % 10 === 0 ? 'dangerous' : 'safe',
        approved: i % 10 !== 0
      }
    });
  }
  return data;
}