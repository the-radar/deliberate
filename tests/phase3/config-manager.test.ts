import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager } from '../../src/config/config-manager';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let tempDir: string;
  let userConfigPath: string;
  let systemConfigPath: string;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-config-test-'));
    process.env.HOME = tempDir;
    
    // Setup config paths
    userConfigPath = path.join(tempDir, '.deliberate', 'config.json');
    systemConfigPath = path.join('/etc', 'deliberate', 'config.json');
    
    // Reset singleton
    (ConfigManager as any).instance = undefined;
    
    // Create config directory
    fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
    
    configManager = ConfigManager.getInstance();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Configuration Loading', () => {
    it('should load default configuration', () => {
      const config = configManager.getConfig();
      
      expect(config).toBeDefined();
      expect(config.version).toBe('1.0');
      expect(config.security).toBeDefined();
      expect(config.ai).toBeDefined();
    });

    it('should load user configuration', () => {
      const userConfig = {
        security: {
          paranoid_mode: true
        }
      };
      
      fs.writeFileSync(userConfigPath, JSON.stringify(userConfig));
      
      // Reload config
      (ConfigManager as any).instance = undefined;
      configManager = ConfigManager.getInstance();
      
      expect(configManager.getPath('security.paranoid_mode')).toBe(true);
    });

    it('should merge configurations correctly', () => {
      const userConfig = {
        security: {
          paranoid_mode: true
        },
        custom: {
          setting: 'value'
        }
      };
      
      fs.writeFileSync(userConfigPath, JSON.stringify(userConfig));
      
      // Reload
      (ConfigManager as any).instance = undefined;
      configManager = ConfigManager.getInstance();
      
      // User config should override defaults
      expect(configManager.getPath('security.paranoid_mode')).toBe(true);
      // Custom settings should be added
      expect(configManager.getPath('custom.setting')).toBe('value');
      // Default settings should remain
      expect(configManager.getPath('security.require_tty')).toBeDefined();
    });
  });

  describe('YAML Support', () => {
    it('should load YAML configuration', () => {
      const yamlContent = `
security:
  paranoid_mode: true
  blocked_commands:
    - rm -rf /
    - dd if=/dev/zero
ai:
  enable_llm_analysis: true
  models:
    - name: qwen2
      enabled: true
`;
      
      const yamlPath = path.join(tempDir, '.deliberate', 'config.yaml');
      fs.writeFileSync(yamlPath, yamlContent);
      
      // Remove JSON config to force YAML loading
      if (fs.existsSync(userConfigPath)) {
        fs.unlinkSync(userConfigPath);
      }
      
      // Reload
      (ConfigManager as any).instance = undefined;
      configManager = ConfigManager.getInstance();
      
      expect(configManager.getPath('security.paranoid_mode')).toBe(true);
      expect(configManager.getPath('security.blocked_commands')).toHaveLength(2);
      expect(configManager.getPath('ai.models.0.name')).toBe('qwen2');
    });
  });

  describe('Path-based Access', () => {
    it('should get nested values by path', () => {
      expect(configManager.getPath('security.require_tty')).toBe(true);
      expect(configManager.getPath('ai.timeout_ms')).toBe(5000);
      expect(configManager.getPath('performance.cache_ttl_ms')).toBe(300000);
    });

    it('should return undefined for non-existent paths', () => {
      expect(configManager.getPath('non.existent.path')).toBeUndefined();
    });

    it('should return default value for non-existent paths', () => {
      expect(configManager.getPath('non.existent', 'default')).toBe('default');
    });

    it('should handle array access', () => {
      configManager.setPath('test.array', ['a', 'b', 'c']);
      
      expect(configManager.getPath('test.array.0')).toBe('a');
      expect(configManager.getPath('test.array.2')).toBe('c');
    });
  });

  describe('Configuration Updates', () => {
    it('should set values by path', () => {
      configManager.setPath('test.nested.value', 42);
      
      expect(configManager.getPath('test.nested.value')).toBe(42);
    });

    it('should create nested paths', () => {
      configManager.setPath('deeply.nested.path.to.value', 'test');
      
      expect(configManager.getPath('deeply.nested.path.to.value')).toBe('test');
      expect(configManager.getPath('deeply.nested')).toBeDefined();
    });

    it('should save configuration', async () => {
      configManager.setPath('test.save', true);
      await configManager.save();
      
      // Verify file was written
      const savedContent = fs.readFileSync(userConfigPath, 'utf-8');
      const saved = JSON.parse(savedContent);
      
      expect(saved.test.save).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should validate configuration against schema', () => {
      const invalidConfig = {
        security: {
          require_tty: 'not-a-boolean' // Should be boolean
        }
      };
      
      fs.writeFileSync(userConfigPath, JSON.stringify(invalidConfig));
      
      // Should fall back to defaults on invalid config
      (ConfigManager as any).instance = undefined;
      configManager = ConfigManager.getInstance();
      
      expect(configManager.getPath('security.require_tty')).toBe(true);
    });
  });

  describe('Configuration Export', () => {
    it('should export current configuration', () => {
      configManager.setPath('export.test', 'value');
      
      const exported = configManager.exportConfig();
      
      expect(exported).toBeDefined();
      expect(exported.export.test).toBe('value');
    });

    it('should export to YAML format', () => {
      configManager.setPath('yaml.export', true);
      
      const yamlExport = configManager.exportConfig('yaml');
      
      expect(yamlExport).toContain('yaml:');
      expect(yamlExport).toContain('export: true');
    });
  });

  describe('Environment Variable Override', () => {
    it('should allow environment variables to override config', () => {
      process.env.DELIBERATE_SECURITY_PARANOID_MODE = 'true';
      
      // Reload to pick up env vars
      (ConfigManager as any).instance = undefined;
      configManager = ConfigManager.getInstance();
      
      expect(configManager.getPath('security.paranoid_mode')).toBe(true);
      
      delete process.env.DELIBERATE_SECURITY_PARANOID_MODE;
    });
  });

  describe('Config File Watching', () => {
    it('should emit change events when config file changes', (done) => {
      configManager.once('config-changed', (changes) => {
        expect(changes).toBeDefined();
        done();
      });
      
      // Modify config file
      const config = configManager.exportConfig();
      config.test = { changed: true };
      fs.writeFileSync(userConfigPath, JSON.stringify(config));
    });
  });
});