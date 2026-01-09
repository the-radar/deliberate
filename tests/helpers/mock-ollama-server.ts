import express from 'express';
import { Server } from 'http';

export interface MockOllamaConfig {
  port: number;
  models: string[];
  responses?: Record<string, string>;
}

export class MockOllamaServer {
  private app: express.Application;
  private server: Server | null = null;
  private config: MockOllamaConfig;
  private defaultResponses: Record<string, Record<string, string>>;
  
  constructor(config: MockOllamaConfig) {
    this.config = config;
    this.app = express();
    this.app.use(express.json());
    
    // Default responses by model and prompt patterns
    this.defaultResponses = {
      'qwen2:1.5b-instruct-q4_0': {
        'ls': 'Command: ls\nWhat it does: Lists directory contents\nRisks: None\nSafety rating: SAFE',
        'rm -rf': 'Command: rm -rf\nWhat it does: Recursively deletes files\nRisks:\n- Permanent data loss\n- System damage if used on system directories\nSafety rating: DANGEROUS',
        'curl': 'Command: curl\nWhat it does: Downloads content from URL\nRisks:\n- May download malicious content\n- Network exposure\nSafety rating: CAUTION',
        'default': 'Command analyzed. Safety rating: CAUTION'
      },
      'smollm2:1.7b-instruct-q4_0': {
        'ls': 'Safe read-only operation. No risks.',
        'rm -rf': 'CRITICAL DANGER! Permanent deletion. System damage possible.',
        'curl': 'Network operation. Verify URL trustworthiness.',
        'default': 'Command requires careful consideration.'
      },
      'deepseek-r1:1.5b-q4_0': {
        'ls': 'Overall risk level: ALLOW\nExplanation: Safe directory listing',
        'rm -rf': 'Overall risk level: BLOCK\n- Permanent deletion\n- System damage risk\nExplanation: This command can cause irreversible damage',
        'curl': 'Overall risk level: WARN\n- Network access\n- Unknown content\nExplanation: Verify the URL before proceeding',
        'default': 'Overall risk level: WARN\nExplanation: Command requires review'
      }
    };
    
    this.setupRoutes();
  }
  
  private setupRoutes(): void {
    // Model list endpoint
    this.app.get('/api/tags', (req, res) => {
      res.json({
        models: this.config.models.map(name => ({ 
          name,
          size: '1.5GB',
          modified: new Date().toISOString()
        }))
      });
    });
    
    // Generate endpoint
    this.app.post('/api/generate', (req, res) => {
      const { model, prompt } = req.body;
      
      // Get response based on model and prompt content
      let response = this.getResponse(model, prompt);
      
      res.json({
        model,
        created_at: new Date().toISOString(),
        response,
        done: true,
        total_duration: 50000000, // 50ms
        load_duration: 10000000,
        eval_duration: 40000000
      });
    });
    
    // Pull endpoint (for downloading models)
    this.app.post('/api/pull', (req, res) => {
      const { name } = req.body;
      
      // Simulate model download
      res.json({
        status: 'success',
        digest: 'sha256:' + Buffer.from(name).toString('hex'),
        total: 1500000000,
        completed: 1500000000
      });
    });
    
    // Healthcheck
    this.app.get('/api/version', (req, res) => {
      res.json({
        version: '0.1.23'
      });
    });
  }
  
  private getResponse(model: string, prompt: string): string {
    // Check custom responses first
    if (this.config.responses && this.config.responses[model]) {
      return this.config.responses[model];
    }
    
    // Use default responses based on prompt content
    const modelResponses = this.defaultResponses[model] || {};
    
    // Find matching response based on prompt keywords
    for (const [keyword, response] of Object.entries(modelResponses)) {
      if (keyword !== 'default' && prompt.toLowerCase().includes(keyword.toLowerCase())) {
        return response;
      }
    }
    
    // Return default response
    return modelResponses.default || 'Analysis complete.';
  }
  
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        console.log(`Mock Ollama server running on port ${this.config.port}`);
        resolve();
      });
    });
  }
  
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
  
  // Update response for specific model
  setResponse(model: string, response: string): void {
    if (!this.config.responses) {
      this.config.responses = {};
    }
    this.config.responses[model] = response;
  }
  
  // Set response based on prompt pattern
  setPatternResponse(model: string, pattern: string, response: string): void {
    if (!this.defaultResponses[model]) {
      this.defaultResponses[model] = {};
    }
    this.defaultResponses[model][pattern] = response;
  }
}