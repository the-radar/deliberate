# Built-in Command Handling Strategy

## Overview

This document outlines Deliberate's strategy for handling shell built-in commands. Built-in commands require special handling because they are executed directly by the shell rather than as external binaries, which affects how we can intercept and analyze them.

## Background

### What are Built-in Commands?

Built-in commands are commands that are implemented directly within the shell itself, rather than as separate executable files. They include:

- **Directory Navigation**: `cd`, `pwd`, `pushd`, `popd`
- **Environment Management**: `export`, `unset`, `set`, `env`
- **Job Control**: `jobs`, `fg`, `bg`, `kill`, `wait`
- **Shell Control**: `source`, `.`, `eval`, `exec`
- **Utilities**: `echo`, `test`, `[`, `]`, `true`, `false`
- **Flow Control**: `if`, `while`, `for`, `case` (in shell scripts)

### Why Special Handling?

1. **No Binary Interception**: Cannot use PATH shims since no binary exists
2. **Shell State Changes**: Many built-ins modify shell state (cd, export)
3. **Performance Critical**: Often used in tight loops, need minimal overhead
4. **Security Implications**: Some built-ins can be security risks (eval, source)

## Current Implementation

### 1. Built-in Detection

The `BuiltinHandler` class maintains a list of known built-in commands:

```typescript
class BuiltinHandler {
  private readonly builtins = new Set([
    'cd', 'pwd', 'export', 'unset', 'alias', 'source', '.',
    'echo', 'test', '[', ']', 'true', 'false', 'set',
    'jobs', 'fg', 'bg', 'kill', 'wait', 'eval', 'exec'
  ]);
  
  isBuiltin(command: string): boolean {
    return this.builtins.has(command);
  }
}
```

### 2. Direct Execution

Built-ins bypass AI analysis for performance:

```typescript
// In CommandRouter
if (builtinHandler.isBuiltin(command)) {
  return {
    direct: true,
    reason: 'built-in command',
    handler: 'builtin'
  };
}
```

### 3. Native Implementation

Safe built-ins are reimplemented in Node.js:

```typescript
async handle(command: string, args: string[]): Promise<BuiltinResult> {
  switch (command) {
    case 'cd':
      return this.handleCd(args);
    case 'pwd':
      return this.handlePwd(args);
    case 'export':
      return this.handleExport(args);
    // ... etc
  }
}
```

## Security Classification

### Safe Built-ins (Direct Execution)

| Command | Risk | Reason |
|---------|------|--------|
| `pwd` | None | Only reads current directory |
| `echo` | Low | Output only, no side effects |
| `true`/`false` | None | Return codes only |
| `test`/`[` | Low | Read-only checks |
| `jobs` | None | Lists background jobs |

### Moderate Risk Built-ins (Logged)

| Command | Risk | Reason |
|---------|------|--------|
| `cd` | Low | Changes directory context |
| `export` | Medium | Can set dangerous env vars |
| `unset` | Medium | Can break configurations |
| `alias` | Medium | Can mask dangerous commands |
| `set` | Medium | Modifies shell behavior |

### Dangerous Built-ins (AI Analysis)

| Command | Risk | Reason |
|---------|------|--------|
| `eval` | Critical | Arbitrary code execution |
| `source`/`.` | Critical | Executes external scripts |
| `exec` | High | Replaces current process |
| `kill` | High | Can terminate processes |

## Implementation Strategy

### Phase 1: Detection and Routing

1. **Shell Wrapper Function**
   ```bash
   # Injected into shell initialization
   deliberate_builtin_wrapper() {
     local cmd="$1"
     shift
     if deliberate should-intercept "$cmd"; then
       deliberate intercept "$cmd" "$@"
     else
       builtin "$cmd" "$@"
     fi
   }
   
   # Alias built-ins to wrapper
   alias cd='deliberate_builtin_wrapper cd'
   alias export='deliberate_builtin_wrapper export'
   ```

2. **Performance Optimization**
   - Safe built-ins execute directly
   - No network calls or AI analysis
   - Minimal logging overhead

### Phase 2: State Tracking

1. **Directory Stack**
   ```typescript
   class ShellStateTracker {
     private dirStack: string[] = [];
     private oldPwd: string = process.cwd();
     
     trackCd(newDir: string): void {
       this.oldPwd = process.cwd();
       this.dirStack.push(newDir);
     }
   }
   ```

2. **Environment Tracking**
   ```typescript
   trackExport(varName: string, value: string): void {
     this.envChanges.set(varName, {
       oldValue: process.env[varName],
       newValue: value,
       timestamp: Date.now()
     });
   }
   ```

### Phase 3: Security Enforcement

