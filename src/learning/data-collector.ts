import * as crypto from 'crypto';
import * as os from 'os';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';
import { ConfigManager } from '../config/config-manager';

interface LearningEvent {
  id: string;
  timestamp: number;
  command: string;
  args: string[];
  classification: string;
  userDecision: 'approved' | 'rejected' | 'modified';
  context: {
    cwd: string;
    userPattern?: string;
    confidence: number;
    aiAnalysis?: boolean;
    verdict?: 'ALLOW' | 'WARN' | 'BLOCK';
  };
  outcome?: 'success' | 'error' | 'cancelled';
  metadata?: {
    executionTime?: number;
    exitCode?: number;
    errorMessage?: string;
  };
}

interface UserPattern {
  pattern: string;
  frequency: number;
  lastSeen: number;
  outcomes: {
    success: number;
    error: number;
    cancelled: number;
  };
}

export class LearningDataCollector extends EventEmitter {
  private static instance: LearningDataCollector;
  private events: LearningEvent[] = [];
  private maxEvents: number = 10000;
  private anonymizer: DataAnonymizer;
  private logger: Logger;
  private userPatterns: Map<string, UserPattern> = new Map();
  private batchSize: number = 100;
  private batchTimer?: NodeJS.Timeout;
  
  private constructor() {
    super();
    this.logger = new Logger('learning-collector');
    this.anonymizer = new DataAnonymizer();
    
    // Check if learning is enabled
    const config = ConfigManager.getInstance();
    if (!config.get('learning').data_collection) {
      this.logger.info('Learning data collection is disabled');
    }
  }
  
  static getInstance(): LearningDataCollector {
    if (!LearningDataCollector.instance) {
      LearningDataCollector.instance = new LearningDataCollector();
    }
    return LearningDataCollector.instance;
  }
  
  /**
   * Record a learning event
   */
  recordEvent(event: Partial<LearningEvent>): void {
    const config = ConfigManager.getInstance();
    if (!config.get('learning').data_collection) {
      return;
    }
    
    const fullEvent: LearningEvent = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      command: '',
      args: [],
      classification: 'unknown',
      userDecision: 'approved',
      context: {
        cwd: process.cwd(),
        confidence: 0
      },
      ...event
    };
    
    // Anonymize based on privacy level
    const privacyLevel = config.get('learning').privacy_level;
    fullEvent.command = this.anonymizer.anonymizeCommand(fullEvent.command, privacyLevel);
    fullEvent.args = fullEvent.args.map(arg => this.anonymizer.anonymizeArg(arg, privacyLevel));
    
    // Update user patterns
    this.updateUserPatterns(fullEvent);
    
    // Add to events
    this.events.push(fullEvent);
    
    // Trim old events
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
    
    // Emit for real-time processing
    this.emit('learning-event', fullEvent);
    
    // Check if batch is ready
    this.checkBatch();
    
