import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';
import { ConfigManager } from '../config/config-manager';
import { FastPath } from './fast-path';
import { CommandClassifier } from '../core/classification/classifier';
import { SensitiveDataRedactor } from '../core/redaction/redactor';

interface AnalysisTask {
  id: string;
  command: string;
  args: string[];
  context: any;
  priority: 'high' | 'normal' | 'low';
  timestamp: number;
}

interface WorkerTask extends AnalysisTask {
  type: 'classify' | 'redact' | 'ai_analyze';
}

interface WorkerResult {
  taskId: string;
  result: any;
  error?: string;
  duration: number;
}

export class ParallelAnalysisPipeline extends EventEmitter {
  private static instance: ParallelAnalysisPipeline;
  private workers: Map<string, Worker> = new Map();
  private taskQueue: AnalysisTask[] = [];
  private activeTasks: Map<string, AnalysisTask> = new Map();
  private logger: Logger;
  private fastPath: FastPath;
  private maxWorkers: number = 4;
  
  private constructor() {
    super();
    this.logger = new Logger('parallel-pipeline');
    this.fastPath = new FastPath();
    this.initializeWorkers();
  }
  
  static getInstance(): ParallelAnalysisPipeline {
    if (!ParallelAnalysisPipeline.instance) {
      ParallelAnalysisPipeline.instance = new ParallelAnalysisPipeline();
    }
    return ParallelAnalysisPipeline.instance;
  }
  
  /**
   * Initialize worker pool
   */
  private async initializeWorkers(): Promise<void> {
    const config = ConfigManager.getInstance();
    const parallelEnabled = config.getPath('performance.parallel_analysis');
    
    if (!parallelEnabled) {
      this.logger.info('Parallel analysis disabled in config');
      return;
    }
    
    // Determine optimal worker count
    const cpuCount = require('os').cpus().length;
    this.maxWorkers = Math.min(cpuCount - 1, 4); // Leave one CPU for main thread
    
    this.logger.info(`Initializing ${this.maxWorkers} analysis workers`);
  }
  
  /**
   * Analyze command with parallel processing
   */
  async analyzeCommand(
    command: string,
    args: string[],
    context: any = {}
  ): Promise<any> {
    const startTime = performance.now();
    
    // Check fast path first
    if (this.fastPath.isFastPathEligible(command, args)) {
      return {
        classification: 'safe',
        fastPath: true,
        duration: performance.now() - startTime
      };
    }
    
    // Create analysis task
    const task: AnalysisTask = {
      id: this.generateTaskId(),
      command,
      args,
      context,
      priority: this.determinePriority(command),
      timestamp: Date.now()
    };
    
    // Run parallel analysis
    const results = await this.runParallelAnalysis(task);
    
    return {
      ...this.mergeResults(results),
      duration: performance.now() - startTime
    };
  }
  
  /**
   * Run analysis tasks in parallel
   */
  private async runParallelAnalysis(task: AnalysisTask): Promise<WorkerResult[]> {
    const tasks: Promise<WorkerResult>[] = [];
    
    // Task 1: Classification
    tasks.push(this.runWorkerTask({
      ...task,
      type: 'classify'
    }));
    
    // Task 2: Redaction
    tasks.push(this.runWorkerTask({
      ...task,
      type: 'redact'
    }));
    
    // Task 3: AI Analysis (if enabled)
    const config = ConfigManager.getInstance();
    if (config.getPath('ai.enable_llm_analysis')) {
      tasks.push(this.runWorkerTask({
        ...task,
        type: 'ai_analyze'
      }));
    }
    
    // Wait for all tasks
    const results = await Promise.allSettled(tasks);
    
    // Extract successful results
    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<WorkerResult>).value);
  }
  
  /**
   * Run a single task in a worker
   */
  private async runWorkerTask(task: WorkerTask): Promise<WorkerResult> {
    const startTime = performance.now();
    
    try {
      // For now, run in-process (worker threads would be implemented later)
      let result: any;
      
      switch (task.type) {
        case 'classify':
          result = await this.runClassification(task);
          break;
          
        case 'redact':
          result = await this.runRedaction(task);
          break;
          
        case 'ai_analyze':
          result = await this.runAIAnalysis(task);
          break;
          
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }
      
      return {
        taskId: task.id,
        result,
        duration: performance.now() - startTime
      };
    } catch (error) {
      this.logger.error(`Worker task failed: ${error}`);
      return {
        taskId: task.id,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        duration: performance.now() - startTime
      };
    }
  }
  
  /**
   * Run classification task
   */
  private async runClassification(task: WorkerTask): Promise<any> {
    const classifier = new CommandClassifier();
    return classifier.classify(task.command, task.args);
  }
  
  /**
   * Run redaction task
   */
  private async runRedaction(task: WorkerTask): Promise<any> {
    const redactor = new SensitiveDataRedactor();
    return {
      command: redactor.redactCommand(task.command),
      args: await Promise.all(task.args.map(async arg => {
        const result = await redactor.redact(arg);
        return result.redacted;
      }))
    };
  }
  
  /**
   * Run AI analysis task
   */
  private async runAIAnalysis(_task: WorkerTask): Promise<any> {
    throw new Error('NotImplementedError: Worker-based AI analysis not implemented. This requires serialization of model state and cross-worker communication.');
  }
  
  /**
   * Merge results from parallel tasks
   */
  private mergeResults(results: WorkerResult[]): any {
    const merged: any = {
      classification: null,
      redaction: null,
      aiAnalysis: null,
      errors: []
    };
    
    for (const result of results) {
      if (result.error) {
        merged.errors.push(result.error);
        continue;
      }
      
      // Determine result type based on content
      if (result.result?.riskLevel !== undefined) {
        merged.classification = result.result;
      } else if (result.result?.command !== undefined && result.result?.args !== undefined) {
        merged.redaction = result.result;
      } else if (result.result?.aiEnabled !== undefined) {
        merged.aiAnalysis = result.result;
      }
    }
    
    return merged;
  }
  
  /**
   * Determine task priority
   */
  private determinePriority(command: string): 'high' | 'normal' | 'low' {
    const highPriorityCommands = ['rm', 'dd', 'mkfs', 'format', 'fdisk'];
    const lowPriorityCommands = ['ls', 'pwd', 'echo', 'cat'];
    
    if (highPriorityCommands.includes(command)) {
      return 'high';
    } else if (lowPriorityCommands.includes(command)) {
      return 'low';
    }
    
    return 'normal';
  }
  
  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
  
  /**
   * Get pipeline statistics
   */
  getStatistics(): any {
    return {
      queueLength: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
      workersActive: this.workers.size,
      maxWorkers: this.maxWorkers,
      fastPathStats: this.fastPath.getPerformanceReport()
    };
  }
  
  /**
   * Shutdown pipeline
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down parallel analysis pipeline');
    
    // Terminate all workers
    for (const [id, worker] of this.workers) {
      await worker.terminate();
      this.workers.delete(id);
    }
    
    // Clear queues
    this.taskQueue = [];
    this.activeTasks.clear();
  }
}