import * as https from 'https';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';
import { ConfigManager } from '../config/config-manager';
import * as semver from 'semver';

const execAsync = promisify(child_process.exec);

interface UpdateInfo {
  version: string;
  releaseDate: string;
  changelog: string[];
  securityFixes: boolean;
  downloadUrl: string;
  checksum: string;
  signature: string;
  minimumNodeVersion: string;
  breakingChanges: boolean;
}

interface UpdateChannel {
  name: 'stable' | 'beta' | 'nightly';
  url: string;
  publicKey: string;
}

export class UpdateManager extends EventEmitter {
  private static instance: UpdateManager;
  private logger: Logger;
  private currentVersion: string;
  private updateChannels: Map<string, UpdateChannel>;
  private lastCheckTime: number = 0;
  private checkInterval: number = 24 * 60 * 60 * 1000; // 24 hours
  private isUpdating: boolean = false;
  private updateDir: string;
  
  private constructor() {
    super();
    this.logger = new Logger('update-manager');
    this.currentVersion = this.getCurrentVersion();
    this.updateChannels = this.initializeChannels();
    this.updateDir = path.join(process.env.HOME || '', '.deliberate', 'updates');
    
    this.ensureUpdateDirectory();
    this.scheduleUpdateChecks();
  }
  
  static getInstance(): UpdateManager {
    if (!UpdateManager.instance) {
      UpdateManager.instance = new UpdateManager();
    }
    return UpdateManager.instance;
  }
  
  /**
   * Get current version from package.json
   */
  private getCurrentVersion(): string {
    try {
      const packagePath = path.join(__dirname, '..', '..', 'package.json');
      const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      return packageData.version;
    } catch {
      return '0.1.0'; // Fallback
    }
  }
  
  /**
   * Initialize update channels
   */
  private initializeChannels(): Map<string, UpdateChannel> {
    const channels = new Map<string, UpdateChannel>();
    
    // Production update channels
    channels.set('stable', {
      name: 'stable',
      url: 'https://updates.deliberate.ai/stable/latest.json',
      publicKey: 'YOUR_STABLE_CHANNEL_PUBLIC_KEY'
    });
    
    channels.set('beta', {
      name: 'beta',
      url: 'https://updates.deliberate.ai/beta/latest.json',
      publicKey: 'YOUR_BETA_CHANNEL_PUBLIC_KEY'
    });
    
    channels.set('nightly', {
      name: 'nightly',
      url: 'https://updates.deliberate.ai/nightly/latest.json',
      publicKey: 'YOUR_NIGHTLY_CHANNEL_PUBLIC_KEY'
    });
    
    return channels;
  }
  
