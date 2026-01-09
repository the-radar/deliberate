import * as crypto from 'crypto';
import { Logger } from '../utils/logger';

interface CommandStats {
  total: number;
  cache_hits: number;
  fast_path: number;
  full_analysis: number;
  avg_time?: number;
  last_access?: number;
}

interface CacheEntry {
  safe: boolean;
  timestamp: number;
  hits: number;
}

export class FastPath {
  private safeCommandCache: Map<string, CacheEntry>;
  private commandStats: Map<string, CommandStats>;
  private logger: Logger;
  private cacheMaxSize: number = 10000;
  private cacheTTL: number = 60 * 60 * 1000; // 1 hour
  
  // Commands that are always safe and never need analysis
  private alwaysSafeCommands = new Set([
    'ls', 'pwd', 'whoami', 'date', 'cal',
    'echo', 'printf', 'cat', 'less', 'more',
    'grep', 'awk', 'sed', 'sort', 'uniq',
    'head', 'tail', 'wc', 'diff',
    'cd', 'pushd', 'popd', 'dirs',
    'env', 'printenv', 'locale',
    'uname', 'hostname', 'uptime',
    'df', 'du', 'free', 'top', 'ps',
    'which', 'whereis', 'type',
    'man', 'info', 'help'
  ]);
  
  // Read-only commands that can be fast-pathed with argument checking
  private readOnlyCommands = new Set([
    'find', 'file', 'stat',
    'id', 'groups', 'who', 'w', 'last',
    'mount', 'lsblk', 'lsusb', 'lspci',
    'netstat', 'ss', 'ip', 'ifconfig',
    'dig', 'nslookup', 'host',
    'tree', 'basename', 'dirname',
    'realpath', 'readlink'
  ]);
  
  constructor() {
    this.logger = new Logger('fast-path');
    this.safeCommandCache = new Map();
    this.commandStats = new Map();
    this.preloadSafeCommands();
    
    // Periodic cache cleanup
    setInterval(() => this.cleanupCache(), 5 * 60 * 1000); // Every 5 minutes
  }
  
  private preloadSafeCommands(): void {
    // Preload common safe command variations
    const commonVariations = [
      ['ls'], ['ls', '-l'], ['ls', '-la'], ['ls', '-lh'],
      ['pwd'], ['whoami'], ['date'], ['cal'],
      ['df'], ['df', '-h'], ['du', '-sh', '.'],
      ['ps'], ['ps', 'aux'], ['ps', '-ef'],
      ['free'], ['free', '-h'], ['free', '-m'],
      ['uname'], ['uname', '-a'], ['hostname'],
      ['env'], ['printenv'], ['locale']
    ];
    
    for (const cmdArgs of commonVariations) {
      const command = cmdArgs[0];
      if (!command) continue;
      const args = cmdArgs.slice(1);
      const hash = this.hashCommand(command, args);
      
      this.safeCommandCache.set(hash, {
        safe: true,
        timestamp: Date.now(),
        hits: 0
      });
    }
    
    this.logger.info(`Preloaded ${this.safeCommandCache.size} safe command variations`);
  }
  
  /**
   * Check if command is eligible for fast path execution
   */
  isFastPathEligible(command: string, args: string[]): boolean {
    const startTime = performance.now();
    const hash = this.hashCommand(command, args);
    
    // Check cache first (fastest)
    const cached = this.safeCommandCache.get(hash);
    if (cached && this.isCacheValid(cached)) {
      cached.hits++;
      this.updateStats(command, 'cache_hits', performance.now() - startTime);
      return cached.safe;
    }
    
    // Check if it's an always-safe command
    if (this.alwaysSafeCommands.has(command)) {
      this.cacheCommand(hash, true);
      this.updateStats(command, 'fast_path', performance.now() - startTime);
      return true;
    }
    
    // Check if command is read-only with safe args
    if (this.isReadOnlyCommand(command, args)) {
      this.cacheCommand(hash, true);
      this.updateStats(command, 'fast_path', performance.now() - startTime);
      return true;
    }
    
    // Not eligible for fast path
    this.updateStats(command, 'full_analysis', performance.now() - startTime);
    return false;
  }
  
