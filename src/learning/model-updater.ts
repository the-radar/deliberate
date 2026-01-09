import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';
import { ConfigManager } from '../config/config-manager';
import { LearningDataCollector } from './data-collector';

interface ModelCheckpoint {
  id: string;
  timestamp: number;
  version: string;
  metrics: {
    accuracy: number;
    loss: number;
    validationScore: number;
  };
  ewcParams?: EWCParameters;
  path: string;
}

interface EWCParameters {
  fisherInformation: Map<string, number[]>;
  optimalWeights: Map<string, number[]>;
  lambda: number; // EWC regularization strength
}

interface UpdateBatch {
  id: string;
  data: any[];
  timestamp: number;
  priority: 'high' | 'normal' | 'low';
}

export class IncrementalModelUpdater extends EventEmitter {
  private static instance: IncrementalModelUpdater;
  private logger: Logger;
  private checkpoints: ModelCheckpoint[] = [];
  private currentVersion: string = '1.0.0';
  private updateQueue: UpdateBatch[] = [];
  private isUpdating: boolean = false;
  private ewcParams?: EWCParameters;
  private modelPath: string;
  private checkpointDir: string;
  
  private constructor() {
    super();
    this.logger = new Logger('model-updater');
    this.modelPath = path.join(process.env.HOME || '', '.deliberate', 'models');
    this.checkpointDir = path.join(this.modelPath, 'checkpoints');
    this.initializeDirectories();
    this.loadCheckpoints();
    
    // Schedule periodic updates
    setInterval(() => this.checkForUpdates(), 60 * 60 * 1000); // Every hour
  }
  
  static getInstance(): IncrementalModelUpdater {
    if (!IncrementalModelUpdater.instance) {
      IncrementalModelUpdater.instance = new IncrementalModelUpdater();
    }
    return IncrementalModelUpdater.instance;
  }
  
  /**
   * Initialize required directories
   */
  private initializeDirectories(): void {
    try {
      fs.mkdirSync(this.modelPath, { recursive: true });
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create directories:', error);
    }
  }
  
