import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { TestUtils } from '../helpers/test-utils';

describe('CLI Basic Operations', () => {
  let testEnv: any;
  const cliPath = path.join(__dirname, '../../bin/deliberate');
  
  beforeEach(async () => {
    testEnv = await TestUtils.createTestEnvironment();
    // Set HOME to test directory to avoid affecting real config
    process.env.TEST_HOME = testEnv.tempDir;
  });
  
  afterEach(async () => {
    await testEnv.cleanup();
    delete process.env.TEST_HOME;
  });
  
  function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const env = {
        ...process.env,
        HOME: process.env.TEST_HOME,
      };
      
      const child = spawn('node', [cliPath, ...args], {
        env,
        stdio: 'pipe',
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
        });
      });
    });
  }
  
  test('shows help', async () => {
    const result = await runCLI(['--help']);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('deliberate');
    expect(result.stdout).toContain('Intelligent command wrapper');
    expect(result.stdout).toContain('install');
    expect(result.stdout).toContain('config');
    expect(result.stdout).toContain('status');
  });
  
  test('shows version', async () => {
    const result = await runCLI(['--version']);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });
  
  test('status command shows not installed', async () => {
    const result = await runCLI(['status']);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Deliberate Status');
    expect(result.stdout).toContain('Installation:');
    expect(result.stdout).toContain('Not installed');
  });
  
  test('config list works with empty config', async () => {
    const result = await runCLI(['config', '--list']);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('deliberate-rules-v1');
    expect(result.stdout).toContain('safeList');
    expect(result.stdout).toContain('dangerList');
  });
  
  test('config add to safe list', async () => {
    const result = await runCLI(['config', '--safe', 'mytool']);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Added 'mytool' to safe list");
    
    // Verify it was added
    const listResult = await runCLI(['config', '--list']);
    expect(listResult.stdout).toContain('mytool');
  });
  
  test('config add to danger list', async () => {
    const result = await runCLI(['config', '--danger', 'dangerous-tool']);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Added 'dangerous-tool' to danger list");
    
    // Verify it was added
    const listResult = await runCLI(['config', '--list']);
    expect(listResult.stdout).toContain('dangerous-tool');
  });
  
  test('config export and import', async () => {
    // Add some rules
    await runCLI(['config', '--safe', 'tool1']);
    await runCLI(['config', '--danger', 'tool2']);
    
    // Export
    const exportPath = path.join(testEnv.tempDir, 'rules.json');
    const exportResult = await runCLI(['config', '--export', exportPath]);
    expect(exportResult.exitCode).toBe(0);
    
    // Verify export file exists
    const exportContent = await fs.readFile(exportPath, 'utf-8');
    const exported = JSON.parse(exportContent);
    expect(exported.format).toBe('deliberate-rules-v1');
    expect(exported.rules.safeList).toContain('tool1');
    expect(exported.rules.dangerList).toContain('tool2');
    
    // Clear rules by removing them
    await runCLI(['config', '--remove-safe', 'tool1']);
    await runCLI(['config', '--remove-danger', 'tool2']);
    
    // Import back
    const importResult = await runCLI(['config', '--import', exportPath]);
    expect(importResult.exitCode).toBe(0);
    expect(importResult.stdout).toContain('Rules imported successfully');
    
    // Verify imported
    const finalList = await runCLI(['config', '--list']);
    expect(finalList.stdout).toContain('tool1');
    expect(finalList.stdout).toContain('tool2');
  });
  
  test('install command creates shim directory', async () => {
    const result = await runCLI(['install']);
    
    if (result.exitCode !== 0) {
      console.error('Install failed:', result.stderr);
      console.log('Install output:', result.stdout);
    }
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Installing Deliberate');
    expect(result.stdout).toContain('Installation complete');
    
    // Check shim directory was created
    const shimDir = path.join(testEnv.tempDir, '.deliberate', 'shims');
    const exists = await fs.access(shimDir).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});