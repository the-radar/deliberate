/**
 * @deliberate/claude-code
 * Security-focused command and file change explanations for Claude Code
 *
 * Main exports for programmatic use
 */

// Server exports
export { startServer } from './server.js';

// Installer exports
export { install } from './install.js';

// Startup helper exports
export {
  ensureServerRunning,
  renderOnboardingWalkthrough,
  shouldShowOnboarding,
  markOnboardingComplete
} from './start.js';
