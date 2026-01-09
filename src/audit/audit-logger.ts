import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { createGzip } from 'zlib';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { Logger } from '../utils/logger';
import { ConfigManager } from '../config/config-manager';

const pipelineAsync = promisify(pipeline);

interface AuditEntry {
  timestamp: string;
  event_id: string;
  event_type: 'command_execution' | 'security_violation' | 'configuration_change' | 'system_event';
  user: string;
  command?: string;
  args?: string[];
  verdict?: string;
  risk_level?: string;
  context: any;
  hash?: string;
  metadata?: any;
}

export class SecureAuditLogger {
  private static instance: SecureAuditLogger;
  private logDir: string;
  private currentLog: string = '';
  private encryptionKey!: Buffer;
  private hmacKey!: Buffer;
  private logger: Logger;
  private writeQueue: AuditEntry[] = [];
  private isWriting: boolean = false;
  private rotationInProgress: boolean = false;
  
  private constructor() {
    this.logger = new Logger('audit-logger');
    this.logDir = this.determineLogDirectory();
    this.deriveKeys();
    this.ensureLogDirectory();
    this.initializeLog();
    
    // Flush queue periodically
    setInterval(() => this.flushQueue(), 1000);
  }
  
  static getInstance(): SecureAuditLogger {
    if (!SecureAuditLogger.instance) {
      SecureAuditLogger.instance = new SecureAuditLogger();
    }
    return SecureAuditLogger.instance;
  }
  
  /**
   * Determine appropriate log directory
   */
  private determineLogDirectory(): string {
    // Try system directory first
    const systemLogDir = '/var/log/deliberate';
    try {
      fs.accessSync(path.dirname(systemLogDir), fs.constants.W_OK);
      return systemLogDir;
    } catch {
      // Fall back to user directory
      return path.join(os.homedir(), '.deliberate', 'logs');
    }
  }
  
  /**
   * Ensure log directory exists with proper permissions
   */
  private ensureLogDirectory(): void {
    try {
      fs.mkdirSync(this.logDir, { recursive: true, mode: 0o700 });
      
      // Set restrictive permissions
      try {
        fs.chmodSync(this.logDir, 0o700);
      } catch {
        // chmod might not work on all platforms
      }
    } catch (error) {
      this.logger.error('Failed to create log directory:', error);
      throw new Error('Cannot create secure log directory');
    }
  }
  
  /**
   * Derive encryption and HMAC keys from system information
   */
  private deriveKeys(): void {
    // Collect system entropy
    const systemInfo = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().map(cpu => cpu.model),
      release: os.release(),
      type: os.type(),
      // Add process-specific entropy
      pid: process.pid,
      ppid: process.ppid,
      argv: process.argv,
      execPath: process.execPath,
      // Add time-based entropy
      uptime: os.uptime(),
      timestamp: Date.now(),
      hrtime: process.hrtime.bigint().toString()
    };
    
    // Generate master key with high entropy
    const master = crypto
      .pbkdf2Sync(
        JSON.stringify(systemInfo),
        crypto.randomBytes(32), // Salt
        100000, // Iterations
        64, // Key length
        'sha512'
      );
    
