#!/usr/bin/env ts-node

import { MockOllamaServer } from './helpers/mock-ollama-server';
import { spawn } from 'child_process';
import * as path from 'path';

async function runTests() {
  console.log('🤖 Starting AI Test Suite with Mock Ollama Server...\n');
  
  // Start mock Ollama servers on different ports
  const servers = [
    new MockOllamaServer({
      port: 11434,
      models: ['qwen2:1.5b-instruct-q4_0']
    }),
    new MockOllamaServer({
      port: 11435,
      models: ['smollm2:1.7b-instruct-q4_0']
    }),
    new MockOllamaServer({
      port: 11436,
      models: ['deepseek-r1:1.5b-q4_0']
    })
  ];
  
  try {
    // Start all servers
    console.log('Starting mock Ollama servers...');
    await Promise.all(servers.map(s => s.start()));
    console.log('✅ Mock servers started\n');
    
    // Run the tests
    console.log('Running AI tests...\n');
    
    const testProcess = spawn('npm', ['test', '--', 
      'tests/unit/llm/',
      'tests/unit/ai/',
      'tests/integration/ai-integration.test.ts'
    ], {
      stdio: 'inherit',
      env: {
        ...process.env,
        DELIBERATE_AI: '1',
        NODE_ENV: 'test'
      }
    });
    
    await new Promise<void>((resolve, reject) => {
      testProcess.on('exit', (code) => {
        if (code === 0) {
          console.log('\n✅ All AI tests passed!');
          resolve();
        } else {
          console.error(`\n❌ Tests failed with code ${code}`);
          reject(new Error(`Test process exited with code ${code}`));
        }
      });
      
      testProcess.on('error', (err) => {
        console.error('Failed to run tests:', err);
        reject(err);
      });
    });
    
  } catch (error) {
    console.error('Test execution failed:', error);
    process.exit(1);
  } finally {
    // Stop all servers
    console.log('\nStopping mock servers...');
    await Promise.all(servers.map(s => s.stop()));
    console.log('✅ Mock servers stopped');
  }
}

// Run the tests
runTests().catch(console.error);