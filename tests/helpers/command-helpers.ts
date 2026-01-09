import { spawn } from 'child_process';
import { TestUtils, ExecutionResult } from './test-utils';

export interface DeliberateOptions {
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  input?: string;
}

export class CommandTestHelper {
  private static deliberatePath = './bin/deliberate.js';
  
  /**
   * Execute a command through deliberate
   */
  static async executeWithDeliberate(
    command: string,
    args: string[] = [],
    options: DeliberateOptions = {}
  ): Promise<ExecutionResult> {
    const fullArgs = [command, ...args];
    
    const env = {
      ...process.env,
      DELIBERATE_TEST_MODE: 'true',
      ...options.env,
    };
    
    return TestUtils.execute(this.deliberatePath, fullArgs, {
      env,
      cwd: options.cwd,
      timeout: options.timeout || 10000,
    });
  }
  
  /**
   * Simulate user approval for a dangerous command
   */
  static async simulateUserApproval(
    command: string,
    args: string[] = [],
    approve: boolean = true
  ): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const child = spawn(this.deliberatePath, [command, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      let stdout = '';
      let stderr = '';
      let promptDetected = false;
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
        
        // Detect approval prompt
        if (!promptDetected && stdout.includes('Approve?')) {
          promptDetected = true;
          // Simulate user input
          child.stdin.write(approve ? 'y\n' : 'n\n');
          child.stdin.end();
        }
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
          duration: 0,
        });
      });
    });
  }
  
  /**
   * Test AI agent flow with auth code
   */
  static async testAIAgentFlow(
    command: string,
    args: string[] = []
  ): Promise<{
    analysisResult: ExecutionResult;
    authCode: string | null;
    executionResult?: ExecutionResult;
  }> {
    // Step 1: Get analysis and auth code
    const analysisResult = await this.executeWithDeliberate('ai', [command, ...args]);
    
    // Extract auth code from output
    const authCodeMatch = analysisResult.stdout.match(/([a-z]+-[a-z]+-\d{4})/);
    const authCode = authCodeMatch ? authCodeMatch[1] : null;
    
    if (!authCode) {
      return { analysisResult, authCode: null };
    }
    
    // Step 2: Execute with auth code
    const executionResult = await this.executeWithDeliberate('ai', [authCode, command, ...args]);
    
    return {
      analysisResult,
      authCode,
      executionResult,
    };
  }
  
  /**
   * Test bypass attempt
   */
  static async testBypassAttempt(bypassCommand: string): Promise<{
    blocked: boolean;
    error?: string;
  }> {
    try {
      const result = await TestUtils.execute('sh', ['-c', bypassCommand], {
        timeout: 5000,
      });
      
      // Check if deliberate blocked the attempt
      if (result.stderr.includes('TTY') || 
          result.stderr.includes('bypass') ||
          result.stderr.includes('pipe')) {
        return { blocked: true, error: result.stderr };
      }
      
      return { blocked: false };
    } catch (error: any) {
      return { blocked: true, error: error.message };
    }
  }
  
  /**
   * Test command classification
   */
  static async testClassification(
    command: string,
    args: string[] = []
  ): Promise<{
    classification: 'SAFE' | 'DANGEROUS' | 'UNKNOWN';
    confidence: number;
  }> {
    const result = await this.executeWithDeliberate(command, [...args, '--dry-run']);
    
    // Parse classification from output
    if (result.stdout.includes('DANGEROUS')) {
      const confidenceMatch = result.stdout.match(/confidence: ([\d.]+)/);
      return {
        classification: 'DANGEROUS',
        confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 1.0,
      };
    } else if (result.stdout.includes('SAFE')) {
      return {
        classification: 'SAFE',
        confidence: 1.0,
      };
    }
    
    return {
      classification: 'UNKNOWN',
      confidence: 0,
    };
  }
  
  /**
   * Create a command chain for testing
   */
  static createCommandChain(commands: string[]): string {
    return commands.join(' && ');
  }
  
  /**
   * Create a pipe chain for testing
   */
  static createPipeChain(commands: string[]): string {
    return commands.join(' | ');
  }
}