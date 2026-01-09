import axios, { AxiosInstance } from 'axios';
import { Logger } from '../utils/logger';

export interface LocalAIConfig {
  apiUrl?: string;
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface LocalAIResponse {
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface CommandAnalysis {
  verdict: 'ALLOW' | 'BLOCK' | 'WARN';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;
  explanation: string;
  recommendation: string;
  affectedResources?: string[];
}

export class LocalAIClient {
  private logger = new Logger('localai-client');
  private client: AxiosInstance;
  private modelName = 'nvidia-hymba-1.5b';
  private maxRetries: number;
  
  constructor(config: LocalAIConfig = {}) {
    const apiUrl = config.apiUrl || process.env.LOCALAI_API_URL || 'http://localhost:8080';
    this.maxRetries = config.maxRetries || 3;
    
    this.client = axios.create({
      baseURL: apiUrl,
      timeout: config.timeout || 5000,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` })
      }
    });
    
    this.logger.info(`LocalAI client initialized: ${apiUrl}`);
  }
  
  async analyzeCommand(
    command: string, 
    args: string[], 
    context: Record<string, any> = {}
  ): Promise<CommandAnalysis> {
    const prompt = this.buildAnalysisPrompt(command, args, context);
    
    try {
      const response = await this.completion(prompt);
      return this.parseAnalysisResponse(response);
    } catch (error) {
      this.logger.error('Command analysis failed:', error);
      
      // Fallback to conservative analysis on error
      return {
        verdict: 'WARN',
        riskLevel: 'MEDIUM',
        confidence: 0.5,
        explanation: 'Unable to analyze command due to AI error',
        recommendation: 'Please review this command carefully before proceeding'
      };
    }
  }
  
  private buildAnalysisPrompt(
    command: string, 
    args: string[], 
    context: Record<string, any>
  ): string {
    const fullCommand = `${command} ${args.join(' ')}`;
    
    return `You are a security-focused command analyzer. Analyze this command and provide a safety assessment.

Command: ${fullCommand}
Working Directory: ${context.cwd || 'unknown'}
User: ${context.user || 'unknown'}

Analyze the command and respond in this exact JSON format:
{
  "verdict": "ALLOW" or "WARN" or "BLOCK",
  "riskLevel": "LOW" or "MEDIUM" or "HIGH" or "CRITICAL",
  "confidence": 0.0 to 1.0,
  "explanation": "Brief explanation of what the command does",
  "recommendation": "What the user should do",
  "affectedResources": ["list", "of", "affected", "resources"]
}

Consider:
1. Is this command destructive?
2. Does it affect system files?
3. Could it cause data loss?
4. Is it reversible?
5. What resources does it affect?

Response:`;
  }
  
  async completion(prompt: string): Promise<string> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.client.post<LocalAIResponse>('/v1/chat/completions', {
          model: this.modelName,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 256,
          stream: false
        });
        
        if (response.data.choices && response.data.choices.length > 0) {
          const choice = response.data.choices[0];
          if (choice && choice.message) {
            const content = choice.message.content;
            if (response.data.usage) {
              this.logger.debug(`Tokens used: ${response.data.usage.total_tokens}`);
            }
            return content;
          }
        }
        
        throw new Error('No response from LocalAI');
        
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Attempt ${attempt + 1} failed:`, error);
        
        if (attempt < this.maxRetries - 1) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    
    throw lastError || new Error('LocalAI request failed');
  }
  
  private parseAnalysisResponse(response: string): CommandAnalysis {
    try {
      // Extract JSON from response (model might include extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate and normalize the response
      return {
        verdict: this.normalizeVerdict(parsed.verdict),
        riskLevel: this.normalizeRiskLevel(parsed.riskLevel),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        explanation: parsed.explanation || 'No explanation provided',
        recommendation: parsed.recommendation || 'Review carefully before proceeding',
        affectedResources: Array.isArray(parsed.affectedResources) ? parsed.affectedResources : []
      };
      
    } catch (error) {
      this.logger.error('Failed to parse AI response:', error);
      this.logger.debug('Raw response:', response);
      
      // Return conservative default
      return {
        verdict: 'WARN',
        riskLevel: 'MEDIUM',
        confidence: 0.3,
        explanation: 'Unable to parse AI analysis',
        recommendation: 'Manual review recommended'
      };
    }
  }
  
  private normalizeVerdict(verdict: string): 'ALLOW' | 'WARN' | 'BLOCK' {
    const v = (verdict || '').toUpperCase();
    if (['ALLOW', 'WARN', 'BLOCK'].includes(v)) {
      return v as 'ALLOW' | 'WARN' | 'BLOCK';
    }
    return 'WARN'; // Default to warning if uncertain
  }
  
  private normalizeRiskLevel(level: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const l = (level || '').toUpperCase();
    if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(l)) {
      return l as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    }
    return 'MEDIUM'; // Default to medium if uncertain
  }
  
  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.client.get('/readyz', {
        timeout: 2000
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
  
  async getModels(): Promise<string[]> {
    try {
      const response = await this.client.get('/v1/models');
      return response.data.data.map((m: any) => m.id);
    } catch (error) {
      this.logger.error('Failed to get models:', error);
      return [];
    }
  }
}