    this.encryptionKey = master.slice(0, 32);
    this.hmacKey = master.slice(32);
  }
  
  /**
   * Initialize current log file
   */
  private initializeLog(): void {
    this.currentLog = path.join(this.logDir, 'audit.log');
    
    // Create file with restrictive permissions
    if (!fs.existsSync(this.currentLog)) {
      fs.writeFileSync(this.currentLog, '', { mode: 0o600 });
    }
  }
  
  /**
   * Log an audit entry
   */
  async log(entry: Partial<AuditEntry>): Promise<void> {
    const fullEntry: AuditEntry = {
      timestamp: new Date().toISOString(),
      event_id: crypto.randomUUID(),
      event_type: entry.event_type || 'command_execution',
      user: process.env.USER || 'unknown',
      ...entry,
      context: {
        pid: process.pid,
        ppid: process.ppid,
        cwd: process.cwd(),
        tty: process.stdin.isTTY,
        env_hash: this.hashEnvironment(),
        ...entry.context
      }
    };
    
    // Add integrity hash
    fullEntry.hash = this.calculateHash(fullEntry);
    
    // Encrypt sensitive fields
    if (fullEntry.command) {
      fullEntry.command = this.encrypt(fullEntry.command);
    }
    
    if (fullEntry.args) {
      fullEntry.args = fullEntry.args.map(arg => this.encrypt(arg));
    }
    
    // Add to write queue
    this.writeQueue.push(fullEntry);
    
    // Process alerts asynchronously
    if (fullEntry.risk_level === 'CRITICAL' || 
        fullEntry.event_type === 'security_violation') {
      this.sendAlert(fullEntry).catch(err => 
        this.logger.error('Failed to send alert:', err)
      );
    }
  }
  
  /**
   * Calculate integrity hash for entry
   */
  private calculateHash(entry: AuditEntry): string {
    const content = JSON.stringify({
      ...entry,
      hash: undefined
    });
    
    return crypto
      .createHmac('sha256', this.hmacKey)
      .update(content)
      .digest('hex');
  }
  
  /**
   * Encrypt sensitive data
   */
  private encrypt(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(data, 'utf8'),
      cipher.final()
    ]);
    
    const tag = cipher.getAuthTag();
    
    return JSON.stringify({
      data: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64')
    });
  }
  
  /**
   * Decrypt data
   */
  decrypt(encryptedData: string): string {
    try {
      const { data, iv, tag } = JSON.parse(encryptedData);
      
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        Buffer.from(iv, 'base64')
      );
      
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final()
      ]);
      
      return decrypted.toString('utf8');
    } catch (error) {
      this.logger.error('Decryption failed:', error);
      return '[DECRYPTION_FAILED]';
    }
  }
  
  /**
   * Hash environment for change detection
   */
  private hashEnvironment(): string {
    const criticalVars = [
      'PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
      'HOME', 'USER', 'SHELL'
    ];
    
    const env: any = {};
    for (const varName of criticalVars) {
      if (process.env[varName]) {
        env[varName] = process.env[varName];
      }
    }
    
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(env))
      .digest('hex')
      .substring(0, 16);
  }
  
  /**
   * Flush write queue to disk
   */
  private async flushQueue(): Promise<void> {
    if (this.isWriting || this.writeQueue.length === 0 || this.rotationInProgress) {
      return;
    }
    
    this.isWriting = true;
    const entriesToWrite = [...this.writeQueue];
    this.writeQueue = [];
    
    try {
      const lines = entriesToWrite.map(entry => JSON.stringify(entry)).join('\n') + '\n';
      
      await fs.promises.appendFile(
        this.currentLog,
        lines,
        { mode: 0o600 }
      );
      
      // Check if rotation needed
      const stats = await fs.promises.stat(this.currentLog);
      if (stats.size > 100 * 1024 * 1024) { // 100MB
        this.rotateLog().catch(err => 
          this.logger.error('Log rotation failed:', err)
        );
      }
    } catch (error) {
      this.logger.error('Failed to write audit entries:', error);
      // Re-queue failed entries
      this.writeQueue.unshift(...entriesToWrite);
    } finally {
      this.isWriting = false;
    }
  }
  
  /**
   * Rotate log files
   */
  private async rotateLog(): Promise<void> {
    if (this.rotationInProgress) return;
    
    this.rotationInProgress = true;
    
    try {
      // Ensure queue is flushed
      await this.flushQueue();
      
      // Generate archive name
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archivePath = path.join(this.logDir, `audit-${timestamp}.log.gz`);
      
      // Compress current log
      await pipelineAsync(
        fs.createReadStream(this.currentLog),
        createGzip({ level: 9 }),
        fs.createWriteStream(archivePath, { mode: 0o600 })
      );
      
      // Create new log file
      await fs.promises.writeFile(this.currentLog, '', { mode: 0o600 });
      
      // Clean up old archives
      await this.cleanupOldArchives();
      
      this.logger.info(`Log rotated to ${archivePath}`);
    } catch (error) {
      this.logger.error('Log rotation failed:', error);
    } finally {
      this.rotationInProgress = false;
    }
  }
  
  /**
   * Clean up old archive files
   */
  private async cleanupOldArchives(): Promise<void> {
    const maxArchives = 30; // Keep 30 days of archives
    
    try {
      const files = await fs.promises.readdir(this.logDir);
      const archives = files
        .filter(f => f.startsWith('audit-') && f.endsWith('.log.gz'))
        .map(f => ({
          name: f,
          path: path.join(this.logDir, f)
        }));
      
      // Sort by name (timestamp)
      archives.sort((a, b) => b.name.localeCompare(a.name));
      
      // Remove old archives
      for (let i = maxArchives; i < archives.length; i++) {
        const archive = archives[i];
        if (archive) {
          await fs.promises.unlink(archive.path);
          this.logger.debug(`Removed old archive: ${archive.name}`);
        }
      }
    } catch (error) {
      this.logger.error('Failed to cleanup archives:', error);
    }
  }
  
  /**
   * Verify log integrity
   */
  async verify(logPath: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    try {
      const content = await fs.promises.readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      
      let lineNumber = 0;
      for (const line of lines) {
        lineNumber++;
        
        try {
          const entry = JSON.parse(line);
          const expectedHash = entry.hash;
          delete entry.hash;
          
          const actualHash = this.calculateHash(entry);
          
          if (expectedHash !== actualHash) {
            errors.push(`Line ${lineNumber}: Integrity check failed`);
          }
          
          // Verify structure
          if (!entry.timestamp || !entry.event_id || !entry.event_type) {
            errors.push(`Line ${lineNumber}: Missing required fields`);
          }
        } catch (error) {
          errors.push(`Line ${lineNumber}: Parse error - ${error}`);
        }
      }
    } catch (error) {
      errors.push(`File read error: ${error}`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Send security alert
   */
  private async sendAlert(entry: AuditEntry): Promise<void> {
    const config = ConfigManager.getInstance();
    const notifications = config.get('notifications');
    
    if (!notifications.alert_on_dangerous) return;
    
    const alert = {
      severity: entry.risk_level || 'HIGH',
      event_type: entry.event_type,
      user: entry.user,
      timestamp: entry.timestamp,
      command: entry.command ? '[ENCRYPTED]' : undefined,
      context: {
        pid: entry.context.pid,
        tty: entry.context.tty
      }
    };
    
    // Webhook notification
    if (notifications.webhook_url) {
      try {
        const axios = await import('axios');
        await axios.default.post(notifications.webhook_url, {
          text: `⚠️ Deliberate Security Alert`,
          alert
        });
      } catch (error) {
        this.logger.error('Webhook notification failed:', error);
      }
    }
    
    // Console notification for critical events
    if (entry.risk_level === 'CRITICAL') {
      console.error('\n🚨 CRITICAL SECURITY EVENT DETECTED 🚨');
      console.error(`Type: ${entry.event_type}`);
      console.error(`User: ${entry.user}`);
      console.error(`Time: ${entry.timestamp}`);
      console.error('Check audit logs for details\n');
    }
  }
  
  /**
   * Search audit logs
   */
  async search(criteria: {
    startTime?: Date;
    endTime?: Date;
    eventType?: string;
    user?: string;
    riskLevel?: string;
  }): Promise<AuditEntry[]> {
    const results: AuditEntry[] = [];
    
    try {
      // Search current log
      await this.searchFile(this.currentLog, criteria, results);
      
      // Search archives if needed
      if (criteria.startTime) {
        const files = await fs.promises.readdir(this.logDir);
        const archives = files.filter(f => f.endsWith('.log.gz'));
        
        for (const archive of archives) {
          // Extract timestamp from filename
          const match = archive.match(/audit-(\d{4}-\d{2}-\d{2})/);
          if (match && match[1]) {
            const archiveDate = new Date(match[1]);
            if (archiveDate >= criteria.startTime) {
              // Would need to decompress and search
              // For now, skip compressed files
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Search failed:', error);
    }
    
    return results;
  }
  
  /**
   * Search a specific file
   */
  private async searchFile(
    filePath: string,
    criteria: any,
    results: AuditEntry[]
  ): Promise<void> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        
        // Apply filters
        if (criteria.startTime && new Date(entry.timestamp) < criteria.startTime) continue;
        if (criteria.endTime && new Date(entry.timestamp) > criteria.endTime) continue;
        if (criteria.eventType && entry.event_type !== criteria.eventType) continue;
        if (criteria.user && entry.user !== criteria.user) continue;
        if (criteria.riskLevel && entry.risk_level !== criteria.riskLevel) continue;
        
        results.push(entry);
      } catch {
        // Skip malformed entries
      }
    }
  }
  
  /**
   * Export logs for analysis
   */
  async export(outputPath: string, format: 'json' | 'csv' = 'json'): Promise<void> {
    const entries = await this.search({});
    
    if (format === 'json') {
      await fs.promises.writeFile(
        outputPath,
        JSON.stringify(entries, null, 2),
        'utf-8'
      );
    } else {
      // CSV export
      const headers = ['timestamp', 'event_id', 'event_type', 'user', 'risk_level'];
      const csv = [
        headers.join(','),
        ...entries.map(e => 
          headers.map(h => JSON.stringify(e[h as keyof AuditEntry] || '')).join(',')
        )
      ].join('\n');
      
      await fs.promises.writeFile(outputPath, csv, 'utf-8');
    }
  }
}