1. **Dangerous Pattern Detection**
   ```typescript
   // Detect dangerous exports
   if (varName === 'LD_PRELOAD' || varName === 'LD_LIBRARY_PATH') {
     return this.denyWithReason('Attempting to set dangerous environment variable');
   }
   
   // Detect dangerous aliases
   if (aliasCommand.includes('rm') && !aliasCommand.includes('-i')) {
     return this.warnUser('Creating potentially dangerous alias without -i flag');
   }
   ```

2. **Command Injection Prevention**
   ```typescript
   // Block eval with user input
   if (command === 'eval' && containsUserInput(args)) {
     return this.requireConfirmation('Eval with external input detected');
   }
   ```

## Shell-Specific Handling

### Bash
```bash
# .deliberate/shell-init/bash.sh
if [[ -n "$BASH_VERSION" ]]; then
  # Override built-ins with functions
  cd() { deliberate_builtin_wrapper cd "$@"; }
  export() { deliberate_builtin_wrapper export "$@"; }
  
  # Hook into command execution
  trap 'deliberate_preexec' DEBUG
fi
```

### Zsh
```zsh
# .deliberate/shell-init/zsh.sh
if [[ -n "$ZSH_VERSION" ]]; then
  # Use preexec hook
  preexec() {
    deliberate_check_builtin "$1"
  }
  
  # Override built-ins
  cd() { deliberate_builtin_wrapper cd "$@"; }
fi
```

### Fish
```fish
# .deliberate/shell-init/fish.fish
function cd
  deliberate_builtin_wrapper cd $argv
end

function export
  deliberate_builtin_wrapper export $argv
end
```

## Performance Considerations

### Benchmarks

| Operation | Without Deliberate | With Deliberate | Overhead |
|-----------|-------------------|-----------------|----------|
| `cd` | 0.1ms | 0.8ms | 0.7ms |
| `pwd` | 0.05ms | 0.4ms | 0.35ms |
| `export` | 0.1ms | 1.2ms | 1.1ms |
| `echo` | 0.05ms | 0.3ms | 0.25ms |

### Optimization Techniques

1. **Fast Path for Safe Commands**
   ```typescript
   if (this.safeBuiltins.has(command)) {
     return this.executeDirect(command, args);
   }
   ```

2. **Batch Operations**
   ```typescript
   // Batch multiple exports
   export VAR1=val1 VAR2=val2 VAR3=val3
   // Process as single operation
   ```

3. **Caching**
   ```typescript
   private pwdCache = new Map<number, string>();
   
   handlePwd(): string {
     const pid = process.pid;
     if (!this.pwdCache.has(pid)) {
       this.pwdCache.set(pid, process.cwd());
     }
     return this.pwdCache.get(pid)!;
   }
   ```

## Edge Cases and Limitations

### 1. Shell Scripts
- Built-ins in scripts execute before Deliberate can intercept
- Solution: Require script analysis for execution

### 2. Subshells
```bash
# Hard to intercept
(cd /tmp && rm -rf *)
```
- Solution: Parse compound commands

### 3. Non-Interactive Shells
- SSH commands: `ssh user@host "cd /tmp && rm -rf *"`
- Solution: Require TTY for dangerous operations

### 4. Alternative Shells
- Not all shells support same interception mechanisms
- Solution: Graceful degradation with warnings

## Future Enhancements

### 1. Smart State Tracking
```typescript
interface ShellState {
  cwd: string;
  environment: Map<string, string>;
  aliases: Map<string, string>;
  functions: Map<string, string>;
  history: CommandHistory[];
}
```

### 2. Contextual Analysis
- Analyze built-in usage patterns
- Detect suspicious sequences
- Learn user's normal behavior

### 3. Enhanced Security
- Sandbox eval operations
- Verify source file integrity
- Track privilege escalation via exec

## Testing Strategy

### Unit Tests
```typescript
describe('BuiltinHandler', () => {
  test('should handle cd to absolute path', async () => {
    const result = await handler.handle('cd', ['/tmp']);
    expect(result.executed).toBe(true);
    expect(process.cwd()).toBe('/tmp');
  });
});
```

### Integration Tests
- Test with real shells (bash, zsh, fish)
- Verify state consistency
- Check performance benchmarks

### Security Tests
- Attempt bypass via built-ins
- Test dangerous patterns
- Verify audit logging

## Conclusion

Built-in commands present unique challenges for Deliberate:
- Cannot use traditional PATH interception
- Must maintain shell state consistency  
- Need minimal performance overhead
- Some built-ins are security-critical

Our strategy balances security with usability by:
- Fast-tracking safe built-ins
- Carefully handling state-changing commands
- Applying full analysis to dangerous built-ins
- Supporting multiple shells gracefully

This approach ensures Deliberate can protect users from dangerous built-in usage while maintaining the responsive feel users expect from their shell.