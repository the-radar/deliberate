import { execSync } from 'child_process';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import { Logger } from '../utils/logger';

export interface LocalAISetupResult {
  success: boolean;
  message: string;
  details?: string;
  apiUrl?: string;
}

export class LocalAISetup {
  private logger = new Logger('localai-setup');
  private readonly LOCALAI_DIR = path.join(os.homedir(), '.deliberate', 'localai');
  private readonly MODEL_DIR = path.join(this.LOCALAI_DIR, 'models');
  private readonly CONFIG_DIR = path.join(this.LOCALAI_DIR, 'config');
  private readonly PYTHON_BACKEND_DIR = path.join(this.LOCALAI_DIR, 'python-backend');
  private readonly VENV_DIR = path.join(this.PYTHON_BACKEND_DIR, 'venv');
  private readonly LOCALAI_PORT = 8080;
  
  // Model configuration for Hymba 1.5B
  private readonly HYMBA_CONFIG = {
    name: 'nvidia-hymba-1.5b',
    backend: 'transformers',
    parameters: {
      model: 'nvidia/Hymba-1.5B-Instruct',
      temperature: 0.3,
      max_tokens: 256,
      top_p: 0.9,
      top_k: 40,
      threads: 4,
      gpu_layers: 0, // CPU only for broad compatibility
      f16: true,
      low_vram: true,
      mmap: true,
      quantization: 'q4_k_m' // 4-bit quantization for small size
    }
  };

