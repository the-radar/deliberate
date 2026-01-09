import { InterceptionContext } from './interceptor';

export interface RoutingDecision {
  direct: boolean;           // Execute directly without analysis
  requiresAnalysis: boolean; // Needs LLM analysis
  requiresApproval: boolean; // Needs user approval
  isBuiltin: boolean;       // Shell builtin command
  requiresShell: boolean;   // Must be executed through shell
  routed?: string;          // Routing decision type
  reason?: string;          // Reasoning for decision
}

export interface CommandInfo {
  command: string;
  args: string[];
  fullCommand: string;
  isChain: boolean;
  isPipe: boolean;
  chainCommands?: string[];
  pipeCommands?: string[];
  hasRedirection: boolean;
  hasGlobbing: boolean;
  hasVariables: boolean;
}

export class CommandRouter {
  private safeCommands: Set<string>;
  private alwaysDangerousCommands: Set<string>;
  private builtinCommands: Set<string>;

  constructor() {
    // Initialize safe commands (read-only operations)
    this.safeCommands = new Set([
      'ls', 'pwd', 'echo', 'date', 'whoami', 'hostname',
      'cat', 'less', 'more', 'head', 'tail', 'grep',
      'wc', 'sort', 'uniq', 'find', 'which', 'whereis',
      'ps', 'top', 'df', 'du', 'free', 'uptime',
      'git status', 'git log', 'git diff', 'git branch',
      'npm list', 'yarn list', 'python --version',
      'node --version', 'java -version',
    ]);

    // Commands that are always dangerous
    this.alwaysDangerousCommands = new Set([
      'rm', 'rmdir', 'dd', 'mkfs', 'format',
      'chmod', 'chown', 'sudo', 'su', 'doas',
      'kill', 'killall', 'pkill', 'shutdown', 'reboot',
      'systemctl', 'service', 'iptables', 'firewall-cmd',
    ]);

    // Shell builtin commands
    this.builtinCommands = new Set([
      'cd', 'export', 'unset', 'set', 'alias', 'unalias',
      'source', '.', 'eval', 'exec', 'exit', 'return',
      'break', 'continue', 'shift', 'trap', 'wait',
      'bg', 'fg', 'jobs', 'disown', 'suspend',
      'type', 'hash', 'help', 'history', 'fc',
      'read', 'printf', 'test', '[', '[[',
      'true', 'false', ':', 'declare', 'typeset',
      'local', 'readonly', 'unset', 'let',
    ]);
  }

  /**
   * Route command for processing
   */
  async route(
    command: string,
    args: string[],
    context: InterceptionContext
  ): Promise<RoutingDecision> {
    // Parse command information
    const cmdInfo = this.parseCommand(command, args);

    // Check if it's a shell builtin
    if (this.isBuiltin(cmdInfo.command)) {
      return {
        direct: false,
        requiresAnalysis: true,
        requiresApproval: true,
        isBuiltin: true,
        requiresShell: true,
        routed: 'builtin',
        reason: 'Shell builtin command requires special handling',
      };
    }

    // Check for command chains or pipes
    if (cmdInfo.isChain || cmdInfo.isPipe) {
      return {
        direct: false,
        requiresAnalysis: true,
        requiresApproval: true,
        isBuiltin: false,
        requiresShell: true,
        routed: 'complex',
        reason: 'Command chain or pipe requires analysis',
      };
    }

    // Check if always dangerous
    if (this.isAlwaysDangerous(cmdInfo.command)) {
      return {
        direct: false,
        requiresAnalysis: true,
        requiresApproval: true,
        isBuiltin: false,
        requiresShell: false,
        routed: 'dangerous',
        reason: 'Command is inherently dangerous',
      };
    }

    // Check if it's sudo
    if (command === 'sudo' || context.sudo) {
      return {
        direct: false,
        requiresAnalysis: true,
        requiresApproval: true,
        isBuiltin: false,
        requiresShell: false,
        routed: 'sudo',
        reason: 'All sudo commands require approval',
      };
    }

    // Check if safe command
    if (this.isSafeCommand(cmdInfo.command, cmdInfo.args)) {
      return {
        direct: true,
        requiresAnalysis: false,
        requiresApproval: false,
        isBuiltin: false,
        requiresShell: false,
        routed: 'safe',
        reason: 'Command is known to be safe',
      };
    }

    // Default: analyze unknown commands
    return {
      direct: false,
      requiresAnalysis: true,
      requiresApproval: true,
      isBuiltin: false,
      requiresShell: false,
      routed: 'unknown',
      reason: 'Unknown command requires analysis',
    };
  }

