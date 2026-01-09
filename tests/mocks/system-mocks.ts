import { jest } from '@jest/globals';

export class MockSystemCalls {
  /**
   * Mock isatty() function
   */
  static mockIsatty(value: boolean): jest.Mock {
    const mock = jest.fn(() => value);
    // Would need to mock the actual tty module
    return mock;
  }
  
  /**
   * Mock process tree
   */
  static mockProcessTree(tree: ProcessInfo[]): void {
    // Mock process.ppid and related
    Object.defineProperty(process, 'ppid', {
      value: tree[0]?.pid || 12344,
      writable: true,
      configurable: true,
    });
  }
  
  /**
   * Mock file system stats
   */
  static mockFstat(isPipe: boolean): jest.Mock {
    return jest.fn(() => ({
      isFIFO: () => isPipe,
      isFile: () => !isPipe,
      isDirectory: () => false,
      isSocket: () => false,
    }));
  }
  
  /**
   * Mock environment variables
   */
  static mockEnvironment(vars: Record<string, string>): void {
    const original = { ...process.env };
    
    // Clear and set new vars
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    
    Object.assign(process.env, vars);
    
    // Return cleanup function
    return () => {
      for (const key of Object.keys(process.env)) {
        delete process.env[key];
      }
      Object.assign(process.env, original);
    };
  }
  
  /**
   * Mock child process spawn
   */
  static mockSpawn(): jest.Mock {
    const EventEmitter = require('events');
    
    return jest.fn(() => {
      const child = new EventEmitter();
      child.stdin = {
        write: jest.fn(),
        end: jest.fn(),
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 12345;
      
      // Simulate successful execution after delay
      setTimeout(() => {
        child.emit('close', 0);
      }, 10);
      
      return child;
    });
  }
  
  /**
   * Mock which command
   */
  static mockWhich(paths: Record<string, string>): jest.Mock {
    return jest.fn((cmd: string) => {
      if (paths[cmd]) {
        return Promise.resolve(paths[cmd]);
      }
      return Promise.reject(new Error(`Command not found: ${cmd}`));
    });
  }
  
  /**
   * Mock file operations
   */
  static mockFileOperations() {
    return {
      readFile: jest.fn(() => Promise.resolve('mock file content')),
      writeFile: jest.fn(() => Promise.resolve()),
      mkdir: jest.fn(() => Promise.resolve()),
      rm: jest.fn(() => Promise.resolve()),
      chmod: jest.fn(() => Promise.resolve()),
      access: jest.fn(() => Promise.resolve()),
      stat: jest.fn(() => Promise.resolve({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024,
      })),
    };
  }
  
  /**
   * Mock TTY operations
   */
  static mockTTY() {
    return {
      isatty: jest.fn(() => true),
      openTTY: jest.fn(() => ({
        fd: 3,
        read: jest.fn(),
        write: jest.fn(),
        close: jest.fn(),
      })),
    };
  }
  
  /**
   * Mock timing functions
   */
  static mockTiming() {
    let currentTime = Date.now();
    
    return {
      now: jest.fn(() => currentTime),
      advance: (ms: number) => {
        currentTime += ms;
      },
      reset: () => {
        currentTime = Date.now();
      },
    };
  }
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  cmd: string;
}