/**
 * @deliberate/claude-code
 * Security-focused command and file change explanations for Claude Code
 *
 * Main exports for programmatic use
 */

// Classifier exports
export {
  classify,
  quickCheck,
  getStatus,
  preloadModel,
  initialize,
  PatternMatcher,
  ModelClassifier
} from './classifier/index.js';

// Server exports
export { startServer } from './server.js';

// Installer exports
export { install } from './install.js';
