import * as crypto from 'crypto';
import { Logger } from '../utils/logger';

interface CommandData {
  command: string;
  args: string[];
  timestamp: number;
  pid: number;
  uid: number;
  cwd: string;
  env: Record<string, string | undefined>;
}

interface SignedCommand {
  data: CommandData;
  signature: string;
  token: string;
}

export class CommandIntegrity {
  private logger: Logger;
  private commandHash: string = '';
  private executionToken: string = '';
  private signedAt: number = 0;
  private secretKey: Buffer;
  
  constructor() {
    this.logger = new Logger('command-integrity');
    this.secretKey = this.deriveSecretKey();
  }
  
  /**
   * Derive a secret key from system information
   */
  private deriveSecretKey(): Buffer {
    const systemInfo = {
      hostname: require('os').hostname(),
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      // Add more entropy from system
      uptime: require('os').uptime(),
      cpus: require('os').cpus().length
    };
    
    return crypto
      .createHash('sha512')
      .update(JSON.stringify(systemInfo))
      .update(crypto.randomBytes(32)) // Add randomness
      .digest()
      .slice(0, 32); // Use first 32 bytes for AES-256
  }
  
  /**
   * Sign a command for execution
   */
  async signCommand(command: string, args: string[]): Promise<SignedCommand> {
    const commandData: CommandData = {
      command,
      args,
      timestamp: Date.now(),
      pid: process.pid,
      uid: process.getuid?.() || -1,
      cwd: process.cwd(),
      env: this.getSecurityRelevantEnv()
    };
    
    // Create command signature
    const signature = this.createSignature(commandData);
    
    // Generate execution token
    this.executionToken = crypto.randomBytes(32).toString('hex');
    
    // Store for verification
    this.commandHash = signature;
    this.signedAt = commandData.timestamp;
    
    const signedCommand: SignedCommand = {
      data: commandData,
      signature,
      token: this.executionToken
    };
    
    this.logger.debug('Command signed', {
      command,
      token: this.executionToken.substring(0, 8) + '...'
    });
    
    return signedCommand;
  }
  
  /**
   * Verify command integrity before execution
   */
  verifyCommand(signedCommand: SignedCommand): boolean {
    try {
      // Check token
      if (signedCommand.token !== this.executionToken) {
        throw new Error('Invalid execution token');
      }
      
      // Check time window (5 seconds)
      const elapsed = Date.now() - this.signedAt;
      if (elapsed > 5000) {
        throw new Error('Command signature expired');
      }
      
      // Verify signature
      const expectedSignature = this.createSignature(signedCommand.data);
      if (expectedSignature !== signedCommand.signature) {
        throw new Error('Command signature mismatch');
      }
      
      // Verify command hasn't changed
      if (this.commandHash !== signedCommand.signature) {
        throw new Error('Command has been modified');
      }
      
      // Check for suspicious modifications
      this.checkForTampering(signedCommand.data);
      
      // Clear token after successful verification
      this.executionToken = '';
      
      this.logger.debug('Command verified successfully');
      return true;
      
    } catch (error) {
      this.logger.error('Command verification failed:', error);
      return false;
    }
  }
  
  /**
   * Create cryptographic signature for command data
   */
  private createSignature(data: CommandData): string {
    const content = JSON.stringify({
      cmd: data.command,
      args: data.args,
      ts: data.timestamp,
      pid: data.pid,
      uid: data.uid,
      cwd: data.cwd,
      env: data.env
    });
    
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(content)
      .digest('hex');
  }
  
  /**
   * Get security-relevant environment variables
   */
  private getSecurityRelevantEnv(): Record<string, string | undefined> {
    const relevantVars = [
      'PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
      'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
      'HOME', 'USER', 'SHELL'
    ];
    
    const env: Record<string, string | undefined> = {};
    for (const varName of relevantVars) {
      env[varName] = process.env[varName];
    }
    
    return env;
  }
  
  /**
   * Check for signs of tampering
   */
  private checkForTampering(data: CommandData): void {
    // Check if process info matches
    if (data.pid !== process.pid) {
      throw new Error('Process ID mismatch');
    }
    
    if (data.uid !== (process.getuid?.() || -1)) {
      throw new Error('User ID mismatch');
    }
    
    // Check if CWD changed
    if (data.cwd !== process.cwd()) {
      throw new Error('Working directory changed');
    }
    
    // Check critical environment variables
    const currentEnv = this.getSecurityRelevantEnv();
    for (const [key, value] of Object.entries(data.env)) {
      if (currentEnv[key] !== value) {
        throw new Error(`Environment variable ${key} has been modified`);
      }
    }
  }
  
  /**
   * Create a verification token for async operations
   */
  async createVerificationToken(command: string, args: string[]): Promise<string> {
    const data = {
      command,
      args,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex')
    };
    
    const token = crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .update(this.secretKey)
      .digest('hex');
    
    return token;
  }
  
  /**
   * Sign data for audit trail
   */
  signForAudit(data: any): string {
    const content = JSON.stringify({
      data,
      timestamp: Date.now(),
      pid: process.pid
    });
    
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(content)
      .digest('hex');
  }
}