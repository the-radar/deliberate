import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { Logger } from '../utils/logger';

export class BypassDetector {
  private securityChecks: Array<() => Promise<boolean>> = [];
  private logger: Logger;
  private originalEnvHash?: string;
  private attemptTimestamps: number[] = [];
  
  constructor() {
    this.logger = new Logger('bypass-detector');
    this.initializeChecks();
  }
  
  private initializeChecks(): void {
    // Check 1: TTY manipulation detection
    this.securityChecks.push(async () => {
      return this.detectTTYManipulation();
    });
    
    // Check 2: Process injection detection
    this.securityChecks.push(async () => {
      return this.detectProcessInjection();
    });
    
    // Check 3: Environment tampering
    this.securityChecks.push(async () => {
      return this.detectEnvironmentTampering();
    });
    
    // Check 4: Timing attack detection
    this.securityChecks.push(async () => {
      return this.detectTimingAttack();
    });
  }
  
  async runSecurityChecks(): Promise<void> {
    const results = await Promise.all(
      this.securityChecks.map(check => check())
    );
    
    if (results.some(result => !result)) {
      throw new Error('Security check failed - potential bypass attempt detected');
    }
  }
  
  private async detectTTYManipulation(): Promise<boolean> {
    // Check parent process chain
    const processChain = await this.getProcessChain();
    
    const suspiciousParents = [
      'script', 'expect', 'unbuffer', 'socat',
      'screen', 'tmux', 'pty', 'faketty'
    ];
    
    for (const proc of processChain) {
      if (suspiciousParents.some(s => proc.command.includes(s))) {
        this.logger.warn(`PTY wrapper detected: ${proc.command}`);
        // Additional verification required
        return await this.performEnhancedTTYCheck();
      }
    }
    
    return true;
  }
  
  private async getProcessChain(): Promise<ProcessInfo[]> {
    const chain: ProcessInfo[] = [];
    let pid = process.pid;
    
    while (pid > 1) {
      const proc = await this.getProcessInfo(pid);
      if (!proc) break;
      
      chain.push(proc);
      pid = proc.ppid;
    }
    
    return chain;
  }
  
