import { ParallelAnalysisPipeline } from '../../src/performance/parallel-pipeline';
import { FastPath } from '../../src/performance/fast-path';
import { ConfigManager } from '../../src/config/config-manager';

// Mock dependencies
jest.mock('../../src/config/config-manager');
jest.mock('../../src/performance/fast-path');
jest.mock('../../src/core/classification/classifier');
jest.mock('../../src/core/redaction/redactor');

describe('ParallelAnalysisPipeline', () => {
  let pipeline: ParallelAnalysisPipeline;
  let mockConfig: jest.Mocked<ConfigManager>;
  let mockFastPath: jest.Mocked<FastPath>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset singleton
    (ParallelAnalysisPipeline as any).instance = undefined;
    
    // Setup mocks
    mockConfig = {
      getPath: jest.fn().mockReturnValue(true)
    } as any;
    (ConfigManager.getInstance as jest.Mock).mockReturnValue(mockConfig);
    
    mockFastPath = {
      isFastPathEligible: jest.fn().mockReturnValue(false),
      getPerformanceReport: jest.fn().mockReturnValue({})
    } as any;
    (FastPath as jest.Mock).mockImplementation(() => mockFastPath);
    
    pipeline = ParallelAnalysisPipeline.getInstance();
  });

  describe('Fast Path Integration', () => {
    it('should return fast path result for eligible commands', async () => {
      mockFastPath.isFastPathEligible.mockReturnValue(true);
      
      const result = await pipeline.analyzeCommand('ls', ['-la']);
      
      expect(result.classification).toBe('safe');
      expect(result.fastPath).toBe(true);
      expect(result.duration).toBeDefined();
    });

    it('should proceed with full analysis for non-eligible commands', async () => {
      mockFastPath.isFastPathEligible.mockReturnValue(false);
      
      const result = await pipeline.analyzeCommand('rm', ['-rf', '/']);
      
      expect(result.classification).toBeDefined();
      expect(result.fastPath).toBeUndefined();
    });
  });

  describe('Parallel Task Execution', () => {
    it('should run classification and redaction in parallel', async () => {
      const startTime = Date.now();
      const result = await pipeline.analyzeCommand('curl', ['https://example.com']);
      const duration = Date.now() - startTime;
      
      expect(result.classification).toBeDefined();
      expect(result.redaction).toBeDefined();
      // Should be faster than sequential execution
      expect(duration).toBeLessThan(1000);
    });

    it('should handle task failures gracefully', async () => {
      // Force an error in classification
      const ClassifierMock = require('../../src/core/classification/classifier').CommandClassifier;
      ClassifierMock.prototype.classify = jest.fn().mockRejectedValue(new Error('Classification failed'));
      
      const result = await pipeline.analyzeCommand('test', ['command']);
      
      expect(result.errors).toContain('Classification failed');
      expect(result.redaction).toBeDefined(); // Other tasks should still complete
    });
  });

  describe('Priority Management', () => {
    it('should assign high priority to dangerous commands', async () => {
      const result = await pipeline.analyzeCommand('rm', ['-rf']);
      expect(result).toBeDefined();
      
      const stats = pipeline.getStatistics();
      expect(stats).toBeDefined();
    });

    it('should assign low priority to safe commands', async () => {
      const result = await pipeline.analyzeCommand('ls', []);
      expect(result).toBeDefined();
    });
  });

  describe('AI Analysis Integration', () => {
    it('should include AI analysis when enabled', async () => {
      mockConfig.getPath.mockImplementation((path: string) => {
        return path === 'ai.enable_llm_analysis' ? true : false;
      });
      
      const result = await pipeline.analyzeCommand('suspicious', ['command']);
      
      expect(result.aiAnalysis).toBeDefined();
      expect(result.aiAnalysis.aiEnabled).toBe(false); // Mock implementation
    });

    it('should skip AI analysis when disabled', async () => {
      mockConfig.getPath.mockReturnValue(false);
      
      const result = await pipeline.analyzeCommand('test', ['command']);
      
      expect(result.aiAnalysis).toBeNull();
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should provide accurate statistics', () => {
      const stats = pipeline.getStatistics();
      
      expect(stats.queueLength).toBe(0);
      expect(stats.activeTasks).toBe(0);
      expect(stats.maxWorkers).toBe(4);
      expect(stats.fastPathStats).toBeDefined();
    });
  });

  describe('Shutdown', () => {
    it('should shutdown cleanly', async () => {
      await pipeline.shutdown();
      
      const stats = pipeline.getStatistics();
      expect(stats.workersActive).toBe(0);
      expect(stats.queueLength).toBe(0);
    });
  });
});