  /**
   * Parse command to extract information
   */
  private parseCommand(command: string, args: string[]): CommandInfo {
    const fullCommand = `${command} ${args.join(' ')}`;
    
    // Check for command chains (&&, ||, ;)
    const chainPattern = /(\s*&&\s*|\s*\|\|\s*|\s*;\s*)/;
    const isChain = args.some(arg => chainPattern.test(arg));
    
    // Check for pipes
    const isPipe = args.includes('|');
    
    // Extract chain/pipe commands if present
    let chainCommands: string[] = [];
    let pipeCommands: string[] = [];
    
    if (isChain) {
      chainCommands = fullCommand.split(chainPattern)
        .filter((_, i) => i % 2 === 0) // Skip operators
        .map(cmd => cmd.trim());
    }
    
    if (isPipe) {
      pipeCommands = fullCommand.split('|').map(cmd => cmd.trim());
    }
    
    // Check for other shell features
    const hasRedirection = args.some(arg => 
      /^(<|>|>>|<<|<&|>&|&>|&>>)/.test(arg)
    );
    
    const hasGlobbing = args.some(arg => 
      /[\*\?\[\]]/.test(arg)
    );
    
    const hasVariables = args.some(arg => 
      /\$[A-Za-z_]|\${[A-Za-z_]/.test(arg)
    );
    
    return {
      command,
      args,
      fullCommand,
      isChain,
      isPipe,
      chainCommands,
      pipeCommands,
      hasRedirection,
      hasGlobbing,
      hasVariables,
    };
  }

  /**
   * Check if command is a shell builtin
   */
  private isBuiltin(command: string): boolean {
    return this.builtinCommands.has(command);
  }

  /**
   * Check if command is always dangerous
   */
  private isAlwaysDangerous(command: string): boolean {
    return this.alwaysDangerousCommands.has(command);
  }

  /**
   * Check if command is safe
   */
  private isSafeCommand(command: string, args: string[]): boolean {
    // Check exact command
    if (this.safeCommands.has(command)) {
      // Additional checks for safe commands with dangerous args
      if (command === 'find') {
        // find with -exec is dangerous
        if (args.includes('-exec') || args.includes('-execdir')) {
          return false;
        }
      }
      
      if (command === 'git') {
        // Only certain git commands are safe
        const gitCmd = args[0];
        const safeGitCommands = ['status', 'log', 'diff', 'branch', 'show'];
        if (!gitCmd || !safeGitCommands.includes(gitCmd)) {
          return false;
        }
      }
      
      return true;
    }
    
    // Check command with primary argument
    const cmdWithArg = `${command} ${args[0] || ''}`.trim();
    if (this.safeCommands.has(cmdWithArg)) {
      return true;
    }
    
    return false;
  }

  /**
   * Add custom safe command
   */
  addSafeCommand(command: string): void {
    this.safeCommands.add(command);
  }

  /**
   * Add custom dangerous command
   */
  addDangerousCommand(command: string): void {
    this.alwaysDangerousCommands.add(command);
  }

  /**
   * Remove from safe commands
   */
  removeSafeCommand(command: string): void {
    this.safeCommands.delete(command);
  }

  /**
   * Get routing statistics
   */
  getStats(): { safe: number; dangerous: number; builtins: number } {
    return {
      safe: this.safeCommands.size,
      dangerous: this.alwaysDangerousCommands.size,
      builtins: this.builtinCommands.size,
    };
  }
}