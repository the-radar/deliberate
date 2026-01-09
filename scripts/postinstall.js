#!/usr/bin/env node

/**
 * Post-install script for Deliberate
 * 
 * This script runs after npm install to set up the initial environment
 * and provide helpful information to the user.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function printBanner() {
  console.log();
  log('╔═══════════════════════════════════════════════════════╗', 'blue');
  log('║                                                       ║', 'blue');
  log('║   🛡️  Deliberate - Intelligent Command Wrapper  🛡️    ║', 'blue');
  log('║                                                       ║', 'blue');
  log('╚═══════════════════════════════════════════════════════╝', 'blue');
  console.log();
}

function checkEnvironment() {
  log('Checking environment...', 'yellow');
  
  // Check Node.js version
  const nodeVersion = process.version;
  log(`  ✓ Node.js ${nodeVersion}`, 'green');
  
  // Check platform
  const platform = os.platform();
  const supported = ['darwin', 'linux', 'win32'];
  if (supported.includes(platform)) {
    log(`  ✓ Platform: ${platform}`, 'green');
  } else {
    log(`  ⚠ Platform ${platform} may have limited support`, 'yellow');
  }
  
  // Check shell
  const shell = process.env.SHELL || 'unknown';
  log(`  ✓ Shell: ${shell}`, 'green');
  
  console.log();
}

function showNextSteps() {
  log('Next Steps:', 'bright');
  console.log();
  
  log('1. Install Deliberate globally:', 'blue');
  console.log('   npm install -g deliberate');
  console.log();
  
  log('2. Run the installation command:', 'blue');
  console.log('   deliberate install');
  console.log();
  
  log('3. Restart your shell or run:', 'blue');
  console.log('   export PATH="$HOME/.deliberate/shims:$PATH"');
  console.log();
  
  log('Optional: Install with AI features:', 'yellow');
  console.log('   1. Install Ollama from https://ollama.ai');
  console.log('   2. Run: deliberate install --with-ai');
  console.log();
}

function showDocumentation() {
  log('Documentation:', 'bright');
  console.log(`  • README: ${path.join(__dirname, '..', 'README.md')}`);
  console.log('  • GitHub: https://github.com/yourusername/deliberate');
  console.log('  • Issues: https://github.com/yourusername/deliberate/issues');
  console.log();
}

// Main execution
function main() {
  // Only run in development or when explicitly called
  if (process.env.NODE_ENV === 'production' && !process.env.DELIBERATE_POSTINSTALL) {
    return;
  }
  
  printBanner();
  checkEnvironment();
  showNextSteps();
  showDocumentation();
  
  log('Thank you for installing Deliberate! Stay safe, stay deliberate 🛡️', 'green');
  console.log();
}

// Run if called directly
if (require.main === module) {
  main();
}