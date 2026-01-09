import * as fs from 'fs';
import { InterceptionContext } from '../interception/interceptor';

export interface BypassDetectionResult {
  detected: boolean;
  method?: string;
  confidence: number;
  details?: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface SecurityCheck {
  name: string;
  passed: boolean;
  score: number;
  critical?: boolean;
  details?: string;
}

export interface CompositeSecurityResult {
  checks: Record<string, SecurityCheck>;
  overallScore: number;
  passed: boolean;
  failedCritical?: string[];
  decision: 'ALLOW' | 'BLOCK';
}

export class BypassPrevention {
  private suspiciousEnvVars = [
    'DELIBERATE_AUTO_APPROVE',
    'DELIBERATE_BYPASS',
    'DELIBERATE_NO_TTY',
    '_DELIBERATE_TEST_MODE',
    'DELIBERATE_SKIP_CHECKS',
  ];

  private automationTools = [
    'expect',
    'autoexpect',
    'empty',
    'pty',
    'xdotool',
    'xte',
    'sikuli',
    'python-pty',
    'node-pty',
  ];

  /**
   * Main bypass detection entry point
   */
  async detectBypass(_context: InterceptionContext): Promise<BypassDetectionResult> {
    // Run multiple detection layers
    const checks = await Promise.all([
      this.checkPipeBypass(),
      this.checkProcessTree(),
      this.checkEnvironment(),
      this.checkFileDescriptors(),
      this.checkTiming(),
    ]);

    // Find the most severe detection
    let mostSevere: BypassDetectionResult = {
      detected: false,
      confidence: 0,
    };

    for (const check of checks) {
      if (check.detected && check.confidence > mostSevere.confidence) {
        mostSevere = check;
      }
    }

    return mostSevere;
  }

