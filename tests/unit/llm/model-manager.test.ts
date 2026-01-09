import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ModelManager } from '../../../src/llm/model-manager';
import axios from 'axios';
import { spawn } from 'child_process';

jest.mock('axios');
jest.mock('child_process');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('ModelManager', () => {
  let modelManager: ModelManager;
  
  beforeEach(() => {
    modelManager = new ModelManager();
    jest.clearAllMocks();
  });
  
  afterEach(async () => {
    await modelManager.shutdown();
  });
  
  describe('initialization', () => {
    test('should check if Ollama is installed', async () => {
      // Mock successful Ollama check
      const mockProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(0);
        })
      };
      mockedSpawn.mockReturnValue(mockProcess as any);
      
      // Mock Ollama server already running
      mockedAxios.get.mockResolvedValue({ data: { models: [] } });
      
      await modelManager.initialize();
      
      expect(mockedSpawn).toHaveBeenCalledWith('ollama', ['--version']);
      expect(modelManager.isInitialized()).toBe(true);
    });
    
    test('should throw error if Ollama not installed', async () => {
      // Mock failed Ollama check
      const mockProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(1);
        })
      };
      mockedSpawn.mockReturnValue(mockProcess as any);
      
      await expect(modelManager.initialize()).rejects.toThrow(
        'Ollama not installed'
      );
    });
    
    test('should start Ollama server if not running', async () => {
      // Mock successful Ollama check
      const mockCheckProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(0);
        })
      };
      
      // Mock server spawn
      const mockServerProcess = {
        unref: jest.fn()
      };
      
      mockedSpawn
        .mockReturnValueOnce(mockCheckProcess as any) // ollama --version
        .mockReturnValueOnce(mockServerProcess as any); // ollama serve
      
      // Mock server not running initially, then running
      mockedAxios.get
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValue({ data: { models: [] } });
      
      await modelManager.initialize();
      
      expect(mockedSpawn).toHaveBeenCalledWith('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore'
      });
      expect(mockServerProcess.unref).toHaveBeenCalled();
    });
  });
  
  describe('model loading', () => {
    test('should download missing models', async () => {
      // Setup
      const mockCheckProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(0);
        })
      };
      mockedSpawn.mockReturnValue(mockCheckProcess as any);
      
      // Mock server running but models not present
      mockedAxios.get.mockResolvedValue({ data: { models: [] } });
      
      // Mock model download
      const mockPullProcess = {
        stdout: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(0);
        })
      };
      mockedSpawn.mockImplementation((cmd, args) => {
        if (cmd === 'ollama' && args[0] === 'pull') {
          return mockPullProcess as any;
        }
        return mockCheckProcess as any;
      });
      
      // Mock warm-up requests
      mockedAxios.post.mockResolvedValue({ data: { response: 'Hi' } });
      
      await modelManager.initialize();
      
      // Should pull all three models
      expect(mockedSpawn).toHaveBeenCalledWith('ollama', ['pull', 'qwen2:1.5b-instruct-q4_0']);
      expect(mockedSpawn).toHaveBeenCalledWith('ollama', ['pull', 'smollm2:1.7b-instruct-q4_0']);
      expect(mockedSpawn).toHaveBeenCalledWith('ollama', ['pull', 'deepseek-r1:1.5b-q4_0']);
    });
    
    test('should keep models warm after loading', async () => {
      // Setup basic mocks
      const mockProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(0);
        })
      };
      mockedSpawn.mockReturnValue(mockProcess as any);
      
      // Mock server with models already loaded
      mockedAxios.get.mockResolvedValue({
        data: {
          models: [
            { name: 'qwen2:1.5b-instruct-q4_0' },
            { name: 'smollm2:1.7b-instruct-q4_0' },
            { name: 'deepseek-r1:1.5b-q4_0' }
          ]
        }
      });
      
      mockedAxios.post.mockResolvedValue({ data: { response: 'Hi' } });
      
      await modelManager.initialize();
      
      // Should warm up each model
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/generate'),
        expect.objectContaining({
          model: 'qwen2:1.5b-instruct-q4_0',
          prompt: 'Hi',
          stream: false,
          options: { num_predict: 1 }
        })
      );
    });
  });
  
  describe('inference', () => {
    beforeEach(async () => {
      // Setup successful initialization
      const mockProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(0);
        })
      };
      mockedSpawn.mockReturnValue(mockProcess as any);
      
      mockedAxios.get.mockResolvedValue({
        data: {
          models: [
            { name: 'qwen2:1.5b-instruct-q4_0' },
            { name: 'smollm2:1.7b-instruct-q4_0' },
            { name: 'deepseek-r1:1.5b-q4_0' }
          ]
        }
      });
      
      mockedAxios.post.mockResolvedValue({ data: { response: 'Test response' } });
      
      await modelManager.initialize();
    });
    
    test('should perform inference with correct parameters', async () => {
      const prompt = 'Analyze this command: rm -rf /';
      const response = await modelManager.inference('qwen2', prompt);
      
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        {
          model: 'qwen2:1.5b-instruct-q4_0',
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.1,
            top_k: 10,
            top_p: 0.9,
            num_predict: 512,
            num_ctx: 2048,
            repeat_penalty: 1.1,
            seed: -1
          }
        }
      );
      
      expect(response).toBe('Test response');
    });
    
    test('should use model-specific context size', async () => {
      await modelManager.inference('deepseek', 'Test prompt');
      
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:11436/api/generate',
        expect.objectContaining({
          options: expect.objectContaining({
            num_ctx: 4096 // DeepSeek has larger context
          })
        })
      );
    });
    
    test('should throw error for unknown model', async () => {
      await expect(
        modelManager.inference('unknown-model', 'Test')
      ).rejects.toThrow('Model unknown-model not found');
    });
  });
  
  describe('shutdown', () => {
    test('should clean up resources', async () => {
      await modelManager.shutdown();
      expect(modelManager.isInitialized()).toBe(false);
    });
  });
});