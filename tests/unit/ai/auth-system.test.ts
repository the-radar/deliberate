import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { AgentAuthSystem } from '../../../src/ai/auth-system';

describe('AgentAuthSystem', () => {
  let authSystem: AgentAuthSystem;
  
  beforeEach(() => {
    authSystem = new AgentAuthSystem();
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  describe('generateAuthCode', () => {
    test('should generate readable auth codes', () => {
      const code = authSystem.generateAuthCode('rm', ['-rf', '/tmp/test'], {
        verdict: 'WARN',
        risks: ['Deletes files']
      });
      
      // Should match pattern: adjective-noun-number
      expect(code).toMatch(/^[a-z]+-[a-z]+-\d{1,2}$/);
    });
    
    test('should generate unique codes', () => {
      const codes = new Set<string>();
      
      // Generate 10 codes
      for (let i = 0; i < 10; i++) {
        const code = authSystem.generateAuthCode('ls', [], {});
        codes.add(code);
      }
      
      // Should all be unique
      expect(codes.size).toBe(10);
    });
    
    test('should store auth data with code', () => {
      const command = 'git';
      const args = ['push', 'origin', 'main'];
      const analysis = {
        verdict: 'WARN',
        risks: ['Pushes to remote'],
        explanation: 'May expose code'
      };
      
      const code = authSystem.generateAuthCode(command, args, analysis);
      const validation = authSystem.validateAuthCode(code);
      
      expect(validation.valid).toBe(true);
      expect(validation.data?.command).toBe(command);
      expect(validation.data?.args).toEqual(args);
      expect(validation.data?.analysis).toMatchObject(analysis);
    });
  });
  
  describe('validateAuthCode', () => {
    test('should validate valid auth code', () => {
      const code = authSystem.generateAuthCode('ls', ['-la'], {});
      const result = authSystem.validateAuthCode(code);
      
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.used).toBe(true); // Marked as used after validation
    });
    
    test('should reject invalid auth code', () => {
      const result = authSystem.validateAuthCode('invalid-code-99');
      
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid or expired');
    });
    
    test('should reject already used auth code', () => {
      const code = authSystem.generateAuthCode('ls', [], {});
      
      // First use should succeed
      const result1 = authSystem.validateAuthCode(code);
      expect(result1.valid).toBe(true);
      
      // Second use should fail
      const result2 = authSystem.validateAuthCode(code);
      expect(result2.valid).toBe(false);
      expect(result2.reason).toContain('already used');
    });
    
    test('should reject expired auth code', () => {
      const code = authSystem.generateAuthCode('ls', [], {});
      
      // Fast forward past expiry time (5 minutes)
      jest.advanceTimersByTime(6 * 60 * 1000);
      
      const result = authSystem.validateAuthCode(code);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });
  });
  
  describe('cleanup', () => {
    test('should remove expired codes', () => {
      // Generate some codes
      const code1 = authSystem.generateAuthCode('ls', [], {});
      const code2 = authSystem.generateAuthCode('pwd', [], {});
      
      // Fast forward 3 minutes (code1 still valid)
      jest.advanceTimersByTime(3 * 60 * 1000);
      
      const code3 = authSystem.generateAuthCode('echo', [], {});
      
      // Fast forward another 3 minutes (code1 and code2 expired)
      jest.advanceTimersByTime(3 * 60 * 1000);
      
      authSystem.cleanup();
      
      // Code1 and code2 should be invalid
      expect(authSystem.validateAuthCode(code1).valid).toBe(false);
      expect(authSystem.validateAuthCode(code2).valid).toBe(false);
      
      // Code3 should still be valid
      expect(authSystem.validateAuthCode(code3).valid).toBe(true);
    });
  });
  
  describe('getActiveCodesCount', () => {
    test('should return count of active codes', () => {
      expect(authSystem.getActiveCodesCount()).toBe(0);
      
      authSystem.generateAuthCode('ls', [], {});
      authSystem.generateAuthCode('pwd', [], {});
      
      expect(authSystem.getActiveCodesCount()).toBe(2);
      
      // Fast forward to expire all codes
      jest.advanceTimersByTime(6 * 60 * 1000);
      
      expect(authSystem.getActiveCodesCount()).toBe(0);
    });
  });
  
  describe('auto-expiry', () => {
    test('should automatically expire codes after timeout', () => {
      const code = authSystem.generateAuthCode('rm', ['-rf'], {});
      
      // Should be valid initially
      expect(authSystem.validateAuthCode(code).valid).toBe(true);
      
      // Fast forward to just before expiry
      jest.advanceTimersByTime(5 * 60 * 1000 - 1000);
      
      // Reset used flag for testing
      const data = (authSystem as any).authCodes.get(code);
      if (data) data.used = false;
      
      // Should still be valid
      expect(authSystem.validateAuthCode(code).valid).toBe(true);
      
      // Fast forward past expiry
      jest.advanceTimersByTime(2000);
      
      // Should be invalid
      expect(authSystem.validateAuthCode(code).valid).toBe(false);
    });
  });
});