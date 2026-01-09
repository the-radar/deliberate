import { spawn } from 'child_process';
import * as path from 'path';
import { CommandClassifier } from '../classification/classifier';
import { TTYSecurity } from '../security/tty-security';
import { BypassPrevention } from '../security/bypass-prevention';
import { SensitiveDataRedactor } from '../redaction/redactor';
import { CommandRouter } from './command-router';
import { DirectExecutionHandler } from './direct-execution-handler';

export interface InterceptionContext {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  user: string;
  timestamp: number;
  sudo: boolean;
  shell?: string;
  terminal?: string;
  parentPid?: number;
}

export interface InterceptionResult {
  allowed: boolean;
  executed: boolean;
  exitCode?: number;
  reason?: string;
  analysis?: any;
  bypassed?: boolean;
}

export class CommandInterceptor {
  private classifier: CommandClassifier;
  private ttySecurity: TTYSecurity;
  private bypassPrevention: BypassPrevention;
  private redactor: SensitiveDataRedactor;
  private router: CommandRouter;
  private directExecutionHandler: DirectExecutionHandler;

  constructor() {
    this.classifier = new CommandClassifier();
    this.ttySecurity = new TTYSecurity();
    this.bypassPrevention = new BypassPrevention();
    this.redactor = new SensitiveDataRedactor();
    this.router = new CommandRouter();
    this.directExecutionHandler = new DirectExecutionHandler();
  }

  /**
   * Main interception entry point
   */
  async intercept(command: string, args: string[]): Promise<InterceptionResult> {
    try {
      // Check for direct execution attempts first
      const directExec = await this.directExecutionHandler.handleDirectExecution(command, args);
      if (directExec.intercepted && directExec.command) {
        // Update command and args for further processing
        command = directExec.command;
        args = directExec.args || args;
      }

      // Build execution context
      const context = this.buildContext(command, args);
      
      // Redact sensitive data from command for logging
      const redactedCommand = await this.redactor.redactCommand(
        `${command} ${args.join(' ')}`
      );
      
      console.error(`[Deliberate] Intercepted: ${redactedCommand}`);
      
      // Check for bypass attempts
      const bypassCheck = await this.bypassPrevention.detectBypass(context);
      if (bypassCheck.detected) {
        console.error(`[Deliberate] Bypass attempt detected: ${bypassCheck.method}`);
        return {
          allowed: false,
          executed: false,
          reason: `Bypass attempt detected: ${bypassCheck.method}`,
          bypassed: true,
        };
      }
      
      // Route command for analysis
      const routing = await this.router.route(command, args, context);
      
      // Handle based on routing decision
      if (routing.direct) {
        // Safe command, execute directly
        return await this.executeDirect(command, args, context);
      }
      
      // Classify command risk
      const classification = await this.classifier.classify(
        command,
        args,
        context
      );
      
      // Check if approval is required
      if (classification.requiresApproval) {
        // Ensure we have a real TTY
        const ttyCheck = await this.ttySecurity.checkTTY();
        if (!ttyCheck.isRealTTY) {
          return {
            allowed: false,
            executed: false,
            reason: 'TTY required for approval',
          };
        }
        
        // Get user approval
        const approval = await this.ttySecurity.getApproval(
          command,
          args,
          classification
        );
        
        if (!approval.approved) {
          return {
            allowed: false,
            executed: false,
            reason: approval.reason || 'User denied execution',
          };
        }
      }
      
      // Execute the command
      return await this.executeCommand(command, args, context);
      
    } catch (error) {
      console.error('[Deliberate] Interception error:', error);
      
      // On error, default to safe behavior (block)
      return {
        allowed: false,
        executed: false,
        reason: `Interception error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Build execution context
   */
  private buildContext(command: string, args: string[]): InterceptionContext {
    return {
      command,
      args,
      env: process.env,
      cwd: process.cwd(),
      user: process.env.USER || 'unknown',
      timestamp: Date.now(),
      sudo: this.isSudoCommand(command, args),
      shell: process.env.SHELL,
      terminal: process.env.TERM,
      parentPid: process.ppid,
    };
  }

  /**
   * Check if command involves sudo
   */
  private isSudoCommand(command: string, _args: string[]): boolean {
    if (command === 'sudo') {
      return true;
    }
    
    // Check for sudo environment variables
    if (process.env.SUDO_USER || process.env.SUDO_COMMAND) {
      return true;
    }
    
    return false;
  }

  /**
   * Execute safe command directly
   */
  private async executeDirect(
    command: string,
    args: string[],
    context: InterceptionContext
  ): Promise<InterceptionResult> {
    try {
      const realCommand = await this.findRealCommand(command);
      
      const child = spawn(realCommand, args, {
        stdio: 'inherit',
        env: this.cleanEnvironment(context.env),
        cwd: context.cwd,
      });
      
      const exitCode = await new Promise<number>((resolve) => {
        child.on('exit', (code) => resolve(code || 0));
      });
      
      return {
        allowed: true,
        executed: true,
        exitCode,
      };
    } catch (error) {
      return {
        allowed: false,
        executed: false,
        reason: `Execution failed: ${error}`,
      };
    }
  }

  /**
   * Execute command after approval
   */
  private async executeCommand(
    command: string,
    args: string[],
    context: InterceptionContext
  ): Promise<InterceptionResult> {
    try {
      // Find real command path
      const realCommand = await this.findRealCommand(command);
      
      // Clean environment to prevent injection
      const cleanEnv = this.cleanEnvironment(context.env);
      
      // Execute with monitoring
      const child = spawn(realCommand, args, {
        stdio: 'inherit',
        env: cleanEnv,
        cwd: context.cwd,
      });
      
      // Monitor execution
      const exitCode = await new Promise<number>((resolve, reject) => {
        child.on('exit', (code) => resolve(code || 0));
        child.on('error', (err) => reject(err));
      });
      
      return {
        allowed: true,
        executed: true,
        exitCode,
      };
    } catch (error) {
      return {
        allowed: true,
        executed: false,
        reason: `Execution failed: ${error}`,
      };
    }
  }

  /**
   * Find the real command path (not our shim)
   */
  private async findRealCommand(command: string): Promise<string> {
    // If absolute path, use it directly
    if (path.isAbsolute(command)) {
      return command;
    }
    
    // Remove our shim directory from PATH temporarily
    const shimDir = process.env.DELIBERATE_SHIM_PATH || '';
    const originalPath = process.env.PATH || '';
    const pathDirs = originalPath.split(':').filter(dir => dir !== shimDir);
    
    // Search for command in remaining PATH
    for (const dir of pathDirs) {
      const cmdPath = path.join(dir, command);
      try {
        const { access } = await import('fs/promises');
        await access(cmdPath, 0o111); // Check if executable
        return cmdPath;
      } catch {
        // Continue searching
      }
    }
    
    // Fallback to command as-is
    return command;
  }

  /**
   * Clean environment variables to prevent injection
   */
  private cleanEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const cleaned = { ...env };
    
    // Remove deliberate-specific variables
    delete cleaned.DELIBERATE_INTERCEPTING;
    delete cleaned.DELIBERATE_ORIGINAL_CMD;
    
    // Remove potentially dangerous variables
    delete cleaned.LD_PRELOAD;
    delete cleaned.LD_LIBRARY_PATH;
    delete cleaned.DYLD_INSERT_LIBRARIES;
    delete cleaned.DYLD_LIBRARY_PATH;
    
    return cleaned;
  }
}