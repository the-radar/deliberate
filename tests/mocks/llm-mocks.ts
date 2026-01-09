import { jest } from '@jest/globals';
import { LLMAnalysisResult, ModelResponse } from '../helpers/llm-helpers';

export interface MockLLMConfig {
  defaultRiskLevel?: 'SAFE' | 'CAUTION' | 'DANGEROUS';
  defaultConfidence?: number;
  latency?: number;
  shouldFail?: boolean;
  tokenLimit?: number;
}

export class MockLLMProvider {
  private config: MockLLMConfig;
  private responses: Map<string, LLMAnalysisResult> = new Map();
  
  constructor(config: MockLLMConfig = {}) {
    this.config = {
      defaultRiskLevel: 'SAFE',
      defaultConfidence: 0.95,
      latency: 100,
      shouldFail: false,
      tokenLimit: 2048,
      ...config,
    };
  }
  
  /**
   * Set a specific response for a command
   */
  setResponse(command: string, response: LLMAnalysisResult): void {
    this.responses.set(command, response);
  }
  
  /**
   * Mock analyze command method
   */
  async analyzeCommand(command: string, context?: any): Promise<LLMAnalysisResult> {
    // Simulate latency
    await new Promise(resolve => setTimeout(resolve, this.config.latency));
    
    if (this.config.shouldFail) {
      throw new Error('LLM analysis failed');
    }
    
    // Check for specific response
    if (this.responses.has(command)) {
      return this.responses.get(command)!;
    }
    
    // Generate response based on command patterns
    return this.generateResponse(command);
  }
  
  /**
   * Mock token counting
   */
  countTokens(text: string): number {
    // Rough approximation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
  
  /**
   * Mock token limit enforcement
   */
  enforceTokenLimit(text: string): string {
    const tokens = this.countTokens(text);
    if (tokens > this.config.tokenLimit!) {
      // Truncate to fit token limit
      const maxChars = this.config.tokenLimit! * 4;
      return text.substring(0, maxChars) + '... [truncated]';
    }
    return text;
  }
  
  /**
   * Generate response based on command patterns
   */
  private generateResponse(command: string): LLMAnalysisResult {
    // Dangerous patterns
    const dangerousPatterns = [
      /rm\s+-rf\s+\//,
      /sudo/,
      /dd\s+if=.*of=\/dev/,
      /chmod\s+-R\s+777/,
      /:\(\)\{.*\|:&\};:/,  // Fork bomb
      /mkfs/,
      />\s*\/etc\//,
    ];
    
    // Caution patterns
    const cautionPatterns = [
      /rm\s+/,
      /mv\s+.*\s+\//,
      /chmod/,
      /chown/,
      /install/,
      /update/,
    ];
    
    // Check patterns
    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          riskLevel: 'DANGEROUS',
          confidence: 0.99,
          explanation: `This command matches dangerous pattern: ${pattern.source}`,
          risks: [
            'Could damage system',
            'May cause data loss',
            'Potentially irreversible',
          ],
          recommendations: [
            'Do not execute this command',
            'Seek safer alternatives',
            'Consult documentation',
          ],
        };
      }
    }
    
    for (const pattern of cautionPatterns) {
      if (pattern.test(command)) {
        return {
          riskLevel: 'CAUTION',
          confidence: 0.85,
          explanation: `This command requires careful consideration`,
          risks: [
            'May modify files',
            'Could affect system behavior',
          ],
          recommendations: [
            'Review target files',
            'Consider making backups',
          ],
        };
      }
    }
    
    // Default to safe
    return {
      riskLevel: this.config.defaultRiskLevel!,
      confidence: this.config.defaultConfidence!,
      explanation: 'This command appears to be safe',
      risks: [],
      recommendations: [],
    };
  }
}

export class MockModelManager {
  private models: Map<string, MockLLMProvider> = new Map();
  
  constructor() {
    // Initialize default models
    this.models.set('qwen2-1.5b', new MockLLMProvider({ tokenLimit: 2048 }));
    this.models.set('smollm2-1.7b', new MockLLMProvider({ tokenLimit: 2048 }));
    this.models.set('deepseek-r1-1.5b', new MockLLMProvider({ tokenLimit: 4096 }));
  }
  
  /**
   * Get a specific model
   */
  getModel(name: string): MockLLMProvider | undefined {
    return this.models.get(name);
  }
  
  /**
   * Mock multi-model consensus
   */
  async getConsensus(command: string): Promise<{
    finalRiskLevel: 'SAFE' | 'CAUTION' | 'DANGEROUS';
    confidence: number;
    responses: ModelResponse[];
  }> {
    const responses: ModelResponse[] = [];
    
    // Get responses from analyzer models
    for (const [modelName, model] of this.models.entries()) {
      if (modelName !== 'deepseek-r1-1.5b') { // Skip decision model
        const startTime = Date.now();
        const analysis = await model.analyzeCommand(command);
        
        responses.push({
          model: modelName,
          response: analysis,
          tokens: model.countTokens(command),
          latency: Date.now() - startTime,
        });
      }
    }
    
    // Determine consensus
    const riskLevels = responses.map(r => r.response.riskLevel);
    const riskCounts = riskLevels.reduce((acc, level) => {
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    // Find majority
    let finalRiskLevel: 'SAFE' | 'CAUTION' | 'DANGEROUS' = 'DANGEROUS';
    let maxCount = 0;
    
    for (const [level, count] of Object.entries(riskCounts)) {
      if (count > maxCount) {
        maxCount = count;
        finalRiskLevel = level as any;
      }
    }
    
    // Calculate average confidence
    const avgConfidence = responses.reduce((sum, r) => 
      sum + r.response.confidence, 0) / responses.length;
    
    return {
      finalRiskLevel,
      confidence: avgConfidence,
      responses,
    };
  }
}

/**
 * Create a mock LLM server
 */
export function createMockLLMServer(port: number): {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  setResponse: (endpoint: string, response: any) => void;
} {
  const responses = new Map<string, any>();
  
  return {
    start: async () => {
      // Mock server start
      console.log(`Mock LLM server started on port ${port}`);
    },
    stop: async () => {
      // Mock server stop
      console.log(`Mock LLM server stopped`);
    },
    setResponse: (endpoint: string, response: any) => {
      responses.set(endpoint, response);
    },
  };
}