import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UpdateManager } from '../../src/system/update-manager';
import { ConfigManager } from '../../src/config/config-manager';

// Mock dependencies
jest.mock('../../src/config/config-manager');
jest.mock('https');

describe('UpdateManager', () => {
  let updateManager: UpdateManager;
  let mockConfig: jest.Mocked<ConfigManager>;
  let tempDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-update-test-'));
    process.env.HOME = tempDir;
    
    // Reset singleton
    (UpdateManager as any).instance = undefined;
    
    // Setup mocks
    mockConfig = {
      getPath: jest.fn().mockImplementation((path: string) => {
        if (path === 'updates.auto_check') return true;
        return undefined;
      })
    } as any;
    (ConfigManager.getInstance as jest.Mock).mockReturnValue(mockConfig);
    
    // Mock package.json
    const packagePath = path.join(__dirname, '..', '..', 'package.json');
    jest.spyOn(fs, 'readFileSync').mockImplementation((filePath: any) => {
      if (filePath === packagePath) {
        return JSON.stringify({ version: '1.0.0' });
      }
      return '';
    });
    
    updateManager = UpdateManager.getInstance();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Version Management', () => {
    it('should get current version', () => {
      const stats = updateManager.getStatistics();
      expect(stats.currentVersion).toBe('1.0.0');
    });
  });

  describe('Update Checking', () => {
    it('should check for updates', async () => {
      const mockUpdateInfo = {
        version: '1.1.0',
        releaseDate: new Date().toISOString(),
        changelog: ['Bug fixes', 'New features'],
        securityFixes: true,
        downloadUrl: 'https://example.com/update.tar.gz',
        checksum: 'abc123',
        signature: 'signature',
        minimumNodeVersion: '14.0.0',
        breakingChanges: false
      };
      
      // Mock HTTPS request
      const https = require('https');
      https.get.mockImplementation((url: string, callback: any) => {
        const mockRes = {
          on: jest.fn((event, handler) => {
            if (event === 'data') {
              handler(JSON.stringify(mockUpdateInfo));
            } else if (event === 'end') {
              handler();
            }
          })
        };
        callback(mockRes);
        return { on: jest.fn() };
      });
      
      const updateInfo = await updateManager.checkForUpdates();
      
      expect(updateInfo).toEqual(mockUpdateInfo);
    });

    it('should respect check throttling', async () => {
      const https = require('https');
      https.get.mockImplementation((url: string, callback: any) => {
        const mockRes = {
          on: jest.fn((event, handler) => {
            if (event === 'data') handler('{}');
            if (event === 'end') handler();
          })
        };
        callback(mockRes);
        return { on: jest.fn() };
      });
      
      await updateManager.checkForUpdates();
      const result = await updateManager.checkForUpdates();
      
      expect(result).toBeNull(); // Should be throttled
    });

    it('should handle check failures gracefully', async () => {
      const https = require('https');
      https.get.mockImplementation(() => {
        return {
          on: jest.fn((event, handler) => {
            if (event === 'error') {
              handler(new Error('Network error'));
            }
          })
        };
      });
      
      const result = await updateManager.checkForUpdates();
      
      expect(result).toBeNull();
    });
  });

  describe('Update Channels', () => {
    it('should support multiple update channels', async () => {
      const stats = updateManager.getStatistics();
      
      expect(stats.channels).toContain('stable');
      expect(stats.channels).toContain('beta');
      expect(stats.channels).toContain('nightly');
    });

    it('should check updates from specified channel', async () => {
      const https = require('https');
      let requestedUrl: string = '';
      
      https.get.mockImplementation((url: string, callback: any) => {
        requestedUrl = url;
        const mockRes = {
          on: jest.fn((event, handler) => {
            if (event === 'data') handler('{}');
            if (event === 'end') handler();
          })
        };
        callback(mockRes);
        return { on: jest.fn() };
      });
      
      await updateManager.checkForUpdates('beta');
      
      expect(requestedUrl).toContain('beta');
    });
  });

  describe('Update Installation', () => {
    let mockUpdateInfo: any;

    beforeEach(() => {
      mockUpdateInfo = {
        version: '1.1.0',
        releaseDate: new Date().toISOString(),
        changelog: ['Bug fixes'],
        securityFixes: false,
        downloadUrl: 'https://example.com/update.tar.gz',
        checksum: 'valid-checksum',
        signature: 'valid-signature',
        minimumNodeVersion: '14.0.0',
        breakingChanges: false
      };
    });

    it('should emit install events', async () => {
      const events: string[] = [];
      
      updateManager.on('install-started', () => events.push('started'));
      updateManager.on('download-progress', () => events.push('progress'));
      updateManager.on('install-completed', () => events.push('completed'));
      
      // Mock download and installation
      const https = require('https');
      https.get.mockImplementation((url: string, callback: any) => {
        const mockRes = {
          headers: { 'content-length': '1000' },
          on: jest.fn((event, handler) => {
            if (event === 'data') handler(Buffer.from('mock-data'));
          }),
          pipe: jest.fn()
        };
        callback(mockRes);
        return { on: jest.fn() };
      });
      
      // Mock file operations
      jest.spyOn(fs, 'createWriteStream').mockReturnValue({
        on: jest.fn((event, handler) => {
          if (event === 'finish') setTimeout(handler, 10);
        }),
        close: jest.fn()
      } as any);
      
      // Mock checksum verification
      (updateManager as any).verifyChecksum = jest.fn().mockResolvedValue(true);
      (updateManager as any).createBackup = jest.fn().mockResolvedValue('/backup');
      (updateManager as any).applyUpdate = jest.fn().mockResolvedValue(undefined);
      
      await updateManager.installUpdate(mockUpdateInfo);
      
      expect(events).toContain('started');
      expect(events).toContain('completed');
    });

    it('should verify checksum before installation', async () => {
      const verifySpy = jest.spyOn(updateManager as any, 'verifyChecksum')
        .mockResolvedValue(false);
      
      await expect(updateManager.installUpdate(mockUpdateInfo))
        .rejects.toThrow('Checksum verification failed');
      
      expect(verifySpy).toHaveBeenCalled();
    });

    it('should create backup before update', async () => {
      const backupSpy = jest.spyOn(updateManager as any, 'createBackup')
        .mockResolvedValue('/backup/path');
      
      (updateManager as any).downloadUpdate = jest.fn().mockResolvedValue('/download/path');
      (updateManager as any).verifyChecksum = jest.fn().mockResolvedValue(true);
      (updateManager as any).applyUpdate = jest.fn().mockResolvedValue(undefined);
      
      await updateManager.installUpdate(mockUpdateInfo);
      
      expect(backupSpy).toHaveBeenCalled();
    });

    it('should rollback on failure', async () => {
      const rollbackSpy = jest.spyOn(updateManager as any, 'rollback')
        .mockResolvedValue(undefined);
      
      (updateManager as any).downloadUpdate = jest.fn().mockResolvedValue('/download/path');
      (updateManager as any).verifyChecksum = jest.fn().mockResolvedValue(true);
      (updateManager as any).createBackup = jest.fn().mockResolvedValue('/backup/path');
      (updateManager as any).applyUpdate = jest.fn().mockRejectedValue(new Error('Apply failed'));
      
      await expect(updateManager.installUpdate(mockUpdateInfo))
        .rejects.toThrow('Apply failed');
      
      expect(rollbackSpy).toHaveBeenCalledWith('/backup/path');
    });
  });

  describe('Automatic Updates', () => {
    it('should schedule automatic checks when enabled', () => {
      // Fast-forward initial check timer
      jest.advanceTimersByTime(5 * 60 * 1000);
      
      const https = require('https');
      expect(https.get).toHaveBeenCalled();
    });

    it('should not schedule checks when disabled', () => {
      mockConfig.getPath.mockReturnValue(false);
      
      // Create new instance with auto-update disabled
      (UpdateManager as any).instance = undefined;
      updateManager = UpdateManager.getInstance();
      
      jest.advanceTimersByTime(5 * 60 * 1000);
      
      const https = require('https');
      expect(https.get).not.toHaveBeenCalled();
    });
  });

  describe('Statistics', () => {
    it('should provide update statistics', async () => {
      // Perform a check
      const https = require('https');
      https.get.mockImplementation((url: string, callback: any) => {
        const mockRes = {
          on: jest.fn((event, handler) => {
            if (event === 'data') handler('{"version": "1.1.0"}');
            if (event === 'end') handler();
          })
        };
        callback(mockRes);
        return { on: jest.fn() };
      });
      
      await updateManager.checkForUpdates();
      
      const stats = updateManager.getStatistics();
      
      expect(stats.currentVersion).toBe('1.0.0');
      expect(stats.lastCheckTime).toBeTruthy();
      expect(stats.isUpdating).toBe(false);
      expect(stats.channels).toHaveLength(3);
      expect(stats.autoUpdateEnabled).toBe(true);
    });
  });
});