import { ModelManager } from './model-manager';
import { PromptTemplates } from './prompts';
import { SensitiveDataRedactor } from '../core/redaction/redactor';
import { CommandClassifier } from '../core/classification/classifier';

export interface AnalysisResult {
  verdict: 'ALLOW' | 'WARN' | 'BLOCK';
  explanation: string;
  risks: string[];
  alternatives?: string[];
  confidence: number;
}

export interface AnalysisContext {
  cwd: string;
  user: string;
  platform: string;
  isSudo: boolean;
  env?: Record<string, string>;
}

export class AnalysisOrchestrator {
  private modelManager: ModelManager;
  private redactor: SensitiveDataRedactor;
  private classifier: CommandClassifier;

  constructor() {
    this.modelManager = new ModelManager();
    this.redactor = new SensitiveDataRedactor();
    this.classifier = new CommandClassifier();
  }

  async initialize(): Promise<void> {
    await this.modelManager.initialize();
  }

  async analyze(command: string, args: string[], context: AnalysisContext): Promise<AnalysisResult> {
    // Initialize models if needed
    if (!this.modelManager.isInitialized()) {
      await this.modelManager.initialize();
    }

    const fullCommand = `${command} ${args.join(' ')}`;
    
    // Redact sensitive data
    const redacted = await this.redactor.redactCommand(fullCommand);
    
    try {
      // Run analyses in parallel
      const [analysis1, analysis2, patternRisk] = await Promise.all([
        this.runPrimaryAnalysis(redacted, context),
        this.runSecondaryAnalysis(redacted, context),
        this.getPatternRisk(command, args)
      ]);

      // Synthesize decision
      const decision = await this.synthesizeDecision(analysis1, analysis2, patternRisk);
      
      return decision;
    } catch (error) {
      console.error('LLM analysis failed:', error);
      // Fallback to pattern-based analysis
      return this.fallbackAnalysis(command, args);
    }
  }

  private async runPrimaryAnalysis(command: string, context: AnalysisContext): Promise<string> {
    const prompt = PromptTemplates.primaryAnalysis(command, context);
    return await this.modelManager.inference('qwen2', prompt);
  }

  private async runSecondaryAnalysis(command: string, context: AnalysisContext): Promise<string> {
    const prompt = PromptTemplates.secondaryAnalysis(command, context);
    return await this.modelManager.inference('smollm2', prompt);
  }

  private async synthesizeDecision(
    analysis1: string,
    analysis2: string,
    patternRisk: string
  ): Promise<AnalysisResult> {
    const prompt = PromptTemplates.decisionSynthesis(analysis1, analysis2, patternRisk);
    const decision = await this.modelManager.inference('phi3', prompt);
    
    // Parse structured response
    return this.parseDecision(decision);
  }

  private parseDecision(response: string): AnalysisResult {
    // Simple parsing - in production, use proper structured output
    const lines = response.split('\n');
    let verdict: 'ALLOW' | 'WARN' | 'BLOCK' = 'WARN';
    let explanation = '';
    const risks: string[] = [];
    const alternatives: string[] = [];
    
    for (const line of lines) {
      const upperLine = line.toUpperCase();
      if (upperLine.includes('ALLOW') && upperLine.includes('RISK')) {
        verdict = 'ALLOW';
      } else if (upperLine.includes('BLOCK')) {
        verdict = 'BLOCK';
      } else if (upperLine.includes('WARN')) {
        verdict = 'WARN';
      }
      
      if (line.toLowerCase().includes('explanation:') || line.toLowerCase().includes('summary:')) {
        explanation = line.split(':').slice(1).join(':').trim();
      }
      
      if (line.startsWith('-') || line.startsWith('•')) {
        const content = line.substring(1).trim();
        if (line.toLowerCase().includes('alternative') || line.toLowerCase().includes('instead')) {
          alternatives.push(content);
        } else {
          risks.push(content);
        }
      }
    }
    
    return {
      verdict,
      explanation: explanation || 'Command requires careful consideration',
      risks,
      alternatives,
      confidence: 0.85
    };
  }

  private async getPatternRisk(command: string, args: string[]): Promise<string> {
    const classification = await this.classifier.classify(command, args, {
      command,
      args,
      env: process.env,
      cwd: process.cwd(),
      user: process.env.USER || 'unknown',
      timestamp: Date.now(),
      sudo: false
    });
    
    switch (classification.riskLevel) {
      case 'SAFE':
        return 'LOW - Command matches safe patterns';
      case 'CAUTION':
        return 'MEDIUM - Command has some risk indicators';
      case 'HIGH':
      case 'CRITICAL':
        return 'HIGH - Command matches dangerous patterns';
      default:
        return 'UNKNOWN - No pattern match';
    }
  }

  private async fallbackAnalysis(command: string, args: string[]): Promise<AnalysisResult> {
    const classification = await this.classifier.classify(command, args, {
      command,
      args,
      env: process.env,
      cwd: process.cwd(),
      user: process.env.USER || 'unknown',
      timestamp: Date.now(),
      sudo: false
    });
    
    let verdict: 'ALLOW' | 'WARN' | 'BLOCK' = 'WARN';
    let explanation = '';
    
    switch (classification.riskLevel) {
      case 'SAFE':
        verdict = 'ALLOW';
        explanation = 'Command appears safe based on pattern analysis';
        break;
      case 'CRITICAL':
        verdict = 'BLOCK';
        explanation = 'Command matches dangerous patterns and should not be executed';
        break;
      case 'HIGH':
        verdict = 'WARN';
        explanation = 'Command has high risk and requires careful review';
        break;
      default:
        verdict = 'WARN';
        explanation = 'Command requires manual review';
    }
    
    return {
      verdict,
      explanation,
      risks: classification.risks || [],
      confidence: 0.6
    };
  }

  async explainRisks(command: string, risks: string[]): Promise<string> {
    const prompt = PromptTemplates.explainRisk(command, risks);
    try {
      return await this.modelManager.inference('qwen2', prompt);
    } catch {
      return risks.join('. ');
    }
  }

  async shutdown(): Promise<void> {
    await this.modelManager.shutdown();
  }
}