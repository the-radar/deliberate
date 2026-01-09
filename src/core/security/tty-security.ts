import * as fs from 'fs';
import * as tty from 'tty';
import { promisify } from 'util';

const openAsync = promisify(fs.open);
const closeAsync = promisify(fs.close);

export interface TTYCheckResult {
  isRealTTY: boolean;
  isPiped: boolean;
  isRedirected: boolean;
  isBackground?: boolean;
  isSSH?: boolean;
  sshClient?: string;
  isCI?: boolean;
  ciPlatform?: string;
  inContainer?: boolean;
  containerType?: string;
  isInteractive?: boolean;
  reason?: string;
}

export interface ApprovalOptions {
  riskLevel?: 'SAFE' | 'CAUTION' | 'HIGH' | 'CRITICAL';
  timeout?: number;
  requireFullWord?: boolean;
}

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
  timedOut?: boolean;
  suspicious?: boolean;
  responseTime?: number;
  securityScore?: number;
  validInput?: boolean;
}

export class TTYSecurity {
  private ttyFd: number | null = null;
  private ttyReadStream: tty.ReadStream | null = null;
  private ttyWriteStream: tty.WriteStream | null = null;

  /**
   * Check if we have a real TTY
   */
  async checkTTY(): Promise<TTYCheckResult> {
    const result: TTYCheckResult = {
      isRealTTY: false,
      isPiped: false,
      isRedirected: false,
    };

    // Check if stdin is a TTY
    if (process.stdin.isTTY) {
      result.isRealTTY = true;
    } else {
      // Check if input is piped or redirected
      const { mode } = fs.fstatSync(0); // stdin file descriptor
      
      if ((mode & fs.constants.S_IFIFO) === fs.constants.S_IFIFO) {
        result.isPiped = true;
      } else if ((mode & fs.constants.S_IFREG) === fs.constants.S_IFREG) {
        result.isRedirected = true;
      }
    }

    // Check for background process
    if (process.env.DELIBERATE_BACKGROUND === '1') {
      result.isBackground = true;
      result.isRealTTY = false;
    }

    // Check for SSH session
    if (process.env.SSH_TTY || process.env.SSH_CONNECTION) {
      result.isSSH = true;
      result.sshClient = process.env.SSH_CLIENT?.split(' ')[0];
    }

    // Check for CI environment
    const ciVars = [
      'CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS',
      'GITLAB_CI', 'JENKINS_HOME', 'CIRCLECI', 'TRAVIS',
      'BUILDKITE', 'DRONE', 'TEAMCITY_VERSION',
    ];
    
    for (const ciVar of ciVars) {
      if (process.env[ciVar]) {
        result.isCI = true;
        result.ciPlatform = ciVar;
        result.isRealTTY = false;
        break;
      }
    }

    // Check for container environment
    if (fs.existsSync('/.dockerenv')) {
      result.inContainer = true;
      result.containerType = 'docker';
    } else if (process.env.container === 'podman') {
      result.inContainer = true;
      result.containerType = 'podman';
    }

    // Check for non-interactive mode
    if (process.env.DEBIAN_FRONTEND === 'noninteractive') {
      result.isInteractive = false;
      result.reason = 'Non-interactive mode detected';
    }

    return result;
  }

  /**
   * Check if we're being run through automation
   */
  async detectBypass(): Promise<{
    isAutomated: boolean;
    tool?: string;
    confidence: number;
  }> {
    // Check process tree for automation tools
    const processTree = await this.getProcessTree();
    
    const automationTools = [
      'expect', 'autoexpect', 'empty', 'pty',
      'script', 'xdotool', 'xte', 'sikuli',
      'python', 'perl', 'ruby', // Common for expect-like scripts
    ];
    
    for (const proc of processTree) {
      for (const tool of automationTools) {
        if (proc.name.includes(tool)) {
          // Special handling for legitimate uses
          if (tool === 'script' && proc.args?.includes('typescript')) {
            continue; // Recording session, not automating
          }
          
          return {
            isAutomated: true,
            tool,
            confidence: 0.9,
          };
        }
      }
    }

    return {
      isAutomated: false,
      confidence: 0.1,
    };
  }

