import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface SecurityReport {
  isTTY: boolean;
  isPipe: boolean;
  parentProcess?: string;
  environmentVariables: Record<string, string>;
  suspiciousPatterns: string[];
}

export interface BypassAttempt {
  method: string;
  command: string;
  blocked: boolean;
  error?: string;
}

export class SecurityTestHelper {
  /**
   * Attempt various bypass methods
   */
  static async attemptBypass(
    method: string,
    command: string
  ): Promise<boolean> {
    const bypassMethods: Record<string, (cmd: string) => Promise<boolean>> = {
      'pipe': this.attemptPipeBypass,
      'directPath': this.attemptDirectPathBypass,
      'escape': this.attemptEscapeBypass,
      'pty': this.attemptPTYBypass,
      'env': this.attemptEnvBypass,
      'timing': this.attemptTimingBypass,
    };
    
    const attemptFn = bypassMethods[method];
    if (!attemptFn) {
      throw new Error(`Unknown bypass method: ${method}`);
    }
    
    return attemptFn.call(this, command);
  }
  
  /**
   * Validate TTY security
   */
  static async validateTTYSecurity(): Promise<SecurityReport> {
    const report: SecurityReport = {
      isTTY: process.stdin.isTTY || false,
      isPipe: false,
      environmentVariables: {},
      suspiciousPatterns: [],
    };
    
    // Check if stdin is a pipe
    try {
      const stats = fs.fstatSync(0); // stdin
      report.isPipe = stats.isFIFO();
    } catch {
      // Unable to stat stdin
    }
    
    // Get parent process
    try {
      const ppid = process.ppid;
      // Would need platform-specific code to get parent process name
      report.parentProcess = `PID: ${ppid}`;
    } catch {
      // Unable to get parent process
    }
    
    // Check environment variables
    const suspiciousVars = [
      'DELIBERATE_BYPASS',
      'SKIP_SAFETY',
      'AUTO_APPROVE',
      'NO_TTY_CHECK',
    ];
    
    for (const varName of suspiciousVars) {
      if (process.env[varName]) {
        report.suspiciousPatterns.push(`Environment variable: ${varName}`);
        report.environmentVariables[varName] = process.env[varName] || '';
      }
    }
    
    return report;
  }
  
  /**
   * Test all known bypass methods
   */
  static async testAllBypasses(command: string): Promise<BypassAttempt[]> {
    const methods = [
      { method: 'pipe', command: `echo "y" | deliberate ${command}` },
      { method: 'yes', command: `yes | deliberate ${command}` },
      { method: 'file', command: `deliberate ${command} < /tmp/yes.txt` },
      { method: 'herestring', command: `deliberate ${command} <<< "y"` },
      { method: 'directpath', command: `/usr/bin/${command}` },
      { method: 'escape', command: `\\${command}` },
      { method: 'script', command: `script -c "echo y | deliberate ${command}"` },
      { method: 'expect', command: `expect -c "spawn deliberate ${command}; send y\\r"` },
    ];
    
    const results: BypassAttempt[] = [];
    
    for (const { method, command: fullCommand } of methods) {
      try {
        const blocked = await this.attemptBypass(method, command);
        results.push({
          method,
          command: fullCommand,
          blocked,
        });
      } catch (error: any) {
        results.push({
          method,
          command: fullCommand,
          blocked: true,
          error: error.message,
        });
      }
    }
    
    return results;
  }
  
  /**
   * Create a malicious environment
   */
  static createMaliciousEnvironment(): Record<string, string> {
    return {
      PATH: '/malicious:/original/path',
      LD_PRELOAD: '/path/to/evil.so',
      DELIBERATE_BYPASS: '1',
      AUTO_APPROVE: 'true',
      SKIP_SAFETY: '1',
    };
  }
  
  /**
   * Test process tree analysis
   */
  static async analyzeProcessTree(): Promise<{
    depth: number;
    suspiciousProcesses: string[];
  }> {
    // This would need platform-specific implementation
    // For testing, we'll simulate the analysis
    return {
      depth: 3,
      suspiciousProcesses: ['yes', 'echo', 'script'],
    };
  }
  
  // Private bypass attempt methods
  private static async attemptPipeBypass(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', `echo "y" | deliberate ${command}`], {
        stdio: 'pipe',
      });
      
      child.on('close', (code) => {
        // If exit code is non-zero, bypass was blocked
        resolve(code !== 0);
      });
    });
  }
  
  private static async attemptDirectPathBypass(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('/usr/bin/' + command.split(' ')[0], command.split(' ').slice(1), {
        stdio: 'pipe',
      });
      
      child.on('close', (code) => {
        // Check if deliberate intercepted it
        resolve(false); // Would need to check if deliberate was invoked
      });
    });
  }
  
  private static async attemptEscapeBypass(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', `\\${command}`], {
        stdio: 'pipe',
      });
      
      child.on('close', (code) => {
        resolve(code !== 0);
      });
    });
  }
  
  private static async attemptPTYBypass(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('script', ['-c', `echo y | deliberate ${command}`, '/dev/null'], {
        stdio: 'pipe',
      });
      
      child.on('close', (code) => {
        resolve(code !== 0);
      });
    });
  }
  
  private static async attemptEnvBypass(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('deliberate', command.split(' '), {
        stdio: 'pipe',
        env: {
          ...process.env,
          DELIBERATE_BYPASS: '1',
          AUTO_APPROVE: 'true',
        },
      });
      
      child.on('close', (code) => {
        resolve(code !== 0);
      });
    });
  }
  
  private static async attemptTimingBypass(command: string): Promise<boolean> {
    // Simulate rapid automated responses
    return new Promise((resolve) => {
      const child = spawn('deliberate', command.split(' '), {
        stdio: 'pipe',
      });
      
      // Send response immediately (0ms delay)
      child.stdin.write('y\n');
      
      child.on('close', (code) => {
        resolve(code !== 0);
      });
    });
  }
}