  /**
   * Check for pipe-based bypass attempts
   */
  private async checkPipeBypass(): Promise<BypassDetectionResult> {
    try {
      const stdinStat = fs.fstatSync(0);
      
      // Check if stdin is a pipe
      if ((stdinStat.mode & fs.constants.S_IFIFO) === fs.constants.S_IFIFO) {
        return {
          detected: true,
          method: 'pipe',
          confidence: 0.95,
          details: 'Input is piped (not from TTY)',
          severity: 'HIGH',
        };
      }

      // Check if stdin is redirected from file
      if ((stdinStat.mode & fs.constants.S_IFREG) === fs.constants.S_IFREG) {
        return {
          detected: true,
          method: 'file_redirection',
          confidence: 0.95,
          details: 'Input is redirected from file',
          severity: 'HIGH',
        };
      }

      // Check for process substitution
      const fdPath = `/proc/${process.pid}/fd/0`;
      if (fs.existsSync(fdPath)) {
        const link = fs.readlinkSync(fdPath);
        if (link.includes('pipe:') || link.includes('/dev/fd/')) {
          return {
            detected: true,
            method: 'process_substitution',
            confidence: 0.9,
            details: 'Process substitution detected',
            severity: 'HIGH',
          };
        }
      }
    } catch {
      // Unable to check, assume safe
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * Check process tree for automation tools
   */
  private async checkProcessTree(): Promise<BypassDetectionResult> {
    try {
      const processTree = await this.getProcessTree();
      
      for (const proc of processTree) {
        // Check for automation tools
        for (const tool of this.automationTools) {
          if (proc.cmdline.toLowerCase().includes(tool)) {
            return {
              detected: true,
              method: 'automation_tool',
              confidence: 0.9,
              details: `Automation tool detected: ${tool}`,
              severity: 'CRITICAL',
            };
          }
        }

        // Check for suspicious interpreters
        if (proc.cmdline.includes('python -c') || 
            proc.cmdline.includes('perl -e') ||
            proc.cmdline.includes('ruby -e')) {
          return {
            detected: true,
            method: 'inline_script',
            confidence: 0.7,
            details: 'Inline script execution detected',
            severity: 'MEDIUM',
          };
        }
      }

      // Check for PTY manipulation
      const ptyCheck = await this.checkPTYManipulation();
      if (ptyCheck.detected) {
        return ptyCheck;
      }
    } catch {
      // Process tree check failed
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * Check environment for suspicious variables
   */
  private async checkEnvironment(): Promise<BypassDetectionResult> {
    const suspicious: string[] = [];
    
    // Check for suspicious deliberate-specific vars
    for (const envVar of this.suspiciousEnvVars) {
      if (process.env[envVar]) {
        suspicious.push(envVar);
      }
    }

    if (suspicious.length > 0) {
      return {
        detected: true,
        method: 'environment_manipulation',
        confidence: 0.99,
        details: `Suspicious environment variables: ${suspicious.join(', ')}`,
        severity: 'CRITICAL',
      };
    }

    // Check for LD_PRELOAD injection
    if (process.env.LD_PRELOAD || process.env.DYLD_INSERT_LIBRARIES) {
      return {
        detected: true,
        method: 'library_injection',
        confidence: 0.95,
        details: 'Library injection detected (LD_PRELOAD/DYLD_INSERT_LIBRARIES)',
        severity: 'CRITICAL',
      };
    }

    // Check for script/typescript session
    if (process.env.SCRIPT) {
      return {
        detected: true,
        method: 'script_session',
        confidence: 0.6,
        details: 'Running inside script/typescript session',
        severity: 'LOW',
      };
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * Check file descriptors for anomalies
   */
  private async checkFileDescriptors(): Promise<BypassDetectionResult> {
    try {
      // Check if stdin/stdout/stderr are properly connected
      const fds = [
        { fd: 0, name: 'stdin' },
        { fd: 1, name: 'stdout' },
        { fd: 2, name: 'stderr' },
      ];

      for (const { fd } of fds) {
        const fdPath = `/proc/${process.pid}/fd/${fd}`;
        
        if (fs.existsSync(fdPath)) {
          const link = fs.readlinkSync(fdPath);
          
          // Check for suspicious redirections
          if (link === '/dev/null' && fd === 0) {
            return {
              detected: true,
              method: 'null_input',
              confidence: 0.9,
              details: 'Input redirected from /dev/null',
              severity: 'HIGH',
            };
          }

          // Check for PTY manipulation
          if (link.includes('ptmx') || link.includes('pts/ptmx')) {
            return {
              detected: true,
              method: 'pty_manipulation',
              confidence: 0.8,
              details: 'PTY master detected',
              severity: 'MEDIUM',
            };
          }
        }
      }
    } catch {
      // FD check failed
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * Check timing anomalies
   */
  private async checkTiming(): Promise<BypassDetectionResult> {
    // Check process start time vs current time
    const uptime = process.uptime();
    
    // If process just started (< 100ms), it might be automated
    if (uptime < 0.1) {
      return {
        detected: true,
        method: 'rapid_execution',
        confidence: 0.5,
        details: 'Process executed too quickly',
        severity: 'LOW',
      };
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * Analyze execution context for anomalies
   */
  async analyzeExecutionContext(_context: InterceptionContext): Promise<{
    automationDetected: boolean;
    tool?: string;
    inScript?: boolean;
    scriptType?: string;
    recording?: boolean;
    recorder?: string;
  }> {
    const result: any = {
      automationDetected: false,
    };

    // Check for script/typescript
    if (process.env.SCRIPT) {
      result.inScript = true;
      result.scriptType = 'script';
    }

    // Check for terminal recorders
    const recorderVars = {
      ASCIINEMA_REC: 'asciinema',
      TERMREC: 'termrec',
      TTY_RECORD: 'ttyrec',
    };

    for (const [env, recorder] of Object.entries(recorderVars)) {
      if (process.env[env]) {
        result.recording = true;
        result.recorder = recorder;
        break;
      }
    }

    // Check process tree for automation
    const tree = await this.getProcessTree();
    for (const proc of tree) {
      for (const tool of this.automationTools) {
        if (proc.cmdline.includes(tool)) {
          result.automationDetected = true;
          result.tool = tool;
          break;
        }
      }
    }

    return result;
  }

  /**
   * Validate approval path integrity
   */
  async validateApprovalPath(): Promise<{
    validTTY: boolean;
    path?: string;
  }> {
    try {
      const stdinPath = `/proc/${process.pid}/fd/0`;
      
      if (fs.existsSync(stdinPath)) {
        const link = fs.readlinkSync(stdinPath);
        
        return {
          validTTY: link.includes('/dev/tty') || link.includes('/dev/pts/'),
          path: link,
        };
      }
    } catch {
      // Fallback check
    }

    return {
      validTTY: process.stdin.isTTY || false,
    };
  }

  /**
   * Scan environment for threats
   */
  async scanEnvironment(): Promise<{
    suspicious: boolean;
    variables?: string[];
    threats?: string[];
  }> {
    const suspicious: string[] = [];
    const threats: string[] = [];

    // Check for suspicious variables
    for (const envVar of this.suspiciousEnvVars) {
      if (process.env[envVar]) {
        suspicious.push(envVar);
      }
    }

    // Check for injection attempts
    if (process.env.LD_PRELOAD) {
      threats.push('LD_PRELOAD injection');
    }
    
    if (process.env.DYLD_INSERT_LIBRARIES) {
      threats.push('DYLD_INSERT_LIBRARIES injection');
    }

    return {
      suspicious: suspicious.length > 0 || threats.length > 0,
      variables: suspicious.length > 0 ? suspicious : undefined,
      threats: threats.length > 0 ? threats : undefined,
    };
  }

  /**
   * Check timing anomaly
   */
  async checkTimingAnomaly(responseTime: number, context?: {
    isSSH?: boolean;
    estimatedLatency?: number;
  }): Promise<{
    suspicious: boolean;
    confidence: number;
    reason?: string;
    adjustedForLatency?: boolean;
  }> {
    let adjustedTime = responseTime;
    
    // Adjust for network latency in SSH sessions
    if (context?.isSSH && context.estimatedLatency) {
      adjustedTime = responseTime - context.estimatedLatency;
      
      if (adjustedTime < 200) {
        return {
          suspicious: false,
          confidence: 0.3,
          adjustedForLatency: true,
        };
      }
    }

    // Check for inhuman response times
    if (adjustedTime < 50) {
      return {
        suspicious: true,
        confidence: 0.99,
        reason: 'Response faster than human capability',
      };
    }

    if (adjustedTime < 100) {
      return {
        suspicious: true,
        confidence: 0.8,
        reason: 'Response suspiciously fast',
      };
    }

    return {
      suspicious: false,
      confidence: 0.1,
    };
  }

  /**
   * Analyze keystroke pattern
   */
  async analyzeKeystrokePattern(timings: number[]): Promise<{
    suspicious: boolean;
    reason?: string;
  }> {
    if (timings.length < 2) {
      return { suspicious: false };
    }

    // Calculate variance
    const mean = timings.reduce((a, b) => a + b) / timings.length;
    const variance = timings.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / timings.length;
    const stdDev = Math.sqrt(variance);

    // Very consistent timing suggests automation
    if (stdDev < 5 && mean < 50) {
      return {
        suspicious: true,
        reason: 'Consistent inhuman typing speed',
      };
    }

    // All keystrokes exactly the same
    if (timings.every(t => t === timings[0])) {
      return {
        suspicious: true,
        reason: 'Identical keystroke timings',
      };
    }

    return { suspicious: false };
  }

  /**
   * Check for PTY manipulation
   */
  private async checkPTYManipulation(): Promise<BypassDetectionResult> {
    try {
      // Check if we're connected through a PTY master/slave pair
      const ttyName = process.stdin.isTTY ? (process.stdin as any).constructor.name : '';
      
      if (ttyName && ttyName.includes('master')) {
        return {
          detected: true,
          method: 'pty_manipulation',
          confidence: 0.8,
          details: 'PTY master detected',
          severity: 'MEDIUM',
        };
      }
    } catch {
      // PTY check failed
    }

    return { detected: false, confidence: 0 };
  }

  /**
   * Get process tree (simplified)
   */
  private async getProcessTree(): Promise<Array<{
    pid: number;
    ppid: number;
    cmdline: string;
  }>> {
    const tree: Array<{ pid: number; ppid: number; cmdline: string }> = [];
    
    try {
      // Read current process info
      if (fs.existsSync(`/proc/${process.pid}/cmdline`)) {
        const cmdline = fs.readFileSync(`/proc/${process.pid}/cmdline`, 'utf-8')
          .replace(/\0/g, ' ').trim();
        
        tree.push({
          pid: process.pid,
          ppid: process.ppid,
          cmdline,
        });
      }

      // Walk up process tree (simplified - real implementation would be recursive)
      let currentPpid = process.ppid;
      let depth = 0;
      
      while (currentPpid > 1 && depth < 10) {
        if (fs.existsSync(`/proc/${currentPpid}/cmdline`)) {
          const cmdline = fs.readFileSync(`/proc/${currentPpid}/cmdline`, 'utf-8')
            .replace(/\0/g, ' ').trim();
          
          // Get parent's parent
          let nextPpid = 0;
          if (fs.existsSync(`/proc/${currentPpid}/stat`)) {
            const stat = fs.readFileSync(`/proc/${currentPpid}/stat`, 'utf-8');
            const match = stat.match(/\) ([A-Z]) (\d+)/);
            if (match && match[2]) {
              nextPpid = parseInt(match[2], 10);
            }
          }
          
          tree.push({
            pid: currentPpid,
            ppid: nextPpid,
            cmdline,
          });
          
          currentPpid = nextPpid;
        } else {
          break;
        }
        
        depth++;
      }
    } catch {
      // Process tree unavailable
    }
    
    return tree;
  }

  /**
   * Log bypass attempt for forensics
   */
  async logBypassAttempt(attempt: {
    timestamp: number;
    method: string;
    command: string;
    processTree: string[];
    environment: any;
    decision: string;
  }): Promise<void> {
    // In production, this would write to a secure log
    const logEntry = {
      ...attempt,
      pid: process.pid,
      user: process.env.USER,
      tty: process.stdin.isTTY,
    };
    
    console.error('[Deliberate Security]', JSON.stringify(logEntry));
  }

  /**
   * Capture forensic data
   */
  async captureForensicData(): Promise<any> {
    return {
      timestamp: Date.now(),
      process: {
        pid: process.pid,
        ppid: process.ppid,
        uid: process.getuid?.() || -1,
        gid: process.getgid?.() || -1,
        uptime: process.uptime(),
      },
      terminal: {
        tty: process.stdin.isTTY ? 'yes' : 'no',
        size: process.stdout.isTTY ? {
          rows: process.stdout.rows,
          columns: process.stdout.columns,
        } : null,
      },
      environment: Object.keys(process.env).filter(key => 
        !key.includes('SECRET') && !key.includes('KEY') && !key.includes('PASSWORD')
      ).reduce((acc, key) => {
        acc[key] = process.env[key];
        return acc;
      }, {} as any),
      fileDescriptors: await this.getFileDescriptors(),
    };
  }

  /**
   * Get open file descriptors
   */
  private async getFileDescriptors(): Promise<any[]> {
    const fds = [];
    
    try {
      const fdDir = `/proc/${process.pid}/fd`;
      if (fs.existsSync(fdDir)) {
        const files = fs.readdirSync(fdDir);
        
        for (const fd of files) {
          try {
            const link = fs.readlinkSync(`${fdDir}/${fd}`);
            fds.push({ fd: parseInt(fd, 10), target: link });
          } catch {
            // Skip unreadable FDs
          }
        }
      }
    } catch {
      // FD listing unavailable
    }
    
    return fds;
  }
}