    this.logger.debug('Recorded learning event', {
      command: fullEvent.command,
      decision: fullEvent.userDecision,
      confidence: fullEvent.context.confidence
    });
  }
  
  /**
   * Update user patterns
   */
  private updateUserPatterns(event: LearningEvent): void {
    const patternKey = `${event.command} ${event.args.join(' ')}`;
    
    if (!this.userPatterns.has(patternKey)) {
      this.userPatterns.set(patternKey, {
        pattern: patternKey,
        frequency: 0,
        lastSeen: event.timestamp,
        outcomes: {
          success: 0,
          error: 0,
          cancelled: 0
        }
      });
    }
    
    const pattern = this.userPatterns.get(patternKey)!;
    pattern.frequency++;
    pattern.lastSeen = event.timestamp;
    
    if (event.outcome) {
      pattern.outcomes[event.outcome]++;
    }
  }
  
  /**
   * Check if batch is ready for processing
   */
  private checkBatch(): void {
    // Clear existing timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    
    // Check if we have enough events
    if (this.events.length >= this.batchSize) {
      this.prepareBatch();
    } else {
      // Set timer for batch processing
      this.batchTimer = setTimeout(() => {
        if (this.events.length > 0) {
          this.prepareBatch();
        }
      }, 30000); // 30 seconds
    }
  }
  
  /**
   * Prepare a batch for training
   */
  private prepareBatch(): void {
    const recentEvents = this.events.slice(-this.batchSize);
    
    // Filter high-value learning events
    const valuableEvents = this.filterValuableEvents(recentEvents);
    
    if (valuableEvents.length >= 10) {
      this.emit('training-batch', {
        events: valuableEvents,
        patterns: this.extractPatterns(valuableEvents),
        timestamp: Date.now()
      });
      
      this.logger.info(`Prepared training batch with ${valuableEvents.length} events`);
    }
  }
  
  /**
   * Filter events that are valuable for learning
   */
  private filterValuableEvents(events: LearningEvent[]): LearningEvent[] {
    return events.filter(e => {
      // User overrides are most valuable
      if (e.userDecision === 'modified') return true;
      
      // Low confidence decisions that user approved
      if (e.context.confidence < 0.7 && e.userDecision === 'approved') return true;
      
      // High confidence decisions that user rejected
      if (e.context.confidence > 0.8 && e.userDecision === 'rejected') return true;
      
      // Commands with unexpected outcomes
      if (e.outcome === 'error' && e.classification === 'safe') return true;
      
      // New patterns not seen before
      const patternKey = `${e.command} ${e.args.join(' ')}`;
      const pattern = this.userPatterns.get(patternKey);
      if (pattern && pattern.frequency === 1) return true;
      
      return false;
    });
  }
  
  /**
   * Extract patterns from events
   */
  private extractPatterns(events: LearningEvent[]): any[] {
    const patterns: any[] = [];
    
    // Group by command
    const commandGroups = new Map<string, LearningEvent[]>();
    for (const event of events) {
      if (!commandGroups.has(event.command)) {
        commandGroups.set(event.command, []);
      }
      const group = commandGroups.get(event.command);
      if (group) {
        group.push(event);
      }
    }
    
    // Extract patterns for each command
    for (const [command, commandEvents] of commandGroups) {
      // User preference pattern
      const approvalRate = commandEvents.filter(e => e.userDecision === 'approved').length / commandEvents.length;
      
      patterns.push({
        type: 'user_preference',
        command,
        approvalRate,
        sampleSize: commandEvents.length,
        contexts: commandEvents.map(e => ({
          cwd: e.context.cwd,
          confidence: e.context.confidence
        }))
      });
      
      // Argument patterns
      const argPatterns = this.extractArgPatterns(commandEvents);
      patterns.push(...argPatterns);
    }
    
    return patterns;
  }
  
  /**
   * Extract argument patterns
   */
  private extractArgPatterns(events: LearningEvent[]): any[] {
    const patterns: any[] = [];
    const argGroups = new Map<string, number>();
    
    for (const event of events) {
      const argKey = event.args.join(' ');
      argGroups.set(argKey, (argGroups.get(argKey) || 0) + 1);
    }
    
    // Find common argument patterns
    for (const [args, count] of argGroups) {
      if (count >= 2) {
        patterns.push({
          type: 'argument_pattern',
          command: events[0]?.command || 'unknown',
          args,
          frequency: count,
          approvalRate: events.filter(e => 
            e.args.join(' ') === args && e.userDecision === 'approved'
          ).length / count
        });
      }
    }
    
    return patterns;
  }
  
  /**
   * Export data for training
   */
  exportForTraining(): any[] {
    return this.events.map(e => ({
      instruction: 'Analyze command safety based on user patterns and context',
      input: {
        command: e.command,
        args: e.args,
        context: {
          cwd: e.context.cwd,
          confidence: e.context.confidence,
          aiAnalysis: e.context.aiAnalysis || false
        }
      },
      output: {
        classification: e.classification,
        userDecision: e.userDecision,
        verdict: e.context.verdict
      },
      metadata: {
        timestamp: e.timestamp,
        outcome: e.outcome,
        patternFrequency: this.userPatterns.get(`${e.command} ${e.args.join(' ')}`)?.frequency || 1
      }
    }));
  }
  
  /**
   * Get user insights
   */
  getUserInsights(): any {
    const insights = {
      totalCommands: this.events.length,
      approvalRate: 0,
      commonCommands: [] as any[],
      riskyPatterns: [] as any[],
      learningProgress: {
        confidenceImprovement: 0,
        patternRecognition: 0
      }
    };
    
    // Calculate approval rate
    const approved = this.events.filter(e => e.userDecision === 'approved').length;
    insights.approvalRate = this.events.length > 0 ? approved / this.events.length : 0;
    
    // Find common commands
    const commandFreq = new Map<string, number>();
    for (const event of this.events) {
      commandFreq.set(event.command, (commandFreq.get(event.command) || 0) + 1);
    }
    
    insights.commonCommands = Array.from(commandFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cmd, freq]) => ({ command: cmd, frequency: freq }));
    
    // Find risky patterns
    for (const [pattern, data] of this.userPatterns) {
      if (data.outcomes.error > data.outcomes.success) {
        insights.riskyPatterns.push({
          pattern,
          errorRate: data.outcomes.error / data.frequency,
          lastSeen: new Date(data.lastSeen).toISOString()
        });
      }
    }
    
    // Calculate learning progress
    if (this.events.length > 100) {
      const recentEvents = this.events.slice(-50);
      const olderEvents = this.events.slice(-100, -50);
      
      const recentConfidence = recentEvents.reduce((sum, e) => sum + e.context.confidence, 0) / recentEvents.length;
      const olderConfidence = olderEvents.reduce((sum, e) => sum + e.context.confidence, 0) / olderEvents.length;
      
      insights.learningProgress.confidenceImprovement = recentConfidence - olderConfidence;
    }
    
    return insights;
  }
  
  /**
   * Clear old events
   */
  cleanup(): void {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
    
    this.events = this.events.filter(e => e.timestamp > cutoff);
    
    // Clean up old patterns
    for (const [key, pattern] of this.userPatterns) {
      if (pattern.lastSeen < cutoff) {
        this.userPatterns.delete(key);
      }
    }
  }
}

