import * as path from 'path';
import * as fs from 'fs/promises';

export interface BuiltinCommand {
  name: string;
  handler: (args: string[]) => Promise<BuiltinResult>;
  description: string;
  dangerous: boolean;
}

export interface BuiltinResult {
  handled: boolean;
  output?: string;
  error?: string;
  exitCode: number;
}

export class BuiltinCommandHandler {
  private commands: Map<string, BuiltinCommand> = new Map();
  
  constructor() {
    this.registerBuiltins();
  }
  
  /**
   * Check if command is a shell builtin
   */
  isBuiltin(command: string): boolean {
    return this.commands.has(command) || this.isShellBuiltin(command);
  }
  
  /**
   * Handle builtin command
   */
  async handle(command: string, args: string[]): Promise<BuiltinResult> {
    // Check custom builtins first
    const builtin = this.commands.get(command);
    if (builtin) {
      try {
        return await builtin.handler(args);
      } catch (error) {
        return {
          handled: true,
          error: error instanceof Error ? error.message : 'Unknown error',
          exitCode: 1
        };
      }
    }
    
    // Handle shell builtins
    if (this.isShellBuiltin(command)) {
      return this.handleShellBuiltin(command, args);
    }
    
    return { handled: false, exitCode: 0 };
  }
  
  /**
   * Register custom builtin commands
   */
  private registerBuiltins(): void {
    // cd - change directory
    this.commands.set('cd', {
      name: 'cd',
      description: 'Change working directory',
      dangerous: false,
      handler: async (args: string[]) => {
        const dir = args[0] || process.env.HOME || '/';
        
        try {
          // Resolve path
          const resolvedPath = path.resolve(dir);
          
          // Check if directory exists
          const stats = await fs.stat(resolvedPath);
          if (!stats.isDirectory()) {
            return {
              handled: true,
              error: `cd: ${dir}: Not a directory`,
              exitCode: 1
            };
          }
          
          // Change directory
          process.chdir(resolvedPath);
          
          return {
            handled: true,
            output: `Changed directory to: ${resolvedPath}`,
            exitCode: 0
          };
        } catch (error) {
          return {
            handled: true,
            error: `cd: ${dir}: No such file or directory`,
            exitCode: 1
          };
        }
      }
    });
    
    // export - set environment variable
    this.commands.set('export', {
      name: 'export',
      description: 'Set environment variables',
      dangerous: true,
      handler: async (args: string[]) => {
        if (args.length === 0) {
          // List all exports
          const exports = Object.entries(process.env)
            .map(([key, value]) => `export ${key}="${value}"`)
            .join('\n');
          
          return {
            handled: true,
            output: exports,
            exitCode: 0
          };
        }
        
        // Parse export command
        for (const arg of args) {
          const match = arg.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
          if (match) {
            const [, name, value] = match;
            if (name && value !== undefined) {
              process.env[name] = value.replace(/^["']|["']$/g, '');
            }
          }
        }
        
        return {
          handled: true,
          exitCode: 0
        };
      }
    });
    
    // unset - remove environment variable
    this.commands.set('unset', {
      name: 'unset',
      description: 'Remove environment variables',
      dangerous: true,
      handler: async (args: string[]) => {
        for (const varName of args) {
          delete process.env[varName];
        }
        
        return {
          handled: true,
          exitCode: 0
        };
      }
    });
    
    // alias - manage command aliases
    this.commands.set('alias', {
      name: 'alias',
      description: 'Manage command aliases',
      dangerous: false,
      handler: async (args: string[]) => {
        // Simple alias listing for now
        if (args.length === 0) {
          return {
            handled: true,
            output: 'No aliases defined',
            exitCode: 0
          };
        }
        
        return {
          handled: true,
          output: 'Alias management not fully implemented',
          exitCode: 0
        };
      }
    });
    
    // history - command history
    this.commands.set('history', {
      name: 'history',
      description: 'Show command history',
      dangerous: false,
      handler: async (_args: string[]) => {
        // Would integrate with shell history
        return {
          handled: true,
          output: 'History not available in current context',
          exitCode: 0
        };
      }
    });
  }
  
  /**
   * Check if command is a shell builtin
   */
  private isShellBuiltin(command: string): boolean {
    const shellBuiltins = [
      'cd', 'pwd', 'export', 'unset', 'alias', 'unalias',
      'source', '.', 'eval', 'exec', 'exit', 'return',
      'break', 'continue', 'shift', 'times', 'trap',
      'type', 'hash', 'help', 'history', 'jobs', 'fg', 'bg',
      'wait', 'suspend', 'test', '[', 'command', 'builtin',
      'enable', 'disable', 'local', 'declare', 'typeset',
      'readonly', 'getopts', 'read', 'echo', 'printf',
      'let', 'ulimit', 'umask', 'set', 'shopt'
    ];
    
    return shellBuiltins.includes(command);
  }
  
  /**
   * Handle shell builtins that require special treatment
   */
  private async handleShellBuiltin(command: string, args: string[]): Promise<BuiltinResult> {
    // For most shell builtins, we need to execute them in the shell context
    // This is a simplified handler - full implementation would integrate with shell
    
    switch (command) {
      case 'pwd':
        return {
          handled: true,
          output: process.cwd(),
          exitCode: 0
        };
        
      case 'echo':
        return {
          handled: true,
          output: args.join(' '),
          exitCode: 0
        };
        
      case 'test':
      case '[':
        // Basic test implementation
        return this.handleTest(args);
        
      default:
        // For other builtins, indicate they need shell execution
        return {
          handled: false,
          exitCode: 0
        };
    }
  }
  
  /**
   * Basic test/[ command implementation
   */
  private async handleTest(args: string[]): Promise<BuiltinResult> {
    // Remove closing ] if present
    const testArgs = args[args.length - 1] === ']' ? args.slice(0, -1) : args;
    
    if (testArgs.length === 0) {
      return { handled: true, exitCode: 1 };
    }
    
    // Basic file tests
    if (testArgs.length === 2) {
      const [flag, file] = testArgs;
      
      if (!file) {
        return { handled: true, exitCode: 1 };
      }
      
      try {
        const stats = await fs.stat(file);
        
        switch (flag) {
          case '-e': // exists
            return { handled: true, exitCode: 0 };
          case '-f': // is file
            return { handled: true, exitCode: stats.isFile() ? 0 : 1 };
          case '-d': // is directory
            return { handled: true, exitCode: stats.isDirectory() ? 0 : 1 };
          case '-r': // is readable
            return { handled: true, exitCode: 0 }; // Simplified
          case '-w': // is writable
            return { handled: true, exitCode: 0 }; // Simplified
          case '-x': // is executable
            return { handled: true, exitCode: 0 }; // Simplified
        }
      } catch {
        return { handled: true, exitCode: 1 };
      }
    }
    
    // String comparisons
    if (testArgs.length === 3) {
      const [left, op, right] = testArgs;
      
      switch (op) {
        case '=':
        case '==':
          return { handled: true, exitCode: left === right ? 0 : 1 };
        case '!=':
          return { handled: true, exitCode: left !== right ? 0 : 1 };
      }
    }
    
    return { handled: true, exitCode: 1 };
  }
  
  /**
   * Get list of dangerous builtins
   */
  getDangerousBuiltins(): string[] {
    return [
      'eval', 'exec', 'source', '.', 'export',
      'unset', 'set', 'trap', 'enable', 'disable'
    ];
  }
}