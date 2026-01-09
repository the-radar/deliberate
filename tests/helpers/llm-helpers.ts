export interface LLMAnalysisResult {
  riskLevel: 'SAFE' | 'CAUTION' | 'DANGEROUS';
  confidence: number;
  explanation: string;
  risks: string[];
  recommendations: string[];
}

export interface ModelResponse {
  model: string;
  response: LLMAnalysisResult;
  tokens: number;
  latency: number;
}

export interface ConsensusResult {
  finalRiskLevel: 'SAFE' | 'CAUTION' | 'DANGEROUS';
  confidence: number;
  modelResponses: ModelResponse[];
  explanation: string;
}

export class LLMTestHelper {
  /**
   * Create a mock LLM analysis result
   */
  static createMockAnalysis(
    riskLevel: 'SAFE' | 'CAUTION' | 'DANGEROUS',
    confidence: number = 0.95
  ): LLMAnalysisResult {
    const analyses = {
      SAFE: {
        riskLevel: 'SAFE' as const,
        confidence,
        explanation: 'This command is safe to execute.',
        risks: [],
        recommendations: [],
      },
      CAUTION: {
        riskLevel: 'CAUTION' as const,
        confidence,
        explanation: 'This command requires careful consideration.',
        risks: ['Modifies system files', 'Could affect system behavior'],
        recommendations: ['Review the target files', 'Consider making a backup'],
      },
      DANGEROUS: {
        riskLevel: 'DANGEROUS' as const,
        confidence,
        explanation: 'This command is extremely dangerous and could damage your system.',
        risks: [
          'Deletes critical system files',
          'Could make system unbootable',
          'Irreversible data loss',
        ],
        recommendations: [
          'Do not run this command',
          'Seek alternative approaches',
          'Consult system administrator',
        ],
      },
    };
    
    return analyses[riskLevel];
  }
  
  /**
   * Create mock model responses for consensus testing
   */
  static createMockModelResponses(
    analyzer1Risk: 'SAFE' | 'CAUTION' | 'DANGEROUS',
    analyzer2Risk: 'SAFE' | 'CAUTION' | 'DANGEROUS',
    tokens: number = 1500
  ): ModelResponse[] {
    return [
      {
        model: 'qwen2-1.5b',
        response: this.createMockAnalysis(analyzer1Risk),
        tokens,
        latency: 150,
      },
      {
        model: 'smollm2-1.7b',
        response: this.createMockAnalysis(analyzer2Risk),
        tokens,
        latency: 180,
      },
    ];
  }
  
  /**
   * Simulate consensus decision
   */
  static simulateConsensus(
    modelResponses: ModelResponse[]
  ): ConsensusResult {
    // Count risk levels
    const riskCounts = modelResponses.reduce((acc, resp) => {
      acc[resp.response.riskLevel] = (acc[resp.response.riskLevel] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    // Determine final risk level (majority vote)
    let finalRiskLevel: 'SAFE' | 'CAUTION' | 'DANGEROUS' = 'DANGEROUS';
    let maxCount = 0;
    
    for (const [risk, count] of Object.entries(riskCounts)) {
      if (count > maxCount) {
        maxCount = count;
        finalRiskLevel = risk as any;
      }
    }
    
    // If tie, choose more conservative
    if (riskCounts['DANGEROUS'] === riskCounts['SAFE']) {
      finalRiskLevel = 'DANGEROUS';
    }
    
    // Calculate average confidence
    const avgConfidence = modelResponses.reduce((sum, resp) => 
      sum + resp.response.confidence, 0) / modelResponses.length;
    
    return {
      finalRiskLevel,
      confidence: avgConfidence,
      modelResponses,
      explanation: `Based on analysis from ${modelResponses.length} models, this command is classified as ${finalRiskLevel}.`,
    };
  }
  
  /**
   * Test token limit enforcement
   */
  static createOversizedPrompt(targetTokens: number): string {
    // Rough approximation: 1 token ≈ 4 characters
    const charCount = targetTokens * 4;
    return 'x'.repeat(charCount);
  }
  
  /**
   * Create mock structured output
   */
  static createMockStructuredOutput() {
    return {
      command: 'rm -rf /',
      analysis: {
        riskLevel: 'DANGEROUS',
        confidence: 0.99,
        risks: [
          {
            type: 'DATA_LOSS',
            severity: 'CRITICAL',
            description: 'Deletes entire filesystem',
          },
          {
            type: 'SYSTEM_DAMAGE',
            severity: 'CRITICAL',
            description: 'Makes system unbootable',
          },
        ],
        mitigations: [
          'Use specific file paths instead of /',
          'Add --preserve-root flag',
          'Use trash command instead of rm',
        ],
      },
      metadata: {
        modelVersion: '1.0.0',
        timestamp: new Date().toISOString(),
        processingTime: 180,
      },
    };
  }
  
  /**
   * Simulate model loading
   */
  static async simulateModelLoading(
    modelName: string,
    shouldFail: boolean = false
  ): Promise<{
    loaded: boolean;
    error?: string;
    memoryUsage?: number;
  }> {
    // Simulate loading delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (shouldFail) {
      return {
        loaded: false,
        error: `Failed to load model ${modelName}: File not found`,
      };
    }
    
    return {
      loaded: true,
      memoryUsage: Math.floor(Math.random() * 500 + 500), // 500-1000 MB
    };
  }
  
  /**
   * Create auth code test data
   */
  static createAuthCodeData() {
    const adjectives = ['swift', 'bright', 'calm', 'bold', 'wise'];
    const nouns = ['wolf', 'star', 'moon', 'tree', 'wave'];
    const number = Math.floor(Math.random() * 9000 + 1000);
    
    return {
      code: `${adjectives[0]}-${nouns[0]}-${number}`,
      command: 'rm /etc/hosts',
      expires: new Date(Date.now() + 5 * 60 * 1000),
      created: new Date(),
    };
  }
}