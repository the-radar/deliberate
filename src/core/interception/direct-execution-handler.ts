import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../../utils/logger';

/**
 * Handles direct execution attempts (e.g., /usr/bin/rm)
 * This is invoked by the system when someone tries to execute binaries directly
 */
export class DirectExecutionHandler {
  private logger: Logger;
  private knownBinPaths: string[] = [
    '/bin',
    '/usr/bin',
    '/usr/local/bin',
    '/sbin',
    '/usr/sbin',
    '/usr/local/sbin',
    '/opt/local/bin',
    '/opt/homebrew/bin',
  ];

  constructor() {
    this.logger = new Logger('direct-execution-handler');
  }

  /**
   * Check if a command is a direct execution attempt
   */
  isDirectExecution(command: string): boolean {
    // Check if command contains a path separator
    if (command.includes('/')) {
      return true;
    }

    // Check if it's a resolved symlink or real path
    try {
      const realPath = fs.realpathSync(command);
      if (realPath !== command) {
        return true;
      }
    } catch {
      // File doesn't exist, not a direct execution
    }

    return false;
  }

  /**
   * Extract the base command from a path
   */
  extractCommand(fullPath: string): string {
    return path.basename(fullPath);
  }

  /**
   * Check if the path is a known system binary location
   */
  isSystemBinary(fullPath: string): boolean {
    const dir = path.dirname(fullPath);
    return this.knownBinPaths.some(binPath => 
      dir === binPath || dir.startsWith(binPath + '/')
    );
  }

  /**
   * Handle a direct execution attempt
   */
  async handleDirectExecution(
    fullPath: string, 
    args: string[]
  ): Promise<{ intercepted: boolean; command?: string; args?: string[] }> {
    if (!this.isDirectExecution(fullPath)) {
      return { intercepted: false };
    }

    this.logger.warn(`Direct execution attempt detected: ${fullPath}`);

    // Extract base command
    const baseCommand = this.extractCommand(fullPath);
    
    // Check if it's a system binary
    if (this.isSystemBinary(fullPath)) {
      this.logger.info(`Intercepting system binary: ${fullPath} -> ${baseCommand}`);
      return {
        intercepted: true,
        command: baseCommand,
        args: args
      };
    }

    // For non-system binaries, still intercept but preserve full path
    this.logger.info(`Intercepting direct execution: ${fullPath}`);
    return {
      intercepted: true,
      command: fullPath,
      args: args
    };
  }

  /**
   * Create a wrapper script for direct execution interception
   */
  generateDirectExecutionWrapper(): string {
    return `#!/bin/sh
# Deliberate Direct Execution Wrapper
# This script is installed in system directories to catch direct execution

# Get the actual command being executed
ACTUAL_CMD="$(basename "$0")"

# Check if we should intercept
if [ -n "$DELIBERATE_BYPASS_DIRECT" ]; then
    # Allow bypass for internal use
    unset DELIBERATE_BYPASS_DIRECT
    exec "/usr/bin/$ACTUAL_CMD" "$@"
fi

# Intercept through deliberate
exec deliberate intercept "$ACTUAL_CMD" "$@"
`;
  }
}