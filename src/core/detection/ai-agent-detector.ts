import { spawn } from 'child_process';

export interface AIAgentDetectionResult {
  isAIAgent: boolean;
  confidence: number;
  detectedAgent?: string;
  factors: {
    environment: boolean;
    processChain: boolean;
    executionPattern: boolean;
    networkContext: boolean;
  };
  evidence: string[];
}

export class AIAgentDetector {
  // Known AI agent environment patterns
  private readonly AI_ENV_PATTERNS = {
    claude_code: {
      required: ['CLAUDE_CODE_SSE_PORT'],
      optional: ['ANTHROPIC_API_KEY', 'VSCODE_INJECTION']
    },
    github_copilot: {
      required: ['GITHUB_COPILOT_WORKSPACE'],
      optional: ['GITHUB_TOKEN', 'COPILOT_API_KEY']
    },
    cursor: {
      required: ['CURSOR_WORKSPACE'],
      optional: ['CURSOR_API_KEY']
    },
    codeium: {
      required: ['CODEIUM_API_KEY'],
      optional: ['CODEIUM_WORKSPACE']
    },
    tabnine: {
      required: ['TABNINE_API_KEY'],
      optional: ['TABNINE_CLIENT_ID']
    },
    aider: {
      required: ['AIDER_'],
      optional: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']
    },
    continue_dev: {
      required: ['CONTINUE_'],
      optional: ['CONTINUE_API_KEY']
    },
    windsurf: {
      required: ['WINDSURF_'],
      optional: ['ENABLE_IDE_INTEGRATION']
    }
  };

  // Known AI agent process patterns
  private readonly AI_PROCESS_PATTERNS = [
    'claude-code',
    'copilot',
    'cursor',
    'codeium',
    'tabnine',
    'aider',
    'continue',
    'windsurf',
    'ai-assistant',
    'llm-agent'
  ];

  /**
   * Comprehensive AI agent detection
   */
  async detect(): Promise<AIAgentDetectionResult> {
    const factors = {
      environment: false,
      processChain: false,
      executionPattern: false,
      networkContext: false
    };
    const evidence: string[] = [];
    let detectedAgent: string | undefined;

    // 1. Environment Detection
    const envResult = this.checkEnvironment();
    if (envResult.detected) {
      factors.environment = true;
      detectedAgent = envResult.agent;
      evidence.push(`Environment matches ${envResult.agent} pattern`);
      envResult.matches.forEach(match => evidence.push(`  - ${match}`));
    }

    // 2. Process Chain Detection
    const processResult = await this.checkProcessChain();
    if (processResult.detected) {
      factors.processChain = true;
      evidence.push('AI agent found in process chain');
      processResult.processes.forEach(proc => evidence.push(`  - ${proc}`));
    }

    // 3. Execution Pattern Detection
    const patternResult = this.checkExecutionPattern();
    if (patternResult.detected) {
      factors.executionPattern = true;
      evidence.push('Execution pattern matches AI agent');
      patternResult.patterns.forEach(pattern => evidence.push(`  - ${pattern}`));
    }

    // 4. Network/IPC Context Detection
    const networkResult = await this.checkNetworkContext();
    if (networkResult.detected) {
      factors.networkContext = true;
      evidence.push('Network context indicates AI agent');
      networkResult.indicators.forEach(ind => evidence.push(`  - ${ind}`));
    }

    // Calculate confidence based on multiple factors
    const factorCount = Object.values(factors).filter(f => f).length;
    let confidence = 0;
    
    if (factorCount >= 3) {
      confidence = 0.95; // Very high confidence with 3+ factors
    } else if (factorCount === 2) {
      confidence = 0.85; // High confidence with 2 factors
    } else if (factors.environment) {
      confidence = 0.75; // Good confidence with just environment
    } else if (factorCount === 1) {
      confidence = 0.6; // Moderate confidence with 1 other factor
    }

    // Special case: No TTY + any factor = higher confidence
    if (!process.stdin.isTTY && factorCount > 0) {
      confidence = Math.min(confidence + 0.1, 0.99);
      evidence.push('No TTY detected (non-interactive)');
    }

    return {
      isAIAgent: confidence >= 0.6,
      confidence,
      detectedAgent,
      factors,
      evidence
    };
  }

  /**
   * Check environment variables for AI patterns
   */
  private checkEnvironment(): { detected: boolean; agent?: string; matches: string[] } {
    const matches: string[] = [];
    
    for (const [agent, patterns] of Object.entries(this.AI_ENV_PATTERNS)) {
      // Check required patterns
      let hasRequired = false;
      for (const req of patterns.required) {
        const found = Object.keys(process.env).some(key => key.includes(req));
        if (found) {
          hasRequired = true;
          matches.push(`Required: ${req}`);
        }
      }
      
      // Check optional patterns for additional confidence
      let optionalCount = 0;
      for (const opt of patterns.optional) {
        const found = Object.keys(process.env).some(key => key.includes(opt));
        if (found) {
          optionalCount++;
          matches.push(`Optional: ${opt}`);
        }
      }
      
      // If we have required + at least one optional, we're confident
      if (hasRequired && (optionalCount > 0 || patterns.optional.length === 0)) {
        return { detected: true, agent, matches };
      }
    }
    
    // Check for generic AI indicators
    const genericIndicators = [
      'AI_AGENT', 'LLM_', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
      'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY'
    ];
    
    const genericMatches = genericIndicators.filter(ind => 
      Object.keys(process.env).some(key => key.includes(ind))
    );
    
    if (genericMatches.length >= 2) {
      return { 
        detected: true, 
        agent: 'generic_ai', 
        matches: genericMatches.map(m => `Generic: ${m}`)
      };
    }
    
    return { detected: false, matches };
  }

