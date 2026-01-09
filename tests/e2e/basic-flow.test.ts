import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { CommandInterceptor } from '../../src/core/interception/interceptor';
import { TTYSecurity } from '../../src/core/security/tty-security';
import { BypassPrevention } from '../../src/core/security/bypass-prevention';
import { CommandClassifier } from '../../src/core/classification/classifier';
import { UserManager } from '../../src/core/classification/user-manager';
import { SensitiveDataRedactor } from '../../src/core/redaction/redactor';
import { CommandRouter } from '../../src/core/routing/router';
import { ConfigManager } from '../../src/config/config-manager';
import { SecureAuditLogger } from '../../src/audit/audit-logger';
import { LearningDataCollector } from '../../src/learning/data-collector';

describe('Basic E2E Flow', () => {
  let tempDir: string;
  let interceptor: CommandInterceptor;
  let ttySecurity: TTYSecurity;
  let bypassPrevention: BypassPrevention;
  let classifier: CommandClassifier;
  let userManager: UserManager;
  let redactor: SensitiveDataRedactor;
  let router: CommandRouter;

  beforeEach(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-test-'));
    
    // Initialize components
    ttySecurity = new TTYSecurity();
    bypassPrevention = new BypassPrevention();
    classifier = new CommandClassifier();
    userManager = UserManager.getInstance();
    redactor = new SensitiveDataRedactor();
    router = new CommandRouter();
    
    interceptor = new CommandInterceptor(
      classifier,
      ttySecurity,
      bypassPrevention,
      redactor,
      router
    );
  });

  afterEach(() => {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should allow safe commands without intervention', async () => {
    const result = await interceptor.intercept('ls', ['-la']);
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  test('should block dangerous commands by default', async () => {
    const result = await interceptor.intercept('rm', ['-rf', '/']);
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.classification?.riskLevel).toBe('critical');
  });

  test('should redact sensitive data', async () => {
    const result = await interceptor.intercept('curl', [
      '-H',
      'Authorization: Bearer sk-1234567890abcdef',
      'https://api.example.com'
    ]);
    
    expect(result.classification?.redactedArgs).toContain('[REDACTED_API_KEY]');
    expect(result.classification?.redactedArgs).not.toContain('sk-1234567890abcdef');
  });

  test('should respect user preferences', async () => {
    // Add rm to safe commands for this test
    await userManager.addUserPattern('rm', 'safe');
    
    const result = await interceptor.intercept('rm', ['test.txt']);
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
    
    // Cleanup
    await userManager.removeUserPattern('rm', 'safe');
  });

  test('should log audit events', async () => {
    const auditLogger = SecureAuditLogger.getInstance();
    const learningCollector = LearningDataCollector.getInstance();
    
    // Spy on log method
    const logSpy = jest.spyOn(auditLogger, 'log');
    const recordSpy = jest.spyOn(learningCollector, 'recordEvent');
    
    await interceptor.intercept('echo', ['test']);
    
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'command_execution',
        command: 'echo'
      })
    );
    
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'echo',
        args: ['test']
      })
    );
  });

  test('should handle command chains', async () => {
    const result = await interceptor.intercept('sh', [
      '-c',
      'ls && rm -rf /'
    ]);
    
    expect(result.allowed).toBe(false);
    expect(result.classification?.risks).toContain('Command chain detected');
  });

  test('should detect bypass attempts', async () => {
    // Mock a bypass attempt
    process.env.LD_PRELOAD = '/tmp/evil.so';
    
    await expect(
      interceptor.intercept('ls', [])
    ).rejects.toThrow('Security check failed');
    
    // Cleanup
    delete process.env.LD_PRELOAD;
  });
});