import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';

export interface Model {
  name: string;
  path: string;
  type: 'analyzer' | 'decision';
  port: number;
  contextSize: number;
}

export class ModelManager {
  private models: Map<string, Model> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private modelDir: string;
  private initialized: boolean = false;
  
  constructor() {
    this.modelDir = path.join(os.homedir(), '.deliberate', 'models');
  }

  async initialize(): Promise<void> {
    // Define our model configuration with proper context sizes
    this.models.set('qwen2', {
      name: 'qwen2:1.5b',
      path: path.join(this.modelDir, 'qwen2-1.5b'),
      type: 'analyzer',
      port: 11434,  // All models use the same Ollama port
      contextSize: 2048
    });
    
    this.models.set('smollm2', {
      name: 'smollm2:1.7b',
      path: path.join(this.modelDir, 'smollm2-1.7b'),
      type: 'analyzer',
      port: 11434,  // All models use the same Ollama port
      contextSize: 2048
    });
    
    this.models.set('phi3', {
      name: 'phi3:3.8b',
      path: path.join(this.modelDir, 'phi3-3.8b'),
      type: 'decision',
      port: 11434,  // All models use the same Ollama port
      contextSize: 4096  // Decision model gets more context
    });

    // Start Ollama instances
    await this.startOllama();
    
    // Load models with proper context windows
    await this.loadModels();
    
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private async startOllama(): Promise<void> {
    // Check if Ollama is installed
    try {
      await this.executeCommand('ollama', ['--version']);
    } catch {
      throw new Error('Ollama not installed. Please install from https://ollama.ai');
    }

    // Start Ollama server if not running
    try {
      await axios.get('http://localhost:11434/api/tags');
    } catch {
      console.log('Starting Ollama server...');
      const ollama = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore'
      });
      ollama.unref();
      
      // Wait for server to start
      await this.waitForServer('http://localhost:11434/api/tags', 30000);
    }
  }

  private async loadModels(): Promise<void> {
    for (const [, model] of this.models) {
      try {
        // Check if model exists
        const response = await axios.get(`http://localhost:${model.port}/api/tags`);
        const models = response.data.models || [];
        
        if (!models.some((m: any) => m.name === model.name)) {
          console.log(`Downloading ${model.name}...`);
          await this.pullModel(model.name);
        }
        
        // Keep model loaded in memory
        await this.keepModelWarm(model.name, model.port);
      } catch (error) {
        console.error(`Failed to load model ${model.name}:`, error);
      }
    }
  }

  private async pullModel(modelName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const pull = spawn('ollama', ['pull', modelName]);
      
      pull.stdout.on('data', (data) => {
        process.stdout.write(data);
      });
      
      pull.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Failed to pull model ${modelName}`));
      });
    });
  }

  async inference(modelKey: string, prompt: string): Promise<string> {
    const model = this.models.get(modelKey);
    if (!model) throw new Error(`Model ${modelKey} not found`);

    const response = await axios.post(`http://localhost:${model.port}/api/generate`, {
      model: model.name,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.1,
        top_k: 10,
        top_p: 0.9,
        num_predict: 512,  // Increased for comprehensive analysis
        num_ctx: model.contextSize,  // Use model-specific context size
        repeat_penalty: 1.1,
        seed: -1  // For reproducibility in production
      }
    });

    return response.data.response;
  }

  private async executeCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args);
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${command} exited with code ${code}`));
      });
    });
  }

  private async waitForServer(url: string, timeout: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        await axios.get(url);
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw new Error('Server startup timeout');
  }

  private async keepModelWarm(modelName: string, port: number): Promise<void> {
    // Send a simple prompt to load model into memory
    try {
      await axios.post(`http://localhost:${port}/api/generate`, {
        model: modelName,
        prompt: 'Hi',
        stream: false,
        options: {
          num_predict: 1
        }
      });
    } catch (error) {
      console.error(`Failed to warm up model ${modelName}:`, error);
    }
  }

  async shutdown(): Promise<void> {
    // Clean up model processes if needed
    for (const [, process] of this.processes) {
      if (process && !process.killed) {
        process.kill();
      }
    }
    this.processes.clear();
    this.initialized = false;
  }
}