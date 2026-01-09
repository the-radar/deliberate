#!/usr/bin/env node

/**
 * Deliberate - Intelligent Command Wrapper
 * 
 * This is the main entry point for the deliberate CLI tool.
 * It provides intelligent command interception and safety analysis.
 */

// Ensure we're running with a supported Node version
const semver = require('semver');
const { engines } = require('../package.json');

if (!semver.satisfies(process.version, engines.node)) {
  console.error(
    `Error: Deliberate requires Node.js ${engines.node}. You are using ${process.version}.`
  );
  process.exit(1);
}

// Check if running in production mode
if (process.env.NODE_ENV !== 'development') {
  // In production, use the compiled version
  require('../dist/cli');
} else {
  // In development, use ts-node for direct TypeScript execution
  require('ts-node').register({
    project: require('path').join(__dirname, '..', 'tsconfig.json')
  });
  require('../src/cli');
}