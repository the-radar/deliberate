import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils/logger';

export interface TrainingExample {
  command: string;
  args: string[];
  context: {
    cwd: string;
    user: string;
    platform: string;
    isSudo: boolean;
  };
  classification: {
    verdict: 'ALLOW' | 'WARN' | 'BLOCK';
    risks: string[];
    explanation: string;
    alternatives?: string[];
  };
  timestamp: string;
}

export interface TrainingDataset {
  version: string;
  generated: string;
  examples: TrainingExample[];
  statistics: {
    total: number;
    byVerdict: Record<string, number>;
    byPlatform: Record<string, number>;
    withSudo: number;
  };
}

export class TrainingDataGenerator {
  private logger: Logger;
  private dataDir: string;
  
  constructor(dataDir?: string) {
    this.logger = new Logger('training-data-generator');
    this.dataDir = dataDir || path.join(process.env.HOME || '', '.deliberate', 'training-data');
  }
  
  /**
   * Generate synthetic training examples
   */
  async generateSyntheticExamples(): Promise<TrainingExample[]> {
    const examples: TrainingExample[] = [];
    
    // Safe commands
    const safeCommands = [
      { cmd: 'ls', args: ['-la'] },
      { cmd: 'pwd', args: [] },
      { cmd: 'echo', args: ['Hello, World!'] },
      { cmd: 'date', args: [] },
      { cmd: 'whoami', args: [] },
      { cmd: 'git', args: ['status'] },
      { cmd: 'npm', args: ['list'] },
      { cmd: 'cat', args: ['README.md'] },
    ];
    
    // Moderate risk commands
    const moderateCommands = [
      { cmd: 'git', args: ['push', 'origin', 'main'] },
      { cmd: 'npm', args: ['install', 'express'] },
      { cmd: 'pip', args: ['install', 'requests'] },
      { cmd: 'docker', args: ['run', 'nginx'] },
      { cmd: 'curl', args: ['https://api.example.com'] },
      { cmd: 'wget', args: ['https://example.com/file.zip'] },
      { cmd: 'ssh', args: ['user@host.com'] },
      { cmd: 'scp', args: ['file.txt', 'user@host:~/'] },
    ];
    
    // Dangerous commands
    const dangerousCommands = [
      { cmd: 'rm', args: ['-rf', '/'] },
      { cmd: 'dd', args: ['if=/dev/zero', 'of=/dev/sda'] },
      { cmd: 'chmod', args: ['-R', '777', '/'] },
      { cmd: 'chown', args: ['-R', 'root:root', '/home'] },
      { cmd: 'mkfs.ext4', args: ['/dev/sda1'] },
      { cmd: 'iptables', args: ['-F'] },
      { cmd: 'systemctl', args: ['stop', 'sshd'] },
      { cmd: 'kill', args: ['-9', '-1'] },
    ];
    
    // Generate examples for each category
    for (const { cmd, args } of safeCommands) {
      examples.push(this.createExample(cmd, args, 'ALLOW', 
        'Command is safe for normal operation',
        []
      ));
    }
    
    for (const { cmd, args } of moderateCommands) {
      examples.push(this.createExample(cmd, args, 'WARN',
        'Command may have side effects or security implications',
        this.getModerateRisks(cmd, args)
      ));
    }
    
    for (const { cmd, args } of dangerousCommands) {
      examples.push(this.createExample(cmd, args, 'BLOCK',
        'Command is extremely dangerous and can cause system damage',
        this.getDangerousRisks(cmd, args),
        this.getAlternatives(cmd, args)
      ));
    }
    
    return examples;
  }
  
