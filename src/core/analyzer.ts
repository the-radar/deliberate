import * as path from 'path';
import { Logger } from '../utils/logger';

export interface AnalysisResult {
  verdict: 'ALLOW' | 'WARN_PATH' | 'DANGER' | 'BLOCK';
  message: string;
  requiresAI: boolean;
  requiresApproval?: boolean;
  aiAnalysisRequired?: boolean;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category?: string;
}

export interface AnalysisContext {
  cwd?: string;
  user?: string;
  timestamp?: number;
}

export class DeliberateAnalyzer {
  private logger = new Logger('deliberate-analyzer');
  
  // Safe commands that can always pass through
  private readonly SAFE_COMMANDS = new Set([
    'ls', 'pwd', 'echo', 'cat', 'grep', 'cd', 'which', 'ps', 
    'git', 'npm', 'node', 'python', 'pip', 'cargo', 'rustc',
    'make', 'gcc', 'clang', 'javac', 'go', 'docker', 'kubectl',
    'vim', 'nano', 'emacs', 'code', 'less', 'more', 'head', 'tail',
    'wc', 'sort', 'uniq', 'awk', 'sed', 'find', 'locate', 'whereis',
    'env', 'printenv', 'date', 'cal', 'whoami', 'hostname', 'uname',
    'df', 'du', 'free', 'top', 'htop', 'jobs', 'fg', 'bg',
    'history', 'clear', 'exit', 'logout', 'true', 'false', 'test'
  ]);
  
  // Dangerous commands that always need AI analysis
  private readonly DANGEROUS_COMMANDS = new Set([
    'rm', 'dd', 'sudo', 'chmod', 'chown', 'mkfs', 'fdisk',
    'parted', 'wipefs', 'shred', 'mv', 'cp', 'rsync',
    'curl', 'wget', 'nc', 'netcat', 'telnet', 'ssh', 'scp',
    'iptables', 'firewall-cmd', 'ufw', 'systemctl', 'service',
    'kill', 'killall', 'pkill', 'shutdown', 'reboot', 'halt',
    'mount', 'umount', 'chroot', 'su', 'passwd', 'useradd',
    'userdel', 'usermod', 'groupadd', 'groupdel', 'groupmod'
  ]);
  
  // System paths that trigger security warnings
  private readonly SYSTEM_PATHS = [
    /^\/etc\//,
    /^\/sys\//,
    /^\/proc\//,
    /^\/dev\//,
    /^\/boot\//,
    /^\/root\//,
    /^~?\/.ssh\//,
    /^~?\/.aws\//,
    /^~?\/.kube\//,
    /^~?\/.docker\//,
    /^~?\/.gnupg\//,
    /\/\.git\/config$/,
    /\/id_rsa$/,
    /\/id_ed25519$/,
    /\/credentials$/,
    /\/secrets?\//,
    /\/password/,
    /\/shadow$/,
    /\/passwd$/
  ];
  
  async analyze(
    command: string, 
    args: string[], 
    context: AnalysisContext = {}
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    
    try {
      // Extract base command name
      const baseCommand = path.basename(command);
      
      // Quick pass for safe commands
      if (this.SAFE_COMMANDS.has(baseCommand) && !this.hasSystemFileAccess(args)) {
        return {
          verdict: 'ALLOW',
          message: '✓ Safe command - proceeding',
          requiresAI: false,
          riskLevel: 'LOW',
          category: 'safe_command'
        };
      }
      
      // Check for dangerous commands
      if (this.DANGEROUS_COMMANDS.has(baseCommand)) {
        return this.analyzeDangerousCommand(baseCommand, args, context);
      }
      
      // Check for system file access in safe commands
      if (this.hasSystemFileAccess(args)) {
        return {
          verdict: 'WARN_PATH',
          message: 'System file access detected - requires approval',
          requiresAI: false,
          requiresApproval: true,
          riskLevel: 'MEDIUM',
          category: 'system_file_access'
        };
      }
      
      // Check if it's a known dangerous command by full path
      const fullPathBase = path.basename(command);
      if (this.DANGEROUS_COMMANDS.has(fullPathBase)) {
        return this.analyzeDangerousCommand(fullPathBase, args, context);
      }
      
      // Check for known aliases
      const aliases: Record<string, string> = {
        'unlink': 'rm',
        'rmdir': 'rm',
        '/bin/rm': 'rm',
        '/usr/bin/rm': 'rm'
      };
      
      const aliasedCommand = aliases[command] || aliases[fullPathBase];
      if (aliasedCommand && this.DANGEROUS_COMMANDS.has(aliasedCommand)) {
        return this.analyzeDangerousCommand(aliasedCommand, args, context);
      }
      
      // Unknown command - needs AI analysis
      return {
        verdict: 'DANGER',
        message: 'Unknown command - AI analysis required',
        requiresAI: true,
        aiAnalysisRequired: true,
        riskLevel: 'MEDIUM',
        category: 'unknown_command'
      };
      
    } finally {
      const elapsed = Date.now() - startTime;
      this.logger.debug(`Analysis completed in ${elapsed}ms`);
    }
  }
  
