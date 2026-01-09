import { LocalAIClient } from '../ai/localai-client';
import { Logger } from '../utils/logger';
import { LocalAISetup } from '../setup/localai-setup';

export interface ModelConfig {
  name: string;
  type: 'analyzer' | 'validator' | 'explainer';
  systemPrompt: string;
}

export class LocalAIModelManager {
  private logger = new Logger('localai-model-manager');
  private client: LocalAIClient;
  private initialized = false;
  
  // Single model with different prompts for different roles
  // TODO: Implement role-based prompts when needed
  /*
  private readonly MODEL_ROLES: Record<string, ModelConfig> = {
    analyzer: {
      name: 'nvidia-hymba-1.5b',
      type: 'analyzer',
      systemPrompt: 'You are a security-focused command analyzer. Your job is to identify potential risks in commands.'
    },
    validator: {
      name: 'nvidia-hymba-1.5b', 
      type: 'validator',
      systemPrompt: 'You are a command validator. Verify the safety assessment and provide a second opinion.'
    },
    explainer: {
      name: 'nvidia-hymba-1.5b',
      type: 'explainer', 
      systemPrompt: 'You are a helpful assistant that explains command risks in simple terms for users.'
    }
  };
  */
  
  constructor() {
    this.client = new LocalAIClient();
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    try {
      this.logger.info('Initializing LocalAI model manager...');
      
      // Check if LocalAI is running
      let healthy = await this.client.checkHealth();
      
      if (!healthy) {
        this.logger.info('LocalAI not running, attempting to start...');
        
        // Try to start LocalAI
        const started = await this.startLocalAI();
        if (!started) {
          throw new Error('Failed to start LocalAI. Run "deliberate setup" to configure.');
        }
        
        // Wait for LocalAI to be ready (with retries)
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
          healthy = await this.client.checkHealth();
          if (healthy) break;
        }
        
        if (!healthy) {
          throw new Error('LocalAI started but not responding. Check logs.');
        }
      }
      
      // Verify model is available
      const models = await this.client.getModels();
      if (!models.includes('nvidia-hymba-1.5b')) {
        this.logger.warn('Hymba model not found. It will be downloaded on first use.');
      }
      
      this.initialized = true;
      this.logger.info('LocalAI model manager initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize LocalAI:', error);
      throw error;
    }
  }
  
  private async startLocalAI(): Promise<boolean> {
    try {
      // Use LocalAISetup to start LocalAI with external Python backend
      const setup = new LocalAISetup();
      const started = await setup.startLocalAI();
      
      if (!started) {
        this.logger.error('Failed to start LocalAI. Please run "deliberate setup" first.');
        return false;
      }
      
      this.logger.info('LocalAI started successfully with transformers backend');
      return true;
    } catch (error) {
      this.logger.error('Failed to start LocalAI:', error);
      return false;
    }
  }
  
  async analyzeCommand(command: string, args: string[], context: any = {}): Promise<any> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    return this.client.analyzeCommand(command, args, context);
  }
  
  async validateAnalysis(analysis: any, _command: string, _args: string[]): Promise<any> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // For now, return a simplified validation
    // TODO: Implement full validation with LocalAI
    return {
      valid: true,
      confidence: analysis.confidence || 0.8
    };
  }
  
  async explainToUser(analysis: any, _command: string, _args: string[]): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const riskEmoji: Record<string, string> = {
      'LOW': '🟢',
      'MEDIUM': '🟡', 
      'HIGH': '🟠',
      'CRITICAL': '🔴'
    };
    
    const emoji = riskEmoji[analysis.riskLevel as string] || '⚠️';
    
    return `${emoji} ${analysis.explanation}

Risk Level: ${analysis.riskLevel}
Recommendation: ${analysis.recommendation}`;
  }
  
  async shutdown(): Promise<void> {
    this.logger.info('LocalAI model manager shutdown (no cleanup needed)');
  }
  
  isReady(): boolean {
    return this.initialized;
  }
  
  isInitialized(): boolean {
    return this.initialized;
  }
  
  async inference(_modelType: string, prompt: string): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Use the client's completion method directly
    const response = await this.client.completion(prompt);
    return response;
  }
}