  /**
   * Create a training example
   */
  private createExample(
    command: string,
    args: string[],
    verdict: 'ALLOW' | 'WARN' | 'BLOCK',
    explanation: string,
    risks: string[],
    alternatives?: string[]
  ): TrainingExample {
    return {
      command,
      args,
      context: {
        cwd: '/home/user/projects',
        user: 'user',
        platform: 'linux',
        isSudo: false
      },
      classification: {
        verdict,
        explanation,
        risks,
        alternatives
      },
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Get risks for moderate commands
   */
  private getModerateRisks(command: string, args: string[]): string[] {
    const risks: string[] = [];
    
    switch (command) {
      case 'git':
        if (args.includes('push')) {
          risks.push('Pushes code to remote repository');
          risks.push('May expose sensitive information');
        }
        break;
        
      case 'npm':
      case 'pip':
        if (args.includes('install')) {
          risks.push('Downloads and executes third-party code');
          risks.push('May introduce security vulnerabilities');
        }
        break;
        
      case 'docker':
        risks.push('Runs containerized applications');
        risks.push('May expose ports or consume resources');
        break;
        
      case 'curl':
      case 'wget':
        risks.push('Downloads content from the internet');
        risks.push('Target URL may be malicious');
        break;
        
      case 'ssh':
      case 'scp':
        risks.push('Connects to remote systems');
        risks.push('May expose credentials or data');
        break;
    }
    
    return risks;
  }
  
  /**
   * Get risks for dangerous commands
   */
  private getDangerousRisks(command: string, args: string[]): string[] {
    const risks: string[] = [];
    
    switch (command) {
      case 'rm':
        if (args.includes('-rf') && args.some(arg => arg.startsWith('/'))) {
          risks.push('Recursively deletes system files');
          risks.push('Can render system unbootable');
          risks.push('Data loss is permanent');
        }
        break;
        
      case 'dd':
        risks.push('Direct disk write operation');
        risks.push('Can overwrite boot sectors');
        risks.push('Destroys all data on target device');
        break;
        
      case 'chmod':
      case 'chown':
        if (args.includes('-R') && args.some(arg => arg.startsWith('/'))) {
          risks.push('Changes permissions system-wide');
          risks.push('Can break system security');
          risks.push('May lock out user access');
        }
        break;
        
      case 'mkfs':
      case 'mkfs.ext4':
        risks.push('Formats storage device');
        risks.push('Destroys all existing data');
        risks.push('Cannot be undone');
        break;
    }
    
    return risks;
  }
  
  /**
   * Get safer alternatives
   */
  private getAlternatives(command: string, args: string[]): string[] {
    const alternatives: string[] = [];
    
    switch (command) {
      case 'rm':
        if (args.includes('-rf')) {
          alternatives.push('Use rm -i for interactive deletion');
          alternatives.push('Move files to trash instead of deleting');
          alternatives.push('Create a backup before deletion');
        }
        break;
        
      case 'chmod':
        if (args.includes('777')) {
          alternatives.push('Use more restrictive permissions (e.g., 755 or 644)');
          alternatives.push('Grant permissions only to specific users');
        }
        break;
        
      case 'dd':
        alternatives.push('Use dedicated backup tools');
        alternatives.push('Verify target device before writing');
        break;
    }
    
    return alternatives;
  }
  
  /**
   * Collect training data from actual usage
   */
  async collectFromUsage(logFile: string): Promise<TrainingExample[]> {
    const examples: TrainingExample[] = [];
    
    try {
      const content = await fs.readFile(logFile, 'utf-8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const log = JSON.parse(line);
          if (log.type === 'command_intercepted' && log.analysis) {
            examples.push({
              command: log.command,
              args: log.args || [],
              context: log.context || {
                cwd: process.cwd(),
                user: process.env.USER || 'unknown',
                platform: process.platform,
                isSudo: false
              },
              classification: log.analysis,
              timestamp: log.timestamp || new Date().toISOString()
            });
          }
        } catch {
          // Skip malformed log lines
        }
      }
    } catch (error) {
      this.logger.warn('Failed to read usage log:', error);
    }
    
    return examples;
  }
  
  /**
   * Save training dataset
   */
  async saveDataset(examples: TrainingExample[], filename: string): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    
    // Calculate statistics
    const statistics = {
      total: examples.length,
      byVerdict: {} as Record<string, number>,
      byPlatform: {} as Record<string, number>,
      withSudo: 0
    };
    
    for (const example of examples) {
      // Count by verdict
      statistics.byVerdict[example.classification.verdict] = 
        (statistics.byVerdict[example.classification.verdict] || 0) + 1;
      
      // Count by platform
      statistics.byPlatform[example.context.platform] = 
        (statistics.byPlatform[example.context.platform] || 0) + 1;
      
      // Count sudo commands
      if (example.context.isSudo) {
        statistics.withSudo++;
      }
    }
    
    const dataset: TrainingDataset = {
      version: '1.0.0',
      generated: new Date().toISOString(),
      examples,
      statistics
    };
    
    const filepath = path.join(this.dataDir, filename);
    await fs.writeFile(filepath, JSON.stringify(dataset, null, 2));
    
    this.logger.info(`Saved training dataset: ${filepath}`);
    this.logger.info(`Total examples: ${statistics.total}`);
  }
  
  /**
   * Load training dataset
   */
  async loadDataset(filename: string): Promise<TrainingDataset> {
    const filepath = path.join(this.dataDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(content);
  }
  
  /**
   * Merge multiple datasets
   */
  async mergeDatasets(filenames: string[]): Promise<TrainingDataset> {
    const allExamples: TrainingExample[] = [];
    
    for (const filename of filenames) {
      const dataset = await this.loadDataset(filename);
      allExamples.push(...dataset.examples);
    }
    
    // Remove duplicates based on command + args
    const unique = new Map<string, TrainingExample>();
    for (const example of allExamples) {
      const key = `${example.command} ${example.args.join(' ')}`;
      if (!unique.has(key)) {
        unique.set(key, example);
      }
    }
    
    return {
      version: '1.0.0',
      generated: new Date().toISOString(),
      examples: Array.from(unique.values()),
      statistics: this.calculateStatistics(Array.from(unique.values()))
    };
  }
  
  /**
   * Calculate dataset statistics
   */
  private calculateStatistics(examples: TrainingExample[]) {
    const statistics = {
      total: examples.length,
      byVerdict: {} as Record<string, number>,
      byPlatform: {} as Record<string, number>,
      withSudo: 0
    };
    
    for (const example of examples) {
      statistics.byVerdict[example.classification.verdict] = 
        (statistics.byVerdict[example.classification.verdict] || 0) + 1;
      statistics.byPlatform[example.context.platform] = 
        (statistics.byPlatform[example.context.platform] || 0) + 1;
      if (example.context.isSudo) {
        statistics.withSudo++;
      }
    }
    
    return statistics;
  }
}