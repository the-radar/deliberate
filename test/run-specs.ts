/**
 * Test Runner for Deliberate Specifications
 * 
 * This runs all specification tests to ensure we're building
 * exactly what was discussed and agreed upon.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SPEC_DIR = path.join(__dirname, 'specs');
const TEST_ENV_DIR = path.join(process.env.HOME!, '.deliberate-test');

// Setup test environment
function setupTestEnvironment() {
  console.log('🔧 Setting up test environment...');
  
  // Create test directory
  fs.mkdirSync(TEST_ENV_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_ENV_DIR, 'sandbox'), { recursive: true });
  
  // Create test files
  fs.writeFileSync(path.join(TEST_ENV_DIR, 'sandbox/important-file.txt'), 'Do not delete!');
  fs.writeFileSync(path.join(TEST_ENV_DIR, 'sandbox/test.txt'), 'Test content');
  fs.mkdirSync(path.join(TEST_ENV_DIR, 'sandbox/test-dir'), { recursive: true });
  
  // Set test environment variables
  process.env.DELIBERATE_TEST_MODE = '1';
  process.env.DELIBERATE_TEST_DIR = TEST_ENV_DIR;
  
  console.log('✅ Test environment ready\n');
}

// Run all specification tests
async function runSpecs() {
  console.log('🧪 Running Deliberate Specification Tests\n');
  console.log('These tests verify we\'re building exactly what was discussed.\n');
  
  const specs = [
    { name: 'Toggle System', file: 'toggle-system.spec.ts' },
    { name: 'Safety Filter', file: 'safety-filter.spec.ts' },
    { name: 'AI Integration', file: 'ai-integration.spec.ts' },
    { name: 'Agent Detection', file: 'agent-detection.spec.ts' },
    { name: 'Performance', file: 'performance.spec.ts' },
    { name: 'User Experience', file: 'user-experience.spec.ts' }
  ];
  
  const results: { spec: string; passed: boolean; error?: string }[] = [];
  
  for (const spec of specs) {
    console.log(`\n📋 Running ${spec.name} specifications...`);
    console.log('─'.repeat(50));
    
    try {
      // Run the spec file
      execSync(`npx jest ${path.join(SPEC_DIR, spec.file)} --verbose`, {
        stdio: 'inherit',
        env: process.env
      });
      
      results.push({ spec: spec.name, passed: true });
      console.log(`✅ ${spec.name} specifications PASSED`);
      
    } catch (error: any) {
      results.push({ 
        spec: spec.name, 
        passed: false, 
        error: error.message 
      });
      console.log(`❌ ${spec.name} specifications FAILED`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SPECIFICATION TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  results.forEach(r => {
    console.log(`${r.passed ? '✅' : '❌'} ${r.spec}`);
  });
  
  console.log('\n' + '-'.repeat(30));
  console.log(`Total: ${results.length} specs`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('-'.repeat(30));
  
  if (failed > 0) {
    console.log('\n⚠️  Some specifications are not met!');
    console.log('This means the implementation doesn\'t match what was discussed.');
    process.exit(1);
  } else {
    console.log('\n🎉 All specifications are met!');
    console.log('The implementation matches the agreed design.');
  }
}

// Cleanup after tests
function cleanup() {
  console.log('\n🧹 Cleaning up test environment...');
  
  try {
    // Uninstall deliberate from test environment
    execSync('node dist/cli/index.js uninstall', { 
      stdio: 'ignore',
      cwd: process.cwd()
    });
    
    // Remove test directory
    fs.rmSync(TEST_ENV_DIR, { recursive: true, force: true });
    
    console.log('✅ Cleanup complete');
  } catch (error) {
    console.log('⚠️  Cleanup had issues but continuing...');
  }
}

// Main execution
async function main() {
  try {
    setupTestEnvironment();
    await runSpecs();
  } catch (error) {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  } finally {
    cleanup();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { setupTestEnvironment, runSpecs, cleanup };