  /**
   * Get secure approval from user
   */
  async getApproval(
    command: string,
    args: string[],
    classification: any
  ): Promise<ApprovalResult> {
    const options: ApprovalOptions = {
      riskLevel: classification.riskLevel || 'CAUTION',
      timeout: 30000, // 30 seconds default
      requireFullWord: classification.riskLevel === 'CRITICAL',
    };

    try {
      // Open direct TTY connection
      await this.openTTY();

      // Clear any buffered input
      await this.flushInput();

      // Display warning based on risk level
      await this.displayWarning(command, args, options);

      // Get user response with timing
      const startTime = Date.now();
      const response = await this.securePrompt(
        this.getPromptMessage(options),
        options.timeout!
      );
      const responseTime = Date.now() - startTime;

      // Validate response
      const validation = this.validateResponse(
        response,
        responseTime,
        options
      );

      return {
        approved: validation.approved,
        reason: validation.reason,
        responseTime,
        suspicious: validation.suspicious,
        validInput: validation.valid,
      };

    } catch (error) {
      return {
        approved: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      await this.closeTTY();
    }
  }

  /**
   * Open direct TTY connection
   */
  private async openTTY(): Promise<void> {
    try {
      // Open /dev/tty for reading and writing
      this.ttyFd = await openAsync('/dev/tty', fs.constants.O_RDWR);
      
      // Create TTY streams
      this.ttyReadStream = new tty.ReadStream(this.ttyFd);
      this.ttyWriteStream = new tty.WriteStream(this.ttyFd);
      
      // Set raw mode for input
      if (this.ttyReadStream.setRawMode) {
        this.ttyReadStream.setRawMode(true);
      }
    } catch (error) {
      throw new Error('No TTY available for secure input');
    }
  }

  /**
   * Close TTY connection
   */
  private async closeTTY(): Promise<void> {
    if (this.ttyReadStream) {
      this.ttyReadStream.destroy();
      this.ttyReadStream = null;
    }
    
    if (this.ttyWriteStream) {
      this.ttyWriteStream.destroy();
      this.ttyWriteStream = null;
    }
    
    if (this.ttyFd !== null) {
      await closeAsync(this.ttyFd);
      this.ttyFd = null;
    }
  }

  /**
   * Flush any buffered input
   */
  private async flushInput(): Promise<void> {
    if (!this.ttyReadStream) return;
    
    // Set non-blocking mode temporarily
    this.ttyReadStream.setRawMode!(false);
    
    // Read and discard any pending input
    while (this.ttyReadStream.readable && this.ttyReadStream.read() !== null) {
      // Keep reading until buffer is empty
    }
    
    // Restore raw mode
    this.ttyReadStream.setRawMode!(true);
  }

  /**
   * Display risk warning
   */
  private async displayWarning(
    command: string,
    args: string[],
    options: ApprovalOptions
  ): Promise<void> {
    if (!this.ttyWriteStream) return;

    const write = (text: string) => {
      this.ttyWriteStream!.write(text);
    };

    write('\n');
    write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    switch (options.riskLevel) {
      case 'CRITICAL':
        write('⚠️  CRITICAL RISK - This action cannot be undone! ⚠️\n');
        break;
      case 'HIGH':
        write('⚠️  HIGH RISK - This action may cause serious damage\n');
        break;
      case 'CAUTION':
        write('⚠  CAUTION - This action requires careful consideration\n');
        break;
      default:
        write('ℹ  Command requires approval\n');
    }
    
    write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
    write(`Command: ${command} ${args.join(' ')}\n`);
    write(`Working directory: ${process.cwd()}\n`);
    
    if (process.env.SUDO_USER) {
      write(`Running as: root (via sudo from ${process.env.SUDO_USER})\n`);
    } else {
      write(`Running as: ${process.env.USER || 'unknown'}\n`);
    }
    
    write('\n');
  }

  /**
   * Get secure input from user
   */
  private async securePrompt(prompt: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.ttyReadStream || !this.ttyWriteStream) {
        reject(new Error('TTY not available'));
        return;
      }

      this.ttyWriteStream.write(prompt);

      let input = '';
      let timer: NodeJS.Timeout;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.ttyReadStream!.removeAllListeners('data');
      };

      // Set timeout
      timer = setTimeout(() => {
        cleanup();
        this.ttyWriteStream!.write('\nTimeout - approval denied\n');
        reject(new Error('Approval timeout'));
      }, timeout);

