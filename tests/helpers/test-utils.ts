import { spawn, SpawnOptions } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export interface TestEnvironment {
  tempDir: string;
  shimDir: string;
  configPath: string;
  cleanup: () => Promise<void>;
}

export class TestUtils {
  /**
   * Delay execution for a specified number of milliseconds
   */
  static async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  /**
   * Execute a command and capture output
   */
  static async execute(
    command: string,
    args: string[] = [],
    options: SpawnOptions = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        ...options,
        stdio: 'pipe',
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
          duration: Date.now() - startTime,
        });
      });
    });
  }
  
  /**
   * Create a temporary test environment
   */
  static async createTestEnvironment(): Promise<TestEnvironment> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deliberate-test-'));
    const shimDir = path.join(tempDir, 'shims');
    const configPath = path.join(tempDir, 'config.yaml');
    
    await fs.mkdir(shimDir, { recursive: true });
    
    return {
      tempDir,
      shimDir,
      configPath,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      },
    };
  }
  
  /**
   * Create a mock command file
   */
  static async createMockCommand(
    dir: string,
    name: string,
    content: string = '#!/bin/bash\necho "mock command executed"'
  ): Promise<string> {
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, content);
    await fs.chmod(filePath, 0o755);
    return filePath;
  }
  
  /**
   * Wait for a condition to be true
   */
  static async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    throw new Error(`Timeout waiting for condition after ${timeout}ms`);
  }
  
  /**
   * Measure execution time of a function
   */
  static async measureTime<T>(
    fn: () => T | Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const startTime = process.hrtime.bigint();
    const result = await fn();
    const endTime = process.hrtime.bigint();
    
    return {
      result,
      duration: Number(endTime - startTime) / 1_000_000, // Convert to milliseconds
    };
  }
  
  /**
   * Create a test configuration file
   */
  static async createTestConfig(
    configPath: string,
    config: Record<string, any>
  ): Promise<void> {
    const yaml = require('js-yaml');
    await fs.writeFile(configPath, yaml.dump(config));
  }
  
  /**
   * Get memory usage in MB
   */
  static getMemoryUsage(): number {
    const usage = process.memoryUsage();
    return Math.round(usage.rss / 1024 / 1024);
  }
  
  /**
   * Assert that a promise rejects with specific error
   */
  static async assertRejects(
    promise: Promise<any>,
    errorMessage?: string | RegExp
  ): Promise<void> {
    try {
      await promise;
      throw new Error('Expected promise to reject but it resolved');
    } catch (error: any) {
      if (errorMessage) {
        if (typeof errorMessage === 'string') {
          expect(error.message).toContain(errorMessage);
        } else {
          expect(error.message).toMatch(errorMessage);
        }
      }
    }
  }
}