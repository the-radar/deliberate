import { spawn } from 'child_process';
import * as path from 'path';
import { CommandClassifier } from '../classification/classifier';
import { TTYSecurity } from '../security/tty-security';
import { BypassPrevention } from '../security/bypass-prevention';
import { SensitiveDataRedactor } from '../redaction/redactor';
import { CommandRouter } from './command-router';
import { AnalysisOrchestrator, AnalysisContext } from '../../llm/analysis-orchestrator';
import { AgentCommandHandler } from '../../ai/agent-handler';
import { BuiltinCommandHandler } from '../commands/builtin-handler';
import { Logger } from '../../utils/logger';

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
  authCode?: string;
}

export class EnhancedCommandInterceptor {
  private classifier: CommandClassifier;
  private ttySecurity: TTYSecurity;
  private bypassPrevention: BypassPrevention;
  private redactor: SensitiveDataRedactor;
  private router: CommandRouter;
  private analysisOrchestrator: AnalysisOrchestrator;
  private agentHandler: AgentCommandHandler;
  private builtinHandler: BuiltinCommandHandler;
  private logger: Logger;
  private aiEnabled: boolean = true;

  constructor() {
    this.classifier = new CommandClassifier();
    this.ttySecurity = new TTYSecurity();
    this.bypassPrevention = new BypassPrevention();
    this.redactor = new SensitiveDataRedactor();
    this.router = new CommandRouter();
    this.analysisOrchestrator = new AnalysisOrchestrator();
    this.agentHandler = new AgentCommandHandler();
    this.builtinHandler = new BuiltinCommandHandler();
    this.logger = new Logger('interceptor-enhanced');
  }

  /**
   * Initialize AI components
   */
  async initialize(): Promise<void> {
    try {
      await this.analysisOrchestrator.initialize();
      this.aiEnabled = true;
    } catch (error) {
      this.logger.warn('AI initialization failed, falling back to pattern-based analysis:', error);
      this.aiEnabled = false;
    }
  }

  /**
   * Main interception entry point
   */
  async intercept(command: string, args: string[]): Promise<InterceptionResult> {
    try {
      // Build execution context
      const context = this.buildContext(command, args);
      
      // Check if it's a builtin command
      if (this.builtinHandler.isBuiltin(command)) {
        const builtinResult = await this.builtinHandler.handle(command, args);
        if (builtinResult.handled) {
          if (builtinResult.output) {
            process.stdout.write(builtinResult.output + '\n');
          }
          if (builtinResult.error) {
            process.stderr.write(builtinResult.error + '\n');
          }
          return {
            allowed: true,
            executed: true,
            exitCode: builtinResult.exitCode
          };
        }
      }
      
      // Redact sensitive data from command for logging
      const redactedCommand = await this.redactor.redactCommand(
        `${command} ${args.join(' ')}`
      );
      
      this.logger.info(`Intercepted: ${redactedCommand}`);
      
      // Check for bypass attempts
      const bypassCheck = await this.bypassPrevention.detectBypass(context);
      if (bypassCheck.detected && bypassCheck.confidence > 0.8) {
        this.logger.error(`Bypass attempt detected: ${bypassCheck.method}`);
        await this.bypassPrevention.logBypassAttempt({
          timestamp: Date.now(),
          method: bypassCheck.method || 'unknown',
          command: redactedCommand,
          processTree: [],
          environment: context.env,
          decision: 'BLOCKED'
        });
        
        return {
          allowed: false,
          executed: false,
          reason: `Security violation: ${bypassCheck.details}`,
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
      
      // Perform AI analysis if enabled
      let analysis;
      if (this.aiEnabled) {
        const analysisContext: AnalysisContext = {
          cwd: context.cwd,
          user: context.user,
          platform: process.platform,
          isSudo: context.sudo
        };
        
        try {
          analysis = await this.analysisOrchestrator.analyze(command, args, analysisContext);
        } catch (error) {
          this.logger.error('AI analysis failed:', error);
          // Fall back to pattern-based classification
        }
      }
      
      // If no AI analysis, use pattern-based classification
      if (!analysis) {
        const classification = await this.classifier.classify(command, args, context);
        const verdict = classification.requiresApproval ? 'WARN' : 'ALLOW';
        analysis = {
          verdict: verdict as 'ALLOW' | 'WARN' | 'BLOCK',
          explanation: classification.reason || 'Command classified by patterns',
          risks: [],
          confidence: 0.7
        };
      }
      
      // Handle based on verdict
      switch (analysis.verdict) {
        case 'BLOCK':
          return {
            allowed: false,
            executed: false,
            reason: analysis.explanation,
            analysis
          };
          
        case 'WARN':
          // Ensure we have a real TTY
          const ttyCheck = await this.ttySecurity.checkTTY();
          if (!ttyCheck.isRealTTY) {
            // For non-TTY, generate auth code for AI agents
            const authCode = this.agentHandler.generateCodeForAgent(
              command,
              args,
              analysis
            );
            
            return {
              allowed: false,
              executed: false,
              reason: 'TTY required for approval. Auth code generated for AI agent use.',
              authCode,
              analysis
            };
          }
          
          // Get user approval with AI-enhanced explanation
          const approval = await this.ttySecurity.getApprovalWithAnalysis(
            command,
            args,
            analysis
          );
          
          if (!approval.approved) {
            return {
              allowed: false,
              executed: false,
              reason: approval.reason || 'User denied execution',
              analysis
            };
          }
          break;
          
        case 'ALLOW':
          // Command is safe, proceed with execution
          break;
      }
      
      // Execute the command
      return await this.executeCommand(command, args, context);
      
    } catch (error) {
      this.logger.error('Interception error:', error);
      
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
    
    // Check if we're running under sudo
    if (process.env.SUDO_USER || process.env.SUDO_COMMAND) {
      return true;
    }
    
    // Check for doas or other privilege escalation
    if (command === 'doas' || command === 'su') {
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

  /**
   * Handle agent execution request
   */
  async handleAgentExecution(authCode: string, agentId: string): Promise<InterceptionResult> {
    const result = await this.agentHandler.executeWithAuth({
      authCode,
      agentId
    });
    
    return {
      allowed: result.success,
      executed: result.success,
      exitCode: result.exitCode,
      reason: result.error
    };
  }

  /**
   * Shutdown AI components
   */
  async shutdown(): Promise<void> {
    await this.analysisOrchestrator.shutdown();
  }
}