  /**
   * Check if command is read-only and has safe arguments
   */
  private isReadOnlyCommand(command: string, args: string[]): boolean {
    // Extract base command (handle paths)
    const baseCommand = command.split('/').pop() || command;
    
    if (!this.readOnlyCommands.has(baseCommand)) {
      return false;
    }
    
    // Check for dangerous argument patterns
    const dangerousPatterns = [
      />/,           // Output redirection
      />>/,          // Append redirection
      /\|/,          // Pipe
      /&/,           // Background execution
      /;/,           // Command separator
      /`/,           // Command substitution
      /\$\(/,        // Command substitution
      /&&/,          // Conditional execution
      /\|\|/,        // Conditional execution
      /</,           // Input redirection
      /<<</,         // Here string
      /\.\./,        // Path traversal
      /^-/           // Options that might be dangerous
    ];
    
    const fullCommand = args.join(' ');
    for (const pattern of dangerousPatterns) {
      if (pattern.test(fullCommand)) {
        return false;
      }
    }
    
    // Additional checks for specific commands
    return this.checkCommandSpecificSafety(baseCommand, args);
  }
  
  /**
   * Command-specific safety checks
   */
  private checkCommandSpecificSafety(command: string, args: string[]): boolean {
    switch (command) {
      case 'find':
        // Reject if has -exec, -execdir, -ok, -okdir
        return !args.some(arg => /^-(exec|execdir|ok|okdir)/.test(arg));
        
      case 'grep':
      case 'awk':
      case 'sed':
        // These are safe for reading but check for file modification flags
        return !args.some(arg => arg === '-i' || arg.startsWith('--in-place'));
        
      case 'tar':
        // Only allow listing/reading, not extraction or creation
        return args.some(arg => arg === '-t' || arg === '--list') &&
               !args.some(arg => /^-[^t]*[xc]/.test(arg));
        
      default:
        return true;
    }
  }
  
  /**
   * Hash command for caching
   */
  private hashCommand(command: string, args: string[]): string {
    const data = JSON.stringify({ command, args: args.sort() });
    return crypto
      .createHash('sha256')
      .update(data)
      .digest('hex')
      .substring(0, 16);
  }
  
  /**
   * Check if cache entry is still valid
   */
  private isCacheValid(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp < this.cacheTTL;
  }
  
  /**
   * Cache a command decision
   */
  private cacheCommand(hash: string, safe: boolean): void {
    // Enforce cache size limit
    if (this.safeCommandCache.size >= this.cacheMaxSize) {
      this.evictOldestEntries();
    }
    
    this.safeCommandCache.set(hash, {
      safe,
      timestamp: Date.now(),
      hits: 0
    });
  }
  
  /**
   * Evict oldest cache entries
   */
  private evictOldestEntries(): void {
    const entries = Array.from(this.safeCommandCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    // Remove oldest 10%
    const toRemove = Math.floor(this.cacheMaxSize * 0.1);
    for (let i = 0; i < toRemove; i++) {
      const entry = entries[i];
      if (entry) {
        this.safeCommandCache.delete(entry[0]);
      }
    }
  }
  
  /**
   * Update command statistics
   */
  private updateStats(command: string, type: 'cache_hits' | 'fast_path' | 'full_analysis', time: number): void {
    if (!this.commandStats.has(command)) {
      this.commandStats.set(command, {
        total: 0,
        cache_hits: 0,
        fast_path: 0,
        full_analysis: 0,
        avg_time: 0,
        last_access: Date.now()
      });
    }
    
    const stats = this.commandStats.get(command)!;
    stats.total++;
    if (type === 'cache_hits') {
      stats.cache_hits++;
    } else if (type === 'fast_path') {
      stats.fast_path++;
    } else if (type === 'full_analysis') {
      stats.full_analysis++;
    }
    stats.last_access = Date.now();
    
    // Update average time
    if (stats.avg_time) {
      stats.avg_time = (stats.avg_time * (stats.total - 1) + time) / stats.total;
    } else {
      stats.avg_time = time;
    }
  }
  
  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    let removed = 0;
    
    for (const [hash, entry] of this.safeCommandCache) {
      if (!this.isCacheValid(entry)) {
        this.safeCommandCache.delete(hash);
        removed++;
      }
    }
    
    if (removed > 0) {
      this.logger.debug(`Cleaned up ${removed} expired cache entries`);
    }
  }
  
  /**
   * Get performance report
   */
  getPerformanceReport(): any {
    const report = {
      cache_size: this.safeCommandCache.size,
      cache_hit_rate: '0%',
      avg_response_time: '0ms',
      commands: [] as any[]
    };
    
    let totalHits = 0;
    let totalCalls = 0;
    let totalTime = 0;
    let commandCount = 0;
    
    // Sort by most used
    const sortedStats = Array.from(this.commandStats.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 20); // Top 20 commands
    
    for (const [cmd, stats] of sortedStats) {
      totalHits += stats.cache_hits + stats.fast_path;
      totalCalls += stats.total;
      
      if (stats.avg_time) {
        totalTime += stats.avg_time * stats.total;
        commandCount += stats.total;
      }
      
      report.commands.push({
        command: cmd,
        total: stats.total,
        cache_hit_rate: ((stats.cache_hits / stats.total) * 100).toFixed(1),
        fast_path_rate: ((stats.fast_path / stats.total) * 100).toFixed(1),
        avg_time: stats.avg_time ? stats.avg_time.toFixed(2) + 'ms' : 'N/A',
        last_access: new Date(stats.last_access || 0).toISOString()
      });
    }
    
    report.cache_hit_rate = totalCalls > 0 ? ((totalHits / totalCalls) * 100).toFixed(1) + '%' : '0%';
    report.avg_response_time = commandCount > 0 ? (totalTime / commandCount).toFixed(2) + 'ms' : '0ms';
    
    return report;
  }
  
  /**
   * Export cache for persistence
   */
  exportCache(): any {
    const cache: any[] = [];
    
    for (const [hash, entry] of this.safeCommandCache) {
      if (this.isCacheValid(entry)) {
        cache.push({
          hash,
          ...entry
        });
      }
    }
    
    return {
      version: '1.0',
      exported: new Date().toISOString(),
      entries: cache,
      stats: Object.fromEntries(this.commandStats)
    };
  }
  
  /**
   * Import cache from persistence
   */
  importCache(data: any): void {
    if (data.version !== '1.0') {
      this.logger.warn('Incompatible cache version');
      return;
    }
    
    // Import cache entries
    for (const entry of data.entries) {
      if (this.isCacheValid(entry)) {
        this.safeCommandCache.set(entry.hash, {
          safe: entry.safe,
          timestamp: entry.timestamp,
          hits: entry.hits
        });
      }
    }
    
    // Import stats
    if (data.stats) {
      for (const [cmd, stats] of Object.entries(data.stats)) {
        this.commandStats.set(cmd, stats as CommandStats);
      }
    }
    
    this.logger.info(`Imported ${this.safeCommandCache.size} cache entries`);
  }
}