/**
 * Data anonymizer for privacy protection
 */
class DataAnonymizer {
  private homeDir = os.homedir();
  private username = os.userInfo().username;
  
  constructor() {
    // Hash hostname for consistent anonymization
  }
  
  anonymizeCommand(command: string, privacyLevel: 'high' | 'medium' | 'low'): string {
    if (privacyLevel === 'low') {
      return command; // No anonymization
    }
    
    let anonymized = command
      .replace(this.homeDir, '<HOME>')
      .replace(this.username, '<USER>');
    
    if (privacyLevel === 'high') {
      // Remove absolute paths
      anonymized = anonymized.replace(/\/[^\s]+/g, '<PATH>');
    }
    
    return anonymized;
  }
  
  anonymizeArg(arg: string, privacyLevel: 'high' | 'medium' | 'low'): string {
    if (privacyLevel === 'low') {
      return arg;
    }
    
    let anonymized = arg
      .replace(this.homeDir, '<HOME>')
      .replace(this.username, '<USER>')
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<IP>')
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '<EMAIL>')
      .replace(/https?:\/\/[^\s]+/g, '<URL>');
    
    if (privacyLevel === 'high') {
      // Remove file names
      anonymized = anonymized.replace(/[^\/\s]+\.[a-zA-Z]{1,4}$/, '<FILE>');
      // Remove hostnames
      anonymized = anonymized.replace(/[a-zA-Z0-9.-]+\.(com|org|net|io|dev|local)/g, '<HOST>');
      // Remove numbers that might be sensitive
      anonymized = anonymized.replace(/\b\d{4,}\b/g, '<NUMBER>');
    }
    
    return anonymized;
  }
}