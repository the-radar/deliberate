# Deliberate DAST (Dynamic Application Security Testing)

## Overview

This directory contains Dynamic Application Security Testing (DAST) for Deliberate. Unlike traditional unit tests that test code in isolation, DAST tests run against a real, installed instance of Deliberate to verify security controls work in practice.

## What is DAST?

- **Dynamic**: Tests the running application, not just the code
- **Application**: Tests the full application as deployed
- **Security**: Focuses on security vulnerabilities and bypass attempts
- **Testing**: Automated, repeatable test scenarios

## Test Categories

### 1. Bypass Prevention Tests
- Direct binary execution (`/usr/bin/rm`)
- Symlink resolution attacks
- PATH manipulation
- Environment variable injection (LD_PRELOAD)

### 2. Process Wrapping Attacks
- PTY allocation via `script`
- Automation via `expect`
- Terminal emulator bypasses

### 3. Shell Feature Exploits
- Command substitution (`$(cmd)`, `` `cmd` ``)
- Shell function definitions
- Command chaining (`&&`, `||`, `;`)
- Pipeline injection

### 4. Timing Attacks
- Race conditions
- Concurrent bypass attempts
- Cache poisoning

### 5. AI Security
- Auth code reuse prevention
- Code expiration enforcement
- Brute force protection

### 6. Data Protection
- Sensitive data redaction verification
- Audit log security
- Command injection prevention

## Running DAST Tests

### Quick Run
```bash
./tests/dast/run-dast.sh
```

### Manual Run
```bash
# Build first
npm run build

# Run DAST suite
npm test -- tests/dast/security-dast.test.ts --testTimeout=30000
```

### Individual Test Categories
```bash
# Run only bypass tests
npm test -- tests/dast/security-dast.test.ts -t "Bypass"

# Run only AI security tests  
npm test -- tests/dast/security-dast.test.ts -t "AI Agent"
```

## How DAST Works

1. **Setup**: Creates isolated test environment
2. **Install**: Installs Deliberate with test configuration
3. **Attack**: Runs real attack scenarios against the installation
4. **Verify**: Checks that attacks were properly blocked
5. **Cleanup**: Removes test environment

## Benefits of DAST

### Over SAST (Static Testing)
- Tests real runtime behavior
- Catches integration issues
- Verifies actual security posture
- Tests configuration effectiveness

### For Deliberate
- Ensures PATH shims work correctly
- Verifies bypass prevention in practice
- Tests AI integration security
- Validates performance under attack

## Writing New DAST Tests

When adding new security features, add corresponding DAST tests:

```typescript
describe('New Security Feature', () => {
  test('should prevent new attack vector', () => {
    // 1. Set up attack scenario
    const attackVector = prepareAttack();
    
    // 2. Attempt the attack
    const result = attemptBypass(attackVector);
    
    // 3. Verify defense worked
    expect(result).toBeBlocked();
    expect(noSideEffects()).toBe(true);
  });
});
```

## Interpreting Results

### Success ✅
- All attacks were blocked
- No unauthorized operations occurred
- Performance remained acceptable
- Logs show proper security events

### Failure ❌
- An attack succeeded in bypassing controls
- Side effects occurred (files deleted, etc.)
- Performance degraded significantly
- Sensitive data was exposed

## Security Considerations

- DAST tests attempt real attacks - run in isolated environments only
- Never run DAST tests on production systems
- Review test logs for any security events
- Keep DAST tests updated with new attack techniques

## Future Enhancements

1. **Fuzzing Integration**: Add AFL/LibFuzzer for input fuzzing
2. **Mutation Testing**: Verify DAST test effectiveness
3. **Performance Baselines**: Track security overhead
4. **Attack Playbooks**: Industry-standard attack scenarios
5. **CI/CD Integration**: Automatic security gates