  /**
   * Ensure update directory exists
   */
  private ensureUpdateDirectory(): void {
    try {
      fs.mkdirSync(this.updateDir, { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create update directory:', error);
    }
  }
  
  /**
   * Schedule automatic update checks
   */
  private scheduleUpdateChecks(): void {
    const config = ConfigManager.getInstance();
    const autoUpdate = config.getPath('updates.auto_check') !== false;
    
    if (!autoUpdate) {
      this.logger.info('Automatic update checks disabled');
      return;
    }
    
    // Initial check after 5 minutes
    setTimeout(() => this.checkForUpdates(), 5 * 60 * 1000);
    
    // Regular checks
    setInterval(() => this.checkForUpdates(), this.checkInterval);
  }
  
  /**
   * Check for updates
   */
  async checkForUpdates(channel: string = 'stable'): Promise<UpdateInfo | null> {
    if (Date.now() - this.lastCheckTime < 60 * 1000) {
      this.logger.debug('Update check throttled');
      return null;
    }
    
    this.lastCheckTime = Date.now();
    this.emit('check-started', channel);
    
    try {
      const updateChannel = this.updateChannels.get(channel);
      if (!updateChannel) {
        throw new Error(`Unknown update channel: ${channel}`);
      }
      
      // Fetch update info
      const updateInfo = await this.fetchUpdateInfo(updateChannel);
      
      if (!updateInfo) {
        this.emit('check-completed', null);
        return null;
      }
      
      // Verify signature
      if (!this.verifyUpdateSignature(updateInfo, updateChannel.publicKey)) {
        throw new Error('Invalid update signature');
      }
      
      // Check if update is applicable
      if (this.isUpdateApplicable(updateInfo)) {
        this.logger.info(`Update available: ${updateInfo.version}`);
        this.emit('update-available', updateInfo);
        return updateInfo;
      }
      
      this.emit('check-completed', null);
      return null;
      
    } catch (error) {
      this.logger.error('Update check failed:', error);
      this.emit('check-failed', error);
      return null;
    }
  }
  
  /**
   * Fetch update information
   */
  private async fetchUpdateInfo(channel: UpdateChannel): Promise<UpdateInfo | null> {
    return new Promise((resolve, reject) => {
      https.get(channel.url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const info = JSON.parse(data);
            resolve(info);
          } catch (error) {
            reject(error);
          }
        });
        
      }).on('error', reject);
    });
  }
  
  /**
   * Verify update signature
   */
  private verifyUpdateSignature(updateInfo: UpdateInfo, _publicKey: string): boolean {
    // In production, implement proper signature verification
    // For now, basic validation
    return !!(updateInfo.signature && updateInfo.checksum);
  }
  
  /**
   * Check if update is applicable
   */
  private isUpdateApplicable(updateInfo: UpdateInfo): boolean {
    // Check version
    if (!semver.gt(updateInfo.version, this.currentVersion)) {
      return false;
    }
    
    // Check Node.js version requirement
    if (updateInfo.minimumNodeVersion) {
      const nodeVersion = process.version.substring(1); // Remove 'v' prefix
      if (!semver.gte(nodeVersion, updateInfo.minimumNodeVersion)) {
        this.logger.warn(`Update requires Node.js ${updateInfo.minimumNodeVersion} or higher`);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Download and install update
   */
  async installUpdate(updateInfo: UpdateInfo): Promise<void> {
    if (this.isUpdating) {
      throw new Error('Update already in progress');
    }
    
    this.isUpdating = true;
    this.emit('install-started', updateInfo);
    
    try {
      // Download update
      const downloadPath = await this.downloadUpdate(updateInfo);
      
      // Verify checksum
      if (!await this.verifyChecksum(downloadPath, updateInfo.checksum)) {
        throw new Error('Checksum verification failed');
      }
      
      // Create backup
      const backupPath = await this.createBackup();
      
      try {
        // Apply update
        await this.applyUpdate(downloadPath, updateInfo);
        
        // Restart application
        this.emit('install-completed', updateInfo);
        this.scheduleRestart();
        
      } catch (error) {
        // Rollback on failure
        this.logger.error('Update failed, rolling back:', error);
        await this.rollback(backupPath);
        throw error;
      }
      
    } catch (error) {
      this.logger.error('Update installation failed:', error);
      this.emit('install-failed', error);
      throw error;
    } finally {
      this.isUpdating = false;
    }
  }
  
  /**
   * Download update package
   */
  private async downloadUpdate(updateInfo: UpdateInfo): Promise<string> {
    const filename = `deliberate-${updateInfo.version}.tar.gz`;
    const downloadPath = path.join(this.updateDir, filename);
    
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(downloadPath);
      let downloadedBytes = 0;
      
      https.get(updateInfo.downloadUrl, (res) => {
        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const progress = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
          this.emit('download-progress', progress);
        });
        
        res.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve(downloadPath);
        });
        
      }).on('error', (error) => {
        fs.unlink(downloadPath, () => {}); // Clean up
        reject(error);
      });
    });
  }
  
  /**
   * Verify file checksum
   */
  private async verifyChecksum(filePath: string, expectedChecksum: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => {
        hash.update(data);
      });
      
      stream.on('end', () => {
        const checksum = hash.digest('hex');
        resolve(checksum === expectedChecksum);
      });
      
      stream.on('error', reject);
    });
  }
  
  /**
   * Create backup before update
   */
  private async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.updateDir, 'backups', `backup-${timestamp}`);
    
    fs.mkdirSync(backupDir, { recursive: true });
    
    // Backup critical files
    const filesToBackup = [
      'package.json',
      'dist',
      'bin'
    ];
    
    for (const file of filesToBackup) {
      const src = path.join(process.cwd(), file);
      const dest = path.join(backupDir, file);
      
      if (fs.existsSync(src)) {
        await this.copyRecursive(src, dest);
      }
    }
    
    this.logger.info(`Created backup at ${backupDir}`);
    return backupDir;
  }
  
  /**
   * Copy files recursively
   */
  private async copyRecursive(src: string, dest: string): Promise<void> {
    const stat = fs.statSync(src);
    
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      const files = fs.readdirSync(src);
      
      for (const file of files) {
        await this.copyRecursive(
          path.join(src, file),
          path.join(dest, file)
        );
      }
    } else {
      fs.copyFileSync(src, dest);
    }
  }
  
  /**
   * Apply update
   */
  private async applyUpdate(
    downloadPath: string,
    updateInfo: UpdateInfo
  ): Promise<void> {
    // Extract update package
    const extractDir = path.join(this.updateDir, 'extract');
    fs.mkdirSync(extractDir, { recursive: true });
    
    await execAsync(`tar -xzf ${downloadPath} -C ${extractDir}`);
    
    // Run pre-update scripts if any
    const preUpdateScript = path.join(extractDir, 'scripts', 'pre-update.js');
    if (fs.existsSync(preUpdateScript)) {
      await execAsync(`node ${preUpdateScript}`);
    }
    
    // Copy new files
    const updateFiles = fs.readdirSync(extractDir);
    for (const file of updateFiles) {
      if (file !== 'scripts') {
        const src = path.join(extractDir, file);
        const dest = path.join(process.cwd(), file);
        await this.copyRecursive(src, dest);
      }
    }
    
    // Run post-update scripts
    const postUpdateScript = path.join(extractDir, 'scripts', 'post-update.js');
    if (fs.existsSync(postUpdateScript)) {
      await execAsync(`node ${postUpdateScript}`);
    }
    
    // Update version
    this.currentVersion = updateInfo.version;
    
    // Clean up
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  
  /**
   * Rollback update
   */
  private async rollback(backupPath: string): Promise<void> {
    this.logger.info('Rolling back update...');
    
    const filesToRestore = fs.readdirSync(backupPath);
    for (const file of filesToRestore) {
      const src = path.join(backupPath, file);
      const dest = path.join(process.cwd(), file);
      
      // Remove current version
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      
      // Restore from backup
      await this.copyRecursive(src, dest);
    }
    
    this.logger.info('Rollback completed');
    this.emit('rollback-completed');
  }
  
  /**
   * Schedule application restart
   */
  private scheduleRestart(): void {
    this.logger.info('Scheduling restart in 5 seconds...');
    
    setTimeout(() => {
      this.emit('restart-required');
      
      // In production, implement proper restart mechanism
      // For now, just notify
      console.log('\n🔄 Please restart Deliberate to complete the update\n');
    }, 5000);
  }
  
  /**
   * Get update statistics
   */
  getStatistics(): any {
    return {
      currentVersion: this.currentVersion,
      lastCheckTime: this.lastCheckTime ? new Date(this.lastCheckTime).toISOString() : null,
      isUpdating: this.isUpdating,
      channels: Array.from(this.updateChannels.keys()),
      autoUpdateEnabled: ConfigManager.getInstance().getPath('updates.auto_check') !== false
    };
  }
  
  /**
   * Manually trigger update check
   */
  async manualCheck(channel: string = 'stable'): Promise<UpdateInfo | null> {
    this.lastCheckTime = 0; // Reset throttle
    return this.checkForUpdates(channel);
  }
}