      // Handle input
      this.ttyReadStream.on('data', (chunk: Buffer) => {
        const char = chunk.toString();

        // Handle special characters
        if (char === '\r' || char === '\n') {
          cleanup();
          this.ttyWriteStream!.write('\n');
          resolve(input);
        } else if (char === '\x03') { // Ctrl+C
          cleanup();
          this.ttyWriteStream!.write('^C\n');
          reject(new Error('User cancelled'));
        } else if (char === '\x7f' || char === '\b') { // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            this.ttyWriteStream!.write('\b \b');
          }
        } else {
          input += char;
          this.ttyWriteStream!.write('*'); // Hide input
        }
      });
    });
  }

  /**
   * Get prompt message based on risk level
   */
  private getPromptMessage(options: ApprovalOptions): string {
    if (options.riskLevel === 'CRITICAL') {
      return 'Type "yes" to confirm or press Enter to cancel: ';
    }
    return 'Approve? [y/N]: ';
  }

  /**
   * Validate user response
   */
  private validateResponse(
    response: string,
    responseTime: number,
    options: ApprovalOptions
  ): {
    approved: boolean;
    reason?: string;
    suspicious?: boolean;
    valid: boolean;
  } {
    // Check for suspiciously fast response
    if (responseTime < 100) {
      return {
        approved: false,
        reason: 'Response too fast (possible automation)',
        suspicious: true,
        valid: false,
      };
    }

    // Normalize response
    const normalized = response.trim().toLowerCase();

    // Critical commands require full word
    if (options.requireFullWord) {
      const validResponses = ['yes', 'confirm'];
      return {
        approved: validResponses.includes(normalized),
        valid: true,
      };
    }

    // Normal approval
    const approvals = ['y', 'yes', 'ok', 'confirm'];
    return {
      approved: approvals.includes(normalized),
      valid: true,
    };
  }

  /**
   * Get process tree for bypass detection
   */
  private async getProcessTree(): Promise<Array<{
    pid: number;
    ppid: number;
    name: string;
    args?: string;
  }>> {
    // This is a simplified version - real implementation would
    // parse /proc or use platform-specific APIs
    const tree = [];
    
    try {
      // Get current process info
      tree.push({
        pid: process.pid,
        ppid: process.ppid,
        name: process.title,
      });
      
      // In real implementation, walk up the process tree
      // using /proc/[pid]/stat or platform APIs
      
    } catch {
      // Fallback if process info unavailable
    }
    
    return tree;
  }

  /**
   * Get approval with AI-enhanced analysis
   */
  async getApprovalWithAnalysis(
    command: string,
    args: string[],
    analysis: {
      verdict: 'ALLOW' | 'WARN' | 'BLOCK';
      explanation: string;
      risks: string[];
      alternatives?: string[];
      confidence: number;
    }
  ): Promise<ApprovalResult> {
    const riskLevel = this.mapVerdictToRisk(analysis.verdict);
    const options: ApprovalOptions = {
      riskLevel,
      timeout: 30000,
      requireFullWord: riskLevel === 'CRITICAL' || analysis.risks.length > 3,
    };

    try {
      // Open direct TTY connection
      await this.openTTY();

      // Clear any buffered input
      await this.flushInput();

      // Display AI-enhanced warning
      await this.displayAIWarning(command, args, analysis, options);

      // Get user response with timing
      const startTime = Date.now();
      const response = await this.securePrompt(
        this.getPromptMessage(options),
        options.timeout!
      );
      const responseTime = Date.now() - startTime;

      // Validate response
      const validation = this.validateResponse(
        response,
        responseTime,
        options
      );

      return {
        approved: validation.approved,
        reason: validation.reason,
        responseTime,
        suspicious: validation.suspicious,
        validInput: validation.valid,
        securityScore: analysis.confidence,
      };

    } catch (error) {
      return {
        approved: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      await this.closeTTY();
    }
  }

  /**
   * Map AI verdict to risk level
   */
  private mapVerdictToRisk(verdict: 'ALLOW' | 'WARN' | 'BLOCK'): 'SAFE' | 'CAUTION' | 'HIGH' | 'CRITICAL' {
    switch (verdict) {
      case 'ALLOW':
        return 'SAFE';
      case 'WARN':
        return 'CAUTION';
      case 'BLOCK':
        return 'CRITICAL';
      default:
        return 'CAUTION';
    }
  }

  /**
   * Display AI-enhanced warning
   */
  private async displayAIWarning(
    command: string,
    args: string[],
    analysis: any,
    options: ApprovalOptions
  ): Promise<void> {
    if (!this.ttyWriteStream) return;

    const write = (text: string) => {
      this.ttyWriteStream!.write(text);
    };

    write('\n');
    write('╔════════════════════════════════════════════════════════╗\n');
    write('║           🤖 AI Security Analysis Complete             ║\n');
    write('╚════════════════════════════════════════════════════════╝\n\n');
    
    // Display risk level with appropriate styling
    const riskEmoji = {
      'CRITICAL': '🚫',
      'HIGH': '⚠️ ',
      'CAUTION': '⚡',
      'SAFE': '✅'
    }[options.riskLevel || 'CAUTION'];
    
    write(`${riskEmoji} Risk Level: ${options.riskLevel}\n`);
    write(`📊 Confidence: ${Math.round(analysis.confidence * 100)}%\n\n`);
    
    write(`Command: ${command} ${args.join(' ')}\n`);
    write(`Working directory: ${process.cwd()}\n\n`);
    
    // AI Explanation
    write('🔍 Analysis:\n');
    write(`   ${analysis.explanation}\n\n`);
    
    // Risks identified
    if (analysis.risks && analysis.risks.length > 0) {
      write('⚠️  Identified Risks:\n');
      analysis.risks.forEach((risk: string, i: number) => {
        write(`   ${i + 1}. ${risk}\n`);
      });
      write('\n');
    }
    
    // Safer alternatives
    if (analysis.alternatives && analysis.alternatives.length > 0) {
      write('💡 Safer Alternatives:\n');
      analysis.alternatives.forEach((alt: string, i: number) => {
        write(`   ${i + 1}. ${alt}\n`);
      });
      write('\n');
    }
    
    write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
  }
}