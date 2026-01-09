import * as fs from 'fs/promises';
import { InterceptionContext } from '../interception/interceptor';

export interface ClassificationResult {
  command: string;
  riskLevel: 'SAFE' | 'CAUTION' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';
  category: string;
  isDangerous: boolean | null;
  requiresApproval: boolean;
  requiresAnalysis?: boolean;
  readonly?: boolean;
  isSudo?: boolean;
  isChain?: boolean;
  isPipe?: boolean;
  hasVariables?: boolean;
  risks?: string[];
  reason?: string;
  source?: 'default' | 'user-defined' | 'user-override';
  originalClassification?: string;
  cached?: boolean;
  pipeStages?: string[];
  chainCommands?: string[];
  analysisType?: string;
  isScriptExecution?: boolean;
  notes?: string;
}

export interface UserRules {
  safeList: string[];
  dangerList: string[];
  patterns?: {
    safe: string[];
    danger: string[];
  };
}

export class CommandClassifier {
  private userRules: UserRules = {
    safeList: [],
    dangerList: [],
    patterns: {
      safe: [],
      danger: [],
    },
  };

  private cache = new Map<string, ClassificationResult>();

  // Built-in dangerous patterns
  private dangerousPatterns = [
    { pattern: /rm\s+-rf\s+\//, risk: 'CRITICAL', description: 'Recursive force remove from root' },
    { pattern: /dd\s+.*of=\/dev\/[sh]d/, risk: 'CRITICAL', description: 'Direct disk write' },
    { pattern: />\s*\/dev\/[sh]d/, risk: 'CRITICAL', description: 'Redirect to disk device' },
    { pattern: /chmod\s+777/, risk: 'HIGH', description: 'World-writable permissions' },
    { pattern: /curl.*\|\s*bash/, risk: 'CRITICAL', description: 'Remote script execution' },
    { pattern: /wget.*\|\s*sh/, risk: 'CRITICAL', description: 'Remote script execution' },
    { pattern: /:\(\)\s*\{.*\|\s*:\s*&\s*\};/, risk: 'CRITICAL', description: 'Fork bomb' },
  ];

  // Safe commands by default
  private safeCommands = new Set([
    'ls', 'pwd', 'echo', 'date', 'whoami', 'hostname',
    'cat', 'less', 'more', 'head', 'tail', 'grep',
    'wc', 'sort', 'uniq', 'which', 'whereis',
    'ps', 'top', 'df', 'du', 'free', 'uptime',
    'man', 'help', 'info', 'type', 'file',
  ]);

  // Always dangerous commands
  private dangerousCommands = new Set([
    'rm', 'rmdir', 'dd', 'mkfs', 'format',
    'chmod', 'chown', 'kill', 'killall', 'pkill',
    'shutdown', 'reboot', 'halt', 'poweroff',
    'systemctl', 'service', 'iptables', 'firewall-cmd',
  ]);

  /**
   * Classify a command based on risk
   */
  async classify(
    command: string,
    args: string[] = [],
    context?: InterceptionContext
  ): Promise<ClassificationResult> {
    const fullCommand = `${command} ${args.join(' ')}`.trim();
    
    // Check cache first
    const cached = this.cache.get(fullCommand);
    if (cached) {
      return { ...cached, cached: true };
    }

    // Check if it's sudo
    if (command === 'sudo' || context?.sudo) {
      const result: ClassificationResult = {
        command: fullCommand,
        riskLevel: 'HIGH',
        category: 'sudo',
        isDangerous: true,
        requiresApproval: true,
        isSudo: true,
        reason: 'All sudo commands require approval',
      };
      this.cache.set(fullCommand, result);
      return result;
    }

    // Check user rules first (they override defaults)
    const userOverride = await this.checkUserRules(command, fullCommand);
    if (userOverride) {
      this.cache.set(fullCommand, userOverride);
      return userOverride;
    }

    // Check for dangerous patterns
    for (const { pattern, risk, description } of this.dangerousPatterns) {
      if (pattern.test(fullCommand)) {
        const result: ClassificationResult = {
          command: fullCommand,
          riskLevel: risk as any,
          category: 'pattern_match',
          isDangerous: true,
          requiresApproval: true,
          risks: [description],
          reason: `Matched dangerous pattern: ${description}`,
        };
        this.cache.set(fullCommand, result);
        return result;
      }
    }

    // Check command chains and pipes
    if (args.some(arg => arg.includes('&&') || arg.includes('||') || arg.includes(';'))) {
      const result = await this.classifyChain(fullCommand);
      this.cache.set(fullCommand, result);
      return result;
    }

    if (args.includes('|')) {
      const result = await this.classifyPipe(fullCommand);
      this.cache.set(fullCommand, result);
      return result;
    }

    // Check if it's a known dangerous command
    if (this.dangerousCommands.has(command)) {
      const result = this.classifyDangerousCommand(command, args, fullCommand);
      this.cache.set(fullCommand, result);
      return result;
    }

    // Check if it's a known safe command
    if (this.safeCommands.has(command)) {
      const result = this.classifySafeCommand(command, args, fullCommand);
      this.cache.set(fullCommand, result);
      return result;
    }

    // Unknown command - requires analysis
    const result: ClassificationResult = {
      command: fullCommand,
      riskLevel: 'UNKNOWN',
      category: 'unknown',
      isDangerous: null,
      requiresApproval: true,
      requiresAnalysis: true,
      reason: 'Unknown command requires analysis',
    };
    this.cache.set(fullCommand, result);
    return result;
  }

  /**
   * Get risk level for a command
   */
  async getRiskLevel(command: string, args?: string[]): Promise<string> {
    const classification = await this.classify(command, args);
    return classification.riskLevel;
  }

  /**
   * Analyze command with context
   */
  async analyzeContext(
    command: string,
    context: any
  ): Promise<ClassificationResult & { context: any }> {
    const classification = await this.classify(command, [], context);
    
    // Adjust risk based on context
    let adjustedRisk = classification.riskLevel;
    let description = classification.reason || '';

    // Example: rm in home directory vs system directory
    if (command.startsWith('rm ') && context.cwd) {
      if (context.cwd === '/' || context.cwd.startsWith('/etc') || context.cwd.startsWith('/usr')) {
        adjustedRisk = 'CRITICAL';
        description = 'Dangerous operation in system directory';
      } else if (context.cwd.startsWith('/tmp')) {
        adjustedRisk = 'CAUTION';
        description = 'Operation in temporary directory';
      }
    }

    return {
      ...classification,
      riskLevel: adjustedRisk,
      reason: description,
      context,
    };
  }

  /**
   * Check user-defined rules
   */
  private async checkUserRules(
    command: string,
    fullCommand: string
  ): Promise<ClassificationResult | null> {
    // Check danger list first (takes precedence)
    if (this.userRules.dangerList.includes(command)) {
      return {
        command: fullCommand,
        riskLevel: 'HIGH',
        category: 'user_defined',
        isDangerous: true,
        requiresApproval: true,
        source: 'user-defined',
        reason: 'Command is in user danger list',
      };
    }

    // Check safe list
    if (this.userRules.safeList.includes(command)) {
      return {
        command: fullCommand,
        riskLevel: 'SAFE',
        category: 'user_defined',
        isDangerous: false,
        requiresApproval: false,
        source: 'user-defined',
        reason: 'Command is in user safe list',
      };
    }

    // Check patterns
    if (this.userRules.patterns) {
      // Check danger patterns
      for (const pattern of this.userRules.patterns.danger || []) {
        if (new RegExp(pattern).test(fullCommand)) {
          return {
            command: fullCommand,
            riskLevel: 'HIGH',
            category: 'user_pattern',
            isDangerous: true,
            requiresApproval: true,
            source: 'user-defined',
            reason: 'Matched user danger pattern',
          };
        }
      }

      // Check safe patterns
      for (const pattern of this.userRules.patterns.safe || []) {
        if (new RegExp(pattern).test(fullCommand)) {
          return {
            command: fullCommand,
            riskLevel: 'SAFE',
            category: 'user_pattern',
            isDangerous: false,
            requiresApproval: false,
            source: 'user-defined',
            reason: 'Matched user safe pattern',
          };
        }
      }
    }

    return null;
  }

  /**
   * Classify command chains
   */
  private async classifyChain(fullCommand: string): Promise<ClassificationResult> {
    const chainPattern = /(\s*&&\s*|\s*\|\|\s*|\s*;\s*)/;
    const commands = fullCommand.split(chainPattern)
      .filter((_, i) => i % 2 === 0)
      .map(cmd => cmd.trim());

    // Check each command in the chain
    let highestRisk: ClassificationResult['riskLevel'] = 'SAFE';
    const risks: string[] = [];

    for (const cmd of commands) {
      const parts = cmd.split(/\s+/);
      const cmdName = parts[0] || '';
      const cmdArgs = parts.slice(1);
      const classification = await this.classify(cmdName, cmdArgs);
      
      if (this.isHigherRisk(classification.riskLevel, highestRisk)) {
        highestRisk = classification.riskLevel;
      }
      
      if (classification.risks) {
        risks.push(...classification.risks);
      }
    }

    return {
      command: fullCommand,
      riskLevel: highestRisk,
      category: 'chain',
      isDangerous: highestRisk !== 'SAFE',
      requiresApproval: highestRisk !== 'SAFE',
      isChain: true,
      chainCommands: commands,
      risks,
      reason: 'Command chain requires analysis',
    };
  }

  /**
   * Classify piped commands
   */
  private async classifyPipe(fullCommand: string): Promise<ClassificationResult> {
    const pipeCommands = fullCommand.split('|').map(cmd => cmd.trim());
    
    let highestRisk: ClassificationResult['riskLevel'] = 'SAFE';
    const risks: string[] = [];

    for (const cmd of pipeCommands) {
      const parts = cmd.split(/\s+/);
      const cmdName = parts[0] || '';
      const cmdArgs = parts.slice(1);
      const classification = await this.classify(cmdName, cmdArgs);
      
      if (this.isHigherRisk(classification.riskLevel, highestRisk)) {
        highestRisk = classification.riskLevel;
      }
      
      if (classification.risks) {
        risks.push(...classification.risks);
      }
    }

    return {
      command: fullCommand,
      riskLevel: highestRisk,
      category: 'pipe',
      isDangerous: highestRisk !== 'SAFE',
      requiresApproval: highestRisk !== 'SAFE',
      isPipe: true,
      pipeStages: pipeCommands,
      risks,
      reason: 'Pipe command requires analysis',
    };
  }

  /**
   * Classify known dangerous command
   */
  private classifyDangerousCommand(
    command: string,
    args: string[],
    fullCommand: string
  ): ClassificationResult {
    // Determine risk level based on command and arguments
    let riskLevel: ClassificationResult['riskLevel'] = 'HIGH';
    const risks: string[] = [];

    if (command === 'rm') {
      if (args.includes('-rf') && (args.includes('/') || args.includes('/*'))) {
        riskLevel = 'CRITICAL';
        risks.push('Recursive force deletion from root');
      } else if (args.includes('-rf')) {
        riskLevel = 'HIGH';
        risks.push('Recursive force deletion');
      } else {
        riskLevel = 'CAUTION';
        risks.push('File deletion');
      }
    }

    return {
      command: fullCommand,
      riskLevel,
      category: 'system_modification',
      isDangerous: true,
      requiresApproval: true,
      risks,
      reason: `Dangerous command: ${command}`,
    };
  }

  /**
   * Classify known safe command
   */
  private classifySafeCommand(
    command: string,
    args: string[],
    fullCommand: string
  ): ClassificationResult {
    // Some safe commands can be dangerous with certain arguments
    if (command === 'find' && (args.includes('-exec') || args.includes('-execdir'))) {
      return {
        command: fullCommand,
        riskLevel: 'HIGH',
        category: 'conditional_execution',
        isDangerous: true,
        requiresApproval: true,
        risks: ['Command execution through find'],
        reason: 'Find with -exec is dangerous',
      };
    }

    return {
      command: fullCommand,
      riskLevel: 'SAFE',
      category: 'read_only',
      isDangerous: false,
      requiresApproval: false,
      readonly: true,
      reason: 'Safe read-only command',
    };
  }

  /**
   * Compare risk levels
   */
  private isHigherRisk(
    risk1: ClassificationResult['riskLevel'],
    risk2: ClassificationResult['riskLevel']
  ): boolean {
    const riskOrder = ['SAFE', 'CAUTION', 'HIGH', 'CRITICAL', 'UNKNOWN'];
    return riskOrder.indexOf(risk1) > riskOrder.indexOf(risk2);
  }

  /**
   * Load user rules from config
   */
  async loadUserRules(configPath: string): Promise<void> {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const rules = JSON.parse(content);
      
      if (rules.safeList) {
        this.userRules.safeList = rules.safeList;
      }
      
      if (rules.dangerList) {
        this.userRules.dangerList = rules.dangerList;
      }
      
      if (rules.patterns) {
        this.userRules.patterns = rules.patterns;
      }
      
      // Clear cache when rules change
      this.cache.clear();
    } catch (error) {
      // Config doesn't exist yet, use defaults
    }
  }

  /**
   * Add command to safe list
   */
  async addToSafeList(command: string): Promise<void> {
    if (!this.userRules.safeList.includes(command)) {
      this.userRules.safeList.push(command);
      this.cache.clear();
    }
  }

  /**
   * Add command to danger list
   */
  async addToDangerList(command: string): Promise<void> {
    if (!this.userRules.dangerList.includes(command)) {
      this.userRules.dangerList.push(command);
      this.cache.clear();
    }
  }

  /**
   * Get category for a command
   */
  async getCategory(command: string): Promise<string> {
    const classification = await this.classify(command);
    return classification.category;
  }
}