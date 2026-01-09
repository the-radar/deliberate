import { LocalAIClient, CommandAnalysis } from './localai-client';
import { Logger } from '../utils/logger';
import { CommandContext } from '../types';
import { LRUCache } from 'lru-cache';

export interface DeliberateAIConfig {
  model?: string;
  backend?: 'localai' | 'ollama';
  cacheSize?: number;
  cacheTTL?: number;
}

export interface AIAnalysisResult {
  verdict: 'ALLOW' | 'WARN' | 'BLOCK';
  confidence: number;
  explanation: string;
  risks: string[];
  alternatives?: string[];
  aiAnalyzed?: boolean;
}

export interface CommandInput {
  command: string;
  args: string[];
  context: CommandContext;
}

// Mock RAG for now - will implement later
class MockRAG {
  async search(query: string): Promise<string[]> {
    return [`Mock search result for: ${query}`];
  }
  
  async searchSecurity(query: string): Promise<string[]> {
    return [`Mock security search for: ${query}`];
  }
}

export class DeliberateAI {
  private logger = new Logger('deliberate-ai');
  private client: LocalAIClient;
  private cache: LRUCache<string, AIAnalysisResult>;
  public rag: MockRAG;
  
  constructor(config: DeliberateAIConfig = {}) {
    this.client = new LocalAIClient();
    this.rag = new MockRAG();
    
    // Initialize cache
    this.cache = new LRUCache<string, AIAnalysisResult>({
      max: config.cacheSize || 100,
      ttl: config.cacheTTL || 1000 * 60 * 5, // 5 minutes
    });
    
    this.logger.info(`DeliberateAI initialized with ${config.backend || 'localai'} backend`);
  }
  
  async initialize(): Promise<void> {
    // Check if LocalAI is running
    const healthy = await this.client.checkHealth();
    if (!healthy) {
      throw new Error('LocalAI is not running. Run "deliberate setup" to configure.');
    }
    
    this.logger.info('DeliberateAI initialized successfully');
  }
  
  async analyze(input: CommandInput): Promise<AIAnalysisResult> {
    const cacheKey = this.getCacheKey(input);
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.logger.debug('Returning cached result');
      return cached;
    }
    
    try {
      // Call LocalAI for analysis
      const analysis = await this.client.analyzeCommand(
        input.command,
        input.args,
        input.context
      );
      
      // Convert to expected format
      const result: AIAnalysisResult = {
        verdict: analysis.verdict,
        confidence: analysis.confidence,
        explanation: analysis.explanation,
        risks: this.extractRisks(analysis),
        alternatives: this.generateAlternatives(input, analysis),
        aiAnalyzed: true
      };
      
      // Cache the result
      this.cache.set(cacheKey, result);
      
      return result;
      
    } catch (error) {
      this.logger.error('AI analysis failed:', error);
      
      // Return conservative result on error
      return {
        verdict: 'WARN',
        confidence: 0.3,
        explanation: 'AI analysis failed - manual review required',
        risks: ['Unable to analyze command automatically'],
        alternatives: [],
        aiAnalyzed: false
      };
    }
  }
  
  private getCacheKey(input: CommandInput): string {
    return JSON.stringify({
      command: input.command,
      args: input.args,
      cwd: input.context.cwd
    });
  }
  
  private extractRisks(analysis: CommandAnalysis): string[] {
    const risks: string[] = [];
    
    if (analysis.affectedResources && analysis.affectedResources.length > 0) {
      risks.push(`Affects: ${analysis.affectedResources.join(', ')}`);
    }
    
    if (analysis.riskLevel === 'HIGH' || analysis.riskLevel === 'CRITICAL') {
      risks.push('High risk of data loss or system damage');
    }
    
    if (analysis.verdict === 'BLOCK') {
      risks.push('Command is considered too dangerous to execute');
    }
    
    // Extract risks from explanation
    if (analysis.explanation.toLowerCase().includes('delete')) {
      risks.push('Permanent deletion of files');
    }
    if (analysis.explanation.toLowerCase().includes('system')) {
      risks.push('May affect system files');
    }
    if (analysis.explanation.toLowerCase().includes('recursive')) {
      risks.push('Recursive operation affecting subdirectories');
    }
    
    return risks.length > 0 ? risks : ['Potential unknown risks'];
  }
  
  private generateAlternatives(input: CommandInput, analysis: CommandAnalysis): string[] {
    const alternatives: string[] = [];
    
    if (analysis.verdict === 'BLOCK') {
      // Suggest safer alternatives based on command
      switch (input.command) {
        case 'rm':
          if (input.args.includes('-rf') && (input.args.includes('/') || input.args.includes('/*'))) {
            alternatives.push('Use "rm -i" for interactive deletion');
            alternatives.push('Delete specific files instead of entire directories');
            alternatives.push('Move files to trash instead of permanent deletion');
          }
          break;
          
        case 'chmod':
          if (input.args.includes('777')) {
            alternatives.push('Use more restrictive permissions (e.g., 755 or 644)');
            alternatives.push('Set permissions for specific users/groups only');
          }
          break;
          
        case 'dd':
          alternatives.push('Use a backup tool instead of dd for disk operations');
          alternatives.push('Verify the target device multiple times before proceeding');
          break;
          
        case 'curl':
        case 'wget':
          if (input.args.some(arg => arg.includes('|') || arg.includes('bash'))) {
            alternatives.push('Download the script first and review it');
            alternatives.push('Use package managers instead of curl|bash');
          }
          break;
      }
      
      if (alternatives.length === 0) {
        alternatives.push('Consider the necessity of this operation');
        alternatives.push('Consult documentation or seek expert advice');
      }
    }
    
    return alternatives;
  }
}