  private async getProcessInfo(pid: number): Promise<ProcessInfo | null> {
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
        const pidStr = parts[0];
        const ppidStr = parts[1];
        if (pidStr && ppidStr) {
          resolve({
            pid: parseInt(pidStr),
            ppid: parseInt(ppidStr),
            command: parts.slice(2).join(' ')
          });
        } else {
          resolve(null);
        }
      });
    });
  }
  
  private async performEnhancedTTYCheck(): Promise<boolean> {
    // Direct kernel check for real TTY
    try {
      // Check if stdin is a real TTY
      if (!process.stdin.isTTY) {
        return false;
      }
      
      // Check if we can get TTY name
      const ttyName = process.stdout.isTTY ? (process.stdout as any)._handle?.getWindowSize ? 'terminal' : null : null;
      if (!ttyName) {
        return false;
      }
      
      // Additional platform-specific checks
      if (process.platform === 'darwin' || process.platform === 'linux') {
        // Check if parent process is a known shell
        const parentInfo = await this.getProcessInfo(process.ppid || 1);
        const knownShells = ['bash', 'zsh', 'sh', 'fish', 'tcsh', 'csh', 'ksh'];
        
        if (parentInfo && !knownShells.some(shell => parentInfo.command.includes(shell))) {
          this.logger.warn('Parent process is not a known shell');
          return false;
        }
      }
      
      return true;
    } catch {
      return false;
    }
  }
  
  private async detectProcessInjection(): Promise<boolean> {
    // Check for LD_PRELOAD and similar
    const dangerousEnvVars = [
      'LD_PRELOAD', 'LD_LIBRARY_PATH',
      'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH'
    ];
    
    for (const varName of dangerousEnvVars) {
      if (process.env[varName]) {
        this.logger.error(`Dangerous environment variable detected: ${varName}`);
        return false;
      }
    }
    
    // Check process memory for injection
    return await this.checkProcessIntegrity();
  }
  
  private async checkProcessIntegrity(): Promise<boolean> {
    // Platform-specific memory checks
    if (process.platform === 'linux') {
      try {
        const maps = await fs.readFile(`/proc/${process.pid}/maps`, 'utf-8');
        
        // Look for suspicious memory regions
        const suspiciousPatterns = [
          /\[heap\].*rwx/,  // Executable heap
          /\[stack\].*rwx/, // Executable stack
          /deleted/i        // Deleted libraries still mapped
        ];
        
        for (const pattern of suspiciousPatterns) {
          if (pattern.test(maps)) {
            this.logger.error('Suspicious memory mapping detected');
            return false;
          }
        }
      } catch {
        // Can't read maps, assume safe but log
        this.logger.debug('Unable to read process memory maps');
      }
    }
    
    return true;
  }
  
  private async detectEnvironmentTampering(): Promise<boolean> {
    // Create integrity hash of critical environment
    const criticalEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      SHELL: process.env.SHELL
    };
    
    const envHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(criticalEnv))
      .digest('hex');
    
    // Store and verify on each check
    if (!this.originalEnvHash) {
      this.originalEnvHash = envHash;
      return true;
    }
    
    if (envHash !== this.originalEnvHash) {
      this.logger.error('Environment tampering detected');
      return false;
    }
    
    return true;
  }
  
  private async detectTimingAttack(): Promise<boolean> {
    // Monitor for rapid repeated attempts
    const now = Date.now();
    this.attemptTimestamps.push(now);
    
    // Keep only last minute
    this.attemptTimestamps = this.attemptTimestamps.filter(
      t => now - t < 60000
    );
    
    // More than 10 attempts per minute is suspicious
    if (this.attemptTimestamps.length > 10) {
      this.logger.warn('Rapid command attempts detected');
      return false;
    }
    
    return true;
  }
  
  /**
   * Check if running in a container
   */
  async isContainerized(): Promise<boolean> {
    // Check for Docker
    try {
      await fs.access('/.dockerenv');
      return true;
    } catch {
      // Not Docker
    }
    
    // Check for other container runtimes
    try {
      const cgroup = await fs.readFile('/proc/self/cgroup', 'utf-8');
      if (cgroup.includes('docker') || cgroup.includes('kubepods')) {
        return true;
      }
    } catch {
      // Can't read cgroup
    }
    
    return false;
  }
  
  /**
   * Get security context
   */
  async getSecurityContext(): Promise<SecurityContext> {
    const processChain = await this.getProcessChain();
    const isContainer = await this.isContainerized();
    
    return {
      pid: process.pid,
      ppid: process.ppid || 0,
      uid: process.getuid?.() || -1,
      gid: process.getgid?.() || -1,
      tty: process.stdin.isTTY,
      processChain: processChain.map(p => p.command),
      environment: {
        suspicious: this.getSuspiciousEnvVars(),
        modified: this.originalEnvHash ? this.hasEnvChanged() : false
      },
      containerized: isContainer,
      platform: process.platform,
      timestamp: Date.now()
    };
  }
  
  private getSuspiciousEnvVars(): string[] {
    const suspicious: string[] = [];
    const checkVars = [
      'LD_PRELOAD', 'LD_LIBRARY_PATH',
      'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
      'LD_AUDIT', 'LD_DEBUG'
    ];
    
    for (const varName of checkVars) {
      if (process.env[varName]) {
        suspicious.push(varName);
      }
    }
    
    return suspicious;
  }
  
  private hasEnvChanged(): boolean {
    const criticalEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      SHELL: process.env.SHELL
    };
    
    const currentHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(criticalEnv))
      .digest('hex');
    
    return currentHash !== this.originalEnvHash;
  }
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  command: string;
}

export interface SecurityContext {
  pid: number;
  ppid: number;
  uid: number;
  gid: number;
  tty: boolean;
  processChain: string[];
  environment: {
    suspicious: string[];
    modified: boolean;
  };
  containerized: boolean;
  platform: string;
  timestamp: number;
}