  /**
   * Check process chain for AI agents
   */
  private async checkProcessChain(): Promise<{ detected: boolean; processes: string[] }> {
    const processes: string[] = [];
    
    try {
      // Get process tree
      const tree = await this.getProcessTree();
      
      // Check each process in the chain
      for (const proc of tree) {
        // Check against known AI process patterns
        for (const pattern of this.AI_PROCESS_PATTERNS) {
          if (proc.command.toLowerCase().includes(pattern)) {
            processes.push(`${proc.pid}: ${proc.command}`);
          }
        }
        
        // Check for language servers and IDE helpers
        if (proc.command.includes('language-server') || 
            proc.command.includes('lsp') ||
            proc.command.includes('Helper') ||
            proc.command.includes('code-server')) {
          processes.push(`${proc.pid}: ${proc.command} (IDE component)`);
        }
      }
      
      return { detected: processes.length > 0, processes };
    } catch {
      return { detected: false, processes };
    }
  }

  /**
   * Check execution patterns
   */
  private checkExecutionPattern(): { detected: boolean; patterns: string[] } {
    const patterns: string[] = [];
    
    // Pattern 1: No TTY but complex environment
    if (!process.stdin.isTTY && Object.keys(process.env).length > 50) {
      patterns.push('No TTY with rich environment');
    }
    
    // Pattern 2: Specific working directory patterns
    const cwd = process.cwd();
    if (cwd.includes('.vscode') || cwd.includes('.idea') || 
        cwd.includes('workspace') || cwd.includes('project')) {
      patterns.push(`IDE-like working directory: ${cwd}`);
    }
    
    // Pattern 3: Rapid command execution (check process uptime)
    if (process.uptime() < 1) {
      patterns.push('Very fast process startup');
    }
    
    // Pattern 4: Missing typical shell variables
    if (!process.env.PS1 && !process.env.PROMPT) {
      patterns.push('No shell prompt variables');
    }
    
    // Pattern 5: API-like environment
    const apiKeys = Object.keys(process.env).filter(k => 
      k.includes('API_KEY') || k.includes('TOKEN') || k.includes('SECRET')
    );
    if (apiKeys.length > 2) {
      patterns.push(`Multiple API keys present: ${apiKeys.length}`);
    }
    
    return { detected: patterns.length >= 2, patterns };
  }

  /**
   * Check network/IPC context
   */
  private async checkNetworkContext(): Promise<{ detected: boolean; indicators: string[] }> {
    const indicators: string[] = [];
    
    // Check for IPC/socket environment variables
    const ipcVars = Object.entries(process.env).filter(([k, v]) => 
      (k.includes('IPC') || k.includes('SOCKET') || k.includes('PORT')) && v
    );
    
    if (ipcVars.length > 0) {
      indicators.push(`IPC/Socket vars: ${ipcVars.map(([k]) => k).join(', ')}`);
    }
    
    // Check for localhost ports in environment
    const portPattern = /127\.0\.0\.1:\d+|localhost:\d+/;
    for (const [key, value] of Object.entries(process.env)) {
      if (value && portPattern.test(value)) {
        indicators.push(`Local service reference: ${key}=${value}`);
      }
    }
    
    // Check parent process for network servers
    try {
      const ppid = process.ppid;
      if (ppid) {
        const parentInfo = await this.getProcessInfo(ppid);
        if (parentInfo && parentInfo.command && (
          parentInfo.command.includes('server') ||
          parentInfo.command.includes('daemon') ||
          parentInfo.command.includes('service')
        )) {
          indicators.push(`Parent is server process: ${parentInfo.command}`);
        }
      }
    } catch {
      // Ignore errors
    }
    
    return { detected: indicators.length > 0, indicators };
  }

  /**
   * Get process tree
   */
  private async getProcessTree(): Promise<Array<{
    pid: number;
    ppid: number;
    command: string;
  }>> {
    const tree: Array<{ pid: number; ppid: number; command: string }> = [];
    
    try {
      let currentPid = process.pid;
      let depth = 0;
      
      while (currentPid > 1 && depth < 10) {
        const info = await this.getProcessInfo(currentPid);
        if (!info) break;
        
        tree.push(info);
        currentPid = info.ppid;
        depth++;
      }
    } catch {
      // Return what we have
    }
    
    return tree;
  }

  /**
   * Get process info
   */
  private async getProcessInfo(pid: number): Promise<{
    pid: number;
    ppid: number;
    command: string;
  } | null> {
    return new Promise((resolve) => {
      const ps = spawn('ps', ['-p', pid.toString(), '-o', 'pid,ppid,comm']);
      let output = '';
      
      ps.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      ps.on('close', () => {
        const lines = output.trim().split('\n');
        if (lines.length < 2) {
          resolve(null);
          return;
        }
        
        const secondLine = lines[1];
        if (!secondLine) {
          resolve(null);
          return;
        }
        
        const parts = secondLine.trim().split(/\s+/);
        if (parts.length >= 3 && parts[0] && parts[1]) {
          resolve({
            pid: parseInt(parts[0]),
            ppid: parseInt(parts[1]),
            command: parts.slice(2).join(' ')
          });
        } else {
          resolve(null);
        }
      });
      
      ps.on('error', () => resolve(null));
    });
  }

  /**
   * Generate unique agent ID based on detection
   */
  generateAgentId(detection: AIAgentDetectionResult): string {
    if (detection.detectedAgent) {
      return `${detection.detectedAgent}-${process.pid}`;
    }
    
    // Generate based on evidence
    const factors = Object.entries(detection.factors)
      .filter(([_, v]) => v)
      .map(([k]) => k.charAt(0))
      .join('');
    
    return `ai-agent-${factors}-${process.pid}`;
  }
}