  async setup(): Promise<LocalAISetupResult> {
    try {
      this.logger.info('Setting up LocalAI for Deliberate...');
      
      // Step 1: Create directories
      await this.createDirectories();
      
      // Step 2: Check if LocalAI is installed
      const localAIPath = await this.checkLocalAI();
      if (!localAIPath) {
        // Download and install LocalAI
        const installed = await this.installLocalAI();
        if (!installed) {
          return {
            success: false,
            message: 'Failed to install LocalAI',
            details: 'Please install LocalAI manually: https://localai.io/basics/getting_started/'
          };
        }
      }
      
      // Step 3: Setup Python backend for transformers
      const pythonSetupResult = await this.setupPythonBackend();
      if (!pythonSetupResult.success) {
        return pythonSetupResult;
      }
      
      // Step 4: Create model configuration
      await this.createModelConfig();
      
      // Step 5: Check if LocalAI is running
      const running = await this.isLocalAIRunning();
      if (!running) {
        this.logger.info('LocalAI is not running. It will be started automatically when needed.');
      }
      
      return {
        success: true,
        message: 'LocalAI setup completed successfully',
        details: `Model: ${this.HYMBA_CONFIG.name}\nAPI URL: http://localhost:${this.LOCALAI_PORT}\nPython backend: Installed`,
        apiUrl: `http://localhost:${this.LOCALAI_PORT}`
      };
      
    } catch (error) {
      this.logger.error('LocalAI setup failed:', error);
      return {
        success: false,
        message: 'LocalAI setup failed',
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  private async createDirectories(): Promise<void> {
    await fs.mkdir(this.LOCALAI_DIR, { recursive: true });
    await fs.mkdir(this.MODEL_DIR, { recursive: true });
    await fs.mkdir(this.CONFIG_DIR, { recursive: true });
    await fs.mkdir(this.PYTHON_BACKEND_DIR, { recursive: true });
  }
  
  private async checkLocalAI(): Promise<string | null> {
    try {
      // Check if local-ai command exists
      const result = execSync('which local-ai', { encoding: 'utf8' }).trim();
      this.logger.info('LocalAI found at:', result);
      return result;
    } catch {
      // Check common installation paths
      const paths = [
        '/usr/local/bin/localai',
        '/opt/homebrew/bin/localai',
        path.join(os.homedir(), '.local/bin/localai')
      ];
      
      for (const p of paths) {
        try {
          await fs.access(p);
          this.logger.info('LocalAI found at:', p);
          return p;
        } catch {
          // Continue checking
        }
      }
      
      return null;
    }
  }
  
  private async installLocalAI(): Promise<boolean> {
    try {
      this.logger.info('Installing LocalAI...');
      
      const platform = os.platform();
      const arch = os.arch();
      
      if (platform === 'darwin') {
        // macOS - try Homebrew first
        try {
          execSync('brew install localai', { stdio: 'inherit' });
          return true;
        } catch {
          // Fall back to binary download
        }
      }
      
      // Download binary directly
      const downloadUrl = this.getDownloadUrl(platform, arch);
      if (!downloadUrl) {
        this.logger.error(`Unsupported platform: ${platform} ${arch}`);
        return false;
      }
      
      const localAIBinary = path.join(this.LOCALAI_DIR, 'localai');
      
      this.logger.info('Downloading LocalAI binary...');
      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        headers: {
          'User-Agent': 'Deliberate/1.0'
        }
      });
      
      const writer = fsSync.createWriteStream(localAIBinary);
      response.data.pipe(writer);
      
      await new Promise<void>((resolve, reject) => {
        writer.on('finish', () => resolve());
        writer.on('error', reject);
      });
      
      // Make executable
      await fs.chmod(localAIBinary, 0o755);
      
      // Add to PATH suggestion
      this.logger.info(`LocalAI installed to: ${localAIBinary}`);
      this.logger.info(`Add to PATH: export PATH="${this.LOCALAI_DIR}:$PATH"`);
      
      return true;
      
    } catch (error) {
      this.logger.error('Failed to install LocalAI:', error);
      return false;
    }
  }
  
  private getDownloadUrl(platform: string, arch: string): string | null {
    const baseUrl = 'https://github.com/mudler/LocalAI/releases/latest/download/';
    
    const mapping: Record<string, Record<string, string>> = {
      'darwin': {
        'x64': 'local-ai-Darwin-x86_64',
        'arm64': 'local-ai-Darwin-arm64'
      },
      'linux': {
        'x64': 'local-ai-Linux-x86_64',
        'arm64': 'local-ai-Linux-aarch64'
      }
    };
    
    const filename = mapping[platform]?.[arch];
    return filename ? baseUrl + filename : null;
  }
  
  private async createModelConfig(): Promise<void> {
    const configPath = path.join(this.CONFIG_DIR, 'hymba.yaml');
    
    // LocalAI expects an array format for configs
    const config = `- name: ${this.HYMBA_CONFIG.name}
  backend: ${this.HYMBA_CONFIG.backend}
  parameters:
    model: ${this.HYMBA_CONFIG.parameters.model}
    
  template:
    chat: |
      {{.Input}}
      
      Assistant:

  # Inference parameters
  temperature: ${this.HYMBA_CONFIG.parameters.temperature}
  max_tokens: ${this.HYMBA_CONFIG.parameters.max_tokens}
  top_p: ${this.HYMBA_CONFIG.parameters.top_p}
  top_k: ${this.HYMBA_CONFIG.parameters.top_k}

  # Performance settings
  threads: ${this.HYMBA_CONFIG.parameters.threads}
  gpu_layers: ${this.HYMBA_CONFIG.parameters.gpu_layers}
  f16: ${this.HYMBA_CONFIG.parameters.f16}
  low_vram: ${this.HYMBA_CONFIG.parameters.low_vram}
  mmap: ${this.HYMBA_CONFIG.parameters.mmap}`;
    
    await fs.writeFile(configPath, config.trim());
    this.logger.info('Created Hymba model configuration');
  }
  
  private async isLocalAIRunning(): Promise<boolean> {
    try {
      const response = await axios.get(`http://localhost:${this.LOCALAI_PORT}/readyz`, {
        timeout: 2000
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
  
  private async setupPythonBackend(): Promise<LocalAISetupResult> {
    try {
      this.logger.info('Setting up Python backend for transformers...');
      
      // Check if Python 3 is available
      try {
        execSync('which python3', { encoding: 'utf8' });
      } catch {
        return {
          success: false,
          message: 'Python 3 is required but not found',
          details: 'Please install Python 3 to use transformer models'
        };
      }
      
      // Check if virtual environment already exists
      const venvExists = fsSync.existsSync(path.join(this.VENV_DIR, 'bin', 'python'));
      if (venvExists) {
        this.logger.info('Python virtual environment already exists');
      } else {
        // Create virtual environment
        this.logger.info('Creating Python virtual environment...');
        execSync(`python3 -m venv "${this.VENV_DIR}"`, { stdio: 'inherit' });
        
        // Upgrade pip
        this.logger.info('Upgrading pip...');
        execSync(`"${this.VENV_DIR}/bin/pip" install --upgrade pip`, { stdio: 'inherit' });
        
        // Install Python dependencies
        this.logger.info('📦 Installing ML libraries (torch, transformers)...');
        this.logger.info('⏳ This is a one-time setup that may take 5-10 minutes...');
        this.logger.info('☕ Grab a coffee while we install the AI dependencies...');
        
        const dependencies = [
          'grpcio',
          'grpcio-tools',
          'transformers',
          'torch',
          'sentence-transformers',
          'scipy',
          'accelerate',
          'protobuf',
          'sentencepiece'
        ];
        
        execSync(`"${this.VENV_DIR}/bin/pip" install ${dependencies.join(' ')}`, { 
          stdio: 'inherit',
          env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' }
        });
      }
      
      // Download backend script
      const backendScriptPath = path.join(this.PYTHON_BACKEND_DIR, 'backend_transformers.py');
      if (!fsSync.existsSync(backendScriptPath)) {
        this.logger.info('Downloading LocalAI transformers backend script...');
        
        // Create a minimal transformers backend script
        const backendScript = `#!/usr/bin/env python3
"""
Minimal transformers backend for LocalAI
Based on LocalAI's transformers backend implementation
"""

import grpc
import sys
import os
from concurrent import futures
import time
import argparse

# Add the backend to Python path
sys.path.insert(0, os.path.dirname(__file__))

try:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    import torch
except ImportError as e:
    print(f"Error importing required libraries: {e}")
    print("Please ensure transformers and torch are installed")
    sys.exit(1)

# Import the gRPC backend base
try:
    import backend_pb2
    import backend_pb2_grpc
except ImportError:
    # Generate the protobuf files if they don't exist
    print("Generating protobuf files...")
    os.system("python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. backend.proto")
    import backend_pb2
    import backend_pb2_grpc

class TransformersBackend(backend_pb2_grpc.BackendServicer):
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.model_name = None
        
    def Health(self, request, context):
        return backend_pb2.HealthMessage()
        
    def LoadModel(self, request, context):
        try:
            model_name = request.Model
            self.model_name = model_name
            
            print(f"Loading model: {model_name}")
            self.tokenizer = AutoTokenizer.from_pretrained(model_name)
            self.model = AutoModelForCausalLM.from_pretrained(
                model_name,
                torch_dtype=torch.float16,
                low_cpu_mem_usage=True,
                device_map="cpu"
            )
            
            print(f"Model {model_name} loaded successfully")
            return backend_pb2.Result(success=True, message="Model loaded")
        except Exception as e:
            print(f"Error loading model: {e}")
            return backend_pb2.Result(success=False, message=str(e))
            
    def Predict(self, request, context):
        try:
            if self.model is None:
                return backend_pb2.Result(success=False, message="Model not loaded")
                
            prompt = request.Prompt
            max_tokens = request.Tokens if request.Tokens > 0 else 256
            temperature = request.Temperature if request.Temperature > 0 else 0.3
            
            # Tokenize input
            inputs = self.tokenizer(prompt, return_tensors="pt")
            
            # Generate
            with torch.no_grad():
                outputs = self.model.generate(
                    inputs.input_ids,
                    max_new_tokens=max_tokens,
                    temperature=temperature,
                    do_sample=True,
                    pad_token_id=self.tokenizer.eos_token_id
                )
            
            # Decode
            response = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
            # Remove the prompt from response
            if response.startswith(prompt):
                response = response[len(prompt):].strip()
                
            return backend_pb2.Result(success=True, message=response)
        except Exception as e:
            print(f"Error in prediction: {e}")
            return backend_pb2.Result(success=False, message=str(e))

def serve(address):
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=1))
    backend_pb2_grpc.add_BackendServicer_to_server(TransformersBackend(), server)
    server.add_insecure_port(address)
    server.start()
    print(f"Transformers backend listening on {address}")
    
    try:
        while True:
            time.sleep(86400)
    except KeyboardInterrupt:
        server.stop(0)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--addr", default="localhost:50051", help="gRPC server address")
    args = parser.parse_args()
    
    serve(args.addr)
`;
        
        await fs.writeFile(backendScriptPath, backendScript);
        await fs.chmod(backendScriptPath, 0o755);
        
        // Create the proto file
        const protoPath = path.join(this.PYTHON_BACKEND_DIR, 'backend.proto');
        const protoContent = `syntax = "proto3";

package backend;

service Backend {
  rpc Health(HealthMessage) returns (HealthMessage) {}
  rpc Predict(PredictOptions) returns (Result) {}
  rpc LoadModel(ModelOptions) returns (Result) {}
}

message HealthMessage {}

message PredictOptions {
  string Prompt = 1;
  int32 Tokens = 2;
  float Temperature = 3;
  float TopP = 4;
  int32 TopK = 5;
}

message ModelOptions {
  string Model = 1;
  string ModelFile = 2;
}

message Result {
  bool success = 1;
  string message = 2;
}
`;
        await fs.writeFile(protoPath, protoContent);
      }
      
      this.logger.info('✅ Python backend setup completed');
      
      return {
        success: true,
        message: 'Python backend installed successfully',
        details: 'Transformers backend is ready'
      };
      
    } catch (error) {
      this.logger.error('Python backend setup failed:', error);
      return {
        success: false,
        message: 'Python backend setup failed',
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  async startLocalAI(): Promise<boolean> {
    try {
      const configPath = path.join(this.CONFIG_DIR, 'hymba.yaml');
      const pythonPath = path.join(this.VENV_DIR, 'bin', 'python');
      
      // Check if LocalAI is already running
      if (await this.isLocalAIRunning()) {
        this.logger.info('LocalAI is already running');
        return true;
      }
      
      // Generate protobuf files first
      const protoGenCommand = `cd "${this.PYTHON_BACKEND_DIR}" && "${pythonPath}" -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. backend.proto`;
      try {
        execSync(protoGenCommand, { shell: '/bin/bash' });
      } catch (error) {
        this.logger.warn('Failed to generate protobuf files:', error);
      }
      
      // Start the Python backend first
      const backendLogPath = path.join(this.PYTHON_BACKEND_DIR, 'backend.log');
      const backendCommand = `cd "${this.PYTHON_BACKEND_DIR}" && nohup "${pythonPath}" backend_transformers.py --addr localhost:50051 > "${backendLogPath}" 2>&1 &`;
      execSync(backendCommand, { shell: '/bin/bash' });
      
      // Wait a bit for backend to start
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Start LocalAI (it will connect to the already-running backend)
      // Note: external-grpc-backends format is "backend-name:host:port"
      const command = `nohup local-ai run \
        --models-path ${this.MODEL_DIR} \
        --config-file ${configPath} \
        --address :${this.LOCALAI_PORT} \
        --external-grpc-backends "transformers:localhost:50051" \
        > ${path.join(this.LOCALAI_DIR, 'localai.log')} 2>&1 &`;
      
      execSync(command, { 
        shell: '/bin/bash',
        stdio: 'ignore' 
      });
      
      // Wait for it to start
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (await this.isLocalAIRunning()) {
          this.logger.info('LocalAI started successfully with transformers backend');
          return true;
        }
      }
      
      // Check the log for errors
      try {
        const log = fsSync.readFileSync(path.join(this.LOCALAI_DIR, 'localai.log'), 'utf8');
        this.logger.error('LocalAI failed to start. Log output:', log);
      } catch {
        // Ignore log read errors
      }
      
      return false;
    } catch (error) {
      this.logger.error('Failed to start LocalAI:', error);
      return false;
    }
  }
}