  /**
   * Load existing checkpoints
   */
  private loadCheckpoints(): void {
    try {
      const checkpointFile = path.join(this.checkpointDir, 'checkpoints.json');
      if (fs.existsSync(checkpointFile)) {
        const data = fs.readFileSync(checkpointFile, 'utf-8');
        this.checkpoints = JSON.parse(data);
        
        // Load latest checkpoint
        if (this.checkpoints.length > 0) {
          const latest = this.checkpoints[this.checkpoints.length - 1];
          if (latest) {
            this.currentVersion = latest.version;
            this.loadEWCParams(latest);
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to load checkpoints:', error);
    }
  }
  
  /**
   * Load EWC parameters from checkpoint
   */
  private loadEWCParams(checkpoint: ModelCheckpoint): void {
    if (checkpoint.ewcParams) {
      this.ewcParams = {
        fisherInformation: new Map(Object.entries(checkpoint.ewcParams.fisherInformation)),
        optimalWeights: new Map(Object.entries(checkpoint.ewcParams.optimalWeights)),
        lambda: checkpoint.ewcParams.lambda
      };
    }
  }
  
  /**
   * Schedule an incremental update
   */
  async scheduleUpdate(priority: 'high' | 'normal' | 'low' = 'normal'): Promise<void> {
    const collector = LearningDataCollector.getInstance();
    const trainingData = collector.exportForTraining();
    
    if (trainingData.length < 100) {
      this.logger.info('Insufficient data for update, need at least 100 examples');
      return;
    }
    
    const batch: UpdateBatch = {
      id: crypto.randomUUID(),
      data: trainingData,
      timestamp: Date.now(),
      priority
    };
    
    this.updateQueue.push(batch);
    this.updateQueue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    this.emit('update-scheduled', batch);
    
    // Process immediately if high priority
    if (priority === 'high' && !this.isUpdating) {
      await this.processUpdateQueue();
    }
  }
  
  /**
   * Process update queue
   */
  private async processUpdateQueue(): Promise<void> {
    if (this.isUpdating || this.updateQueue.length === 0) {
      return;
    }
    
    this.isUpdating = true;
    
    try {
      const batch = this.updateQueue.shift()!;
      this.logger.info(`Processing update batch ${batch.id}`);
      
      // Prepare training data
      const trainingData = this.prepareTrainingData(batch.data);
      
      // Calculate Fisher Information Matrix for EWC
      const fisherInfo = await this.calculateFisherInformation(trainingData);
      
      // Perform incremental update with EWC
      const updateResult = await this.performIncrementalUpdate(
        trainingData,
        fisherInfo
      );
      
      // Create checkpoint
      await this.createCheckpoint(updateResult);
      
      this.emit('update-completed', {
        batchId: batch.id,
        version: this.currentVersion,
        metrics: updateResult.metrics
      });
      
    } catch (error) {
      this.logger.error('Update failed:', error);
      this.emit('update-failed', error);
    } finally {
      this.isUpdating = false;
      
      // Process next batch if available
      if (this.updateQueue.length > 0) {
        setTimeout(() => this.processUpdateQueue(), 5000);
      }
    }
  }
  
  /**
   * Prepare training data
   */
  private prepareTrainingData(rawData: any[]): any {
    // Group by command and balance dataset
    const commandGroups = new Map<string, any[]>();
    
    for (const item of rawData) {
      const command = item.input.command;
      if (!commandGroups.has(command)) {
        commandGroups.set(command, []);
      }
      commandGroups.get(command)!.push(item);
    }
    
    // Balance dataset - ensure no command dominates
    const maxPerCommand = Math.ceil(rawData.length / commandGroups.size);
    const balanced: any[] = [];
    
    for (const [, items] of commandGroups) {
      const selected = items.slice(0, maxPerCommand);
      balanced.push(...selected);
    }
    
    // Shuffle
    for (let i = balanced.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [balanced[i], balanced[j]] = [balanced[j], balanced[i]];
    }
    
    return {
      train: balanced.slice(0, Math.floor(balanced.length * 0.8)),
      validation: balanced.slice(Math.floor(balanced.length * 0.8))
    };
  }
  
  /**
   * Calculate Fisher Information Matrix for EWC
   */
  private async calculateFisherInformation(_trainingData: any): Promise<Map<string, number[]>> {
    throw new Error('NotImplementedError: Fisher Information Matrix calculation not implemented. This requires access to model gradients and proper EWC implementation.');
  }
  
  /**
   * Perform incremental update with EWC
   */
  private async performIncrementalUpdate(
    _trainingData: any,
    _fisherInfo: Map<string, number[]>
  ): Promise<any> {
    throw new Error('NotImplementedError: Incremental model training with EWC not implemented. This requires integration with a real ML framework (PyTorch/TensorFlow) and model fine-tuning capabilities.');
  }
  
  /**
   * Calculate EWC penalty
   */
  private calculateEWCPenalty(
    sample: any,
    fisherInfo: Map<string, number[]>
  ): number {
    if (!this.ewcParams) return 0;
    
    let penalty = 0;
    const command = `${sample.input.command} ${sample.input.args.join(' ')}`;
    
    // Check if this command pattern matches any important pattern
    for (const [pattern, importance] of fisherInfo) {
      if (command.includes(pattern)) {
        // EWC penalty = λ/2 * F * (θ - θ*)²
        const paramDiff = Math.random() * 0.1; // Simulated parameter difference
        const imp = importance[0];
        if (imp !== undefined) {
          penalty += this.ewcParams.lambda * 0.5 * imp * Math.pow(paramDiff, 2);
        }
      }
    }
    
    return penalty;
  }
  
  /**
   * Generate model weights
   */
  private generateMockWeights(): Map<string, number[]> {
    throw new Error('NotImplementedError: Real model weight generation not implemented. This requires integration with actual model training framework.');
  }
  
  /**
   * Create model checkpoint
   */
  private async createCheckpoint(updateResult: any): Promise<void> {
    // Increment version
    const versionParts = this.currentVersion.split('.');
    const patchVersion = versionParts[2];
    if (patchVersion !== undefined) {
      versionParts[2] = String(parseInt(patchVersion) + 1);
    }
    this.currentVersion = versionParts.join('.');
    
    const checkpoint: ModelCheckpoint = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      version: this.currentVersion,
      metrics: updateResult.metrics,
      ewcParams: {
        fisherInformation: Object.fromEntries(updateResult.fisherInformation) as any,
        optimalWeights: Object.fromEntries(updateResult.weights) as any,
        lambda: 0.5 // EWC strength
      },
      path: path.join(this.checkpointDir, `model-${this.currentVersion}.ckpt`)
    };
    
    // Save checkpoint
    this.checkpoints.push(checkpoint);
    
    // Keep only last 10 checkpoints
    if (this.checkpoints.length > 10) {
      const toRemove = this.checkpoints.shift();
      if (toRemove && fs.existsSync(toRemove.path)) {
        fs.unlinkSync(toRemove.path);
      }
    }
    
    // Save checkpoint metadata
    const checkpointFile = path.join(this.checkpointDir, 'checkpoints.json');
    fs.writeFileSync(checkpointFile, JSON.stringify(this.checkpoints, null, 2));
    
    // Update EWC parameters
    this.ewcParams = checkpoint.ewcParams;
    
    this.logger.info(`Created checkpoint ${checkpoint.version}`);
  }
  
  /**
   * Check for scheduled updates
   */
  private async checkForUpdates(): Promise<void> {
    const config = ConfigManager.getInstance();
    if (!config.getPath('learning.enable_continuous_learning')) {
      return;
    }
    
    // Check if we have enough new data
    const collector = LearningDataCollector.getInstance();
    const insights = collector.getUserInsights();
    
    if (insights.totalCommands > 500) {
      this.logger.info('Scheduling periodic model update');
      await this.scheduleUpdate('normal');
    }
  }
  
  /**
   * Rollback to previous checkpoint
   */
  async rollback(version?: string): Promise<void> {
    let targetCheckpoint: ModelCheckpoint | undefined;
    
    if (version) {
      targetCheckpoint = this.checkpoints.find(c => c.version === version);
    } else if (this.checkpoints.length > 1) {
      // Rollback to previous version
      targetCheckpoint = this.checkpoints[this.checkpoints.length - 2];
    }
    
    if (!targetCheckpoint) {
      throw new Error('No checkpoint found to rollback to');
    }
    
    this.currentVersion = targetCheckpoint.version;
    this.loadEWCParams(targetCheckpoint);
    
    this.logger.info(`Rolled back to version ${this.currentVersion}`);
    this.emit('rollback', targetCheckpoint);
  }
  
  /**
   * Get update statistics
   */
  getStatistics(): any {
    const latestCheckpoint = this.checkpoints[this.checkpoints.length - 1];
    
    return {
      currentVersion: this.currentVersion,
      totalCheckpoints: this.checkpoints.length,
      queuedUpdates: this.updateQueue.length,
      isUpdating: this.isUpdating,
      latestMetrics: latestCheckpoint?.metrics,
      ewcEnabled: !!this.ewcParams,
      checkpoints: this.checkpoints.map(c => ({
        version: c.version,
        timestamp: new Date(c.timestamp).toISOString(),
        metrics: c.metrics
      }))
    };
  }
}