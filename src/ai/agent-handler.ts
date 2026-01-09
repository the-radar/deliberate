import { spawn } from 'child_process';
import { AgentAuthSystem } from './auth-system';
import { AnalysisResult } from '../llm/analysis-orchestrator';
import { Logger } from '../utils/logger';

export interface AgentExecutionRequest {
  authCode: string;
  agentId: string;
  metadata?: Record<string, any>;
}

export interface AgentExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
}

export class AgentCommandHandler {
  private authSystem: AgentAuthSystem;
  private logger: Logger;
  private executionLog: Map<string, any[]> = new Map();
  
  constructor() {
    this.authSystem = new AgentAuthSystem();
    this.logger = new Logger('agent-handler');
  }
  
  /**
   * Generate an auth code for AI agent use
   */
  generateCodeForAgent(
    command: string, 
    args: string[], 
    analysis: AnalysisResult,
    agentContext?: any
  ): string {
    const authCode = this.authSystem.generateAuthCode(command, args, {
      ...analysis,
      agentContext,
      generatedAt: new Date().toISOString()
    });
    
    this.logger.info(`Generated auth code for agent: ${authCode}`);
    
    return authCode;
  }
  
  /**
   * Execute command with agent auth code
   */
  async executeWithAuth(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    // Validate auth code
    const validation = this.authSystem.validateAuthCode(request.authCode);
    
    if (!validation.valid || !validation.data) {
      this.logger.error(`Invalid auth code: ${request.authCode} - ${validation.reason}`);
      return {
        success: false,
        error: validation.reason || 'Invalid auth code'
      };
    }
    
    const { command, args } = validation.data;
    
    // Log execution attempt
    this.logExecution(request.agentId, {
      command,
      args,
      authCode: request.authCode,
      timestamp: Date.now(),
      metadata: request.metadata
    });
    
    try {
      // Execute the command
      const result = await this.executeCommand(command, args);
      
      // Log result
      this.logExecution(request.agentId, {
        type: 'result',
        ...result,
        timestamp: Date.now()
      });
      
      return result;
    } catch (error) {
      this.logger.error(`Execution failed for agent ${request.agentId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Execute command with safety checks
   */
  private async executeCommand(command: string, args: string[]): Promise<AgentExecutionResult> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        stdio: 'pipe',
        env: {
          ...process.env,
          DELIBERATE_AGENT_EXECUTION: '1'
        }
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('exit', (code) => {
        resolve({
          success: code === 0,
          output: stdout,
          error: stderr || undefined,
          exitCode: code || 0
        });
      });
      
      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message
        });
      });
    });
  }
  
  /**
   * Log agent execution for audit
   */
  private logExecution(agentId: string, data: any): void {
    if (!this.executionLog.has(agentId)) {
      this.executionLog.set(agentId, []);
    }
    
    this.executionLog.get(agentId)!.push(data);
    
    // Keep last 1000 entries per agent
    const logs = this.executionLog.get(agentId)!;
    if (logs.length > 1000) {
      logs.splice(0, logs.length - 1000);
    }
  }
  
  /**
   * Get execution history for an agent
   */
  getAgentHistory(agentId: string): any[] {
    return this.executionLog.get(agentId) || [];
  }
  
  /**
   * Format auth code for display
   */
  formatAuthCodeForDisplay(code: string, analysis: AnalysisResult): string {
    const riskEmoji = {
      'ALLOW': '✅',
      'WARN': '⚠️',
      'BLOCK': '🚫'
    }[analysis.verdict];
    
    return `
╭─── AI Agent Authorization ───╮
│ Auth Code: ${code}          │
│ Risk: ${riskEmoji} ${analysis.verdict.padEnd(6)}           │
│ Valid for: 5 minutes         │
╰──────────────────────────────╯

To execute: deliberate agent-exec ${code}
`;
  }
}