  private hasSystemFileAccess(args: string[]): boolean {
    for (const arg of args) {
      // Skip flags
      if (arg.startsWith('-')) continue;
      
      // Expand home directory
      const expandedPath = arg.replace(/^~/, process.env.HOME || '/home/user');
      
      // Check against system paths
      for (const pattern of this.SYSTEM_PATHS) {
        if (pattern.test(expandedPath)) {
          return true;
        }
      }
    }
    return false;
  }
  
  private analyzeDangerousCommand(
    command: string, 
    args: string[], 
    context: AnalysisContext
  ): AnalysisResult {
    // Determine risk level based on command and context
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'HIGH';
    let category = this.categorizeCommand(command);
    
    // Check for extremely dangerous patterns
    if (this.isExtremelyDangerous(command, args)) {
      riskLevel = 'CRITICAL';
    } else if (context.cwd && this.isSystemDirectory(context.cwd)) {
      riskLevel = 'HIGH';
    } else if (context.cwd && this.isUserDirectory(context.cwd)) {
      riskLevel = 'MEDIUM';
    }
    
    return {
      verdict: 'DANGER',
      message: `Dangerous command detected: ${command}`,
      requiresAI: true,
      aiAnalysisRequired: true,
      requiresApproval: true,
      riskLevel,
      category
    };
  }
  
  private isExtremelyDangerous(command: string, args: string[]): boolean {
    // Check for patterns like 'rm -rf /' or 'dd of=/dev/sda'
    if (command === 'rm' && args.includes('-rf') && 
        (args.includes('/') || args.includes('/*'))) {
      return true;
    }
    
    if (command === 'dd' && args.some(arg => 
        arg.startsWith('of=/dev/') || arg === 'of=/'
    )) {
      return true;
    }
    
    if (command === 'chmod' && args.includes('777') && 
        args.some(arg => this.isSystemPath(arg))) {
      return true;
    }
    
    return false;
  }
  
  private isSystemDirectory(dir: string): boolean {
    return dir.startsWith('/etc') || 
           dir.startsWith('/sys') || 
           dir.startsWith('/boot') ||
           dir === '/';
  }
  
  private isUserDirectory(dir: string): boolean {
    return dir.startsWith('/home/') || 
           dir.startsWith(process.env.HOME || '');
  }
  
  private isSystemPath(path: string): boolean {
    const expandedPath = path.replace(/^~/, process.env.HOME || '/home/user');
    return this.SYSTEM_PATHS.some(pattern => pattern.test(expandedPath));
  }
  
  private categorizeCommand(command: string): string {
    const categories: Record<string, string[]> = {
      'file_deletion': ['rm', 'unlink', 'rmdir', 'shred'],
      'file_modification': ['chmod', 'chown', 'mv', 'cp'],
      'disk_operations': ['dd', 'mkfs', 'fdisk', 'parted', 'wipefs'],
      'network_operations': ['curl', 'wget', 'nc', 'netcat', 'ssh', 'scp'],
      'system_control': ['systemctl', 'service', 'shutdown', 'reboot'],
      'process_control': ['kill', 'killall', 'pkill'],
      'user_management': ['useradd', 'userdel', 'passwd', 'su', 'sudo']
    };
    
    for (const [category, commands] of Object.entries(categories)) {
      if (commands.includes(command)) {
        return category;
      }
    }
    
    return 'unknown';
  }
}